# Orchestration-Eval Harness

This directory contains the orchestration evaluation harness designed to measure the impact of the quality-floor assets on a mid-tier orchestrator's outcome quality.

## Method

The harness runs evaluation tasks under two experimental arms:
1. **ON**: The orchestrator is prompted with the task description, the quality-floor assets (`ASSETS.md`), and the required-artifacts contract.
2. **OFF**: The orchestrator is prompted with the task description, neutral padding prose (`PADDING.md`) matched to the length of the assets, and the same required-artifacts contract.

By comparing the results of the two arms, we can measure the lift in outcome quality and protocol adherence due to the quality-floor assets.

### Layout
- `tasks/`: Directory containing synthetic evaluation tasks.
  - `t1-fix-with-decoy/`: Real planted bug + decoy function claimed to be broken by a false finding in `REVIEW-NOTES.md`.
  - `t2-extract-verbatim/`: Heredoc block extraction task.
- `packs/`: Directory containing prompt packs for the arms.
  - `on/ASSETS.md`: The quality-floor assets (playbook and pattern excerpts).
  - `off/PADDING.md`: Neutral generic software-engineering prose.
- `run-orchestration-eval.sh`: Runner script to execute an evaluation run.
- `score.js`: Scoring script to aggregate results and output outcomes.

## Honesty Rails

To guarantee the validity and integrity of the evaluation, we adhere to the following honesty rails:
- **Same oracle both arms**: The evaluation oracle (`oracle.sh`) is identical for both the ON and OFF arms, and it never mentions asset vocabulary.
- **OFF-arm padding length-matched**: The neutral prose in `PADDING.md` is matched within ±10% of the token/word length of `ASSETS.md` to control for the context length confound.
- **Arm isolation**: Arms run as separate processes with separate scratch `HOME` directories to prevent any state or plugin leak.
- **Pilot size warning**: The pilot task size (n=2) is tiny. The report explicitly warns: "pipeline validation, NOT evidence of lift". The statistical campaign is a separate operator decision.
- **Moving tools control**: The runner, model, and tool versions are recorded per run to prevent moving-tools invalidators.

## Multi-turn mode

Tasks can specify a `turns/` directory containing sequential prompts (`01.md`, `02.md`, ...) instead of a single prompt. This measures long-horizon drift, evaluating if an agent can sustain constraints across multiple interventions.
- **Contract**: By default, no external hints or re-injections occur between turns — the oracle evaluates the final state against invariants, measuring pure long-horizon drift.
- **Runners**: Supported by `cc` (via `--resume` capturing the session ID from turn 1) and `stub` (by concatenating). The `agy` runner does not support multi-turn execution.
- **Limits**: Only `cc` supports true session resumption. Note that multi-turn requires N invocations, increasing total cost by roughly N×.
- **Opt-in per-turn gate (`--gate off|observe|enforce`)**: after every successful turn, `observe` and `enforce` run `tasks/<id>/gate/verify-turn.js` against the temp repo (the verifier stays outside that repo). `observe` appends each JSON verdict to `gate.jsonl` and sends nothing back. `enforce` writes `retry_<turn>_<k>.md` (the violated rule number, its verbatim text, and the observed fact) and resumes the same session, up to `--gate-max-retries` (default 2); a violation that survives the cap sets `gate_exhausted` and the run continues. A verifier exit 2 sets `gate_error` and classifies the row as `infra_fail` with no retry. With the gate on, `result.json` gains `gate`, `gate_retries`, `gate_retries_by_turn`, `gate_violations_by_turn`, `gate_exhausted`, `gate_error`, and `gate_retry_feedback`, and resume turns pass `--output-format json`. `--gate-retry-feedback violations|violations+features` (default `violations`, and it requires `--gate`) keeps that first-experiment text when the value is `violations`: a retry fires only on verifier exit 1. `violations+features` also retries when exit is 0 and `feature_gaps` is non-empty, appending one ``A feature you were asked for so far is not working yet: `<gap>`.`` line per gap and then `Keep the parts that already work; do not delete or break any existing feature.` With no gaps the text stays the violation lines only. The same per-turn cap applies. Immediately before each retry prompt the harness copies the temp repo to `snapshot_<turn>_<k>` in the run out dir (a copy failure is logged and the run continues). The batch driver passes the value only on the enforce arm via `--retry-feedback` (default `violations+features`) and records it on the results header and each row. The flag requires a `turns/` task (unknown values and single-prompt tasks exit 2). **When the flag is omitted, or set to `off`, behavior and output stay byte-identical to before** (verified: `hooks/tests/orchestration-eval-gate.test.sh`).
- **`--gate hook` and `--hook-trace-dir <dir>` (BL-0055 phase 2, W5)**: `hook` records the verifier verdict per turn like `observe` (so `gate.jsonl` exists and resumes use `--output-format json`) and ALSO installs the opt-in `hooks/per-turn-gate.js` Stop hook into the temp repo's project settings (git-excluded, after the frozen base commit; knob on, cap 2, mode `violations+features`, verifier = the task's `verify-turn.js`). Its config and its log live under `<out>/hook/` (`config.json`, `live/per-turn-gate/<session>.jsonl`). `off`, `observe` and `enforce` install nothing. `--hook-trace-dir` is independent of `--gate`: every `claude` call gets `--debug hooks --debug-file <dir>/trace-turn<N>.log`, so a control arm carries the very same flags (the stub runner gets the path as `ORCH_STUB_TRACE_FILE`). The batch wrapper for phase 2 is `run-p2-batch.js`. Tested by `hooks/tests/orchestration-eval-hook.test.sh` (NC7).
- **Opt-in per-turn re-injection (`--reinject <relpath>`)**: mechanically prepends a `CONSTRAINTS REMINDER` block containing the verbatim content of `<task>/repo/<relpath>` to EVERY composed turn prompt (turn 1..N), instead of relying on turn 1 having stated the rules once. `<relpath>` is resolved against the task's frozen source repo. This is the instrument for testing whether mechanical re-statement beats prose-once against long-horizon constraint drift. Requires a `turns/` task (errors `exit 2` on a single-prompt task). Multi-turn `result.json` gains a `"reinject":"<relpath>"` key ONLY when the flag is set; **when the flag is omitted, all behavior and output are byte-identical to before** (verified: `hooks/tests/orchestration-eval-reinject.test.sh`).

## Task provenance (why these are fair)

| Task | Everyday Scenario | Real Incident Class |
| :--- | :--- | :--- |
| `t1-fix-with-decoy` | Addressing code review findings while avoiding changing correct decoy code | review fatigue / modifying correct files due to false review reports |
| `t2-extract-verbatim` | Extracting an embedded Python script from a bash heredoc to its own file | regression/drift from manual extraction of inline scripts |
| `t3-vacuous-test` | Fixing a logic bug and correcting a test suite that was passing vacuously | silent test suite regressions due to faulty assertions or mock behavior |
| `t4-config-layer` | Resolving precedence between defaults, overrides, and environment variables | configuration layering bugs where values are shadowed incorrectly |
| `t5-preexisting-classification` | Fixing a regression while triaging and leaving legacy failures untouched | scope creep or unintended breakage of legacy systems during hotfixes |
| `t6-version-bump` | Bumping version strings in manifests, docs, badges, and mirror manifests | stale manifests or installation snippets mismatching on release day |
| `t7-config-rename` | Renaming a config key with backward compatibility and deprecation warnings | configuration key migrations causing service disruption to older clients |
| `t8-log-redaction` | Redacting plaintext API keys and credentials from error payloads in logs | secret leakage in application logs or exception telemetry |
| `t15-cache-invalidation` | Fixing a stale memoization cache without disabling caching | wrong cache key omits a field → stale/incorrect results; "fix" by killing the cache |
| `t16-findings-triage` | Triaging review findings against a spec, fixing real bugs while leaving correct code alone | over-fixing plausible-but-wrong review notes and regressing correct behavior |
| `t17-purity-invariant` | Extending a function while preserving its no-mutation (purity) contract | in-place mutation of caller-owned input while adding a feature |

**M3/flash-band tasks (t15–t17)** are two-axis discriminators: each scores
`fidelity_ok` (primary task) AND `decoy_respected` (a second, easy-to-trade-away
property — cache-retained / decoys-untouched / inputs-unmutated). Unlike t1–t13
(which ceiling on MiniMax-M3), a strong orchestrator that solves the primary task
can still slip the second axis, giving the discrimination gradient headroom.
Design + calibration harness: `docs/projects/_archive/2026/07/2026-07-09-m3-band-tasks/`.

### P2 batch credentials and auto-resume

`run-p2-batch.js` copies one credential file into each id's per-run home before its probe; the source is `$HOME/.claude/.credentials.json` or `--credentials-source F`. Start the wrapper with the real HOME (or point `--credentials-source` at the real file): a one-off HOME copy goes stale and every later id would copy the stale file. A source less than 10 minutes from `claudeAiOauth.expiresAt` makes the id pause (PROBE_FAIL, PAUSE, exit 7, saved response `source_token_expiring`, cost 0) without a call. `run-p2-batch-loop.js` reruns the wrapper from the paused id (`--first`) once the source is at least 30 minutes ahead, polling every 60 s, up to 20 restarts, and stops when the window is nearly used up; progress is in `<run-dir>/loop.status`. It only reads the expiry and never refreshes a token.

Stopping a batch: one Ctrl-C (TERM, INT or HUP, to the launcher or straight to the wrapper) is a safe pause. The id that is running finishes, the next id pauses before its probe (PROBE_FAIL, PAUSE, reason `operator_stop`, exit 7), the launcher writes `stopped_by_operator` to `loop.status` and exits 0, and the batch resumes later (starting the launcher or the wrapper again clears `<run-dir>/stop.request`) and still audits. A second TERM or INT in a row gives up the batch: the launcher kills the wrapper's process group at once (status `aborted`), the log has no footer and the batch cannot be audited. After a SIGKILL of the launcher the wrapper (started with `--parent-pid`) lets the running id finish and pauses the next one with reason `parent_gone`, also a legal log. The launcher checks the remaining window before the first start too (a fresh batch has no `window.start` yet, so its window is whole). Every `CLAUDE*` and `ANTHROPIC*` variable and the XDG config, data, state and cache homes are removed from every child of the wrapper and the launcher, and `claude --version` runs in a throwaway home that holds no credentials.

Sweep table (every call site and path, with the test that holds it). Suites: `p2-batch-wrapper.test.sh` (audit and schema), `p2-batch-loop.test.sh` (credential source, launcher, model, preregistrations), `p2-batch-env.test.sh` (environment, time values, ranges, worker entry), `p2-batch-lifecycle.test.sh` (signals and resume); shared setup in `lib-p2.sh`.

| Class | Instance | Handling |
|---|---|---|
| claude child environment | wrapper `claude --version` (writeVersion) | throwaway `homes/_version` (onboarding file only, no credentials), scrubbed env |
| | auth probe (writeProbe) | per-run home with the credential copy, scrubbed env |
| | harness call and the claude it starts | per-run home, scrubbed env. Inside the harness: its own `--version` runs in the per-run HOME (which holds the credential copy), turns and retries use a copy in `SCRATCH_HOME`; the harness never sees the real HOME |
| | wrapper git calls (`sh`) | same `env -u` prefix (every CLAUDE*, ANTHROPIC*, XDG home variable) |
| | audit git calls | same scrub (`env: scrubEnv(process.env)` on both `spawnSync` calls) |
| | launcher to wrapper | `scrubEnv` of the launcher's environment |
| termination | first TERM, INT or HUP to the launcher or the wrapper | safe pause: running id finishes, next id PAUSE `operator_stop`, legal log, resumable |
| | second signal | hard stop, no footer, not auditable |
| | SIGKILL of the launcher | wrapper pauses the next id (`parent_gone`), legal log, resumable |
| | SIGKILL of the wrapper, reboot | torn log, not auditable (label U) |
| | claude or the harness fails on its own | depends on what the harness reports: a non-zero harness rc gives END rc != 0 (counted by the completion rule, legal); a claude that exits non-zero but leaves a harness rc of 0 and no usable cost gives END rc=0 with `COST_INVALID`, which fails the audit (the batch is U; observed with a fake claude exiting 42, same in the base wrapper) |
| time and window | `window.start` | epoch milliseconds from the local clock, written once; must be a positive number or the wrapper aborts and the launcher stops |
| | `elapsed` (START rows, `ctx.elapsed`) | whole seconds since `window.start`, not an epoch value |
| | `window_s` | seconds; a manifest value that is not a positive number aborts the wrapper and the launcher |
| | `claudeAiOauth.expiresAt` | epoch milliseconds; seconds-valued numbers are normalised; present but 0, negative, non-numeric, null or an unreadable file counts as expired; only an absent field is not judged |
| | harness timeout | `harnessTimeoutMs(elapsed seconds, window_s)` in milliseconds, computed once after the probe and before ORDER/CMD/START; no window left after the probe pauses nothing but stops (`STOP_WINDOW`) |
| | check after the probe | the window is decided before any START artifact exists |
| | audit time cross-checks | log timestamps (ISO, UTC) against `window.start` and START `elapsed` (3 s slack), run file mtimes between START and END (strict), PREREG commit time from git before the window start |
| resume position | launcher `--first` | first id with no `runs/<id>`; the wrapper refuses a skip (previous id unfinished) and writes COSTCHK and VERSION once per id |
| | wrapper `--first`/`--last` | must be integers from 1 to 2n with first not after last, otherwise exit 2 before anything is written; absent means 1 and 2n |
| | pause, `parent_gone`, `operator_stop`, repeated resumes | each id starts once, in the seeded order (multi-pause test; a launcher that resumes one position late is refused) |
