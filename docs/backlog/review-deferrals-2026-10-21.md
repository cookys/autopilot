# Review deferrals from 2026-10-21

BL-0276. Recorded at closeout. Trigger-Type ready. Effort S.

## patch-id integration (bl215, merge 3955ea75b)

Known boundaries, not fixed:

- A stable patch-id does not distinguish whitespace. A branch adopted after an indentation-only change still counts as integrated.
- A cherry-pick that is later deleted on develop still counts as integrated.
- Performance: each branch commit runs git several times.

## Second half of 2026-10-21

- tokmech: two hooks can read-modify-write the same per-session state file in a race window; the first live value read after compaction may still be the pre-compaction value; the config is parsed twice. This can wait because the warning stays advisory and the window is narrow.
- dnone: when an option label is exactly the "none" label, downstream cannot tell the two apart. This can wait because the note-only send path itself now works.
- agyto: the fake agy only ignores TERM, and there is no variant that also ignores HUP. This can wait because the reported agy stall is the path that now has `-k`.
- deval (the next row to handle): hash coverage of the prereg file is incomplete; `b_close_by_hook` has no positive detection; `a_boundary_intact` is false in some cells and that observation stays open; the record does not state when `turn2.sh` exits non-zero; the `|| fail` after `mapfile` can never fire. This can wait because the two measured rows are already INSTRUMENT-INVALID and v3 is not started.

## Fixed 2026-10-22

- The absolute path in the guard and SessionStart text is now quoted when needed. fixa cea451a04
- The injection text and AGENTS.md now say the first line of the reply is [待決回覆]. fixa cea451a04
- compaction-handoff takes AUTOCOMPACT_BUFFER from autocompact-window instead of its own 33000. fixa cea451a04
- A missing finalize check script now prints its path in the error. bl273 d11f46d43
- The finding id and the seat are no longer sent into the suppression check. bl273 d11f46d43
- `dev-setup --check` prints INFO instead of WARN when the token-discipline block is not installed. fixa cea451a04
- The grok, cursor, kimi and claude runners now have kill-after, using the same AUTOPILOT_AUTHOR_KILL_GRACE_SECS. runnerk b2e4c21cd
- grok and kimi get `</dev/null`; whether that avoids SIGTTOU under an interactive tty was not measured. runnerk b2e4c21cd
- The dmech hook now shares one scope walk with open-decision (projectScopeFiles). fixb ef5626a22
- There is now an isolation test for a second scope. fixb ef5626a22
- tokinstall, four items: two or more BEGIN or END markers count as drift; the file is deleted only when exactly the empty string remains; a CRLF target is written and compared with CRLF; compact_token_budget written as a dotted key or inside an inline table is flagged. fixb ef5626a22

## 2026-10-22 review deferrals

- fixb: the hook's closeDecisionById loop is not yet wrapped in fail-open (existing behavior).
- fixb: the B4 regex also matches string values and trailing comments, which gives false positives (hint only).
- hdrhint: the mirrored hooks/lib contents were not checked file by file against the file list (same as the hooks/_shared precedent).
- hdrhint: when the model is unknown, the suffix always lists Engine: as missing.
- bl274: the RED comment at the top of hook-hosting.test.js starts with # and breaks the file header's ` * ` prefix format.
- dcardv3: a negative cost is not clamped to 0.
- dcardv3: the cost field only recognizes four keys.
- dcardv3: spend is counted per result file.
