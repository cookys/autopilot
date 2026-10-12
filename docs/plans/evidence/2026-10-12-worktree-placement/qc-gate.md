# qc-gate — worktree placement

Range `4abd667f..a0a76bc5` (23 commits), then the cut-list fixes in the qc-gate commit.

## Scans (over the range)
- `check-test-integrity.sh validate`: ok, three warnings — the moved and strengthened assertions recorded in
  `moved-assertions.md`; every original assertion is still present.
- `secret-scan-diff.js`: clean.
- `error-path-scan.sh`: one hit, `|| true` after `grep -c` in a test (`grep -c` exits 1 on a zero count), legitimate.
- `completeness-scan.sh`: the mktemp `XXXXXX` template and `return 0` false positives (see `verify-suites.txt`).
- Tests: `verify-suites.txt` (87 suites, 85 green, both reds pre-existing at base).

## Review
`autopilot:reviewer` (opus) over the full range: no Critical, no Major. MUST-FIX empty, overall risk Low, next
consumer DOCUMENT_ONLY. Every Minor and Suggestion reached one outcome:

| # | Finding | Outcome |
|---|---------|---------|
| 1 | Minor: the `base_ref` sentence in the reference and CHANGELOG overclaims; a plain `set` keeps the marker's `base_ref` (`session-mode.js:793-794`) | fixed: both now say where `base_ref` is derived (a marker without one, `set --new-task`) and that `set --new-task` / `--base-ref` inside the worktree re-derives it (`--new-task` passes `prior=null`, `session-mode.js:842`) |
| 2 | Minor: `probe-unknown.js:544` also skips `node_modules`, undisclosed | fixed: disclosed in the CHANGELOG entry, with the `.claude/worktrees` walker skips it sits beside; already pinned by `probe-unknown.test.sh:170-174` |
| 3 | Suggestion: after the marker follows into a worktree, `orchestrator-edit-gate` allows main-checkout edits (`:108-115`) | deferred: BACKLOG "orchestrator-edit-gate stops gating the main checkout once the marker follows into a worktree" — the gate is opt-in and widening it is the owner's call |
| 4 | Suggestion: `resolve-repo-placement.js:85` `mkdirSync` uncaught — stack trace, exit 1, rails refuse | fixed: caught; answers the temp-dir template with `cannot create <main>/.claude/worktrees (<code>); worktree stays in the temp dir` on stderr, exit 0. Test case 4b (3 assertions). Red check: the HEAD resolver on a repo whose `.claude` is a file prints the `binding.mkdir` stack and exits 1; the fixed one exits 0 with the temp template |
| 5 | Suggestion: `walkers.md` misses three walkers (none reaches `.claude/worktrees`) | fixed: rows added |

## After the fixes
Rerun after the fixes, each alone, all rc=0:
- gates: `check-backlog-entries --mode block`, `check-reference-sizes`, `check-claude-md-inventory`,
  `check-tmp-residue-registry` (first run flagged the moved fallback line; the allowlist entry is re-anchored on
  `const temp = path.join(os.tmpdir(), name);` and the three rail reasons name both fallback causes),
  `check-js-syntax`.
- suites: `resolve-repo-placement` (34 passed), `dispatch-batch`, `dispatch-foreman`, `tmp-residue-registry`.
  `dispatch-hetero` was not rerun: the change is the resolver's mkdir-failure branch only, and the normal path the
  rails take is unchanged (batch and foreman exercise it through the same resolver call).
