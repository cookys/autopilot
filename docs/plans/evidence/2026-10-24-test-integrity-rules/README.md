# Test-integrity rules 1 and 2 — replay v4 (round 2, 2026-10-24)

Mode stays `warn`; no config key or default changed. Same 60 merges (`merges60.txt`). Reproduce from the repo root: `python3 docs/plans/evidence/2026-10-24-test-integrity-rules/replay60.py` (calls `scripts/check-test-integrity.sh validate --range SHA^1..SHA` per merge, writes `replay.json`). 60 ranges, 0 errors. The 60 merges are a fixed list taken from the v3 record; they are not a sliding window (the v3 "221" window note was stale and is dropped).

Round 1 was too loose (verifier FAIL: tautology rewrites, unrelated added assertions, comment-only/changed-line/message-token exemptions all slipped through). Round 2 tightened both rules.

## Rules implemented (scripts/lib/test-integrity-l1.py)
1. **Equivalent-assertion for surface_touch**: a modified surface file with a known language is reported unless every removed assertion-class line (or bare shell `[ ]` condition) has its own added non-tautological assertion whose operands are a superset of the removed line's (or an identical line). Tautologies (`[ 1 -eq 1 ]`, `x = x`, `&& true`) never count as replacements. Deleted/renamed/binary files and unknown-language files (json, yaml) keep the old any-removed-line behaviour.
2. **Subject-identifier exemption for deleted_line**: a removed assertion is exempt only if its subject identifier (variable refs, `$(...)` bodies, bare identifiers; text inside quoted message strings is ignored) was removed from live (non-comment) product code in the range and occurs in no product line at the head (code, comment, or changed line). Hits in test files, .md/.txt, docs/ and evals/ do not count.
3. **Substitution pairing: NOT done** (README of v3 gives it as a one-line sketch; #10 stays flagged).

## Result
| | v3 | v4 r1 | v4 r2 |
|---|---|---|---|
| records | 12 | 4 | 8 |
| FP by record | 11/12 = 91.7% | 3/4 = 75% | 7/8 = 87.5% |

Bar of 5% is **not met**; the FP rate rose from round 1 because the loose exemptions are gone (honest cost of precision). The single TP `6fcfed4b` (test.yml surface_touch) still fires. The 7 FPs are `16dd391e` hooks/tests/resolve-worktree-teardown.test.sh lines 39, 40, 52, 73, 85, 95, 105 (the round-1 set 39/40/73/85 now report again because the removed-key guard / tombstone lines the range adds count as live at the head).

Negative controls N14–N18 (+N15b) in `hooks/tests/check-test-integrity-precision.test.sh` pin the round-2 behaviour; F9/F10 stay green.

Files: `replay.json` (8 records), `merges60.txt`, `replay60.py`.

## Round 3 (unit tirules-r3)

Added added-line guards: a failure-masking tail (`|| true`, `|| ! false`, `|| :`, `; true`, `|| exit 0`) or a self-comparison of the first two assert arguments never counts as an equivalent; literal operands are unchanged. Replay re-run: 60 ranges, 0 errors, **8 records** (unchanged), FP 7/8 = 87.5%; TP `6fcfed4b` still fires. Controls N19 (masking tail), N20 (self-comparison), N21 (rename stays reported) added.
