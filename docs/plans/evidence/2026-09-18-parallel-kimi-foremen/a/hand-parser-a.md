# Hand task — parser-a: dispatch-review parser tolerates a BEGIN-closed frame

## Product
- In the awk locator: when the derived BEGIN line appears a SECOND time AND it is the last non-blank line of the input
  AND the END marker was never seen, treat it as the closing frame: set `ended=1` and continue (trailing non-blank
  content after it stays exit 6). A second BEGIN followed by ANY further non-blank content is still exit 3 (the
  anti-fabrication guard for a planted second frame is unchanged). Implement by buffering: on the second BEGIN, record
  `pending_close=1`; a later non-blank line → exit 3; END of input with `pending_close` → treat as ended.
- The verdict still passes `validate_review_block` unchanged (VERDICT/FINDINGS/NO-FINDING-PROOF rules untouched).
- Receipt honesty: the emitted result JSON carries `frame_closed_by: "begin-marker"` (default `"end-marker"`) so a
  consumer can see the envelope was tolerated. Find where the result JSON is assembled (grep `frame` / the JSON
  emitter after `PARSE_RC`) and add the key with the same emit helper the file already uses.
- The runner's validator is STRICT on keys (`src/runners/review.js` `validateReviewResult` ~:100-112 rejects an
  unknown field): add `frame_closed_by` to `REVIEW_RESULT_OPTIONAL_FIELDS` there (value `end-marker`|`begin-marker`|
  absent) and pin in `hooks/tests/review-runner.test.sh` that a result carrying it validates and one with a bogus
  value is refused.
- Nothing else in the locator changes: chrome budget, prompt-echo guard, exit 2/5/6/7/8/9 semantics identical.

## Tests (RED-first: run the new case against the unmodified script first, record the exact output in a
`# RED at <base sha>: …` comment beside the assertion; never weaken an existing assertion)
- `hooks/tests/dispatch-review.test.sh`: (1) a stub model whose stdout is BEGIN + complete block + BEGIN → verdict
  parsed (`status: reviewed`, `frame_closed_by: begin-marker`); RED at base: `no_verdict` with reason "duplicate
  derived BEGIN marker found inside capture". (2) BEGIN + block + BEGIN + one more non-blank line → still `no_verdict`
  exit-3 reason (guard unchanged). (3) the normal BEGIN…END envelope reports `frame_closed_by: end-marker`.
  Reuse the suite's existing stub-runner pattern; look at how other cases construct the derived markers
  (`AUTOPILOT-REVIEW-<hash>`) — the marker value is derived per run, so the stub must echo the marker it receives.

## Verify (foreground, all exit 0)
```
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/review-packet.test.sh
bash hooks/tests/dispatch-review-prompt-skeleton.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Allowed files
`scripts/dispatch-review.sh`, `src/runners/review.js`, `hooks/tests/dispatch-review.test.sh`,
`hooks/tests/review-runner.test.sh`, and the codex mirrors of the two product files (via the sync script only).
Nothing else; nothing created.

## House rules
Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on
the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in
the same commit; run every verify command in the foreground before committing.

Base sha: 8d899e716fca11213aec40a314a62fb2726a68c8
