package main

import (
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
)

const partnerPPOB = "ppob"

type billerKind int

const (
	prepaid  billerKind = iota // customer picks the amount or a denomination
	postpaid                   // biller decides the amount due
)

type billerProfile struct {
	kind           billerKind
	minDue, maxDue int64 // IDR, postpaid only
}

// Billers reachable through the simulated aggregator. Codes match BillerCode
// examples in catalog/openapi.yaml.
var billers = map[string]billerProfile{
	"gopay": {kind: prepaid}, "ovo": {kind: prepaid}, "shopeepay": {kind: prepaid},
	"dana": {kind: prepaid}, "linkaja": {kind: prepaid},
	"telkomsel": {kind: prepaid}, "indosat": {kind: prepaid}, "xl": {kind: prepaid},
	"tri": {kind: prepaid}, "smartfren": {kind: prepaid},
	"indihome":       {kind: postpaid, minDue: 285_000, maxDue: 650_000},
	"biznet":         {kind: postpaid, minDue: 250_000, maxDue: 575_000},
	"firstmedia":     {kind: postpaid, minDue: 300_000, maxDue: 720_000},
	"pdam-jakarta":   {kind: postpaid, minDue: 65_000, maxDue: 380_000},
	"bpjs-kesehatan": {kind: postpaid, minDue: 35_000, maxDue: 525_000},
	// pln covers both prepaid tokens (with product_code) and postpaid bills (without).
	"pln": {kind: postpaid, minDue: 145_000, maxDue: 1_250_000},
}

type billInquiryRequest struct {
	BillerCode     string `json:"biller_code"`
	CustomerNumber string `json:"customer_number"`
	ProductCode    string `json:"product_code,omitempty"`
	Amount         *Money `json:"amount,omitempty"`
}

type billPaymentRequest struct {
	BillerCode     string `json:"biller_code"`
	CustomerNumber string `json:"customer_number"`
	ProductCode    string `json:"product_code,omitempty"`
	Amount         Money  `json:"amount"`
	Reference      string `json:"reference"`
}

func ppobInquiry(sc *scenarioStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tagPartner(r, partnerPPOB)
		var req billInquiryRequest
		if err := decode(r, &req); err != nil || !reCustomerNo.MatchString(req.CustomerNumber) {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "biller_code and customer_number (6-20 digits) are required", partnerPPOB)
			return
		}
		profile, known := billers[req.BillerCode]
		if !known {
			writeError(w, r, http.StatusBadRequest, "UNKNOWN_BILLER", "biller "+req.BillerCode+" is not available", partnerPPOB)
			return
		}
		if sc.inject(w, r, partnerPPOB, req.BillerCode) {
			return
		}
		naturalLatency(r.Context(), 150, 550)
		if isClosedAccount(req.CustomerNumber) {
			writeError(w, r, http.StatusNotFound, "CUSTOMER_NOT_FOUND", "Nomor pelanggan tidak terdaftar", "ppob:"+req.BillerCode)
			return
		}

		var due Money
		switch {
		case req.Amount != nil:
			if !req.Amount.valid() || req.Amount.Currency != "IDR" {
				writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be a valid IDR amount", partnerPPOB)
				return
			}
			due = *req.Amount
		case profile.kind == postpaid && req.ProductCode == "":
			due = Money{Amount: strconv.FormatInt(inRange(profile.minDue, profile.maxDue, 500, req.BillerCode, req.CustomerNumber), 10), Currency: "IDR"}
		default:
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "amount is required for top-ups and denominated products", partnerPPOB)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"customer_name":    personName(req.BillerCode, req.CustomerNumber),
			"amount_due":       due,
			"biller_reference": fmt.Sprintf("INQ%012d", rand.Int64N(1e12)),
		})
	}
}

func ppobPayment(sc *scenarioStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tagPartner(r, partnerPPOB)
		var req billPaymentRequest
		if err := decode(r, &req); err != nil || !reCustomerNo.MatchString(req.CustomerNumber) || req.Reference == "" {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "biller_code, customer_number, amount and reference are required", partnerPPOB)
			return
		}
		if _, known := billers[req.BillerCode]; !known {
			writeError(w, r, http.StatusBadRequest, "UNKNOWN_BILLER", "biller "+req.BillerCode+" is not available", partnerPPOB)
			return
		}
		if !req.Amount.valid() || req.Amount.Currency != "IDR" {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be a valid IDR amount", partnerPPOB)
			return
		}
		if sc.inject(w, r, partnerPPOB, req.BillerCode) {
			return
		}
		naturalLatency(r.Context(), 200, 650)

		resp := map[string]any{"biller_reference": fmt.Sprintf("PAY%012d", rand.Int64N(1e12))}
		if req.BillerCode == "pln" && req.ProductCode != "" {
			resp["token"] = plnToken()
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// plnToken renders a 20-digit prepaid token in the familiar 4-digit groups.
func plnToken() string {
	var groups []string
	for range 5 {
		groups = append(groups, fmt.Sprintf("%04d", rand.IntN(10000)))
	}
	return strings.Join(groups, "-")
}
