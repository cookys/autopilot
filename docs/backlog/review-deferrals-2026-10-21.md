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
- Each closeDecisionById call is now fail-open on its own. On error it remembers the error and tries the next scope file; only when the id could not be closed in any scope file does it write one fail-open line. Other ids still close normally and the hook always exits 0. fixc 242f5c54b
- The inline-table hint now ignores quoted strings and trailing comments first. fixc 242f5c54b
- `sync-codex-plugin-skills --check` compares the mirrored hooks/lib file list with sort and comm both under LC_ALL=C. The test verifies under en_US.utf8 with GNU comm, because the local comm is uutils; it SKIPs when GNU comm or that locale is missing. fixc 242f5c54b
- When no model is given and the first line is Engine:, Engine is no longer listed as missing (hint text only). fixc 242f5c54b
- The comment prefix at the top of hook-hosting.test.js is fixed. fixc 242f5c54b
- A new fake agy that ignores both TERM and HUP confirms timeout -k still ends it. fixc 242f5c54b

## Fixed 2026-10-23

- When several scope files fail, the fail-open line prints every error, each prefixed with that scope file's basename and joined with "; ". bl276r
- The comm shim no longer uses bash printf %q under #!/bin/sh. The GNU comm path is single-quoted, with an embedded single quote written as the four characters quote-backslash-quote-quote, so dash can read a path that contains special characters. bl276r

## 2026-10-22 review deferrals

- dcardv3: a negative cost is not clamped to 0.
- dcardv3: the cost field only recognizes four keys.
- dcardv3: spend is counted per result file.
- These three dcardv3 items live in the dcard-v3 frozen file (evals/skill-onoff/prereg/FROZEN.json pins the sha256 of run-dcard-v3-campaign.js). Changing them would invalidate rows already recorded, so they are not fixed in v3 and are left for the next new row (v4 or a later tool).
