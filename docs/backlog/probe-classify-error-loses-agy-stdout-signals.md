# Capability probe classifies errors from a merged stderr file after agy-stream-json

BL-0314. `scripts/probe-engine-capability.sh` `classify-error` reads the merged 2>&1 file. Once agy output goes through `agy-stream-json`, the quota or authentication wording that agy prints on stdout no longer reaches that file, so the classification degrades (same class as BL-0298). Minor cases of the same class: the `AGY_OUT` rescue in `dispatch-review.sh` and `OUT_FILE` in `cleanroom-launch.sh`. Found as bltidy14 candidate (1), 2026-10-26.
