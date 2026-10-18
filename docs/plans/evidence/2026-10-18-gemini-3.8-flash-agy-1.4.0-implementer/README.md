# gemini-3.8-flash-medium implementer re-sit on agy 1.4.2 (2026-10-18)

Status: done. BL-0038 does not reproduce.

Note: the directory name says 1.4.0 because agy auto-updated to 1.4.2 between prepare and run; 1.4.2 is the version that actually ran.

- Owner order 2026-10-18: "BL-0038 用 flash 3.8 跑一次，有問題就修".
- Purpose: BL-0038 reproduction attempt (`agy native JSON envelope invalid` on create-a-new-file cases, 2026-08-22,
  agy 1.1.17). Medium chosen: highest envelope-failure rate in August (6/8 + 2 stalls).
- Seat identity: model/engine/model_version `gemini-3.8-flash-medium` (tier is in the id), runner `agy`,
  runner-version resolved by the sweep from `agy --version` (1.4.2), family `google`, effort `medium`,
  version_source `operator-asserted`, harness `dispatch-hetero:be56e457`.
- Recipe source: `qualification-sweep.sh --execute` (live rail dispatch-hetero --runner agy), roster modelled on
  `docs/plans/evidence/2026-09-03-gemini-3.8-flash-tiers-qualify/roster.json` and the 2026-10-14 argon implementer cell.
- Pins: corpus 16b45e1a / d8af5290 / 2c1042fc (unchanged since 2026-09-03).
- Command: `setsid nohup bash run.sh`; log `out/run.log` ends with `rc=<n>`.
- Run: START 2026-10-18T18:24:36+08:00, agy 1.4.2, sweep rc=0, wall 478s (`out/run.log`).
- Result: `SEAT flash38-medium DONE: qualified 24/24 score=1.000 wall=478s event=326` (scorecard event 326,
  `out/sweep-stdout.log`).
- Envelope-invalid hit count: 0 files. `raw/implementer-usage.jsonl` has 24 rows, all `usage_source` "agy-json" with
  `input_tokens` present and solved=true, so every native envelope parsed. `raw/impl-exchanges.jsonl`: 20 committed +
  4 no_op, no warnings.
- Comparison: same corpus (prompt_config_hash 16b45e1a) as the 2026-08-22 agy-flash bundle, whose six envelope failures
  were all create-a-new-file cases (`docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify/README.md`).
  Earlier gemini-3.8-flash cells (2026-09-03 low/medium/high on agy 1.1.25, 2026-09-23 low on agy 1.2.8) and argon
  (agy 1.3.4) also had 0 invalid envelopes.
- Conclusion: BL-0038 does not reproduce. Same corpus, all create-a-new-file cases pass with valid envelopes. Not
  re-tested: Gemini pro (August pro had 2/8), which nobody dispatches.
