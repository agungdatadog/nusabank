package main

import (
	"context"
	"encoding/json"
	"math/rand/v2"
	"net/http"
	"regexp"
	"time"

	"github.com/DataDog/dd-trace-go/v2/ddtrace/tracer"
)

var (
	reBankCode   = regexp.MustCompile(`^\d{3}$`)
	reAccount16  = regexp.MustCompile(`^\d{16}$`)
	reExtAccount = regexp.MustCompile(`^\d{6,20}$`)
	reNIK        = regexp.MustCompile(`^\d{16}$`)
	reAmount     = regexp.MustCompile(`^\d+(\.\d{1,2})?$`)
	reCustomerNo = regexp.MustCompile(`^\d{6,20}$`)
)

// Money matches catalog/openapi.yaml#/components/schemas/Money.
type Money struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

func (m Money) valid() bool {
	return reAmount.MatchString(m.Amount) && (m.Currency == "IDR" || m.Currency == "USD" || m.Currency == "JPY")
}

// apiError matches catalog/openapi.yaml#/components/schemas/Error.
type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Partner string `json:"partner,omitempty"`
	TraceID string `json:"trace_id,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, msg, partner string) {
	e := apiError{Code: code, Message: msg, Partner: partner}
	if span, ok := tracer.SpanFromContext(r.Context()); ok {
		e.TraceID = span.Context().TraceID()
	}
	writeJSON(w, status, e)
}

// decode rejects unknown fields so contract drift surfaces as a 400, not silent data loss.
func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// tagPartner names the simulated partner on the active span, so EP2 root-cause
// views show which external party a request hit.
func tagPartner(r *http.Request, partner string) {
	if span, ok := tracer.SpanFromContext(r.Context()); ok {
		span.SetTag("partner.name", partner)
	}
}

// naturalLatency sleeps for a realistic, jittered partner response time.
func naturalLatency(ctx context.Context, minMS, maxMS int) {
	d := time.Duration(minMS+rand.IntN(maxMS-minMS+1)) * time.Millisecond
	select {
	case <-time.After(d):
	case <-ctx.Done():
	}
}
