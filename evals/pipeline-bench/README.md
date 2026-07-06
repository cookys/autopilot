# Pipeline Benchmark Harness

This harness measures the core autopilot question: same model + same task, **bare single-shot** vs **full pipeline** (implementation → decorrelated review loop → L0 gates → repair).

## Overview

- **bare arm**: A single-shot execution of the task.
- **pipeline arm**: An iterative pipeline that incorporates `secret-scan-diff.js` and `error-path-scan.sh` L0 gates, and a decorrelated review loop (via `dispatch-review.sh`) up to a specified number of repair rounds.

Outputs are recorded in a single JSON line to `result.json` summarizing performance (speed, oracle pass, verification metrics, tokens used).

## Usage

```bash
run-pipeline-bench.sh --task <task-id> --arm bare|pipeline --model <m> --out <dir> \
    [--reviewer-model gpt-5.5] [--reviewer-runner codex] [--max-rounds 3] [--shim]
```
