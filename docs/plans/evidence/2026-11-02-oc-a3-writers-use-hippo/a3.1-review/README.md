# A3.1 + A3.4 reconcile: hetero review record

Branch hippo/a3.1-project-record, base 569320631, seats gpt-6.1-sol (codex) and gemini-4-argon-high (agy).

| Round | Findings | Outcome | Fix commit |
|---|---|---|---|
| a3r1 g1 | 7 Major | all verified | c56762d8b |
| a3r2 g1 | 5 verified, 5 refuted/downgraded | fixed | 7a6ec4b58 |
| a3r3 g1 (cap) | 1 verified (4519569a), 4 refuted, 3 downgraded Minor | fixed | 93cfef7ad |

a3r3 packet verdicts: 7 of 8 SHIP-AS-IS; code2 FIX-THEN-SHIP only because of the verified finding, already fixed in 93cfef7ad.
No 4th generation is allowed at the cap, so 93cfef7ad is post-review code; PM adjudicates. It is covered by a red-checked test
(expected 3, got 0 without the fix) and the full suites (project-record 252, hippo-lib 120, record-files 112, backlog-reconcile 28,
check-backlog-entries 128, codex-plugin-package 142, check-hook-inventory 53).

Affected-suites failures (test-suite-finalize-gate and 7 others) fail identically on base 569320631.
