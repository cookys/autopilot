## Plan
# Plan C — a rejected intake never strands a claim silently (consult ruling: never auto-release)
1. RED: grant → move HEAD → intake rejects mission_grant_ref_mismatch → result/journal carry nothing about claim A → next grant attempt_blocked_by_open_claim with no recovery hint.
2. One exported helper at both layers: never release; emit + journal stranded_claim {ids, resolution from resolveCampaignForClaim, exact recovery command}.
3. attempt_blocked_by_open_claim detail carries recovery; exact-replay path untouched; releaseMission refusals untouched.
4. New suite (+x) pinning: no no_effect_release, claim live, next grant blocked WITH recovery, withdraw --never-started then frees it; mirrors; verify; ONE commit.
Acceptance: the 2026-09-11 shape tells the operator exactly what to run, and nothing mints attempt N+1 without an explicit withdraw.

## Product
1. RED first (model: `hooks/tests/mission-grant-open-claim.test.sh` — `attempt1-claimed` `:216`, `open-claim-blocks-not-replays` `:232`,
   harness `check()` + final assert loop `:257-270`): grant attempt 1 (claim A, base X); move HEAD; run `campaignIntake` with the same
   `grant_ref` so the adapter rejects `mission_grant_ref_mismatch`; at base assert (a) the intake result and steps carry NO `stranded_claim` (nothing names claim A or a recovery), (b) claim A is
   still live (`released: falsy`) — this part is CORRECT and must stay true after the fix, (c) a second `grant` on the moved HEAD fails
   `attempt_blocked_by_open_claim` naming claim A with NO `recovery` field. Record the observed outputs in RED comments.
2. Fix — one rule, applied at both layers (`campaign-intake.js` `:2110-2118` branch, and `autopilot-engine.js` `releaseCampaignNoEffect`
   guard `:9960-9981` + the `:9815-9861` recheck): when a rejection leaves a live claim that this run will not use, do NOT release it
   (no `no_effect_release` event, claim stays live with its reservation and node binding) — but the rejection result MUST carry
   `stranded_claim: { claim_id, campaign_id, graph_node_id, base_sha, resolution: 'absent'|'ticket_present'|'unknown_v2' (from
   `resolveCampaignForClaim`), recovery: '<exact mission withdraw --never-started … / terminalize command for that resolution>' }` and
   the same block is journaled in the intake steps — no silent skip, ever. Both layers emit the identical shape from ONE exported
   helper (no second implementation). The "Do not release" comments stay and gain a pointer to the helper.
3. `attempt_blocked_by_open_claim` (`src/mission/runtime.js:1441-1461`) detail gains the same `recovery` string so the operator who
   hits it next has the verb in hand. No change to the exact-replay path (`exact-replay-preserved-when-head-unchanged` must stay green).
4. Keep every other rejection path byte-identical; do not weaken `releaseMission`'s refusal of `reconciled`/`terminal` claims.
   Codex mirrors of every touched file via `bash scripts/sync-codex-plugin-skills.sh` (same commit). If a schema with
   `additionalProperties:false` (e.g. `schemas/mission-convergence-receipt.schema.json`) blocks the new optional field, add it AND
   its twin in the same commit.

## Tests (RED-first, `# RED at <base sha>: …` beside each new assertion; never weaken an existing one)
- NEW suite `hooks/tests/campaign-intake-rejection-release.test.sh` (chmod +x; copy the prologue/harness of `mission-grant-open-claim.test.sh`):
  the RED case → GREEN (pin exactly what the consult asked): `mission_grant_ref_mismatch` with `resolution: absent` emits `stranded_claim`
  + exact recovery, creates NO `no_effect_release`, leaves claim A live with its reservation and active node binding, and the next
  grant fails `attempt_blocked_by_open_claim` carrying the same `recovery`; a `ticket_present` variant emits the matching recovery
  (terminalize path); an explicit `mission withdraw --never-started true` on the absent case then frees the node (existing CLI, do not change it).
- `hooks/tests/mission-grant-open-claim.test.sh`: unchanged cases stay green (exact replay preserved).

## Verify (foreground, each with `< /dev/null`, all exit 0)
```
bash hooks/tests/campaign-intake-rejection-release.test.sh
bash hooks/tests/mission-grant-open-claim.test.sh
bash hooks/tests/campaign-claim-resolve.test.sh
bash hooks/tests/mission-routing-campaign-bridge.test.sh
bash hooks/tests/mission-convergence.test.sh
bash hooks/tests/mission-enforce-failclosed.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(`hooks/tests/mission-runtime-v2.test.sh`, `mission-icc-runtime.test.sh`, `mission-convergence-integration.test.sh`: run, record failing
assertion names before/after, set must not grow.)

## Allowed files
`src/engine/campaign-intake.js`, `src/engine/mission-convergence.js`, `src/engine/autopilot-engine.js` (ONLY `:9815-9861` and
`releaseCampaignNoEffect` `:9942-9990`), `src/mission/runtime.js` (ONLY the `attempt_blocked_by_open_claim` detail), `src/campaign/cli.js`
(only if `resolveCampaignForClaim` needs an export), `schemas/mission-convergence-receipt.schema.json`, their codex twins via the sync
script, `hooks/tests/campaign-intake-rejection-release.test.sh` (new). Nothing else; do not touch `src/mission/cli.js` (withdraw) or any
wall/park/boundary code.



## Hand instructions
Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by
hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it
changed; run every verify command in the foreground before committing (each with `< /dev/null`); every NEW `*.test.sh`
you create must be `chmod +x` and must pass `test -x` — `run.sh` refuses 100644 suites; never set
`AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.
