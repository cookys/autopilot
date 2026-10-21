# Review deferrals from 2026-10-21

BL-0276. Recorded at closeout. Trigger-Type ready. Effort S.

## Decision-card follow-ups (dmech, merge 6e428fd6c)

- The absolute path in the guard and SessionStart text is not quoted. A path that contains a space breaks the copy-ready command.
- The hook walks scopes by rewriting that walk, instead of sharing open-decision's projectScopes.
- There is no isolation test for a second scope.
- The injection text says "starting with", but the check requires the first line to be exactly [待決回覆].

## autocompact buffer

compaction-handoff.js still has its own copy of 33000. bl250 (merge e993e0fc0) defined AUTOCOMPACT_BUFFER once in scripts/lib/autocompact-window.js and config-audit.js reuses it. The handoff copy was left.

## dwire finalize (merge 215d9084c)

- When the finalize check cannot find the script, the ERROR line has no reason.
- The finding id and the seat are also sent into the check.

## patch-id integration (bl215, merge 3955ea75b)

Known boundaries, not fixed:

- A stable patch-id does not distinguish whitespace. A branch adopted after an indentation-only change still counts as integrated.
- A cherry-pick that is later deleted on develop still counts as integrated.
- Performance: each branch commit runs git several times.

## Second half of 2026-10-21

- tokmech: two hooks can read-modify-write the same per-session state file in a race window; the first live value read after compaction may still be the pre-compaction value; the config is parsed twice. This can wait because the warning stays advisory and the window is narrow.
- tokinstall: with two complete blocks only the first is handled; uninstall deletes the file when only whitespace is left, with no record of who created it; `dev-setup --check` prints WARN when the block is not installed, which is noise for an opt-in feature and should be OK or info; there is no CRLF test; `compact_token_budget` inside an inline table is not flagged. This can wait because install is opt-in and the happy path writes one block.
- dnone: when an option label is exactly the "none" label, downstream cannot tell the two apart. This can wait because the note-only send path itself now works.
- agyto: the grok, cursor, kimi and claude runners still have no `-k`; under an interactive tty the backgrounded timeout process group can get SIGTTOU (adding `</dev/null` may help); the fake agy only ignores TERM, and there is no variant that also ignores HUP. This can wait because the reported agy stall is the path that now has `-k`.
- deval (the next row to handle): hash coverage of the prereg file is incomplete; `b_close_by_hook` has no positive detection; `a_boundary_intact` is false in some cells and that observation stays open; the record does not state when `turn2.sh` exits non-zero; the `|| fail` after `mapfile` can never fire. This can wait because the two measured rows are already INSTRUMENT-INVALID and v3 is not started.
