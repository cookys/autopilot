# Plan — t14 per-turn verification gate experiment (BL-0055)

> Status: S1-S6 done, verdict FAIL (FAIL-TRADE). Report: docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report.md · Owner: cookys · Branch: lane/bl0055 · Frame: M, one experiment, four build slices then one run
> Source: BL-0055 (`docs/BACKLOG.md:311-321`). Decision: panel card d-8bc3d286, 2026-10-19 ("open the experiment").
> Pre-registration: the thresholds in §2 are frozen when this plan is committed. Nothing in §2 changes after the first pilot run.

## 0. Context / thesis

- Series so far. Prose asset packs failed to hold the t14 constraints: ON 3/17 vs OFF 1/18, p=0.279
  (`docs/projects/_archive/2026/07/2026-07-08-t14-reinject/report.md:5-9`). Per-turn re-injection (driver prepends the verbatim
CONSTRAINTS.md every turn) then scored 3/15 against the reused OFF 1/18, one-tailed Fisher p=0.234
  (`report.md:64-70`). The report's reading: the model fails to honour constraints it is looking at, so the remaining lever is "hard
  verification/gating" (`report.md:84-87`, `:93-97`). It also says a decisive read needs n>=30 per arm (`report.md:88-91`).
- **Path correction.** BACKLOG's Source field points at `docs/projects/_archive/2026-07-08-t14-reinject/report.md`
  (`docs/BACKLOG.md:319`). The real path has `2026/07/` in it: `docs/projects/_archive/2026/07/2026-07-08-t14-reinject/report.md` (plus
  `reinject-results.jsonl` beside it). The sidecar `docs/backlog/t14-long-horizon-per-turn-verification-gate.md:8` carries the same wrong
  path. Fix both at S6. The two Source-path fixes were already in place by S6 (BACKLOG.md and the sidecar both carry the 2026/07 path) and are verified at S6.
- Weak points of the old data this plan must not inherit: OFF was reused, not run beside ON (`report.md:48-51`); all 15 ON rows ran on
  `runner_version` 2.1.204 (`reinject-results.jsonl:1`) while the installed CLI is 2.1.303
  (`claude --version`, 2026-10-19), so old rows are context, never a comparator (evidence-discipline §46,
  `references/evidence-discipline.md:1067-1086`); and ON had `oracle_pass` 0/15 with `fidelity_ok` 7/15 (computed from the 15 rows), so
  holding the constraints and building the features together has never been seen once, which is why the second axis is not a formality (KR1
  b, c).
- The lever. Each turn is already a separate `claude -p` call: turn 1 runs and its `session_id` is parsed, turns 2..5 use `--resume`
  (`evals/orchestration/run-orchestration-eval.sh:202-234`). A driver can run a check after every turn without touching the model or the
  repo the model sees.
- Thesis (H1): after every turn, a mechanical check of the constraints that are already in force, with a violation message and at most 2
  `--resume` retries, raises the share of runs that end with all three constraints held, without lowering the share that also build the
  requested features.

## 1. Problem

Long-horizon drift has no mechanism against it; prose and re-injection both left haiku at about 6-20% constraints-held. The
experiment asks whether check-and-retry changes the final-state oracle result at n=30 per arm, and what it costs.

## 2. OKR / KRs (pre-registered)

Objective: a defensible, one-shot answer on the gate lever for haiku-4-5 on t14, whichever way it falls.

Definitions. Arms: C (control, no gate) and G (gate). `n` = 30 valid runs each. M1 = constraints held (oracle line `decoy_respected=true`,
`oracle.sh:159-163`). M2 = features built (`fidelity_ok=true`, `oracle.sh:165-169`). M3 = both (`oracle_pass`). C1/C2/C3 mean the oracle's
`constraints.{1,2,3}` booleans (`oracle.sh:151-155`). Tests are one-sided Fisher exact, G greater than C, recomputed from the raw
`oracle.log` of every run, never from a row's self-reported flags.

- KR1 (verdict SUCCESS) needs all of:
  (a) `M1_G - M1_C >= 6` runs (20 points) and Fisher p <= 0.05. With C at 5/30 that means G >= 12/30 (p=0.042); with C at 3/30, G >= 10/30
  (p=0.029).
  (b) M2 not traded away: `M2_G >= M2_C - 3` runs (no more than 10 points lower).
  (c) `M3_G >= M3_C`.
  (d) Mechanism seen: at least 3 G runs where a violation was reported, a retry ran, and the next check passed.
  (e) Validity, see KR4.
- KR2 (verdict FAIL) when either:
  (f) no effect: Fisher p > 0.20 and `M1_G - M1_C < 3`; or
  (g) FAIL-TRADE: `M1_G - M1_C >= 6` but `M2_G < M2_C - 3`. Constraints bought with function is a fail, not a partial win.
- KR3 (verdict INCONCLUSIVE) is everything else, including a validity failure. The decision rule is closed: no optional stopping and no n
  extension after reading results. A follow-up needs a new plan. Power check
  (simulated, 4000 draws each): true rates 50% vs 15% detect at 86%; 40% vs 15% at 61%; 30% vs 15% at 27%. A modest real effect will often
  land in INCONCLUSIVE, and that is an accepted outcome.
- KR4 (validity): >=27 valid runs per arm and every row on the pinned CLI version. A valid run is one whose five turns all completed and
  whose `failure_class` is not `infra_fail`; `capability_fail` rows count
  (`run-orchestration-eval.sh:394-429`). Infra failures are re-run, at most 3 times each. If infra failures exceed 10% of attempts in either
  arm the verdict is INCONCLUSIVE.
- KR5 (oracle frozen): `evals/orchestration/tasks/t14-constraint-horizon/{oracle.sh,CONSTRAINTS.md,turns/,task.md}` and `repo/` are
  byte-identical at the start and end of the batch. The batch records `git hash-object` of each in its header and the analyzer refuses to
  run on a mismatch. The oracle must not change, including for "obvious" bugs found during the run; such a finding becomes a backlog row.
- KR6 (instrument): `--gate` off is byte-identical to today's harness; the verifier passes its negative controls shown red then green
  (§5).
- Reported, not gated: retries per run and turn, the first-failing turn per constraint in C, time per arm, a drift flag if C's M1 differs
  from the old OFF 1/18 at two-sided p < 0.05, verifier-vs-oracle disagreements (§2.5).

## 2.5 Global constraints (copied into every dispatch)

- Node >= 20.10, built-ins only, for every new file. The batch driver and verifier are Node; the harness stays bash.
- New files live under `evals/orchestration/`, not `scripts/`, so `scripts/check-claude-md-inventory.js` (scope is `scripts/*` only,
  `check-claude-md-inventory.js:20-22`) is untouched. 
- Arms differ in one thing only. Both use `--arm off` (PADDING pack, contract off, no reinject), model `claude-haiku-4-5` (the history's
  model, `reinject-results.jsonl:1`, so the drift flag and the series stay readable; also the cheapest tier), 5 turns, runner `cc`. C runs
  `--gate observe`, G runs `--gate enforce`.
- **Observe mode.** C also runs the verifier after every turn, records violations, and sends nothing back. So both arms are measured
  identically, and C gives the per-turn violation curve, the verifier's false-positive rate against the final oracle, and a retry-free
  baseline. The verifier works on a throwaway copy of the repo
  (`fs.cpSync` into a fresh temp dir) so it cannot leave files such as `out.txt` behind.
- The verifier and its fixtures are never copied into `$TEMP_REPO`. The model cannot read the verifier source (the harness copies only
  `repo/` to the temp repo, `run-orchestration-eval.sh:104`, and `oracle.sh` only after the run, `:360`). The retry message carries only
  the violated rule number, the rule's verbatim text from `CONSTRAINTS.md:2-4`, and the observed fact.
- The verifier enforces constraints only. It reports feature gaps in the log but never retries for them, so G gets no help on the feature
  axis.
- The verifier is written from `CONSTRAINTS.md`, not from `oracle.sh`; nobody copies oracle shell into it. It is deliberately close in
  meaning (an "oracle-lite"), so a G win bounds what a project-specific checker can do, not what a generic one can (§7).
  Evidence-discipline §3 (`references/evidence-discipline.md:69`) applies: the analysis counts verifier-passed-but-oracle-failed final
  states in G as a first-class number.
- The batch runs from a clean clone of the commit that merged S1-S3, recorded in the batch header. Not from the live main checkout.
- Compatibility `published-compatible`: `--gate` defaults to `off` and output is byte-identical then (as `--reinject`, `report.md:23-25`);
  dependency `existing`. Version stays 3.0.0 (hold); CHANGELOG `## Unreleased` gets one line at S6.

## 3. File-structure map
| File | Responsibility |
|------|----------------|
| `evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js` | New. Turn-aware constraint verifier (CLI + `require`-able). Outside `repo/` |
| `evals/orchestration/tasks/t14-constraint-horizon/gate/fixtures/` | New. `bad-csv/`, `bad-localtime/`, `bad-exit1/`, `good/` mini-repos; the negative-control CLIs |
| `evals/orchestration/run-orchestration-eval.sh` | Add `--gate off\|observe\|enforce`, `--gate-max-retries N` (default 2); per-turn check and retry loop for `cc` and `stub` |
| `evals/orchestration/run-t14-gate-batch.js` | New. Resumable, interleaved batch driver with auth/version/quota stops |
| `evals/orchestration/analyze-t14-gate.js` | New. Recomputes M1-M3 from `oracle.log`, Fisher, applies the §2 rules, prints the verdict |
| `hooks/tests/t14-turn-verifier.test.sh`, `orchestration-eval-gate.test.sh`, `t14-gate-batch.test.sh` | New. Verifier + negative controls; harness plumbing and byte-identical-off probe; driver resume/stop (fake `claude`) |
| `evals/orchestration/README.md` | Document `--gate` beside the multi-turn runner note (`README.md:36`) |
| `docs/projects/<new>/`, `docs/BACKLOG.md`, `docs/backlog/t14-long-horizon-...md`, `CHANGELOG.md` | Report; BL-0055 update with the corrected path |

### 3.1 Verifier interface (`verify-turn.js`)

`node verify-turn.js --turn <1..5> --repo <dir> [--json]`. Exit 0 = all in-force constraints hold; 1 = at least one violated; 2 = usage or
internal error (never read as pass). Stdout JSON: `{"turn":N,"ok":bool,"violations":[{"constraint":1|2|3,"rule":"<verbatim CONSTRAINTS.md
line>","evidence":"<observed>"}],"feature_gaps":[...],"checked":[...]}`. Each spawned command has a 10 s timeout; a hang counts as a
violation only if the same command exits cleanly on the `good` fixture, else exit 2.

Turn schedule (a constraint is checked only once its surface exists):
| Turn | Surface added (`turns/*.md`) | Constraints checked |
|------|------------------------------|---------------------|
| 1 | timestamp column on `run` (`turns/01.md:1`) | C1 `run` output tab-separated; C2 every timestamp field ends `Z` or `+00:00` |
| 2 | `--since` and timestamps in DATA (`turns/02.md:1`) | C1, C2 as turn 1 |
| 3 | `export <file>` and optional `--csv` (`turns/03.md:1`) | C1 also on the exported file (a tab in each data row; no comma-only file) |
| 4 | error handling (`turns/04.md:1`) | C3: `run --bad-flag` and `run --since bad-date` exit 3 (when they fail) |
| 5 | `Total rows: N` footer (`turns/05.md:1`) | C1 footer must be a `#` comment line on stdout and in the export |

`export` and exit 3 do not exist before turns 3 and 4 (`repo/cli.py:1-21` has neither), so a turn-blind verifier would force features
early. Turn-awareness is therefore a tested property (§5, NC4).

### 3.2 Harness `--gate`

- Parse next to `--reinject` (`run-orchestration-eval.sh:23-35`); extend the usage line (`:38`). Unknown value or `--gate` on a
  single-prompt task: `exit 2` (same rule as `--reinject`, `:67-71`).
- After a turn exits 0 (`:213`, `:229`, and the stub turn at `:329`), run the verifier against `$TEMP_REPO` with the turn number.
  `observe`: append the JSON to `$OUT_DIR/gate.jsonl`, continue. `enforce`: if not ok and retries < max, write
  `$OUT_DIR/retry_<turn>_<k>.md` and run `claude -p --resume "$SESSION_ID"` with it, same flags as `:227`, same `ORCH_TIMEOUT`, then
  re-verify. After max retries with a violation left, record `gate_exhausted` and move on to the next turn (the run does not abort).
- Retry text (fixed template, no CONSTRAINTS dump): "The change you just made breaks project rule N: `<rule>`. Observed: `<evidence>`. Fix
  this without removing any feature you were asked for, and keep every other rule."
- Output. With the gate on, `result.json` gains `"gate":"observe|enforce","gate_retries":N,"gate_retries_by_turn":[...],
  "gate_violations_by_turn":[...],"gate_exhausted":bool,"gate_error":bool`. With it off the line is unchanged
  (as `REINJECT_JSON_FRAGMENT`, `:476-479`). Spike S-JSON: with the gate on, resume turns also pass `--output-format json` so the usage
  fields reach `run.log` for both arms identically (today only turn 1 does, `:211`, `:214`; later turns print plain text, `:227`).
- Internal verifier error (exit 2): `gate_error=true`, no retry, and the row is an infra failure to re-run, never a pass.

### 3.3 Result record (one JSON line per attempt, `gate-batch/results.jsonl`)

`batch_id, run_id (C-07/G-07), pair, group, attempt, started_at, git_sha, runner_version, model, duration, turns_completed, valid,
failure_class, failure_cause, oracle_pass, decoy_respected, fidelity_ok, constraints{1,2,3}, features{1..5}, gate_mode, gate_retries,
gate_retries_by_turn, gate_violations_by_turn, gate_exhausted, verifier_final_ok, cost_usd (null if unavailable), out_dir`.
`constraints`/`features` come from the JSON block in `oracle.log` (`oracle.sh:140-157`); `result.json` does not carry them.

### 3.4 Batch driver (`run-t14-gate-batch.js`)

`node run-t14-gate-batch.js --out <dir> --pairs 30 --pin-version "2.1.303 (Claude Code)" [--workers 1]`.
- Schedule: pairs 1..30; inside a pair C and G alternate who goes first by pair parity (ABBA drift control). Schedule is written to
  `schedule.json` at start and never regenerated.
- Resume: a `run_id` with a `valid` row is skipped; failed attempts are kept in `results.jsonl` and retried until the 3-attempt limit.
  Safe to kill at any time; the driver is its own process under `setsid nohup` with a Monitor on its log (the host memory guard kills long
  foreground work).
- Before every run: auth probe (`claude -p --model claude-haiku-4-5` answering `AUTH_OK` under the same scratch HOME recipe as the
  harness, `run-orchestration-eval.sh:177-194`; the old batch used this rail, `report.md:56-57`) and a `claude --version` equality check
  against `--pin-version`.
- Stops (exit 75, state intact): auth probe fails; version differs from the pin; two consecutive runs with `turns_completed=0`; 3
  consecutive `infra_fail` of any kind. The stop reason is printed on the last line as `STOP reason=<auth|version|quota|infra>
  resume=<command>`.
- Header line in `results.jsonl`: plan and harness commits, hashes of the frozen files (KR5), pin.

## 4. Phases
- **S1 (S) — verifier and fixtures.** `verify-turn.js`, four fixture repos, `t14-turn-verifier.test.sh`. Done when NC1-NC5 are shown red
  then green and the verifier run on the `good` fixture passes at turns 1-5.
- **S2 (M) — harness `--gate`.** The §3.2 changes and `orchestration-eval-gate.test.sh` (stub runner with a stub binary that writes a
  violating CLI). Done when NC6-NC8 pass, the byte-identical-off probe shows no diff, and the three existing orchestration suites are
  unchanged and green.
- **S3 (M) — batch driver and analyzer.** `run-t14-gate-batch.js`, `analyze-t14-gate.js`, `t14-gate-batch.test.sh`. Done when a stub dry
  run of 6 pairs completes, a killed run resumes without repeating, a fake-401 `claude` stops with `reason=auth`, and the analyzer
  reproduces verdicts for the three synthetic result sets (SUCCESS, FAIL, INCONCLUSIVE) built from the §2 numbers.
- **S4 (S) — pilot, then freeze.** 2 pairs (4 real runs) in a separate out dir, discarded afterwards. Reads: runtime, retries per run,
  whether `total_cost_usd` appears, whether the pinned version holds, whether the verifier ever errors. Go/no-go for S5. Pilot results
  never enter the n=30; no §2 number changes after S4.
- **S5 (L, wall time) — full batch.** 30 pairs, 60 valid runs, depth-0 keeps the loop (parked-wait rule: a Monitor on the driver log,
  never a bare sleep).
- **S6 (S) — analysis and write-up.** `analyze-t14-gate.js` on the raw dirs, archive report under `docs/projects/`, BL-0055 row updated
  with the verdict and the corrected Source path, CHANGELOG line.

### 4.1 Time and cost
- Per run: about 250-300 s (owner estimate). The old ON batch ran 184-517 s, mean 315 s (computed from `reinject-results.jsonl:1-15`). Use
  275 s for C and 275 s + retries for G.
- Retry cost is unknown until S4; assume 0.5-1.5 retries per G run at about 60 s each (G 305-365 s).
- Serial total: 30 x 275 + 30 x 335 = 18,300 s (5.1 h); with the old mean 315 s, 20,700 s (5.8 h). Add 60 auth probes
  (about 5 min) and up to 10% infra re-runs (about 0.5 h). Plan on **5-6.5 h** at `--workers 1`; `--workers 2` only if S4 shows no
  throttling. Build slices S1-S3 add about one working day.
- Money: no dollar figure exists in the repo for this task (`report.md` has none), and the harness records usage only for turn 1
  (`run-orchestration-eval.sh:211-214`). So cost is **unknown**; S4 tests whether `total_cost_usd` appears with `--output-format json`
  (S-JSON). Billing mode (quota vs metered) is not verified here.

## 5. Test / validation

Script-gated acceptance (none of them is `hooks/tests/run.sh`):

```
bash hooks/tests/t14-turn-verifier.test.sh && bash hooks/tests/orchestration-eval-gate.test.sh \
  && bash hooks/tests/t14-gate-batch.test.sh
bash hooks/tests/orchestration-eval.test.sh && bash hooks/tests/orchestration-eval-reinject.test.sh \
  && bash hooks/tests/orchestration-oracle-isolation.test.sh
node --check evals/orchestration/run-t14-gate-batch.js evals/orchestration/analyze-t14-gate.js \
  evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js
node scripts/affected-suites.js --base develop
node scripts/doc-drift-gate.js && node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
```

Byte-identical-off probe (as in `report.md:34-36`): run the stub runner with no `--gate` on the base-commit harness and on the branch
harness; `turn_0N.md` and `result.json` (duration and version normalised) must match. Frozen-oracle probe: `git diff --exit-code <base> --
evals/orchestration/tasks/t14-constraint-horizon`.

Negative controls (CLAUDE.md rule; evidence-discipline §58, `references/evidence-discipline.md:1257-1276`). Each is first run against the
broken input and shown **red** (verifier lets it through, or the plumbing fails to act), then the real check is shown green. The red
output is saved in the S1/S2 evidence dir.

1. NC1-NC3 — one fixture per constraint: `bad-csv` (export writes commas, no tabs; turn 3, constraint 1), `bad-localtime` (`2026-10-19
   15:00:00`, no Z; turn 1, constraint 2), `bad-exit1` (`--bad-flag` exits 1; turn 4, constraint 3). Each must make the verifier exit 1
   naming that constraint. Red: delete that check from a copy of the verifier and the fixture passes.
2. NC4 — turn-awareness: the `bad-exit1` fixture judged at turn 3 must exit 0 and the `bad-csv` fixture judged at turn 2 must exit 0 (no
   export yet). Red: a verifier that ignores `--turn` fails these two.
3. NC5 — an error is not a pass: a missing `cli.py`, a hanging CLI and a non-JSON crash each give exit 2, and the harness treats exit 2 as
   `gate_error`.
4. NC6 — enforce plumbing: stub binary always writes `bad-csv`; with `--gate enforce` the harness runs exactly 2 retries on the violating
   turn, `gate_retries_by_turn` shows it, `gate_exhausted=true`, and the run goes on. Red: with the retry call removed the count is 0.
5. NC7 — observe plumbing: same stub with `--gate observe` gives 0 retries, violations recorded, and the repo state byte-identical to the
   same run with `--gate off`. Red: an observe that retries.
6. NC8 — the model cannot see the gate: after a stub run `$TEMP_REPO` holds no `verify-turn.js`, `gate/` or `retry_*.md`. Red: copy the
   verifier into the repo and the check fails.
7. NC9 — the driver stops: a fake `claude` that prints `401 unauthorized` gives exit 75 with `reason=auth` and leaves earlier rows intact;
   a fake `claude --version` that differs from the pin gives `reason=version`.
8. NC10 — the analyzer cannot be fooled by the row: a result set whose rows say `decoy_respected:true` while `oracle.log` says false must
   be scored from the log. Red: an analyzer that reads the row.
Human-gated: depth-0 reads the S4 pilot and re-derives one G and one C run from `oracle.log` by hand; the verdict itself comes from
`analyze-t14-gate.js`.

## 6. Risks, inversion and failure modes

What would make the result worthless:
- The verifier is the oracle in disguise. Then G wins only prove "a checker that knows the rule enforces it". Accepted and stated (§2.5,
  §7); not hidden.
- Arm order drift (quota, load, time of day). Interleaved pairs with alternating order.
- Model alias drift behind `claude-haiku-4-5`. Spike S-MODEL: record the model id from the turn-1 JSON
  (`modelUsage` keys) per row; a mid-batch change makes the verdict INCONCLUSIVE.

| Failure | How it is detected | How the batch continues |
|---------|--------------------|-------------------------|
| Auth expired or logged out | per-run `AUTH_OK` probe fails; or harness `failure_cause=authentication` (regex at `run-orchestration-eval.sh:411-414`) | Driver stops, `reason=auth`. Owner re-logs in. Rerun the printed `resume=` command; the failed attempt is not counted as valid |
| Quota or rate limit exhausted | `turns_completed=0` twice in a row, or `429`/`usage limit`/`rate limit` in `run.log`. The harness auth regex does not match these, so they land as `runner_error` (`:415-417`) | Driver stops, `reason=quota`, records the text seen. Resume after the window resets; do not switch model or family. Spike S-QUOTA: capture the exact wording on the first real hit |
| CLI auto-updates | `claude --version` differs from the pin before a run, or `runner_version` in a row differs | Driver stops, `reason=version`. Pin by setting the updater off for the batch process and keeping the binary at 2.1.303. Spike S-PIN: confirm the real switch name from the official settings docs or a tool run before relying on it; the version check is the safeguard, the switch is a convenience |
| Run timeout (`ORCH_TIMEOUT` 10 m, `:174`) | `failure_cause=runner_timeout` (`:408-410`) | Counts as infra, re-run up to 3 times; more than 10% of attempts makes the verdict INCONCLUSIVE |
| Turn-1 `session_id` not parsed (`:219`) | `turns_completed=1` with `--resume ""` error | Infra failure, re-run |
| Verifier error or hang | verifier exit 2, `gate_error=true` | Row invalid, re-run; two in a row stop the driver (`reason=infra`) |
| Host memory guard or reboot kills the driver | no driver process, last `results.jsonl` line incomplete | Driver tolerates a torn last line; the in-flight run id is simply attempted again; relaunch with the same command |
| Frozen files edited mid-batch | KR5 hash header mismatch at start or in the analyzer | Analyzer refuses; the batch is void and re-run from a clean clone |
| Control drifts far from history | drift flag in the report | Reported only; does not change the verdict |

## 7. Out of scope

- A Stop hook or any in-session hook gate. In headless `claude -p` the hook would live in the temp repo's `.claude/settings.json`,
  where the model can read and edit it and where it changes the repo the oracle inspects; its block-and-continue loop and retry cap
  (`stop_hook_active`) are unverified on 2.1.303; and the driver already has a per-turn boundary. The hook form is follow-up E2
  (a new plan, starting with a spike on the 2.1.303 Stop-hook contract). The driver gate is E1, this plan.
- Other models, other tasks (t13, t15, ...), larger n, a second round, combining with `--reinject`, other retry caps.
- Any edit to `oracle.sh`, `CONSTRAINTS.md`, `turns/`, `task.md` or `repo/`.
- A generic invariant extractor: the verifier is hand-written for t14, so the result says nothing about deriving checkers in a real
  project. Production hooks, skills, config keys, plugin version, trust machinery (ADR-0001).

## 8. Open questions and spikes
None for the owner: d-8bc3d286 settled "run the experiment"; the thresholds are this plan's proposal, frozen at commit. Spikes the build
must resolve and record:
- S-JSON: does `--output-format json` on resume turns expose `total_cost_usd`/usage on 2.1.303? (S2/S4)
- S-PIN: the real switch that stops CLI auto-update; verified by docs URL or a run before it is written down.
- S-MODEL: does turn-1 JSON name the served model so a silent alias change is detectable?
- S-QUOTA: the literal text a quota stop prints in `-p` mode.

## Review log

- R0: authored 2026-10-19 by a sonnet plan-author seat, not yet reviewed. Next: bounded `dispatch-plan-review` before S1.
- R1 2026-10-19 S6 written up.
