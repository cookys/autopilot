# v2.36.109 landing
- Picks: 69e152ae -> kimielf, d569ed89 -> fcount (expected conflict resolved by taking fcount version). Landed as 3 commits, rebased onto 5bcb6de9 (docs-only), pushed head 524c547a.
- Gates: full suite --parallel 16: 386 files, 1 red (dispatch-review-blind-kimi-agy: base SHA 47a0e1c6 not in origin/main checkout; red at origin/develop too = pre-existing). cleanroom-launch-kimi-agy (HOST_ISOLATION=1) 112 PASS; check-js-syntax, codex sync, validate.sh, preflight-release 9/9 green.
- Review: SHIP-AS-IS (claude-fable-5-1, review-1790972019-1960701-9d70), 3 blue follow-ups in CHANGELOG.
- V = v2.36.109; INDEX merge column "—". Note: --hook-count 32 --skill-count 30 passed to sync-version (required args).
- Pushed SHA: 524c547adccc9a9853b5653fa58501ec85a04001
