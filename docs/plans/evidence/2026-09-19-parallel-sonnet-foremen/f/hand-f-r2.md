## Plan
# Plan F — two red suites become hermetic
1. Record the base FAIL sets (5 + ~35) as RED comments.
2. Fixture REVIEW_LOOP_CONFIG_OVERRIDE + ENGINE_SCORECARD_DIR built in TEST_TMP, applied to every check-scorecard / strict-bootstrap call; suites write their own qualified rows.
3. Negative control proving independence from the host's qualified set; no assertion loosened; genuine product reds left failing and named.
4. Green in normal and `env -i` runs; ONE commit; tests only.
Acceptance: both suites exit 0 on a host with no cursor qualification row and with an empty scorecard dir.

## Product
1. RED first: at base, record the exact failing assertion names of both suites (`bash hooks/tests/<suite> 2>&1 | grep
   FAIL`) into a comment block at the top of each suite's new hermetic-fixture section (`# RED at <base sha>: N FAIL — …`).
2. Make both suites hermetic: a fixture review-loop config (`REVIEW_LOOP_CONFIG_OVERRIDE`) whose roster names ONLY
   engines the fixture scorecard dir (`ENGINE_SCORECARD_DIR`) qualifies, built inside `TEST_TMP` by the suite itself
   (copy the shape from `autopilot-cli.test.sh:497,502` and `resolve-review-loop.test.sh`), applied to every
   `resolveReviewLoopJson` / `--check-scorecard` / strict-bootstrap call in both suites. Expectations become
   host-independent: nothing in either suite may read `.claude/review-loop-config.md`, `~/.autopilot`, or the host
   capability dir. If a strict-L5/L6 fixture needs a qualified row for a specific role, the suite WRITES that row into
   its own scorecard dir (find the writer the qualification suites use — `hooks/tests/engine-qualify*.test.sh` /
   `engine-capability-state` — and reuse it; never point at the host's dir).
3. Prove hermeticity: each suite gets one negative control — run the same block with the host's live env and an
   intentionally EMPTY `ENGINE_SCORECARD_DIR` and assert the fixture path still passes (i.e. the suite's verdict does
   not depend on what the host has qualified). Do NOT loosen any assertion that today checks a specific status,
   digest, phase or rejection code — fix the fixture, not the expectation. If an assertion turns out to be a genuine
   product defect (fails even with a fully qualified fixture), do NOT patch `src/`: leave it failing, name it in
   REPORT.md under "genuine reds", and stop there — that is a separate row.
4. Hermeticity also for `hooks/tests/lib.sh` helpers only if both suites need the same builder; otherwise keep the
   fixture local to each suite. No product code changes; no other suites.

## Tests
The two suites ARE the tests. Verify each runs green in a clean env (`env -i HOME=$HOME PATH=$PATH bash hooks/tests/<suite>`)
AND in the normal env, from inside the clone, and that `grep -c "review-loop-config.md\|\.autopilot" hooks/tests/provider-readiness-consumer.test.sh hooks/tests/autopilot-cli.test.sh`
shows only fixture paths under `TEST_TMP`.

## Verify (foreground, all exit 0)
```
bash hooks/tests/provider-readiness-consumer.test.sh
bash hooks/tests/autopilot-cli.test.sh
env -i HOME="$HOME" PATH="$PATH" bash hooks/tests/provider-readiness-consumer.test.sh
env -i HOME="$HOME" PATH="$PATH" bash hooks/tests/autopilot-cli.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/status-task.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Allowed files
`hooks/tests/provider-readiness-consumer.test.sh`, `hooks/tests/autopilot-cli.test.sh`, `hooks/tests/lib.sh` (a shared
fixture builder only if both need it). Nothing else — NO `src/`, `scripts/`, `bin/`, `schemas/` or config edits; if the
sync check flags a mirror, you touched something you must not have.

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by
hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it
changed; run every verify command in the foreground before committing; never set
`AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.

## Repair round — fix these review findings
🟠 [stray-receipt-artifact] MUST-FIX The diff adds a new 198-line `provider-readiness-receipt.json` at the repository root; the spec's allowed-files list is exactly the two suites plus `hooks/tests/lib.sh`, and this file is a generated readiness receipt (issued_at 2026-07-27, xai/minimax/alibaba seats) that leaked from a test run into the working tree. Impact: the single commit violates the "nothing else" constraint and pollutes the product tree with a stale runtime artifact that other tooling may read as a live receipt. Smallest remediation: `git rm --cached provider-readiness-receipt.json` and drop it from the commit (and delete it from the worktree); no other change needed.
