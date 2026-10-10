package main

import (
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const partnerFX = "fx"

// fxFeed random-walks mid rates within a narrow band around plausible IDR levels,
// so dashboards show live-looking rates without ever drifting into nonsense.
type fxFeed struct {
	mu   sync.Mutex
	mid  map[string]float64
	base map[string]float64
	last time.Time
}

func newFXFeed() *fxFeed {
	base := map[string]float64{"USD": 16285, "JPY": 108.4}
	mid := map[string]float64{}
	for k, v := range base {
		mid[k] = v
	}
	return &fxFeed{mid: mid, base: base}
}

func (f *fxFeed) tick(now time.Time) {
	if now.Sub(f.last) < time.Minute {
		return
	}
	f.last = now
	for ccy, b := range f.base {
		next := f.mid[ccy] * (1 + (rand.Float64()-0.5)*0.002)
		f.mid[ccy] = min(max(next, b*0.985), b*1.015)
	}
}

type fxRate struct {
	Currency string `json:"currency"`
	Buy      string `json:"buy"`
	Sell     string `json:"sell"`
}

func (f *fxFeed) rates(sc *scenarioStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tagPartner(r, partnerFX)
		if sc.inject(w, r, partnerFX, "") {
			return
		}
		naturalLatency(r.Context(), 20, 80)

		now := time.Now().UTC()
		f.mu.Lock()
		f.tick(now)
		out := make([]fxRate, 0, 2)
		for _, ccy := range []string{"USD", "JPY"} {
			m := f.mid[ccy]
			out = append(out, fxRate{
				Currency: ccy,
				Buy:      strconv.FormatFloat(m*0.994, 'f', 2, 64),
				Sell:     strconv.FormatFloat(m*1.006, 'f', 2, 64),
			})
		}
		f.mu.Unlock()

		writeJSON(w, http.StatusOK, map[string]any{"base": "IDR", "as_of": now, "rates": out})
	}
}
