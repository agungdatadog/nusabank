package main

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Operations endpoints for admin-service (cluster-internal, no customer JWT): the
// cross-customer transfer view and the operator retry that EP3's Workflow Automation drives.

func (s *server) internalListTransfers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	since := time.Now().Add(-24 * time.Hour)
	if v := q.Get("since"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeErr(w, r, errBadRequest("since must be an RFC 3339 timestamp"))
			return
		}
		since = t
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 {
		limit = 100
	}
	limit = min(limit, 500)
	rows, err := s.db.QueryContext(r.Context(), "SELECT "+transferColumns+` FROM transfers
		WHERE created_at >= $1 AND ($2 = '' OR status = $2) AND ($3 = '' OR rail = $3)
		ORDER BY created_at DESC LIMIT $4`, since, q.Get("status"), q.Get("rail"), limit)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	defer rows.Close()
	items := []*transfer{}
	for rows.Next() {
		t, err := scanTransfer(rows)
		if err != nil {
			writeErr(w, r, err)
			return
		}
		items = append(items, t)
	}
	writeJSON(w, http.StatusOK, items)
}

// retryableReason is the only failure an operator may re-drive: the rail was down, so
// nothing reached the beneficiary bank. Business rejections stay final.
const retryableReason = "RAIL_UNAVAILABLE"

func (s *server) internalRetryTransfer(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "transferId")
	if !reUUID.MatchString(id) {
		writeErr(w, r, errNotFound("Transfer tidak ditemukan"))
		return
	}
	// Claim atomically: concurrent retries of the same transfer cannot both run.
	res, err := s.db.ExecContext(ctx, `UPDATE transfers SET status = 'PROCESSING', failure_reason = NULL, hold_id = NULL,
		settled_at = NULL, retry_count = retry_count + 1 WHERE id = $1 AND status = 'FAILED' AND failure_reason = $2`, id, retryableReason)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		t, err := s.loadTransfer(ctx, "id = $1", id)
		switch {
		case err != nil:
			writeErr(w, r, err)
		case t == nil:
			writeErr(w, r, errNotFound("Transfer tidak ditemukan"))
		default:
			writeErr(w, r, &apiError{status: http.StatusConflict, Code: "NOT_RETRYABLE",
				Message: "Hanya transfer gagal karena " + retryableReason + " yang dapat diulang (status " + t.Status + " " + t.FailureReason + ")"})
		}
		return
	}
	t, err := s.loadTransfer(ctx, "id = $1", id)
	if err != nil || t == nil {
		writeErr(w, r, err)
		return
	}
	span := spanOrNoop(ctx)
	span.SetTag("transfer.id", t.ID)
	span.SetTag("transfer.rail", t.Rail)
	span.SetTag("transfer.retry_count", t.RetryCount)
	holdKey := uuid.NewSHA1(uuid.NameSpaceURL, []byte("nusabank:transfer:"+t.ID+":retry:"+strconv.Itoa(t.RetryCount))).String()
	if err := s.execute(ctx, t, holdKey); err != nil {
		writeErr(w, r, err)
		return
	}
	final, _ := s.loadTransfer(ctx, "id = $1", t.ID)
	writeJSON(w, http.StatusAccepted, final)
}
