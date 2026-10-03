# w114 landing — v2.36.114 pushed
- Picks: 01618117 -> d5dc2f20 (row J); c23f1f85 -> c759614e (row J repair); release commit 9ebea928 = pushed develop HEAD.
- Full suite (first diff): 396 files all passed. After repair: 7 solo suites rc=0; L1 layer red only in scripts/import-aa-capabilities.test.js (22 fails), red identically at origin/develop (pre-existing; /tmp/.git exists so the "cache outside git worktree" check fires). check-js-syntax, sync --check, validate.sh, check-backlog-entries, check-plan-graduation, preflight-release all rc=0.
- Review round 1: FIX-THEN-SHIP (2 yellow), review-1791023311-96700-dcac. Round 2: SHIP-AS-IS, review-1791024600-335312-08ba (3 blue follow-ups).
- Not done: INDEX merge column left as em-dash.
