# Agent-call Foundation 0.1

Status: implemented candidate
Date: 2026-08-25

## Goal

Let explicitly persistent coding-agent sessions owned by one OS user communicate locally without requiring every harness to surface MCP notifications in model context.

## Decisions

- One universal skill and CLI.
- No local daemon, database, NATS, durable queue, selector, or worker spawning.
- Claude ingress uses the documented Claude Code Channel contract and official MCP SDK.
- tmux is the universal read/write fallback and may remain as an idle wake-up companion to a future context hook.
- Adapter receipts are honest ceilings, never completion claims.
- Message authority is permanently `peer`.
- Autopilot heterogeneous dispatch remains separate.
- Hangar-bridge later uses `agent-call receive --stdin` as the remote last-mile boundary.

## Acceptance

- Registry is private, ephemeral, validates live PID, rejects live name collision, and quarantines corrupt descriptors.
- Runtime paths fail closed on symlinks, foreign ownership, or group/world access.
- Claude Channel uses authenticated private local socket delivery and emits `notifications/claude/channel` only after validating target and envelope.
- tmux sends literal text, waits beyond paste-burst detection, then sends `C-m` separately.
- Console capture is bounded.
- All peer content is visibly framed as non-operator input.
- Unit and negative tests cover token forgery, target mismatch, not-ready Channel, authority escalation, stale registry, symlink runtime path, and tmux's unverified receipt.

## Explicit non-goals

Cross-machine transport, offline delivery, automatic agent selection, resource arbitration, permissions relay, ACP process ownership, and live invoke workers.
