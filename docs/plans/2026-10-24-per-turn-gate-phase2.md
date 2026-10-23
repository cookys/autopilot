# Plan - per-turn gate, phase 2 (BL-0055): a Stop-hook adapter and its ON/OFF evaluation

> Status: draft, awaiting plan review. Written after owner decision d-35748784 (2026-10-24, Taipei time): GO on a plan for the stages after P1. The follow-up that section 4 of `docs/plans/2026-10-20-per-turn-gate.md` reserved; no code changes here; it needs its own plan review.

## 0. Thesis

Two earlier t14 experiments showed that a per-turn check that talks back to the model can hold stated rules without losing features (round 2: M3 26/29), but both put the gate in the evaluation harness (`apply_gate` in `evals/orchestration/run-orchestration-eval.sh`: run a verifier after a turn, then start a new `claude -p --resume` turn with the retry text). P0 showed that Claude Code 2.1.309 lets a Stop hook do the same job inside the session. Phase 2 builds that hook as an opt-in mechanism and measures whether it keeps the round-2 benefit against the P1 baseline. The two treatments differ, so round-2 numbers are a reference, not a prediction.

Out of scope: a default-on decision, a larger-model rerun, a shadow pilot, a SubagentStop adapter (section 2.4), any skill text edit. Version stays 3.0.0 (owner hold).

## 1. Inputs from P0 and P1 (the section 4 questions)

Evidence: `docs/plans/evidence/2026-10-23-per-turn-gate-p0/README.md`, `.../2026-10-24-per-turn-gate-p1-rerun/README.md` (the first P1 batch, label U, is history only).

| Question (plan section 4) | Status | Answer |
|---|---|---|
| Which hook points are viable (A1, A2, B1, C1) | answered, with limits | All four `produced` on CLI 2.1.309, alias `claude-haiku-4-5`. A1: after a Stop block the hook is called again with `stop_hook_active` true and the model continues. A2: a second block is honored; the flag is a signal, not a limit. B1: a file counter at N=2 gave exactly two blocks, the third call allowed the stop. C1: a SubagentStop block makes the subagent continue. Limits: single short sessions, the throwaway hook alone; a trial with the plugin Stop hooks and the throwaway hook together was not run. Multi-turn `--resume` sessions, `--setting-sources project` (the flag the harness passes), and what the counter does across turns were not probed. Isolation rests on the trace alone (no side effect appeared even in the control run). |
| Measured M2_3 and its label | answered, with a disclosed deviation | M1 6/30, M2 13/30, M3 0/30; Fisher p 0.0169 against 23/30 and 0.7925 against 11/29; label A. The batch is not rule-valid (the post-run task-hash comparison was never captured); the owner adopted it on substitute evidence (d-baf11c30). The label is numeric compatibility only (dedicated config directory, direct harness calls). |
| Is the resolved model id recorded and stable | answered, uninformative | Recorded: `claude-haiku-4-5` in every run of the rerun. Stable across 30 runs, but the value is the alias itself, so it cannot reveal a snapshot change (candidate 1 stays unresolved). |
| What a complete C run costs and how long it takes | answered | Last-result-object `total_cost_usd` (cumulative within a session): mean 0.524 USD, sd 0.151, range 0.187 to 0.821 (`costs.tsv`); one auth probe 0.0166 USD; the batch cost 16.23 USD (15.73 runs plus 0.50 probes), mean run time 308 s (9240 s over 30), window 2.6 h. 29 of 30 completed five turns (C-30 runner_timeout at 716 s after 3 turns). |
| Which causes of the M2 drop stay unresolved | answered | None is established. Rows 1, 2, 3 and 8 unresolved; rows 6 and 7 unavailable (settings and turn-1 listings were never logged); row 4 (harness diff on the observe path) and row 5 (auth state, pooled reading) only consistent. Consequence for this plan: the C-arm rate moved 23/30, 11/29, 13/30 for reasons nobody can name, so a historical baseline is not safe and the evaluation prefers a concurrent control (section 3). |

Two facts shape the design. (a) The verifier `evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js` takes `--turn N --repo DIR --json` and exits 0 (clean), 1 (violations) or another code (error); a Stop hook receives no turn number, so the hook must derive it. (b) The P1 lesson: a validity condition without an artifact written at the moment it applies cannot be checked later (the end-of-batch task-hash comparison). Section 3 makes this a hard requirement.

## 2. Phase 2 scope and the mechanism/guidance ruling

Test applied (CLAUDE.md, literal): list the requirements a skill asks for before and after. No item below edits a skill or any text that asks the model for something already, so no item is a "make an existing gate block" mechanism change in that sense; the rulings say what each is and what evidence it needs.

| ID | Change | Ruling | Evidence needed |
|---|---|---|---|
| W1 | Opt-in Stop hook `hooks/per-turn-gate.js`, default off: runs the project's verifier command, blocks with its text, allows on error (fail-open) | mechanism (deterministic control flow; asks the model nothing new by itself). Ships as a new opt-in hook, default off, a PATCH-class surface held at 3.0.0 | unit tests with negative controls (section 4); the live probe P2-0 |
| W2 | File counter bounding blocks to N per turn (default 2, the historical cap), reset when a turn starts | mechanism | negative controls NC2, NC4 |
| W3 | Turn index derived by the hook, passed to the verifier as `--turn` | mechanism | P2-0 probe, NC4 |
| W4 | Retry-text contract: violations first, then feature gaps, ending with a keep-what-works line (the round-2 text) | guidance (changes what the model is asked after a block) | ON/OFF evaluation (section 3). Until it passes, the hook ships with the text pass-through only and the doc says the text is unevaluated |
| W5 | Eval instrument: `--gate hook` mode in `run-orchestration-eval.sh` (installs the hook into the temp repo's project settings; the task directory is untouched) and wrapper v2 | mechanism (test tooling; changes no shipped behaviour) | NC5, NC7 |
| W6 | Any default-on decision | out of scope; guidance; needs its own plan | n/a |

Hard rule from CLAUDE.md: W4 ships in its own commit, apart from W1 to W3; a mechanism commit does not edit requirement text.

### 2.1 Hook design (from P0 evidence)

- Event: Stop only. Reads stdin JSON (`session_id`, `cwd`, `transcript_path`, `stop_hook_active`). Calls the verifier command from configuration (new key in `config-keys.json`, doc entry required by `check-config-docs.js`), with a hard timeout.
- Decision: verifier exit 1 with a reportable payload and counter below N: print `{"decision":"block","reason":<text>}`, increment the counter. Exit 0 with no gaps, counter at N, verifier error (crash, timeout, unparseable output), or knob off: allow, and append a record (`allowed_reason`: clean, cap, error, off) to the hook log. Error is never a block (a crashing verifier must not trap a session).
- Counter: per `(session_id, turn)` file under the live-state directory (`lib/live-state-dir.js`). Turn boundary rule (to be confirmed in P2-0): a Stop call with `stop_hook_active` false starts a new turn: counter := 0 and turn index := previous + 1. A1/A2 showed the flag true on re-entry; whether it is false on the first Stop of a resumed turn is exactly what P2-0 checks. If it is not, fall back to counting user prompts in `transcript_path`.
- Inventory: opt-in manifest, hook-classes, `check-hook-inventory.js`, and the "When adding a new script" wiring in CLAUDE.md.

### 2.2 Verifier contract

The hook knows nothing about t14. A project supplies a command with the interface, exit codes and JSON shape of `verify-turn.js` (`violations[]`, `feature_gaps[]`); the t14 verifier is the only one evaluated.

### 2.3 Coexistence and timing

`hooks.json` already wires five Stop hooks; the new one is opt-in. P2-0 runs one trial with the plugin hooks and the gate hook together; if the behaviour is not "a block from any hook blocks", W1 is BLOCKED. P2-0 also measures the verifier's wall time on a t14 repo; beyond the hook timeout budget the design is not shipped (section 6).

### 2.4 SubagentStop (C1)

C1 was `produced` and affirmative, so the plan's consequence (drop the adapter if C1 fails) does not fire. It is still deferred: t14 has no subagents, so no baseline exists to measure it, and shipping an unmeasured second hook breaks scorecard-first. It becomes its own plan when a task with subagents exists. Owner decision O4.

## 3. Evaluation design (ON arm)

Needed because W4 is guidance. W1 to W3 do not need it for existence, but the document that tells users to enable the hook cites its results.

Treatment: ON-hook = harness `--gate hook`, cap N=2, retry text per W4. Task `t14-constraint-horizon`, alias `claude-haiku-4-5`, CLI 2.1.309, credentials-only config directory, fresh credentials copy and an auth probe before every id (rerun wrapper behaviour).

Design choice for the owner (O1):

- D1, ON only: 30 ON runs against the adopted rerun control (13/30 M2, 6/30 M1, 0/30 M3). Cheaper; inherits the unexplained baseline drift and the rerun's accepted deviation.
- D2, concurrent control (recommended): 30 ON and 30 C runs, interleaved in pairs, order randomised once with a seed written in the preregistration. The extra C runs are the price of not trusting a baseline that moved from 23 to 11 to 13 unexplained.

Metrics: M1, M2, M3 as in P1 (first JSON object of `oracle.log`, recomputed by two independent methods as in the rerun); per-feature results; blocks per turn and per run; runs where the cap was reached with a reportable gap left; fail-open events; harness duration and turns; cost per run.

Sample size: 30 per arm. The expected contrast is large (control M3 0/30, round-2 gate 26/29), so 30 detects it; it cannot detect an M2 loss of 15 points or less, so the claim is "no large trade".

Planned thresholds (planned values, not evidence; the preregistration commit fixes them):

- Primary: M3_ON >= 20/30 and one-sided Fisher p < 0.01 against the control M3 (concurrent in D2, 0/30 in D1).
- Trade check: M2_ON not below the control M2 at two-sided Fisher p <= 0.05, and M1_ON >= 25/30.
- Instrument health: hook errors (fail-open on verifier error) in at most 2 of 30 runs; no run with more than N blocks in one turn; every ON run has a hook log whose call count equals the trace's executed-hook count.
- Reported, not gating: M3_ON against round-2's 26/29 (transfer from the harness-side gate).
- Labels: PASS (all gating thresholds), FAIL-TRADE (primary met, trade check failed), FAIL (primary missed), U (not valid). A PASS permits documenting the hook as an evaluated opt-in; it does not decide a default.

Cost, derived from the P1 rerun (0.524 USD per run mean, sd 0.151; probe 0.0166). An ON run adds model turns for each block; one extra turn is about 0.524 / 5 = 0.105 USD, up to about 0.15 late in a longer context. Round 2 averaged about 1.5 retries per run (43 over 28).

| Scenario | ON per run | 30 ON runs (with probes) | C arm (D2) | D2 total |
|---|---|---|---|---|
| Lower (no block ever fires) | 0.52 | 16.1 | 16.2 | 32 |
| Central (1.5 blocks per run) | 0.70 | 21.5 | 16.2 | 38 |
| Upper (6 blocks per run, long contexts) | 1.40 | 42.5 | 16.2 | 59 |

Proposed cap: D1 30 USD, D2 48 USD, counted separately from earlier spend and never raised, with the P1 rerun stop rule re-based on the running mean after the first 5 ids (project total with mean plus 2 sd for the remaining ids; stop launching when it would exceed the cap). P2-0 probes add at most 1 USD (P0 spent 0.162 for 11 sessions). Owner approval of the figure precedes launch.

Preregistration requirements, all of the P1 rerun's plus:

1. The preregistration commit precedes the first call; the wrapper verifies tracked and unmodified, and records the commit hash and time (kept).
2. The wrapper's own sha256, the hook's and the harness' sha256 are written into the log header before the first call.
3. The condition-to-artifact table below is in the preregistration and implemented by the wrapper.

### 3.1 Hard requirement: every validity condition has a contemporaneous artifact

The P1 rerun could not be called valid because the wrapper wrote no artifact at the moment the end-of-batch condition applied. For this plan: each preregistered validity condition must have an artifact the wrapper writes when the condition applies, listed below before the first call. A condition with no listed artifact is not a validity condition; reconstruction after the fact does not count. The wrapper has `--selfcheck` (prints the table and asserts a writer exists for each row; its output is committed with the preregistration) and `--audit` (after the batch, exits non-zero if any artifact is absent or any condition fails). `--audit` is part of the verdict note; a batch is valid only if it exits 0.

| Condition | Applies | Artifact written by the wrapper |
|---|---|---|
| Each id launched exactly once, in the preregistered order | per id | `START <id> <ts>` appended before the call; `END <id> <ts> rc=` after; `--audit` checks order and uniqueness |
| Sequential, one window of at most 8 h | per id and end | `WINDOW_START` once; per id elapsed in `START`; `STOP_WINDOW` if exceeded |
| Task hashes equal the preregistered listing | before first call and after last call, also on any early exit (trap) | `taskhash.pre.txt`, `taskhash.post.txt`, and a `TASKHASH_DIFF ok|fail` line |
| CLI version 2.1.309 | per id | `VERSION <id> <value>` before the call; compared with `result.json` runner_version |
| Authentication probe passed, no expiry | per id | `PROBE_OK|PROBE_FAIL <id>` and the `probes.tsv` row; a run ending in an auth error writes `STOP_AUTH` |
| No deviation from the preregistered command | per id | `CMD <id> <sha256 of argv>`, compared by `--audit` to the manifest in the preregistration |
| Oracle score recoverable | per id, after the run | `SCORE <id> m1 m2 m3` parsed by the wrapper, or `SCORE_MISSING <id>` |
| At least 27 of 30 completed five turns | per id and end | `TURNS <id> n` from `result.json`; final tally line |
| Single resolved model id | per id | `MODEL <id> <value>` |
| Hook active only in ON runs, and only the gate hook | per id | per-run hook trace (`--debug hooks --debug-file`, the same flags in both arms) plus `HOOKCOUNT <id> trace=<n> log=<n>`; C runs must show 0 |
| Blocks per turn never exceed N | per id | hook log read by the wrapper: `BLOCKMAX <id> <value>` |
| Interleaving order as preregistered (D2) | per id | `ORDER <id> <arm>` before the call, checked against the seeded list |
| Cost within the cap | per id | `COST <id> run probe running_total projected`; `STOP_COST` |
| Preregistration committed earlier | before first call | `PREREG <hash> <commit time>` and `merge-base --is-ancestor` result (kept) |

Also kept: no scratch path in logs; timestamps from node (the host `date` is uutils and drops leading zeros of the fraction); the auth-probe stop rules; the `env -u` session-id prefix.

## 4. Negative controls (each shown red before green)

Every new check ships with a deliberately broken case that must be caught, shown red first (evidence-discipline section 58; mutations are applied to a copy and the red output is kept in the evidence note).

| ID | Check | Broken case that must be caught |
|---|---|---|
| NC1 | Hook blocks a violating repo | Repo with a planted violation: expect a block. Red: a hook stub that always allows fails the test. |
| NC2 | Counter bound | Verifier that always reports a violation, N=2: exactly 2 blocks, then allow. Red: counter code removed, the test (with its own iteration ceiling) sees the loop. |
| NC3 | Fail-open | Verifier crash, timeout, garbage JSON, missing command: each allows and logs `error`. Red: a mutation that blocks on error is caught. |
| NC4 | Turn boundary | Two turns in one session: the second starts at counter 0. Red: counter never reset, the second turn gets no block. |
| NC5 | Wrapper `--audit` | Truncate `invocation.log` (drop one `END`), remove `taskhash.post.txt`, duplicate a `START`: each must exit non-zero. Red first against a wrapper whose audit is stubbed to exit 0. |
| NC6 | Live gate in `-p` | Real `claude -p` on 2.1.309 with a planted violation: a block is observed in the transcript; with the knob off, none (P2-0). |
| NC7 | Harness `--gate hook` | Stub runner with a planted violation: `gate.jsonl` and the hook log show the block; with `--gate off` neither exists. |
| NC8 | Task integrity | Modify a task file mid-batch in a dry run: `TASKHASH_DIFF fail` and `--audit` non-zero. |

## 5. Phases and done-conditions

| Phase | Content | Done when |
|---|---|---|
| P2-0 Probe (about 1 USD, needs O5) | On 2.1.309: (a) multi-turn `--resume` session with a counting Stop hook: `stop_hook_active` on the first Stop of each turn, session id stable across resume; (b) hook loaded under `--setting-sources project`; (c) hook with the five plugin Stop hooks loaded; (d) verifier wall time on a t14 repo. Expected readings committed first | Each of (a) to (d) is `produced` or `unproduced` with a reason; the turn-boundary rule and the coexistence rule are written down; any contradiction with section 2.1 goes back to plan review |
| P2-1 Mechanism | W1, W2, W3 with tests NC1 to NC4, opt-in manifest, config key and docs, inventory entries; text pass-through only | Tests green on the final tree, each NC seen red first; `hooks/tests/run.sh` subset for the touched hook and affected-suites green; one commit per ruling |
| P2-2 Instrument | W5 (`--gate hook`), wrapper v2 with `--selfcheck` and `--audit`; NC5, NC7, NC8; preregistration note including thresholds, order seed, cost cap and the table in 3.1 | Wrapper `--selfcheck` output and NC5 red/green committed; preregistration committed before any measured call; owner approves the cost (O1, O2) |
| P2-3 Batch | The 30 (D1) or 30+30 (D2) runs | `--audit` exit code and the artifact files committed with sums; raw logs stay in scratch |
| P2-4 Verdict | Label PASS, FAIL-TRADE, FAIL or U; W4 text ships only on PASS; docs name what was and was not measured; recommendation to the owner | Verdict note and its recomputation by two independent methods; backlog row updated and archived after merge |

A batch that ends U for an instrument reason may be rerun whole, only by owner decision and a fresh preregistration; no mid-batch replacement.

## 6. Risks and stop conditions

- Treatment drift: a PASS is evidence for this hook on this task, not for the round-2 gate.
- One task, one model alias, one CLI pin. The CLI auto-updates; the version check per id stands, and a pin change goes to the owner.
- The hook traps a session (counter or turn rule wrong). Mitigations: fail-open, N cap, NC2, NC4, P2-0, run timeout. Stop: an NC that cannot be made red-then-green, or P2-0 showing the turn boundary cannot be detected, returns to plan review.
- Several Stop hooks disagree (P2-0 (c)), or verifier wall time exceeds the hook timeout: BLOCKED, not worked around.
- Authentication expiry mid-batch: STOP_AUTH, batch U, owner re-logs in, whole-batch rerun only by owner decision.
- Cost: the stop rule and cap in section 3; the cap is never raised in place.
- Harness edits touch frozen eval code: the task directory and its hashes stay untouched (NC8); W5 is limited to `run-orchestration-eval.sh` plus tests.

## 7. Decisions for the owner

- O1: D1 (ON only, cap 30 USD) or D2 (concurrent control, cap 48 USD, recommended).
- O2: the cost figures in section 3 (lower 16 to upper 43 for D1; 32 to 59 for D2) and the caps above.
- O3: thresholds (M3_ON >= 20/30, p < 0.01, M1_ON >= 25/30, trade check) and the 30-per-arm size, including the stated blind spot (a 15-point loss on M2 is not detectable).
- O4: confirm that SubagentStop (C1) is deferred to a later plan.
- O5: approve P2-0 (at most 1 USD).
- O6: confirm that shipping the hook as opt-in, default off, at version 3.0.0, with no CHANGELOG entry until the owner's release call, is acceptable.
- O7: a larger-model rerun stays out of this plan.

## Review log

R0 (2026-10-24): authored by lane ptgplan. Not yet reviewed.
