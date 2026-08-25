# Agent-call integration contract

## Product boundary

```text
Autopilot
├── persistent session conversation → agent-call
└── ephemeral implement/review workers → heterogeneous engine

Hangar-bridge
└── cross-machine transport → destination `agent-call receive --stdin`
```

`agent-call` owns the last mile into an already-running local harness. It does not own task allocation, model choice, worktree creation, durable delivery, or resource arbitration.

## Local path

```text
source agent / user
        │ agent-call send
        ▼
ephemeral descriptor lookup
        │
        ├─ Claude Channel → notifications/claude/channel
        └─ tmux console   → private bracketed paste, delay, C-m
```

There is no local daemon. Claude's Channel MCP subprocess is session-scoped and exists only because Claude Code spawned that persistent session's MCP server.

## Future fleet path

```text
source agent
  → agent-call envelope
  → hangar-bridge transport
  → remote hangar-edge
  → agent-call receive --stdin
  → local target adapter
```

The network layer must not reinterpret local adapter receipts. `channel_accepted` and `injected_unverified` remain their respective ceilings after remote transport succeeds.

## Capability model

Each descriptor declares independently:

- `context_injection`
- `wake_idle`
- `console_read`

A future adapter may combine mechanisms. For example, a Codex hook may provide `context_injection`, while tmux supplies only `wake_idle` until app-server steering is qualified.

## Naming and registration

Names are local to one OS user and machine. Suggested shape:

```text
<project>-<harness>-<role-or-line>
rw3d-claude-main
rw3d-codex-077
```

Only sessions deliberately registered by `agent-call attach` or a Channel subprocess appear. Autopilot's one-shot workers are not registered implicitly.

## Security posture

Same-user processes are not isolated from each other. Agent-call therefore does not make sender labels authorization-bearing. All content is framed as untrusted peer input, and the envelope schema rejects authority escalation.

## Claude session binding

The project MCP entry is name-neutral. A persistent Claude launch binds its local identity through `AGENT_CALL_PERSISTENT=1` and `AGENT_CALL_NAME=<name>`. Other Claude sessions may load the same MCP entry for outbound tools but are not registered as inbound peers, preventing fixed-name collisions when several Claude sessions share one checkout.
