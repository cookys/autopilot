# qc-gate runs the whole suite serially; most of it never touches the diff

Source: feat/autocompact-detect qc-gate, 2026-10-12.

- `.claude/quality-gate-config.md` sets the M–XL test step to `bash hooks/tests/run.sh`: L1 `node --test`
  (787 tests, about 1 minute) then 408 L2 suites one after another. On this host the run went past 30 minutes
  and was stopped at suite 256/408.
- The diff touched `hooks/session-start.js`, `hooks/state-checkpoint*.js`, `hooks/context-budget.js`,
  `scripts/lib/autocompact-window.js` and `scripts/dev-setup.sh`. A grep for those names over
  `hooks/tests/*.test.sh`, `hooks/*.test.js` and `scripts/*.test.js` found 38 suites; all passed in about
  2 minutes. The full run's two failures reproduced at the base commit.
- Proposal: the qc-gate test step selects the suites that reference a changed file (plus suites a changed
  shared lib is required by), with the full suite kept for the release preflight. Changing what the gate
  requires is a guidance change: owner approval and eval evidence first.
- Owner, 2026-10-12: "full suite 是幹嘛? 真的有必要嗎? 跑太久了吧?"
