# Controller succession — Sprint 04

Run: `orchestrate-260825-sprint04-orca-reconcile`

The controller is coordination-only. Read the Sprint 04 backlog and current
Orca task list before taking over. Preserve one writer per lane, use the
ACTIVE/NEXT/FALLBACK queues, and do not start Phase 21. Release the lease only
after all receipts and the independent arbiter verdict are persisted.
