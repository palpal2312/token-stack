package scheduler

import (
	"testing"
	"time"
)

func TestCatchUpFiresOnceAcrossManyMissedIntervals(t *testing.T) {
	start := time.Date(2026, 8, 26, 0, 0, 0, 0, time.UTC)
	r := CatchUpRecord{LastSlot: start}
	due, ok := DueOnce(&r, start.Add(10*time.Hour), time.Hour)
	if !ok || !due.Equal(start.Add(time.Hour)) {
		t.Fatalf("first catchup = %v %v", due, ok)
	}
	if _, ok := DueOnce(&r, start.Add(10*time.Hour), time.Hour); ok {
		t.Fatal("catch-up replayed")
	}
}
