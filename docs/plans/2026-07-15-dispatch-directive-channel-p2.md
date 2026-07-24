# Dispatch Observability Phase 2 — Nudge / Directive Channel

Status: in progress (foreman /l5 run `foreman-nudge-p2-1784048903`)
Base: v2.32.32 (`6f7ba42`) — Phase 1 dispatch lineage present.
Version target: v2.32.33 (PATCH).

## Problem

Depth-0 has no way to inject advisory guidance into a running dispatch chain. Phase 1
gave us lineage (who spawned whom); Phase 2 adds a one-way *directive channel*:
queue-and-deliver-at-boundary, **advisory injection, never seizure of authority**.

## Settled semantics (do not re-litigate)

- A directive is **advisory**. The lease holder keeps the stage. No auto-kill on
  non-response (Stage 3 stays BACKLOG'd).
- Delivery is **queue-and-deliver-at-boundary**, never a hard interrupt.
- `watch-foreman.js` stays **READ-ONLY** — it gains NO directive-send surface (its
  no-`child_process` / report-only greppable invariant is unchanged).
- Additive-only: absent ledger coords / no directives ⇒ every existing path byte-identical.

## Reachability (honest)

| Channel | Reachability | Mechanism |
|---------|-------------|-----------|
| pi RPC supervisor (`pi-rpc-run.js`) | **mid-run** | native RPC `steer` at the supervisor's poll cadence (queue+boundary-delivery, verified in the Stage-2 spike) |
| CC foreman (dev-flow inline) | **stage-boundary** | poll own run-id at each stage boundary, honor/record |
| batch one-shot runners (codex exec / agy -p / grok / qoderclicn / cc-shim) | **UNREACHABLE mid-run** | a directive can only shape the NEXT round's dispatch — no pretend-channel |

## Design

### 1. Directive rows in R0 ledger (`scripts/run-ledger.sh`)

New event kind `directive` + terminal ack kinds `directive_delivered` / `directive_expired`.
Three subcommands (append-only, flock, schema-strict, fail-closed):

- **`directive-send --ledger --run-id --stage --text <t> [--from <f>] [--directive-id <id>]`**
  - Reads the target stage's CURRENT lease (latest `kind:"stage"` row). If missing or
    `state != "leased"` ⇒ **refuse, exit 1** (cannot nudge a stage nobody holds).
  - Binds `generation`+`nonce` from that lease.
  - Appends `{kind:"directive", ts, run_id, stage, generation, nonce, directive_id, text, from}`.
  - Prints the row.

- **`directive-poll` (alias `directive-list`) `--ledger --run-id [--stage]`**
  - Prints a JSON array of **pending** (un-acked) directive rows — a `directive` row whose
    `directive_id` has no `directive_delivered`/`directive_expired` row. Filtered by stage if given.

- **`directive-ack --ledger --run-id --directive-id <id> [--reason run_ended] [--by <who>]`**
  - Idempotent: if a terminal ack row already exists ⇒ `{status:"already_acked"}` (exactly
    one terminal ack row per send — never a second).
  - `--reason run_ended` (shutdown path) ⇒ append `directive_expired(run_ended)`.
  - else **delivery-time check**: read current lease for the directive's stage; if
    `state=="leased"` AND `generation == directive.generation` ⇒ `directive_delivered`;
    else ⇒ `directive_expired(stale_generation)`.
  - The delivering **supervisor** writes this — never the worker (trust posture: worker bytes
    stay JSON-escaped inside tool events).

Existing event kinds + all existing subcommand outputs stay byte-unchanged.

### 2. pi-rpc supervisor delivery (`scripts/lib/pi-rpc-run.js`)

- New optional args `--ledger --run-id --stage`. All three present ⇒ directive polling enabled.
  Absent ⇒ **zero new behavior** (byte-compat).
- On the supervisor's own poll interval (`PI_RPC_DIRECTIVE_POLL_SECS`, default 5s), poll the
  ledger for pending directives (async, never blocks the event loop).
- On pickup: send a native RPC `steer` with the text prefixed `[depth-0 directive] …`, then
  `directive-ack` from the supervisor (auto-decides delivered vs stale_generation).
- At shutdown (`agent_end` observed OR SIGTERM path): any still-pending directive for the
  run/stage gets `directive_expired(run_ended)`.
- Existing stall-probe / report-only / never-auto-kill semantics UNTOUCHED.

### 3. Docs + ritual

- `skills/ceo-agent/references/level-front-door.md` § Live sensing: foreman duty (poll own
  run-id at each stage boundary, honor/record) + depth-0 send-side usage.
- `references/hetero-dispatch.md`: the reachability table above + authority lines.
- `CLAUDE.md` inventory: terse directive mention on run-ledger.sh + pi-rpc-run.js rows.
- CHANGELOG + version bump to v2.32.33 (PATCH).

## Boundaries (hard)

- `schemas/` + `src/engine/review.js` byte-untouched. `dispatch-review.sh` final JSON unchanged.
- NO auto-kill / scheduling policy (Stage 3 BACKLOG). NO directive surface on `watch-foreman.js`.
- No merge, no push. Additive-only.

## Tests

- `hooks/tests/` run-ledger directive contract: send binds live lease (refuse when none),
  poll returns pending only, ack terminalizes, stale-generation expiry, run_ended expiry,
  malformed rejected, existing subcommand outputs unchanged.
- pi-rpc delivery: extend the fake-pi harness — pending directive gets steered (steer JSONL
  reaches fake pi stdin with the text), supervisor writes directive_delivered; shutdown with
  pending directive writes directive_expired(run_ended); no ledger coords ⇒ no polls.
- watch-foreman: grep invariant — still NO directive-send surface.
