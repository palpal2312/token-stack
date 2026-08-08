#!/usr/bin/env bash
# ============================================================================
# verify-phase-08-steps-11-17.sh
# Phase 08 Steps 11-17: AgentENV Container Realization verification script
#
# Runs Go tests for all packages introduced in this phase:
#   - go/internal/sandbox       (AgentENVClient, ContainerLifecycle, ArtifactTransport)
#   - go/internal/builderexec   (Reconciler, SandboxProvider)
#   - go/internal/scheduler     (CommittingDispatcher)
#   - go/internal/allocator     (LiveScoringAllocator)
#
# Also verifies that the daemon builds cleanly (go vet / go build).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GO_ROOT="$PROJECT_ROOT/go"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

log_header() { printf "\n${CYAN}=== %s ===${NC}\n" "$1"; }
log_pass()   { printf "${GREEN}  PASS${NC} %s\n" "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
log_fail()   { printf "${RED}  FAIL${NC} %s\n" "$1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
log_skip()   { printf "${YELLOW}  SKIP${NC} %s\n" "$1"; SKIP_COUNT=$((SKIP_COUNT + 1)); }

# ---------- prerequisite check ----------

log_header "Prerequisites"

if ! command -v go &>/dev/null; then
    log_fail "Go toolchain not found in PATH"
    echo "Install Go >= 1.22 and re-run this script."
    exit 1
fi
log_pass "Go toolchain found: $(go version)"

if [ ! -f "$GO_ROOT/go.mod" ]; then
    log_fail "go.mod not found at $GO_ROOT/go.mod"
    exit 1
fi
log_pass "go.mod found"

# ---------- Step 11: source file existence ----------

log_header "Step 11 - Source file existence"

EXPECTED_FILES=(
    "internal/sandbox/agentenv_client.go"
    "internal/sandbox/container_lifecycle.go"
    "internal/sandbox/artifact_transport.go"
    "internal/builderexec/reconciler.go"
    "internal/builderexec/sandbox_provider.go"
    "internal/scheduler/committing_dispatcher.go"
    "internal/allocator/live_scoring_allocator.go"
)

for f in "${EXPECTED_FILES[@]}"; do
    if [ -f "$GO_ROOT/$f" ]; then
        log_pass "$f exists"
    else
        log_fail "$f missing"
    fi
done

# ---------- Step 12: test file existence ----------

log_header "Step 12 - Test file existence"

EXPECTED_TESTS=(
    "internal/sandbox/sandbox_test.go"
    "internal/sandbox/artifact_transport_test.go"
    "internal/builderexec/reconciler_test.go"
    "internal/builderexec/sandbox_provider_test.go"
    "internal/scheduler/committing_dispatcher_test.go"
    "internal/allocator/live_scoring_allocator_test.go"
)

for f in "${EXPECTED_TESTS[@]}"; do
    if [ -f "$GO_ROOT/$f" ]; then
        log_pass "$f exists"
    else
        log_fail "$f missing"
    fi
done

# ---------- Step 13: go vet (static analysis) ----------

log_header "Step 13 - go vet (static analysis)"

PACKAGES=(
    "agentic-os/internal/sandbox"
    "agentic-os/internal/builderexec"
    "agentic-os/internal/scheduler"
    "agentic-os/internal/allocator"
)

cd "$GO_ROOT"
for pkg in "${PACKAGES[@]}"; do
    if go vet "./${pkg#agentic-os/}" 2>&1; then
        log_pass "go vet $pkg"
    else
        log_fail "go vet $pkg"
    fi
done

# ---------- Step 14: go build (compilation check) ----------

log_header "Step 14 - go build (compilation check)"

for pkg in "${PACKAGES[@]}"; do
    if go build "./${pkg#agentic-os/}" 2>&1; then
        log_pass "go build $pkg"
    else
        log_fail "go build $pkg"
    fi
done

# ---------- Step 15: unit tests - sandbox package ----------

log_header "Step 15 - Unit tests: sandbox package"

if go test -v -count=1 ./internal/sandbox/ 2>&1; then
    log_pass "sandbox tests passed"
else
    log_fail "sandbox tests failed"
fi

# ---------- Step 16: unit tests - builderexec package ----------

log_header "Step 16 - Unit tests: builderexec package"

if go test -v -count=1 ./internal/builderexec/ 2>&1; then
    log_pass "builderexec tests passed"
else
    log_fail "builderexec tests failed"
fi

# ---------- Step 17: unit tests - scheduler + allocator ----------

log_header "Step 17 - Unit tests: scheduler and allocator packages"

if go test -v -count=1 ./internal/scheduler/ 2>&1; then
    log_pass "scheduler tests passed"
else
    log_fail "scheduler tests failed"
fi

if go test -v -count=1 ./internal/allocator/ 2>&1; then
    log_pass "allocator tests passed"
else
    log_fail "allocator tests failed"
fi

# ---------- full-module test run ----------

log_header "Full module test run (all packages)"

if go test -count=1 ./... 2>&1; then
    log_pass "all module tests passed"
else
    log_fail "one or more module tests failed"
fi

# ---------- summary ----------

log_header "Summary"

TOTAL=$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))
printf "  Total checks: %d\n" "$TOTAL"
printf "  ${GREEN}Passed: %d${NC}\n" "$PASS_COUNT"
printf "  ${RED}Failed: %d${NC}\n" "$FAIL_COUNT"
printf "  ${YELLOW}Skipped: %d${NC}\n" "$SKIP_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "\n${GREEN}Phase 08 Steps 11-17 verification PASSED.${NC}\n"
    exit 0
else
    printf "\n${RED}Phase 08 Steps 11-17 verification FAILED.${NC}\n"
    exit 1
fi
