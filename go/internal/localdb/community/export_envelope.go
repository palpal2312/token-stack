package community

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ExportEnvelope represents the sealed, immutable product export handoff packet.
type ExportEnvelope struct {
	EnvelopeVersion string            `json:"envelope_version"`
	ExportID        string            `json:"export_id"`
	Sequence        int64             `json:"sequence"`
	PluginSlug      string            `json:"plugin_slug"`
	Version         string            `json:"version"`
	AuthorRef       string            `json:"author_ref"`
	MetadataRefs    map[string]string `json:"metadata_refs"`
	Checksum        string            `json:"checksum"`
	ExportedAt      time.Time         `json:"exported_at"`
}

// BuildExportEnvelope validates the item in StateExporting/Approved and builds an immutable envelope.
func BuildExportEnvelope(item *QueueItem) (*ExportEnvelope, error) {
	if item == nil {
		return nil, errors.New("cannot build export envelope from nil item")
	}
	if item.State != StateApproved && item.State != StateExporting && item.State != StateExported {
		return nil, fmt.Errorf("cannot export item in state %q (must be approved, exporting, or exported)", item.State)
	}

	cleanMeta, err := ValidateAndSanitizeMetadata(item.Metadata)
	if err != nil {
		return nil, fmt.Errorf("sanitization check failed during export envelope build: %w", err)
	}

	payloadBytes, err := json.Marshal(struct {
		ID         string            `json:"id"`
		PluginSlug string            `json:"plugin_slug"`
		Version    string            `json:"version"`
		AuthorRef  string            `json:"author_ref"`
		Metadata   map[string]string `json:"metadata"`
	}{
		ID:         item.ID,
		PluginSlug: item.PluginSlug,
		Version:    item.Version,
		AuthorRef:  item.AuthorRef,
		Metadata:   cleanMeta,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal export envelope payload: %w", err)
	}

	h := sha256.Sum256(payloadBytes)
	checksum := hex.EncodeToString(h[:])

	now := time.Now().UTC()
	return &ExportEnvelope{
		EnvelopeVersion: "v1.0.0",
		ExportID:        fmt.Sprintf("exp-%s-%d", item.ID, item.Seq),
		Sequence:        item.Seq,
		PluginSlug:      item.PluginSlug,
		Version:         item.Version,
		AuthorRef:       item.AuthorRef,
		MetadataRefs:    cleanMeta,
		Checksum:        checksum,
		ExportedAt:      now,
	}, nil
}
