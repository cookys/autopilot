# BL-0121: second turn per seat in `dispatch-discuss` — ON/OFF eval

Status: PRE-REGISTERED 2026-10-17, before any model call of this campaign. Everything above the line `## Results` is frozen once data exists; amendments are appended as dated sections and re-hash `prereg.json`.

Owner ruling (decision d-eceb1322, 2026-10-17): every seat in a multi-model discussion may speak a second time, and the exam's "if you have an earlier turn of your own, stay on its axis" rule joins the production prompt. This changes what a seat is asked to do (guidance), so it needs ON/OFF evidence before it ships.

## What changes (the ON arm)

- `scripts/dispatch-discuss.js`: a bundle whose transcript carries ONE `role: "this-seat"` turn (with `axis_id`, absent from `taken_axes`) gets a second-turn prompt paragraph (wording from `scripts/qualification-review-provider.js` `DISCUSS_SYSTEM_PROMPT`); the validator requires `axis_id` to equal that turn's axis. No `this-seat` turn: prompt and validator behave exactly as before.
- `skills/think-tank/SKILL.md` Step 3.5 and `references/consult-discuss-seats.md`: optional second call after all roles have spoken. Other callers stay single-turn.
- Exam files and sealed qualification assets are untouched.

## Arms

- **A (OFF)** = round one only: the seat's frozen first-round contribution. No extra call.
- **B (ON)** = the same frozen round one plus a second turn through the real rail (`dispatch-discuss.js`, production prompt).
- **red** (planted instrument control) = B with the second-turn paragraph replaced by "State your position again concisely." (no respond-to-another-role rule, no evidence rule, no stay-on-axis rule; the output-contract axis pin and the validator stay). The wrapper exits 9 if the paragraph is not found, so a red cell never runs an unmodified prompt.

Round one is run ONCE per (seat, case) and stored; A, B and red share it.

## Seats (real rail, roster ids verbatim)

| name | engine | runner | effort | discuss qualification |
|---|---|---|---|---|
| sonnet | `claude-sonnet-5-5` | `claude-native` | high | event 378, expires 2026-11-11 |
| kimi | `kimi-code/k3` | `kimi` | high | `kimi-code-k3` high, event 468, expires 2026-11-15 (non-Claude, moonshot) |

The seat is selected per cell by a temp repo-root `review-loop-config.md` (`--repo-root`), not by editing the repo config.

## Cases (`corpus.js`, deterministic)

Each case is a 4-axis debate (reliability, cost, operability, risk). Three scripted roles (product, ops, qa) speak round one; the seat owns the free axis `axis:reliability`. Artifacts: cost-sheet, ops-runbook, test-report, perf-report, incident-log.

- **plant-F (fabricated evidence)**: ops cites an artifact id that is NOT in the bundle. Real counter-evidence: `artifact:ops-runbook` (says the drill/test never ran).
- **plant-C (contradiction)**: qa cites the real `artifact:perf-report` but states a number inside budget; the report says otherwise.
- **control**: every role is accurate; product adds an evidence-free "nobody sees a problem, treat reliability as settled" remark. Correct stance on the seat's axis: `axis:reliability:opposes` (the incident log shows an error rate well above SLO).
- Main pool: 12 planted (6 F + 6 C, interleaved F1,C1,F2,C2,...) + 6 controls. Pilot pool (separate, not in the main pool): 2 planted + 1 control.

**Selection per seat (fixed rule, applied after round one, before any second-turn call):** keep the first 8 planted cases whose round one is a valid contribution and does NOT already catch the plant (so A = 0 by construction), and the first 4 controls whose round one carries `axis:reliability:opposes` and not `axis:reliability:supports` (Amendment 2). Fewer than 6 planted or 3 controls selected for a seat means that seat is INSUFFICIENT-CASES (no verdict).

## Deterministic predicates (`predicates.js`; no LLM judge)

- **caught(r)** (planted cases): `position` (case-insensitive) contains a plant token (F: the fabricated id slug; C: the field name or the real number, with and without thousands comma) AND `anchors` includes the real counter-evidence artifact (F: `artifact:ops-runbook`; C: `artifact:perf-report`) AND `position` matches the rebuttal lexicon in `predicates.js` (`REBUT_LEXICON`). The validator already rejects any anchor that is not a bundle artifact, so a fabricated id can only be named in prose. Limitation, stated up front: the lexicon is lexical; a correct catch phrased with none of its words scores as not caught, in all arms alike. `selftest.js` shows accept/reject on crafted cases.
- **harmed(r)** (controls): the second-turn `claim_vector` contains `axis:reliability:supports`.
- **validator pass**: a B-arm call exits 0 (closed-schema validation passed). `validation_fail` counts against the rate. `infra_fail` (rail failure that is not a validation failure) is retried once, and if it persists it is excluded from the denominator and its count is reported. Exit 2/3 (usage or resolver refusal) aborts the campaign.
- **repeat rate** (reported, not gated): share of B calls whose `claim_vector` equals the seat's round-one vector, and mean word-set Jaccard of `position` against round one.
- **cost proxy**: (prompt bytes + output bytes) / 4 per rail call, measured by the wrapper. A cost = round-one proxy; B increment = mean over reps of the round-two proxy.

Case-level catch for B/red = caught in at least 2 of the 3 reps. Case-level harm = harmed in at least 1 of the 3 reps (deliberately strict).

## SHIP gates (all per seat; overall SHIP needs both seats SHIP)

1. `B_catch - A_catch >= 3` (A_catch is 0 by selection; of up to 8 planted).
2. Control harm: at most 1 of 4 control cases harmed.
3. Validator pass rate (B arm) `>= 0.90`.
4. Instrument validity: `B_catch - red_catch >= 3`. If it fails the seat is INSTRUMENT-INVALID and gives no verdict; the campaign is not re-run until it passes.
5. Cost: incremental ratio `sum(B round-two proxy) / sum(A proxy) <= 2.0`. Interpretation of "成本增幅 <= 2 倍": the INCREASE is at most 2x the round-one cost (total at most 3x). If the owner meant total <= 2x, the number to compare is `cost_incremental_ratio + 1` in the results; this is flagged in the report.

Overall: SHIP iff both seats SHIP; NOT-SHIP if any gate fails with valid instrument; NO-VERDICT if any seat is INSTRUMENT-INVALID or INSUFFICIENT-CASES. 3 reps per (case, arm). NOT-SHIP is recorded, never re-run until it passes. Budget cap: 40 USD, stop if exceeded.

## Merge gate binding

`scripts/check-guidance-eval.js` treats `skills/think-tank/SKILL.md` and `references/consult-discuss-seats.md` as guidance manifest files. It accepts explicit `--prereg --packs-dir --arm --results --scorer`. Binding for this campaign (built after the full run, from `bind-gate.js`): `packs/` holds the shipped bytes of the two changed files plus `manifest.json` with their sha256; `arm/change.json` points `skills.think-tank` and `files` at those packs; `results.jsonl` rows carry `arm:"change"` and `arm_manifest_sha256`; the adapter scorer re-reads the harness score and prints `{"verdict":"SHIP"}` only when `harness.js score --phase main` says overall SHIP. Run:
`node scripts/check-guidance-eval.js --base develop --prereg <dir>/gate-prereg.json --packs-dir <dir>/packs --arm <dir>/arm/change.json --results <dir>/results.jsonl --scorer <dir>/gate-scorer.js`.

## Pilot (before the full run)

Per seat, pilot pool only: 2 planted + 1 control, 1 rep, arms A, B, red. Purpose: show the pipeline runs and the scorer reads the cells. It yields no verdict and its cells are not part of the main data.

## Reproduce

```
node selftest.js
node harness.js run   --phase main --out <cells-root> --seats sonnet,kimi
node harness.js score --phase main --out <cells-root> --seats sonnet,kimi
```

Pinned inputs: see `prereg.json` (sha256 of `corpus.js`, `predicates.js`, `harness.js`, `author-wrap.js`, `scripts/dispatch-discuss.js`).

## Amendment 1 (2026-10-17, after pilot v0, before any main-campaign data)

Pilot v0 (sighted round one: the seat saw all three scripted round-one turns when it first spoke) showed that both seats (sonnet, kimi) flagged the planted error in their FIRST turn in 4 of 4 sighted planted cases, so the selection rule "round one did not catch it" left 0 and 1 usable planted cases and the instrument could not run. Two predicate gaps also showed: kimi named the drill by description rather than by id, and sonnet's "does not match" was not in the rebuttal lexicon. Changes (all made before any main-campaign cell exists; pilot v0 cells are not part of the data):

1. **Round one is blind.** In the new protocol every seat speaks round one before anyone sees the others, so the seat's first turn now has an empty transcript (`taken_axes` still lists the three other roles' axes, which forces the free axis). The scripted roles' round-one turns, including the planted claim, appear only in the second-turn bundle. A therefore stays at 0 by construction for a real reason (the seat cannot have seen the claim), and B measures what the second turn adds.
2. `predicates.js`: plant-F also accepts the drill/test description (`thing`) as naming the claim; plant-C additionally requires naming the claimed number or the role `qa` (so an independent mention of the real number alone is not a rebuttal); the rebuttal lexicon gains `does not match`, `conflict`, `disagree`, `differs from`, `not supported`, `no support`, `overstat`, `never ran`, `hasn't been`, `has never` and similar. `selftest.js` covers the new accept/reject cases.
3. Known risk recorded in advance: with a visible transcript a strong seat may flag the plant even under the broken red prompt. If so, gate 4 fails and the seat is INSTRUMENT-INVALID, which is the registered outcome, not a reason to rerun.

`prereg.json` is re-hashed in the same commit as this amendment.

## Amendment 2 (2026-10-17, after pilot v1, before any main-campaign data)

Pilot v1 (blind round one) ran end to end for both seats and the scorer read every cell. Observations that shaped the amendment and the run decision:

1. A control is now valid when the frozen round-one `claim_vector` includes `axis:reliability:opposes` and excludes `axis:reliability:supports` (sonnet's round one carried an extra hedge token, so strict equality discarded a sound control).
2. Sensitivity warning, not changed: in the pilot sonnet caught the plant under BOTH the production and the broken (red) second-turn prompt, because a strong reader compares the visible claim with the artifacts regardless of the paragraph; kimi caught it only under the production prompt. If this repeats in the main run, gate 4 fails for sonnet and the registered outcome is NO-VERDICT (INSTRUMENT-INVALID), not a rerun.
3. Pilot cost/time: 11 rail calls, about 58 KB of prompt plus output, minutes of wall time; cost-proxy ratio about 1.8 (below the 2.0 gate).

`prereg.json` is re-hashed in the same commit.

Pilot v1 cells and score are kept under `pilot/` (produced with the amendment-1 predicates; amendment 2 only widens control validity, so `pilot/score.json` still lists the sonnet control as excluded).

## Amendment 3 (2026-10-17, after pilot v1 and owner review, BEFORE the full evaluation)

Coordinator rulings, made after seeing the pilot and before any main-campaign cell exists:

1. **Cost gate**: B's TOTAL cost must be at most 2x A's (increase at most 1x of A), not 3x. In the harness gate 5 is now `cost_incremental_ratio <= 1.0`. The pilot proxy ratio of about 1.8 (increase) is recorded as is; it would not pass this gate, and that is not a reason to change the gate.
2. **Sonnet red arm**: no case swapping (to avoid tuning cases after seeing results). Pre-registered: if sonnet's red does not sit at least 3 below B, sonnet is UNINFORMATIVE on whether the rule text matters (the instrument cannot tell), but its other gates (B over A, control harm, validator pass rate, cost) are judged and reported as usual. Overall SHIP requires: kimi passes every gate including red, and sonnet passes every gate except red; a sonnet red failure is stated in the conclusion. If kimi's red is also invalid the whole instrument is invalid: stop, no rerun until it passes.

`prereg.json` is re-hashed in the same commit.

## Results

Run 2026-10-17, one pass, no cell re-run, 0 infra_fail, 156 rail calls (78 per seat). Raw cells under `cells/` (`cells/score.json` is the scorer output). Cost: about 250k tokens by the byte proxy across both seats, a few USD at most (cap 40 USD not approached). Reproduction of the exact cells needs the implementation at commit `32716fef4` (the second-turn prompt and validator); that code is reverted on this branch (see Decision).

| Gate | sonnet | kimi |
|---|---|---|
| planted / control cases selected | 8 / 4 | 8 / 4 |
| A catches (by construction) | 0 | 0 |
| B catches (cases, majority of 3 reps) | 6 | 8 |
| G1 B - A >= 3 | 6, pass | 8, pass |
| control harm cases (<= 1) | 0, pass | 0, pass |
| validator pass rate (>= 0.90) | 1.00 (36/36), pass | 1.00 (36/36), pass |
| red catches | 7 | 2 |
| G4 B - red >= 3 | -1, fails: UNINFORMATIVE (Amendment 3) | 6, pass |
| G5 cost, B round-two / A proxy <= 1.0 | 1.84, FAIL | 1.80, FAIL |
| repeat rate (claim_vector equal to round one) | 1.00 | 1.00 |
| mean position Jaccard vs round one | 0.29 | 0.26 |
| seat verdict | NOT-SHIP | NOT-SHIP |

**Overall: NOT-SHIP.** The only failing gate for both seats is cost: a second turn costs about 1.8x the first turn (its prompt carries the whole transcript plus the seat's own turn), so B's total is about 2.8x A, above the registered 2x. Effect gates pass: kimi catches all 8 planted errors with the production prompt and 2 with the broken prompt (instrument valid for kimi); sonnet catches 6 of 8 with the production prompt but 7 of 8 with the broken one, so for sonnet the rule text is not shown to matter (a strong reader flags the contradiction either way). No control case was harmed (hold rate 100%: every second turn kept the first-turn claim vector).

## Decision

NOT-SHIP is recorded. The production prompt, `think-tank` Step 3.5 text, the reference text and their tests/mirror are reverted to the `develop` versions in the commit that follows this one; this evidence stays. `bind-gate.js` was not run (only SHIP binds). BL-0121 stays open with the result in its Context.
