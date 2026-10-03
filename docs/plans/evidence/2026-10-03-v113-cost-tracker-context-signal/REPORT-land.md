# w113 landing report
- Picks (unit hands/w113/I): d8de05d2 -> 1199c540 (pre-reword), e3ae206f -> caed488e, b408b4b3 -> 6171fa59 (SHAs before release rebase-reword; subjects now end "(w113 row I)"). Shadow (none) not picked; enforcement_mode stayed enforce.
- Gates: full suite --parallel 16: 395 files, ALL TESTS PASSED, 0 red, 0 pre-existing. The 7 "FAIL [" lines in full.log are slash-entry-probe fixture output inside preflight-release-routing (suite passed). Population B flake did not appear. check-js-syntax, codex sync --check, validate.sh, check-backlog-entries (exit 0), check-plan-graduation (exit 0), preflight-release all green.
- Review: claude-fable-5-1 SHIP-AS-IS, review-1791012999-2445836-3521, three 🔵 only (in CHANGELOG).
- Version 2.36.113 (hook-count 32, skill-count 30 unchanged). Pushed SHA b02cb94f2b907a0435c5439bd3c7f16d160ad1d3 (ls-remote equals HEAD).
