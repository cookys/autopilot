# P2-3 first batch: label U (unusable)

Wrapper `run-p2-batch.js` at 959511d01, manifest `docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/manifest.json`, run directory `/home/cookys/.autopilot/bl0055-p2-3/run`.

- Label: **U**. The batch is not counted in any verdict.
- Reason: the wrapper was started with a one-off HOME copy of the credentials. Every id copies the credential file from that HOME, so after the access token expired the copy's refresh token had already been rotated by the main CLI. At the 31st id (ON-17) the probe answered `OAuth session expired and could not be refreshed`; the wrapper paused correctly (exit 7), but nothing resumed it inside the 8 hour window.
- COMPLETE: ON=15/30 C=16/30.
- Spend: C 8.8159 USD, ON 11.0321 USD.
- Fix: `--credentials-source`, a pause before a probe when the source is about to expire, and the auto-resume launcher `evals/orchestration/run-p2-batch-loop.js`.

## Audit output

Command, run in `/home/cookys/.autopilot/bl0055-p2-3/clone` (the run directory was not modified):

```
node evals/orchestration/run-p2-batch.js --audit --manifest docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/manifest.json --run-dir /home/cookys/.autopilot/bl0055-p2-3/run --clone .
```

Output (exit 1):

```
AUDIT FAIL: log grammar: the log ends after 32 of 60 ids or without WRAPPER_DONE
AUDIT FAILED (1)
```
