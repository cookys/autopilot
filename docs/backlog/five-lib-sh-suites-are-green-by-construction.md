# Five lib.sh suites are green by construction (never finalize)

Source: v2.36.111 finalize-gate work (units A, A3, A3b), 2026-10-03.

- **Trigger**: FIRED — the gate (`hooks/tests/test-suite-finalize-gate.test.sh`) allowlists these as ALWAYS-GREEN; next test-hygiene wave.
- **Suites**: `autopilot-engine-boundary-resume`, `autopilot-engine-repair-branch`, `implementation-campaign-state-boundary`, `load-endpoints-env`, `review-mvp-portfolio`.
- **Context**: each sources `lib.sh`, whose `fail()` only appends and prints to stderr, and none calls `finalize_test`, so the suite exits 0 whatever happens. Depth-0 measured 0 hidden FAIL lines across them at 4c3b7a71, so adding `finalize_test` should be safe; do it one suite at a time, then drop the name from the allowlist (it can only shrink).
- **Related**: `autopilot-engine-boundary-resume` also never asserts its final status; see the boundary-rejected terminal row in `docs/BACKLOG.md` (`docs/backlog/boundary-rejected-campaign-cannot-reach-terminal-success.md`). `mission-terminal-rollover` exits 0 vacuously (`0 passed, 0 failed`) when no Mission registry exists; make it fail or skip loudly.
- **Effort**: S
