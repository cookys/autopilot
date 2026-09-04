# Default dispatch topology — brain up, hands down

**Plan**: [`docs/plans/2026-09-04-default-dispatch-topology.md`](../../plans/2026-09-04-default-dispatch-topology.md)
**Branch**: `feat/default-dispatch-topology` · **Target**: v2.36.0 (new hook `cost-fuse` + new scripts → PATCH by the semver rule; the MINOR digit is reserved for a new skill/agent, none here — final number decided at release; placeholder)
**Requested**: owner via the revival.3d CEO on cuda, 2026-09-04 (`msg_01M1MZ55SZFJYA5A68EW9PF8QW`)
**Status**: in progress — P0–P4 on this branch; P5 (fleet rollout) is out of scope for this project

## Topology of this project's own execution (dogfood)

Owner ruling 2026-09-04: the work is executed under the topology it ships. Depth-0 (Fable) briefs,
adjudicates, runs qc and merges; foremen are **sonnet** (`/l4`-shaped, worktree-isolated, one
deliverable per life); implementation cuts are dispatched by the foreman to
**`gemini-3.8-flash-low @ agy`, effort low** (qualified implementer seat, scorecard event 188) through
`scripts/dispatch-hetero.sh`; every dispatch prompt's first line names the engine.

**Board decision 2026-09-04 (option B)**: `dispatch-hetero.sh` hard-refuses any non-projection-bound
dispatch while `mission_convergence.enforcement_mode` is `enforce` (`check_mission_enforcement_gate`),
and the sealed-campaign L5 rail is bound to the 2026-08-29 verdict-stability graph. The Board chose to
set `enforcement_mode` to `shadow` **on this branch only** for the duration of this project (precedent:
`4c842a92`, 2026-08-31). Exit condition: the mode is restored to `enforce` in the same branch BEFORE
merge to develop (finish-flow L-5 checklist item), and the full suite + qc panel run against the
restored value. This is a temporarily switched-off gate and is recorded here so it cannot pass as
normal.

## Phases

| # | Phase | Size | Foreman wave | Status |
|---|---|---|---|---|
| P0 | `scripts/cost-digest.js` — per-day × model × session table over `~/.claude/metrics/costs.jsonl`; evidence table for the threshold | S | 1 | pending |
| P1 | `scripts/resolve-dispatch-topology.js` + `implementer_ladder: auto` + rung-0 default | L | 1 | pending |
| P2 | routing flip (implementer → sonnet, `hands` → haiku), `dispatch-model-guard` mode-aware `fable,opus` + `Engine:` header rule | S | 2 | pending |
| P3 | `hooks/cost-fuse.js` (PreToolUse, warn-mode default-on) + hook-classes/catalog wiring | S | 2 | pending |
| P4 | skill text: front-door canonical topology paragraph; dev-flow/ceo-agent/l3–l6 link; `/l3` → brief + sonnet hands | S | 3 | pending |

Open questions §8 resolved by owner 2026-09-04 with the proposal values: USD 150/host/day; rung-0 for
`judgment` too; `/l3` converts (`--solo` is the only inline escape); unqualified engines never enter the
ladder (they appear as `candidates_to_qualify`).

## Ledger

Execution records go here (never in the plan file).
