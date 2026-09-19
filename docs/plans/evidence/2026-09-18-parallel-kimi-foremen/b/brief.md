# Brief B — unit name for this run: `envscrub-b` (repair: `envscrub-b-r2`)

# Brief B — the managed rail's verification runs must not inherit the dispatcher's session identity

BACKLOG row: "Test suites inherit the dispatcher's session env: `AUTOPILOT_SESSION_ID` makes `mission-runtime-v2` red
in-rail". Fired 2026-09-18: depth-0 exported `AUTOPILOT_SESSION_ID` when launching `engine implement-review`; the
rail's acceptance/verify station spawned `hooks/tests/mission-runtime-v2.test.sh`, whose engine-under-test resolved
its session marker through `scripts/session-mode.js` `getSessionId()` (`AUTOPILOT_SESSION_ID` > `CLAUDE_CODE_SESSION_ID`
> … > cwd) and read the LIVE marker of the dispatcher's session instead of the suite's own sealed marker
(`sealSessionMarker({ sessionId: 'mission-runtime-v2-sess' })`, ~:236) → 50/53 assertions red, the campaign died at
acceptance. The same suite goes red on develop under that variable; it is green without it.

## Product
1. `src/engine/autopilot-engine.js` ~:6965 `verificationEnvironment = { ...(input.verificationEnv || process.env) }`:
   after the copy, delete `AUTOPILOT_SESSION_ID` ONLY (the dispatcher's explicit override; `CLAUDE_CODE_SESSION_ID`
   and the other harness ids stay — depth-0's base-suite records are taken with them present and must keep matching
   the rail). Do it once, in one place, with a one-line comment naming the 2026-09-18 incident. `environmentFingerprint` is computed from the
   scrubbed copy (its allowlist never contained these names, so the fingerprint of an already-clean environment is
   byte-identical — pin that in the test). The scrub applies to every call of `this.verifyCommandRunner` that passes
   `verificationEnvironment` (~:7889, ~:8092, ~:10035 — check all three take the same object).
2. `hooks/tests/mission-runtime-v2.test.sh`: pin its own session identity at the top of the node block exactly as
   `hooks/tests/implementation-campaign-state.test.sh` ~:1945 does (`delete process.env.AUTOPILOT_SESSION_ID;
   process.env.CLAUDE_CODE_SESSION_ID = 'mission-runtime-v2-sess'` — the same id the suite seals), so the suite is
   green regardless of the caller's environment. Do the same in any other suite in the verify list below that seals a
   marker and does not already pin (grep `sealSessionMarker\|session-mode` and `AUTOPILOT_SESSION_ID`).
3. Codex mirror of `autopilot-engine.js` via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first: run each new case against the unmodified code, record the observed output in a
`# RED at <base sha>: …` comment beside the assertion; never weaken an existing assertion)
- `hooks/tests/autopilot-engine.test.sh`: a case that runs a managed loop with an injected `verifyCommandRunner`
  capturing `env`, with `process.env.AUTOPILOT_SESSION_ID = 'dispatcher-session'` set for the duration: the captured
  env has NO `AUTOPILOT_SESSION_ID` (other variables untouched), and the
  receipt's `env_fingerprint` equals the fingerprint computed without the variable (RED at base: the captured env
  carries `dispatcher-session`). Find an existing injected-runner case to copy the harness from.
- `hooks/tests/mission-runtime-v2.test.sh`: run it once with `AUTOPILOT_SESSION_ID=some-other-session` exported in
  the shell — RED at base: red; GREEN after the pin. Record the before/after counts in the commit message.

## Verify (foreground, all exit 0; then ALSO `AUTOPILOT_SESSION_ID=zzz bash hooks/tests/mission-runtime-v2.test.sh` exit 0)
```
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Allowed files
`src/engine/autopilot-engine.js` (+ its codex twin via the sync script), `hooks/tests/autopilot-engine.test.sh`,
`hooks/tests/mission-runtime-v2.test.sh`, and other `hooks/tests/*.test.sh` ONLY for the session-id pin of item 2.
Nothing else; nothing created. Do not touch `scripts/session-mode.js` or `src/engine/campaign-verification.js`.

## How you work (foreman rules — identical for every run)
- You ORCHESTRATE. You never edit code yourself, never merge, never push, never checkout. All product work is done by
  ONE hand you dispatch; you verify by git artifacts (`git -C <wt> diff --stat`, the hand's result JSON), never by its
  self-report. Depth 0 (the dispatcher) reaches the verdict from git after you finish.
- Hand dispatch (exact form; <unit> is the unit name given at the top of this brief — globally unique, the dispatch
  run manifests live in one shared directory; keep every other flag):
  `<rail>/dispatch-hetero.sh --branch hands/<run_id>/<unit> --base <base_sha> --ledger <run_dir>/hands.ledger --run-id <unit> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file <run_dir>/hand-<unit>.md`
  Write `<run_dir>/hand-<unit>.md` first: paste the "Product", "Tests", "Verify" and "Allowed files" sections below
  VERBATIM plus: "Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on
  the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in
  the same commit; run every verify command in the foreground before committing."
  Then wait: `node <rail>/wait-dispatch-results.js --ledger <run_dir>/hands.ledger --expect <unit>.implement`
  (never a shell sleep loop).
- Review (decorrelated family, required before you report done): produce the diff with
  `git -C <your worktree> diff <base_sha>..hands/<run_id>/<unit> > <run_dir>/<unit>.diff` and run
  `<rail>/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <run_dir>/<unit>.diff --spec-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.review.json`.
  If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on branch
  `hands/<run_id>/<unit>-r2` with `--base <head of hands/<run_id>/<unit>>` and a prompt listing the findings verbatim;
  re-review the delta. At most one repair round; then report.
- Budget: 40 Bash calls. Plan them: write prompt (1), dispatch (1), wait (1), diff/stat (2), review (1), read verdict
  (1), optional repair (4), report (1). Do NOT read large files into your context; use `head`/`grep -n`.
- REPORT.md must name: hand branch(es) and head sha(s), `diff --stat` vs base, the review verdict and the findings you
  accepted/refuted with one line why, the verify commands' tails, and anything NOT done.
