# P2-3 batch preregistration - per-turn gate, hook ON against a concurrent control (BL-0055 phase 2)

Committed before any measured call. Lane ptg-p22 (P2-2 Instrument). Owner decision d-15c0364c (2026-10-24, Taipei time): D2 (concurrent control), 30 ON and 30 C runs, total cap 48 USD, C arm 17 USD, ON arm 31 USD, n = 30. Plan: `docs/plans/2026-10-24-per-turn-gate-phase2.md` sections 3, 3.1, 4. No model call was made while building the instrument; every test used a stub runner or a fake `claude`.

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
| Wrapper `evals/orchestration/run-p2-batch.js` | sha256 `bbe22662d73017753d390c9bcd8eb5704bfd25776f7d7dd6a9399183eef0a807` |
| `manifest.json` (this directory) | sha256 `69d26e21082396ebff86da812dc1e86dc17a11e22fee5d254452b80ef0bed82d`; the wrapper refuses an untracked or modified manifest and logs `HASH manifest` |
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

Caps, never raised in place: C arm 17 USD, ON arm 31 USD (total 48), each with its own projection. A run costs its last result object's `total_cost_usd` (cumulative within a session); a probe costs its own `total_cost_usd` (about 0.0166). Before every id, in `projectCost` (the single function the wrapper and the audit share):

- fewer than 5 finished runs in the arm: projected = arm spend (runs + probes) + one probe; no projection yet;
- 5 or more: projected = arm spend + remaining ids of the arm (the one about to start included) x (mean of the arm's finished run costs + 2 x their sample standard deviation + one probe);
- projected > the arm's cap: write `STOP_COST`, exit 5, launch nothing more; the batch is U and the owner decides on a rerun.

`COSTCHK` rows carry the projection; the audit recomputes each one from the `COST` rows.

**Known property, for the owner (O2) before launch:** this literal rule is strict. Applied to the first five run costs of the P1 rerun control (0.5529, 0.4575, 0.5917, 0.5005, 0.6279; mean 0.5461, sample sd 0.0684) it projects 20.30 USD against the C cap 17 and writes `STOP_COST` before C id number 6, although the P1 batch cost 16.23 USD in total. It is printed by `--selfcheck` (see `selfcheck.out`). Whether to keep the rule and cap as written, or to amend them (a different projection, a higher C cap), is an owner decision that needs a new preregistration; this note does not change either.

## 4. Validity conditions and their artifacts (plan 3.1, implemented by `run-p2-batch.js`)

`--selfcheck` drives the real batch code over a synthetic batch (fake executor), asserts every row's tokens were written, runs the audit over the result, and prints the table (`selfcheck.out`). A batch is valid only if `node evals/orchestration/run-p2-batch.js --audit --manifest <manifest> --run-dir <dir> --clone <clone>` exits 0.

| # | Condition | Applies | Artifact written by the wrapper |
|---|---|---|---|
| 1 | Each id launched exactly once, in the preregistered order | per id | `START <id> elapsed=` before the call, `END <id> rc=` after; the audit checks the START/END sequence equals the seeded order |
| 2 | Sequential, one window of at most 8 h | per id and end | `WINDOW_START` once (file `window.start`); `elapsed=` in each START; `STOP_WINDOW` (exit 8) if exceeded |
| 3 | Task hashes equal the preregistered listing | first call, last call, any early exit | `taskhash.pre.txt`, `taskhash.post.txt`, `TASKHASH_DIFF pre|post ok|fail` (post is written on every way out of the wrapper) |
| 4 | CLI version 2.1.309 | per id | `VERSION <id> <value>` before the call; `RUNVERSION <id> ok|fail` from `result.json` |
| 5 | Authentication probe passed, no expiry | per id | `PROBE_OK|PROBE_FAIL <id>`, `probes.tsv`; `STOP_AUTH` (exit 6) when a run ends in an auth error; a failed probe launches nothing (exit 7) |
| 6 | No deviation from the preregistered command | per id | `CMD <id> <sha256 of argv>` (out and trace paths replaced by placeholders), audited against `argv_sha` |
| 7 | Oracle score recoverable | per id | `SCORE <id> m1 m2 m3` or `SCORE_MISSING <id>` |
| 8 | At least 27 of 30 completed five turns, in each arm | per id and end | `TURNS <id> arm= n=`; `COMPLETE ON=x/30 C=y/30` |
| 9 | Single resolved model id | per id | `MODEL <id> <value>` |
| 10 | Hook only in ON runs, only the gate hook | per id | `HOOKCOUNT <id> gate_trace= gate_log= plugin=`, `HOOKERR <id> n` (trace from `--debug hooks --debug-file`, same flags in both arms) |
| 11 | Blocks per turn never exceed N | per id | `BLOCKMAX <id> v` from the hook log |
| 12 | Interleaving order as preregistered | per id | `ORDER <id> <arm> pos=k` before the call |
| 13 | Cost within the cap | per id | `COSTCHK` before, `COST <id> arm= run= probe= running= projected=` after; `STOP_COST` (exit 5) |
| 14 | Preregistration committed earlier | before first call | `PREREG <hash> <time> ancestor=yes|no` (note and manifest tracked and unmodified), `HASH wrapper|hook|harness|manifest`; the audit checks the commit time is before `WINDOW_START` and the first START |

Also kept: no scratch path in `invocation.log` (the audit scans for absolute paths), node timestamps, the `env -u` prefix, one harness call per id.

## 5. Procedure for P2-3 and what is committed

Run `node evals/orchestration/run-p2-batch.js --run --run-dir <scratch run dir> --clone <clean clone at the commit that holds this note> --manifest docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/manifest.json` (optionally `--first i --last j` to resume after a pause; a paused id is launched once after the owner logs in again). Then `--audit` (exit code recorded). Commit: `invocation.log` (unchanged except it has no scratch paths by construction), `probes.tsv`, `taskhash.pre.txt`, `taskhash.post.txt`, the audit output, the analysis table, and sums of the raw files; raw run directories stay in scratch.

## 6. No outcome seen

No call of the P2-3 batch precedes this commit. The numbers quoted above come from the P1 rerun (adopted baseline) and from the plan; no ON or concurrent-control run has been measured.
