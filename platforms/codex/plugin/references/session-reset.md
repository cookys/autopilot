# Session context reset (ctx-reset)

Host-side sweep for idle Claude Code sessions whose context has grown large enough that every wake (fleet message, background-task notice, cron) re-reads hundreds of thousands of tokens per API call. The measuring and deciding part is [`scripts/session-ctx-report.js`](../scripts/session-ctx-report.js); a separate sweep lane (over ssh) asks matching sessions to write a HANDOFF and restarts them fresh. This document is the contract for that script and the message protocol the sweep uses.

## Purpose

- **Measure** live context size per session (`list`).
- **Decide** which sessions are reset candidates (`candidates` / `decide()`), given fleet-hub facts the sweep merges in.
- **Never restart** anything from this script. Restart is the sweep's job after the session replies.

## Data source

The **only** data source for context size is the live file:

```text
<liveBase>/context/<session-id>.json
```

written by `hooks/context-budget.js` / `scripts/statusline-live-tee.js`. Resolve `<liveBase>` with `scripts/lib/live-state-dir.js` `resolveLiveDir()` (honours `AUTOPILOT_LIVE_DIR`).

Fields used: `schema_version` (must be `1`), `session_id`, `written_at`, `context_window.total_input_tokens`, `context_window.context_window_size`, `model.id` (may be absent).

The script reads the files **directly**. It does **not** use `readLive`'s 120 s freshness check: an idle session's file is old by design, and that age is the idle signal.

It never reads transcripts, settings, or anything else under `~/.claude`. Transcripts are the wrong instrument here (large, session-private, and not the status-line window the hooks already publish).

## `list` mode

```bash
scripts/session-ctx-report.js list [--json]
```

One row per schema-1 live file: `session_id`, `ctx_tokens`, `window`, `model`, `last_active` (`written_at`), `idle_min` (`now - written_at`). Malformed files and non-schema-1 files are skipped silently and counted (`skipped` in JSON). Plain output is a short table with Traditional Chinese headers.

## Decision table (`candidates` / `decide`)

Input (sweep merges `list` with fleet hub facts):

```json
{
  "now": "<ISO>",
  "sessions": [{
    "session_id": "...",
    "ctx_tokens": 0,
    "last_active": "<ISO>",
    "last_sent": "<ISO>?",
    "holds_claim": false,
    "open_tasks": 0,
    "running_go": false,
    "excluded": false,
    "last_reset": "<ISO>?",
    "skip_until": "<ISO>?"
  }]
}
```

Output per session: `{ session_id, decision: "reset"|"keep", reason }`. **First match wins:**

| Order | Condition | Decision | Reason |
|------:|-----------|----------|--------|
| 1 | `excluded` | keep | `excluded` |
| 2 | `holds_claim` | keep | `claim` |
| 3 | `running_go` | keep | `running_go` |
| 4 | `open_tasks > 0` | keep | `open_task` |
| 5 | `skip_until > now` | keep | `skipped_by_session` |
| 6 | `last_reset` within cooldown | keep | `cooldown` |
| 7 | `ctx >= hard` and idle >= `hard_idle` | reset | `hard` |
| 8 | `ctx >= soft` and idle >= `soft_idle` | reset | `soft` |
| 9 | else | keep | `below_threshold` or `not_idle` |

Idle minutes: `now - max(last_active, last_sent)` (missing `last_sent` ⇒ `last_active` only).

Thresholds (flags > env > defaults):

| Knob | Flag | Env | Default |
|------|------|-----|--------:|
| soft tokens | `--soft` | `AUTOPILOT_CTX_RESET_SOFT` | 150000 |
| hard tokens | `--hard` | `AUTOPILOT_CTX_RESET_HARD` | 250000 |
| soft idle (min) | `--soft-idle-min` | `AUTOPILOT_CTX_RESET_SOFT_IDLE_MIN` | 15 |
| hard idle (min) | `--hard-idle-min` | `AUTOPILOT_CTX_RESET_HARD_IDLE_MIN` | 5 |
| cooldown (min) | `--cooldown-min` | `AUTOPILOT_CTX_RESET_COOLDOWN_MIN` | 120 |

Non-positive or non-numeric values → exit 2. `excluded` is set by the sweep from its own core-session list (for example the PM and the fleet-ops session).

## Message protocol (sweep ↔ session)

1. Sweep sends: `[session-reset] <sid>`
   - Body tells the session to write a handoff via the handoff skill to `<liveBase>/handoff/<sid>.md`.
2. Session replies one of:
   - `[reset-ready] <path>` — handoff written; sweep may restart.
   - `[reset-skip] <reason>` — session declines; sweep sets `skip_until = now + 2h`.
3. On ready, the sweep restarts the session fresh with a first prompt: `read HANDOFF <path> first`.

This script does not send or parse those messages; it only produces the candidate list the sweep consumes.

## Known gap

A turn with **no tool call** does not refresh the live file. `written_at` / `idle_min` can therefore overstate idle time for a session that is thinking or answering in pure text. The sweep should treat `last_sent` (fleet activity) as a second activity signal for that reason — `decide` already takes `max(last_active, last_sent)`.

## Tests

`scripts/session-ctx-report.test.js` — run:

```bash
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node --test scripts/session-ctx-report.test.js < /dev/null
```
