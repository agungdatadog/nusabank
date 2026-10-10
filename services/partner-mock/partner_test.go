package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCatalogStartsDisabled(t *testing.T) {
	for _, sc := range newScenarioStore().snapshot() {
		if sc.Enabled {
			t.Fatalf("scenario %s enabled by default — baseline must be healthy", sc.ID)
		}
	}
}

func TestEnableWithoutExpiryGetsDefaultTTL(t *testing.T) {
	s := newScenarioStore()
	now := time.Date(2026, 10, 29, 10, 0, 0, 0, wib)
	s.now = func() time.Time { return now }
	saved, err := s.set(Scenario{ID: "bifast-timeout", Target: "bifast", Enabled: true, LatencyMS: 8000})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ExpiresAt == nil || !saved.ExpiresAt.Equal(now.Add(defaultScenarioTTL)) {
		t.Fatalf("expected default TTL, got %v", saved.ExpiresAt)
	}
	now = now.Add(defaultScenarioTTL)
	if got := s.active("bifast", ""); len(got) != 0 {
		t.Fatalf("expired scenario still active: %+v", got)
	}
}

func TestPPOBScenarioScopedToBiller(t *testing.T) {
	s := newScenarioStore()
	if _, err := s.set(Scenario{ID: "ppob-gopay-errors", Target: "ppob", BillerCode: "gopay", Enabled: true, ErrorRate: 1}); err != nil {
		t.Fatal(err)
	}
	if len(s.active("ppob", "gopay")) != 1 || len(s.active("ppob", "ovo")) != 0 {
		t.Fatal("biller-scoped scenario must only affect its biller")
	}
}

func TestRejectsInvalidScenario(t *testing.T) {
	s := newScenarioStore()
	for _, sc := range []Scenario{
		{ID: "x", Target: "swift"},
		{ID: "x", Target: "bifast", ErrorRate: 1.5},
		{ID: "x", Target: "bifast", BillerCode: "gopay"},
		{ID: "x", Target: "bifast", ErrorStatus: 418},
	} {
		if _, err := s.set(sc); err == nil {
			t.Fatalf("expected rejection for %+v", sc)
		}
	}
}

func TestNextWindowRespectsCutoff(t *testing.T) {
	at := func(h, m int) time.Time { return time.Date(2026, 10, 29, h, m, 0, 0, wib) }
	cases := []struct{ now, want time.Time }{
		{at(14, 20), at(14, 30)},
		{at(14, 28).Add(30 * time.Second), at(14, 45)}, // inside the 2-minute cut-off
		{at(14, 30), at(14, 45)},
		{at(23, 59), at(0, 15).AddDate(0, 0, 1)},
	}
	for _, c := range cases {
		if got := nextWindow(c.now, 15, 2); !got.Equal(c.want) {
			t.Errorf("nextWindow(%v) = %v, want %v", c.now, got, c.want)
		}
	}
	if id := windowID(at(14, 30)); id != "SKN-20261029-1430" {
		t.Errorf("windowID = %s", id)
	}
}

func TestSKNBackoffIsBounded(t *testing.T) {
	if got := sknBackoff(1); got != 20*time.Second {
		t.Errorf("first retry = %v", got)
	}
	if got := sknBackoff(50); got != sknMaxBackoff {
		t.Errorf("backoff not capped: %v", got)
	}
}

func TestDeterministicIdentity(t *testing.T) {
	a, b := personName("014", "0812345678"), personName("014", "0812345678")
	if a != b || a == "" {
		t.Fatalf("names must be stable: %q vs %q", a, b)
	}
	if v := inRange(145_000, 1_250_000, 500, "pln", "532110987654"); v < 145_000 || v > 1_250_000 || v%500 != 0 {
		t.Fatalf("inRange out of bounds: %d", v)
	}
}

func TestBIFASTInquiry(t *testing.T) {
	h := bifastAccountInquiry(newScenarioStore())
	call := func(acct string) int {
		body, _ := json.Marshal(map[string]string{"bank_code": "014", "account_number": acct})
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/bifast/v1/account-inquiry", bytes.NewReader(body)))
		return rec.Code
	}
	if c := call("0812345678"); c != http.StatusOK {
		t.Fatalf("open account: got %d", c)
	}
	if c := call("0812340000"); c != http.StatusNotFound {
		t.Fatalf("closed account: got %d", c)
	}
	if c := call("12"); c != http.StatusBadRequest {
		t.Fatalf("malformed account: got %d", c)
	}
}

func TestInjectedErrorNamesPartner(t *testing.T) {
	s := newScenarioStore()
	if _, err := s.set(Scenario{ID: "ppob-gopay-errors", Target: "ppob", BillerCode: "gopay", Enabled: true, ErrorRate: 1}); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"biller_code": "gopay", "customer_number": "081298765432", "amount": Money{"100000", "IDR"}})
	rec := httptest.NewRecorder()
	ppobInquiry(s)(rec, httptest.NewRequest(http.MethodPost, "/ppob/v1/inquiry", bytes.NewReader(body)))
	var e apiError
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	if rec.Code != http.StatusServiceUnavailable || e.Partner != "ppob:gopay" {
		t.Fatalf("got %d partner=%q", rec.Code, e.Partner)
	}
}
