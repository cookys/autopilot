# agy/gemini-3.7-flash-high implementer qualification — FAILED 18/24 (2026-08-22)

Second formal implementer administration (live rail, plan R2 FROZEN). Result:
**failed**, `corpus_pass: 18/24`, capability_score 0.75, administration_outcome
`completed`, wall 522 s (~21.8 s/case). **Scorecard event 144** (`status:
failed`), qualification-evidence store event 93. FAIL rows are append-only
history; any future attempt is a fresh administration (rerun-until-green
forbidden).

- **Identity**: engine/model `gemini-3.7-flash-high` (the `agy models` slug
  column literal, Board-corrected seat 2026-08-22), runner `agy`,
  runner_version `1.1.17` (auto-updated from the 1.1.14 probed at seat
  selection — recorded honestly; identity is the administration-time binary),
  family `google`, effort high, harness `dispatch-hetero:003d7975`,
  `--version-source operator-asserted` (agy has no runtime identity echo).
  Stage-0 probe receipts in `probe-receipts.jsonl`.
- **Failure attribution (evidence-discipline §22 replay)**: all six
  non-passing cases are `contract_violation` via dispatch status `failure`,
  and all six are **create-a-new-file tasks** (F1 greenfield ×4 across both
  trials, F5 cn_version ×2); every edit-an-existing-file family (F2/F3/F4/F6
  and F5 cn_banner) passed. Raw agent logs for the six show
  `agy native JSON envelope invalid — response and usage NOT parsed` — the
  wrapper commit landed (scored_sha present) but agy's own output envelope was
  invalid, so the rail's fail-closed nonzero path fired. The line therefore
  indicts the **engine+runner transport envelope on new-file responses**, not
  demonstrated contract disobedience by the model. Under the frozen total map
  (status `failure` = candidate-attributed; the exam qualifies the
  engine+runner PAIR over this rail) the FAIL stands as recorded. If a later
  agy release fixes the envelope, that is a fresh evaluation.
- **Instrument validity**: the same administration seed family passed 24/24
  for grok-4.5 (event 143) minutes earlier — the instrument discriminates
  by pair, exactly the role-fit signal the per-role suites exist to measure.
- **Files**: `qualify-out.json` (emitted row), `qualify-err.log` (verdict),
  `record-out.json` (scorecard append), `probe-receipts.jsonl`, `raw/`
  (24-case dispatch ledger + exchanges + post-hoc-disclosed seed envelope).
