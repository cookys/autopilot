# finish-flow step 7 A/B: Staging verify vs Usage evidence

Campaign: PM 01M78GBW, D8c part A. Eval evidence only. `skills/finish-flow/SKILL.md` is arm A and was not edited.

## Instrument

The existing finish-flow behavioral runner is `evals/skill-onoff/run-skill-onoff-eval.sh`. Its `--runner` flag accepts `cc` or `stub`. `cc` is Claude (`claude -p`). `stub` is a deterministic stand-in, not a qualified model seat. Its markers (`c_status_input`, `g7_close`) score tool order in a transcript. They do not read checklist item 7.

The description-trigger pack is `skill-creator-workspace/evals/finish-flow-evals.json` (10 queries). `scripts/run-skill-opt.sh` runs it through `claude -p`.

The scorecard harness `evals/orchestration/run-orchestration-eval.sh` accepts `--runner agy` and a qualified non-Claude model. Its tasks are coding oracles, and the agy branch commits the cell. Those tasks do not load finish-flow step 7. This pack does not call that runner.

Both arms were run as the same prose compliance check. The model sees the full skill text. The only difference is step 7. `grok-4.7` at reasoning effort `low` is a qualified non-Claude implementer seat in `references/official-qualification-defaults.json`. It is the seat used here because skill-onoff has no qualified non-Claude runner flag. Engine: `grok-4.7`, reasoning effort `low`, runner `grok` (`grok 1.0.77 (50ca579fa996) [stable]`). Repeat: 1. Seed: none (the runner has no seed flag). This n=1 pass is not the prereg repeat count and is not a gate result.

Skill sha256: arm A `e325a789b907fd8ece916402e5b8777e58c06decdaa29813c70e0169342484e2`, arm B `efdc7cad8fbab9656fb4443e62121151a1801e5841e2e3f1cbffdcdccf869498`. Arm B is `arm-b/SKILL.md`. The diff against the live skill is line 130 only.

## Frozen rubric

Graded by `grade.py` before any model output was accepted. Existing cases: PASS iff the first non-empty line is `TRIGGER` or `NO-TRIGGER` and matches `should_trigger`. The usage line is not required, so arm A is not failed for still saying Staging verify.

Synthetic case `ff-usage-green-unused` only: facts are merged, tests green, review PASS, no person used the result, no end-to-end run. PASS iff the trigger label matches and there is exactly one `Used: n/a <reason>` line. `Used: user` and `Used: e2e` fail. A reason that is only green tests or review PASS fails. The reason must state that nothing was used or that there was no end-to-end run.

## Cases and results

| case | rubric | should_trigger | arm A | arm B | A exit | B exit |
|---|---|---|---|---|---|---|
| `f1-ready-to-merge` | trigger | true | PASS | PASS | 0 | 0 |
| `f1b-ready-to-merge-docs` | trigger | true | PASS | PASS | 0 | 0 |
| `ff-trigger-01` | trigger | true | PASS | PASS | 0 | 0 |
| `ff-trigger-02` | trigger | true | PASS | PASS | 0 | 0 |
| `ff-trigger-03` | trigger | true | PASS | PASS | 0 | 0 |
| `ff-trigger-04` | trigger | true | PASS | PASS | 0 | 0 |
| `ff-trigger-05` | trigger | true | PASS | PASS | 0 | 0 |
| `ff-trigger-06` | trigger | false | PASS | PASS | 0 | 0 |
| `ff-trigger-07` | trigger | false | PASS | PASS | 0 | 0 |
| `ff-trigger-08` | trigger | false | PASS | PASS | 0 | 0 |
| `ff-trigger-09` | trigger | false | PASS | PASS | 0 | 0 |
| `ff-trigger-10` | trigger | false | PASS | PASS | 0 | 0 |
| `g7-close` | trigger | true | PASS | PASS | 0 | 0 |
| `ff-usage-green-unused` | usage | true | FAIL | PASS | 0 | 0 |

Per-case trigger expectation is the source file's `should_trigger` for `ff-trigger-*`, and true for `f1-ready-to-merge`, `f1b-ready-to-merge-docs`, and `g7-close`. `g7-close` uses the prereg prefix `Use finish-flow:` before `tasks/g7-close/task.md`. The other task prompts are the task.md text. The ten trigger queries are copied from `finish-flow-evals.json` in file order.

Synthetic usage lines: arm A `(none)`; arm B `Used: n/a no person has used the merged result and there is no end-to-end run`.

Synthetic second lines, raw: arm A `7. Staging verify: FAIL — 合併進 develop 的結果尚無人使用，也沒有端到端執行。`; arm B `Used: n/a no person has used the merged result and there is no end-to-end run`.

Arm B is no worse than A on every existing case: **yes**.

Arm B is better on the usage-evidence case: **yes**.

Counts: 13 existing cases, 1 synthetic case, 2 arms, 1 repeat, 28 model calls.

Raw rows: `results/arm-a.jsonl`, `results/arm-b.jsonl`. Scores: `results/scores.json`, `results/summary.json`.

## Repetitions (PM 01M78M9M)

On top of eval/d8c-a2. Same instrument (`run-ab.py` `grok_call`: `grok-4.7`, reasoning effort `low`, the flags in `results/engine.json`), same grader (`grade.py`), same arm B file `arm-b/SKILL.md`. Run 1 is the recorded n=1 row in `results/scores.json`. Runs 2 and 3 are new calls on three cells only: `ff-usage-green-unused`, `f1-ready-to-merge`, and `ff-trigger-06`, both arms. No infra retry fired. Every exit code is 0.

`grade.py --check-fixture` is false on this tree because d8c-a2 already replaced live `skills/finish-flow/SKILL.md` line 130 with the arm B sentence (live sha `efdc7cad8fbab9656fb4443e62121151a1801e5841e2e3f1cbffdcdccf869498`, the same as arm B). This repetition did not edit that file and did not use it as the arm A prompt. Arm A prompts used the recorded arm A blob `e325a789b907fd8ece916402e5b8777e58c06decdaa29813c70e0169342484e2` (`git show 0506b25d3:skills/finish-flow/SKILL.md`), which is the text run 1 graded. Arm B prompts used `arm-b/SKILL.md`.

| case | arm | run 1 | run 2 | run 3 | pass count |
|---|---|---|---|---|---|
| `ff-usage-green-unused` | A | FAIL | FAIL | FAIL | 0/3 |
| `ff-usage-green-unused` | B | PASS | PASS | PASS | 3/3 |
| `f1-ready-to-merge` | A | PASS | PASS | PASS | 3/3 |
| `f1-ready-to-merge` | B | PASS | PASS | PASS | 3/3 |
| `ff-trigger-06` | A | PASS | PASS | PASS | 3/3 |
| `ff-trigger-06` | B | PASS | PASS | PASS | 3/3 |

Arm B synthetic lines: run 1 `Used: n/a no person has used the merged result and there is no end-to-end run` (graded fields only; raw text was not retained); run 2 `Used: n/a no person has used the merged result and there is no end-to-end run`; run 3 `Used: n/a no person has used the merged result and there is no end-to-end run`.

Arm B passes the synthetic case in at least 2 of 3 runs: **yes** (3/3).

Raw outputs: `results/reps/run-1.json`, `results/reps/run-2.json`, `results/reps/run-3.json`. Pass counts: `results/reps/summary.json`. Runs 2 and 3 store the model text. Run 1 stores the graded row from `results/scores.json` because the original `arm-*.jsonl` files are gitignored and are not in the tree.

New model calls: 12 (3 cases, 2 arms, 2 new runs).

## Out of scope

No edit to `skills/finish-flow/SKILL.md`, frozen `packs/`, or the Codex plugin mirror. Session end (lite) item (3) still says staging. No commit in this run. Intended commit message, for the harness: `eval(finish-flow): A/B Staging verify vs Usage evidence for step 7 (PM 01M78GBW, D8c part A evidence)`.

This repetition also did not edit `skills/finish-flow/SKILL.md`, `arm-b/SKILL.md`, `grade.py`, `cases.json`, `prompt-wrapper.md`, or `run-ab.py`. The other ten cases were not repeated. Intended commit message, for the harness: `eval(finish-flow): step7-usage-ab reps to 3 runs on the synthetic and two existing cases (PM 01M78M9M)`.
