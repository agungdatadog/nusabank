package main

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type inboundRequest struct {
	RailReference            string `json:"rail_reference"`
	Rail                     string `json:"rail"`
	SenderBankCode           string `json:"sender_bank_code"`
	SenderAccountNumber      string `json:"sender_account_number"`
	SenderName               string `json:"sender_name"`
	DestinationAccountNumber string `json:"destination_account_number"`
	Amount                   Money  `json:"amount"`
	Description              string `json:"description,omitempty"`
}

// inboundEvent matches catalog/openapi.yaml#/components/schemas/InboundTransferEvent.
type inboundEvent struct {
	EventID             string `json:"event_id"`
	EventType           string `json:"event_type"`
	OccurredAt          string `json:"occurred_at"`
	Producer            string `json:"producer"`
	TransferID          string `json:"transfer_id"`
	Rail                string `json:"rail"`
	AccountNumber       string `json:"account_number"`
	SenderBankName      string `json:"sender_bank_name"`
	SenderName          string `json:"sender_name"`
	SenderAccountNumber string `json:"sender_account_number"`
	Amount              Money  `json:"amount"`
	Description         string `json:"description,omitempty"`
}

// receiveInbound books a credit from another bank. Money only needs to land, so there
// is no hold: the event goes to the outbox and the ledger credits the customer.
func (s *server) receiveInbound(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req inboundRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, r, err)
		return
	}
	amount, ok := parseIDR(req.Amount.Amount)
	b, known := findBank(req.SenderBankCode)
	switch {
	case req.Rail != "BIFAST" && req.Rail != "SKN":
		writeErr(w, r, errBadRequest("rail must be BIFAST or SKN"))
		return
	case req.RailReference == "" || strings.TrimSpace(req.SenderName) == "":
		writeErr(w, r, errBadRequest("rail_reference and sender_name are required"))
		return
	case !known || !reExtAccount.MatchString(req.SenderAccountNumber) || !reAccount16.MatchString(req.DestinationAccountNumber):
		writeErr(w, r, errBadRequest("a known sender_bank_code, sender_account_number and a 16-digit destination are required"))
		return
	case !ok || req.Amount.Currency != "IDR" || amount <= 0 || amount > rails[req.Rail].MaxAmount:
		writeErr(w, r, errBadRequest("amount must be a positive whole IDR amount within the rail limit"))
		return
	}

	var existing string
	err := s.db.QueryRowContext(ctx, "SELECT id FROM inbound_transfers WHERE rail_reference = $1", req.RailReference).Scan(&existing)
	if err == nil {
		writeJSON(w, http.StatusCreated, map[string]string{"transfer_id": existing, "status": "SUCCESS"})
		return
	} else if !errors.Is(err, sql.ErrNoRows) {
		writeErr(w, r, err)
		return
	}
	dest, err := s.accounts.lookup(ctx, req.DestinationAccountNumber)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if dest == nil || dest.Status != "ACTIVE" || dest.Currency != "IDR" {
		writeErr(w, r, &apiError{status: http.StatusUnprocessableEntity, Code: "ACCOUNT_NOT_FOUND", Message: "Rekening tujuan tidak ditemukan"})
		return
	}

	id := uuid.NewString()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO inbound_transfers (id, rail, rail_reference, sender_bank_code, sender_bank_name,
		sender_account_number, sender_name, destination_account_number, amount, description)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''))`,
		id, req.Rail, req.RailReference, b.Code, b.Name, req.SenderAccountNumber, strings.ToUpper(req.SenderName),
		req.DestinationAccountNumber, amount, req.Description); err != nil {
		writeErr(w, r, err)
		return
	}
	outID, err := enqueue(ctx, tx, topicTransfer, id, inboundEvent{
		EventID: uuid.NewString(), EventType: "transfer.received", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
		Producer: "nusabank-payment", TransferID: id, Rail: req.Rail, AccountNumber: req.DestinationAccountNumber,
		SenderBankName: b.Name, SenderName: strings.ToUpper(req.SenderName), SenderAccountNumber: req.SenderAccountNumber,
		Amount: idr(amount), Description: req.Description,
	})
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, r, err)
		return
	}
	s.outbox.publishNow(ctx, outID)

	tags := []string{"rail:" + strings.ToLower(req.Rail), "source_bank:" + b.Short, "direction:inbound", "status:success"}
	_ = s.metrics.Count("nusabank.transfer.inbound.count", 1, tags, 1)
	_ = s.metrics.Distribution("nusabank.transfer.inbound.amount", float64(amount), tags, 1)
	slog.InfoContext(ctx, "inbound transfer received", "transfer.id", id, "rail", req.Rail, "source_bank", b.Short, "amount", amount)
	writeJSON(w, http.StatusCreated, map[string]string{"transfer_id": id, "status": "SUCCESS"})
}
