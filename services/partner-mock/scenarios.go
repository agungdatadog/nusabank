package main

import (
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/DataDog/dd-trace-go/v2/ddtrace/tracer"
	"github.com/go-chi/chi/v5"
)

// defaultScenarioTTL bounds a scenario enabled without expires_at, so a forgotten
// toggle cannot poison the healthy baseline for days.
const defaultScenarioTTL = 60 * time.Minute

var validTargets = map[string]bool{"bifast": true, "skn": true, "ppob": true, "credit-bureau": true, "fx": true}

// Scenario matches catalog/openapi.yaml#/components/schemas/Scenario.
type Scenario struct {
	ID                    string     `json:"id"`
	Target                string     `json:"target"`
	BillerCode            string     `json:"biller_code,omitempty"`
	Enabled               bool       `json:"enabled"`
	LatencyMS             int        `json:"latency_ms,omitempty"`
	ErrorRate             float64    `json:"error_rate,omitempty"`
	ErrorStatus           int        `json:"error_status,omitempty"`
	SKNWindowDelayMinutes int        `json:"skn_window_delay_minutes,omitempty"`
	ExpiresAt             *time.Time `json:"expires_at,omitempty"`
}

// catalog is the menu of demo scenarios. All disabled — the baseline must be healthy.
var catalog = []Scenario{
	{ID: "bifast-timeout", Target: "bifast", LatencyMS: 8000},
	{ID: "bifast-errors", Target: "bifast", ErrorRate: 0.3, ErrorStatus: 503},
	{ID: "skn-settlement-delay", Target: "skn", SKNWindowDelayMinutes: 30},
	{ID: "ppob-gopay-errors", Target: "ppob", BillerCode: "gopay", ErrorRate: 0.4, ErrorStatus: 503},
	{ID: "ppob-pln-slow", Target: "ppob", BillerCode: "pln", LatencyMS: 5000},
	{ID: "ppob-aggregator-down", Target: "ppob", ErrorRate: 1, ErrorStatus: 503},
	{ID: "credit-bureau-slow", Target: "credit-bureau", LatencyMS: 12000},
	{ID: "fx-feed-down", Target: "fx", ErrorRate: 1, ErrorStatus: 503},
}

type scenarioStore struct {
	mu    sync.Mutex
	items map[string]Scenario
	now   func() time.Time
}

func newScenarioStore() *scenarioStore {
	s := &scenarioStore{items: map[string]Scenario{}, now: time.Now}
	for _, sc := range catalog {
		s.items[sc.ID] = sc
	}
	return s
}

func (s *scenarioStore) snapshot() []Scenario {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.expireLocked()
	out := make([]Scenario, 0, len(s.items))
	for _, sc := range s.items {
		out = append(out, sc)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (s *scenarioStore) expireLocked() {
	now := s.now()
	for id, sc := range s.items {
		if sc.Enabled && sc.ExpiresAt != nil && !now.Before(*sc.ExpiresAt) {
			sc.Enabled = false
			s.items[id] = sc
			slog.Info("scenario auto-disabled", "scenario.id", id, "partner.name", sc.Target)
		}
	}
}

// active returns enabled scenarios for a target. For ppob, a scenario without
// biller_code hits the whole aggregator; with one, only that biller.
func (s *scenarioStore) active(target, billerCode string) []Scenario {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.expireLocked()
	var out []Scenario
	for _, sc := range s.items {
		if !sc.Enabled || sc.Target != target {
			continue
		}
		if sc.BillerCode != "" && sc.BillerCode != billerCode {
			continue
		}
		out = append(out, sc)
	}
	return out
}

func (s *scenarioStore) set(sc Scenario) (Scenario, error) {
	if !validTargets[sc.Target] {
		return sc, fmt.Errorf("target must be one of bifast, skn, ppob, credit-bureau, fx")
	}
	if sc.BillerCode != "" && sc.Target != "ppob" {
		return sc, fmt.Errorf("biller_code applies to target ppob only")
	}
	if sc.ErrorRate < 0 || sc.ErrorRate > 1 {
		return sc, fmt.Errorf("error_rate must be between 0 and 1")
	}
	if sc.LatencyMS < 0 || sc.SKNWindowDelayMinutes < 0 {
		return sc, fmt.Errorf("latency_ms and skn_window_delay_minutes must be >= 0")
	}
	switch sc.ErrorStatus {
	case 0:
		sc.ErrorStatus = http.StatusServiceUnavailable
	case 500, 503, 504:
	default:
		return sc, fmt.Errorf("error_status must be 500, 503 or 504")
	}
	if sc.Enabled && sc.ExpiresAt == nil {
		exp := s.now().Add(defaultScenarioTTL)
		sc.ExpiresAt = &exp
	}

	s.mu.Lock()
	s.items[sc.ID] = sc
	s.mu.Unlock()
	return sc, nil
}

// inject applies matching scenarios to a partner call. Returns true when it has
// already written an error response and the handler must stop.
func (s *scenarioStore) inject(w http.ResponseWriter, r *http.Request, target, billerCode string) bool {
	active := s.active(target, billerCode)
	if len(active) == 0 {
		return false
	}
	span, hasSpan := tracer.SpanFromContext(r.Context())

	latency := 0
	for _, sc := range active {
		latency = max(latency, sc.LatencyMS)
		if hasSpan {
			span.SetTag("scenario.id", sc.ID)
		}
	}
	if latency > 0 {
		select {
		case <-time.After(time.Duration(latency) * time.Millisecond):
		case <-r.Context().Done():
			return true
		}
	}

	for _, sc := range active {
		if sc.ErrorRate > 0 && rand.Float64() < sc.ErrorRate {
			partner := target
			if billerCode != "" {
				partner = "ppob:" + billerCode
			}
			code := "PARTNER_UNAVAILABLE"
			if sc.ErrorStatus == http.StatusGatewayTimeout {
				code = "PARTNER_TIMEOUT"
			}
			writeError(w, r, sc.ErrorStatus, code, fmt.Sprintf("%s is not responding (scenario %s)", partner, sc.ID), partner)
			return true
		}
	}
	return false
}

func (s *scenarioStore) list(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.snapshot())
}

func (s *scenarioStore) reset(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	for id, sc := range s.items {
		sc.Enabled = false
		s.items[id] = sc
	}
	s.mu.Unlock()
	slog.WarnContext(r.Context(), "all scenarios disabled — healthy baseline restored")
	w.WriteHeader(http.StatusNoContent)
}

func (s *scenarioStore) put(w http.ResponseWriter, r *http.Request) {
	var sc Scenario
	if err := decode(r, &sc); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid scenario body: "+err.Error(), "")
		return
	}
	sc.ID = chi.URLParam(r, "scenarioId")
	saved, err := s.set(sc)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), "")
		return
	}
	slog.WarnContext(r.Context(), "scenario updated", "scenario.id", saved.ID, "partner.name", saved.Target,
		"enabled", saved.Enabled, "latency_ms", saved.LatencyMS, "error_rate", saved.ErrorRate,
		"biller_code", saved.BillerCode)
	writeJSON(w, http.StatusOK, saved)
}
