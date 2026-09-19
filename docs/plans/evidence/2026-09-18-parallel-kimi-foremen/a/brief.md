# Brief A — unit name for this run: `parser-a` (repair: `parser-a-r2`)

# Brief A — dispatch-review parser: a repeated BEGIN marker that CLOSES an otherwise complete frame is chrome, not a refusal

BACKLOG row: "dispatch-review parser refuses a complete GLM verdict when the envelope repeats the BEGIN marker".
Observed twice (2026-09-18, GLM-5.2 via cc-shim): the model emitted the derived BEGIN line, a complete block
(`VERDICT:` … `FINDINGS:` … `NO-FINDING-PROOF:`), then the BEGIN line AGAIN as its closing frame instead of the derived
END line, and nothing after it. `scripts/dispatch-review.sh` awk locator (~:1572-1630) exits 3 → `no_verdict`
"duplicate derived BEGIN marker found inside capture" and depth-0 had to adopt the verdict from the raw log by hand.
Fixture (real raw log, use its shape): `docs/plans/evidence/2026-09-18-blind-review-panel-station/review-glm-r2-raw.log`.

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
