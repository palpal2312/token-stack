package scheduler

import "time"

// CatchUpRecord is persisted by the caller; LastSlot is the durable idempotency fence.
type CatchUpRecord struct{ LastSlot time.Time }

// DueOnce returns at most one missed slot and advances the durable fence to now.
func DueOnce(record *CatchUpRecord, now time.Time, interval time.Duration) (time.Time, bool) {
	if interval <= 0 || record.LastSlot.IsZero() || now.Before(record.LastSlot.Add(interval)) {
		return time.Time{}, false
	}
	due := record.LastSlot.Add(interval)
	record.LastSlot = now.UTC()
	return due, true
}
