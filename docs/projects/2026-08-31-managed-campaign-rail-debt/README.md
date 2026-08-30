# Managed-campaign rail debt — (a) terminalize/withdraw, (b) grant replay refusal, (c) recipe credential staging, (d) wall cap

**Status**: In progress (2026-08-31) · **Target**: v2.35.5 · **Branch**: `feat/managed-campaign-rail-debt`
**Mode**: CEO (owner-led, just-results, Hold). Board directive 2026-08-31: parallel dispatch; implementer `gpt-5.3-codex-spark` via codex (128k window); foremen sonnet; depth-0 holds qc + merge.

## OKR

Close the four `docs/BACKLOG.md` 2026-08-30 rail-debt rows the verdict-stability campaign filed, each verified by a red-then-green fixture:

| Unit | BACKLOG row | Done when |
|------|-------------|-----------|
| U1 (a) | "Killed/dead managed campaign stuck at IMPLEMENTING has no operator remedy" + "No operator-level release for a claim whose campaign died without a terminal receipt" | `autopilot.js campaign terminalize` (evidence-gated on provable leaf death: manifest ended, pid gone, worktree gone) appends `MUTATION_FAILED` with the live lease identity **and** releases the Mission claim; `autopilot.js mission withdraw` reachable without raw state plumbing; refuses (named reason) when the leaf is alive/unknown; never a silent no-op. |
| U2 (c) | "Qualification recipes seed staged credentials only when the staged file is absent" | every `docs/plans/evidence/*/administration/*/run.sh` reseeds by sha256 stamp (mismatch → reseed); `plan` mode compares staged vs live and refuses on drift; one shared test covers the block. |
| U3 (d) | "3600 s wall cap is the schema maximum" | `schemas/mission-execution-graph.schema.json` `campaign.max_wall_seconds` maximum raised 3600 → **14400** (CEO decision: 40 % of governance aggregate 36000; reversible); test asserts 14400 accepted / 14401 rejected; docs/BACKLOG updated. |
| U4 (b) | "`mission grant` silently replays a stale claim when the node holds an open `active_claim_id`" | grant on a node with open `active_claim_id` returns `attempt_blocked_by_open_claim` carrying claim id + campaign state instead of `status:"replay"`; fixture drives the exact 2026-08-30 shape. Sequenced after U1 (same state machine; the refusal is only actionable once withdraw exists). |

Success = all four fixtures green + `hooks/tests/run.sh` full suite green + preflight 8/8 + depth-0 qc panel verdict SHIP.

## Governed-rail deviation (recorded, not hidden)

`mission-routing-admission.js --level l4` → READY, but the admitted graph is the previous plan's (`docs/mission-qualification-verdict-stability-execution-graph.json`, 1 deliverable). This work repairs the Mission-managed `engine implement-review` rail itself — running it through that rail would recurse into (a)/(d). Topology therefore: `/l4`-style sonnet foremen in native worktrees driving `dispatch-hetero.sh --runner codex --model gpt-5.3-codex-spark`; merge authority = depth-0 qc panel (`resolve-review-loop.sh` qc seats) + independent re-run, per ADR-0001 and the 2026-08-30 EXECUTION-LOG precedent.

**Board decision 2026-08-31 (option B)**: `dispatch-hetero.sh` hard-refuses any non-projection-bound dispatch while `mission_convergence.enforcement_mode` is `enforce` (BACKLOG "Engine and CLI have no session-mode fallback for bounded non-Mission campaigns"); all three foremen hit `precondition_failed` with `dispatcher_called:false`. The Board chose to set `enforcement_mode` to `shadow` **on this branch only** for the duration of the repair. Exit condition: the mode is restored to `enforce` in the same branch BEFORE merge to develop (finish-flow L-5 checklist item), and the full suite + qc panel run against the restored value. This is a temporarily switched-off gate and is recorded here so it cannot pass as normal.

## Batches

- Batch 1 (parallel, worktrees): U1, U2, U3.
- Batch 2: U4 on top of merged U1.

## Scope boundary (Hold)

Out of scope, stays in BACKLOG: wall-expiry journal disposition + always-write summary JSON (separate row); `initial_state` rename; run.sh TIMEOUT marker; `--require-evidence` standalone; `hooks/tests/run.sh` red rows already resolved.

## Ledger

### Batch 1 (U1/U2/U3) — merged to feat @ `6065aec2`, qc-repaired through `12893a79` (2026-08-31)

- **Foremen**: sonnet ×3, worktree-isolated. Implementer codex `gpt-5.3-codex-spark` via `dispatch-hetero.sh` (U1: 1 effective dispatch, `f997b435`, +415 substance LOC — two out-of-scope hunks in `mission-convergence.js` reverted by the foreman; U2: 3 dispatches r1b/r2/r3 after a first hand-authored attempt was rejected and redone; U3: 1 dispatch `48d37a74`). Each unit's fixture shown RED before implementation.
- **Rail incident**: all three first dispatches died at `precondition_failed: Mission enforce mode requires a sealed campaign strict projection` (`dispatch-hetero.sh` `check_mission_enforcement_gate`, BACKLOG "Engine and CLI have no session-mode fallback"). Board option B → `4c842a92` (shadow, branch-only, restore before merge).
- **Depth-0 qc panel** (`resolve-review-loop.sh` seats, union-on-verified-critical) on `103f0d31..6065aec2` (mirror excluded):
  - MiniMax-M3 FIX-THEN-SHIP — 🟠 withdraw refusal lacks claim_id/phase (**verified**, `7cd8ba46`); 🔵 indent churn (open).
  - gpt-5.6-sol@max FIX-THEN-SHIP — 🟠 terminalize manifest unbound to campaign + worktree only from projection (**verified**, `7ff25507`: `campaign_leaf_manifest_mismatch`, manifest `worktree` must be absent); 🟠 summary written after journal append, retry cannot backfill (**verified**, `7ff25507`: `summary_backfilled`); 🟠 plan mode passes unstamped legacy staged credential (**verified**, `7ff25507`); 🟡 = MiniMax's.
  - GLM-5.2 FIX-THEN-SHIP — 🟡 `--now` parsed never read (**verified**, `e2a712a8`); 🟡 = MiniMax's; 🔵 build outside try/catch + dead test branch (fixed `e2a712a8`); 🔵 last-reference-only worktree proof (mitigated by manifest binding); 🔵 recipe `set -e` propagation of plan refusal untested (open, follow-up); 🔵 indent churn (open).
  - Delta re-review (sol, `6065aec2..e2a712a8`): 🟠 `campaign_unreadable` refusal lacks phase (**verified**, `12893a79`: `phase: null`). Delta-2 (sol, `e2a712a8..12893a79`): **SHIP-AS-IS**.
- **Depth-0 hand repairs** (disclosed): all qc fixes above were applied at depth 0 by the CEO session (codex-spark quota exhausted until 07:37; fix-before-integrate is the depth-0 qc contract). Hunks: `src/mission/cli.js` withdraw refusals (+claim_id/campaign_id/phase), `src/campaign/cli.js` eligibility binding + `backfillCampaignTerminalizeSummary` + `--now` wiring + try/catch move, `scripts/lib/qualify-stage-credentials.sh` plan-mode unstamped drift, fixtures.
- **Shadow-artifact reds (diagnosed, will self-heal at restore)**: with `4c842a92` (shadow) committed, `hooks/tests/autopilot-cli.test.sh` fails 6 strict-L5 assertions (the D3 fixture's `git clone` carries the committed shadow governance, so the session marker admission is SHADOW and strict dev-flow admission refuses: `marker Mission routing is not an enforced READY admission`) and `mission-routing-admission.test.sh` fails 26/39. Rehearsal on HEAD + a restore-enforce commit: both PASS (89 / 39). Not a batch-1 regression; clears at the L-5 pre-merge governance restore.
- **Full-suite triage (three-way control)**: stale mid-flight run showed 10/305 red. Clean rerun + baseline(103f0d31) + rehearsal(HEAD+enforce): `slash-entry-probe` = probe env artifact (SKIP-gated, passes); `codex-plugin-package` = mid-run mirror churn (green at HEAD); 6 suites (`context-window`, `dispatch-author-claude-native`, `dispatch-hetero`, `mission-backlog-convergence`, `mission-terminal-rollover`, `session-mode`) + `autopilot-cli` + `mission-routing-admission` = shadow artifacts (all green under HEAD+enforce, all green at baseline); **`dispatch-contract` Case 4.3 = real batch-1 regression** — the out-of-range budget fixture used `wall_seconds: 5000`, in-range after U3's 14400 ceiling; fixture moved to 15000, suite 316 PASS (fixed on feat).
- **Open follow-ups** (BACKLOG candidates, not blocking): indent churn in `src/campaign/cli.js` ~412-437/598; e2e assertion that a recipe `run.sh` exits non-zero when the lib refuses in plan mode.
