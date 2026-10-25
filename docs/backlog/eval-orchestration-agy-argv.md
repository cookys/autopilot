# eval harness --runner agy still passes the prompt as argv

BL-0302. `evals/orchestration/run-orchestration-eval.sh` `--runner agy` (around the `AGY_PROMPT` block) sends the prompt as an argv argument. BL-0298 left it alone on purpose: the P2-3 preregistration pins this file's hash. Move it to `scripts/lib/agy-stream-json.js` only after every BL-0055 P2 batch has run. Mechanism-class consistency change; touching it earlier would invalidate the registered hash.
