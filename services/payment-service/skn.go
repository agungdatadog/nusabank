package main

import "time"

// Mirrors partner-mock's clearing schedule (SKN_WINDOW_MINUTES there) so the app can
// tell customers when an SKN transfer will land. The rail remains the source of truth.
const (
	sknWindowMinutes = 15
	sknCutoff        = 2 * time.Minute
)

var wib = time.FixedZone("WIB", 7*3600)

func nextSKNWindow(t time.Time) time.Time {
	local := t.In(wib)
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, wib)
	step := time.Duration(sknWindowMinutes) * time.Minute
	boundary := midnight.Add((local.Sub(midnight)/step + 1) * step)
	if boundary.Sub(local) < sknCutoff {
		boundary = boundary.Add(step)
	}
	return boundary.UTC()
}
