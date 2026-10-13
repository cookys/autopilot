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

## 1. Historical cases: 29 verified, 0 missed

`mode` selective = a list of suites; full = the selector said "run everything" (hooks.json or plugin manifest in
the breaker). A full hit is by rule, not by analysis, so the 19 selective rows are the real evidence.

| Fix | Test that broke | Breaker B (subject) | Result |
|-----|-----------------|---------------------|--------|
| 93202c74 | scaffold-config.test.sh | 37630d5e (lane commit, 29 files; added `.claude/backlog-config.md`) | hit, 83/480, via the config file |
| cdba2f61 | mission-runtime-v2.test.sh | 30b69a1a (lane commit, 31 files) | hit, 263/480 |
| a7355408 | statusline-live-tee.test.js | 4026c1e3 context-budget unknown window | hit, 39/480, lib -> hook -> test |
| 83ccca58 | context-budget.test.js | 4026c1e3 | hit, 39/480 |
| f25663da | implementation-campaign-state.test.sh | 620ef6ed (managed-rail lane commit) | hit, 239/480 |
| 5eb415e4 | context-window.test.sh | d2bdccba review-loop standing pin | hit, 262/480 |
| fc44b910 | resolve-review-loop-consult-discuss-switch.test.sh | d2bdccba | hit, 262/480 |
| 18e0c164 | hetero-review-loop.test.sh | d2bdccba | hit, 262/480 |
| 09a8104a | calibration.test.sh | d2bdccba | hit, 262/480 |
| 04b003ad | autopilot-cli.test.sh | d2bdccba | hit, 262/480 |
| 2b598435 | resolve-review-loop-consult-discuss-switch.test.sh | 1b2e2485 dispatch-contract quota | hit, 151/480, chain length 3 (needs 2 weak hops) |
| 2d7eb039 | autopilot-engine.test.sh | 21112e79 delete review-loop diffs | hit, 330/480 |
| 226ff49d | resolve-review-loop-consult-discuss-switch.test.sh | 21112e79 | hit, 330/480 |
| 4936e27c | dispatch-review.test.sh | 6d7dc38c depth-0 repair | hit, 222/480, direct mention |
| bda1be2c | resolve-review-loop-consult-discuss-switch.test.sh | 31439693 proxy decisions ledger | hit, 286/480, chain length 3 (test -> test -> mirror file) |
| 580f535a | implementation-campaign-routing.test.sh | ea81dcdb managed-rail Mission claim | hit, 269/480 |
| a747ef43 | dispatch-author-strict-roster.test.sh | fa2a0c50 final panel pins | hit, 336/480, chain length 3 |
| 61a9d059 | resolve-review-loop-consult-discuss-switch.test.sh | 911b9a65 resume final-panel review | hit, 284/480, chain length 3 |
| 34ce65a9 | resolve-review-loop-consult-discuss-switch.test.sh | 911b9a65 | hit, 284/480 |

Full-suite hits (breaker touched `hooks/hooks.json` or `.claude-plugin/*`): 2f914725 check-hook-inventory
(023d74a8), 33df875a brain-eval-generator (a2b8b95f), 3641fc7c engine-qualify-verdict-stability (5f3aa3b1),
cdd461f6 qualification-asset-seals and engine-qualify-consult (5f3aa3b1), 07d85b27 mission-graph-path-authorization
and c7035da2 mission-authority-ownership (6559da33), ebec83fd sync-version-round-trip (907023a3), 448b75da
dispatch-worktree-lifecycle (3f5c8588), a6857016 dispatch-detached-campaign-authority (86c168c5).

### What the sweep over `--max-weak` shows

Same 19 selective cases at `--max-weak 1`: 17 hit, **2 miss** (2b598435 and bda1be2c, both chain length 3). At 2:
19/19. At 3: 19/19 but 251-445 of 480 suites. So the default of 2 is the smallest value that does not miss
anything in this set, and the margin is one case deep: a real dependency three mention hops away would be missed.
That is the known limit of the default (see Limits).

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

L2 (`exit 97` injected at the top of `scripts/lib/output-quiescence.sh`; every L2 suite run): 8 went red,
6 of them selected (58 chosen), the other 2 (`check-hook-inventory`, `dev-setup`) were also red on the unmutated
tree. Missed: 0.

## Limits (read before relying on it)

- **Precision is poor for hub files.** A change to `live-state-dir.js` or `session-mode.js` selects 463 of 480
  suites, because text mentions chain through hub scripts. Selective runs pay off for leaf changes (1-60 suites),
  not for hub changes. This is the price of "never guess": over-select, never under-select.
- **Static text reference, not execution.** A suite that builds the script name at run time with no literal file
  name in any file on the path (`scripts/dispatch-$rail.sh` with the rail name from a table elsewhere) is invisible
  unless a directory glob or a mention elsewhere catches it. No such miss was found in 29 historical cases, 14 L1
  mutants and 1 L2 mutant; that is evidence, not proof.
- **Default depth 2 weak hops.** Three weak hops were needed in none of the cases; raising to 3 costs ~40% more
  suites. `--max-weak` is exposed so the gate can choose.
- Release commits (plugin manifest) and hooks.json changes return `full`, as asked.
- The candidate tests were found from fix commits that exist; a test that went red and was never fixed on develop
  is not in the sample.
- Only `run.sh`'s own suites are considered (hooks/*.test.js, scripts/*.test.js, scripts/lib/*.test.js,
  hooks/tests/*.test.sh, scripts/*.test.sh); `scripts/tests/*.test.sh`, `mods/live/*.test.js` and the codex plugin
  copies are not run by `run.sh` and are not selected.
