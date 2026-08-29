package community

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// AllowedMetadataKeys defines the strict typed allowlist for community metadata refs.
// Invariant: raw prompts, source code, tokens, passwords, private keys, PII, and credentials are forbidden.
var AllowedMetadataKeys = map[string]bool{
	"category":     true,
	"tag":          true,
	"license":      true,
	"repo_ref":     true,
	"homepage_ref": true,
	"doc_ref":      true,
	"checksum":     true,
	"export_spec":  true,
}

var (
	bearerPattern    = regexp.MustCompile(`(?i)bearer\s+[a-z0-9_\-\.]+`)
	jwtPattern       = regexp.MustCompile(`ey[a-zA-Z0-9_\-]+\.ey[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+`)
	secretKeyPattern = regexp.MustCompile(`(?i)(api[_-]?key|secret|token|password|auth|private[_-]?key)["':\s=]+`)
	pemKeyPattern    = regexp.MustCompile(`(?i)-----BEGIN[A-Z\s_-]+PRIVATE\s+KEY-----`)
)

// sanitizeString strips ASCII control characters (null bytes, DEL, etc.) while preserving valid whitespace.
func sanitizeString(s string) string {
	return strings.Map(func(r rune) rune {
		if (r < 32 && r != '\t' && r != '\n' && r != '\r') || r == 127 {
			return -1
		}
		return r
	}, s)
}

// ValidateAndSanitizeMetadata strictly filters input metadata against the allowlist
// and enforces that values do not contain leaked secrets, credentials, or raw script payload blocks.
func ValidateAndSanitizeMetadata(raw map[string]string) (map[string]string, error) {
	sanitized := make(map[string]string)

	for k, v := range raw {
		cleanKey := strings.ToLower(strings.TrimSpace(sanitizeString(k)))
		if !AllowedMetadataKeys[cleanKey] {
			return nil, fmt.Errorf("disallowed metadata key: %q (violates allowlist)", k)
		}

		// Enforce size limit to prevent smuggling large raw prompts or dumps (max 1024 bytes per field)
		if len(v) > 1024 {
			return nil, fmt.Errorf("metadata key %q value exceeds maximum allowed length of 1024 bytes", k)
		}

		cleanVal := strings.TrimSpace(sanitizeString(v))

		// Check for forbidden secret patterns in metadata values (both raw and cleaned)
		if bearerPattern.MatchString(v) || jwtPattern.MatchString(v) || secretKeyPattern.MatchString(v) || pemKeyPattern.MatchString(v) ||
			bearerPattern.MatchString(cleanVal) || jwtPattern.MatchString(cleanVal) || secretKeyPattern.MatchString(cleanVal) || pemKeyPattern.MatchString(cleanVal) {
			return nil, fmt.Errorf("metadata key %q contains forbidden secret/token/key pattern", k)
		}

		sanitized[cleanKey] = cleanVal
	}

	return sanitized, nil
}

// ValidateRawPayload checks raw payload strings for leaked secrets, credentials, or keys.
func ValidateRawPayload(raw string) error {
	if raw == "" {
		return nil
	}
	clean := sanitizeString(raw)
	if bearerPattern.MatchString(raw) || jwtPattern.MatchString(raw) || secretKeyPattern.MatchString(raw) || pemKeyPattern.MatchString(raw) ||
		bearerPattern.MatchString(clean) || jwtPattern.MatchString(clean) || secretKeyPattern.MatchString(clean) || pemKeyPattern.MatchString(clean) {
		return errors.New("raw payload contains forbidden secret/token/key pattern")
	}
	return nil
}

// ValidateItemSanity checks structural invariants for a QueueItem before transition.
func ValidateItemSanity(item *QueueItem) error {
	if item == nil {
		return errors.New("queue item cannot be nil")
	}
	if strings.TrimSpace(item.ID) == "" {
		return errors.New("item ID is required")
	}

	// Validate metadata through strict allowlist
	cleanMeta, err := ValidateAndSanitizeMetadata(item.Metadata)
	if err != nil {
		return err
	}
	item.Metadata = cleanMeta
	return nil
}
