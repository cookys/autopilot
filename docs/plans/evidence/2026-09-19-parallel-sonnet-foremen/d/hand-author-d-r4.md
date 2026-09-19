# Hand prompt — unit D round 4 (author-d-r4): consumer suites of dispatch-author.sh must produce the new AUTHOR/END frame

## Context
Rounds 1–3 on this branch lineage made `scripts/dispatch-author.sh` (non-codex runners) wrap the prompt with a
derived nonce-keyed frame (`<<<AUTOPILOT-AUTHOR-<32hex>>>>` … `<<<AUTOPILOT-END-<32hex>>>>`, see the wrap block around
`scripts/dispatch-author.sh:976-1012`) and require that frame in the output: otherwise `status: truncated`, exit 5.
The depth-0 consumer sweep (evidence-discipline §37) found six sibling suites whose FAKE runners print unframed
output and therefore now get `truncated`/5 where they expect `authored`/0, and one suite that asserts the exact
pre-wrap prompt bytes:
- `hooks/tests/dispatch-author-claude-native.test.sh` (green at base → 3 FAIL now)
- `hooks/tests/dispatch-author-strict-endpoint.test.sh` (green at base → 2 FAIL now)
- `hooks/tests/dispatch-author-contract.test.sh` (13 FAIL at base → 22 now)
- `hooks/tests/dispatch-author-result-provenance.test.sh` (1 at base → 2 now)
- `hooks/tests/dispatch-author-strict-roster.test.sh` (9 at base → 13 now)
- `hooks/tests/dispatch-author-session-mode.test.sh` (1 at base → 1 now; run it, must not grow)
The base failing-assertion lists are in `/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par3/d/run/base-red/<suite>.txt` (/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par3/d/run is the directory of this file).

## Product (tests only — NO product code)
1. Lift the established pattern from `hooks/tests/dispatch-review.test.sh` (`read_prompt_arg`, the marker-extraction
   helper that follows it) into ONE shared helper in `hooks/tests/lib.sh`, generic over the marker prefix
   (`AUTOPILOT-REVIEW` / `AUTOPILOT-AUTHOR`): given argv + stdin of a fake runner, it prints the BEGIN and END marker
   lines found in the prompt. Do not duplicate the parser per suite. Leave `dispatch-review.test.sh` as is.
2. In each regressed suite, make every fake runner that is expected to be `authored` emit
   `BEGIN\n<its previous body>\nEND\n` using that helper (the body it printed before stays inside the frame so
   every existing content assertion still holds). Fake runners that are expected to fail for another reason
   (empty_output, runner_failed, precondition_failed, containment) stay untouched.
3. `dispatch-author-claude-native.test.sh` "native transport receives exact prompt content": the runner now receives the
   wrapped prompt; assert that the recorded prompt ENDS WITH the original prompt content (after the `AUTHORING TASK:`
   line) and CONTAINS one `<<<AUTOPILOT-AUTHOR-` marker — do not delete the assertion.
4. Never weaken, delete, or skip an existing assertion. A `FAIL` that is present in `base-red/<suite>.txt` is
   pre-existing (leave it); a `FAIL` that is not must be gone after your change.

## Verify (foreground, from the clone root, each with `< /dev/null`)
```
bash hooks/tests/dispatch-author-claude-native.test.sh      # exit 0
bash hooks/tests/dispatch-author-strict-endpoint.test.sh    # exit 0
bash hooks/tests/dispatch-author-contract.test.sh           # FAIL lines ⊆ base-red list (13)
bash hooks/tests/dispatch-author-result-provenance.test.sh  # FAIL lines ⊆ base-red list (1)
bash hooks/tests/dispatch-author-strict-roster.test.sh      # FAIL lines ⊆ base-red list (9)
bash hooks/tests/dispatch-author-session-mode.test.sh       # FAIL lines ⊆ base-red list (1)
bash hooks/tests/dispatch-author.test.sh                    # exit 0
bash hooks/tests/dispatch-author-result-failures.test.sh    # exit 0
bash hooks/tests/dispatch-review.test.sh                    # exit 0 (lib.sh touched)
bash scripts/sync-codex-plugin-skills.sh --check
```
For each "⊆" suite, put the comparison in your commit message body: `grep ^FAIL` output minus the base list must be empty.

## Allowed files
`hooks/tests/lib.sh`, `hooks/tests/dispatch-author-claude-native.test.sh`, `hooks/tests/dispatch-author-strict-endpoint.test.sh`,
`hooks/tests/dispatch-author-contract.test.sh`, `hooks/tests/dispatch-author-result-provenance.test.sh`,
`hooks/tests/dispatch-author-strict-roster.test.sh`, `hooks/tests/dispatch-author-session-mode.test.sh`. Nothing else —
no `scripts/`, no product code, no `dispatch-review.test.sh`.

Commit ONE commit on the branch you are on; do not touch other files; run every verify command in the foreground
before committing; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.
