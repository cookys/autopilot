# REPORT — run par2-b, unit `envscrub-b`

Verdict input for depth 0: implementation complete, reviewed (FIX-THEN-SHIP → one repair round → SHIP-AS-IS), full verify list re-run by me on the final branch — all green, including `AUTOPILOT_SESSION_ID=zzz`.

## Branches / heads

- `hands/par2-b/envscrub-b` @ `810a36226085b9e1af73e2f9d89de7c87070c3d4` (r1, base `d3ed3f818b2c42fb4b3dad437538faddcf0decce`), runner cursor/cursor-grok-4.6-low, exit 0, wall 668s.
- `hands/par2-b/envscrub-b-r2` @ `1ff2fed841641b64567eb9e4902acdb45045c0cf` (repair, base = r1 head), exit 0, wall 716s. **Final head.**

## diff --stat vs base (`d3ed3f8..hands/par2-b/envscrub-b-r2`)

```
 hooks/tests/autopilot-engine.test.sh               | 84 ++++++++++++++++++++--
 hooks/tests/mission-runtime-v2.test.sh             |  2 +
 platforms/codex/plugin/src/engine/autopilot-engine.js | 11 +++-
 src/engine/autopilot-engine.js                     | 11 +++-
 4 files changed, 101 insertions(+), 7 deletions(-)
```

All four files are inside the allowed-files list; nothing else created or touched.

## Reviews

- r1 review (`envscrub-b.review.json`, claude-fable-5-1 high): **FIX-THEN-SHIP**.
  - 🟠 `envscrub-test-receipt-fingerprint` — ACCEPTED as real: spec required asserting the receipt's `env_fingerprint` and sibling-variable survival; the r1 test did neither. Fixed in r2 exactly per remediation (receipt fingerprint from loop `result` asserted; `CLAUDE_CODE_SESSION_ID` sentinel + `PATH` survival asserted, both restored in `finally`).
  - 🔵 `envscrub-10043-unfrozen-copy` — accepted as non-blocking; r2 left the fresh `copyVerificationEnvironment(input)` copy at the spawn site (byte-identical under the allowlist); no engine change in the delta.
  - 🔵 `envscrub-other-suite-pins` — accepted as non-blocking; r2 added no further pins, implying the grep found no other verify-list suite sealing a marker without pinning (the hand's commit message is the generic dispatch-hetero one, so the grep outcome is not recorded in git — cosmetic only).
- r2 delta review (`envscrub-b-r2.review.json`): **SHIP-AS-IS**, only 🔵 follow-ups (receipt-finder heuristic readability; commit-message notes) — both explicitly excluded by the reviewer as non-concrete. No further repair round dispatched (one-round budget used).

## Verify (run by me, foreground-equivalent batch, on the r2 worktree `/tmp/hetero-hands-par2-b-envscrub-b-r2-oXOkFP` @ `1ff2fed8`)

```
bash hooks/tests/autopilot-engine.test.sh                → PASS [autopilot-engine] 574 assertions, exit=0
bash hooks/tests/mission-runtime-v2.test.sh              → PASS [mission-runtime-v2] 103 assertions, exit=0
bash hooks/tests/implementation-campaign-state.test.sh   → PASS [implementation-campaign-state] 298 assertions, exit=0
bash hooks/tests/implementation-campaign-routing.test.sh → PASS [implementation-campaign-routing] 116 assertions, exit=0
bash scripts/sync-codex-plugin-skills.sh --check         → exit=0
node scripts/check-js-syntax.js                          → exit=0
AUTOPILOT_SESSION_ID=zzz bash hooks/tests/mission-runtime-v2.test.sh → PASS [mission-runtime-v2] 103 assertions, exit=0
```

Full log: `verify-tails.txt` in this directory. Acceptance met: a dispatcher-exported `AUTOPILOT_SESSION_ID` no longer turns the suite red.

## What was done

- Engine: `copyVerificationEnvironment()` helper in `src/engine/autopilot-engine.js` deletes `AUTOPILOT_SESSION_ID` only (one-line 2026-09-18 incident comment); used at the freeze site (~:6970) and at the ~:10043 `verifyCommandRunner` spawn; codex mirror regenerated via the sync script in the same commit.
- Suite pin: `mission-runtime-v2.test.sh` pins `delete process.env.AUTOPILOT_SESSION_ID; process.env.CLAUDE_CODE_SESSION_ID = 'mission-runtime-v2-sess'` at the top of the node block.
- Tests: new injected-`verifyCommandRunner` case in `autopilot-engine.test.sh` with the RED-at-base comment, env-scrub assertion, clean/dirty fingerprint byte-identity pin, receipt `env_fingerprint` assertion, and sibling-survival assertions.

## Not done

- The ~:10043 spawn site passes a fresh scrubbed copy rather than the frozen `verificationEnvironment` object (🔵 follow-up; behaviorally identical under the fingerprint allowlist).
- Hand commit messages are the generic `dispatch-hetero(cursor)` form; the before/after RED counts and the other-suite grep outcome requested for the commit message live in the test comments and this report instead of git history.
