# tree-role-dispatch — resolve-dispatch.sh tree-role integration

> **Status**: Complete (2026-06-12) — shipped v2.17.0
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

## Tree dogfood (dual-run shadow) — RESULTS (2026-06-12)

First ceo-agent tree-adapter dual-run on a real task. 4-point checklist:
1. ✅ tree initialized (`board-status` = null → shadow); 12 events across
   root/p0-impl/p2-docs/l5-close (node_created ×4, delegated, node_report ×2,
   verdict ×2, doa_decision).
2. ✅ TaskCreate stayed authoritative end-to-end (11 tasks incl. finish-flow
   expansion); zero `next-decision` routing, as designed pre-signoff.
3. ✅ qc-panel shadow ran twice on p0-impl (verdict-bearing); liveness sample +
   **first reviewer-baseline calibration sample landed** (`calibration.sh report`:
   reviewer count 0 → 1; panel fail / reviewer pass disagreement).
4. Divergences (P6 review-log clause):
   - **Verdict vocabulary gap** (FIXED this ship): tree-contracts §4 verdicts are
     free-form; `calibration.sh` accepts only pass|fail → first live panel run died
     at liveness AFTER a full ~109k-token panel. Fix: qc-panel normalization bridge
     + named `VERDICT_UNMAPPABLE` failure BEFORE judges run.
   - **Panel scope strictness** (calibration data, not a bug): both panel runs
     verdicted `fail` because judges count project-lifecycle closure (merge, L-5
     gates) as missed goals of a P0 *implementation* node. Same pattern as the
     first live sample (2026-06-12 am). If this repeats across tasks, consider
     scoping judge prompts to the node's question, not the project's.
   - **Archive ordering**: `tree.sh` rejects `_archive/<proj>` (proj-name
     validation) → archived trees are read-only. Final node verdicts MUST be
     emitted before L-5.5 archive. l5-close therefore carries doa_decision but its
     verdict event was refused post-archive (recorded here instead).
   - **Report-hash refresh on fix rounds**: node-report `artifact_paths[].sha256`
     pins working-tree hashes; any post-report fix round invalidates the report
     until the dispatcher refreshes hashes (check-node-report correctly caught it).
   - **Panel cost**: ~109k–149k tokens per panel run (2 runs this ship). Acceptable
     for shadow-phase sampling density, not for every node at scale.
