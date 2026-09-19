# Brief C — unit name for this run: `claim-c` (repair: `claim-c-r2`, retry: `claim-c-retry`)
clone = /home/cookys/projects/autopilot-par3/c-claim · base_sha = 1cea5a7ef071824724bcafd16c803679cd953502 (clone HEAD, includes the shadow commit) · run_id = par4-c · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par4/c/run

# A rejected managed intake must either release the Mission claim it holds or name the stranded claim and its recovery — never strand it silently

BACKLOG row: "Managed campaign intake: a rejected intake sometimes releases the Mission claim and sometimes strands it" (read it:
`grep -n "sometimes releases the Mission claim" docs/BACKLOG.md`, pointer sidecar under `docs/backlog/`). Measured 2026-09-11: D1 5 attempts,
3 lost; the next `mission grant` then fails `attempt_blocked_by_open_claim` naming a claim from a rejection that already reported failure.

Facts at base (depth-0 verified; re-verify before coding):
- `src/engine/campaign-intake.js:2120-2154` `releaseAfterRejection` releases (no-effect receipt via `adapters.releaseMission`) for EVERY
  post-claim rejection from `:2156` on — including v2.36.71's `campaign_wall_budget_insufficient_for_repair` (`:2422`). Pre-claim
  rejections correctly release nothing.
- The asymmetry: when the `missionClaim` adapter ITSELF rejects (`:2110-2118`, `missionClaim.status === 'rejected'`) — e.g.
  `mission_grant_ref_mismatch` minted inside `src/engine/mission-convergence.js:4580-4628` after `resolveLiveClaimByGrantRef` found a
  PRIOR attempt's live claim whose subject/campaign_id/base_sha no longer match — intake returns `blocked` and never touches that
  live claim. It stays open in the Mission store → the next grant trips `attempt_blocked_by_open_claim` (`src/mission/runtime.js:1441-1461`).
- Same shape one layer up: `src/engine/autopilot-engine.js:9815-9861` (post-admission grant-ref recheck, comment "Do not release") and
  the guard inside `releaseCampaignNoEffect` (`:9960-9981`) skip the releaser entirely on `mission_grant_ref_mismatch` and record
  nothing actionable.
- `releaseMission` (`mission-convergence.js:4702-4779`) is idempotent and refuses `reconciled`/`terminal` claims
  (`mission_release_not_pre_spawn`); `mission withdraw --never-started true` (`src/mission/cli.js:390-540`) releases a claim only when
  `resolveCampaignForClaim` says the campaign ledger has NO intake root for it (`absent`).

Depth-0 ruling after a hetero consult (gpt-5.6-sol/codex, `consult.json` in the run_dir; question `consult-q.md`): **never
auto-release on an intake rejection** — option (ii). Reason (the consult's): `absent` proves no campaign-ledger intake root but not that
this run owns the mismatched claim or that the rejection was unavoidable; a no-effect release marks the claim released, resets its graph
node to pending and excludes it from consumed gate-attempt counting, so attempt N+1 can be minted freely — exactly the "burns a grant"
class (v2.36.42, `campaign-intake.js:1616-1621`). Only an explicit `mission withdraw` / terminalization may clear a stranded claim.

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


## How you work (foreman rules — identical for every unit)
- You ORCHESTRATE. You never edit code yourself, never merge, never push, never checkout, never `cd` the main
  checkout. All product work is done by ONE hand you dispatch; you verify by git artifacts (`git -C <clone> diff --stat`,
  `git -C <clone> log`, the hand's result JSON), never by its self-report. Depth 0 reaches the verdict from git after you
  finish. Every git/script command runs against YOUR clone: `git -C <clone> …` and `cd <clone> && bash scripts/…`.
- Your clone carries one clone-local commit ("PARALLEL-RUN LOCAL ONLY … enforcement_mode shadow") on top of the base;
  `<base_sha>` for the hand is that clone HEAD (given at the top of the brief). Depth 0 cherry-picks the hand's commit
  only; the shadow commit is never merged. Do not touch `.claude/owner-kernel-governance.json`.
- Hand dispatch (exact form; substitute <unit>, <clone>, <run_dir>, <base_sha>; keep every other flag). Run it with the
  Bash tool's `run_in_background: true` (it takes up to 40 min; a foreground call would time out) and **in the same
  turn** start a dead-man's switch, also `run_in_background: true`: `sleep 3000; echo WAKE-<unit>`. Then END YOUR TURN
  and wait for the harness notification (either one). Never foreground-poll, never `sleep` in the foreground, never
  read the background task's output file with a shell command.
  `cd <clone> && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash scripts/dispatch-hetero.sh --branch hands/<run_id>/<unit> --base <base_sha> --ledger <run_dir>/hands.ledger --run-id <unit> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.dispatch.json 2> <run_dir>/<unit>.dispatch.err; echo "rc=$?" >> <run_dir>/<unit>.dispatch.err`
  Write `<run_dir>/hand-<unit>.md` first (one heredoc): paste the "Product", "Tests", "Verify" and "Allowed files"
  sections below VERBATIM plus: "Commit ONE commit on the branch you are on; do not touch other files; do not run sync
  scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the
  mirror in the same commit if it changed; run every verify command in the foreground before committing (each with `< /dev/null`); every NEW `*.test.sh` you create must be `chmod +x` and must pass `test -x` — `run.sh` refuses 100644 suites; never set
  `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run."
  On ANY wake (notification or dead-man): first `grep -c '^rc=' <run_dir>/<unit>.dispatch.err`. If 0 the hand is
  still running (the dispatch is detached and lands its result in the ledger even if the shell was killed): run
  `cd <clone> && node scripts/wait-dispatch-results.js --ledger <run_dir>/hands.ledger --expect <unit>.implement --timeout 500 --json`
  in the foreground once; if it reports landed, read the result from the ledger/dispatch JSON; if not, start another
  background dead-man (`sleep 1500; echo WAKE-<unit>`) and end your turn — at most 3 extra waits, then ESCALATION.md.
  When the result is there: read `<run_dir>/<unit>.dispatch.json` with `head -c 3000` (status, branch, head sha, acceptance) — never
  the raw hand log. `status: implemented` + `git -C <clone> log --oneline <base_sha>..hands/<run_id>/<unit>` showing
  exactly one commit is the only success signal.
- Review (decorrelated family, required before you report done): produce the diff with
  `git -C <clone> diff <base_sha>..hands/<run_id>/<unit> > <run_dir>/<unit>.diff` and run (also `run_in_background`
  + a `sleep 1200; echo WAKE-review-<unit>` dead-man; append `; echo "rc=$?" >> <run_dir>/<unit>.review.err` the same way):
  `cd <clone> && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <run_dir>/<unit>.diff --spec-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.review.json 2> <run_dir>/<unit>.review.err`
  Read the verdict with `node -e` printing only `verdict`, and each finding's severity + title (never the whole JSON).
  If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on branch
  `hands/<run_id>/<unit>-r2` with `--base <head sha of hands/<run_id>/<unit>>` and `--run-id <unit>-r2`, prompt =
  the original hand prompt + "## Repair round — fix these review findings" listing them verbatim; re-review the delta
  (`git diff <r1 head>..hands/<run_id>/<unit>-r2`). At most one repair round; then report.
- Budget: 40 Bash calls total (a guard denies the 41st). Plan them: write prompt (1), dispatch+deadman (2), read
  result (1), log/diff-stat (2), review+deadman (2), read verdict (1), optional repair (6), report (1). Do NOT read
  large files into your context; use `head`/`grep -n`/`sed -n`.
- If the hand fails before committing (precondition_failed, transport error, acceptance_failed with no commit), read
  `<unit>.dispatch.err` tail and the failure reason, then dispatch ONE retry with the same prompt plus the failure
  reason appended (`--run-id <unit>-retry`, branch `hands/<run_id>/<unit>-retry`). Two failures ⇒ write ESCALATION.md
  (exact reason, what you tried) and stop.
- Before you write REPORT.md, run the consumer sweep yourself (evidence-discipline §37/§39) in ONE Bash call: `cd <clone> && for s in $(grep -l '<identifiers the hand renamed/added/removed>' hooks/tests/*.test.sh | grep -v -e <each Verify suite>); do bash "$s" > <run_dir>/sweep.$(basename $s).log 2>&1 < /dev/null; echo "rc=$? $s"; done > <run_dir>/sweep.txt`; then `grep -v '^rc=0' <run_dir>/sweep.txt` and list the red ones in REPORT.md with their failing assertion names (`grep ^FAIL`). Do not fix them yourself; depth-0 decides.
- REPORT.md (write to `<run_dir>/REPORT.md`, ≤ 80 lines) must name: hand branch(es) and head sha(s), `diff --stat`
  vs base, the review verdict and every finding with accepted/refuted + one line why, the verify commands' tail lines
  as recorded in the dispatch JSON, anything NOT done, and any BACKLOG-row text you found to be wrong. Your final
  message to depth 0 is the REPORT.md content verbatim, nothing else.
