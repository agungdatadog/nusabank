package main

import (
	"net/http"
	"time"
)

const partnerBIFAST = "bifast"

type accountInquiryRequest struct {
	BankCode      string `json:"bank_code"`
	AccountNumber string `json:"account_number"`
}

// RailTransferRequest matches catalog/openapi.yaml#/components/schemas/RailTransferRequest.
type RailTransferRequest struct {
	Reference                string `json:"reference"`
	SourceBankCode           string `json:"source_bank_code"`
	SourceAccountNumber      string `json:"source_account_number"`
	SourceAccountName        string `json:"source_account_name"`
	DestinationBankCode      string `json:"destination_bank_code"`
	DestinationAccountNumber string `json:"destination_account_number"`
	Amount                   Money  `json:"amount"`
	Note                     string `json:"note,omitempty"`
}

func (t RailTransferRequest) validate() string {
	switch {
	case t.Reference == "":
		return "reference is required"
	case !reBankCode.MatchString(t.SourceBankCode) || !reBankCode.MatchString(t.DestinationBankCode):
		return "bank codes must be 3 digits"
	case !reAccount16.MatchString(t.SourceAccountNumber):
		return "source_account_number must be 16 digits"
	case !reExtAccount.MatchString(t.DestinationAccountNumber):
		return "destination_account_number must be 6-20 digits"
	case t.SourceAccountName == "":
		return "source_account_name is required"
	case !t.Amount.valid() || t.Amount.Currency != "IDR":
		return "amount must be a valid IDR amount"
	}
	return ""
}

func bifastAccountInquiry(sc *scenarioStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tagPartner(r, partnerBIFAST)
		var req accountInquiryRequest
		if err := decode(r, &req); err != nil || !reBankCode.MatchString(req.BankCode) || !reExtAccount.MatchString(req.AccountNumber) {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "bank_code (3 digits) and account_number (6-20 digits) are required", partnerBIFAST)
			return
		}
		if sc.inject(w, r, partnerBIFAST, "") {
			return
		}
		naturalLatency(r.Context(), 80, 250)
		if isClosedAccount(req.AccountNumber) {
			writeError(w, r, http.StatusNotFound, "ACCOUNT_NOT_FOUND", "Rekening tujuan tidak ditemukan", partnerBIFAST)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"account_name": personName(req.BankCode, req.AccountNumber)})
	}
}

func bifastCreditTransfer(sc *scenarioStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tagPartner(r, partnerBIFAST)
		var req RailTransferRequest
		if err := decode(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid transfer body: "+err.Error(), partnerBIFAST)
			return
		}
		if msg := req.validate(); msg != "" {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", msg, partnerBIFAST)
			return
		}
		if sc.inject(w, r, partnerBIFAST, "") {
			return
		}
		naturalLatency(r.Context(), 150, 450)
		if isClosedAccount(req.DestinationAccountNumber) {
			writeError(w, r, http.StatusUnprocessableEntity, "REJECTED_BY_BENEFICIARY_BANK", "Rekening tujuan tidak aktif", partnerBIFAST)
			return
		}
		now := time.Now().UTC()
		writeJSON(w, http.StatusOK, map[string]any{
			"rail_reference": railReference("BIFAST", now),
			"settled_at":     now,
		})
	}
}
