# Repair task — parser-a-r2: drop out-of-scope schema hunks

You are repairing the work on `hands/par2-a/parser-a` (base: 2d8813ad52a7e52c32a31911eb606eacfc107bb4 — you are on the `-r2` branch starting from that commit). A review found this MUST-FIX:

🟠 [scope-schema-edit] MUST-FIX The diff edits `schemas/review-result.schema.json` and its codex mirror `platforms/codex/plugin/schemas/review-result.schema.json`, neither of which is in the spec's allowed-files list ("Nothing else; nothing created"); impact: the commit violates the frozen scope/house rules and cannot be accepted as-is; smallest remediation: drop the two schema hunks from the commit, and if a verify command then fails because the schema forbids the new key, report that to the dispatcher as a required spec amendment (allowed-files addition) instead of silently widening scope.

## What to do
1. Revert the changes in `schemas/review-result.schema.json` and `platforms/codex/plugin/schemas/review-result.schema.json` to their base state (i.e. remove the `frame_closed_by` additions from both schema files).
2. Run every verify command below IN THE FOREGROUND before committing:
```
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/review-packet.test.sh
bash hooks/tests/dispatch-review-prompt-skeleton.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
3. If a verify command fails SPECIFICALLY because a schema now forbids the `frame_closed_by` key, do NOT widen scope: instead write a plain note file `REPAIR-BLOCKED.md` in the worktree root stating which command failed and its tail output, and commit everything else; do not commit a schema change.
4. Otherwise commit ONE commit on the branch you are on containing only the allowed files: `scripts/dispatch-review.sh`, `src/runners/review.js`, `hooks/tests/dispatch-review.test.sh`, `hooks/tests/review-runner.test.sh`, and the codex mirrors of the two product files (via the sync script only). Do not touch other files. The final diff vs `8d899e716fca11213aec40a314a62fb2726a68c8` must contain NO changes to either schema file.
