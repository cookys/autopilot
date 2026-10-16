# BL-0093 point 1: relax "Boil the Lake" (ceo-agent) — ON/OFF eval

Status: PRE-REGISTERED 2026-10-17, before any cell was run. Results are appended below the line `## Results`; nothing above it may be edited after data exists.

Owner approval: 2026-10-17, point 1 only. Points 2 (TaskCreate-missing wording) and 3 (reversible-candidate release gates / DOA table) are out of scope and stay in BL-0093.

## Point 1 (exact)

cuda (revival.3d) asked upstream to stop the "Boil the Lake" / completeness-principle prose from over-prescribing exhaustive checks, and to use validation proportional to the change. The shipped text is `skills/ceo-agent/SKILL.md` section "Completeness Principle — Boil the Lake" (the only prose carrying the "near-zero marginal cost" premise; `dev-flow` carries none).

- OFF arm = current text, verbatim (`evals/orchestration/packs/completeness-maximal/PROMPT.md`). Pre-run fix: that pack had drifted from the skill in two sentences ("80 lines and 15 lines ... minutes", "never oceans"); it was re-synced to the skill text before any run.
- ON arm = proportional text (`packs/completeness-proportional/PROMPT.md`, 193 words vs 179, inside the +-10% length rail).
- Both arms differ in exactly this one block; same contract, same oracle, same model.

Design and decision rule are the 2026-09-08 pre-registration in `evals/orchestration/EXPERIMENT-completeness-proportionality.md` (unchanged). This file adds only the operational pins below.

## Tasks

- `t18-proportional-waste` (cosmetic constant change; waste = `mirror_tests` summed from each run's `oracle.log`; `decoy_respected` there means waste_bounded).
- `t19-edge-case-escape` (remainder fix whose obvious loop hangs on size <= 0, never mentioned in the brief; escape = `decoy_respected=false`, i.e. edge_case_held=0).
- Score each task separately; never average the two `decoy_respected` columns.

## Cells and cost

26 cells: 5 runs x 2 arms x 2 tasks = 20 measured, plus 6 red-control cells. Model `sonnet` (alias, claude CLI 2.1.301, DISABLE_AUTOUPDATER=1 pinned), runner `cc`, scratch HOME, 2 cells in parallel, 8 min per-cell timeout. Estimate 2-4 min and roughly 0.2-0.4 USD per cell: about 40-60 min wall, 5-10 USD.

## Negative control (planted red, run in the same campaign)

Two deliberately broken arms must be caught by the instruments, else the campaign is INSTRUMENT-INVALID and gives no verdict:

- `red-reckless` x t19 x3: pack says "do the literal minimum, no validation". Instrument is sensitive only if >= 2 of 3 escape (edge_case_held=0).
- `red-bloat` x t18 x3: pack says "at least five new assertions, one pinning the literal". Sensitive only if >= 2 of 3 have `decoy_respected=false` (waste_bounded=0).

Also (offline, already documented in the experiment file): minimal solution fails t19 / passes t18; thorough solution passes t19 / fails t18.

## Verdict rule (operational reading of the pre-registered rule)

Over valid cells only (infra_fail cells are re-run once; if a group ends below 5 valid runs it is a pilot and no verdict is issued):

1. Sanity: `fidelity_ok` >= 4/5 in every group, else INSTRUMENT-INVALID.
2. waste_ON, waste_OFF = sum of `mirror_tests` over the 5 t18 runs. escape_ON, escape_OFF = count of t19 runs with edge_case_held=0.
3. If |waste_ON - waste_OFF| / max(waste_OFF, 1) < 20%, or waste_OFF == 0: UNINFORMATIVE (reported as such; treated as NOT-SHIP, never as "safe").
4. SHIP iff waste_ON <= 0.5 * waste_OFF AND escape_ON <= escape_OFF.
5. Otherwise NOT-SHIP. (The "narrowed prose" branch of the 09-08 rule cannot be decided from these two tasks, since t19's boundary is caller-reachable; it is not used. If escape_ON > escape_OFF the verdict is NOT-SHIP regardless of waste.)
6. A SHIP edits only the sentences the ON arm varied, in `skills/ceo-agent/SKILL.md`, in a separate commit from this evidence. NOT-SHIP records only.

## Reproduce

```
bash docs/plans/evidence/2026-10-17-bl0093-guidance-relax/run-campaign.sh <cells-root>
node docs/plans/evidence/2026-10-17-bl0093-guidance-relax/aggregate.js <cells-root>
```

## Results

Run 2026-10-17, one pass, no cell re-run, no infra_fail (26/26 valid). Raw per-cell `result.json` + `oracle.log` under `cells/`; table in `aggregate.out`. Model sonnet, claude 2.1.301. Cost: roughly 10-20 s per cell, 4 min wall in total (far below the estimate).

| Group | n | fidelity_ok | flag true | mirror_tests sum | new_test_cases sum |
|---|---|---|---|---|---|
| OFF (maximal) x t18 | 5 | 5 | 5 (waste_bounded) | 0 | 0 |
| ON (proportional) x t18 | 5 | 5 | 5 | 0 | 0 |
| OFF (maximal) x t19 | 5 | 5 | 5 (edge held) | 0 | 14 |
| ON (proportional) x t19 | 5 | 5 | 5 | 0 | 0 |
| red-bloat x t18 | 3 | 3 | 0 | 3 | 17 |
| red-reckless x t19 | 3 | 3 | 0 (escaped) | 0 | 0 |

Negative control: both planted-red arms were caught 3/3 (needed >= 2/3), so the instruments are sensitive and the campaign is instrument-valid. Sanity (fidelity) 5/5 in every group.

Verdict by the pre-registered rule: waste_OFF = 0, so step 3 applies: **UNINFORMATIVE, treated as NOT-SHIP**. On t18 the current "Boil the Lake" prose did not make sonnet write a single extra test (0 vs 0), so there is no waste for the proportional text to remove; escape was 0 vs 0 on t19. This is not evidence that the change is safe, and not evidence that it helps.

Observed but not part of the verdict (the rule was fixed before data): on t19 the maximal arm added 14 new test cases and the proportional arm 0, with identical correctness and zero escapes in both. That is a hint the prose moves test volume on a task where tests are warranted, which the pre-registered waste metric (t18 only) does not capture. Reading it as a result would be a post-hoc rule change.

No SKILL change. If the owner wants this point re-tried, the pre-registered threat applies: the synthetic t18 brief states outright that the change is cosmetic, so a mid-tier model does not take the bait; a new t18-like task with a weaker "this is cosmetic" cue, registered before running, is the way to make waste measurable.
