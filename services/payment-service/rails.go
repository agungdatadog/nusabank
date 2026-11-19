package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// Rail availability: operations (or EP2's Workflow Automation) can take BI FAST or SKN out
// of service so customers are steered to another rail instead of failing at the partner.
// Only credit transfers are switched off; BI FAST account inquiry keeps serving SKN's
// beneficiary-name check, so the partner's own error rate stays visible while it is off.

const defaultAutoEnable = 120 * time.Minute

type railState struct {
	Available         bool       `json:"available"`
	UnavailableReason string     `json:"unavailable_reason,omitempty"`
	UnavailableSince  *time.Time `json:"unavailable_since,omitempty"`
	AutoEnableAt      *time.Time `json:"auto_enable_at,omitempty"`
	ChangedBy         string     `json:"changed_by,omitempty"`
}

// railStates reads every rail's switch. A disabled rail whose auto_enable_at has passed
// counts as available: the safety net needs no background job.
func (s *server) railStates(ctx context.Context) (map[string]railState, error) {
	out := map[string]railState{}
	for code := range rails {
		out[code] = railState{Available: true}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT rail, available OR COALESCE(auto_enable_at <= now(), false), COALESCE(reason, ''),
		unavailable_since, auto_enable_at, changed_by FROM rail_availability`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		var st railState
		if err := rows.Scan(&code, &st.Available, &st.UnavailableReason, &st.UnavailableSince, &st.AutoEnableAt, &st.ChangedBy); err != nil {
			return nil, err
		}
		if st.Available {
			st.UnavailableReason, st.UnavailableSince, st.AutoEnableAt = "", nil, nil
		}
		out[code] = st
	}
	return out, rows.Err()
}

// checkRailEnabled returns RAIL_DISABLED (status given by the caller) when the rail is off.
func (s *server) checkRailEnabled(ctx context.Context, code string, status int) error {
	if code == "INTRABANK" {
		return nil
	}
	var available bool
	err := s.db.QueryRowContext(ctx, "SELECT available OR COALESCE(auto_enable_at <= now(), false) FROM rail_availability WHERE rail = $1", code).Scan(&available)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && available) {
		return nil
	}
	if err != nil {
		return err
	}
	spanOrNoop(ctx).SetTag("transfer.rail_disabled", true)
	alt := map[string]string{"BIFAST": "SKN", "SKN": "BI FAST"}[code]
	return &apiError{status: status, Code: "RAIL_DISABLED",
		Message: rails[code].Name + " sedang dinonaktifkan sementara karena gangguan. Silakan gunakan " + alt + "."}
}

func (s *server) railList(ctx context.Context) ([]map[string]any, error) {
	type window struct {
		WindowID  string    `json:"window_id"`
		CutoffAt  time.Time `json:"cutoff_at"`
		SettlesAt time.Time `json:"settles_at"`
	}
	states, err := s.railStates(ctx)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, code := range []string{"INTRABANK", "BIFAST", "SKN"} {
		rl, st := rails[code], states[code]
		item := map[string]any{"code": rl.Code, "name": rl.Name, "fee": idr(rl.Fee), "max_amount": idr(rl.MaxAmount), "available": st.Available}
		if !st.Available {
			item["unavailable_reason"] = st.UnavailableReason
			item["unavailable_since"] = st.UnavailableSince
			item["auto_enable_at"] = st.AutoEnableAt
		}
		if st.ChangedBy != "" {
			item["changed_by"] = st.ChangedBy
		}
		if code == "SKN" {
			var ws []window
			next := nextSKNWindow(time.Now())
			for i := 0; i < 4; i++ {
				at := next.Add(time.Duration(i*sknWindowMinutes) * time.Minute)
				ws = append(ws, window{"SKN-" + at.In(wib).Format("20060102-1504"), at.Add(-sknCutoff), at})
			}
			item["clearing_windows"] = ws
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *server) listRails(w http.ResponseWriter, r *http.Request) {
	out, err := s.railList(r.Context())
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type railAvailabilityChange struct {
	Available              *bool  `json:"available"`
	Reason                 string `json:"reason,omitempty"`
	ChangedBy              string `json:"changed_by"`
	AutoEnableAfterMinutes int    `json:"auto_enable_after_minutes,omitempty"`
}

func (s *server) internalSetRailAvailability(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code := chi.URLParam(r, "rail")
	if code != "BIFAST" && code != "SKN" {
		writeErr(w, r, errNotFound("Rail tidak dapat dinonaktifkan"))
		return
	}
	var req railAvailabilityChange
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	if req.Available == nil || req.ChangedBy == "" || len(req.Reason) > 200 {
		writeErr(w, r, errBadRequest("available and changed_by are required; reason at most 200 characters"))
		return
	}
	autoEnable := defaultAutoEnable
	if m := req.AutoEnableAfterMinutes; m != 0 {
		if m < 5 || m > 480 {
			writeErr(w, r, errBadRequest("auto_enable_after_minutes must be between 5 and 480"))
			return
		}
		autoEnable = time.Duration(m) * time.Minute
	}
	var err error
	if *req.Available {
		_, err = s.db.ExecContext(ctx, `INSERT INTO rail_availability (rail, available, reason, changed_by)
			VALUES ($1, true, NULLIF($2, ''), $3)
			ON CONFLICT (rail) DO UPDATE SET available = true, reason = EXCLUDED.reason, changed_by = EXCLUDED.changed_by,
			  changed_at = now(), unavailable_since = NULL, auto_enable_at = NULL`, code, req.Reason, req.ChangedBy)
	} else {
		// Disabling an already-disabled rail keeps its original start time: the outage didn't restart.
		_, err = s.db.ExecContext(ctx, `INSERT INTO rail_availability (rail, available, reason, changed_by, unavailable_since, auto_enable_at)
			VALUES ($1, false, NULLIF($2, ''), $3, now(), now() + make_interval(mins => $4))
			ON CONFLICT (rail) DO UPDATE SET available = false, reason = EXCLUDED.reason, changed_by = EXCLUDED.changed_by,
			  changed_at = now(), auto_enable_at = EXCLUDED.auto_enable_at,
			  unavailable_since = CASE WHEN rail_availability.available OR COALESCE(rail_availability.auto_enable_at <= now(), false)
			                           THEN now() ELSE rail_availability.unavailable_since END`,
			code, req.Reason, req.ChangedBy, int(autoEnable.Minutes()))
	}
	if err != nil {
		writeErr(w, r, err)
		return
	}
	span := spanOrNoop(ctx)
	span.SetTag("rail.code", code)
	span.SetTag("rail.available", *req.Available)
	span.SetTag("rail.changed_by", req.ChangedBy)
	slog.InfoContext(ctx, "rail availability changed", "rail", code, "available", *req.Available,
		"changed_by", req.ChangedBy, "reason", req.Reason)
	list, err := s.railList(ctx)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	for _, item := range list {
		if item["code"] == code {
			writeJSON(w, http.StatusOK, item)
			return
		}
	}
}

func (s *server) internalListRails(w http.ResponseWriter, r *http.Request) { s.listRails(w, r) }

// reportRails publishes each interbank rail's switch as a gauge (1 = in service) so the
// business dashboard and the incident timeline can show when BI FAST was off.
func (s *server) reportRails(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		if states, err := s.railStates(ctx); err == nil {
			for _, code := range []string{"BIFAST", "SKN"} {
				v := 0.0
				if states[code].Available {
					v = 1
				}
				_ = s.metrics.Gauge("nusabank.transfer.rail.available", v, []string{"rail:" + code}, 1)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
