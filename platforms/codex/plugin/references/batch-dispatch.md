# Batch Dispatch — Tier-2 width fan-out engine (Phase L)

The deterministic git/artifact/merge/telemetry rails for `/l4`'s **width** path:
one Claude foreman fanning out to **at most 3** (fixed cap) file-disjoint
independent units in a single round, then verifying + merging them **all-or-nothing**.

This is the engine that turns the standalone **Phase S1** disjointness gate
([`check-disjointness.sh`](../scripts/check-disjointness.sh)) into a usable
batch loop. It builds on the **same artifact-rail** as
[`dispatch-hetero.sh`](../scripts/dispatch-hetero.sh): **verify by git, never by
agent self-report.**

## The split: shell engine vs. orchestration prose

Phase L is deliberately **two halves** — they cannot be one thing:

| Half | Where | What it owns |
|------|-------|--------------|
| **(A) Deterministic engine** | [`scripts/dispatch-batch.sh`](../scripts/dispatch-batch.sh) | git/artifact/merge/telemetry/reap — the testable safety machinery. This doc. |
| **(B) LLM control loop** | [`skills/ceo-agent/references/level-front-door.md`](../skills/ceo-agent/references/level-front-door.md) § "Phase L" | the depth-0 loop that holds N agentIds, `Monitor`s for completion, `TaskStop`s on abort, GCs worktrees. Harness-only primitives the shell cannot call. |

A shell script **cannot invoke the Agent/Task tool**, so the actual parallel
dispatch of N Claude workers is prose, not code. The script owns everything that
**can** be made deterministic and tested — and that is precisely the half that
must be impossible to fake when running unattended.

## A "batch"

`N` units sharing **ONE base**. Each unit = `{ id, scope (allowlist globs), base }`.

- **Single-base-per-batch is ENFORCED.** Mixed base ⇒ `plan` exits 1 "not a valid
  decomposition". Parallel siblings that don't fork the same integration point are
  not an independent-unit decomposition — they're a sequence.
- **Branch names are collision-safe**: `unit-<id>-<run-id>`.

## Subcommands

```bash
scripts/dispatch-batch.sh plan       --units <file> --run-id <id> [--repo <dir>] [--base <ref>]
scripts/dispatch-batch.sh verify     --units <file> --run-id <id> [--repo <dir>]
scripts/dispatch-batch.sh merge-back --units <file> --run-id <id> --base <ref> [--repo <dir>]
scripts/dispatch-batch.sh telemetry  --run-id <id> --event <t_dispatch|t_all_committed|t_review_done> [--store <path>]
scripts/dispatch-batch.sh telemetry  report [--store <path>]
scripts/dispatch-batch.sh reap       --run-id <id> [--store <path>] (--abort | --unit <id>)
```

JSON to stdout; exit **0** ok / **1** violation / **2** usage.

### Units file

One unit per line (blank lines + `#` comments ignored), JSON-lines **or** TSV:

```
{"id":"ui","scope":"src/ui/**,src/ui/x.ts","base":"main"}
api    src/api/**    main
```

`scope` is a comma-separated allowlist glob list (the planner six-element
`Scope:` — same glob dialect as `check-disjointness.sh`). A per-line `base` may
be omitted and supplied via `--base`; a per-line base that **disagrees** with the
batch base is the mixed-base violation.

### `plan`

Enforces single-base-per-batch, generates the `unit-<id>-<run-id>` branch names,
and runs `check-disjointness propose` over the declared scopes — an **ADVISORY**
overlap surface (`advisory_disjoint: true|false`), **logged, never a hard-fail**.
The authoritative gate is post-commit (`verify`); `plan` overlap is a courtesy
check on a *proposal*, before any real artifact exists.

### `verify` — the all-or-nothing gate

Post-dispatch, reads **git artifacts** per unit branch:

| `status` | Condition (read from git, never self-report) |
|----------|----------------------------------------------|
| `committed` | new commit on `unit-<id>-<run-id>` + tree clean |
| `no_op` | branch exists but HEAD == base (no commit) |
| `dirty` | new commit but the unit's worktree left uncommitted changes |
| `failure` | branch never created (no reviewable artifact); `commit: null` |

AND runs `check-disjointness validate` for each unit (actual-touched ⊆ declared
scope). **ALL-OR-NOTHING**: if **ANY** unit is not `committed` OR fails its
disjointness check ⇒ overall `verdict: abort` (exit 1) — the whole fan-out
escalates, merge nothing. No half-feature ships unattended.

> 🔴 **Files-only carve-out (inherited from S1).** `verify` certifies **files,
> not behavior**. Two units that each touch only their own declared scope pass
> `verify` even when they semantically couple (shared types, import edges) — that
> coupling surfaces either at `merge-back` (a line conflict → `serial_collapse`)
> or only in the **depth-0 reviewer's** read of the *combined* diff. The green
> `verify` stamp is NEVER a behavior clearance.

### `merge-back` — merge-conflict-as-missing-edge

**Re-runs `verify`'s artifact logic first** (never trusts a stale verdict). Only
if all units are committed-and-clean does it merge. It trial-merges every unit
branch onto the base in a **detached throwaway worktree**, so:

- **All clean** ⇒ the base **branch** advances to the integration tip
  (`verdict: merged`, exit 0). Survives the base being checked out elsewhere
  (ff-merge in its worktree) or not (`update-ref`).
- **Any conflict** ⇒ `git merge --abort`, the detached worktree is discarded
  (**base ref UNTOUCHED — merged nothing**), and a `serial_collapse` directive is
  emitted naming the conflicting unit + the last cleanly-merged unit
  (`serial_collapse_ids`). The caller re-runs **those ids as ONE Tier-1 serial
  unit**. **Never** auto-resolve. **Never** a coordinated round-2 re-dispatch
  (that breaches blind-dispatch implementer-blinding,
  [`blind-dispatch.md`](blind-dispatch.md)).

### `telemetry` — cross-run Amdahl store (NOT a within-run gate)

`telemetry --event <t_dispatch|t_all_committed|t_review_done>` appends a
timestamped event to a per-run store (default `~/.autopilot/batch-telemetry/<run-id>.jsonl`).
`telemetry report` computes, per stored run: `parallel_s` (dispatch→all_committed),
`serial_s` (all_committed→review_done), `serial_fraction = serial/wall`, and the
**Amdahl speedup bound** (`wall/serial`). This is **cross-run tuning** that informs
the width cap over time — it is **never** a within-run gate. The clock owner is the
**depth-0 loop** (named in §B); the script just records what it is handed.

### `reap` — the parallel-kill trap (SHELL-dispatched workers only)

For the **hetero** path where workers are real subprocesses. Each worker, when
launched by the dispatch loop, runs under `setsid` (its own process **group**) and
registers its pgid at `<reap-dir>/<id>.pgid`. `reap` sends **SIGTERM to the group**:

- `--abort` ⇒ TERM **every** unit's group ("batch aborted").
- `--unit <id>` ⇒ TERM **just that one** group ("one unit stalled, keep the rest").

> 🔴 **SIGTERM, not SIGINT — and verified empirically, never by reasoning.**
> Ctrl-C / SIGINT to a process group does **not** fire a parent script's INT trap
> while a foreground child runs; only SIGTERM does (repo lesson, memory
> `bash-INT-pgroup-trap`). The reap path is proven in
> [`hooks/tests/dispatch-batch.test.sh`](../hooks/tests/dispatch-batch.test.sh) §10
> by `setsid`-ing real `sleep` workers, reaping, and asserting the processes are
> **gone** (`kill -0` polling) — not by argument.
>
> **Agent-tool (homogeneous `/l4`) workers are NOT reaped this way** — they are not
> subprocesses. The orchestrator reaps them with **`TaskStop <agentId>`** (prose,
> §B). `reap` is the hetero-leaf analogue of that homogeneous primitive.

## Scope cut (deliberately NOT built)

- `/l5` **hetero parallel** dispatch (BACKLOG — weakest leg). The `reap` group-kill
  rail exists for it, but the parallel hetero control loop is not wired.
- **Auto-resolving merge conflicts** unattended — escalate via `serial_collapse`,
  never auto-merge.
- Continuous `f(edge-density)` width or an LLM dependency-graph gate — both killed;
  the deterministic `check-disjointness` rail replaces them.
- Width beyond the small fixed cap for coupled work — never.

## Hard-won shell notes (do not regress)

- `set -euo pipefail`. **Avoid the SIGPIPE-under-pipefail trap** (`cmd | head` /
  `cmd | grep -q` ⇒ upstream SIGPIPE → 141 → abort; bit three scripts here). We read
  full git output into vars / use `awk` counts / here-strings — never pipe git into
  `head`/`grep -q`.
- `git -c core.quotepath=false` on every `git diff --name-only`.
- The per-unit artifact record uses an ASCII **Unit Separator (`\x1f`)** delimiter,
  not a tab: a tab (IFS-whitespace) collapses an empty leading field, which would
  turn a `failure`'s null commit into the file-count. Non-whitespace delim preserves
  empty fields.
