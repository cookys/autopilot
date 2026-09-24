# mrce wave-1b — REPORT

## Unit
mrce (managed-rail-core-engine), wave-1b, rows in scope: 15 (per WAVE-1b OVERRIDES; all other rows of this
bundle already landed in wave-1).

## Row 15 — non-git `--repo` consumes a Mission claim before intake rejects it

### Premise check (base 475ebdc78ac9c0494c8c1fb794de45e763fc3599, branch w1b-base)
Confirmed present at base. In `src/engine/campaign-intake.js`:
- `canonicalRepoIdentity(repo)` (imported from `scripts/implementation-campaign-check.js`) is invoked ONLY inside
  the `if (input.resume === true)` durable-wait preflight block (~line 2181), never on the normal/non-resume path.
- The Mission claim (`missionClaimAdapter(...)`) is constructed unconditionally at ~line 2243-2246, with no prior
  repo-identity check guarding it on the non-resume path.
- `inspectSealedCampaignContract` (the repo-identity-dependent contract check) runs much later, ~line 2491 —
  after the claim.
- Confirmed via `grep -n canonicalRepoIdentity|inspectSealedCampaignContract|missionClaimAdapter
  src/engine/campaign-intake.js` and reading the surrounding code (lines 2160-2520).

Defect current file:line: `src/engine/campaign-intake.js:2243` (claim construction) precedes any repo-identity
check for the non-resume path. Brief's line numbers (~2246, ~2491) matched the current tree; no re-derivation of
`Allowed files` was needed.

### Hand dispatch attempt
Wrote `run-mrce/hand-15.md` (Product/Tests/Verify/Allowed files verbatim from the row brief, plus a concrete
rejection-shape instruction: mirror the adjacent `missionClaimAdapter` catch — category `'mission'`, code
`'mission_repo_identity_invalid'` unless the thrown error carries its own `.code` — since the brief's own
wording, "the same rejection shape/code intake already uses for that failure," did not resolve to a single
existing call site verbatim; the nearest structural precedent is that adjacent block).

Ran (foreground, per override §6 env hygiene):
```
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-hetero.sh \
  --branch hands/w1b-mrce/15 --base 475ebdc78ac9c0494c8c1fb794de45e763fc3599 \
  --ledger run-mrce/hands.ledger --run-id w1b-mrce-15 --stage implement \
  --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m \
  --prompt-file run-mrce/hand-15.md
```

Result — the rail itself refused before resolving a runner or making any model call:
```json
{ "status": "precondition_failed", "runner": "unresolved", "model": "cursor-grok-4.6-low",
  "branch": "hands/w1b-mrce/15", "base": "475ebdc78ac9c0494c8c1fb794de45e763fc3599", "commit": null,
  "files_changed": 0, "insertions": 0, "deletions": 0, "worktree": null, "agent_log": null,
  "error": "Mission enforce mode requires a sealed campaign strict projection",
  "dispatcher_called": false, "model_calls": 0, "mutation_attempts": 0, "gate_attempts": 0,
  "resources_created": 0, "run_id": "w1b-mrce-15" }
```
`dispatcher_called: false`, `model_calls: 0` — no hand ever ran, no commit was ever attempted. This is a rail
precondition failure (`die_precondition` in `scripts/dispatch-hetero.sh` around its Mission-mode gate at
~line 1580), not a model/quota/auth failure, but it fits override §4's rule verbatim: "the hand rail itself
fails before producing a commit ... stop that row ... and continue — do NOT author the code yourself." No repair
or manual authoring was attempted.

### First dispatch attempt — superseded
**RAIL-FAIL 15 precondition_failed "Mission enforce mode requires a sealed campaign strict projection"**
(base 475ebdc78ac9c0494c8c1fb794de45e763fc3599). `dispatcher_called: false`, `model_calls: 0`, `commit: null` — the
rail refused before resolving a runner. Depth-0 fixed this with a clone-local shadow commit
(`d3ff6b678f057513c1c5a306cbf284f3d9ced592`, "PARALLEL-RUN LOCAL ONLY — mission_convergence enforcement_mode
shadow (never land)") and instructed a redo from the dispatch step with the new base. `.claude/owner-kernel-governance.json`
was not touched. The shadow commit is clone-local only and must never land; only the hand's own commit is
cherry-picked/landed by depth-0.

### Redo — dispatch, verify, review (base d3ff6b678f057513c1c5a306cbf284f3d9ced592)
Re-ran the identical hand prompt (`run-mrce/hand-15.md`, unchanged) via `dispatch-hetero.sh` with
`--base d3ff6b678f057513c1c5a306cbf284f3d9ced592`, backgrounded automatically by the harness (>120s), and picked
up the result from the background-task notification (no manual sleep timer — this environment's Bash tool blocks
long leading `sleep` commands even under `run_in_background`; the auto-backgrounded dispatch call itself served
as the dead-man/notification mechanism).

Result: `status: "committed"`, `runner: "cursor"`, `model: "cursor-grok-4.6-low"`, branch `hands/w1b-mrce/15`,
commit `b1c1465c9a8d907b8b13f03f85c0db699f28338e`, `files_changed: 3, insertions: 104, deletions: 0`,
`dispatcher_called: true`, `model_calls: 1`, wall time 373s.

`git diff d3ff6b67..hands/w1b-mrce/15 --stat`:
```
hooks/tests/managed-rail-core-engine.test.sh                 | 72 ++++++++++++++++++++++
platforms/codex/plugin/src/engine/campaign-intake.js         | 16 +++++
src/engine/campaign-intake.js                                | 16 +++++
3 files changed, 104 insertions(+)
```
Matches Allowed files exactly (no `scripts/implementation-campaign-check.js` export was needed —
`canonicalRepoIdentity` was already imported into `campaign-intake.js`).

Product diff: inserted, immediately before `const missionClaimAdapter = adapters.missionClaim || defaultMissionClaim;`
(i.e. after the resume-preflight block, running unconditionally for both resume and non-resume calls):
```js
try {
  canonicalRepoIdentity(repo);
} catch (error) {
  const rejection = rejected(
    'mission',
    (error && error.code) || 'mission_repo_identity_invalid',
    (error && error.message) || String(error),
  );
  return {
    status: 'blocked',
    reason: rejection.reason,
    rejection,
    steps: [rejection],
    pre_spend_no_effect_receipt: null,
  };
}
```
Identical change applied to `src/engine/campaign-intake.js` and its codex mirror
`platforms/codex/plugin/src/engine/campaign-intake.js` (byte-identical diffs). `missionClaimAdapter` is never
reached when this check fails; the claim adapter, sealed-contract inspection, and every other rejection path are
untouched.

Test: appended `assert_mission_claim_skips_non_git_repo` to `hooks/tests/managed-rail-core-engine.test.sh` — a
non-git temp dir as `--repo` with a stubbed `missionClaim` asserting 0 calls and `status: 'blocked'`, plus a git
fixture control asserting `>= 1` call, with temp-dir cleanup. RED comment recorded: `# RED at
d3ff6b678f057513c1c5a306cbf284f3d9ced592: ... non-git missionClaim calls=1 ... 30 passed, 3 failed`.

### Verify (run in the hand's own worktree `/tmp/hetero-hands-w1b-mrce-15-eAIGwd`, env-hygiene prefixed/suffixed)
- `hooks/tests/managed-rail-core-engine.test.sh` → `PASS [managed-rail-core-engine] 33 assertions` (includes the
  new row-15 case and its git-fixture control).
- All 15 other suites found via `grep -l runCampaignIntake hooks/tests/*.sh tests/ -r`, run one at a time:
  `autopilot-engine-repair-branch`, `autopilot-engine-wall-expiry` (17), `campaign-intake-rejection-release` (15),
  `autopilot-engine-park-reserve` (5), `autopilot-engine` (581), `mission-enforce-failclosed` (8),
  `mission-routing-campaign-bridge` (40), `mission-runtime-v2` (103), `implementation-campaign-state` (301),
  `mission-enforce-roundtrip` (16), `implementation-campaign-state-snapshot-contract` (2),
  `implementation-campaign-state-park` (14), `mission-icc-runtime` (81), `implementation-campaign-dogfood` (21)
  — all `PASS`.
  One suite, `implementation-campaign-routing.test.sh`, reported `FAIL … 114 passed, 2 failed` on
  `defaultCleanroomProbe` stub assertions carrying their own pre-existing `RED at base 130b97a8: function
  missing` comment. Confirmed unrelated to this row: the test file is byte-identical between the base commit and
  the hand's branch (row 15 never touched it), and `defaultCleanroomProbe` is exported from
  `src/engine/campaign-intake.js` (line 2802) unchanged by this diff — this is a pre-existing stacked/unrelated
  red, not something row 15's hand introduced or was responsible for fixing. Not counted against this row.
- `bash scripts/sync-codex-plugin-skills.sh --check` → `Codex plugin payload in sync: platforms/codex/plugin` (rc=0).

### Review
`dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m` against
`hands/w1b-mrce/15` vs `d3ff6b67` diff and `hand-15.md` spec.

Verdict: **SHIP-AS-IS**. Sole finding: 🔵 `red-sha-vs-spec-base` — the RED comment records base `d3ff6b67`
(the actual worktree base used) while the spec text cites `475ebdc7` (the row brief's original base before the
shadow-commit rebase); a provenance-note mismatch only, the recorded RED output itself (claim calls=1, 30
passed/3 failed) is consistent with the described pre-fix behavior. Accepted as non-blocking — correctly a 🔵
Suggestion, does not affect correctness, no repair dispatched.

### Verdict
**LAND 15 b1c1465c9a8d907b8b13f03f85c0db699f28338e**

### Not done
- No repair round was needed (SHIP-AS-IS on first review).
- The pre-existing `implementation-campaign-routing.test.sh` `defaultCleanroomProbe` red is unrelated to this row
  and was left as-is per scope (`Allowed files` for row 15 does not include that test file or the probe code).
- No other rows were in scope for this foreman (all other mrce rows already landed in wave-1 per the unit header).
- The clone-local shadow commit `d3ff6b678f057513c1c5a306cbf284f3d9ced592` must not be landed; depth-0 should
  cherry-pick only commit `b1c1465c9a8d907b8b13f03f85c0db699f28338e` (or the `hands/w1b-mrce/15` branch tip) onto
  the real integration base.
