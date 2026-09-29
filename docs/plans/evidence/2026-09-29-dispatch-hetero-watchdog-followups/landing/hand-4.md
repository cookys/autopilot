Engine: cursor-grok-4.6-low

# Hand 4 (R4, items 5 and 10 only) — OUTPUT contract comment must not list default as a result-JSON timeout_source

You are working in the git clone you were launched in. Background: docs/backlog/dispatch-hetero-watchdog-followups.md items 5 and 10 (the same one doc mismatch). Premise checks already done by the foreman: items 4 (duplicate timeout keys in strict manifests) and 7 (caller versus caller_within_wall ordering) do NOT reproduce and are skipped; do not touch them.

## Product
In the header comment of scripts/dispatch-hetero.sh that documents the OUTPUT result JSON (search for the line listing the timeout_source values), the value default is listed as a possible result-JSON timeout_source. The emit function only writes timeout_source when TIMEOUT_SOURCE is non-empty, so default never appears in the result JSON; it exists only in the run manifest (where write_manifest falls back to it when nothing is enforced). Fix the comment only: list caller, contract_wall and caller_within_wall as the result-JSON values, and say in one sentence that the manifest additionally uses default for an unenforced run. No code behavior change. Do not add fenced blocks or line-number references.

## Tests (RED-first)
Append to hooks/tests/dispatch-hetero-watchdog-followups.test.sh, registered in the main call list, a case assert_r10_result_json_never_default_timeout_source: run the REAL scripts/dispatch-hetero.sh inline with a stub worker that exits quickly and no --timeout flag, and again with a short --timeout and a quick exit; assert the result JSON either lacks timeout_source or carries a value in the three allowed ones and never default; assert the manifest of the no-timeout run carries default. Also grep the header comment to assert that the timeout_source line in the OUTPUT comment block no longer contains the quoted word default before the parenthetical note (the assertion must fail on the unmodified comment; record that red result as a comment line reading RED at a9973f44 followed by the failing lines).

## Verify
Foreground, one at a time, with the prefix env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID and stdin from /dev/null: the new suite; hooks/tests/dispatch-hetero-wall-timeout.test.sh; hooks/tests/dispatch-hetero-contract.test.sh; hooks/tests/dispatch-hetero.test.sh; any suite grep -l finds for timeout_source; node scripts/check-js-syntax.js; run bash scripts/sync-codex-plugin-skills.sh then bash scripts/sync-codex-plugin-skills.sh --check. Never use pkill or pgrep -f matching hetero-wall-watchdog.

## Allowed files
scripts/dispatch-hetero.sh (comment only), platforms/codex/plugin/scripts/dispatch-hetero.sh (via sync), hooks/tests/dispatch-hetero-watchdog-followups.test.sh.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
