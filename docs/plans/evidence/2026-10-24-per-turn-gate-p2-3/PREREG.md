# P2-3 batch preregistration - per-turn gate, hook ON against a concurrent control (BL-0055 phase 2)

Committed before any measured call. Lane ptg-p22 (P2-2 Instrument). Owner decision d-15c0364c (2026-10-24, Taipei time): D2 (concurrent control), 30 ON and 30 C runs, total cap 48 USD (split corrected to C 18 / ON 30, section 3), n = 30. Plan: `docs/plans/2026-10-24-per-turn-gate-phase2.md` sections 3, 3.1, 4. No model call was made while building the instrument; every test used a stub runner or a fake `claude`.

## 1. What is measured

| Item | Value |
|---|---|
| Task | `t14-constraint-horizon` (5 turns), task hashes equal `taskhash.expected.txt` (sha256 2b1bcd033bd41093250649e1ed16bb28f7af9cd371771e864d1310f0c67756d4; byte-identical to the P1 rerun listing) |
| CLI | 2.1.309 (Claude Code), checked per id (`claude --version` must print `2.1.309 (Claude Code)`) |
| Model alias | `claude-haiku-4-5`; the resolved id is read from the `modelUsage` keys of the run's result objects and must be one value in all 60 runs |
| Isolation | credentials-only HOME per id (fresh copy of `.credentials.json`, onboarding stub), `--setting-sources project`, `--strict-mcp-config`, every command prefixed `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` |
| ON arm | harness `--arm off --runner cc --gate hook --hook-trace-dir <dir>`: per-turn-gate Stop hook installed in the temp repo, knob on, cap N = 2, mode `violations+features` (W4), verifier = the task's `verify-turn.js`; the harness also records the verifier verdict per turn (`gate.jsonl`) without sending anything |
| C arm | the same command with `--gate observe` (the P1 control treatment: verifier recorded, nothing sent back, no hook); the same `--debug hooks --debug-file` flags |
| Ids | `ON-01..ON-30`, `C-01..C-30`, each launched once, sequentially, one window of at most 8 hours, no replacement runs |
| Command | `bash evals/orchestration/run-orchestration-eval.sh --task t14-constraint-horizon --arm off --runner cc --model claude-haiku-4-5 --out <out> --gate hook|observe --hook-trace-dir <trace>`; `CMD` rows must equal the `argv_sha` values in the manifest (ON 0a5f50be..., C ca868640... as printed by the manifest) |

### Pinned artifacts

| Artifact | Pin |
|---|---|
| W4 commit (mode `violations+features`) | `977027c999e52383ad354f35fa88ea16dec7476f` (hook blob `45f3c47845c30b00e1b0c7a742b40210becab5bd`) |
| Treatment hook = develop final | `hooks/per-turn-gate.js` at develop `1ce92330d`: blob `f4fdf20152efcb7ecb15108fefc24bf10b8dfefc`, sha256 `10913c34c413f2e31d698b5f0d331d1bac6b3382620429eb8622a61271b3a6f0`. It differs from the W4 commit by the P2-1 review fixes (locking, state fencing, validation: fd63ae15c, 8c41e656b, e2302e5dc, 9aa650fc8); the W4 trigger and retry text are the ones evaluated. |
| Harness `evals/orchestration/run-orchestration-eval.sh` | sha256 `eb97b2be8c11274d3962efe1c48c300b715ffebf198dd3e599d447fcf4f80149` |
| Wrapper `evals/orchestration/run-p2-batch.js` | sha256 `0b7defa37ffe2331e5daa9a38b88121a72143771b27648fa0b58de8c78d56d07` |
| `manifest.json` (this directory) | sha256 `ec40712355ac1e7db4b5193429796253fd265995ec8f4a46160f8096f85d7074`; the wrapper refuses an untracked or modified manifest and logs `HASH manifest` |
| `taskhash.expected.txt` | sha256 `2b1bcd033bd41093250649e1ed16bb28f7af9cd371771e864d1310f0c67756d4`, also in the manifest; the wrapper requires it tracked, unmodified and equal to that value, and the audit re-checks all three |
| `order.txt` (this directory) | sha256 `080bf25ed67ca1ddf96bbdff68b46298ef99d968d84632360e87b37b0c1f67fc` |
| `selfcheck.out` (this directory) | output of `node evals/orchestration/run-p2-batch.js --selfcheck` at the wrapper hash above |

If develop changes any of hook, harness or wrapper before P2-3 starts, the wrapper aborts (`ABORT <name> sha256 differs`) and a new preregistration is needed; nothing is edited in place.

### Order

Seed `ptg-p2-3-order-2026-10-24`. Pair k holds `ON-k` and `C-k`; mulberry32 seeded with the first 32 bits (big endian) of sha256(seed) gives one number per pair in k order, below 0.5 puts ON first, else C first. The result is `order.txt`; `ORDER <id> <arm> pos=<k>` rows are audited against a recomputation from the seed, not against this file.

## 2. Thresholds (fixed here; planned values from plan section 3)

- **Primary:** M3_ON >= 20/30 and one-sided Fisher exact p < 0.01 for M3_ON against the concurrent C arm's M3 (alternative: ON higher).
- **Trade check:** one-sided Fisher (ON lower than C) on M2; p <= 0.05 is FAIL-TRADE; otherwise "no drop detected", never non-inferiority. Also M1_ON >= 25/30.
- **Instrument health:** hook errors (`HOOKERR`, fail-open on verifier error) in at most 2 of the 30 ON runs; no run with more than 2 blocks in one turn (`BLOCKMAX`); for every ON run `gate_trace = gate_log` (and > 0), for every C run both are 0; plugin Stop hook executions (`plugin=`) are reported separately and never enter the comparison.
- **Reported, not gating:** M3_ON against round 2's 26/29; per-feature results; blocks per run; cap-exhausted runs; duration, turns, cost.
- **Labels:** PASS (all gating thresholds), FAIL-TRADE (primary met, trade check failed), FAIL (primary missed), U (not valid: `--audit` exits non-zero, any `STOP_*`, an unfinished batch). PASS permits documenting the hook as an evaluated opt-in; it does not decide a default.
- M1, M2, M3 come from the first JSON object of each run's `oracle.log` (`constraints_pass`, `features_pass`, M3 = both), recomputed by two independent methods (JSON parse; text match on the two lines) and compared with the wrapper's `SCORE` rows before any conclusion is written.

## 3. Cost caps and the stop rule

Caps, never raised in place: **C arm 18 USD, ON arm 30 USD** (total 48, as approved in d-15c0364c), each with its own projection. This replaces the first draft of this note (C 17, ON 31, and a per-id "mean + 2 sd" projection); depth-0 ruled the change a preregistration correction inside the approved 48 USD, made before any measured call. A run costs its last result object's `total_cost_usd` (cumulative within a session); a probe costs its own `total_cost_usd` (about 0.0166). Before every id, in `projectCost` (the single function the wrapper and the audit share):

- fewer than 5 finished runs in the arm: projected = arm spend (runs + probes) + one probe; no projection yet;
- 5 or more: projected = arm spend + r x (mean of the arm's finished run costs + one probe) + 2 x sample sd x sqrt(r), where r = ids of the arm not yet finished, the one about to start included;
- projected > the arm's cap: write `STOP_COST`, exit 5, launch nothing more; the batch is U and the owner decides on a rerun.

Reading of the plan's wording ("mean plus 2 sample sd for its remaining ids"): the remaining cost is a sum of r roughly independent run costs, so its mean is r x mean and its standard deviation is sd x sqrt(r); the rule bounds that sum at mean + 2 sd. Charging 2 sd to every id separately would bound a sum of r costs at 2 sd x r, which is far wider than any sum of independent costs and stopped a typical C arm early. `COSTCHK` rows carry the projection; the audit recomputes each one from the `COST` rows, and separately re-derives every arm's actual spend (all `COST` runs plus `probes.tsv`) and fails if it exceeds the arm's cap. At audit time it also re-checks that the PREREG note and manifest are still tracked, unmodified and equal to the hashes logged at the start (`HASH prereg`, `HASH manifest`), that the recorded commit is an ancestor of HEAD, and that every `MODEL` row is exactly one model id. Further audit rules: exactly one `COSTCHK` per id, before that id's `START`; exactly one `MODEL` and one `HOOKERR` row per id; hook errors in more than 2 ON runs fail the audit (instrument health); the last `END` must lie within the 8 hour window of `WINDOW_START`, and each harness call's timeout is clamped to the window that remains (a clamped call that times out writes `STOP_WINDOW`; no window left means no start). Also: every `COST` row must belong to an expected id and counts toward its arm's actual spend; every `HOOKERR` is a non-negative integer; all log timestamps parse and never go back, each id's START is not after its END, and each START's `elapsed` agrees with `WINDOW_START`; each id's `probes.tsv` statuses (columns id, rc, cost, ok|fail) must equal its `PROBE_OK`/`PROBE_FAIL` sequence in the log and end in a success before its `START`; each `SCORE` value is 0 or 1 and m3 is 1 exactly when m1 and m2 are; `BLOCKMAX` is a non-negative integer re-derived from the run's raw hook log (max `block` records in one turn, at most 2), and `HOOKCOUNT gate_log` and `HOOKERR` must match that raw log (the raw run directories must be present at audit time); every `COST` and probe cost is a finite non-negative number; `START` carries the elapsed value taken right before it is written, and the window is decided (final timeout computed, `STOP_WINDOW` if none is left) before any `ORDER`, `CMD` or `START` row; the PREREG note at the recorded commit must hash to the logged `HASH prereg`, and PREREG note, manifest and task hash baseline must not have been committed again since that commit (so they are committed together, in the commit this note records); the preregistration commit time is read from git at audit time and must precede `WINDOW_START` and the first START.

Check on the P1 rerun control's first five run costs (0.5529, 0.4575, 0.5917, 0.5005, 0.6279; mean 0.5461, sample sd 0.0684; five probes 0.083): projected 17.57 USD (probes charged) against the C cap 18, so no `STOP_COST`; the same numbers scaled by 1.25 project above 18 and stop. The 17.57 is unaffected by the later fix of the `COST` row's running total (a probe had been added twice there, an informational column; the pre-launch `COSTCHK` projection was already right). Both are asserted in `hooks/tests/p2-batch-wrapper.test.sh` and the first is printed by `--selfcheck` (`selfcheck.out`). The depth-0 note quoted 17.07; that figure leaves the probes out, the wrapper charges them, both are under 18.

## 4. Validity conditions and their artifacts (plan 3.1, implemented by `run-p2-batch.js`)

`--selfcheck` drives the real batch code over a synthetic batch (fake executor), asserts every row's tokens were written, runs the audit over the result, and prints the table (`selfcheck.out`). A batch is valid only if `node evals/orchestration/run-p2-batch.js --audit --manifest <manifest> --run-dir <dir> --clone <clone>` exits 0.

| # | Condition | Applies | Artifact written by the wrapper | Audit recomputes from |
|---|---|---|---|---|
| 1 | Each id launched exactly once, in the preregistered order | per id | `START <id> elapsed=` before the call, `END <id> rc=` after; the audit checks the START/END sequence equals the seeded order | log rows and their timestamps only; the order itself is recomputed from the manifest seed |
| 2 | Sequential, one window of at most 8 h | per id and end | `WINDOW_START` once (file `window.start`); `elapsed=` in each START; `STOP_WINDOW` (exit 8) if exceeded | log timestamps and `window.start`; accepted residual risk (a forged log clock), narrowed by a weak cross-check: `runs/<id>/run.log` and `result.json` mtimes must lie between that id's START and END (strict, no slack; measured file-clock lag is at most 1 ms and the real harness starts writing tens of ms after START) |
| 3 | Task hashes equal the preregistered listing | first call, last call, any early exit | `taskhash.pre.txt`, `taskhash.post.txt`, `TASKHASH_DIFF pre|post ok|fail` (post is written on every way out of the wrapper) | `taskhash.pre/post.txt` against the committed baseline, and the task directory re-hashed at audit time against both |
| 4 | CLI version 2.1.309 | per id | `VERSION <id> <value>` before the call; `RUNVERSION <id> ok|fail` from `result.json` | manifest pin and `runs/<id>/result.json` `runner_version`; the pre-run `VERSION` row is log-only |
| 5 | Authentication probe passed, no expiry | per id | `PROBE_OK|PROBE_FAIL <id>`, `probes.tsv`; `STOP_AUTH` (exit 6) when a run ends in an auth error; a failed probe launches nothing (exit 7) | `probes/<id>-<n>.json` (saved status, model and cost fields of each probe response, no credential material) -> ok/fail sequence and cost, cross-checked with `probes.tsv` and the PROBE rows |
| 6 | No deviation from the preregistered command | per id | `CMD <id> <sha256 of argv>` (out and trace paths replaced by placeholders), audited against `argv_sha` | `cmd/<id>.json` (the actual argv), re-hashed and compared with the CMD row, the manifest `argv_sha` and the manifest command template (only the out and trace paths may differ) |
| 7 | Oracle score recoverable | per id | `SCORE <id> m1 m2 m3` or `SCORE_MISSING <id>` | `runs/<id>/oracle.log` (both fields must be real booleans) |
| 8 | At least 27 of 30 completed five turns, in each arm | per id and end | `TURNS <id> arm= n=`; `COMPLETE ON=x/30 C=y/30` | `runs/<id>/result.json` `turns_completed` and the END rc |
| 9 | Single resolved model id | per id | `MODEL <id> <value>` | `runs/<id>/run.log` `modelUsage` keys |
| 10 | Hook only in ON runs, only the gate hook | per id | `HOOKCOUNT <id> gate_trace= gate_log= plugin=`, `HOOKERR <id> n` (trace from `--debug hooks --debug-file`, same flags in both arms) | `trace/<id>/` debug traces (gate_trace, plugin) and `runs/<id>/hook/live/per-turn-gate/*.jsonl` (gate_log, HOOKERR) |
| 11 | Blocks per turn never exceed N | per id | `BLOCKMAX <id> v` from the hook log | `runs/<id>/hook/live/per-turn-gate/*.jsonl` |
| 12 | Interleaving order as preregistered | per id | `ORDER <id> <arm> pos=k` before the call | manifest seed |
| 13 | Cost within the cap | per id | `COSTCHK` before, `COST <id> arm= run= probe= running= projected=` after; `STOP_COST` (exit 5) | `runs/<id>/run.log` last result `total_cost_usd` (run cost), `probes.tsv` (probe costs, summary-trusting beyond the file), COSTCHK recomputed from the COST rows |
| 14 | Preregistration committed earlier | before first call | `PREREG <hash> <time> ancestor=yes|no` (note and manifest tracked and unmodified), `HASH wrapper|hook|harness|manifest`; the audit checks the commit time is before `WINDOW_START` and the first START | git: note at the recorded commit, history since, commit time; committed manifest and baseline files |

Further audit rules (round 8): the probe's saved `auth_ok` (computed by the wrapper from the full response, with the response's sha256) decides ok/fail, and a missing, non-numeric or negative `total_cost_usd` makes a probe fail and makes a run's cost invalid (`COST_INVALID`, then no `COST` row, so the audit fails); `cmd/<id>.json` must use exactly `<run dir>/runs/<id>` and `<run dir>/trace/<id>`, so the audit has to run on the path where the batch ran; every run's raw `run.log` and stderr are re-scanned with the wrapper's authentication pattern (a hit fails the audit); every id of both arms must have at least one readable debug trace under `trace/<id>` before its hook counts are recomputed.

Round 9 rules: the whole `probes/` directory is enumerated (every file name an expected id plus a sequence number, numbered 1..n per id without a gap, matching `probes.tsv` and the PROBE rows); each `COST` probe column equals the sum of that id's saved probe costs (failed attempts included; a failed probe without a usable cost counts as 0 on both the `probes.tsv` and the audit side, so a probe that fails and is later redone after a fresh login still audits OK); every run needs its stderr file (empty is fine); the audit hashes the actual hook, harness and wrapper files (`--wrapper-file` can name the wrapper file when the audit is run by another copy) and the task directory, and compares them with the manifest.

Round 10 (systematic): Appendix A lists every row kind with every field and every raw file with how the audit checks it. The audit now fails on an unknown or unparseable row, a row of the wrong shape, an id or arm that is not the seeded one, a row out of its per-id sequence (COSTCHK, VERSION, PROBE, ORDER, CMD, START, END, then the post rows once each), a missing or non-final WRAPPER_DONE or WRAPPER_EXIT, a PAUSE count that differs from the PROBE_FAIL count, any file set that is not exactly the expected ids (runs/, trace/, cmd/, probes/), a corrupt line in a hook JSONL or gate.jsonl, an unknown id in probes.tsv, a COSTCHK stage or cap or a COST projected value that differs from the recomputation, a PROBE row that disagrees with its saved response, a RUNVERSION flag that disagrees with its value, a PREREG commit or time that differs from git, and a window.start that disagrees with the WINDOW_START row. `--audit` without `--clone` fails.

Rows that can only trust a log-side record: 2 window (the log clock; the file-time cross-check is weak and the risk is accepted). All other rows are recomputed from raw run files or saved responses, which must still be present when the audit runs.

Also kept: no scratch path in `invocation.log` (the audit scans for absolute paths), node timestamps, the `env -u` prefix, one harness call per id.

### Failed runs and the completion count (semantics)

One failed run does not invalidate the batch; the plan tolerates failures through "at least 27 of 30 completed five turns, in each arm". Every `END` carries an integer harness rc. A run with rc other than 0 (a timeout is 124) is never counted as complete, even if `TURNS` says 5; its `SCORE` is either `SCORE_MISSING` or equal to the audit's own recomputation from the run's `oracle.log` (a successful call, rc 0, must have a `SCORE`). The audit recomputes `COMPLETE ON=x/30 C=y/30` itself from END rc and TURNS and fails if the logged line differs; the 27-of-30 minimum applies to that recount. The audit also compares each `RUNVERSION` value with the pinned `2.1.309 (Claude Code)` and with the run's own `result.json` `runner_version`, not with the ok marker.

## 5. Procedure for P2-3 and what is committed

Run `node evals/orchestration/run-p2-batch.js --run --run-dir <scratch run dir> --clone <clean clone at the commit that holds this note> --manifest docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/manifest.json` (optionally `--first i --last j` to resume after a pause; a paused id is launched once after the owner logs in again). Then `--audit` (exit code recorded). Commit: `invocation.log` (unchanged except it has no scratch paths by construction), `probes.tsv`, `taskhash.pre.txt`, `taskhash.post.txt`, the audit output, the analysis table, and sums of the raw files; raw run directories stay in scratch.

## 6. No outcome seen

No call of the P2-3 batch precedes this commit. The numbers quoted above come from the P1 rerun (adopted baseline) and from the plan; no ON or concurrent-control run has been measured.

Round 11: the audit recomputes COSTCHK spent exactly from run.log result costs and saved probe responses; every run.log line that starts with `{` must parse completely; each HASH kind appears once per wrapper invocation and every row equals the actual file; gate.jsonl lines must be non-array objects; `trace/<id>/latest` (made by the real CLI) is never counted and must be a symlink to the highest trace-turn file; VERSION is exactly one row per id, between COSTCHK and the first PROBE row (a resume does not write it again); TASKHASH_DIFF rows are exactly `pre|post ok|fail`. The test column of Appendix A is now one `T:KIND.field` label per field, and a test checks that each label exists.

## Appendix A. Every audited row and file (generated by `node evals/orchestration/run-p2-batch.js --schema-table`)

| Row kind | Field | How the audit checks it | Test (assertion text) |
|---|---|---|---|
| `WRAPPER_START` | first | FORMAT: 1 <= first <= last <= 2n | `T:WRAPPER_START.first` |
|  | last | FORMAT: last <= 2n | `T:WRAPPER_START.last` |
| `WRAPPER_DONE` | last | ROW: the final one equals 2n (full batch) | `T:WRAPPER_DONE.last` |
| `WRAPPER_EXIT` | rc | ROW: the last row of the log, rc 0; one per WRAPPER_START | `T:WRAPPER_EXIT.rc` |
| `HASH` | name | FORMAT: one of six names, all present | `T:HASH.name` |
|  | count | ROW: each of the six appears once per WRAPPER_START, and every one equals the actual file | `T:HASH.count` |
|  | sha256 | RAW: the file hashed now (wrapper, hook, harness, manifest, PREREG note, baseline) and MANIFEST | `T:HASH.sha256` |
| `PREREG` | commit | GIT: git log -1 -- the PREREG path; note at that commit hashes to HASH prereg | `T:PREREG.commit` |
|  | time | GIT: committer time of that commit, and earlier than WINDOW_START | `T:PREREG.time` |
|  | ancestor | GIT: merge-base --is-ancestor now | `T:PREREG.ancestor` |
| `WINDOW_START` | row | RAW: window.start epoch agrees with the row timestamp; exactly one row, before the first START | `T:WINDOW_START.row` |
| `TASKHASH_DIFF` | phase | FORMAT | `T:TASKHASH_DIFF.phase` |
|  | tail | FORMAT: nothing follows ok or fail | `T:TASKHASH_DIFF.tail` |
|  | verdict | RAW: taskhash.pre/post.txt equal the baseline listing and the task directory hashed now | `T:TASKHASH_DIFF.verdict` |
| `ORDER` | id | SEED | `T:ORDER.id` |
|  | arm | SEED | `T:ORDER.arm` |
|  | pos | SEED | `T:ORDER.pos` |
|  | position | ROW: after the id's last probe row, before its CMD and START | `T:ORDER.position` |
| `VERSION` | id | SEED | `T:VERSION.id` |
|  | value | MANIFEST: the pinned CLI | `T:VERSION.value` |
|  | position | ROW: exactly one per id, after its COSTCHK and before its first PROBE row | `T:VERSION.position` |
| `PROBE_OK` | id | SEED | `T:PROBE_OK.id` |
|  | cost | RAW: probes/<id>-<k>.json, the k-th attempt | `T:PROBE_OK.cost` |
| `PROBE_FAIL` | id | SEED | `T:PROBE_FAIL.id` |
|  | rc | RAW: saved response rc | `T:PROBE_FAIL.rc` |
|  | cost | RAW: saved response cost | `T:PROBE_FAIL.cost` |
| `PAUSE` | row | ROW: one per PROBE_FAIL | `T:PAUSE.row` |
| `CMD` | id | SEED | `T:CMD.id` |
|  | sha256 | RAW: cmd/<id>.json re-hashed; MANIFEST argv_sha and template | `T:CMD.sha256` |
| `START` | id | SEED (order) | `T:START.id` |
|  | elapsed | ROW: timestamp minus WINDOW_START, 3 s slack | `T:START.elapsed` |
| `END` | id | SEED (order) | `T:END.id` |
|  | rc | FORMAT integer; semantics in COMPLETE and SCORE_MISSING | `T:END.rc` |
| `COSTCHK` | id | SEED | `T:COSTCHK.id` |
|  | arm | SEED | `T:COSTCHK.arm` |
|  | stage | ROW: recomputed from the COST rows before it | `T:COSTCHK.stage` |
|  | spent | ROW: recomputed; covers earlier probes in probes.tsv | `T:COSTCHK.spent` |
|  | projected | ROW: recomputed by projectCost | `T:COSTCHK.projected` |
|  | cap | MANIFEST | `T:COSTCHK.cap` |
|  | verdict | ROW: ok only when the recomputed projection is within the cap | `T:COSTCHK.verdict` |
| `COST` | id | SEED | `T:COST.id` |
|  | arm | SEED | `T:COST.arm` |
|  | run | RAW: last result object of run.log | `T:COST.run` |
|  | probe | RAW: sum of the id's saved probe responses | `T:COST.probe` |
|  | running | ROW: arm sum of runs plus probes.tsv up to this id | `T:COST.running` |
|  | projected | ROW: recomputed by projectCost | `T:COST.projected` |
| `SCORE` | id | SEED | `T:SCORE.id` |
|  | m1 | RAW: oracle.log constraints_pass (real boolean) | `T:SCORE.m1` |
|  | m2 | RAW: oracle.log features_pass (real boolean) | `T:SCORE.m2` |
|  | m3 | ROW: m1 and m2 | `T:SCORE.m3` |
| `SCORE_MISSING` | id | SEED; only after END rc != 0 | `T:SCORE_MISSING.id` |
| `TURNS` | id | SEED | `T:TURNS.id` |
|  | arm | SEED | `T:TURNS.arm` |
|  | n | RAW: result.json turns_completed | `T:TURNS.n` |
| `RUNVERSION` | id | SEED | `T:RUNVERSION.id` |
|  | flag | ROW: ok exactly when the value is the pin | `T:RUNVERSION.flag` |
|  | value | RAW: result.json runner_version, and MANIFEST pin | `T:RUNVERSION.value` |
| `MODEL` | id | SEED | `T:MODEL.id` |
|  | value | RAW: modelUsage keys of run.log; exactly one id, same in all rows | `T:MODEL.value` |
| `HOOKCOUNT` | id | SEED | `T:HOOKCOUNT.id` |
|  | gate_trace | RAW: trace/<id>/ files | `T:HOOKCOUNT.gate_trace` |
|  | gate_log | RAW: hook JSONL record count | `T:HOOKCOUNT.gate_log` |
|  | plugin | RAW: trace/<id>/ files | `T:HOOKCOUNT.plugin` |
| `HOOKERR` | id | SEED | `T:HOOKERR.id` |
|  | n | RAW: hook JSONL error records; non-negative integer | `T:HOOKERR.n` |
| `BLOCKMAX` | id | SEED | `T:BLOCKMAX.id` |
|  | value | RAW: hook JSONL max block records in one turn; at most N | `T:BLOCKMAX.value` |
| `COMPLETE` | counts | ROW: recount from END rc and result.json turns_completed (the last row) | `T:COMPLETE.counts` |
|  | n | MANIFEST: n_per_arm in both counts | `T:COMPLETE.n` |
| any other kind, an unparseable row, a missing timestamp | all | the audit fails | `unknown row kind` |
| `STOP_COST`, `STOP_WINDOW`, `STOP_AUTH`, `ABORT`, `REFUSE`, `COST_INVALID` | all | presence fails the audit | `terminal row` |

| Raw file or set | Must | Test (assertion text) |
|---|---|---|
| `invocation.log` | every line parses to a known row kind and shape | `unknown row kind` |
| `window.start` | one number; agrees with the WINDOW_START row | `WINDOW_START file` |
| `taskhash.pre.txt, taskhash.post.txt` | exist; equal the baseline | `notaskpost` |
| `probes.tsv` | every line has 4 columns, id in the expected set, rc integer, cost number, status ok|fail | `probes.tsv unknown id` |
| `probes/<id>-<n>.json` | the set is exactly the files of expected ids, n = 1..k per id, each a complete JSON object | `extra probe response with a gap` |
| `cmd/<id>.json` | the set is exactly the expected ids; each a JSON array | `cmd/ file set is not exactly the expected ids` |
| `cmd/<id>.json (content)` | equals the manifest template with the canonical paths and hashes to the CMD row | `saved argv with another gate` |
| `runs/` | entries are exactly <id>/, <id>.stdout, <id>.stderr for the expected ids (no more, no fewer) | `extra entry in runs` |
| `runs/<id>/run.log` | exists for a finished call; AUTH pattern absent | `raw run.log shows an expired session` |
| `runs/<id>/run.log (JSON lines)` | every line that starts with { parses completely (a truncated result object fails) | `run.log truncated result object` |
| `runs/<id>.stderr` | exists (empty is fine); AUTH pattern absent | `stderr files deleted` |
| `runs/<id>/result.json` | exists and parses completely when the call ended with rc 0 (when present it must parse); runner_version equals the log | `result.json truncated` |
| `runs/<id>/oracle.log` | exists when the call ended with rc 0; first JSON object parses | `oracle.log disagrees` |
| `runs/<id>/gate.jsonl` | exists when the call ended with rc 0; every line is a JSON object | `gate.jsonl corrupt line` |
| `runs/<id>/hook/live/per-turn-gate/*.jsonl` | ON: at least one file; C: no hook directory; every record line parses with its fields | `corrupt hook log line` |
| `trace/<id>/trace-turn<n>.log` | the set is exactly the expected ids; at least one regular file each; only a `latest` symlink to the highest-numbered file may be extra (never counted) | `all C-arm traces deleted` |
| `trace/<id>/latest` | absent, or a symlink resolving to the highest-numbered trace-turn file | `trace latest symlink to the wrong file` |
