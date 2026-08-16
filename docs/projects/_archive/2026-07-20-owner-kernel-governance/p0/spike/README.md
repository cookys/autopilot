# P0 three-task spike

This directory contains P0 measurement evidence, not P1 product code. Each task treats the model
output as untrusted JSON, binds its exact hash into a supervised broker descriptor, and writes the
protected result only through the rootless `supervised-partial` profile.

The current hardened run is [`evidence-2026-07-23-hardened-r2/`](evidence-2026-07-23-hardened-r2/):

| Task | Author family | Independent reviewer family | Outcome |
|---|---|---|---|
| `low-status` | Grok | MiniMax | accepted |
| `medium-boundary` | MiniMax | GLM | accepted |
| `medium-resume` | GLM | Grok | accepted after separate-process resume |

The frozen legacy denominator is six mandatory review dispatches. The spike uses one independent
challenge per task, so the candidate count is three and the reduction is 50%. The summary and
receipt-linked event ledger are under `evidence-2026-07-23-hardened-r2/run/`.

Reproduce structural verification without model spend:

```bash
node ../fixtures/supervised-three-task-spike.js verify \
  --workspace evidence-2026-07-23-hardened-r2/run
```

`task-specs.json` is the trusted P0 input contract. The `resume` command reconstructs state from the
durable ledger and artifact store without the original prompt or author source directory, then verifies
a fresh external HMAC-bound operator approval for the exact task, descriptor, and current ledger head.
The test fails closed on missing, forged, in-workspace, symlinked, or weakly protected approval/key
inputs; it also rejects same-family review, negative verdict, profile receipt tamper, and ledger tamper.
