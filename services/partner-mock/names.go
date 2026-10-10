package main

import (
	"fmt"
	"hash/fnv"
	"math/rand/v2"
	"strings"
	"time"
)

// Deterministic synthetic identities: the same account or customer number always
// resolves to the same name, so inquiry and payment screens stay consistent.
var (
	firstNames = []string{
		"Siti", "Budi", "Dewi", "Agus", "Rina", "Ahmad", "Putri", "Hendra", "Ayu", "Rizky",
		"Wulan", "Fajar", "Nur", "Dimas", "Indah", "Yusuf", "Lestari", "Bayu", "Ratna", "Eko",
		"Maya", "Andi", "Fitri", "Gilang", "Sari", "Teguh", "Melati", "Rudi", "Anisa", "Joko",
	}
	lastNames = []string{
		"Rahmawati", "Santoso", "Wijaya", "Pratama", "Hidayat", "Saputra", "Kusuma", "Nugroho",
		"Setiawan", "Siregar", "Lubis", "Nasution", "Harahap", "Wibowo", "Susanto", "Gunawan",
		"Halim", "Purnomo", "Utami", "Hakim", "Simanjuntak", "Tanjung", "Permana", "Firmansyah",
	}
)

func hash64(parts ...string) uint64 {
	h := fnv.New64a()
	for _, p := range parts {
		_, _ = h.Write([]byte(p))
		_, _ = h.Write([]byte{0})
	}
	return h.Sum64()
}

// personName returns an uppercase "FIRST LAST" name, as banks print beneficiary names.
func personName(seed ...string) string {
	h := hash64(seed...)
	first := firstNames[h%uint64(len(firstNames))]
	last := lastNames[(h/97)%uint64(len(lastNames))]
	return strings.ToUpper(first + " " + last)
}

// inRange maps a seed deterministically into [lo, hi], rounded to `step`.
func inRange(lo, hi, step int64, seed ...string) int64 {
	h := hash64(seed...)
	v := lo + int64(h%uint64(hi-lo+1))
	return v / step * step
}

// isClosedAccount marks a stable slice of numbers as closed/unknown so demos can
// show realistic business rejections without any failure scenario switched on.
func isClosedAccount(number string) bool {
	return strings.HasSuffix(number, "0000")
}

var wib = time.FixedZone("WIB", 7*3600)

// railReference looks like a clearing reference: PREFIX + date (WIB) + 10 digits.
func railReference(prefix string, now time.Time) string {
	return fmt.Sprintf("%s%s%010d", prefix, now.In(wib).Format("20060102"), rand.Int64N(1e10))
}
