# Phase 3 — MiniMax Calibration

## Goal

Prevent the recorded MiniMax-M3 diff-only limitation from being invisible at roster resolution.

## Design

- Treat the 5/6 false-central-claim observation as telemetry/limitation, never authority.
- Prefer a warning/role limitation when no exact qualified replacement is ready.
- A demotion is allowed only when the replacement tuple is already qualified and available.
- Keep disk scorecard rows unable to grant review, verifier, owner, acceptance, or merge authority.

## Tasks

- [ ] Encode or project the limitation through the existing scorecard/config/resolver surface.
- [ ] Add a roster test that asserts the warning/limitation or safe demotion.
- [ ] Perturb/remove the guard and prove the test fails.
- [ ] Re-run provisional/empty-ladder authority invariants.
- [ ] Document the evidence date and scope without copying review transcripts.

## Verification

Acceptance pattern A2:

```bash
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/engine-scorecard.test.sh
```
