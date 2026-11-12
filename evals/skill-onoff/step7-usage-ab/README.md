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

## Out of scope

No edit to `skills/finish-flow/SKILL.md`, frozen `packs/`, or the Codex plugin mirror. Session end (lite) item (3) still says staging. No commit in this run. Intended commit message, for the harness: `eval(finish-flow): A/B Staging verify vs Usage evidence for step 7 (PM 01M78GBW, D8c part A evidence)`.
