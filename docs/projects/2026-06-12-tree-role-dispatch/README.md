# tree-role-dispatch — resolve-dispatch.sh tree-role integration

> **Status**: in progress
> **Started**: 2026-06-12 · **Branch**: `feat/tree-role-dispatch` · **Target**: v2.17.0
> **Source**: BACKLOG "resolve-dispatch.sh tree-role integration" (R1 review round 1 Fix 3, Amendment 11)
> **Mode**: CEO (Hold scope) · tree adapter dual-run (shadow) dogfood session

## OKR

`scripts/resolve-dispatch.sh` resolves tree roles to correct `{model, mode}` without
breaking the existing legacy role table.

**Verifiable success criteria**:
1. `resolve-dispatch.sh --role implementer --tree` → sonnet (tree table); without
   `--tree` → opus (legacy, unchanged). All 7 tree roles resolve per
   `references/model-routing.md` §Tree roles.
2. `--role manager --tree` fails closed with a named error (`MANAGER_NOT_DISPATCHABLE`,
   exit 3) — Amendment 11 "Fable is NEVER dispatched" becomes a tool-layer invariant.
3. Project override supports tree rows (`tree:<role>` row syntax) without colliding
   with legacy rows in the same config file.
4. Test coverage for legacy-unchanged + tree table + manager refusal + override matching.
5. Docs reconciled: `model-routing.md` §Tree roles header, `tree-adapter.md` §6,
   ceo-agent SKILL.md references row, CLAUDE.md inventory row, BACKLOG entry closed.

## Design decision (CEO, tactical)

**`--tree` context flag** over namespaced role keys (`tree-implementer`):
role vocabulary stays identical to `resolve-doa.sh` KNOWN_ROLES
(manager / sub-orchestrator / planner / researcher / implementer / judge / synthesizer),
so a caller dispatching a tree implementer uses the same `--role implementer` for both
DOA and model resolution. Namespaced keys would force two naming schemes for one role.

Tree table defaults (factory, locally calibratable — Amendment 11):

| Role | Model | Mode |
|------|-------|------|
| manager | — (refuses, exit 3) | — |
| sub-orchestrator | opus | default |
| planner | sonnet | plan |
| researcher | sonnet | default |
| implementer | sonnet | default |
| judge | haiku | plan |
| synthesizer | haiku | plan |

Hetero flash-class implementer dispatch stays routed via `scripts/dispatch-hetero.sh`
(not Agent()), per `references/hetero-dispatch.md` — out of scope here.

## Phases

| Phase | Deliverable | Status |
|-------|------------|--------|
| L-1.5 | Scope completeness audit | ✅ done |
| P0 | `--tree` table + manager refusal + `tree:<role>` override matching in resolve-dispatch.sh | ✅ done (`d9f55ed`, sonnet implementer) |
| P1 | Test coverage (evals harness conventions) | ✅ done (104+ assertions) |
| P2 | Docs sync (model-routing / tree-adapter / SKILL.md / CLAUDE.md / BACKLOG / consumers sweep) | ✅ done (`8ed86ca`) |
| L-5 | finish-flow (quality-pipeline + qc-panel shadow, version, CHANGELOG, merge) | in progress |

## L-1.5 Scope completeness audit (2026-06-12)

| Dimension | Coverage |
|-----------|----------|
| Source | P0 — `scripts/resolve-dispatch.sh` |
| Tests | P1 — `hooks/tests/resolve-dispatch.test.sh` (lib.sh conventions, auto-discovered by run.sh) |
| Docs | P2 — model-routing.md §Tree roles note, tree-adapter.md §6, ceo-agent SKILL.md refs row, CLAUDE.md inventory row |
| API/schema | P0 — additive `"table":"tree"` field on tree path ONLY; legacy output byte-identical (stable-schema rule) |
| Templates | P2 — `project-config-template/model-routing-config.md` gains `tree:<role>` override doc |
| CHANGELOG / version | L-5 — v2.17.0 via sync-version.js (grep old version first) |
| Migration | **Out of scope** — additive flag; no existing tree-path callers to migrate |
| Consumers | P2 — repo-wide grep sweep for stale "deferred"/"wrong models" claims; verify resolve-doa.sh KNOWN_ROLES alignment (verify-only, no change); check `.opencode/` mirror status |
| Dogfood | This session resolves its own dispatches via `--tree` after P0 lands |
| Credit / attribution | N/A — internal design, no external prior art absorbed |

Hardening folded into P0 (same lake, not creep): input sanitization + env config
seam — both exist in sibling `resolve-doa.sh` for the identical injection vector
(`$ROLE` interpolated into `grep -iE`).

## Tree dogfood (dual-run shadow)

This project opts into `docs/projects/2026-06-12-tree-role-dispatch/tree/`.
TaskCreate stays authoritative (no `board_signoff` → shadow mode). Verification
checklist at close (memory `task-tree-engine-status`):
1. tree initialized + node_created/delegated/verdict events emitted
2. TaskCreate forcing functions ran as authoritative
3. qc-panel shadow ran on verdict-bearing nodes; reviewer-baseline calibration samples landed
4. tree-vs-reality divergences recorded in review log (P6 clause)
