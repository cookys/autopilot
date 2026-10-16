# affected-suites selector: does it miss a suite? (BL-0001 stage 1)

Date: 2026-10-13. Tool: `scripts/affected-suites.js` (default `--max-weak 2`). Scope: the selector only; the gate
(`.claude/quality-gate-config.md`) and `hooks/tests/run.sh` are unchanged.

## Method

1. **Historical breakers.** Take a fix commit F that turned test T green. Run T at `F^` (must be red) and at F
   (must be green); otherwise the case is dropped. Then `git bisect` between an older green commit and `F^` (T run for
   real at every step) to find the commit B that broke T. B is found by running the test, not by the selector.
   Finally run `affected-suites.js --base B^1 --head B` and check T is in the output.
2. **Mutation oracle (L1).** Inject `throw` at the top of one shared lib / script, run every L1 test file
   (hooks/*.test.js, scripts/*.test.js, scripts/lib/*.test.js), and compare the files that went red (against an
   unmutated baseline, which was all green) with the selector's list for that file.
3. **Mutation oracle (L2).** Same, for one shell lib, over every `hooks/tests/*.test.sh` and `scripts/*.test.sh`.

Candidate fix commits were mined from `git log` (subjects `fix(`/`test(` touching test files). 11 candidates were
dropped as not clean (red at `F^` only on this host's state, or not green at F): 7a75f018, 9c80193e, 591093b0,
d750d200, d08eb1e1, 68f3e2b7, 940192ff, f28b1176, c734fad5, b1f1817a, b4c0e057.

## 1. Historical cases: 28 breaker/test pairs re-run with causal-file verification (round 2)

Round 1 only checked "T is in the selector's list". The review showed that is not enough: two cases were hit by a
file that was not the one that broke the test. Round 2 therefore finds the **causal file set** for every pair:
in a scratch worktree at breaker B, revert files of B's diff to `B^1` (ddmin, a real test run per step) until a
1-minimal set S remains whose revert turns T green. The selector (run on `B^1..B`) counts as a hit only if
(a) `mode: full`, (b) T's chain ends at a file in S, or (c) T is on the fixed always-run list. A hit through a
file outside S is "lucky" and is re-checked with S alone.

Result at the default `--max-weak 2` (28 pairs; raw rows in the scratchpad `causal.jsonl`):

| Verdict | Pairs | Meaning |
|---------|-------|---------|
| full: unjudgeable file | 10 | breaker touched hooks.json / `.claude-plugin/` (by rule) |
| full: unreferenced change | 10 | some changed non-prose file reached no suite (by rule, added in round 2) |
| selective, chain ends at a causal file | 3 | context-budget.test.js (hooks/context-budget-lib.js); context-window.test.sh and hetero-review-loop.test.sh (.claude/review-loop-config.md) |
| selective, always-run list | 2 | resolve-review-loop-consult-discuss-switch.test.sh broken by another test file (1b2e2485, d2bdccba) |
| selective, hit through a non-causal file ("lucky") | 2 | statusline-live-tee.test.js (S = hooks/context-budget-lib.js), calibration.test.sh (S = .claude/review-loop-config.md) |
| selective, hit without a ddmin set | 1 | d2bdccba autopilot-cli.test.sh. A real case: green on the parent c14d620a (117 assertions), red on d2bdccba twice. The ddmin step failed (reverting B's whole diff did not turn it green), so no causal set S was derived; the selector on `B^..B` selects it through `.claude/review-loop-config.md`. Counted as a hit, with that gap stated |

Misses: **0** of 28 pairs (27 with a verified causal set, 1 without). The two "lucky" pairs were re-run with S alone as the only changed file:
`--files hooks/context-budget-lib.js` selects statusline-live-tee.test.js (chain test -> context-budget.js -> lib);
`--files .claude/review-loop-config.md` selects calibration.test.sh (chain length 2). Both are causal in isolation.

Honest reading: **20 of 28 are "full"**, so on real multi-file commits the tool mostly says "run everything"; only 6
pairs test the graph itself (3 selective with a causal file, 2 selective through a non-causal file, 1 autopilot-cli). The graph is exercised harder by the mutation oracle below and by the unit tests.
Round 1 listed the same pairs as "19 selective + 10 full"; most of the 19 selective pairs moved to full; that is
the effect of the new rule "an unreached non-prose change forces full".

### What `--max-weak` is supported by

The historical sample cannot discriminate depth (at `--max-weak 1` every pair is still a hit, by "full"). Isolation
checks can: `--files .claude/review-loop-config.md` selects, for {context-window, hetero-review-loop,
calibration}: at `--max-weak 0` the tool returns `mode: full` (not a miss), at 1 it misses calibration (2/3), at 2 it
selects all 3. So 2 is the smallest value that
does not miss in that check; no pair needed 3. Round 1's claim "2 is the minimum of the 19 selective cases"
is withdrawn: those cases are no longer selective.

## 2. Mutation oracle

L1 (throw injected at the top of the file; every L1 test file run; baseline all green):

| Mutant | L1 files that went red | Selector chose (L1 / all) | Missed |
|--------|-----------------------|---------------------------|--------|
| scripts/lib/live-state-dir.js | 32 | 54 / 463 | 0 |
| scripts/lib/effort-scale.js | 1 | 32 / 271 | 0 |
| hooks/state-checkpoint-lib.js | 9 | 41 / 271 | 0 |
| hooks/context-budget-lib.js | 4 | 40 / 212 | 0 |
| scripts/lib/autocompact-window.js | 3 | 39 / 214 | 0 |
| scripts/session-mode.js | 10 | 54 / 463 | 0 |
| hooks/transcript-reader-lib.js | 8 | 40 / 261 | 0 |
| scripts/lib/review-chain-derive.js | 1 | 1 / 9 | 0 |
| scripts/lib/kimi-containment.js | 1 | 8 / 45 | 0 |
| hooks/cost-tracker-lib.js | 1 | 38 / 211 | 0 |
| scripts/lib/agy-containment.js | 4 | 10 / 49 | 0 |
| hooks/live-session-lib.js | 12 | 37 / 238 | 0 |
| hooks/orchestrator-edit-gate-lib.js | 2 | 16 / 41 | 0 |
| scripts/lib/qualification-feed.js | 1 | 1 / 7 | 0 |

14 mutants, 0 missed.

L2 (a throw / `exit 97` at the top of the file, or a one-line drift appended; every `.test.sh` under hooks/tests and
scripts run, 417 suites; reds not selected are re-run unmutated to separate pre-existing reds):

| Mutant | Kind | Suites red | Selector chose | Missed |
|--------|------|-----------|----------------|--------|
| scripts/lib/output-quiescence.sh (round 1) | exit 97 | 8 (2 pre-existing) | 58 | 0 |
| scripts/lib/qualification-feed.js, mirror NOT synced | throw | 8 | 425 | 0 |
| platforms/codex/plugin/scripts/lib/qualification-feed.js (mirror-only edit) | drift | 5 | 425 | 0 |
| scripts/lib/live-state-dir.js | throw | 101 | 464 | 0 |

The mirror cases are covered by the always-run `codex-plugin-package.test.sh` (confirmed present in the selection
for a mirror-only file list). 4 L2 mutants, 0 missed. The L1 table above was produced by round-1 code; round 2 only
adds suites or switches to full, never removes one, so it stays a valid lower bound.

## Always-run list (added in round 2)

These suites read repo files by content, so no reference graph can see what breaks them (a new file anywhere can
turn them red). They are added to every selective result that has a non-prose change; reported in `always_run`.

| Suite | Why |
|-------|-----|
| resolve-review-loop-consult-discuss-switch | scans every file under hooks/ for `reviewer_engine:` lines (broken twice in the history above by an unrelated test file) |
| check-js-syntax | syntax-checks every tracked JS file |
| codex-plugin-package | codex mirror must equal its sources |
| test-identity-guard | scans every `*.test.sh` for git identity writes |
| test-suite-finalize-gate | scans every `*.test.sh` for the finalize counter |
| check-test-integrity | real config must match every real suite file |
| check-tmp-residue-registry | scans the git index for tmp residue |
| check-claude-md-inventory | every shipped script must be named in CLAUDE.md |
| check-hook-inventory | hook files vs hooks.json vs docs |
| check-canonical-invariants | cross-file invariants over the real tree |

Added after the second review (found by grep; the first two were reproduced red by the reviewer):

| Suite | Why |
|-------|-----|
| p6d-gates-repair-ladder | `grep -rln repair_lock` over all of `src/` |
| qualify-scorecard-vocabulary | `grep -rl` of a model-id charset over `scripts/` and `src/` |
| skill-onoff-stage-graph | `grep -rl eligible_max` over all of `scripts/` |
| skill-count-metadata | counts the `skills/` directories against the documented count (`--files skills/zz-new/SKILL.md` stayed selective without it) |
| qualify-recipe-credential-staging | greps every `docs/plans/evidence/*/administration/*/run.sh` (a script under `docs/` is code, not prose, for this tool) |

The list comes from a survey, re-runnable with these commands (a hit is only a candidate: read the matched line to
see whether it scans repo content or a test's own fixture directory):

```
grep -nE 'grep +-[a-zA-Z]*[rR][a-zA-Z]* |git (-C [^ ]+ )?(grep|ls-files)|find +"?\$\{?(REPO|ROOT|TESTS|HOOKS|SCRIPTS|PLUGIN|SRC)[A-Z_]*\}?"?' hooks/tests/*.test.sh scripts/*.test.sh
grep -lE 'ls-files|git grep|grep -r|readdirSync' hooks/*.test.js scripts/*.test.js scripts/lib/*.test.js
```

It is a survey, not a proof of completeness - a new content-scanning suite must be added by hand. Round 2's
survey was a spot check and missed the five above; this one ran the grep over every `hooks/tests` and `scripts`
suite. The first version of this command was double-quoted, so the shell turned `\$` into `$` and the `find` branch matched nothing; it is now single-quoted and was re-run as written. The re-run added three `find` hits, all read: `skill-count-metadata` (already added), `check-hook-inventory` (`find` for a `mods/` directory inside the codex and opencode mirrors; already on the list, now pinned by a real-tree case on `platforms/codex/plugin/mods/x.js`), and `task-status-input` (its `find` runs inside a fixture repo made by `fx repo`, not the real tree: not added). Candidates read and not added: `capability-evidence` (copies `src/engine/owner-kernel/`, no content scan).

## Limits (read before relying on it)

- **Precision is poor for hub files.** A change to `live-state-dir.js` or `session-mode.js` selects 463 of 480
  suites, because text mentions chain through hub scripts. Selective runs pay off for leaf changes (1-60 suites),
  not for hub changes. This is the price of "never guess": over-select, never under-select.
- **Static text reference, not execution.** A suite that builds the script name at run time with no literal file
  name in any file on the path (`scripts/dispatch-$rail.sh` with the rail name from a table elsewhere) is invisible
  unless a directory glob or a mention elsewhere catches it. No such miss was found in 28 historical pairs, 14 L1
  mutants and 4 L2 mutants; that is evidence, not proof (and the tool answers "full" for most multi-file commits).
- **Default depth 2 weak hops.** Three weak hops were needed in none of the checks; raising to 3 costs ~40% more
  suites. `--max-weak` is exposed so the gate can choose.
- Release commits (plugin manifest) and hooks.json changes return `full`, as asked.
- The candidate tests were found from fix commits that exist; a test that went red and was never fixed on develop
  is not in the sample.
- Only `run.sh`'s own suites are considered (hooks/*.test.js, scripts/*.test.js, scripts/lib/*.test.js,
  hooks/tests/*.test.sh, scripts/*.test.sh); `scripts/tests/*.test.sh`, `mods/live/*.test.js` and the codex plugin
  copies are not run by `run.sh` and are not selected.

## Round 3 (2026-10-16): wider sample and the mods/live entry (BL-0001 phase 2, step 1)

Change under test: the selector now reports `extra_runners` (`mods/live/run-tests.sh` for any `mods/live/` change, in selective
and in full mode). Before this, a `mods/live/` diff returned `selective` with 128 `hooks/*.test.js` suites (for `ui.ts`,
`locales/*.json`, `ui.test.ts`) or 19-21 (`gen-locales.js`, `run-tests.sh`) and never named `mods/live/run-tests.sh`. The
cause: `mods/live/*.ts` are not code files for the graph, so they are data seeds, and a data file is reached through any
non-generic directory name in its path; `live` is not in `GENERIC_DIRS`, so every hook script that mentions `/live` became a
weak referrer. Those hits were accidental, and none of them ran the live mod's own tests.

Tool: `docs/plans/evidence/2026-10-13-affected-suites/miss-check-wide.js` (re-runnable; `AFFECTED_SUITES_BIN` selects the
selector under test). Sample: the 60 most recent non-merge commits on this branch (develop tip 10922287 and earlier) that touch
anything outside `docs/` and root `*.md`; 14 of them touch `mods/live/`. Oracles that do not use the selector's text graph:

- convention: for every changed non-test source file F, a suite named after F (`scripts/F.test.js`, `scripts/lib/F.test.js`,
  `hooks/F.test.js`, `hooks/tests/F.test.sh`, `scripts/F.test.sh`, optional `check-`/`test-` stem tolerance) must be selected,
  unless the result is `full`;
- rule: a `mods/live/` commit must list `mods/live/run-tests.sh`; a `hooks/hooks.json` or `.claude-plugin/` commit must be `full`.

This is weaker than rounds 1-2 (it does not bisect and run tests): it checks the selector against naming and the stated rules,
not against real breakage. Results: 60 commits, 32 `full`, 28 selective, **0 missed**.

Negative control (the pre-fix selector, `git show HEAD:scripts/affected-suites.js`, same 60 commits): 14 missed (every
`mods/live/` commit). Unit tests: pre-fix selector 16 pass / 2 fail (the two new mods/live cases), fixed selector 18 / 0.

Mutation of the selector (each run over the same 60 commits):

| Mutant | Misses | Caught |
|--------|--------|--------|
| `mods/live/` entry removed from `EXTRA_RUNNERS` | 14 | yes |
| direct file-name lookup (`byExt`) disabled | 3 | yes |
| `DEFAULT_MAX_WEAK` 2 -> 0 | 0 | no: it only moves 25 selective results to `full` (57 full), the safe direction |
| `hooks/hooks.json` removed from `FULL_TRIGGERS` | 0 | no: no sampled commit isolates that rule (a `hooks.json` change that no suite reaches still falls to `full` through the `unreferenced` rule) |

2 of the 4 mutants are caught; the two that are not are not under-selection in this sample. The `hooks.json` rule is
unmutation-tested here and stays covered only by the unit tests.
