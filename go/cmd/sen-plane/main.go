// sen-plane: the Go control-plane daemon serving the surface the Next.js
// proxies already call. Sprint 13 phase 1 replaces the memory slot seed with
// the durable orca store: /api/v1/runtime/slots and /api/v1/runtime/attempts
// are projected live from orca_dispatches / orca_terminal_cursors rows.
//
// Loopback-only bind; safe-field DTOs mirror src/lib/agentRuntime/orca-slot-client
// and go-builder-exec-client. The store opens fail-closed at startup — a store
// that cannot open/migrate is a daemon that does not start.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"agentic-os/internal/localdb/product"
	"agentic-os/internal/orca"
)

// SlotDTO and RuntimeSlotsDTO are the wire shapes parseRuntimeSlots expects.
// Reused from internal/orca (the Lane 1 DTO owner) — not duplicated here.
type SlotDTO = orca.Slot
type RuntimeSlotsDTO = orca.RuntimeSlots

// RuntimeAttemptDTO mirrors the GoRuntimeAttempt validator in
// go-builder-exec-client. Safe fields only — no secrets, tokens, or commands.
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
	ProjectionVersion string     `json:"projection_version"`
	Summaries         []struct{} `json:"summaries"`
}

type ExecutionPreferenceDTO struct {
	WorkspaceID      string `json:"workspace_id"`
	RequestedMode    string `json:"requested_mode"`
	EffectiveMode    string `json:"effective_mode"`
	ResolutionReason string `json:"resolution_reason"`
	UpdatedAt        string `json:"updated_at,omitempty"`
}

// SenChatTurnRequest is the fixed POST /api/v1/sen/chat wire shape.
type SenChatTurnRequest struct {
	SessionID string `json:"session_id"`
	Sender    string `json:"sender"`
	Text      string `json:"text"`
}

// SenChatTurnResponse is the persist-before-ack receipt projection.
type SenChatTurnResponse struct {
	CommandID     string `json:"command_id"`
	TurnSeq       int    `json:"turn_seq"`
	TurnID        string `json:"turn_id"`
	ChatAttemptID string `json:"chat_attempt_id"`
	SessionID     string `json:"session_id"`
	Status        string `json:"status"`
	CreatedAt     string `json:"created_at"`
}

// validSenders mirrors the sen_session_turns.role CHECK constraint.
var validSenders = map[string]bool{"user": true, "assistant": true, "system": true}

// ProjectionSource is the live read seam for orca-backed projections.
type ProjectionSource interface {
	Slots() ([]orca.Slot, error)
	Attempts() ([]RuntimeAttemptDTO, error)
}

// storeSource projects slots/attempts straight from the durable orca store.
type storeSource struct {
	store *orca.Store
}

// Slots projects one slot per active dispatch row (dispatched/running).
func (s *storeSource) Slots() ([]orca.Slot, error) {
	rows, err := s.store.DB().QueryContext(context.Background(), `
		SELECT dispatch_id, terminal_handle, status, updated_at
		FROM orca_dispatches
		WHERE status IN ('dispatched', 'running')
		ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []orca.Slot{} // non-nil so an empty store marshals to []
	for rows.Next() {
		var dispatchID, terminal, status, stamp string
		if err := rows.Scan(&dispatchID, &terminal, &status, &stamp); err != nil {
			return nil, err
		}
		attemptRef := dispatchID
		out = append(out, orca.Slot{
			SlotID:         dispatchID,
			State:          slotStateFor(status),
			Capacity:       1,
			InFlight:       1,
			BuilderLabel:   nil,
			AttemptRef:     &attemptRef,
			LastObservedAt: stamp,
			Reason:         nil,
		})
	}
	return out, rows.Err()
}

// Attempts projects one RuntimeAttemptDTO per dispatch row.
func (s *storeSource) Attempts() ([]RuntimeAttemptDTO, error) {
	rows, err := s.store.DB().QueryContext(context.Background(), `
		SELECT dispatch_id, task_id, terminal_handle, status, reattach_count,
			created_at, updated_at, COALESCE(completed_at, updated_at)
		FROM orca_dispatches
		ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RuntimeAttemptDTO{} // non-nil so an empty store marshals to []
	for rows.Next() {
		var attemptID, taskID, terminal, status, attachedAt, heartbeatAt, terminalAt string
		var reattach int
		if err := rows.Scan(&attemptID, &taskID, &terminal, &status, &reattach,
			&attachedAt, &heartbeatAt, &terminalAt); err != nil {
			return nil, err
		}
		out = append(out, RuntimeAttemptDTO{
			AttemptID:        attemptID,
			TaskID:           taskID,
			BuilderID:        terminal, // ponytail: orca_dispatches has no builder_id column; terminal handle stands in until one lands
			PaneID:           terminal,
			Status:           attemptStatusFor(status),
			LeaseGeneration:  reattach + 1, // always >= 1, matching the GoRuntimeAttempt validator
			AttachedAt:       attachedAt,
			LastHeartbeatAt:  heartbeatAt,
			TerminalAt:       terminalAt,
		})
	}
	return out, rows.Err()
}

func slotStateFor(status string) orca.SlotState {
	switch orca.DispatchStatus(status) {
	case orca.StatusRunning:
		return orca.SlotRunning
	case orca.StatusDispatched:
		return orca.SlotLaunching
	}
	return orca.SlotReserved
}

func attemptStatusFor(status string) string {
	switch orca.DispatchStatus(status) {
	case orca.StatusDispatched:
		return "pending"
	case orca.StatusRunning:
		return "attached"
	case orca.StatusSucceeded:
		return "completed"
	case orca.StatusFailed:
		return "failed"
	case orca.StatusQuarantined, orca.StatusFenced:
		return "cancelled"
	}
	return "pending"
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

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// newCommandID mints a replay-safe idempotency key, same shape as the
// scheduler fencing token. ponytail: 16-byte hex, not a v4 UUID.
func newCommandID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// NewHandler assembles the control-plane routes. Every read fails closed:
// a projection error is a 503, never a partial/empty success. chat is the
// canonical product store (sen.db); when nil the chat route answers 503.
func NewHandler(src ProjectionSource, chat *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/v1/sen/chat", func(w http.ResponseWriter, r *http.Request) {
		if chat == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_store_unavailable"})
			return
		}
		var body SenChatTurnRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
			return
		}
		if body.SessionID == "" || body.Text == "" || !validSenders[body.Sender] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_chat_request"})
			return
		}
		now := time.Now().UTC()
		commandID, err := newCommandID()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "command_id_generation_failed"})
			return
		}
		receipt, err := product.SendTurn(r.Context(), chat, product.SendTurnInput{
			CommandID: commandID, SessionID: body.SessionID,
			WorkspaceID: body.SessionID, Content: body.Text, Role: body.Sender, Now: now,
		})
		if err != nil {
			// SendTurn is persist-before-ack: an error here means no mutation committed.
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_store_unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, SenChatTurnResponse{
			CommandID: receipt.CommandID, TurnSeq: receipt.TurnSeq,
			TurnID: receipt.TurnID, ChatAttemptID: receipt.ChatAttemptID,
			SessionID: receipt.SessionID, Status: receipt.Status,
			CreatedAt: now.Format(time.RFC3339),
		})
	})
	// GET reads back persisted chat so the backfilled product store is visible.
	// No ?session -> session list; ?session=<id> -> that session's turns
	// (role/text/ts rows the Next.js proxy passed through as canonical).
	mux.HandleFunc("GET /api/v1/sen/chat", func(w http.ResponseWriter, r *http.Request) {
		if chat == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_store_unavailable"})
			return
		}
		session := r.URL.Query().Get("session")
		if session == "" {
			rows, err := chat.QueryContext(r.Context(), `SELECT session_id, title, selected_builder_policy, created_at, updated_at
				FROM sen_sessions ORDER BY updated_at DESC`)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_sessions_unavailable"})
				return
			}
			defer rows.Close()
			sessions := []map[string]any{}
			for rows.Next() {
				var sessionID, title, builder, createdAt, updatedAt string
				if err := rows.Scan(&sessionID, &title, &builder, &createdAt, &updatedAt); err != nil {
					writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_sessions_unavailable"})
					return
				}
				row := map[string]any{"id": sessionID, "title": title, "createdAt": createdAt, "updatedAt": updatedAt}
				if row["title"] == "" {
					row["title"] = sessionID
				}
				if builder != "" {
					row["builder"] = builder
				}
				sessions = append(sessions, row)
			}
			if err := rows.Err(); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_sessions_unavailable"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
			return
		}
		turns, err := product.ListTurnsAfter(r.Context(), chat, session, 0, 1000)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "chat_thread_unavailable"})
			return
		}
		out := []map[string]any{}
		for _, t := range turns {
			out = append(out, map[string]any{
				"role": t.Role,
				"text": t.Content,
				"ts":   t.RecordedAt.UTC().Format(time.RFC3339),
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"turns": out})
	})
	mux.HandleFunc("GET /api/v1/runtime/slots", func(w http.ResponseWriter, _ *http.Request) {
		ss, err := src.Slots()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "slot_source_unavailable"})
			return
		}
		if ss == nil {
			ss = []orca.Slot{}
		}
		writeJSON(w, http.StatusOK, RuntimeSlotsDTO{DTOVersion: orca.DTOVersion, LabEnabled: true, Slots: ss})
	})
	mux.HandleFunc("GET /api/v1/runtime/attempts", func(w http.ResponseWriter, _ *http.Request) {
		attempts, err := src.Attempts()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "attempt_projection_unavailable"})
			return
		}
		if attempts == nil {
			attempts = []RuntimeAttemptDTO{}
		}
		writeJSON(w, http.StatusOK, RuntimeProjectionDTO{ProjectionVersion: "v1", Attempts: attempts})
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
		// write path round-trips. ponytail: persistence arrives with a durable
		// preferences store — not a goal this sprint.
		body.WorkspaceID = r.PathValue("workspaceId")
		body.ResolutionReason = "accepted-no-durable-store (phase-1b seed)"
		body.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		writeJSON(w, http.StatusOK, body)
	})
	return mux
}

// storeRoot resolves where the orca store opens. SEN_PLANE_STORE_DIR wins, then
// AGENTIC_OS_HOME, then %LOCALAPPDATA%\NEWSOS\sen-plane\store.
func storeRoot() (string, error) {
	if dir := os.Getenv("SEN_PLANE_STORE_DIR"); dir != "" {
		return dir, nil
	}
	if home := os.Getenv("AGENTIC_OS_HOME"); home != "" {
		return filepath.Join(home, "sen-plane", "store"), nil
	}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		return filepath.Join(local, "NEWSOS", "sen-plane", "store"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", errors.New("no store root: set SEN_PLANE_STORE_DIR or AGENTIC_OS_HOME")
	}
	return filepath.Join(home, ".local", "share", "NEWSOS", "sen-plane", "store"), nil
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

	root, err := storeRoot()
	if err != nil {
		slog.Error("sen-plane cannot resolve a store root; failing closed", "error", err)
		os.Exit(2)
	}
	store, err := orca.Open(context.Background(), root)
	if err != nil {
		slog.Error("sen-plane failed closed: cannot open orca store (no memory fallback)", "root", root, "error", err)
		os.Exit(2)
	}
	defer store.Close()

	// The canonical product chat store (sen-product.db) under the same root.
	// Failure is not fatal here: existing projection routes stay up and
	// /api/v1/sen/chat answers 503 while the store is unavailable.
	chat, err := product.Open(context.Background(), root)
	if err != nil {
		slog.Warn("sen-plane continuing without product store; /api/v1/sen/chat returns 503", "root", root, "error", err)
	} else {
		defer chat.Close()
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           NewHandler(&storeSource{store: store}, chat),
		ReadHeaderTimeout: 5 * time.Second,
	}
	slog.Info("sen-plane listening", "addr", addr, "store_root", root)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("sen-plane failed", "error", err)
		os.Exit(1)
	}
}