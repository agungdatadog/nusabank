package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/DataDog/datadog-go/v5/statsd"
	"github.com/DataDog/dd-trace-go/v2/ddtrace/tracer"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type server struct {
	db       *sql.DB
	accounts accountClient
	rails    railClient
	outbox   *outbox
	metrics  statsd.ClientInterface
	secret   []byte
}

type ctxKey struct{}

func claimsFrom(ctx context.Context) *Claims { return ctx.Value(ctxKey{}).(*Claims) }

// requireCustomer guards /api/**; the CIF goes on the root span as usr.id.
func (s *server) requireCustomer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		c, ok := verifyJWT(token, s.secret)
		if !ok {
			writeErr(w, r, errUnauthorized())
			return
		}
		if span := spanOrNoop(r.Context()); span != nil {
			tracer.SetUser(span, c.Sub, tracer.WithUserMetadata("segment", c.Segment))
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, c)))
	})
}

func spanOrNoop(ctx context.Context) *tracer.Span {
	span, _ := tracer.SpanFromContext(ctx)
	return span
}

// ---- reference data ----

func (s *server) listBanks(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, banks)
}

func (s *server) listRails(w http.ResponseWriter, _ *http.Request) {
	type window struct {
		WindowID  string    `json:"window_id"`
		CutoffAt  time.Time `json:"cutoff_at"`
		SettlesAt time.Time `json:"settles_at"`
	}
	out := []map[string]any{}
	for _, code := range []string{"INTRABANK", "BIFAST", "SKN"} {
		rl := rails[code]
		item := map[string]any{"code": rl.Code, "name": rl.Name, "fee": idr(rl.Fee), "max_amount": idr(rl.MaxAmount)}
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
	writeJSON(w, http.StatusOK, out)
}

// ---- source account ownership ----

func (s *server) ownedSource(ctx context.Context, cif, number string) (*accountRef, error) {
	if !reAccount16.MatchString(number) {
		return nil, errBadRequest("source_account_number must be 16 digits")
	}
	ref, err := s.accounts.lookup(ctx, number)
	if err != nil {
		return nil, err
	}
	if ref == nil || ref.CIF != cif {
		return nil, errNotFound("Rekening sumber tidak ditemukan")
	}
	if ref.Currency != "IDR" {
		return nil, errBadRequest("transfer is only available from IDR accounts")
	}
	return ref, nil
}

// resolveBeneficiary returns the beneficiary name: account-service for intrabank,
// the BI FAST account inquiry for everything else (SKN has no real-time inquiry).
func (s *server) resolveBeneficiary(ctx context.Context, bankCode, account string) (string, error) {
	if bankCode == nusaBankCode {
		if !reAccount16.MatchString(account) {
			return "", &apiError{status: http.StatusUnprocessableEntity, Code: "ACCOUNT_NOT_FOUND", Message: "Rekening tujuan tidak ditemukan"}
		}
		ref, err := s.accounts.lookup(ctx, account)
		if err != nil {
			return "", err
		}
		if ref == nil || ref.Status != "ACTIVE" || ref.Currency != "IDR" {
			return "", &apiError{status: http.StatusUnprocessableEntity, Code: "ACCOUNT_NOT_FOUND", Message: "Rekening tujuan tidak ditemukan"}
		}
		return ref.OwnerName, nil
	}
	return s.rails.inquiry(ctx, bankCode, account)
}

// ---- inquiry ----

type inquiryRequest struct {
	Rail                     string `json:"rail"`
	SourceAccountNumber      string `json:"source_account_number"`
	DestinationBankCode      string `json:"destination_bank_code"`
	DestinationAccountNumber string `json:"destination_account_number"`
	Amount                   Money  `json:"amount"`
}

func (s *server) inquiry(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r.Context())
	var req inquiryRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	rl, ok := rails[req.Rail]
	if !ok {
		writeErr(w, r, errBadRequest("rail must be INTRABANK, BIFAST or SKN"))
		return
	}
	amount, ok := parseIDR(req.Amount.Amount)
	if !ok || req.Amount.Currency != "IDR" || amount <= 0 {
		writeErr(w, r, errBadRequest("amount must be a positive whole IDR amount"))
		return
	}
	if !reBankCode.MatchString(req.DestinationBankCode) || !reExtAccount.MatchString(req.DestinationAccountNumber) {
		writeErr(w, r, errBadRequest("destination_bank_code (3 digits) and destination_account_number (6-20 digits) are required"))
		return
	}
	b, known := findBank(req.DestinationBankCode)
	if !known || !b.supports(rl.Code) {
		writeErr(w, r, &apiError{status: http.StatusUnprocessableEntity, Code: "RAIL_NOT_SUPPORTED", Message: rl.Name + " tidak tersedia untuk bank tujuan ini"})
		return
	}
	if amount > rl.MaxAmount {
		writeErr(w, r, &apiError{status: http.StatusUnprocessableEntity, Code: "LIMIT_EXCEEDED",
			Message: "Nominal melebihi batas " + rl.Name + " per transaksi"})
		return
	}
	if req.DestinationAccountNumber == req.SourceAccountNumber {
		writeErr(w, r, errBadRequest("source and destination must differ"))
		return
	}
	src, err := s.ownedSource(r.Context(), c.Sub, req.SourceAccountNumber)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	name, err := s.resolveBeneficiary(r.Context(), b.Code, req.DestinationAccountNumber)
	if err != nil {
		writeErr(w, r, err)
		return
	}

	var id string
	var expires time.Time
	err = s.db.QueryRowContext(r.Context(), `INSERT INTO inquiries
		(cif, rail, source_account_number, source_account_name, destination_bank_code, destination_bank_name,
		 destination_account_number, destination_account_name, amount, fee, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + interval '5 minutes') RETURNING id, expires_at`,
		c.Sub, rl.Code, src.AccountNumber, src.OwnerName, b.Code, b.Name, req.DestinationAccountNumber, name, amount, rl.Fee).
		Scan(&id, &expires)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	resp := map[string]any{
		"inquiry_id": id, "rail": rl.Code, "destination_bank_code": b.Code, "destination_bank_name": b.Name,
		"destination_account_number": req.DestinationAccountNumber, "destination_account_name": name,
		"amount": idr(amount), "fee": idr(rl.Fee), "expires_at": expires,
	}
	if rl.Code == "SKN" {
		resp["expected_settlement_at"] = nextSKNWindow(time.Now())
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---- transfers ----

type transfer struct {
	ID                       string     `json:"id"`
	Rail                     string     `json:"rail"`
	Status                   string     `json:"status"`
	SourceAccountNumber      string     `json:"source_account_number"`
	DestinationBankCode      string     `json:"destination_bank_code"`
	DestinationBankName      string     `json:"destination_bank_name"`
	DestinationAccountNumber string     `json:"destination_account_number"`
	DestinationAccountName   string     `json:"destination_account_name"`
	Amount                   Money      `json:"amount"`
	Fee                      Money      `json:"fee"`
	Note                     string     `json:"note,omitempty"`
	RailReference            string     `json:"rail_reference,omitempty"`
	SKNWindowID              string     `json:"skn_window_id,omitempty"`
	FailureReason            string     `json:"failure_reason,omitempty"`
	CreatedAt                time.Time  `json:"created_at"`
	SettledAt                *time.Time `json:"settled_at,omitempty"`

	cif               string
	sourceAccountName string
	holdID            string
	amount, fee       int64
}

const transferColumns = `id, cif, rail, status, source_account_number, source_account_name, destination_bank_code,
	destination_bank_name, destination_account_number, destination_account_name, amount, fee, COALESCE(note, ''),
	COALESCE(hold_id::text, ''), COALESCE(rail_reference, ''), COALESCE(skn_window_id, ''), COALESCE(failure_reason, ''),
	created_at, settled_at`

type scanner interface{ Scan(...any) error }

func scanTransfer(row scanner) (*transfer, error) {
	var t transfer
	var amount, fee float64
	err := row.Scan(&t.ID, &t.cif, &t.Rail, &t.Status, &t.SourceAccountNumber, &t.sourceAccountName, &t.DestinationBankCode,
		&t.DestinationBankName, &t.DestinationAccountNumber, &t.DestinationAccountName, &amount, &fee, &t.Note,
		&t.holdID, &t.RailReference, &t.SKNWindowID, &t.FailureReason, &t.CreatedAt, &t.SettledAt)
	if err != nil {
		return nil, err
	}
	t.amount, t.fee = int64(amount), int64(fee)
	t.Amount, t.Fee = idr(t.amount), idr(t.fee)
	return &t, nil
}

func (s *server) loadTransfer(ctx context.Context, where string, arg any) (*transfer, error) {
	t, err := scanTransfer(s.db.QueryRowContext(ctx, "SELECT "+transferColumns+" FROM transfers WHERE "+where, arg))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

type createTransferRequest struct {
	InquiryID string `json:"inquiry_id"`
	Note      string `json:"note,omitempty"`
}

func (s *server) createTransfer(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	c := claimsFrom(ctx)
	key := r.Header.Get("Idempotency-Key")
	if !reUUID.MatchString(key) {
		writeErr(w, r, errBadRequest("Idempotency-Key header must be a UUID"))
		return
	}
	if existing, err := s.loadTransfer(ctx, "idempotency_key = $1", key); err != nil || existing != nil {
		if err != nil {
			writeErr(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, existing) // replay returns the original result
		return
	}
	var req createTransferRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	if !reUUID.MatchString(req.InquiryID) || len(req.Note) > 50 {
		writeErr(w, r, errBadRequest("inquiry_id must be a UUID and note at most 50 characters"))
		return
	}

	// Claim the inquiry and create the transfer atomically: an inquiry is single-use.
	id := uuid.NewString()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO transfers
		(id, cif, inquiry_id, idempotency_key, rail, status, source_account_number, source_account_name,
		 destination_bank_code, destination_bank_name, destination_account_number, destination_account_name,
		 amount, fee, note)
		SELECT $1, cif, id, $2, rail, 'PROCESSING', source_account_number, source_account_name,
		       destination_bank_code, destination_bank_name, destination_account_number, destination_account_name,
		       amount, fee, NULLIF($3, '')
		FROM inquiries WHERE id = $4 AND cif = $5 AND used_at IS NULL AND expires_at > now()`,
		id, key, req.Note, req.InquiryID, c.Sub)
	if err == nil {
		if n, _ := res.RowsAffected(); n == 0 {
			err = &apiError{status: http.StatusConflict, Code: "INQUIRY_EXPIRED", Message: "Sesi transfer kedaluwarsa, silakan ulangi"}
		}
	}
	if err == nil {
		_, err = tx.ExecContext(ctx, "UPDATE inquiries SET used_at = now() WHERE id = $1", req.InquiryID)
	}
	if err != nil {
		tx.Rollback()
		writeErr(w, r, err)
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, r, err)
		return
	}
	t, _ := s.loadTransfer(ctx, "id = $1", id)
	span := spanOrNoop(ctx)
	span.SetTag("transfer.id", t.ID)
	span.SetTag("transfer.rail", t.Rail)
	span.SetTag("transfer.destination_bank", bankTag(t.DestinationBankCode))

	holdID, err := s.accounts.hold(ctx, t.SourceAccountNumber, t.amount+t.fee, t.ID)
	if err != nil {
		var ae *apiError
		reason := "HOLD_FAILED"
		if errors.As(err, &ae) && ae.Code != "" {
			reason = ae.Code
		}
		s.finish(ctx, t, "FAILED", reason, "", "")
		writeErr(w, r, err)
		return
	}
	t.holdID = holdID
	if _, err := s.db.ExecContext(ctx, "UPDATE transfers SET hold_id = $1 WHERE id = $2", holdID, t.ID); err != nil {
		writeErr(w, r, err)
		return
	}

	rt := railTransfer{
		Reference: t.ID, SourceBankCode: nusaBankCode, SourceAccountNumber: t.SourceAccountNumber,
		SourceAccountName: t.sourceAccountName, DestinationBankCode: t.DestinationBankCode,
		DestinationAccountNumber: t.DestinationAccountNumber, Amount: t.Amount, Note: t.Note,
	}
	switch t.Rail {
	case "INTRABANK":
		s.finish(ctx, t, "SUCCESS", "", "INTRA"+strings.ReplaceAll(t.ID[:13], "-", ""), "")
	case "BIFAST":
		out, err := s.rails.bifast(ctx, rt)
		switch {
		case err != nil:
			s.finish(ctx, t, "FAILED", "RAIL_UNAVAILABLE", "", "")
			writeErr(w, r, err)
			return
		case out.rejected:
			s.finish(ctx, t, "FAILED", "REJECTED_BY_BENEFICIARY_BANK", "", "")
		default:
			s.finish(ctx, t, "SUCCESS", "", out.railReference, "")
		}
	case "SKN":
		out, err := s.rails.skn(ctx, rt)
		if err != nil {
			s.finish(ctx, t, "FAILED", "RAIL_UNAVAILABLE", "", "")
			writeErr(w, r, err)
			return
		}
		// Stays PROCESSING until the clearing window settles via the callback.
		if _, err := s.db.ExecContext(ctx, "UPDATE transfers SET rail_reference = $1, skn_window_id = $2 WHERE id = $3",
			out.railReference, out.windowID, t.ID); err != nil {
			writeErr(w, r, err)
			return
		}
		slog.InfoContext(ctx, "SKN transfer queued", "transfer.id", t.ID, "window_id", out.windowID, "partner.name", partnerSKN)
	}
	final, _ := s.loadTransfer(ctx, "id = $1", t.ID)
	writeJSON(w, http.StatusCreated, final)
}

// transferEvent matches catalog/openapi.yaml#/components/schemas/TransferEvent.
type transferEvent struct {
	EventID                  string `json:"event_id"`
	EventType                string `json:"event_type"`
	OccurredAt               string `json:"occurred_at"`
	Producer                 string `json:"producer"`
	TransferID               string `json:"transfer_id"`
	CIF                      string `json:"cif"`
	Rail                     string `json:"rail"`
	Status                   string `json:"status"`
	SourceAccountNumber      string `json:"source_account_number"`
	DestinationBankCode      string `json:"destination_bank_code"`
	DestinationAccountNumber string `json:"destination_account_number"`
	DestinationBankName      string `json:"destination_bank_name"`
	SourceAccountName        string `json:"source_account_name"`
	DestinationAccountName   string `json:"destination_account_name"`
	Note                     string `json:"note,omitempty"`
	Amount                   Money  `json:"amount"`
	Fee                      Money  `json:"fee"`
	HoldID                   string `json:"hold_id,omitempty"`
}

// finish moves a transfer to its terminal state, releases the hold on failure, and
// commits the event to the outbox in the same transaction as the status change.
func (s *server) finish(ctx context.Context, t *transfer, status, reason, railRef, windowID string) {
	if status == "FAILED" && t.holdID != "" {
		if err := s.accounts.release(ctx, t.holdID); err != nil {
			slog.ErrorContext(ctx, "hold release failed; it will expire on its own", "hold_id", t.holdID, "partner.name", partnerAccount, "error", err)
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		slog.ErrorContext(ctx, "finish transfer: begin", "transfer.id", t.ID, "error", err)
		return
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE transfers SET status = $1, failure_reason = NULLIF($2, ''),
		rail_reference = COALESCE(NULLIF($3, ''), rail_reference), skn_window_id = COALESCE(NULLIF($4, ''), skn_window_id),
		settled_at = now() WHERE id = $5 AND status = 'PROCESSING'`, status, reason, railRef, windowID, t.ID)
	if err != nil {
		slog.ErrorContext(ctx, "finish transfer: update", "transfer.id", t.ID, "error", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return // already terminal — settlement callbacks may repeat
	}
	ev := transferEvent{
		EventID: uuid.NewString(), EventType: "transfer.completed", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
		Producer: "nusabank-payment", TransferID: t.ID, CIF: t.cif, Rail: t.Rail, Status: status,
		SourceAccountNumber: t.SourceAccountNumber, DestinationBankCode: t.DestinationBankCode,
		DestinationAccountNumber: t.DestinationAccountNumber, DestinationBankName: t.DestinationBankName,
		SourceAccountName: t.sourceAccountName, DestinationAccountName: t.DestinationAccountName, Note: t.Note,
		Amount: t.Amount, Fee: t.Fee, HoldID: t.holdID,
	}
	outID, err := enqueue(ctx, tx, topicTransfer, t.ID, ev)
	if err != nil {
		slog.ErrorContext(ctx, "finish transfer: enqueue", "transfer.id", t.ID, "error", err)
		return
	}
	if err := tx.Commit(); err != nil {
		slog.ErrorContext(ctx, "finish transfer: commit", "transfer.id", t.ID, "error", err)
		return
	}
	s.outbox.publishNow(ctx, outID)

	tags := []string{"rail:" + strings.ToLower(t.Rail), "destination_bank:" + bankTag(t.DestinationBankCode), "status:" + strings.ToLower(status)}
	_ = s.metrics.Count("nusabank.transfer.count", 1, tags, 1)
	_ = s.metrics.Distribution("nusabank.transfer.amount", float64(t.amount), tags, 1)
	slog.InfoContext(ctx, "transfer finished", "transfer.id", t.ID, "rail", t.Rail, "status", status,
		"destination_bank", bankTag(t.DestinationBankCode), "amount", t.amount, "failure_reason", reason)
}

func (s *server) getTransfer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "transferId")
	if !reUUID.MatchString(id) {
		writeErr(w, r, errNotFound("Transfer tidak ditemukan"))
		return
	}
	t, err := s.loadTransfer(r.Context(), "id = $1", id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if t == nil || t.cif != claimsFrom(r.Context()).Sub {
		writeErr(w, r, errNotFound("Transfer tidak ditemukan"))
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *server) listTransfers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	size, _ := strconv.Atoi(q.Get("page_size"))
	page, size = max(page, 1), min(max(size, 1), 100)
	if q.Get("page_size") == "" {
		size = 20
	}
	status, railCode := q.Get("status"), q.Get("rail")
	cif := claimsFrom(r.Context()).Sub
	where := "cif = $1 AND ($2 = '' OR status = $2) AND ($3 = '' OR rail = $3)"
	var total int
	if err := s.db.QueryRowContext(r.Context(), "SELECT count(*) FROM transfers WHERE "+where, cif, status, railCode).Scan(&total); err != nil {
		writeErr(w, r, err)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), "SELECT "+transferColumns+" FROM transfers WHERE "+where+
		" ORDER BY created_at DESC LIMIT $4 OFFSET $5", cif, status, railCode, size, (page-1)*size)
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
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "page_size": size, "total": total})
}

// ---- beneficiaries ----

func (s *server) listBeneficiaries(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, bank_code, bank_name, account_number, account_name, COALESCE(alias, '')
		FROM beneficiaries WHERE cif = $1 ORDER BY created_at DESC`, claimsFrom(r.Context()).Sub)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var id, code, name, acct, holder, alias string
		if err := rows.Scan(&id, &code, &name, &acct, &holder, &alias); err != nil {
			writeErr(w, r, err)
			return
		}
		out = append(out, map[string]string{"id": id, "bank_code": code, "bank_name": name, "account_number": acct, "account_name": holder, "alias": alias})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) createBeneficiary(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BankCode      string `json:"bank_code"`
		AccountNumber string `json:"account_number"`
		Alias         string `json:"alias,omitempty"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	b, ok := findBank(req.BankCode)
	if !ok || !reExtAccount.MatchString(req.AccountNumber) || len(req.Alias) > 40 {
		writeErr(w, r, errBadRequest("a known bank_code, a 6-20 digit account_number and alias up to 40 characters are required"))
		return
	}
	name, err := s.resolveBeneficiary(r.Context(), b.Code, req.AccountNumber)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var id string
	err = s.db.QueryRowContext(r.Context(), `INSERT INTO beneficiaries (cif, bank_code, bank_name, account_number, account_name, alias)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,'')) ON CONFLICT (cif, bank_code, account_number)
		DO UPDATE SET alias = EXCLUDED.alias RETURNING id`,
		claimsFrom(r.Context()).Sub, b.Code, b.Name, req.AccountNumber, name, req.Alias).Scan(&id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "bank_code": b.Code, "bank_name": b.Name,
		"account_number": req.AccountNumber, "account_name": name, "alias": req.Alias})
}

// ---- SKN settlement callback (from the SKN rail) ----

func (s *server) sknSettlement(w http.ResponseWriter, r *http.Request) {
	var batch struct {
		WindowID  string    `json:"window_id"`
		SettledAt time.Time `json:"settled_at"`
		Items     []struct {
			RailReference string `json:"rail_reference"`
			Status        string `json:"status"`
			FailureReason string `json:"failure_reason,omitempty"`
		} `json:"items"`
	}
	if err := decode(r, &batch); err != nil {
		writeErr(w, r, err)
		return
	}
	spanOrNoop(r.Context()).SetTag("skn.window_id", batch.WindowID)
	settled := 0
	for _, it := range batch.Items {
		t, err := s.loadTransfer(r.Context(), "rail_reference = $1", it.RailReference)
		if err != nil {
			writeErr(w, r, err) // the rail retries the whole batch; finish() is idempotent
			return
		}
		if t == nil || t.Status != "PROCESSING" {
			continue
		}
		if it.Status == "SUCCESS" {
			s.finish(r.Context(), t, "SUCCESS", "", "", batch.WindowID)
		} else {
			s.finish(r.Context(), t, "FAILED", it.FailureReason, "", batch.WindowID)
		}
		settled++
	}
	slog.InfoContext(r.Context(), "SKN window applied", "window_id", batch.WindowID, "items", len(batch.Items), "settled", settled, "partner.name", partnerSKN)
	w.WriteHeader(http.StatusNoContent)
}
