# Pipeline Benchmark Harness

This harness measures the core autopilot question: same model + same task, **bare single-shot** vs **full pipeline** (implementation → decorrelated review loop → L0 gates → repair) vs **verify-first** (objective verification before entering review).

## Overview

- **bare arm**: A single-shot execution of the task.
- **pipeline arm**: An iterative pipeline that incorporates `secret-scan-diff.js` and `error-path-scan.sh` L0 gates, and a decorrelated review loop (via `dispatch-review.sh`) up to a specified number of repair rounds.
- **verify-first arm**: A single-shot execution followed by the task oracle; only failures enter the same pipeline review/repair loop, with oracle checks after repairs.

Outputs are recorded in a single JSON line to `result.json` summarizing performance (speed, oracle pass, verification metrics, tokens used).

Honesty note: in this benchmark the verify command is the oracle, so verification is perfect.
Real projects have imperfect tests and checks.
The verify-first arm measures the upper bound of verification-anchored control flow.

## Usage

```bash
run-pipeline-bench.sh --task <task-id> --arm bare|pipeline|verify-first --model <m> --out <dir> \
    [--reviewer-model gpt-5.5] [--reviewer-runner codex] [--verify-script <path>] [--max-rounds 3] [--shim]
```

## Imperfect verification (escape-rate) mode

Use `--arm verify-first --verify-script <path>` to run `bash <path> <workdir>` as the in-loop verifier instead of the task oracle.
The final `oracle.log` and `oracle_pass` still always come from the true task oracle.
`result.json` adds `verify_script` and `verification_escape`.
An escape means verify-first converged by in-loop verification, but the final true oracle failed.
This measures what verify-first would have shipped under an imperfect verifier.

Exit codes:
- `0`: The pipeline ran to scoring, regardless of the oracle outcome.
- `2`: Precondition or usage error.
