## Plan
# Plan D — dispatch-author proves completion positively (r3 repair, narrow scope)
Depth-0 ruling: the 🟡 `forbidden-scan-narrowed` finding from round-1 review IS a must-fix (brief: "never
weaken an existing assertion"). `validate_json_result` in `hooks/tests/dispatch-author-result-failures.test.sh`
now scans only the last `^{` line for forbidden endpoint/token substrings instead of the whole `$out`
(all four cases capture `2>&1`).

## Repair round r3 — exact scope
1. Restore the forbidden-substring scan over the FULL `$out` (stdout+stderr as captured); the JSON-shape
   checks may still parse the last `^{` line for `json.loads`. Both checks must live in the same
   `validate_json_result` function — do not weaken either one.
2. Find out WHY case 4 (`truncated`) produces non-JSON lines under `DISPATCH_QUIET=1` when cases 1-3 do not.
   - If `scripts/dispatch-author.sh` now writes a diagnostic to stderr that ignores `DISPATCH_QUIET`, fix it
     to respect `DISPATCH_QUIET` exactly like the script's other diagnostics do, and mirror the codex twin
     via `bash scripts/sync-codex-plugin-skills.sh`.
   - If the extra line is legitimate (e.g. an existing warning path unrelated to this feature), leave the
     script alone and say so explicitly in your final report to the foreman.
3. Verify block is UNCHANGED — run all 8 commands below in the foreground, all must exit 0.
4. Commit ONE commit on the branch you are on. Do not touch any file outside the Allowed files list. Do not
   run sync scripts by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the
   mirror in the same commit if it changed. Never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the
   environment of any command you run.

## Verify (foreground, all exit 0)
```
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/dispatch-author-result-failures.test.sh
bash hooks/tests/dispatch-author-kimi.test.sh
bash hooks/tests/dispatch-author-codex-transport.test.sh
bash hooks/tests/dispatch-plan-review.test.sh
bash hooks/tests/verification-author-resolver.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Allowed files
`scripts/dispatch-author.sh`, `scripts/dispatch-author-kimi.js` (only if it reads the raw artifact and must
strip the frame), their codex twins under `platforms/codex/plugin/` via the sync script,
`hooks/tests/dispatch-author.test.sh`, `hooks/tests/dispatch-author-result-failures.test.sh`.
Nothing else; no schema files; do not touch `dispatch-review.sh`, `dispatch-hetero.sh` or
`scripts/dispatch-plan-review.js`.
