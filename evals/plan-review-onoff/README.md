# plan-review ON vs OFF on M-size plans (stage-graph P0)

Question (plan fleet-stage-graph-binding, P0): does adding a plan-review node to the M walk catch plan defects before implementation? Scorecard-first (`skills/CLAUDE.md`): no graph change without this evidence.

## Design (pre-registered before any scored cell ran)

- 5 plan-sized tasks (`tasks/T1..T5/brief.md` + a small `fixture/` repo). Each brief carries one planted trap (D1, task-specific): T1 wrong file, T2 dangling dependency, T3 nonexistent verification command, T4 generated file, T5 irreversible step. Every task also scores two shared defects: D2 no negative control, D3 unbounded scope. Max 3 defects per task, 15 per arm.
- Paired design: per (task, rep) one author draft. **Arm OFF = the draft as written. Arm ON = the same draft, reviewed by `scripts/dispatch-plan-review.js` (frozen generic rubric `rubric.md`, one generation), then revised by the author seat with the review JSON.** Same draft in both arms, so the difference is the review.
- Seats, cheapest the rails allow: author and reviser = codex `gpt-6.2-sol` effort low via `dispatch-author.sh`; reviewer = agy `gemini-4-hydrogen-high` (non-Claude family, so the cross-family rule is met). No Claude seat (claude-native refuses without a token seat), no astra, carbon, argon or fable; no on-demand billing; no xhigh.
- Reviewer sees the plan, the generic rubric and the fixture source files (`--context-file`); it never sees `defects.json` or `score.js` (review runs in a scratch git repo made from `fixture/`).
- 2 reps per task (10 paired cells). `node run.js <task> <rep> <out-dir>` runs one cell.

## Scoring (deterministic)

`score.js` applies the regexes in `defects.json` to a plan text; no model grades. Primary score = defects caught (D1+D2+D3 per task, summed over all cells; max 30 per arm for 10 cells). Secondary (reported, not in the bar): quality items Q1 steps carry verification, Q2 at least two concrete files, Q3 at least three ordered steps (max 30). Scorer negative control: a plan editing the wrong file with no checks scores 0/3, a plan with all items scores 3/3 (shown in the result).

## Pass bar (frozen)

PASS if `ON_defects - OFF_defects >= 5` of 30 (about one extra defect caught in every other cell) **and** ON quality is not lower than OFF quality by more than 2. Otherwise FAIL (no M plan-review node; P5 is dropped).

## Known limits (stated before running)

- The rubric names the same defect classes the scorer counts (that is what a review rubric is for), so ON is expected to gain on D2/D3 by construction; D1 gains are the stronger signal and are reported separately.
- One generation of review, one reviewer seat, low-cost author: this is a floor for the review's value, not the production panel.
- Regexes are text heuristics; a plan can pass a check in words only. n = 10 cells is small; the verdict is a go/no-go screen, not a measurement of effect size.
- The scorer regex for D2 was widened once after a one-cell pilot (T1 r1, discarded; the pilot plans were not re-used) and before any scored cell.
