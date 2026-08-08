#!/usr/bin/env bash
# ============================================================================
# verify-phase-10-11-promotion.sh
# Phase 10-11 Promotion: CommittingDispatcher + LiveScoringAllocator
#
# Runs Go tests for the scheduler and allocator packages, verifies static
# analysis, and confirms the daemon builds cleanly.
#
# Packages under test:
#   - go/internal/scheduler     (CommittingDispatcher, fencing tokens, WIP limits)
#   - go/internal/allocator     (LiveScoringAllocator, feedback loop, scoring)
#
# Exit 0 = all checks passed; exit 1 = at least one failure.
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

# ---------- Step 1: prerequisite check ----------

log_header "Step 1 - Prerequisites"

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
log_pass "go.mod found (module: agentic-os)"

# ---------- Step 2: source file existence ----------

log_header "Step 2 - Phase 10-11 source file existence"

EXPECTED_SOURCES=(
    "internal/scheduler/committing_dispatcher.go"
    "internal/allocator/live_scoring_allocator.go"
)

for f in "${EXPECTED_SOURCES[@]}"; do
    if [ -f "$GO_ROOT/$f" ]; then
        log_pass "$f exists"
    else
        log_fail "$f missing"
    fi
done

# ---------- Step 3: test file existence ----------

log_header "Step 3 - Phase 10-11 test file existence"

EXPECTED_TESTS=(
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

# ---------- Step 4: go vet (static analysis) ----------

log_header "Step 4 - go vet (static analysis)"

PACKAGES=(
    "internal/scheduler"
    "internal/allocator"
)

cd "$GO_ROOT"
for pkg in "${PACKAGES[@]}"; do
    if go vet "./$pkg" 2>&1; then
        log_pass "go vet ./$pkg"
    else
        log_fail "go vet ./$pkg"
    fi
done

# ---------- Step 5: go build (compilation check) ----------

log_header "Step 5 - go build (compilation check)"

for pkg in "${PACKAGES[@]}"; do
    if go build "./$pkg" 2>&1; then
        log_pass "go build ./$pkg"
    else
        log_fail "go build ./$pkg"
    fi
done

# ---------- Step 6: unit tests - scheduler package ----------

log_header "Step 6 - Unit tests: scheduler (CommittingDispatcher)"

if go test -v -count=1 ./internal/scheduler/ 2>&1; then
    log_pass "scheduler tests passed"
else
    log_fail "scheduler tests failed"
fi

# ---------- Step 7: unit tests - allocator package ----------

log_header "Step 7 - Unit tests: allocator (LiveScoringAllocator)"

if go test -v -count=1 ./internal/allocator/ 2>&1; then
    log_pass "allocator tests passed"
else
    log_fail "allocator tests failed"
fi

# ---------- Step 8: full-module build (daemon check) ----------

log_header "Step 8 - Full module build (daemon compilation)"

if go build ./... 2>&1; then
    log_pass "full module build succeeded"
else
    log_fail "full module build failed"
fi

# ---------- Step 9: full-module test run ----------

log_header "Step 9 - Full module test run (all packages)"

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
    printf "\n${GREEN}Phase 10-11 Promotion verification PASSED.${NC}\n"
    exit 0
else
    printf "\n${RED}Phase 10-11 Promotion verification FAILED.${NC}\n"
    exit 1
fi
