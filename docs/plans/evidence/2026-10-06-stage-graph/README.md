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

## Found along the way

- **A-line regression, fixed on develop (`e1ba7a7b`):** `codex-plugin-package` failed 3 assertions. The P2a session-marker fixture check in `check-contract-schema.js` could not run inside the generated package. The gate now validates shipped artifacts only, and the fixtures moved to `hooks/tests/session-marker-schema.test.sh`. The test is back to 130/130.
- **Pre-existing, not this plan:** `autopilot-cli.test.sh` has 9 FAILs (D3 session-mode set, managed-CLI dev-flow admission). The FAIL set is identical at `8a10980f` (before Train A) and on develop, and unsetting the session env vars does not change it. It needs its own BACKLOG row.

## Carried into later phases

- **P5 prerequisite (from P0):** the skill-onoff harness varies one skill per arm; the P5 change arm spans 16 skill packs + 8 files (`evals/skill-onoff/prereg/stage-graph.json`), so P5 first needs an arm builder that installs whole pack sets. Also P5 builds the fixture-scripts pack once `session-mode.js --size`, `stage-advance.js`, `stage-graph.js` exist.
- **P0 deviations accepted:** first rung = `eligible_max` of the first classify (the resolver makes `recommend` host-dependent); expected `none` also accepts `U0`; `lib/p1w-markers.sh` not re-keyed (digest-frozen in `prereg/FROZEN.json`) — a sibling `lib/stage-graph-markers.sh` instead; horizons stop at `plan` (L/XL), `verify` (M), `code-review` (M! high-risk) because review rails need hetero engines a cell does not have.
- **Cut-gate side effect to resolve before alpha.1:** `check-guidance-eval.js` requires every guidance-manifest file that differs from the 2.x base to be byte-equal to the evaluated pack. Any unrelated `references/*.md` / SKILL.md edit made between now and the cut (e.g. a new `references/evidence-discipline.md` section) therefore has to be inside the P5 pack or the cut fails. Pending lesson for `evidence-discipline.md` (golden green only while untracked; golden that pins every knob cannot see a default change) is parked here until then.
