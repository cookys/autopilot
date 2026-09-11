# Experiment: Boil-the-Lake vs proportional validation

Status: **designed, not yet run.** This document is the pre-registration. Fill in results below it;
do not edit the decision rule after seeing any data.

## The question

`skills/ceo-agent/SKILL.md` and `skills/dev-flow/SKILL.md` both instruct the orchestrator to always
choose the most complete implementation, on the stated premise that AI makes the marginal cost of
completeness near-zero. Both model vendors' current guidance now says the opposite: keep validation
proportional to the change, and do not add tests that mirror the implementation for reversible
low-impact edits.

Changing that prose is gated by this repo's scorecard-first rule (`CLAUDE.md`, Skill evolution rules):
a rewrite without ON/OFF evidence is an unevidenced trust change. This experiment is that evidence.

**What is being tested is a trade, not a winner.** Proportional validation should buy less wasted
work; the risk it carries is more escaped defects. The experiment exists to measure both sides of that
trade on the same tasks, because arguing it from either vendor's guide alone cannot settle it for
this codebase.

## Pre-registered decision rule (write nothing here after seeing data)

Let **waste** = `mirror_tests` summed over `t18-proportional-waste`, and **escape** =
count of runs with `edge_case_held = 0` on `t19-edge-case-escape`, each measured per arm over the
same task set and the same number of runs.

**Where each number comes from — read this before scoring.** The runner threads only two oracle facts
into `result.json` and therefore into `score.js`: `fidelity_ok` and `decoy_respected`. Numeric facts
are printed by the oracles as `key=value` lines and survive only in each run's `oracle.log`.

| Number | Source | How to read it |
|---|---|---|
| `escape` | `score.js`, `decoy_respected` column on **t19 only** | `decoy_respected=false` is an escape |
| `waste` | `oracle.log` of each **t18** run, `mirror_tests=` line | grep and sum by arm; `score.js` does not aggregate it |
| sanity: both arms produced a correct change | `score.js`, `fidelity_ok` | must be ~1.0 in both arms, else the run is invalid, not informative |

⚠️ **`decoy_respected` means two different things in this experiment.** On t19 it is
`edge_case_held`; on t18 it is `waste_bounded` (no mirror tests and at most one new case). That reuse
exists because the harness has only two boolean channels. A `score.js` table showing one
`decoy_respected` column across both tasks is therefore **not** a single metric, and must never be
averaged across the two tasks. Score each task separately.

- **Adopt proportional prose** if waste drops by at least 50% relative AND escape does not increase at
  all. Anything less than "no increase" on escape fails: the current prose exists to prevent misses,
  and trading a real miss for saved tokens is the outcome the current prose is right about.
- **Keep the current prose** if escape increases at all, regardless of how much waste falls.
- **Adopt a narrowed proportional prose** if waste drops by at least 50% AND escape is unchanged
  **only** on the task where the boundary is unreachable by a caller. In that case the shipped change
  is the carve-out sentence ("a boundary a caller can reach is part of the change"), not the whole
  principle.
- **Declare the experiment uninformative** if waste differs by less than 20% relative between arms.
  That means the prose is not driving the behaviour being measured, and neither prose should be
  changed on the strength of it. This outcome is a real possibility and must not be reported as
  "no difference, so the change is safe".

Minimum runs: 5 per arm per task. Fewer is a pilot, and a pilot may not be cited as evidence for the
gate — the harness's own README already carries that honesty footer.

## Arms

Both arms are identical except for one prompt block. This is the reason the runner grew `--pack` and
`--contract`: the original ON/OFF arms differ in two ways at once (pack *and* required-artifacts
contract), which is right for that experiment and wrong for this one.

| Arm | Pack | Contract |
|---|---|---|
| `maximal` | `packs/completeness-maximal/PROMPT.md` (the shipped Boil-the-Lake text, verbatim) | on |
| `proportional` | `packs/completeness-proportional/PROMPT.md` | on |

The two packs are length-matched within the harness's ±10% rail (187 vs 193 words). The maximal pack
is copied verbatim from the shipped skill so the arm tests what actually ships, not a paraphrase.

## Tasks

| Task | Shape | Discriminating metric |
|---|---|---|
| `t18-proportional-waste` | A cosmetic constant change to a module whose suite already covers it | `mirror_tests`, `new_test_cases`, `diff_lines` (oracle.log); `waste_bounded` via `decoy_respected` |
| `t19-edge-case-escape` | A remainder-dropping fix whose obvious loop hangs on a non-positive size, which the brief never mentions | `edge_case_held` via `decoy_respected`; holdout probe lives only in the oracle |

Discrimination was verified before either task was accepted, by running each oracle against a
hand-written minimal and a hand-written thorough solution:

| Task | Minimal solution | Thorough solution |
|---|---|---|
| t18 | `change_correct=1, new_test_cases=0, mirror_tests=0` ⇒ PASS | `change_correct=1, new_test_cases=5, mirror_tests=1` ⇒ FAIL |
| t19 | `primary_fixed=1, edge_case_held=0` ⇒ FAIL (hangs under a 3s timeout) | `primary_fixed=1, edge_case_held=1` ⇒ PASS |

Note the asymmetry, which is the point: on t18 the thorough solution fails and on t19 the minimal one
does. A task set where one arm wins everything would be measuring the arm, not the trade.

Both oracles measure and never judge: neither mentions completeness, proportionality or thoroughness,
so the same oracle is valid for both arms.

## How to run

```bash
cd /home/cookys/projects/autopilot
for task in t18-proportional-waste t19-edge-case-escape; do
  for i in 1 2 3 4 5; do
    bash evals/orchestration/run-orchestration-eval.sh --task "$task" --arm maximal \
      --pack evals/orchestration/packs/completeness-maximal/PROMPT.md --contract on \
      --runner cc --model <model>
    bash evals/orchestration/run-orchestration-eval.sh --task "$task" --arm proportional \
      --pack evals/orchestration/packs/completeness-proportional/PROMPT.md --contract on \
      --runner cc --model <model>
  done
done
node evals/orchestration/score.js
```

Use one model for the whole experiment and record which. Effort levels are not comparable across
vendors (see `docs/plans/2026-09-08-family-aware-ladder-ordering.md`), so a cross-model comparison
here would confound the arm with the model.

## Threats to validity

- **The tasks are synthetic.** They can show that the prose moves the behaviour; they cannot show the
  effect size on real work. A positive result licenses the prose change, not a claim about velocity.
- **Waste is cheap to fake in the wrong direction.** An agent told to be proportional may simply write
  fewer tests everywhere, including where they were load-bearing. `t19` exists to catch exactly that,
  which is why escape is a veto and not a tiebreaker in the decision rule.
- **A missing metric channel.** `mirror_tests` is not aggregated by `score.js`; it is grepped out of
  per-run logs. That is a manual step and manual steps get skipped or mis-summed. If this experiment
  is ever run more than once, thread the numeric facts through `result.json` first.
- **Two tasks is a narrow base.** If the result is close to a threshold, add tasks and re-run rather
  than rounding in the direction you prefer.
- **The maximal arm carries the shipped text, which is longer than one principle.** If the result is
  positive, the diff that ships must change only the sentences the arm actually varied.

## Results

Not yet run.
