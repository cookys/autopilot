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
    [--reviewer-model gpt-5.5] [--reviewer-runner codex] [--max-rounds 3] [--shim]
```

Exit codes:
- `0`: The pipeline ran to scoring, regardless of the oracle outcome.
- `2`: Precondition or usage error.
