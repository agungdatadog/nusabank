package main

import (
	"net/http"
	"strconv"
	"time"
)

const partnerCreditBureau = "credit-bureau"

type creditCheckRequest struct {
	NIK             string `json:"nik"`
	RequestedAmount Money  `json:"requested_amount"`
}

func creditGrade(score int64) string {
	switch {
	case score >= 750:
		return "A"
	case score >= 680:
		return "B"
	case score >= 600:
		return "C"
	case score >= 500:
		return "D"
	default:
		return "E"
	}
}

func creditBureauCheck(sc *scenarioStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tagPartner(r, partnerCreditBureau)
		var req creditCheckRequest
		if err := decode(r, &req); err != nil || !reNIK.MatchString(req.NIK) || !req.RequestedAmount.valid() {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "nik (16 digits) and requested_amount are required", partnerCreditBureau)
			return
		}
		if sc.inject(w, r, partnerCreditBureau, "") {
			return
		}
		// Bureau lookups are slow even when healthy — part of why loan decisions are async.
		naturalLatency(r.Context(), 600, 1400)

		// Most applicants land in B–C, with tails both ways, keyed on NIK.
		score := (inRange(420, 860, 1, req.NIK, "a") + inRange(560, 800, 1, req.NIK, "b")) / 2
		obligations := inRange(0, 6_000_000, 50_000, req.NIK, "obligations")
		writeJSON(w, http.StatusOK, map[string]any{
			"score":                        score,
			"grade":                        creditGrade(score),
			"existing_monthly_obligations": Money{Amount: strconv.FormatInt(obligations, 10), Currency: "IDR"},
			"checked_at":                   time.Now().UTC(),
		})
	}
}
