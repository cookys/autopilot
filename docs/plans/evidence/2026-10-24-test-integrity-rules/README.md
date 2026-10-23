# Test-integrity rules 1 and 2 — replay v4 (2026-10-24)

Mode stays `warn`; no config key or default changed. Same 60 merges (`merges60.txt`, copied from the v3 record), same checker/flags/worktree-at-ref method as `../2026-10-23-test-integrity-accuracy/` (batched by sha list via a throwaway copy of `replay-test-integrity.js`, deleted; `--ref` = the working-tree snapshot of this commit). 60 ranges, 0 errors.

## Rules implemented (scripts/lib/test-integrity-l1.py)
1. **Net-assertion for surface_touch**: a modified surface file with a known language is reported only if the diff removes more assertion-class lines (`is_assertion_class_line`, same predicate as `deleted_line`) than it adds. Deleted/renamed/binary files and unknown-language files (json, yaml) keep the old any-removed-line behaviour.
2. **Identifier-removal exemption for deleted_line**: a removed assertion is exempt if one of its identifier tokens (>=4 chars) was removed from a non-test file in the range and is absent from live code at the head (hits in test files, .md/.txt, docs/, evals/, comment-only lines, and lines this range itself added to product files — removed-key guards — do not count as live).
3. **Substitution pairing: NOT done** (README of v3 gives it as a one-line sketch; #10 stays flagged).

## Result
| | v3 | v4 |
|---|---|---|
| records | 12 | 4 |
| FP by record | 11/12 = 91.7% | 3/4 = 75% |
| (merge,file) groups | 5/6 FP | 1 TP + 1 FP group (2 groups) = 50% |

Bar of 5% is still **not met**. Prediction in v3 ("only the TP remains") was too optimistic.

## Per-record diff
| # | record | v4 | why |
|---|---|---|---|
| 0 | 0be6405d fixture | stopped | rule 1: no assertion-class line removed |
| 1 | a8dac5e6 tool.test.js | stopped | rule 1: `assert.ok` removed and re-added (net 0) |
| 2 | 6fcfed4b test.yml (TP) | **still fires** | deleted file |
| 3 | f682db55 fixture | stopped | rule 1 |
| 4 | 16dd391e :39 | stopped | rule 2 (`stale_reaper_age_days`) |
| 5 | 16dd391e :40 | stopped | rule 2 (`reaper_scope`) |
| 6 | 16dd391e :52 | still fires | assertion has no identifier (`assert_eq "$age" "0"`); its subject was in the deleted function name |
| 7 | 16dd391e :73 | stopped | rule 2 |
| 8 | 16dd391e :85 | stopped | rule 2 |
| 9 | 16dd391e :95 | still fires | same as #6 |
| 10 | 16dd391e :105 | still fires | in-place swap (rule 3, not done) |
| 11 | 2210b470 driver | stopped | rule 1 |

Every true positive of the v3 replay (#2, the only TP) still fires. No new records appeared (4 of 12 old records remain; 0 new).

## Remaining FP shapes / follow-up
Assertions inside a removed test function whose identifier appears only in the function name (#6, #9); substitution pairing (#10).

Files: `replay.json` (4 records), `merges60.txt`.
