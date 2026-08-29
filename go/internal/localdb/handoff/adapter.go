package handoff

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"agentic-os/internal/localdb/community"
	"agentic-os/internal/localdb/product"
)

// HandoffPayload holds caller-supplied raw payload and metadata for an export candidate.
type HandoffPayload struct {
	RawPayload string
	Metadata   map[string]string
}

// Result describes the outcome of processing an export candidate across the bridge.
type Result struct {
	CandidateID string
	Status      string // "exported" or "quarantined"
	Item        *community.SanitizedContribution
}

// IngestAndAcknowledge executes the sequential async bridge for a single product export candidate:
// 1. Ingests candidate into community queue (community.IngestExportCandidate).
// 2. Based on community item status (quarantined vs sanitized/pending/other), acknowledges product candidate (product.AcknowledgeExportCandidate).
//
// Invariants:
// - Never holds or opens transactions across both databases.
// - Queue failure leaves product candidate pending (returns error without calling acknowledge).
// - Quarantined community result acknowledges product as "quarantined".
// - Durable accepted community result acknowledges product as "exported" with UTC timestamp.
// - Crash after queue enqueue before ack must replay idempotently.
func IngestAndAcknowledge(ctx context.Context, productDB *sql.DB, commStore *community.SQLiteCommunityStore, candidate product.ExportCandidate, payload HandoffPayload) (*Result, error) {
	if productDB == nil {
		return nil, errors.New("product database connection is required")
	}
	if commStore == nil {
		return nil, errors.New("community store is required")
	}
	if candidate.ID == "" || candidate.SourceType == "" || candidate.SourceID == "" || candidate.ExportFormat == "" || candidate.ContentHash == "" {
		return nil, errors.New("complete export candidate is required")
	}

	prodCandidate := community.ProductExportCandidate{
		ID:           candidate.ID,
		SourceType:   candidate.SourceType,
		SourceID:     candidate.SourceID,
		ExportFormat: candidate.ExportFormat,
		ContentHash:  candidate.ContentHash,
		Status:       candidate.Status,
		RawPayload:   payload.RawPayload,
		Metadata:     payload.Metadata,
		CreatedAt:    candidate.CreatedAt,
		ExportedAt:   candidate.ExportedAt,
	}

	// Step 1: Ingest into community queue
	item, err := commStore.IngestExportCandidate(ctx, prodCandidate)
	if err != nil {
		// Queue failure leaves product pending
		return nil, fmt.Errorf("community queue ingestion failed: %w", err)
	}

	// Step 2: Determine terminal acknowledgement based on community status
	ack := product.ExportAcknowledgement{
		ID:           candidate.ID,
		SourceType:   candidate.SourceType,
		SourceID:     candidate.SourceID,
		ExportFormat: candidate.ExportFormat,
		ContentHash:  candidate.ContentHash,
	}

	var resStatus string
	if item.Status == community.StatusQuarantined {
		ack.Status = "quarantined"
		resStatus = "quarantined"
	} else {
		ack.Status = "exported"
		resStatus = "exported"

		// If candidate was already acknowledged as exported in product DB, preserve existing exported_at for idempotent replay
		var existingStatus string
		var existingExported sql.NullString
		err := productDB.QueryRowContext(ctx, "SELECT status, exported_at FROM export_candidates WHERE id = ?", candidate.ID).Scan(&existingStatus, &existingExported)
		if err == nil && existingStatus == "exported" && existingExported.Valid {
			if t, parseErr := time.Parse("2006-01-02T15:04:05.000Z", existingExported.String); parseErr == nil {
				ack.ExportedAt = &t
			}
		}
		if ack.ExportedAt == nil {
			now := time.Now().UTC()
			ack.ExportedAt = &now
		}
	}

	// Step 3: Acknowledge in product DB (isolated operation)
	if err := product.AcknowledgeExportCandidate(ctx, productDB, ack); err != nil {
		return nil, fmt.Errorf("product candidate acknowledgement failed: %w", err)
	}

	return &Result{
		CandidateID: candidate.ID,
		Status:      resStatus,
		Item:        item,
	}, nil
}

// ProcessPendingBridge processes up to limit pending product export candidates sequentially.
// If payloadLookup is provided, it supplies the raw payload & metadata for each candidate.
func ProcessPendingBridge(ctx context.Context, productDB *sql.DB, commStore *community.SQLiteCommunityStore, limit int, payloadLookup func(candidate product.ExportCandidate) HandoffPayload) ([]Result, error) {
	if productDB == nil {
		return nil, errors.New("product database connection is required")
	}
	if commStore == nil {
		return nil, errors.New("community store is required")
	}
	if limit <= 0 {
		return nil, errors.New("positive limit is required")
	}

	pending, err := product.ListPendingExportCandidates(ctx, productDB, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending export candidates: %w", err)
	}

	var results []Result
	for _, cand := range pending {
		var payload HandoffPayload
		if payloadLookup != nil {
			payload = payloadLookup(cand)
		}
		res, err := IngestAndAcknowledge(ctx, productDB, commStore, cand, payload)
		if err != nil {
			return results, fmt.Errorf("bridge processing candidate %s failed: %w", cand.ID, err)
		}
		results = append(results, *res)
	}

	return results, nil
}
