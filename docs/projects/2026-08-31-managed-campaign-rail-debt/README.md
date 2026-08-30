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

## Batches

- Batch 1 (parallel, worktrees): U1, U2, U3.
- Batch 2: U4 on top of merged U1.

## Scope boundary (Hold)

Out of scope, stays in BACKLOG: wall-expiry journal disposition + always-write summary JSON (separate row); `initial_state` rename; run.sh TIMEOUT marker; `--require-evidence` standalone; `hooks/tests/run.sh` red rows already resolved.

## Ledger

(filled at phase boundaries)
