# Hand prompt — strict-contract preflight refuses the controller's remaining-wall --timeout (Fix)

## Context (verified at base 8dc1814e1aec46e0f125bba1101f15edff004f95, 2026-09-20)
v2.36.71 made the managed implementation dispatch pass `--timeout <remaining wall>s` to `scripts/dispatch-hetero.sh`
(`buildImplementationArgs` in `src/engine/autopilot-engine.js`; see the CHANGELOG v2.36.71 unit A) so a hand cannot outlive
the campaign wall. `dispatch-hetero.sh`'s strict-contract preflight (`:1162-1169`) requires a caller-supplied `--timeout`
to EQUAL `contract budget.wall_seconds` and dies `caller --timeout (7199s) disagrees with contract budget.wall_seconds (7200s)`
— so every strict /l5 campaign now fails at `dispatch_implementation` with `precondition_failed` one second after intake
(2-D D2 campaign, 2026-09-19T18:00:02Z, evidence `impl-run2.json`). The equality rule exists so a caller cannot EXTEND the
sealed wall; a shorter deadline from the controller is the remaining budget and is exactly the controller's authority.

## Product
1. RED first, in the dispatch-hetero contract suite (`ls hooks/tests | grep -i "dispatch-hetero"`; the strict-contract cases
   that already build a sealed contract and pass `--strict-contract --contract-file`): a caller `--timeout` SHORTER than
   `budget.wall_seconds` (e.g. wall 120, `--timeout 60s`) — at base `precondition_failed` with the exact message above.
   Record the observed base output in the RED comment.
2. Fix `scripts/dispatch-hetero.sh:1162-1169`: a caller `--timeout` is accepted when `normalized_timeout <= contract_wall_seconds`
   and the effective timeout is the caller's; it is refused (same die_precondition text, reworded to "exceeds") only when
   `normalized_timeout > contract_wall_seconds`; omitted `--timeout` still defaults to the contract wall. Record the effective
   deadline and its source in the result JSON as `timeout_seconds` and `timeout_source: contract_wall|caller_within_wall`
   (only if the result JSON already has a place for such fields — read `emit_outcome`; if the schema
   `schemas/dispatch-hetero-result.schema.json` or similar is `additionalProperties:false`, add the two optional fields AND
   the codex twin in the same commit; if no such schema exists, just add the fields).
3. GREEN: shorter timeout accepted (result shows `timeout_source: caller_within_wall`); equal timeout accepted as today;
   longer timeout refused with the exceeds message; omitted timeout = contract wall. Every other strict-preflight rule
   (base, model, runner, scope) byte-identical.
4. Codex mirror via `bash scripts/sync-codex-plugin-skills.sh` then `--check`.

## Tests (RED-first, `# RED at 8dc1814e1aec46e0f125bba1101f15edff004f95: …` beside each new assertion; never weaken an existing one)
Add the four cases of item 3 to the existing strict-contract suite (or a new `hooks/tests/dispatch-hetero-contract-timeout.test.sh`,
chmod +x, if the existing suite is > 3000 lines).

## Verify (foreground, each with `< /dev/null`, all exit 0)
```
bash hooks/tests/dispatch-hetero-contract.test.sh
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/dispatch-contract.test.sh
bash hooks/tests/dispatch-detached-campaign-authority.test.sh   # KNOWN RED at base (2 assertions) — record before/after, set must not grow
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(run `ls hooks/tests | grep -i "dispatch-hetero\|dispatch-contract"` and run every match too.)

## Allowed files
`scripts/dispatch-hetero.sh`, its codex twin via the sync script, the dispatch-hetero contract test suite(s) named above (or one new
suite), and a result schema + twin ONLY if item 2 requires it. Nothing else — do not touch `src/engine/*` (the engine's
`--timeout` derivation is correct and stays).

Commit ONE commit on the branch you are on; do not touch other files; run every verify command in the foreground before
committing; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.
