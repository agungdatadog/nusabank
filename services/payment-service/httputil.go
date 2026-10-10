package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/DataDog/dd-trace-go/v2/ddtrace/tracer"
)

var (
	reAmount     = regexp.MustCompile(`^\d+(\.\d{1,2})?$`)
	reBankCode   = regexp.MustCompile(`^\d{3}$`)
	reAccount16  = regexp.MustCompile(`^\d{16}$`)
	reExtAccount = regexp.MustCompile(`^\d{6,20}$`)
	reUUID       = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

type Money struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

func idr(v int64) Money { return Money{Amount: strconv.FormatInt(v, 10), Currency: "IDR"} }

type apiError struct {
	status  int
	Code    string `json:"code"`
	Message string `json:"message"`
	Partner string `json:"partner,omitempty"`
	TraceID string `json:"trace_id,omitempty"`
}

func (e *apiError) Error() string { return e.Code + ": " + e.Message }

func errBadRequest(msg string) *apiError {
	return &apiError{status: http.StatusBadRequest, Code: "VALIDATION_ERROR", Message: msg}
}

func errUnauthorized() *apiError {
	return &apiError{status: http.StatusUnauthorized, Code: "UNAUTHORIZED", Message: "Sesi tidak valid, silakan login kembali"}
}

func errNotFound(msg string) *apiError {
	return &apiError{status: http.StatusNotFound, Code: "NOT_FOUND", Message: msg}
}

// errPartner names the downstream that failed — in the body, the log and the span —
// which is what EP2's root-cause narrative follows.
func errPartner(status int, code, msg, partner string) *apiError {
	return &apiError{status: status, Code: code, Message: msg, Partner: partner}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, r *http.Request, err error) {
	e, ok := err.(*apiError)
	if !ok {
		e = &apiError{status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "Terjadi kesalahan, silakan coba lagi"}
	}
	if span, ok := tracer.SpanFromContext(r.Context()); ok {
		e.TraceID = span.Context().TraceID()
		if e.Partner != "" {
			span.SetTag("error.partner", e.Partner)
		}
	}
	writeJSON(w, e.status, e)
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errBadRequest("invalid request body: " + err.Error())
	}
	return nil
}

// Claims mirrors services/auth-service/src/jwt.ts — sub is the CIF.
type Claims struct {
	Sub     string `json:"sub"`
	Name    string `json:"name"`
	Segment string `json:"segment"`
	Role    string `json:"role"`
	Aud     string `json:"aud"`
	Exp     int64  `json:"exp"`
}

func verifyJWT(token string, secret []byte) (*Claims, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, false
	}
	var header struct {
		Alg string `json:"alg"`
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(hb, &header) != nil || header.Alg != "HS256" {
		return nil, false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, false
	}
	pb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var c Claims
	if json.Unmarshal(pb, &c) != nil || c.Aud != "nusabank" || c.Exp <= time.Now().Unix() || c.Sub == "" {
		return nil, false
	}
	return &c, true
}
