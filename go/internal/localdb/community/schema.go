package community

import (
	"time"
)

// ContributionStatus defines the status lifecycle for a community contribution (AO-15).
type ContributionStatus string

const (
	StatusPending     ContributionStatus = "pending"
	StatusSanitizing  ContributionStatus = "sanitizing"
	StatusSanitized   ContributionStatus = "sanitized"
	StatusQuarantined ContributionStatus = "quarantined"
	StatusRejected    ContributionStatus = "rejected"
)

// DeliveryStatus defines the status lifecycle for a delivery attempt (AO-15).
type DeliveryStatus string

const (
	DeliveryEnqueued    DeliveryStatus = "enqueued"
	DeliverySending     DeliveryStatus = "sending"
	DeliverySucceeded   DeliveryStatus = "succeeded"
	DeliveryFailed      DeliveryStatus = "failed"
	DeliveryQuarantined DeliveryStatus = "quarantined"
)

// ItemState is an alias for backward compatibility.
type ItemState = ContributionStatus

const (
	StateDraft       ContributionStatus = "pending"
	StateQueued      ContributionStatus = "pending"
	StatePending     ContributionStatus = "pending"
	StateSanitizing  ContributionStatus = "sanitizing"
	StateApproved    ContributionStatus = "sanitized"
	StateSanitized   ContributionStatus = "sanitized"
	StateExporting   ContributionStatus = "sanitized"
	StateExported    ContributionStatus = "sanitized"
	StateDelivered   ContributionStatus = "sanitized"
	StateQuarantined ContributionStatus = "quarantined"
	StateRejected    ContributionStatus = "rejected"
	StateTombstoned  ContributionStatus = "rejected"
)

// ValidTransitions maps allowed state machine transitions for replay and crash safety.
var ValidTransitions = map[ContributionStatus][]ContributionStatus{
	StatusPending:     {StatusSanitizing, StatusQuarantined, StatusRejected},
	StatusSanitizing:  {StatusSanitized, StatusQuarantined, StatusRejected},
	StatusSanitized:   {StatusQuarantined, StatusRejected},
	StatusQuarantined: {StatusPending, StatusRejected},
	StatusRejected:    {}, // Terminal state
}

// ProductExportCandidate represents an AO-14 export candidate input for async ingestion.
type ProductExportCandidate struct {
	ID           string            `json:"id"`
	SourceType   string            `json:"source_type"`
	SourceID     string            `json:"source_id"`
	ExportFormat string            `json:"export_format"`
	ContentHash  string            `json:"content_hash"`
	Status       string            `json:"status"`
	RawPayload   string            `json:"raw_payload,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
	ExportedAt   *time.Time        `json:"exported_at,omitempty"`
}

// SanitizedContribution represents an entry in sanitized_contributions table (AO-15).
type SanitizedContribution struct {
	ID               string             `json:"id"`
	Source           string             `json:"source"`
	PayloadHash      string             `json:"payload_hash"`
	RawPayload       string             `json:"raw_payload"`
	SanitizedPayload *string            `json:"sanitized_payload,omitempty"`
	Status           ContributionStatus `json:"status"`
	QuarantineReason *string            `json:"quarantine_reason,omitempty"`
	CreatedAt        time.Time          `json:"created_at"`
	ProcessedAt      *time.Time         `json:"processed_at,omitempty"`

	// Convenience / compatibility metadata
	Seq           int64              `json:"seq,omitempty"`
	Title         string             `json:"title,omitempty"`
	AuthorRef     string             `json:"author_ref,omitempty"`
	PluginSlug    string             `json:"plugin_slug,omitempty"`
	Version       string             `json:"version,omitempty"`
	State         ContributionStatus `json:"state,omitempty"`
	Metadata      map[string]string  `json:"metadata,omitempty"`
	QuarantineRef *QuarantineRef     `json:"quarantine_ref,omitempty"`
	UpdatedAt     time.Time          `json:"updated_at,omitempty"`
}

// QueueItem is an alias to SanitizedContribution for compatibility.
type QueueItem = SanitizedContribution

// QuarantineRef records quarantine metadata without raw sensitive contents.
type QuarantineRef struct {
	Reason        string    `json:"reason"`
	ViolationCode string    `json:"violation_code,omitempty"`
	QuarantinedAt time.Time `json:"quarantined_at"`
}

// DeliveryAttempt records an at-least-once delivery attempt for a contribution (AO-15).
type DeliveryAttempt struct {
	ID                string         `json:"id"`
	ContributionID    string         `json:"contribution_id"`
	TargetDestination string         `json:"target_destination"`
	AttemptNumber     int            `json:"attempt_number"`
	Status            DeliveryStatus `json:"status"`
	Error             *string        `json:"error,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	CompletedAt       *time.Time     `json:"completed_at,omitempty"`

	// Compatibility aliases
	TargetEndpoint string    `json:"target_endpoint,omitempty"`
	ErrorMessage   string    `json:"error_message,omitempty"`
	AttemptedAt    time.Time `json:"attempted_at,omitempty"`
}

// PublicationReceipt records an immutable publication acknowledgment once delivered (AO-15).
type PublicationReceipt struct {
	ID             string            `json:"id"`
	ContributionID string            `json:"contribution_id"`
	ReceiptHash    string            `json:"receipt_hash"`
	PublishedTo    string            `json:"published_to"`
	Metadata       map[string]string `json:"metadata,omitempty"`
	PublishedAt    time.Time         `json:"published_at"`

	// Compatibility alias
	DeliveryID string `json:"delivery_id,omitempty"`
}

// RemovalReport captures an audit, withdrawal, or policy removal report on a contribution.
type RemovalReport struct {
	ID             string     `json:"id"`
	ContributionID string     `json:"contribution_id"`
	PluginSlug     string     `json:"plugin_slug"`
	Reason         string     `json:"reason"`
	ReporterRef    string     `json:"reporter_ref"`
	Status         string     `json:"status"` // pending | processed | dismissed
	ReportedAt     time.Time  `json:"reported_at"`
	ProcessedAt    *time.Time `json:"processed_at,omitempty"`
}

// SyncWatermark tracks stream ingestion and synchronization sequence progression.
type SyncWatermark struct {
	StreamID       string    `json:"stream_id"`
	LastSeq        int64     `json:"last_seq"`
	LastCheckpoint string    `json:"last_checkpoint"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Migration defines a versioned, checksummed DDL/DML step.
type Migration struct {
	Version  int
	Name     string
	SQL      string
	Checksum string
}
