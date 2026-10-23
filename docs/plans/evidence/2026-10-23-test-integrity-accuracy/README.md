# BL-0060: check-test-integrity.sh accuracy record, replay v3 (2026-10-23)

Question: is the false-positive (FP) rate of `scripts/check-test-integrity.sh` below 5% on the same 60 merges and seed as the v2 replay, so that `.claude/test-integrity-config.md` could move from `mode: warn` to block?

**Answer: no. FP rate is 91.7% by record (11/12) and 83.3% by (merge, file) group (5/6). The 5% bar is not met; `mode` stays `warn` (unchanged by this commit).** Both denominators are tiny, so the numbers carry wide intervals, but even the lower bound is far above 5%.

## Checker under test
HEAD of `hands/tintacc/1` on top of develop `09ca1458c`, which includes merge `86274b421` (tintegrity: same-topic replacement must carry a real assertion) and the earlier bl0060b precision fixes. Checker sources were not modified.

## Window and seed
- 60 merges = `git rev-list --first-parent --merges -60 a007fa65e` (the v2 window), listed in `merges60.txt`. In HEAD's first-parent merge list they are ranks 162 to 221 (verified: `git rev-list --first-parent --merges HEAD | sed -n 162,221p` equals `merges60.txt`).
- Seed 20261019 (LCG Fisher-Yates, v2 `sample-v2.js`): the sample only subsamples when records > 150. Here there are 12 records, so the sample is the whole population (a census); the seed does not change the outcome.

## Commands
1. `node scripts/replay-test-integrity.js --count 162 --out <tmp>` ran first (exit 0, 162 ranges, 13 records, 0 errors). Rank 162 is only a007fa65e itself, so this run reached the newest edge of the window and none of the 13 records fall inside it (all are newer merges, e.g. 09ca1458c, c38fc962, 86274b42). Not used for the rate.
2. Full-window replay was then run in three batches of 20 merges (a single foreground command exceeds the 600 s tool limit; batch 1 alone took 4m21s). The batches used a throwaway copy of `scripts/replay-test-integrity.js` whose only change was selecting merges by a sha list (`REPLAY_SHAS`) instead of `--count`; checker invocation, worktree at HEAD, range `<merge>^1..<merge>` and record extraction are identical. The copy was deleted and is not part of this commit. The equivalent single command is `node scripts/replay-test-integrity.js --count 221` then filter to `merges60.txt`.
   - batch 1 (merges 1-20): 20 ranges, 3 records; batch 2 (21-40): 20 ranges, 1 record; batch 3 (41-60): 20 ranges, 8 records; errors 0.
3. Records merged in window order into `replay.json` (this directory): ranges_scanned 60, ranges_with_violations 6, records 12 (`deleted_line` 7, `surface_touch` 5), errors 0.
4. Cross-check by running the checker directly in a fresh detached worktree at HEAD for 16dd391e, 0be6405d, 6fcfed4b: output matches the replay (violations for 16dd391e, surface_touches for the other two).
5. Each record judged against `git diff <merge>^1 <merge> -- <file>`. TP = the change weakens or evades a test (fewer assertions, always-true, skip, test deleted while the thing under test remains with no replacement). Honest maintenance = FP.

## Adjudication (all 12 records)
| # | merge | kind | file | verdict | reason |
|---|---|---|---|---|---|
| 0 | 0be6405d | surface_touch | hooks/tests/lib/task-status-input-fixture.js | FP | adds `preEffectAdmit` stub and a more detailed error message; no check weakened |
| 1 | a8dac5e6 | surface_touch | evals/.../t7-config-rename/repo/tests/tool.test.js | FP | config moved to a temp dir inside try/finally; the same `assert.ok` is kept (BL-0122) |
| 2 | 6fcfed4b | surface_touch | .github/workflows/test.yml | TP (borderline) | whole CI workflow deleted (BL-0094, owner decision); deleting CI is what the surface rule exists to flag, though authorised |
| 3 | f682db55 | surface_touch | hooks/tests/lib/subagent-budget-fixture.js | FP | fixture gains parent/depth meta fields; old usage unchanged |
| 4 | 16dd391e | deleted_line | hooks/tests/resolve-worktree-teardown.test.sh:39 | FP | `stale_reaper_age_days` config key removed (BL-0115); replaced by `assert_not_contains` for the key |
| 5 | 16dd391e | deleted_line | same:40 | FP | `reaper_scope` key removed; replaced by `assert_not_contains` |
| 6 | 16dd391e | deleted_line | same:52 | FP | `test_field_age` deleted with the removed key |
| 7 | 16dd391e | deleted_line | same:73 | FP | override-age assertion removed with the key; hook override assertion kept |
| 8 | 16dd391e | deleted_line | same:85 | FP | `test_garbage_age_fallback` deleted with the key |
| 9 | 16dd391e | deleted_line | same:95 | FP | `test_override_field_query` deleted with the key |
| 10 | 16dd391e | deleted_line | same:105 | FP | in-place swap: same `assert_eq` pattern now checks `max_leaf_worktrees_per_root` instead of the removed field |
| 11 | 2210b470 | surface_touch | hooks/tests/lib/review-candidate-driver.js | FP | new `multi` scenario and packet capture; three touched lines are parametrisation |

## Result
| Basis | judged | TP | FP | FP rate | Wilson 95% |
|---|---|---|---|---|---|
| records (census, 12) | 12 | 1 | 11 | 91.7% | 64.6% - 98.5% |
| (merge, file) groups (census, 6) | 6 | 1 | 5 | 83.3% | 43.6% - 97.0% |

The group figure matches the "83%" the tintegrity unit reported; this directory is its first formal record.

## Comparison with v2 (`docs/plans/evidence/2026-10-19-test-integrity-replay-v2/`)
| | v2 | v3 (this) |
|---|---|---|
| window | same 60 merges | same 60 merges |
| records | 668 (deleted_line 655, surface_touch 13) | 12 (deleted_line 7, surface_touch 5) |
| ranges with violations | 11 | 6 |
| FP by group | 15/16 = 93.8% | 5/6 = 83.3% |
| FP by record | 667/668 = 99.9% | 11/12 = 91.7% |
| 5% bar | not met | not met |

What changed: the 647-record `dispatch-hetero-gc.test.sh` whole-file deletion group and 8 of the 13 v2 surface touches (hooks/tests/lib.sh, dispatch-review fixtures and stubs, review-candidate stub) no longer fire, and `task-status-input.test.sh` (`|| fail` rewrite) no longer fires. Volume fell 98%, but the rate barely moved because the population is now so small that each remaining FP weighs heavily and the one TP is unchanged.

## FP shapes (11 FP records)
1. **Feature or config key removed, its assertions removed with it, script still present**: 7 records, 1 group (16dd391e teardown test). Includes one in-place field swap (#10).
2. **Fixture/helper edit that changes or adds lines but weakens nothing (surface_touch)**: 3 records, 3 groups (#0, #3, #11).
3. **Test refactored with assertion preserved (surface_touch on a test file)**: 1 record, 1 group (#1).

## Rules that would cut the FPs most (not applied; for a follow-up with its own negative control)
1. **Net-assertion rule for surface_touch**: report a modified surface file only if it is deleted or the diff removes an assertion/exit/skip-class line without adding an equivalent one (the same predicate `deleted_line` already uses). Clears #0, #1, #3, #11 (4 of 5 surface records; the deleted CI workflow still fires). Today surface_touch fires on any touch, including pure parametrisation.
2. **Identifier-removal exemption for deleted_line**: exempt a removed assertion or test function whose subject identifier (config key, flag, function name) is deleted from product files in the same range and absent at the merge head. Extends rule (a) from file-level to identifier-level and clears #4-#9 (and the v2 647-record class). Keep the N4 negative control (test deleted, target still present and unchanged).
3. **Substitution pairing**: a removed assertion line paired with an added line of the same assertion function in the same hunk (even with a different argument) is not a deletion. Clears #10.

With 1 and 2 applied to this window the remaining report would be the single TP (CI deletion), but that is a prediction from adjudication, not a re-run.

## Files
- `merges60.txt`: the 60 merges
- `replay.json`: merged raw replay output (12 records)
- `README.md`: this record
