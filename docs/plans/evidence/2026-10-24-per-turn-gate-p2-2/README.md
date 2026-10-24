# P2-2 Instrument - status and negative-control evidence (BL-0055 phase 2)

Branch `hands/ptg-p22/1` on develop `1ce92330d`. No model call anywhere in this unit: the harness tests use a stub runner that emulates Stop hooks, the wrapper tests use a fake `claude` (`hooks/tests/fixtures/p2-fake-claude.sh`).

Commits: W5 `--gate hook` and `--hook-trace-dir` with NC7 `c2bff03fa`; wrapper v2 `run-p2-batch.js` with NC5, NC8 `615e1d15f`; manifest-committed requirement `84eb3fae9`; this note and the preregistration directory `docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/` come after them.

## Negative controls (red before green)

Each test holds a check for the real code and runs the same check against a mutant that must fail it. The mutation tool fails when its pattern matches nothing (no no-op mutant). Transcripts: `nc7-red-old-harness.txt`, `nc7-test.txt`, `nc5-nc8-test.txt` (scratch paths replaced by `<scratch>`).

| NC | Test | Red (mutant or old code) | Green |
|---|---|---|---|
| NC7 | `hooks/tests/orchestration-eval-hook.test.sh` | (a) develop's harness: `--gate hook` exits 2, "--gate must be off\|observe\|enforce (got: hook)" (`nc7-red-old-harness.txt`); (b) mutant "parsed but not installed" (the install block never runs): `hook log: want exactly 1 block record, got 0` | real harness: `gate.jsonl` present, hook log holds exactly one `block` record (and five `allow`), trace count = log count, `--gate off` leaves neither `gate.jsonl` nor `hook/`, `--gate observe` leaves no hook dir, task directory hashes unchanged |
| NC5 | `hooks/tests/p2-batch-wrapper.test.sh` | `--audit` stubbed to return no failures: exit 0 for each of the three corrupted runs (dropped `END`, missing `taskhash.post.txt`, duplicated `START`) | real audit exits 1 for each of them, 0 for the valid synthetic batch |
| NC8 | same | wrapper without the post-batch listing: no `TASKHASH_DIFF post fail` line and no `taskhash.post.txt` after a task file was edited mid-batch | real wrapper writes `TASKHASH_DIFF post fail` and the audit exits 1 |
| selfcheck | same | mutant with the `writeBlockMax` call removed: `--selfcheck` exits non-zero | real: exit 0, 14 of 14 rows written |

## Deviations from the plan

- NC8 names two failing assertions for the mutant ("TASKHASH_DIFF fail" and "audit non-zero"). Only the first goes red: with the post listing removed the audit still exits non-zero because it independently requires `taskhash.post.txt` (defence in depth). The test asserts both on the real wrapper and the first on the mutant.
- `--gate hook` records the harness verifier verdict per turn like `observe` (so `gate.jsonl` exists, as NC7 requires, and resumed turns use `--output-format json`, which the cost record needs). The control arm of P2-3 is therefore `--gate observe`, the P1 control treatment, not `--gate off`; `--gate off` is tested as the "installs nothing" case.
- (Superseded by the cost correction commit.) The plan's stop rule before the first five finished runs of an arm is unspecified; the wrapper applies only "spend + one probe <= cap" there. The strict reading of the rule after five runs stops the C arm before id 6 with P1-like costs; see section 3 of the preregistration (open item for the owner).
- `--hook-trace-dir` is a new harness flag (the trace flags must not hang off `--gate`, or the control arm could not carry them).

## Cost correction (depth-0 ruling, after the first PREREG commit)

The first draft projected `spent + r x (mean + 2 sd + probe)` with caps C 17 / ON 31 and would have stopped the C arm before id 6 on P1-like costs (projected 20.30). Corrected to `spent + r x (mean + probe) + 2 sd x sqrt(r)` with caps C 18 / ON 30 (total 48). Red then green, both in `p2-batch-wrapper.test.sh`: on the old wrapper "P1 first five costs, cap 18: no STOP_COST" failed (`red-projection-old.txt`, projected 20.30); on the new one it passes (17.57), the 1.25-scaled costs stop, and a mutant that never stops fails the inflated-cost assertion.

## Acceptance round 1 fixes

Audit hardening, each red before green in `p2-batch-wrapper.test.sh` (red = a mutant of the audit or writer without the fix, run on the tampered or double-counted data): every `MODEL` row must be exactly one id (rows `a,b` were accepted); the audit re-derives each arm's actual spend from all `COST` rows and `probes.tsv` against the cap (a last `COST` of 999 was accepted); PREREG note and manifest are re-checked at audit time (tracked, unmodified, hash equal to the logged value, recorded commit an ancestor of HEAD); the `COST` running total no longer adds the probe a second time (asserted id by id, and a batch written by the double-counting writer fails the audit).

## Review round 1 fixes (four-seat review of f3c5ced30)

Each red before green in `p2-batch-wrapper.test.sh` (red = a mutant of the audit or helper without the fix says OK / fails the check): the task hash baseline is pinned by sha256 in the manifest and checked by the wrapper at start and by the audit (tracked, unmodified, equal; the test swaps in a committed baseline and rewrites both listings to match); exactly one `COSTCHK` per id before its `START` (a resumed id keeps its first row); the last `END` within the window and the harness timeout clamped to the remaining window (`harnessTimeoutMs`); `HOOKERR` parsed per ON run, more than 2 ON runs with errors fail; one `MODEL` row per id (a duplicated row replacing another keeps the count but fails). The wrapper-side abort on a baseline hash mismatch has no separate test; the audit-side recheck is the tested path.

## Review round 2 and acceptance round 2 fixes

Red before green in `p2-batch-wrapper.test.sh` (mutant says OK, real audit non-zero): a `COST` row of an unknown id (spend now counts every `COST` row); `HOOKERR` NaN, -1 and 1.5 (one run each); `harnessTimeoutMs` has no 1 second floor (0 left = do not start, `STOP_WINDOW`); a first END stamped 2000-01-01; a batch shifted to 2000 with a forged 1990 PREREG time (the commit time now comes from git). Two earlier tamper inputs were rebuilt to keep timestamps monotone so they still test their own rule.

## Review round 3 and acceptance round 3 fixes

Red before green in `p2-batch-wrapper.test.sh`: `START elapsed` is taken right before the row is written (a fake probe delayed 5 s no longer makes it disagree with its timestamp; the early-sampling mutant does); the final harness timeout is computed and checked before ORDER/CMD/START (window gone during the probe: exit 8, `STOP_WINDOW`, no START; the mutant without the check leaves a START with no END); negative run cost with a consistent running total; PREREG replaced by a later commit with the logged `HASH prereg` updated (checked through `git show <commit>:path` and `git log <commit>..HEAD -- paths`). The two older tests that overlapped the new git check had their mutants extended so each still tests its own rule. The coordinator's cv3 probe scripts were not used; the tests rebuild the same cases.
