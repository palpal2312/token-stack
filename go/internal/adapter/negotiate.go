// Package adapter provides typed Orca capability negotiation.
//
// Negotiation is fail-closed: missing required features, contract-version
// mismatch, or a revoked pin reject the session. Secrets and raw capability
// bearer strings are never stored here — only opaque hashes and feature sets.
package adapter

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

const (
	// CurrentContractVersion is the ADP-05 adapter contract.
	CurrentContractVersion = 1

	FeatureSlotsRead         = "slots.read"
	FeatureReconcileReattach = "reconcile.reattach"
	FeatureCursorPersist     = "cursor.persist"
	FeatureDuplicateGuard    = "dispatch.duplicate_guard"
)

// RequiredFeatures is the minimum feature set for Sprint 04 Lane 1.
var RequiredFeatures = []string{
	FeatureSlotsRead,
	FeatureReconcileReattach,
	FeatureCursorPersist,
	FeatureDuplicateGuard,
}

// Spec is a typed capability claim or requirement.
type Spec struct {
	ContractVersion int
	Features        []string
}

// Result is the outcome of Negotiate.
type Result struct {
	Accepted        bool
	ContractVersion int
	Features        []string
	CapabilityHash  string
	Reason          string
}

// Negotiate intersects offered features with required ones under a shared
// contract version. Exact required membership is mandatory; extras are ignored.
func Negotiate(required, offered Spec) Result {
	if required.ContractVersion <= 0 || offered.ContractVersion <= 0 {
		return Result{Reason: "contract version must be >= 1"}
	}
	if required.ContractVersion != offered.ContractVersion {
		return Result{
			Reason: fmt.Sprintf(
				"contract version mismatch: required %d offered %d",
				required.ContractVersion, offered.ContractVersion,
			),
		}
	}
	req := normalizeFeatures(required.Features)
	off := toSet(normalizeFeatures(offered.Features))
	var missing []string
	accepted := make([]string, 0, len(req))
	for _, f := range req {
		if !off[f] {
			missing = append(missing, f)
			continue
		}
		accepted = append(accepted, f)
	}
	if len(missing) > 0 {
		return Result{
			ContractVersion: required.ContractVersion,
			Reason:          "missing required features: " + strings.Join(missing, ","),
		}
	}
	hash, err := HashSpec(Spec{ContractVersion: required.ContractVersion, Features: accepted})
	if err != nil {
		return Result{Reason: err.Error()}
	}
	return Result{
		Accepted:        true,
		ContractVersion: required.ContractVersion,
		Features:        accepted,
		CapabilityHash:  hash,
	}
}

// DefaultRequired returns the Sprint 04 required spec.
func DefaultRequired() Spec {
	return Spec{ContractVersion: CurrentContractVersion, Features: append([]string(nil), RequiredFeatures...)}
}

// HashSpec returns a stable SHA-256 hex digest over version + sorted features.
func HashSpec(spec Spec) (string, error) {
	if spec.ContractVersion <= 0 {
		return "", errors.New("contract version must be >= 1")
	}
	features := normalizeFeatures(spec.Features)
	payload, err := json.Marshal(struct {
		V int      `json:"v"`
		F []string `json:"f"`
	}{V: spec.ContractVersion, F: features})
	if err != nil {
		return "", fmt.Errorf("marshal capability spec: %w", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func normalizeFeatures(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, f := range in {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		if _, ok := seen[f]; ok {
			continue
		}
		seen[f] = struct{}{}
		out = append(out, f)
	}
	sort.Strings(out)
	return out
}

func toSet(in []string) map[string]bool {
	out := make(map[string]bool, len(in))
	for _, f := range in {
		out[f] = true
	}
	return out
}
