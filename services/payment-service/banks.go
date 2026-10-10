package main

import (
	"math/big"
	"strings"
)

// nusaBankCode is Nusa Bank's own (fictional) bank code; transfers to it go INTRABANK.
const nusaBankCode = "899"

type rail struct {
	Code      string
	Name      string
	Fee       int64 // IDR
	MaxAmount int64 // IDR
}

// Fees and per-transaction limits as Indonesian customers know them: BI FAST caps at
// Rp250 juta, SKN at Rp1 miliar.
var rails = map[string]rail{
	"INTRABANK": {Code: "INTRABANK", Name: "Transfer Sesama Nusa Bank", Fee: 0, MaxAmount: 500_000_000},
	"BIFAST":    {Code: "BIFAST", Name: "BI FAST", Fee: 2_500, MaxAmount: 250_000_000},
	"SKN":       {Code: "SKN", Name: "SKN", Fee: 2_900, MaxAmount: 1_000_000_000},
}

type bank struct {
	Code  string   `json:"code"`
	Name  string   `json:"name"`
	Short string   `json:"-"` // metric tag value
	Rails []string `json:"rails"`
}

var banks = []bank{
	{nusaBankCode, "Nusa Bank", "nusabank", []string{"INTRABANK"}},
	{"014", "Bank Central Asia (BCA)", "bca", []string{"BIFAST", "SKN"}},
	{"008", "Bank Mandiri", "mandiri", []string{"BIFAST", "SKN"}},
	{"002", "Bank Rakyat Indonesia (BRI)", "bri", []string{"BIFAST", "SKN"}},
	{"009", "Bank Negara Indonesia (BNI)", "bni", []string{"BIFAST", "SKN"}},
	{"022", "CIMB Niaga", "cimb", []string{"BIFAST", "SKN"}},
	{"451", "Bank Syariah Indonesia (BSI)", "bsi", []string{"BIFAST", "SKN"}},
	{"013", "Bank Permata", "permata", []string{"BIFAST", "SKN"}},
	{"011", "Bank Danamon", "danamon", []string{"BIFAST", "SKN"}},
	{"200", "Bank Tabungan Negara (BTN)", "btn", []string{"BIFAST", "SKN"}},
	{"016", "Maybank Indonesia", "maybank", []string{"BIFAST", "SKN"}},
	{"028", "OCBC Indonesia", "ocbc", []string{"BIFAST", "SKN"}},
	{"019", "Panin Bank", "panin", []string{"BIFAST", "SKN"}},
	{"542", "Bank Jago", "jago", []string{"BIFAST"}},
	{"535", "SeaBank Indonesia", "seabank", []string{"BIFAST"}},
}

func findBank(code string) (bank, bool) {
	for _, b := range banks {
		if b.Code == code {
			return b, true
		}
	}
	return bank{}, false
}

func (b bank) supports(railCode string) bool {
	for _, r := range b.Rails {
		if r == railCode {
			return true
		}
	}
	return false
}

// parseIDR accepts the Money decimal-string format and returns whole rupiah.
func parseIDR(amount string) (int64, bool) {
	if !reAmount.MatchString(amount) {
		return 0, false
	}
	r, ok := new(big.Rat).SetString(amount)
	if !ok || !r.IsInt() {
		return 0, false // rupiah has no fraction
	}
	return r.Num().Int64(), true
}

func bankTag(code string) string {
	if b, ok := findBank(code); ok {
		return b.Short
	}
	return strings.ToLower(code)
}
