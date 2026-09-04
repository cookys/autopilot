# dev-flow hetero loops as default

**Plan**: [`docs/plans/2026-09-04-dev-flow-hetero-loops-default.md`](../../plans/2026-09-04-dev-flow-hetero-loops-default.md)
**Branch**: `feat/dev-flow-hetero-loops` · **Target**: v2.36.0 (MINOR: new skill `hetero-review`)
**Requested**: owner, 2026-09-04, this host ("預設 dev-flow 就是走 plan hetero loop review → 派工 → hetero review → qc gate", go)
**Status**: D0–D4 integrated; driver `--exclude` cut (fix4c) and D5-integration (suite repin) in flight; core hetero review to re-run after fix4; D5 pending

## Topology of this project's own execution (dogfood)

Depth-0 (Fable) briefs, adjudicates, runs qc and merges; foremen are **sonnet** (`/l4`-shaped,
worktree-isolated, one deliverable per life, Bash cap 40); implementation cuts go to
**`gemini-3.8-flash-low @ agy`, effort low** (qualified implementer seat, scorecard event 188) through
`scripts/dispatch-hetero.sh`, climbing one rung on red; every dispatch prompt's first line names the
engine; verification is by git artifacts only.

**Board decision 2026-09-04 (same shape as `5ca93e08`)**: `mission_convergence.enforcement_mode` is
`shadow` **on this branch only** because the sealed L5 rail is bound to the verdict-stability graph and
`dispatch-hetero.sh` hard-refuses raw dispatch under `enforce`. Exit condition: restored to `enforce`
in this branch BEFORE merge to develop; full suite + qc panel run against the restored value. The
dogfood roster's implementer tuple is switched to the gemini seat for the same window and restored to
`grok-4.5 / high / grok` at closeout. Both are temporarily switched-off gates recorded here so they
cannot pass as normal.

## Phases

| # | Deliverable | Size | Status |
|---|---|---|---|
| D0 | Plan loop on the plan itself (sol@codex max chair, GLM-5.2@cc-shim, MiniMax-M3@cc-shim; 2 generations; 21 blockers folded; frozen by depth-0) | S | ✅ |
| D1 | Topology roles (`--role plan_reviewer\|reviewer\|consult\|discuss`) + resolver `auto` knobs (`plan_review`, `hetero_review`, `consult_dispatch`); kimi runner cut by plan review | M | ✅ (2e repair pending) |
| D2 | `plan-rubric-scaffold.js`, `hetero-review-loop.js`, `check-phase-review-receipt.js` + tests; D2-repair after the first real three-seat review (14 MUST-FIX folded) | L | ✅ |
| D3 | `hetero-review` skill + dev-flow (733→727) / ceo-agent (550→542) / research-to-ship / front-door edits + profiles repin (sonnet hands after 3 gemini fails) | M | ✅ |
| D4 | Consult decoupling, agent-call description, evidence-discipline rows, hermetic consult test | M | ✅ |
| D5-integration | Full-suite regressions after the D1 resolver contract change (25 red files: engine REVIEW_LOOP_FIELDS, contract parity, dispatch-contract checker, skill-count pins; precedent 68e142c0) | M | 🔄 |
| D5 | Release v2.36.0: CHANGELOG, README/INDEX/mirrors, archive | S | ⏳ |

## Ledger

Execution records go in `ledger/` (never in the plan file).
