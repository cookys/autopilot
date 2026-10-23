# Plan - per-turn gate, phase 2 (BL-0055): a Stop-hook adapter and its ON/OFF evaluation

> Status: draft, awaiting plan review. Written after owner decision d-35748784 (2026-10-24, Taipei time): GO on a plan for the stages after P1. Follow-up to section 4 of `docs/plans/2026-10-20-per-turn-gate.md`; no code here; needs its own plan review.

## 0. Thesis

Two earlier t14 experiments showed that a per-turn check that talks back to the model can hold stated rules without losing features (round 2: M3 26/29), but both put the gate in the harness (`apply_gate` in `run-orchestration-eval.sh`: verify after a turn, then start a new `claude -p --resume` turn with the retry text). P0 showed that Claude Code 2.1.309 lets a Stop hook do the same job inside the session. Phase 2 builds that hook as an opt-in mechanism and measures whether it keeps the round-2 benefit against the P1 baseline. The treatments differ; round-2 numbers are a reference, not a prediction.

Out of scope: default-on, larger-model rerun, shadow pilot, SubagentStop adapter (2.4), skill text edits. Version stays 3.0.0.

## 1. Inputs from P0 and P1 (the section 4 questions)

Evidence: `docs/plans/evidence/2026-10-23-per-turn-gate-p0/README.md`, `.../2026-10-24-per-turn-gate-p1-rerun/README.md`.

| Question (plan section 4) | Status | Answer |
|---|---|---|
| Which hook points are viable (A1, A2, B1, C1) | answered, with limits | All four `produced` on CLI 2.1.309, alias `claude-haiku-4-5`. A1: after a block the hook is called again with `stop_hook_active` true and the model continues. A2: a second block is honored (the flag is a signal, not a limit). B1: a file counter at N=2 gave exactly two blocks. C1: a SubagentStop block makes the subagent continue. Limits: single short sessions, the throwaway hook alone; a trial with the plugin Stop hooks and the throwaway hook together was not run. Multi-turn `--resume` sessions, `--setting-sources project` (the flag the harness passes), and what the counter does across turns were not probed. Isolation rests on the trace alone (no side effect appeared even in the control run). |
| Measured M2_3 and its label | answered, with a disclosed deviation | M1 6/30, M2 13/30, M3 0/30; Fisher p 0.0169 against 23/30 and 0.7925 against 11/29; label A. Not rule-valid (no post-run task-hash comparison was captured); adopted by the owner on substitute evidence (d-baf11c30). The label is numeric compatibility only. |
| Is the resolved model id recorded and stable | answered, uninformative | Recorded: `claude-haiku-4-5` in every run of the rerun. Stable across 30 runs, but the value is the alias itself, so it cannot reveal a snapshot change (candidate 1 stays unresolved). |
| What a complete C run costs and how long it takes | answered | Last-result-object `total_cost_usd` (cumulative within a session): mean 0.524 USD, sample sd 0.1534, range 0.187 to 0.821 (`costs.tsv`); one auth probe 0.0166 USD; the batch cost 16.23 USD (15.73 runs plus 0.50 probes), mean run time 308 s, window 2.6 h; 29 of 30 completed five turns. |
| Which causes of the M2 drop stay unresolved | answered | None is established. Rows 1, 2, 3 and 8 unresolved; rows 6 and 7 unavailable (settings and turn-1 listings were never logged); row 4 (harness diff on the observe path) and row 5 (auth state, pooled reading) only consistent. The C-arm rate moved 23/30, 11/29, 13/30 for unnamed reasons, so the evaluation prefers a concurrent control (section 3). |

Two facts shape the design. (a) The verifier `evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js` takes `--turn N --repo DIR --json` and exits 0 (clean), 1 (violations) or another code (error); a Stop hook receives no turn number, so the hook must derive it. (b) The P1 lesson: a validity condition without an artifact written at the moment it applies cannot be checked later (the end-of-batch task-hash comparison). Section 3 makes this a hard requirement.

## 2. Phase 2 scope and the mechanism/guidance ruling

Test applied (CLAUDE.md, literal): list the requirements before and after. No item edits a skill, so none is a "make an existing gate block" change; the rulings say what each is.

| ID | Change | Ruling | Evidence needed |
|---|---|---|---|
| W1 | Opt-in Stop hook `hooks/per-turn-gate.js`, default off: runs the project's verifier command, blocks on violations (exit 1) with its text, allows on error (fail-open) | mechanism (deterministic control flow; asks the model nothing new by itself). Ships as a new opt-in hook, default off, a PATCH-class surface held at 3.0.0 | unit tests with negative controls (section 4); the live probe P2-0 |
| W2 | File counter bounding blocks to N per turn (default 2, the historical cap), reset when a turn starts | mechanism | negative controls NC2, NC4 |
| W3 | Turn index derived by the hook, passed to the verifier as `--turn` | mechanism | P2-0 probe, NC4 |
| W4 | Mode `violations+features`: the feature-gap trigger (a block on exit 0 with gaps, which changes when the hook blocks) and the round-2 text (violations first, then gaps, ending with a keep-what-works line) | guidance: it changes when the model is stopped and what it is asked, not only the wording | ON/OFF evaluation (section 3). Until it passes, the hook ships with the text pass-through only and the doc says the text is unevaluated |
| W5 | Eval instrument: `--gate hook` mode in `run-orchestration-eval.sh` (installs the hook into the temp repo's project settings; the task directory is untouched) and wrapper v2 | mechanism (test tooling; changes no shipped behaviour) | NC5, NC7 |
| W6 | Any default-on decision | out of scope; guidance; needs its own plan | n/a |

Hard rule from CLAUDE.md: W4 ships in its own commit, apart from W1 to W3; a mechanism commit does not edit requirement text.

### 2.1 Hook design (from P0 evidence)

- Event: Stop only. Reads stdin JSON (`session_id`, `cwd`, `transcript_path`, `stop_hook_active`). Calls the verifier command from configuration (new key in `config-keys.json`, doc entry required by `check-config-docs.js`), with a hard timeout.
- Reportable (mirrors `gate_turn_reportable` in `run-orchestration-eval.sh`; `verify-turn.js` itself exits 1 only on violations and records gaps without changing the exit code): mode `violations` (the W1 default) is reportable on exit 1 only; mode `violations+features` (the round-2 behaviour, W4) is also reportable on exit 0 with non-empty `feature_gaps`. The mode is a config key.
- Decision: reportable and counter below N: print `{"decision":"block","reason":<text>}`, increment the counter. Not reportable, counter at N, verifier error (crash, timeout, unparseable output), or knob off: allow, and append a record (`allowed_reason`: clean, cap, error, off) to the hook log. Error never blocks.
- Counter: per `(session_id, turn)` file under the live-state directory (`lib/live-state-dir.js`). Turn boundary rule (to be confirmed in P2-0): a Stop call with `stop_hook_active` false starts a new turn: counter := 0 and turn index := previous + 1. A1/A2 showed the flag true on re-entry; that it is false on the first Stop of a resumed turn is unproven (P2-0). If not, count user prompts in `transcript_path`.
- Inventory: opt-in manifest, hook-classes, `check-hook-inventory.js`, and the "When adding a new script" wiring in CLAUDE.md.

### 2.2 Verifier contract

A project supplies a command with the interface, exit codes and JSON shape of `verify-turn.js` (`violations[]`, `feature_gaps[]`); only the t14 verifier is evaluated.

### 2.3 Coexistence and timing

`hooks.json` already wires five Stop hooks; the new one is opt-in. P2-0 runs one trial with the plugin hooks and the gate hook together; if the behaviour is not "a block from any hook blocks", W1 is BLOCKED. P2-0 also measures the verifier's wall time on a t14 repo; beyond the hook timeout budget the design is not shipped (section 6).

### 2.4 SubagentStop (C1)

C1 was affirmative, so the drop consequence does not fire. It is still deferred: t14 has no subagents, so there is no baseline, and an unmeasured second hook breaks scorecard-first. Own plan when a task with subagents exists (O4).

## 3. Evaluation design (ON arm)

Needed because W4 is guidance.

Treatment: ON-hook = harness `--gate hook`, cap N=2, mode `violations+features` (W1 plus W4, as round 2). Task `t14-constraint-horizon`, alias `claude-haiku-4-5`, CLI 2.1.309, credentials-only config directory, fresh credentials copy and an auth probe before every id (rerun wrapper behaviour).

Design choice for the owner (O1):

- D1, ON only: 30 ON runs against the adopted rerun control (13/30 M2, 6/30 M1, 0/30 M3). Cheaper; inherits the unexplained baseline drift and the rerun's accepted deviation.
- D2, concurrent control (recommended): 30 ON and 30 C runs, interleaved in pairs, order randomised once with a seed written in the preregistration. The extra C runs are the price of not trusting a baseline that moved from 23 to 11 to 13 unexplained.

Metrics: M1, M2, M3 as in P1 (two independent recomputations); per-feature results; blocks per turn and run; cap-exhausted runs; fail-open events; duration, turns, cost.

Sample size and power: 30 per arm detects the expected benefit (control M3 0/30, round-2 gate 26/29). For the trade check, exact power (two-sided Fisher, alpha 0.05, control true rate 13/30, ON lower) is 15.24% at a 15-point drop, 66.37% at 30 points and 96.73% at 40 points (acceptance review's figures; recomputed here, same result). A non-significant trade check means "no drop detected", never "no loss"; claiming no loss needs a preregistered non-inferiority margin and sample size, which this plan lacks.

Planned thresholds (planned values, not evidence; the preregistration commit fixes them):

- Primary: M3_ON >= 20/30 and one-sided Fisher p < 0.01 against the control M3 (concurrent in D2, 0/30 in D1).
- Trade check (detects a drop only, see power above): no M2 drop detected (two-sided Fisher p > 0.05 or M2_ON not lower), and M1_ON >= 25/30.
- Instrument health: hook errors (fail-open on verifier error) in at most 2 of 30 runs; no run with more than N blocks in one turn; every ON run has a hook log whose call count equals the trace's executed-hook count.
- Labels: PASS (all gating thresholds), FAIL-TRADE (primary met, trade check failed), FAIL (primary missed), U (not valid). PASS permits documenting an evaluated opt-in, not a default.

Cost, derived from the P1 rerun (0.524 USD per run mean, sample sd 0.1534; probe 0.0166). An ON run adds model turns per block. The per-block cost, 0.105 (0.524 / 5) to 0.15 USD (longer context), is an unverified estimate. Round 2 averaged about 1.5 retries per run. The hard maximum is 5 turns x N=2 = 10 blocks per run.

| Scenario | ON per run | 30 ON runs (with probes) | D2 total (adds C 16.2) |
|---|---|---|---|
| Lower (no block fires) | 0.52 | 16.1 | 32 |
| Central (1.5 blocks, 0.105 each) | 0.70 | 21.5 | 38 |
| Upper, plausible (6 blocks, 0.15) | 1.40 | 42.5 | 59 |
| Hard maximum (10 blocks, 0.15) | 2.02 | 61.2 | 77.5 |

Proposed caps, counted separately from earlier spend and never raised: D1 30 USD; D2 48 USD in total, split by the preregistered order: the C arm is budgeted 17 USD (30 runs at 0.524 plus probes, as in the rerun) and the ON arm 31 USD, each with its own running projection. Stop rule: after the first 5 ids of an arm, project mean plus 2 sample sd for its remaining ids; do not launch an id whose projection would pass that arm's cap (`STOP_COST`). Hitting a cap stops early and makes the batch U (section 3.3 of the parent plan); the owner decides on a rerun. The caps bound loss; they do not promise completion. P2-0 probes add at most 1 USD (P0 spent 0.162 for 11 sessions). Owner approval of the figures precedes launch.

Preregistration requirements, all of the P1 rerun's plus:

1. The preregistration commit precedes the first call; the wrapper verifies tracked and unmodified, and records the commit hash and time (kept).
2. The wrapper's own sha256, the hook's and the harness' sha256 go in the log header before the first call.
3. The condition-to-artifact table below is in the preregistration and implemented by the wrapper.

### 3.1 Hard requirement: every validity condition has a contemporaneous artifact

The P1 rerun could not be called valid because no artifact was written when the end-of-batch condition applied. Here each preregistered validity condition must have an artifact the wrapper writes when it applies, listed below before the first call; a condition without one is not a validity condition, and reconstruction afterwards does not count. The wrapper has `--selfcheck` (prints the table and asserts a writer exists for each row; its output is committed with the preregistration) and `--audit` (after the batch, exits non-zero if any artifact is absent or any condition fails). `--audit` is part of the verdict note; a batch is valid only if it exits 0.

| Condition | Applies | Artifact written by the wrapper |
|---|---|---|
| Each id launched exactly once, in the preregistered order | per id | `START <id> <ts>` before the call, `END <id> <ts> rc=` after; `--audit` checks order, uniqueness |
| Sequential, one window of at most 8 h | per id and end | `WINDOW_START`; elapsed in each `START`; `STOP_WINDOW` |
| Task hashes equal the preregistered listing | first call, last call, any early exit (trap) | `taskhash.pre.txt`, `taskhash.post.txt`, and a `TASKHASH_DIFF ok|fail` line |
| CLI version 2.1.309 | per id | `VERSION <id> <value>`, compared with `result.json` |
| Authentication probe passed, no expiry | per id | `PROBE_OK|PROBE_FAIL <id>`, `probes.tsv` row; `STOP_AUTH` |
| No deviation from the preregistered command | per id | `CMD <id> <sha256 of argv>`, audited against the manifest |
| Oracle score recoverable | per id, after the run | `SCORE <id> m1 m2 m3` or `SCORE_MISSING <id>` |
| At least 27 of 30 completed five turns | per id and end | `TURNS <id> n` from `result.json`; final tally line |
| Single resolved model id | per id | `MODEL <id> <value>` |
| Hook active only in ON runs, and only the gate hook | per id | hook trace (`--debug hooks --debug-file`, same flags in both arms), `HOOKCOUNT <id> trace=<n> log=<n>`; C runs 0 |
| Blocks per turn never exceed N | per id | `BLOCKMAX <id> <value>` from the hook log |
| Interleaving order as preregistered (D2) | per id | `ORDER <id> <arm>`, checked against the seeded list |
| Cost within the cap | per id | `COST <id> run probe total projected`, per arm; `STOP_COST` |
| Preregistration committed earlier | before first call | `PREREG <hash> <time>`, `merge-base --is-ancestor` result |

Also kept: no scratch path in logs; node timestamps; auth-probe stop rules; `env -u` prefix.

## 4. Negative controls (each shown red before green)

Each check ships with a mutation (a deliberately broken implementation, applied to a copy) that must fail the named assertion, shown red first and kept in the evidence note (evidence-discipline section 58); the repaired code is then green.

| ID | Check | Broken case that must be caught |
|---|---|---|
| NC1 | Hook blocks a violating repo | Planted violation, mode `violations`: one block. Mutation: hook that always allows. Fails: the block-count assertion (expect 1, got 0). |
| NC2 | Counter bound | Always-violating verifier, N=2: exactly 2 blocks, then allow. Mutation: counter code removed. Fails: the "blocks == 2" assertion (the test has its own iteration ceiling, so it ends red, not hung). |
| NC3 | Fail-open | Verifier crash, timeout, garbage JSON, missing command: allow and log `error`. Mutation: block on error. Fails: the per-case allow assertion. |
| NC4 | Turn boundary | Two turns in one session: the second starts at counter 0. Mutation: counter never reset. Fails: the second turn's block assertion. |
| NC5 | Wrapper `--audit` | Truncated `invocation.log` (one `END` dropped), missing `taskhash.post.txt`, duplicated `START`. Mutation: `--audit` stubbed to exit 0. Fails: the "exit non-zero" assertion for each of the three inputs. |
| NC6 | Live gate in `-p` (2.1.309, real call) | Planted violation. Mutation: hook installed with the knob off (or pointed at a nonexistent verifier). Fails: the assertion that the transcript shows one block and the hook log one `block` record. Green: knob on, block seen; knob off, zero blocks. |
| NC7 | Harness `--gate hook` (stub runner) | Planted violation. Mutation: `--gate hook` parsed but the hook not installed in the temp repo. Fails: the assertions that `gate.jsonl` and the hook log exist with one block; with `--gate off` neither may exist. |
| NC8 | Task integrity | Dry run that edits a task file mid-batch. Mutation: wrapper without the post-batch listing. Fails: the `TASKHASH_DIFF fail` assertion and the `--audit` non-zero assertion. |
| NC9 | Feature-only case | Fixture with exit 0 and non-empty `feature_gaps`. Mode `violations`: allow (`clean`). Mode `violations+features`: one block with the gap text. Mutation: both modes treat gaps as not reportable. Fails: the `violations+features` block assertion (also needed for W4 only). |

## 5. Phases and done-conditions

| Phase | Content | Done when |
|---|---|---|
| P2-0 Probe (about 1 USD, needs O5) | On 2.1.309: (a) multi-turn `--resume` session with a counting Stop hook: `stop_hook_active` on the first Stop of each turn, session id stable across resume; (b) hook loaded under `--setting-sources project`; (c) hook with the five plugin Stop hooks loaded; (d) verifier wall time on a t14 repo. Expected readings committed first; NC6 (red with knob off, then green) is part of this probe | Each of (a) to (d) and NC6 is `produced` or `unproduced` with a reason; the turn-boundary rule and the coexistence rule are written down; any contradiction with section 2.1 goes back to plan review |
| P2-1 Mechanism | W1, W2, W3 with tests NC1 to NC4 and the `violations` half of NC9, opt-in manifest, config key and docs, inventory entries; text pass-through only; W4 (mode `violations+features`, NC9 second half) is its own later commit, gated by P2-4 | Tests green on the final tree, each NC seen red first; affected-suites green; one commit per ruling |
| P2-2 Instrument | W5 (`--gate hook`), wrapper v2 with `--selfcheck` and `--audit`; NC5, NC7, NC8 (each red then green); preregistration note including thresholds, order seed, cost cap and the table in 3.1 | Wrapper `--selfcheck` output and NC5 red/green committed; preregistration committed before any measured call; owner approves the cost (O1, O2) |
| P2-3 Batch | The 30 (D1) or 30+30 (D2) runs | `--audit` exit code and the artifact files committed with sums; raw logs stay in scratch |
| P2-4 Verdict | Label PASS, FAIL-TRADE, FAIL or U; W4 text ships only on PASS; docs name what was and was not measured; recommendation to the owner | Verdict note and its recomputation by two independent methods; backlog row updated and archived after merge |

A U batch may be rerun whole only by owner decision and a fresh preregistration.

## 6. Risks and stop conditions

- Treatment drift: a PASS covers this hook on this task, not the round-2 gate.
- One task, one alias, one CLI pin (checked per id); a pin change goes to the owner.
- The hook traps a session (counter or turn rule wrong). Mitigations: fail-open, N cap, NC2, NC4, P2-0. An NC that cannot go red-then-green, or an undetectable turn boundary, returns to plan review.
- Several Stop hooks disagree (P2-0 (c)), or verifier wall time exceeds the hook timeout: BLOCKED, not worked around.
- Authentication expiry mid-batch: STOP_AUTH, batch U.
- W5 touches only `run-orchestration-eval.sh` and tests; the task directory and its hashes stay untouched (NC8).

## 7. Decisions for the owner

- O1: D1 (ON only, cap 30 USD) or D2 (concurrent control, cap 48 USD, recommended).
- O2: the cost table in section 3 (hard maximum 61.2 for D1, 77.5 for D2) and the caps, which bound loss and make a capped batch U.
- O3: thresholds and n=30, given the power figures (15.24% at a 15-point M2 drop); or a preregistered non-inferiority margin with its own sample size.
- O4: SubagentStop (C1) deferred.
- O5: approve P2-0 (at most 1 USD).
- O6: ship the hook opt-in, default off, at 3.0.0, no CHANGELOG entry until the owner's release call.
- O7: a larger-model rerun stays out of this plan.

## Review log

R0 (2026-10-24): authored, lane ptgplan. R1: acceptance round 1 fixes.
