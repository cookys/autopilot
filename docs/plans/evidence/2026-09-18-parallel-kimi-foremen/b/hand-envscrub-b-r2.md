# Repair hand — envscrub-b-r2

You are on branch `hands/par2-b/envscrub-b-r2`, based at `810a36226085b9e1af73e2f9d89de7c87070c3d4` (head of `hands/par2-b/envscrub-b`, which already implements the AUTOPILOT_SESSION_ID scrub). A hetero review returned FIX-THEN-SHIP with these findings — address them, verbatim:

🟠 [envscrub-test-receipt-fingerprint] MUST-FIX The spec's new case requires two assertions the diff omits: (a) the receipt's `env_fingerprint` equals the fingerprint computed without the variable, and (b) other variables are untouched. The case in `hooks/tests/autopilot-engine.test.sh` only fingerprints the captured `args.env` and never reads the receipt produced by the loop, and it never asserts that any sibling variable (e.g. `CLAUDE_CODE_SESSION_ID`, `PATH`) survives the scrub, so a regression that scrubbed too much or wrote a stale fingerprint into the receipt would still print `envscrub_session_id=true`. Smallest remediation: in `collect`, read the verification receipt from `result` (the same receipt other cases in this NODE block inspect) and `assert.strictEqual(receipt.env_fingerprint, expectedFp)`; set e.g. `process.env.CLAUDE_CODE_SESSION_ID`/keep `PATH` and assert they are present and equal in `capturedVerifyEnv`.

🔵 [envscrub-10043-unfrozen-copy] CUT/FOLLOW-UP The ~:10043 `verifyCommandRunner` call did not pass `env` at base; the diff adds `env: copyVerificationEnvironment(input)`, a fresh copy taken at spawn time rather than the frozen `verificationEnvironment` whose fingerprint is recorded at ~:6970. Under the allowlist this is byte-identical in practice, and the spec's "same object" wording assumed the call already passed the env, so not blocking; worth confirming `input` is in scope at that site and, if `verificationEnvironment` is reachable, passing the frozen object instead so the spawn and the fingerprint observe identical material.

🔵 [envscrub-other-suite-pins] CUT/FOLLOW-UP Item 2 asks for the pin in any other verify-list suite that seals a marker without pinning; the diff pins only `mission-runtime-v2.test.sh`. No evidence in the diff that `implementation-campaign-routing.test.sh` / `autopilot-engine.test.sh` were grepped and found clean; not blocking since the spec's `AUTOPILOT_SESSION_ID=zzz` verify command only names `mission-runtime-v2`, but note the grep result in the commit message.

Guidance:
- Fix the 🟠 exactly as the remediation describes: assert the receipt's `env_fingerprint` (from the loop `result`) equals the fingerprint computed without the variable, and assert a sibling variable (set `process.env.CLAUDE_CODE_SESSION_ID` to a sentinel for the duration, restore in `finally`) survives verbatim in `capturedVerifyEnv`.
- For the first 🔵: if `verificationEnvironment` is reachable at the ~:10043 site in `src/engine/autopilot-engine.js`, pass that frozen object instead of a fresh copy; if it is not reachable without refactoring, leave the fresh copy and say so in the commit message. Mirror whatever you do through the sync script.
- For the second 🔵: run the grep (`grep -n 'sealSessionMarker\|session-mode' hooks/tests/*.test.sh` cross-checked with `AUTOPILOT_SESSION_ID`) over the verify-list suites; pin any suite that seals a marker and does not already pin (same two-line pattern as mission-runtime-v2); record the grep outcome in the commit message.
- Do not weaken existing assertions. Keep the RED comments.

## Allowed files

`src/engine/autopilot-engine.js` (+ its codex twin via the sync script), `hooks/tests/autopilot-engine.test.sh`, `hooks/tests/mission-runtime-v2.test.sh`, and other `hooks/tests/*.test.sh` ONLY for the session-id pin. Nothing else; nothing created. Do not touch `scripts/session-mode.js` or `src/engine/campaign-verification.js`.

## Verify (foreground, all exit 0; then ALSO `AUTOPILOT_SESSION_ID=zzz bash hooks/tests/mission-runtime-v2.test.sh` exit 0)

```
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Working rules

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit; run every verify command in the foreground before committing.
