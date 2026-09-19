# Hand prompt — unit D round 5 (author-d-r5): two more consumer suites of dispatch-author.sh must produce the AUTHOR/END frame

Round 4 (commit 698bb86b, the base you are on) added a shared helper to `hooks/tests/lib.sh` that a fake runner calls to
find the derived `<<<AUTOPILOT-AUTHOR-…>>>` / `<<<AUTOPILOT-END-…>>>` markers in the prompt it received (argv/prompt-file/stdin)
and wrapped the fake runners of six sibling suites with it. Read that helper first (`grep -n "AUTOPILOT-AUTHOR\|frame" hooks/tests/lib.sh`)
and the way `hooks/tests/dispatch-author-strict-endpoint.test.sh` uses it. The depth-0 consumer sweep found two more suites,
both GREEN at base and red now, whose fake runners still print unframed output:
- `hooks/tests/dispatch-output-quiescence.test.sh` — 4 FAIL: `ccshim-late-flush` and `ccshim-drip-writer-deadline-bounded`
  expect `authored`/0, get `truncated`/5.
- `hooks/tests/dispatch-review-author-cursor.test.sh` — 3 FAIL: "author: happy path exits 0", "author: happy path status is
  authored", "author: argv-capture run exits 0" (exit 5).

## Product (tests only — NO product code)
1. Wrap those fake runners' authored output with the lib.sh helper exactly like round 4 did, keeping the previously printed
   body INSIDE the frame so every existing content/timing assertion still holds. In the quiescence suite the runners flush
   late / drip-write on purpose: the BEGIN line must be emitted the same way the body was (same late flush / same drip
   cadence) so the quiescence behaviour under test is unchanged — do not add early output the test did not have.
2. Never weaken, delete, or skip an existing assertion. Fake runners expected to fail for other reasons stay untouched.

## Verify (foreground, from the clone root, each with `< /dev/null`, all exit 0)
```
bash hooks/tests/dispatch-output-quiescence.test.sh
bash hooks/tests/dispatch-review-author-cursor.test.sh
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/dispatch-author-strict-endpoint.test.sh
bash hooks/tests/dispatch-author-claude-native.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

## Allowed files
`hooks/tests/dispatch-output-quiescence.test.sh`, `hooks/tests/dispatch-review-author-cursor.test.sh`. `hooks/tests/lib.sh` ONLY if
the helper genuinely needs a small generalisation (say so in the commit message). Nothing else — no `scripts/`, no product code.

Commit ONE commit on the branch you are on; do not touch other files; run every verify command in the foreground before
committing; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.
