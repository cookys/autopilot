# gemini-4-argon via agy 1.3.4 — full qualification (2026-10-14) — DRAFT

Owner order 2026-10-14: qualify Gemini 4 Argon via agy at effort {low, high}, every exam, sequentially,
one cell at a time. Status: running; results appended below as each cell lands.

## Seat identity

- Model ids (`agy models`, agy 1.3.4): `gemini-4-argon-low`, `gemini-4-argon-high` (the tier is IN the id; `-medium`
  exists and is not run). runner `agy`, family `google`, version_source `operator-asserted`.
- Effort reaches agy only through the model id: the provider adapter passes NO `--effort` to agy
  (`scripts/qualification-review-provider.js:46-50`, `:961-963`), and the implementer rail folds effort into the id
  (`scripts/dispatch-hetero.sh:3912-3916`, `agy_effort_for_model`). So low and high are two genuinely different
  cells for every role, and no role needs the "same score twice" exception.

## Exam list (all exams `engine-qualify.js` supports) and order

`engine-qualify.js` subcommands: reviewer, owner, brain, verification_author, implementer, consult, discuss
(explorer has no exam). Order, each low then high, one cell at a time:

| # | role | effort | path | note |
|---|---|---|---|---|
| 1 | implementer | low | `qualification-sweep.sh` (live rail, dispatch-hetero --runner agy) | recipe: 2026-09-03 tiers / 2026-09-23 re-sit |
| 2 | implementer | high | same | |
| 3 | reviewer | low | `cell.sh` -> engine-qualify + provider `QRP_CLI_KIND=agy` | recipe: 2026-10-12 claude-5.5-requalify lane.sh |
| 4 | reviewer | high | same | |
| 5 | verification_author | low | same | |
| 6 | verification_author | high | same | |
| 7 | consult | low | same (`--execute`) | |
| 8 | consult | high | same | |
| 9 | discuss | low | same (`--execute`) | |
| 10 | discuss | high | same | |
| 11 | brain | low | same (no scorecard row; evidence store) | |
| 12 | brain | high | same | |
| 13 | owner | low / high | none | provider has no owner mode (`qualification-review-provider.js:1466` rejects it); error recorded below |

Pins: implementer corpus 16b45e1a / d8af5290 / 2c1042fc (unchanged), harness `dispatch-hetero:7481ead3`.
Broker roles: fingerprints derived by `derive-fingerprints.js` (adapted from the 2026-10-12 claude derivation;
agy surface strings are new and flagged `_invented` in `identity/*.json`). Rows are recorded by hand from each
cell's `emit-row.json` after reading the result.

## Results (sc = engine-scorecard event; store = qualification-evidence store event; wall = cell wall)

Status: complete (12 cells run; owner has no agy path). The "DRAFT" heading above is superseded by this section.

| role | low | high |
|---|---|---|
| implementer | PASS 24/24, sc 230 / store 390, seat wall 399 s | PASS 24/24, sc 231 / store 391, seat wall 544 s |
| reviewer | PASS 42/42, specificity 0/38 false positives, sc 232 / store 392, 476 s | PASS 42/42, 0/38, sc 233 / store 393, 870 s |
| verification_author | PASS 24/24, sc 234 / store 394, 195 s | PASS 24/24, sc 235 / store 395, 337 s |
| consult | PASS 56/60 (0 false_confidence / authority / oracle misses), sc 236 / store 396, 272 s | PASS 56/60, sc 237 / store 397, 859 s |
| discuss (v4) | PASS 45/48 (0 sycophancy / evidence_blindness / zero_information), sc 238 / store 398, 278 s | PASS 45/48, sc 239 / store 399, 702 s |
| brain (v3) | FAIL: diligence false; fairness, convergence, containment true; pair_delta 0; store 400; 24,322 tokens | FAIL: same subjects; store 401; 23,623 tokens |
| owner | not examinable: no agy path (below) | not examinable |

All 24 brain rounds per cell returned non-empty output with transport_ok, so the brain FAIL is a graded
diligence failure, not a transport artifact (`out/brain-*/raw/*.exchanges.jsonl`). Brain emits no scorecard
row by design. Rows for the other broker cells were recorded by hand (`record.sh`) from each `emit-row.json`.

## Owner: no agy path

`engine-qualify.js owner` needs a broker provider with an owner prompt mode. The shared provider has none:
`QRP_PROMPT_MODE=owner` -> `QRP_PROMPT_MODE must be reviewer, brain, va, consult, or discuss (got: owner)`
(`scripts/qualification-review-provider.js:1466`; captured in `owner-attempt.txt`). The 2026-10-12 claude lanes
skipped owner for the same reason. Explorer has no exam at all.

## Comparison with gemini-3.8-flash (agy)

3.8-flash sat implementer only (24/24 at low/medium/high, 2026-09-03; low re-sit 2026-09-23). Argon matches it on
accuracy and is faster at seat level: low 399 s vs 410 s, high 544 s vs 797 s. No earlier agy gemini 3.8 seat sat
reviewer, verification_author, consult or brain; gemini-3.7-flash-high sat discuss (failed, then qualified 2026-08-30).
Against the 2026-10-12 claude lanes: argon passes reviewer at both tiers with zero clean-case false positives
(sonnet-low and haiku lanes failed reviewer on specificity); brain fails, as most claude lanes did (only opus-low passed).

## Caveats

- Effort = model-id tier for agy; the `effort` field labels that tier.
- Broker-role fingerprints (agy semantic/containment surface strings) are new, flagged `_invented` in
  `identity/*.json`; consistent across all cells, no prior agy precedent for these roles.
- Each cell was run once; the brain FAIL rows are append-only and were not re-run.
- Files: `roster-{low,high}.json`, `argon-{low,high}-qualify/` (implementer), `out/<role>-<effort>/` (broker cells),
  `cell.sh`, `derive-fingerprints.js`, `record.sh`, `summarize.js`, `identity/`, `logs/`.
