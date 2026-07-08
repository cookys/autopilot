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
