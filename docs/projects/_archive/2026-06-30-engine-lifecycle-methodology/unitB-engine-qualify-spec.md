# Build task: scripts/engine-qualify.sh (reviewer qualification, Stage 1)

Read the full contract in docs/plans/2026-06-30-hetero-engine-lifecycle-methodology.md § "Stage 1 — Qualify" (Reviewer) and § "Stage 2 — Score".
Implement ONLY scripts/engine-qualify.sh + hooks/tests/engine-qualify.test.sh. Touch nothing else.

## GOAL
A POSIX bash script that runs the REVIEWER qualification for one engine and, on pass, emits a
scorecard row JSON (ready to pipe into `node scripts/engine-scorecard.js record`).

## SUBCOMMAND
`engine-qualify.sh reviewer --engine <id> --runner <r> --family <f> --panel-cmd '<cmd>' [--corpus evals/known-bad] [--emit-row]`
- Runs the panel over the corpus via the EXISTING `scripts/calibration.sh run-known-bad --panel-cmd '<cmd>'`
  (reuse it; do NOT reimplement corpus iteration). panel-cmd reads a diff on stdin, writes JSON {"verdict":"pass"|"fail"} to stdout.
- Compute the Stage-1 reviewer pass bar (ALL required), reading PASS/FAIL from calibration results:
  * false_pass_on_critical == 0 (hard gate)
  * sensitivity (catch rate) >= 0.90 AND >= 9/10 absolute
  * specificity: 0 false-FIX verdicts on clean diffs (>=Major)
- Output: a JSON verdict {engine,runner,role:"reviewer",qualified:bool,metrics:{...},reason}.
- With --emit-row AND qualified: also emit a scorecard row JSON with status:"qualified" (else status:"failed"),
  matching engine-scorecard.js's record schema (engine,runner,family,role,model_version,version_source:"manual",
  corpus_version,harness_version,runner_version,prompt_config_hash,date,quality{},capability_score,cost{source:"unknown",...},latency{},status,qualified_at,expires).
  capability_score = the measured Critical catch-rate. cost.source MUST be "unknown" (no cost measured here).

## ACCEPTANCE (test file MUST assert)
1. A stub panel-cmd that returns the CORRECT verdict for every corpus diff => qualified:true, exit 0.
2. A stub panel that FALSE-PASSES a critical (says "pass" on a known-bad) => qualified:false (false_pass_on_critical>0), status:"failed" with --emit-row.
3. A stub panel that misses too many (sensitivity < 0.9) => qualified:false.
4. --emit-row on a qualified run emits a row that `node scripts/engine-scorecard.js record` ACCEPTS (exit 0). [pipe it!]
5. cost.source in the emitted row is "unknown". --help works; bad args exit 2.

## BOUNDARIES
POSIX sh/bash; reuse calibration.sh (don't reimplement); no network; deterministic; documented exit codes (0/1/2).
