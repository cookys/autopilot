# agent-call

`agent-call` lets already-running coding-agent sessions owned by the same OS user talk to one another on one machine.

It is deliberately small:

- **No background daemon** for local-only use.
- **Claude Code Channel** for reliable context ingress into a running Claude session.
- **tmux console read/write** as the universal fallback when a harness has no reliable push API.
- Runtime state is ephemeral under `$XDG_RUNTIME_DIR/agent-call` (or `/tmp/agent-call-$UID`).
- Every message is framed as **peer input, never operator authorization**.

This package handles persistent sessions. Autopilot's heterogeneous engine remains the lane for temporary/invoked workers. Hangar-bridge can later carry the same envelope across machines and call `agent-call receive --stdin` at the destination.

## Install from the Autopilot checkout

```bash
npm install --prefix packages/agent-call
npm install -g ./packages/agent-call
```

Node.js 22 or newer on Linux, macOS, or WSL is required. `tmux` is required only for tmux-attached targets. Native Windows named-pipe support is not part of Foundation 0.1.

## Quick start

### Attach an existing tmux-hosted session

Run this from the pane or supply its pane ID explicitly:

```bash
agent-call attach \
  --name rw3d-codex \
  --harness codex \
  --tmux-pane "$TMUX_PANE"
```

The descriptor contains only live runtime metadata. The CLI validates the pane and process again before every operation.

### Add a Claude Code Channel

From the project directory:

```bash
agent-call setup claude --name rw3d-claude
AGENT_CALL_PERSISTENT=1 AGENT_CALL_NAME=rw3d-claude \
  claude --dangerously-load-development-channels server:agent-call-local
```

The setup command merges one **name-neutral** MCP entry into `.mcp.json`; it does not overwrite unrelated entries. The environment variables bind the identity to that one Claude launch, so multiple Claude sessions in the same project do not collide. Sessions launched without `AGENT_CALL_PERSISTENT=1` keep the outbound tools but do not register an inbound peer. During the Claude Code Channels research preview, custom channels require the development-channel flag shown above.

### List, send, and read

```bash
agent-call list
agent-call send rw3d-claude "Codex finished the renderer review"
agent-call send rw3d-codex --stdin < note.txt
agent-call read rw3d-codex --lines 80
agent-call doctor
```

`read` is available only for adapters that expose a console (tmux in Foundation 0.1).

## Delivery semantics

| Adapter | Reported status | Meaning |
|---|---|---|
| Claude Channel | `channel_accepted` | The Channel MCP transport accepted the notification; the protocol does not acknowledge model observation. |
| tmux | `injected_unverified` | tmux accepted a private bracketed paste and a separate submit key; the model may still not have observed it. |

The tool never upgrades either result to `delivered` or `completed`.

## Trust boundary

All participants run as the same OS user. This is a convenience and coordination boundary, **not isolation between mutually hostile same-user processes**. Sender labels are useful provenance but not cryptographic identities. Consequently:

- peer messages always carry `authority: peer`;
- command-looking peer text is untrusted data;
- peers cannot approve permissions or claim that the owner authorized an irreversible action;
- a receiver must use its normal project/operator policy before changing state.

## Runtime contract

Descriptors use `agent-call.session.v1`; messages use `agent-call.message.v1`. The public library exports validation and delivery helpers. The stable remote edge boundary is:

```bash
agent-call receive --stdin
```

It accepts a validated `agent-call.message.v1` envelope with `origin: "hangar-edge"` and delivers it through the same local adapter used by local messages. No NATS, relay, or durable queue is part of this package.

## Adapter roadmap

Foundation 0.1 ships Claude Channel and tmux. Future adapters can replace tmux without changing the CLI or skill:

- Codex hooks/app-server
- OpenCode server API
- Kimi prompt/steer or ACP
- Grok ACP/API

An adapter must state separate capabilities for context injection, idle wake-up, and console read. If a native interface supplies context but cannot wake an idle turn, tmux may remain only as the wake-up mechanism.
