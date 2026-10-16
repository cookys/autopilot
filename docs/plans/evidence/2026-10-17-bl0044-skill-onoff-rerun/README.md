# BL-0044 / BL-0049 — dev-flow contract-card re-attempt: instrument repair and rerun

Owner approved the evaluation budget on 2026-10-17. Machine rules: `evals/skill-onoff/prereg/dc.json`
(frozen by the commit that adds this file; any later edit to it restarts the block). Scorer: `evals/skill-onoff/score-dc.js`.
Raw cell transcripts are NOT in git (large); they sit in the lane scratchpad and are summarised below with paths.

## Why the 2026-08-18 instrument was vacuous, and what changed

| Defect found | Evidence | Repair |
|---|---|---|
| The fixture repos had none of the scripts the live body now runs (`session-mode.js`, `stage-advance.js`, `stage-graph.js`...). A FULL arm would fail for a reason that is not its prose. | live body Session Start steps 1-4 | New frozen `fixture-scripts-dc`, built from the live tree at `87d3fd29c`. Pilot 1 caught that it missed `schemas/*.json` (every `session-mode.js` call crashed: "canonical campaign schema is unreadable"); fixed and now pinned by a load test with a negative control (pack without `schemas/` must fail to load). |
| F6 marker required `Skill(quality-pipeline)` on XS/S tasks; P7 scoped the rule by size. | `p7-f6-f4-adjudication.md` | F6 now uses two M-size tasks (`dc-m-gate-a/b`). |
| F4 fixture had no `docs/` tree, so the model had to originate a directory. | BL-0049 | `dc-fix-known`, `dc-fix-known-b`, `dc-bug-multi` carry an existing `docs/projects/ongoing-maintenance/2026-10.md` with rows; marker = ledger gained a row. n=9 instead of 3. |
| F1 absence markers (d1, d7) and F5 were at the generic-competence ceiling (OFF 6/9, 5/6). | `p6-adjudication.md` | F1 now requires a positive observable: the size is recorded (`session-mode.js set --size X`) before the first edit/commit, correct for the task, plus no tracking tree. F5 is informational (below). |
| Markers anchored on "before the first Edit/Write"; headless sonnet edits through Bash (python / sed / heredoc) as often as through Edit. | pilot transcripts | Anchor = first Edit/Write OR first `git commit`; red-first uses an explicit mutation pattern and a real test run (`bash run-tests.sh`, not `cat run-tests.sh`; the old `run-tests` regex matched a read). |
| The bare task prompt never reaches the skill: sonnet-5-5 does the edit directly (pilot 0: 0/20 invoked). | `evals/skill-onoff/prereg/stage-graph.amend-1-invocation.json` precedent | `ONOFF_PROMPT_PREFIX="Use dev-flow:"` in EVERY arm (names only the skill). Claim scope becomes: given an explicit invocation, does the body's content change behaviour. Routing is not measured. |
| d4 hotfix marker required a `--no-ff` merge; that is finish-flow's Merge row, a node headless sonnet does not reach. | pilot: fast-forward in 3/3 FULL | `dc-hotfix` marker reads dev-flow's own Start-gate branch rule: the fix is made on a `hotfix/` branch cut from `main` and lands on `main`. |
| The bug commit-message rule (finish-flow, bug row) was never measured, yet it is the most skill-driven behaviour in the pilots. | pilot: root-cause message FULL 12/12, OFF 0/12 on bug tasks | New family F8: a commit since the base states the root cause. |

### What the live body asks, family by family (BL-0049 mapping)

| Family | Live rule (where) | Observable | Status |
|---|---|---|---|
| F1 sizing recorded | Session Start step 1 `session-mode.js set --size` + Sizing table | `session-mode.js set` with the right size (and `--bug`) before the first edit/commit; S task creates no tracking tree | counted |
| F2 stage entered | Session Start step 4 / Stage protocol: `stage-advance.js --to <node>` before work | a `stage-advance.js ... --to` call before the first edit/commit | counted |
| F3 branch discipline | Start gate "Branch check": bug => `fix/`, production broken => `hotfix/` from `main` | reflog shows the branch cut and the fix lands on the target | counted |
| F4 maintenance ledger | finish-flow "Ongoing-maintenance entry" (bug, XS-M), reached from dev-flow's finish handoff | a new row appended to an existing ledger | counted (BL-0049 re-measure: fixture repaired, n=9) |
| F8 root cause in commit | finish-flow "Bug commit message" row | `git log --all --not <base>` contains "root cause" | counted |
| F5 red before edit | the live body has NO inline red-first rule (the verification contract is answered mentally before `implement` and routes engine reviewers) | test run before the first `lib/` mutation | informational: pilot OFF 3/3 on the one task that names the test command |
| F6 quality gate (M) | `qc-gate` node: M/L/XL => `autopilot:quality-pipeline` | `Skill(quality-pipeline)` before the first commit on an M task | informational: pilot FULL 0/6 (consistent with the 2026-08-18 finding; the rule stays `documented-only`) |
| I7 L gates | Entry gates (session-start-sha, plan, README) | files exist | informational: pilot FULL 0/3 (headless L stops at the plan) |

Counted families are the ones whose rule the live body states and whose observable the pilot showed to be reachable. This is a
pilot-informed choice and is disclosed as such: F5/F6/I7 stay measured and printed but do not count toward V2.

## Pilots (non-gating; rows are discarded and never reused)

| Pilot | Cells | Finding |
|---|---|---|
| 0 | 20 (bare prompt) | skill never invoked (0/10 FULL) -> prefix added |
| 1 | 20 | fixture scripts crash (missing schemas), Bash-edit blind spot, `cat run-tests.sh` counted as a test run, hotfix `--no-ff` over-strict |
| 2 | 60 (3 reps FULL/OFF, 3 families load-bearing: F1 8/0, F2 7/0, F3 8/0; F5 4/3, F6 0/0) | F8 discovered from the transcripts; ledger became 2/6 vs 0 once the fixture had a tree |

Pilot totals: 160 cells, 17.66 USD (list price from `modelUsage.costUSD`), transcripts in
`/tmp/claude-1000/-home-cookys-projects-autopilot/a6cb3442-5126-4226-b728-ccd67665cfd4/scratchpad/pilot*`.

## Arms (all frozen packs, digest-verified by the harness; `evals/skill-onoff/arms/dc/{full,card,off,red}.json`)

| Arm | `skills/dev-flow/` | Everything else |
|---|---|---|
| full | `dev-flow-dc-full`: byte copy of the live skill at `87d3fd29c` (534 lines) | 15 other skills `*-dc-full`, `guidance-files-dc`, `fixture-scripts-dc` identical in all arms |
| card | `dev-flow-dc-card`: contract card of the same body, 483 lines (-51, 9.5%; relocated: ladder terms, drift table, wait-rule rationale, completeness principle, anti-pattern table, compatibility notes, scripts index -> `references/card-relocated.md`). Mechanically checked: every `node/bash scripts/...` command line, frontmatter, the 4 injection lines and the TaskCreate blocks survive; `check-canonical-invariants.sh` green. | same |
| off | absent | same |
| red | `dev-flow-dc-red`: the full body with two planted regressions (Session Start step 1-4 replaced by "never run the session scripts"; Branch check row inverted to "never create a fix/ or hotfix/ branch") | same |

The card delta is small: the live body is already table-shaped, so the card mostly moves explanatory prose. The honest reading of a
NON-INFERIOR result is therefore "a 9.5% shorter body loses nothing measurable", not "contract cards are free".

## Pre-registered rules (frozen before the first gating cell)

Runner: `claude` 2.1.301 (binary copied, `DISABLE_AUTOUPDATER=1`), sonnet (`claude-sonnet-5-5`), `claude -p`, scratch HOME and config dir,
prefix `Use dev-flow:` in every arm, 3 reps, resume-by-cell, `ONOFF_KEEP_CELLS_DIR` keeps transcripts per cell (round directories are separate).

1. **P-A** (full, off; 10 tasks x 3 reps = 60 cells): V1 and V2 below. If V1 or V2 fails the result is INSTRUMENT-INVALID, the card arm is NOT run, and the campaign stops (no further repair inside this budget).
2. **P-R** (red; 30 cells): red check = `score-dc.js` over the full rows plus the red rows renamed `arm=off`, `--arms full,off`: F1, F2 and F3 must each be load-bearing. If not, the instrument cannot see a regression: INSTRUMENT-INVALID, card not run.
3. **P-C** (card; 30 cells): only after P-A and P-R pass. `score-dc.js` over all three arms.

- **V1** manipulation: `skill_invoked` >= 2/3 of effective runs in FULL (and in CARD).
- **V2** sensitivity: family load-bearing iff FULL - OFF >= 3 (n=9). Instrument valid iff >= 4 of the 5 counted families (F1, F2, F3, F4, F8) are load-bearing.
- **V3** non-inferiority on every load-bearing family: CARD >= FULL - 2, and CARD - OFF >= ceil((FULL - OFF)/2).
- Verdict map: V3 pass on all -> **SHIP-GATE-MET** (dev-flow SKILL may be replaced by the card, in a separate commit); V3 fails on <= 2 families -> **ITERATE-CARD**; on > 2 -> **ABORT-RECORD**. Neither non-SHIP outcome edits `skills/dev-flow/SKILL.md`.
- Exclusions: a cell with `failure_class` is re-run up to 2 more times; a (task, rep) missing in any arm is dropped from all arms; >= 2 lost pairs in a family or > 10% unresolved cells in an arm invalidates the block; runner-version drift invalidates.
- Budget: nominal 120 cells, hard cap 150, about 13-20 USD at the measured 0.11 USD per cell.
- Informational families (F5, F6, I7) are reported, never used for a verdict.
- The final SHIP/NOT-SHIP is a read of the printed table; the rules above are clamps against motivated reasoning. A NOT-SHIP is recorded as-is (BACKLOG updated, no re-litigation without a new card or new runs).

## Negative controls shipped with the repair

- `hooks/tests/skill-onoff-dc-markers.test.sh`: per marker no-op => false, compliant => true, planted violation => false (wrong size, size after the commit, project tree on an S task, bug flag missing, bug sized L, fix on develop without a branch, edit before the test run, edit and test in one event, `cat run-tests.sh` is not a run, ledger untouched, commit without root cause, hotfix on main directly, quality gate after the commit); prompt-hygiene scan with a planted leak; fixture-pack load test with a pack missing `schemas/` that must fail.
- `hooks/tests/skill-onoff-dc-score.test.sh`: a vacuous FULL == OFF dataset can never reach SHIP-GATE-MET or the V2 phase pass; card regression => ITERATE-CARD; dead card => ABORT-RECORD; V1 failure => INSTRUMENT-INVALID.
- Live planted-red arm (P-R above).

## Results

Run 2026-10-16 23:21 to 2026-10-17 00:25 (CST), 120 gating cells (P-A 60, P-R 30, P-C 30), 0 infra failures, 0 excluded pairs,
runner 2.1.301 throughout, cost 17.54 USD (gating) + 17.66 USD (160 pilot cells) = 35.20 USD in total. Rows and scorer output:
`results-pa-full-off.jsonl`, `results-pr-red.jsonl`, `results-pc-card.jsonl`, `score-final.json`, `score-redcheck.json`.
Raw per-cell transcripts (not in git): `/tmp/claude-1000/-home-cookys-projects-autopilot/a6cb3442-5126-4226-b728-ccd67665cfd4/scratchpad/gate/cells-*/<task>/<arm>/<rep>/transcript.jsonl`.

### P-A + P-C (n = 9 per counted family)

| Family | FULL | CARD | OFF | V2 load-bearing | V3 (CARD >= FULL-2 and CARD-OFF >= ceil((FULL-OFF)/2)) |
|---|---|---|---|---|---|
| F1 sizing recorded | 8 | 6 | 0 | yes | pass (6 >= 6, 6 >= 4) boundary |
| F2 stage entered | 7 | 7 | 0 | yes | pass |
| F3 branch discipline | 8 | 9 | 0 | yes | pass |
| F4 maintenance ledger | 6 | 4 | 1 | yes | pass (4 >= 4, 3 >= 3) boundary |
| F8 bug commit root cause | 9 | 9 | 0 | yes | pass |
| F5 red before edit (info) | 3 | 3 | 3 | no | |
| F6 quality gate M (info) | 0 | 0 | 0 | no | |
| I7 L gates (info) | 0 | 0 | 0 | no | |

V1: dev-flow invoked 30/30 in FULL and 30/30 in CARD. V2: 5/5 counted families load-bearing. **Verdict by the frozen map: SHIP-GATE-MET.**

### P-R red check (instrument can see a regression)

Full rows against red rows (renamed arm=off): F1 8 vs 0, F2 7 vs 0, F3 8 vs 0 are load-bearing, as required; F4 6 vs 0 also. F8 9 vs 9 is not,
correctly: the planted regressions removed sizing, stage entry and the branch rule only, and the root-cause commit rule was left intact.
The red arm invoked the skill 30/30, so the drop is the body's content, not routing.

### Reading and limits

- Two boundary passes (F1 6 vs the threshold 6; F4 4 vs 4). A one-count shift would have turned them into ITERATE-CARD. The verdict stands under the frozen rule; the margin is thin and is recorded rather than smoothed.
- The card's F3 at 9/9 against FULL 8/9 and F4 4 vs 6 are within the noise of n=9 per arm at one model; no card advantage is claimed.
- Claim scope: single-turn headless `claude -p`, sonnet-5-5, explicit `Use dev-flow:` invocation prefix, small fixtures. Not measured: routing, interactive sessions, L/XL walks (headless L stops at the plan), the quality gate on M (documented-only, 0/6 in both arms), red-first (the live body has no inline rule), opus-class behaviour.
- BL-0049 answer: with a fixture that already has the ledger tree, F4 is FULL 6/9 vs OFF 1/9 (the 0/3 in 2026-08 was the missing tree, as suspected). No enforcer is warranted on this evidence; the rule stays `documented-only` in `references/four-layer-design.md` S2 and the number is updated there.
- F6 stays at 0/6 with the dev-flow body loaded: the M-size quality-pipeline invocation is still not followed in headless sonnet. This is an independent finding about the live rule, unchanged by the card.


## Second gate before any swap: stage-graph coverage (registered 2026-10-17, before its cells finished)

The card relocates the ladder `--terms` paragraph (the v5 rule that took stage-graph to 10/12) and the anti-patterns table, and the dc tasks
contain no research or ladder walk. `scripts/check-guidance-eval.js` also requires any guidance change at a cut to match an evaluated stage-graph pack.
So the dc verdict alone does not license the swap. Rule, from the frozen `prereg/stage-graph.json` (no new thresholds): the 12 stage-graph briefs x 3 reps
on arm `evals/skill-onoff/arms/dc-sg/change.json` (= the evaluated v10 `change` arm with `dev-flow` replaced by `dev-flow-dc-card`), same prefix, same pinned binary,
`change` arm only (the planted-red arm of that row was already shown to separate in v10). Pass = at least 10 of 12 briefs pass (>= 2 of 3 reps each, as in the row's scorer).
Swap `skills/dev-flow/SKILL.md` only if BOTH the dc verdict is SHIP-GATE-MET AND this gate passes. Below 10/12: record "dc SHIP-GATE-MET, stage-graph coverage NOT-SHIP", no swap,
and the card is not edited to restore the paragraph (a card edit invalidates the CARD rows).

### Second gate result (2026-10-17)

36 cells (12 briefs x 3 reps, card in the evaluated v10 `change` arm), 0 infra failures, same binary 2.1.301 and prefix. The scorer's `change` count is **10 of 12** briefs
(per brief: xs-feature 3, s-feature 3, m-feature 3, l-feature 3, xl-deliverable 3, xs-bug 3, m-bug 2, s-urgent 3, m-urgent-high 3, l-u0-known 2, l-research-a 0, l-research-b 0 of 3),
the same 10/12 as the evaluated v10 body, with the same two research briefs failing structurally in headless. The scorer's own verdict reads STOP only because the red and generic arms
were deliberately not run for this gate (registered above). Rows: `results-sg-card-change.jsonl`, `score-sg-card.json`. Boundary again: 10 is the threshold.
Both gates pass, so `skills/dev-flow/SKILL.md` is replaced by the frozen card in a separate commit.
