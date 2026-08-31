package orca

// Naming alignment (ADP-05 / Sprint 04):
//
// Historical fixtures and TypeScript comments referred to "go/internal/orcaslots".
// Lane 1 ownership freezes the canonical path as this package: go/internal/orca.
// Consumers (Lane 3 RC-12, UI clients) must import agentic-os/internal/orca.
// No separate orcaslots package is published from Lane 1.

// Alias constants for readers migrating off the orcaslots name.
const (
	// CanonicalPackagePath is the import path Lane 3 RC-12 should target.
	CanonicalPackagePath = "agentic-os/internal/orca"
	// LegacyPackagePathAlias is the obsolete name RC-12 must not require.
	LegacyPackagePathAlias = "agentic-os/internal/orcaslots"
)
