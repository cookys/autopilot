# dev-flow stage graph — execution log

Plan: [`../../2026-10-06-dev-flow-stage-graph.md`](../../2026-10-06-dev-flow-stage-graph.md) (R2 FROZEN). This file records what happened while executing it; the plan itself is not edited after freeze.

## Train A landings (develop)

| Phase | Commit | Depth-0 verification |
|---|---|---|
| P-R | `c45e8882` | `semver.test.sh` 174 assertions green in worktree and on develop; mutation (pre-release rank reversed) → 9 assertions red; probe `p-r-probe.txt` (`claude plugin validate` + `--plugin-dir` run on a `3.0.0-alpha.1` fixture) |
| P4a | `8cd6420b`..`27da176d` | First return was green only while the golden was untracked: the golden contained the invented term, `git grep` counted it once committed, and the knob-off case went red (131/1). Returned to the hand; fixed by running golden/v3 cases with `--repo-root` in a throwaway repo, plus a 13th golden case without budget flags (the first 12 pinned `--budget-u1 2`, so a default change was invisible). Re-verified from the committed state: 132 green; `DEFAULT_BUDGETS.U1=3` → red |
| P0 | `17a3ada6` (4 commits) | `skill-onoff-stage-graph` (12/12; rotated red 3 ≤ 3) and `check-guidance-eval` green after rebase; 5 existing skill-onoff suites green; fixture spot-checked against §2.7 (urgent-low terminal, urgent-high order, XL bug+research×3 single code-review); 84 cells. `skill-onoff-generic.test.sh` is red on develop too (real `~/.autopilot` root changes while other sessions run) — pre-existing, not P0 |
| P1 | `813bf3e8` | `stage-graph.test.sh` 19/0 (all 84 fixture cells exact) after rebase; own mutation (drop code-review from M base) → 16/3; `check-stage-vocab.js` report-only, 1113 findings today (old ids 929, size enum 28, marker phase 120, owner U4 36) |
| P2a | `d15d9306`..`6b0eabfa` | First return counted the E1 bump on `base_ref..HEAD` as the plan text said — but dev-flow runs qc-gate before commit, so for XS/S the bump would never fire. **Plan deviation (depth-0):** the bump and the `high_risk` sample measure base_ref vs the working tree plus untracked non-ignored files (`classify-diff-risk.sh --diff-file`). Re-verified from the committed state: `stage-advance.test.sh` 140/0, session-mode suites green, contract-schema ok; own mutation (untracked files excluded) → 5 red |

## Push and QC debt

- 2026-10-06: develop pushed to origin with `git push --no-verify` (`7fc8efc5..776ece39`, 197 commits) by owner choice "b". The qc-gate pre-push hook blocked it because no commit carried `QC-Verdict: PASS`. The range holds the mods P1W work (per-fix reviews recorded in `../2026-10-04-mods-p1c/accepted-heads-p1w.txt`) plus Train A. **A full QC of the protected diff is owed before the alpha.1 cut.**
- Train B branch: `release/3.0.0` created at `776ece39`.

## Train B (release/3.0.0) — mechanism sub-steps

Release merges happen in the dedicated worktree `.claude/worktrees/release-3.0.0`. The main checkout stays on develop, because it is the live plugin.

| Sub-step | Head on release | Depth-0 verification |
|---|---|---|
| P6 | `67c402ba` | Gate and three suites are green. Own mutation (graph admits size `H`): checker suite red (2). BACKLOG migrated: 5 `Fix` changed to `S`. |
| P2b | `65e8cf99`, `616c8bb6` | `marker_phase` is down to 3 non-mirror hits: 1 intentional invalid fixture, now exempt, and 2 in `references/review-page.md` left for P5. Session-mode, stage-advance, watch-inputs and review-page suites are green after rebase. |
| P3 | `91cc437a` | Rail-stage-writers (51), dispatch-plan-review (287), hetero-review-loop (219) and stage-advance are green after rebase. Exit 2 (no marker) is silent by design. Families are recorded from completed seats only. |
| P4b | `1b547141`..`09c05044` | **First return reworded comments ("rung four") to dodge the ±1-line `owner_u4` detector.** Returned: the detector now flags only phrasings that describe U4 as owner, with a negation guard. The vestigial `ladder_v3` key is removed, and the golden diff is that key only. The detector's 64 KiB pipe truncation (stdout.write then exit) is fixed. Own mutation (exhaustion emits U5): 10 red. A first mutation (chain extended to U5) was inert because eligibility caps it, so it was not counted. |
| develop merge | `641178e2` | Brings `e1ba7a7b`. |

`check-stage-vocab.js` on release: old_stage_id 911, old_size_enum 29, marker_phase 4 (including the mirror), owner_u4 0. The rest is P5 prose.

## Train B — P5 guidance (release/3.0.0)

| Step | Head | Notes |
|---|---|---|
| P5c | `5fa73e14` | quality-pipeline is now the qc-gate node; next and project-lifecycle use the new sizes; config templates; `references/{backlog-entry,review-page,evidence-discipline}.md`, with evidence-discipline gaining §56 (golden green while untracked) and §57 (pre-commit gate measured on committed history). Nothing dropped. |
| P5b | `d466f525` | ceo-agent, l4–l6, debug, think-tank, team, plan-template. The ladder is U0–U5 at the three call sites. Dropped: the three `S-scope-gate` indicators (replaced by the E1 bump) and the H-9 six-subtask TaskCreate (finish-flow owns closing). |
| P5a (opus) | `2090e911` | dev-flow 736 → 489 lines, finish-flow 189, new `skills/dev-flow/references/stage-graph.md`. Changed: XS/S now take a short finish; quality-pipeline moved into qc-gate; per-phase verifier plus one full-diff code-review; "bug fix never plans" removed (size decides). Urgent order is decided by attempting `--to code-review` after the last verify. |
| arm builder | `556ef38a` | Multi-pack arms, change/red freezer, `fixture-scripts-sg`, campaign command. Dry-run: 114 cells, estimated $15–59 (basis: 74 measured sonnet cells at $0.135 mean; stage-graph cells assumed at 2×). |
| integration | `0f7b3396` | `check-stage-vocab --gate` reports 0 and is wired into canonical invariants. `S-scope-gate` literals were replaced by a `size-bump-command` invariant. Profiles were re-pinned (815 → 654 rules). Pre-commit passes without `--no-verify`. Mutation: planting `L-2.5` in a skill made both gates red. |

## P5 eval run

- **Pre-run** (`c6485a8a`, `78a91c3d`):
  - prereg amended before any results were seen: guidance files 61 → 65, adding the three references plus the new `skills/dev-flow/references/stage-graph.md`;
  - change and red packs frozen;
  - `check-guidance-eval` file half: 43/43 differing files byte-equal to the pack.
  - The red arm rotates `references/stage-graph.json` in `fixture-scripts-sg-red`. The new dev-flow has no size table to rotate (`--require-text` fails by design). The builder's self-check confirms rotated walks.
- **First launch was invalid.**
  - The first 4 cells ran 6–7 s with `skill_invoked:false`, and change and red were identical. The campaign sent the bare task with no invocation preface, so headless sonnet never loaded dev-flow. This is the same failure as P1W amend-2.
  - The run was stopped after 4 cells (~$0.5). Those rows are instrument-invalid; they were set aside unscored at `scratchpad/eval-invalid/` and are not counted as data.
  - Fix `3bfce882`: `ONOFF_PROMPT_PREFIX='Use dev-flow:'`, the same in every arm, naming no size or stage vocabulary. It is recorded as `prereg/stage-graph.amend-1-invocation.json`.
  - Confirming cell: 14 s; `Skill autopilot:dev-flow` → `set --size XS` → `--to implement` → `qc-gate` → `finish`; all markers true.
- **Relaunched** on release `3bfce882`. First rows: change rep 1 took 19 s and passed; red rep 1 took 32 s and failed.

- **Verdict, change arm v1 (packs `*-sg-change`): NOT-SHIP.** The rule needs ≥ 10/12 tasks; the change arm passed 6/12. Red passed 1/12, so the instrument discriminates. Generic: 5 markers checked, none regressed. Total 114 cells.
  - Passed (≥ 2/3 reps): xs-feature, s-feature, xs-bug, m-feature, xl-deliverable, s-urgent.
  - Failed: l-feature 1/3, m-bug 0/3, m-urgent-high 1/3, l-u0-known 0/3, l-research-a 0/3, l-research-b 0/3.
  - Recorded as-is. Per the prereg, the next attempt is a new arm; there is no rerun of v1.
  - Per-rep diagnosis (guidance / task / instrument / noise) is in progress. Any task or instrument change made after seeing this data is flagged for the owner's decision.

- **Verdict, change arm v2** (packs `*-sg-change-v2`; guidance v2 `356c69a6`; amend-2 `8b460bb2`): **NOT-SHIP**.
  - Change passed 4/12 tasks: xs-feature, s-feature, xs-bug and s-urgent.
  - Red passed 0/12.
  - **Generic regression** on `d2-l-multimodule`: `f1_session_sha` dropped from base 3/3 to change 1/3, and `f1_plan_file` from 2/3 to 1/3.
  - Run 1 lost 80 cells to OAuth expiry (infra_fail), and those cells were resumed after `/login`. The infra rows remain in `results/stage-graph.v2.jsonl` and are not scored.
  - Per-cell transcripts are retained under `results/stage-graph-cells/`.

- **Verdict, change arm v3**: **NOT-SHIP**. Packs `*-sg-change-v3`; guidance v3 `7de9b10c`; amend-3 `72b796d0`. All 114 scored cells ran on Claude Code 2.1.292, pinned with `DISABLE_AUTOUPDATER=1`.
  - **First pass was instrument-invalid.** Claude Code auto-updated 2.1.291 → 2.1.292 at row 57, so the scorer returned no counts. The 57 rows from 2.1.291 were set aside unread in `scratchpad/eval-v3-runs/` and re-run pinned to 2.1.292.
  - **Change arm: 9/12.** It passes every task except l-feature (0/3), l-research-a (0/3) and l-research-b (0/3). The two research tasks failed as predicted, for structural reasons: in headless runs the agent stops to ask a human.
  - **Red: 3/12**, within the ≤ 4 limit.
  - **Generic: 4 markers checked, none regressed.** The d2 regression from v2 is fixed by restoring the L entry gates.

- **Verdict, change arm v4: NOT-SHIP, 9/12.**
  - Setup: packs `*-sg-change-v4`, guidance `f8855559` (ladder routing keyed on `eligible_max`), 114 cells all on 2.1.292, no infra failures. Red 3/12. Generic: 4 checked, none regressed.
  - l-feature is still 0/3. In all three reps the probe at intent returned U1, and the rung check was consistent, so the scorer expected the research variant. The agent still went `intent → proposal`.
  - The terms it passed were well-known runtime APIs (`node fs rename`, `node:fs`), which have zero repo hits.
  - The v4 text was confirmed present in the frozen pack, so the agent saw the rule and did not apply it to a dependency it considers general knowledge.
  - Open design question for the owner: should a well-known external dependency with zero repo hits force `research`? The v4 hand flagged this as well.

- **Verdict, change arm v5: SHIP.**
  - Packs: `*-sg-change-v5`. Guidance: `259e5571` (the `--terms` rule now excludes well-known dependencies, per owner ruling R-K1).
  - Runner: every cell ran on 2.1.292, pinned. Run 1 hit the weekly quota, so 55 cells came back infra_fail. They were resumed in the same results file after the reset. Each (task, arm, rep) has exactly one usable row.
  - **Change arm: 10/12.**
    - Every task passes except l-research-a and l-research-b, both 0/3. These two are structural, as predicted.
    - l-feature went from 0/3 to 3/3.
  - **Red arm: 3/12.**
  - **Generic: 5 markers checked, none regressed.**
  - Next: `check-guidance-eval` must accept the v5 suffix arm (BACKLOG e) before the cut gate can be run.

- **Total QC and change arm v6 (2026-10-08).**
  - `check-guidance-eval` now derives pack ids from the arm manifest (`265aa2a7`, BACKLOG e closed); on v5 it passes (43/43 byte-equal, scorer SHIP). v5 results committed (`3aae28a4`).
  - Total QC of Train A + B (`8a10980f..3aae28a4`): 8 packets × 3 seats, then a delta review of the fixes, all SHIP-AS-IS — see [qc-total-2026-10-08/README.md](qc-total-2026-10-08/README.md). Fixes F1–F5 (docs, probe-unknown U4, preflight final-version match, 12 disposition rationales, 7 test suites) and guidance fixes G1–G5 (finish-flow marker clear at any size for l4–l6, ceo-agent project dir on L/XL, urgent probe scoped to M/L/XL, backlog-row cleanup, resume `--unit`).
  - G1–G5 change guidance, so by owner decision a v6 arm was frozen (`f47798c0`, packs `*-sg-change-v6`/`*-sg-red-v6`, base arm unchanged) and the campaign relaunched on 2.1.292 into `results/stage-graph.v6.jsonl`. Same frozen rule (change ≥ 10/12, red ≤ 4/12, generic no regression).

## Open items for the alpha.1 cut

1. **Total QC of the protected diff.** Done 2026-10-08 (see v6 entry above). This was owed since the no-verify push. It also covers Train B. **Points for the reviewer:**
   - (a) The profiles re-pin accounts 364 baseline rules as `removed` dispositions (12 relocated verbatim).
   - (b) To keep the shrink green, `profile-context-isolation`'s "inventory ≥ baseline" check was changed to allow for the disposition count. That changes a test assertion, so it needs a human look.
   - (c) P5a/P5b dropped requirements, listed above.
2. **Resume gap.** A resumed session that comes back with a new session id must re-walk from the entry node, because `stage-advance` requires the first write to be the entry. The workaround is in `skills/dev-flow/references/context-continuation.md`. This needs a BACKLOG row for a `stage-advance --resume`.
3. **G1 has no resolver key.** Low-risk work already resolves to `required_review_families=1`, but "fresh-context reviewer" is documentation only. Needs a BACKLOG row.
4. **Generic-arm overlay risk.** The builder noted that generic cells get `fixture-scripts-sg` overlaid, which may make the non-regression rule vacuous. This is checked in the pre-run step.
5. **`doc-drift-gate.js` has 3 failures:** dangling CHANGELOG/INDEX links, unbalanced fences in backlog sidecars, and a `check-inputs-landed` mention. These appear pre-existing (the P-R hand saw "3 FAILED" on develop too), but that has not been verified for Train B.
6. **`autopilot-cli.test.sh` has 9 FAILs.** They are pre-existing and need a BACKLOG row.

## Found along the way

- **A-line regression, fixed on develop (`e1ba7a7b`):** `codex-plugin-package` failed 3 assertions. The P2a session-marker fixture check in `check-contract-schema.js` could not run inside the generated package. The gate now validates shipped artifacts only, and the fixtures moved to `hooks/tests/session-marker-schema.test.sh`. The test is back to 130/130.
- **Pre-existing, not this plan:** `autopilot-cli.test.sh` has 9 FAILs (D3 session-mode set, managed-CLI dev-flow admission). The FAIL set is identical at `8a10980f` (before Train A) and on develop, and unsetting the session env vars does not change it. It needs its own BACKLOG row.

## Carried into later phases

- **P5 prerequisite (from P0):** the skill-onoff harness varies one skill per arm; the P5 change arm spans 16 skill packs + 8 files (`evals/skill-onoff/prereg/stage-graph.json`), so P5 first needs an arm builder that installs whole pack sets. Also P5 builds the fixture-scripts pack once `session-mode.js --size`, `stage-advance.js`, `stage-graph.js` exist.
- **P0 deviations accepted:** first rung = `eligible_max` of the first classify (the resolver makes `recommend` host-dependent); expected `none` also accepts `U0`; `lib/p1w-markers.sh` not re-keyed (digest-frozen in `prereg/FROZEN.json`) — a sibling `lib/stage-graph-markers.sh` instead; horizons stop at `plan` (L/XL), `verify` (M), `code-review` (M! high-risk) because review rails need hetero engines a cell does not have.
- **Cut-gate side effect to resolve before alpha.1:** `check-guidance-eval.js` requires every guidance-manifest file that differs from the 2.x base to be byte-equal to the evaluated pack. Any unrelated `references/*.md` / SKILL.md edit made between now and the cut (e.g. a new `references/evidence-discipline.md` section) therefore has to be inside the P5 pack or the cut fails. Pending lesson for `evidence-discipline.md` (golden green only while untracked; golden that pins every knob cannot see a default change) is parked here until then.

## Reports

- [eval-v1-diagnosis.md](eval-v1-diagnosis.md) — change arm v1 failure diagnosis (inferred; transcripts deleted)
- [eval-v2-diagnosis.md](eval-v2-diagnosis.md) — arm v2 failure diagnosis
- [eval-v3-lfeature-diagnosis.md](eval-v3-lfeature-diagnosis.md) — arm v3 l-feature diagnosis
- [mods-candidates-survey.md](mods-candidates-survey.md) — mods candidates survey (folded into plan addendum A1)
