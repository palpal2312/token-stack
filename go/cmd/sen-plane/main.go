// sen-plane: the Go control-plane daemon serving the surface the Next.js
// proxies already call. Sprint 12 phase 1 wires ONE vertical path:
// src/app/api/herdr/slots -> go-builder-exec-client -> GET /api/v1/runtime/slots.
//
// Loopback-only bind; the safe-field DTO mirrors src/lib/agentRuntime/orca-slot-client.
package main

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"
)

const slotDTOVersion = 1

// SlotDTO is the wire shape parseRuntimeSlots expects (safe fields only —
// no secrets, tokens, commands, or private paths ever leave the daemon).
// Mirror of go/internal/orcaslots (planned).
type SlotDTO struct {
	SlotID         string  `json:"slot_id"`
	State          string  `json:"state"`
	Capacity       int     `json:"capacity"`
	InFlight       int     `json:"in_flight"`
	BuilderLabel   *string `json:"builder_label"`
	AttemptRef     *string `json:"attempt_ref"`
	LastObservedAt string  `json:"last_observed_at"`
	Reason         *string `json:"reason"`
}

type RuntimeSlotsDTO struct {
	DTOVersion int       `json:"dto_version"`
	LabEnabled bool      `json:"lab_enabled"`
	Slots      []SlotDTO `json:"slots"`
}

// SlotSource is the seam for enumerating runtime slots. Phase 1 supplies a
// wiring seed so the vertical path round-trips end-to-end.
// ponytail: memory source; production projection from internal/orca dispatch
// + internal/reconcile slots arrives in a later phase.
type SlotSource interface {
	Slots() ([]SlotDTO, error)
}

type memorySlotSource struct{}

func (memorySlotSource) Slots() ([]SlotDTO, error) {
	id := "sen-plane-1"
	label := "sen-plane (phase-1 seed)"
	observed := time.Now().UTC().Format(time.RFC3339)
	return []SlotDTO{{
		SlotID:         id,
		State:          "free",
		Capacity:       1,
		InFlight:       0,
		BuilderLabel:   &label,
		AttemptRef:     nil,
		LastObservedAt: observed,
		Reason:         nil,
	}}, nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// RuntimeAttemptDTO mirrors the GoRuntimeAttempt validator in
// go-builder-exec-client. Phase 1b returns an empty list (no dispatch store
// wired yet); each item shape exists so parsers stay honest when filled later.
type RuntimeAttemptDTO struct {
	AttemptID        string `json:"attempt_id"`
	TaskID           string `json:"task_id"`
	BuilderID        string `json:"builder_id"`
	PaneID           string `json:"pane_id"`
	Status           string `json:"status"`
	LeaseGeneration  int    `json:"lease_generation"`
	AttachedAt       string `json:"attached_at"`
	LastHeartbeatAt  string `json:"last_heartbeat_at"`
	TerminalAt       string `json:"terminal_at"`
}

type RuntimeProjectionDTO struct {
	ProjectionVersion string              `json:"projection_version"`
	Attempts          []RuntimeAttemptDTO `json:"attempts"`
}

type CodeSpaceSummaryDTO struct {
	ProjectionVersion string        `json:"projection_version"`
	Summaries         []struct{}    `json:"summaries"`
}

type ExecutionPreferenceDTO struct {
	WorkspaceID     string `json:"workspace_id"`
	RequestedMode   string `json:"requested_mode"`
	EffectiveMode   string `json:"effective_mode"`
	ResolutionReason string `json:"resolution_reason"`
	UpdatedAt       string `json:"updated_at,omitempty"`
}

// preferenceFor returns a valid-by-parse default preference for a workspace.
func preferenceFor(workspaceID string, now time.Time) ExecutionPreferenceDTO {
	return ExecutionPreferenceDTO{
		WorkspaceID:      workspaceID,
		RequestedMode:    "host",
		EffectiveMode:    "host",
		ResolutionReason: "daemon-default-no-store (phase-1b seed)",
		UpdatedAt:        now.UTC().Format(time.RFC3339),
	}
}

// NewHandler assembles the reduced control-plane routes (phase 1 + 1b).
func NewHandler(slots SlotSource) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/v1/runtime/slots", func(w http.ResponseWriter, _ *http.Request) {
		ss, err := slots.Slots()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "slot_source_unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, RuntimeSlotsDTO{
			DTOVersion: slotDTOVersion,
			LabEnabled: true,
			Slots:      ss,
		})
	})
	mux.HandleFunc("GET /api/v1/runtime/attempts", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, RuntimeProjectionDTO{ProjectionVersion: "v1", Attempts: []RuntimeAttemptDTO{}})
	})
	mux.HandleFunc("GET /api/v1/codespace/summary", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, CodeSpaceSummaryDTO{ProjectionVersion: "v1", Summaries: []struct{}{}})
	})
	mux.HandleFunc("GET /api/v1/workspace/{workspaceId}/execution-preference", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, preferenceFor(r.PathValue("workspaceId"), time.Now()))
	})
	mux.HandleFunc("PUT /api/v1/workspace/{workspaceId}/execution-preference", func(w http.ResponseWriter, r *http.Request) {
		var body ExecutionPreferenceDTO
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_preference_body"})
			return
		}
		// No durable store yet: reflect with an explicit reason, keep 200 so the
		// write path round-trips. ponytail: persistence arrives with the orca store phase.
		body.WorkspaceID = r.PathValue("workspaceId")
		body.ResolutionReason = "accepted-no-durable-store (phase-1b seed)"
		body.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		writeJSON(w, http.StatusOK, body)
	})
	return mux
}

func main() {
	addr := os.Getenv("SEN_PLANE_ADDR")
	if addr == "" {
		addr = "127.0.0.1:3979"
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil || !(host == "localhost" || host == "127.0.0.1" || host == "::1") {
		slog.Error("sen-plane must bind a loopback address", "addr", addr)
		os.Exit(2)
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           NewHandler(memorySlotSource{}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	slog.Info("sen-plane listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("sen-plane failed", "error", err)
		os.Exit(1)
	}
}