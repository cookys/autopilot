# calendar-teeth-negative instant2 fails: its consult evidence fixture exceeds the expiry ceiling

Source: feat/autocompact-detect qc-gate, 2026-10-12.

- `hooks/tests/calendar-teeth-negative.test.sh` case instant2 expects `qualified:1` and gets an empty
  result. The compile step throws `CapabilityEvidenceError: qualified consult evidence exceeds its expiry
  ceiling` (`src/engine/capability-evidence.js`, code `INVALID_CAPABILITY_EVIDENCE`).
- Fails the same way at 7586c8dd, before the branch, so it is not from that diff. Likely the fixture's
  issued/expiry stamps are fixed dates that have now aged past the ceiling, or the ceiling was tightened
  without updating the fixture; not yet bisected.
- Fix: derive the fixture's stamps from the run's clock (as the other instant cases do) or update it to the
  current ceiling; confirm by bisecting which commit turned it red.
