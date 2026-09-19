## Plan
# Plan G — precondition reasons reach the plan-review artifact; secret-scan fixture stops planting literals
1. RED: a precondition_failed author envelope becomes an empty-output transport_exhausted seat with no reason.
2. dispatchSeat carries envelope status/error; precondition_failed is its own classification, not retried, reason in seat record + policy_reason; schema optional field if needed (+ twin).
3. secret-scan-diff.test.sh: five literals → runtime concatenation; scanner over the suite file exits 0; suite still green.
4. Sync mirrors; verify; ONE commit.
Acceptance: the 2026-09-15 shape records "active session-mode=l5 blocks non-strict dispatch" in the artifact; a release-range secret scan no longer names the suite.

## Product
1. RED first (row 1), in `hooks/tests/dispatch-plan-review.test.sh` (model: the `transport_exhausted` cases at `:425`,
   `:639`, `:1395` and their fake `dispatch-author` seam): a seat whose dispatch-author exits 2 with a precondition
   envelope `{"status":"precondition_failed","error":"active session-mode=l5 blocks non-strict dispatch (repo=…)"}` and
   empty raw_log — at base the seat record shows empty output and the artifact ends `transport_exhausted` with no trace
   of the reason. Record the observed output in the RED comment.
2. Fix: `dispatchSeat` carries the author envelope's `status` and `error` into the seat's transport record — when the
   envelope is a `precondition_failed` (or any non-`authored` status with an `error`), the seat outcome is a NEW
   classification `precondition_failed` (not `exit_failure`), it is NOT retried (a precondition does not heal by
   retrying), and the seat record + artifact carry the reason verbatim: seat-level `error`/`reason` field, and at the
   artifact level `transport_status: 'transport_exhausted'` stays (do NOT widen the enum) while `policy_reason` names
   it (`seat <id> precondition_failed: active session-mode=l5 blocks non-strict dispatch …`, truncated to 512). If the
   seat-record schema (`schemas/plan-review-artifact.schema.json` or a seat sub-schema with `additionalProperties:false`)
   blocks a new seat field, add the optional field to the schema AND its codex twin in the same commit; never store the
   reason only in a log.
3. Row 2: rewrite the five literals as runtime concatenation (`SK="sk-ant-""1234567890123456789012345"`,
   `AK="AKIA""IOSFODNN7EXAMPLE"`, or `printf` of two halves) so no complete key-shaped token exists in the tree; the
   suite's assertions keep testing the same behaviour (the scanner must still detect the assembled secret at runtime).
   Then prove it: `node scripts/secret-scan-diff.js --files hooks/tests/secret-scan-diff.test.sh` (read its header for
   the exact flag) exits 0 on the rewritten file and `bash hooks/tests/secret-scan-diff.test.sh` is green.
4. Codex mirrors of every touched script/schema via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first; `# RED at <base sha>: …` beside each new assertion; never weaken an existing one)
- `hooks/tests/dispatch-plan-review.test.sh`: the RED case → seat outcome `precondition_failed`, zero retries, reason in
  the seat record and in `policy_reason`; existing `transport_exhausted` cases unchanged.
- `hooks/tests/secret-scan-diff.test.sh`: same assertions, literals gone; add one assertion that the scanner over the
  suite file itself reports nothing.

## Verify (foreground, all exit 0)
```
bash hooks/tests/dispatch-plan-review.test.sh
bash hooks/tests/secret-scan-diff.test.sh
node scripts/secret-scan-diff.js --files hooks/tests/secret-scan-diff.test.sh
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/plan-review-transport-fallback.test.sh
bash hooks/tests/plan-review-transport-fixes.test.sh
bash hooks/tests/plan-review-panel-status.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(all four plan-review suites listed above are real; run each.)

## Allowed files
`scripts/dispatch-plan-review.js` (ONLY `dispatchSeat` ~:1058-1106 and the seat/transport folding at ~:1840-1870/1989 —
a sibling unit may add status `truncated` elsewhere in the file; do not touch `dispatch-author.sh`),
`src/transport/runner-envelope.js` (classification only), `schemas/plan-review-artifact.schema.json`, their codex twins
under `platforms/codex/plugin/` via the sync script, `hooks/tests/dispatch-plan-review.test.sh`,
`hooks/tests/secret-scan-diff.test.sh`. Nothing else.

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by
hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it
changed; run every verify command in the foreground before committing; never set
`AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.

## Repair round — fix these review findings
🟠 [schema-conformance-unasserted] MUST-FIX The new seat record adds an `error` field and a new `attempts[].transport_status`/envelope outcome value `precondition_failed`, but `schemas/plan-review-artifact.schema.json` is untouched and the new RED case omits the `assert_artifact_schema "$OUT" ...` call that every sibling `transport_exhausted` case carries (`:429`). If the seat sub-schema enumerates `transport_status`/`outcome` or has `additionalProperties:false`, the shipped artifact is schema-invalid and downstream validators reject it while the suite stays green. Smallest fix: add `assert_artifact_schema "$OUT" "precondition_failed artifact matches schema"` after the new assertions; if it fails, add optional `error` (string) and the `precondition_failed` enum member to the schema and sync the codex twin in the same commit.

Note: `schemas/plan-review-artifact.schema.json`'s top-level `attempts` property is `{"type":"array","items":{"type":"object"}}` with no per-item `additionalProperties:false`, so a new seat-level `error` field should already validate — but add the `assert_artifact_schema` call to the new RED test case anyway (matching the sibling `transport_exhausted` cases) so this is actually verified, not assumed. Only touch the schema/codex-twin if that assertion fails.

Commit this as ONE additional commit on the branch you are already on (do not amend/rewrite the prior commit). Same allowed-files list and verify commands as above.
