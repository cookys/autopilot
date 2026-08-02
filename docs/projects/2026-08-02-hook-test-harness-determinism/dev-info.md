# Developer info — hook test harness determinism

- Target branch: `develop`
- Feature branch: `fix/hook-test-harness-determinism-l4`
- Size: L (grouped Fix batch)
- Compatibility: internal-only
- Dependencies: platform/stdlib only
- Production paths: explicitly forbidden
- Foreman: reuse `/root/backlog_convergence_foreman` transcript
- Verification authority: independent depth-0 reviewer, not the implementer/foreman
- Merge: local `--no-ff`; no push

## Base evidence

- Host: load average approximately 49 on 32 CPUs.
- `bash hooks/tests/dispatch-output-quiescence.test.sh`: 16 passed, 3 failed; elapsed
  witnesses `9>5`, `11>5`, `10>6`, with semantic exit/status assertions green.
- `timeout 3s bash hooks/tests/session-start.test.sh < <(sleep 30)`: exit `124` after
  3 seconds.

## Required commands

```bash
bash hooks/tests/dispatch-output-quiescence.test.sh
bash hooks/tests/session-start.test.sh
AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh
bash scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/sync-all.sh --check
```
