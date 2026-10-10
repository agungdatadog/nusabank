package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"testing"
	"time"
)

func token(secret, alg string, exp int64) string {
	enc := base64.RawURLEncoding
	h := enc.EncodeToString([]byte(`{"alg":"` + alg + `","typ":"JWT"}`))
	p := enc.EncodeToString([]byte(fmt.Sprintf(`{"sub":"1024307295","segment":"REGULAR","aud":"nusabank","exp":%d}`, exp)))
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(h + "." + p))
	return h + "." + p + "." + enc.EncodeToString(m.Sum(nil))
}

func TestVerifyJWT(t *testing.T) {
	secret := []byte("test-secret-not-used-anywhere")
	future := time.Now().Add(time.Minute).Unix()
	if c, ok := verifyJWT(token(string(secret), "HS256", future), secret); !ok || c.Sub != "1024307295" {
		t.Fatal("valid token rejected")
	}
	for name, tok := range map[string]string{
		"wrong secret": token("other", "HS256", future),
		"expired":      token(string(secret), "HS256", 1),
		"alg none":     token(string(secret), "none", future),
		"garbage":      "a.b.c",
	} {
		if _, ok := verifyJWT(tok, secret); ok {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestParseIDR(t *testing.T) {
	cases := map[string]struct {
		v  int64
		ok bool
	}{"1500000": {1500000, true}, "250000000": {250000000, true}, "100.50": {0, false}, "-5": {0, false}, "abc": {0, false}}
	for in, want := range cases {
		if v, ok := parseIDR(in); v != want.v || ok != want.ok {
			t.Errorf("parseIDR(%q) = %d,%v", in, v, ok)
		}
	}
}

func TestRailLimitsAndBanks(t *testing.T) {
	if rails["BIFAST"].MaxAmount != 250_000_000 || rails["SKN"].MaxAmount != 1_000_000_000 {
		t.Fatal("rail limits drifted from the published BI FAST / SKN caps")
	}
	bca, _ := findBank("014")
	if !bca.supports("BIFAST") || bca.supports("INTRABANK") {
		t.Fatal("BCA must take BI FAST and not intrabank")
	}
	if nusa, _ := findBank(nusaBankCode); !nusa.supports("INTRABANK") {
		t.Fatal("Nusa Bank must take intrabank")
	}
}

func TestNextSKNWindow(t *testing.T) {
	at := func(h, m int) time.Time { return time.Date(2026, 10, 29, h, m, 0, 0, wib) }
	if got := nextSKNWindow(at(14, 20)); !got.Equal(at(14, 30)) {
		t.Errorf("got %v", got.In(wib))
	}
	if got := nextSKNWindow(at(14, 29)); !got.Equal(at(14, 45)) {
		t.Errorf("cut-off not applied: %v", got.In(wib))
	}
}
