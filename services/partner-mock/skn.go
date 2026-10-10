package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"sync"
	"time"

	httptrace "github.com/DataDog/dd-trace-go/contrib/net/http/v2"
)

const partnerSKN = "skn"

type sknItem struct {
	RailReference string `json:"rail_reference"`
	Status        string `json:"status"`
	FailureReason string `json:"failure_reason,omitempty"`
}

type sknWindow struct {
	ID        string
	SettlesAt time.Time
	Items     []sknItem

	attempts    int
	nextAttempt time.Time
}

const (
	sknMaxBackoff = 5 * time.Minute
	// sknGiveUpAfter drops a window nobody could receive, so an absent
	// payment-service can't keep the log stream noisy forever.
	sknGiveUpAfter = 24 * time.Hour
)

func sknBackoff(attempts int) time.Duration {
	d := 10 * time.Second << min(attempts, 6)
	return min(d, sknMaxBackoff)
}

// sknRail queues credits per clearing window and settles each window with one
// batch callback to payment-service. Real SKN settles a few times a day; windows
// are configurable (default 15 min) so a full cycle fits in a live demo.
type sknRail struct {
	cfg       config
	scenarios *scenarioStore
	client    *http.Client
	now       func() time.Time

	mu      sync.Mutex
	windows map[string]*sknWindow
}

func newSKNRail(cfg config, sc *scenarioStore) *sknRail {
	return &sknRail{
		cfg:       cfg,
		scenarios: sc,
		client:    httptrace.WrapClient(&http.Client{Timeout: 10 * time.Second}),
		now:       time.Now,
		windows:   map[string]*sknWindow{},
	}
}

// nextWindow returns the first window boundary at least the cut-off away from t.
// Boundaries are aligned to WIB midnight, so window IDs read like real clearing slots.
func nextWindow(t time.Time, windowMinutes, cutoffMinutes int) time.Time {
	local := t.In(wib)
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, wib)
	step := time.Duration(windowMinutes) * time.Minute
	elapsed := local.Sub(midnight)
	boundary := midnight.Add((elapsed/step + 1) * step)
	if boundary.Sub(local) < time.Duration(cutoffMinutes)*time.Minute {
		boundary = boundary.Add(step)
	}
	return boundary
}

func windowID(boundary time.Time) string {
	return "SKN-" + boundary.In(wib).Format("20060102-1504")
}

func (s *sknRail) submit(w http.ResponseWriter, r *http.Request) {
	tagPartner(r, partnerSKN)
	var req RailTransferRequest
	if err := decode(r, &req); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid transfer body: "+err.Error(), partnerSKN)
		return
	}
	if msg := req.validate(); msg != "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", msg, partnerSKN)
		return
	}
	if s.scenarios.inject(w, r, partnerSKN, "") {
		return
	}
	naturalLatency(r.Context(), 60, 200)

	now := s.now()
	boundary := nextWindow(now, s.cfg.sknWindowMinutes, s.cfg.sknCutoffMinutes)
	id := windowID(boundary)
	item := sknItem{RailReference: railReference("SKN", now), Status: "SUCCESS"}
	if isClosedAccount(req.DestinationAccountNumber) {
		item.Status, item.FailureReason = "FAILED", "REKENING_TUTUP"
	}

	s.mu.Lock()
	win, ok := s.windows[id]
	if !ok {
		win = &sknWindow{ID: id, SettlesAt: boundary}
		s.windows[id] = win
	}
	win.Items = append(win.Items, item)
	s.mu.Unlock()

	writeJSON(w, http.StatusAccepted, map[string]any{
		"rail_reference":         item.RailReference,
		"window_id":              id,
		"expected_settlement_at": boundary.UTC(),
	})
}

// run settles due windows. A window whose callback fails stays queued and is
// retried on the next tick, so a payment-service restart loses no settlements.
func (s *sknRail) run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.settleDue(ctx)
		}
	}
}

func (s *sknRail) delay() time.Duration {
	d := 0
	for _, sc := range s.scenarios.active(partnerSKN, "") {
		d = max(d, sc.SKNWindowDelayMinutes)
	}
	return time.Duration(d) * time.Minute
}

func (s *sknRail) settleDue(ctx context.Context) {
	now := s.now()
	cutoff := now.Add(-s.delay())
	s.mu.Lock()
	var due []*sknWindow
	for id, win := range s.windows {
		if now.Sub(win.SettlesAt) > sknGiveUpAfter {
			delete(s.windows, id)
			slog.ErrorContext(ctx, "SKN window dropped after repeated callback failures",
				"partner.name", partnerSKN, "window_id", id, "items", len(win.Items), "attempts", win.attempts)
			continue
		}
		if !win.SettlesAt.After(cutoff) && !now.Before(win.nextAttempt) {
			due = append(due, win)
		}
	}
	s.mu.Unlock()
	sort.Slice(due, func(i, j int) bool { return due[i].SettlesAt.Before(due[j].SettlesAt) })

	for _, win := range due {
		if err := s.deliver(ctx, win); err != nil {
			s.mu.Lock()
			win.attempts++
			retry := sknBackoff(win.attempts)
			win.nextAttempt = s.now().Add(retry)
			s.mu.Unlock()
			slog.WarnContext(ctx, "SKN settlement callback failed, will retry",
				"partner.name", partnerSKN, "window_id", win.ID, "items", len(win.Items),
				"attempts", win.attempts, "retry_in", retry.String(), "error", err)
			continue
		}
		s.mu.Lock()
		delete(s.windows, win.ID)
		s.mu.Unlock()
		slog.InfoContext(ctx, "SKN window settled", "partner.name", partnerSKN, "window_id", win.ID, "items", len(win.Items))
	}
}

func (s *sknRail) deliver(ctx context.Context, win *sknWindow) error {
	body, _ := json.Marshal(map[string]any{
		"window_id":  win.ID,
		"settled_at": s.now().UTC(),
		"items":      win.Items,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.paymentServiceURL+"/internal/rails/skn/settlements", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("payment-service returned %d", resp.StatusCode)
	}
	return nil
}
