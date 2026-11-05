# Suites red in the parallel pool but green alone, and one intermittent (BL-0401)

Source: full suite on 04913afdf, 2026-11-05 (PM).

## Pool-only reds (green alone)
- hooks/tests/dispatch-author-agy-timeout.test.sh
- hooks/tests/dispatch-author-codex-transport.test.sh
- hooks/tests/engine-effort-default.test.sh
- hooks/tests/skill-onoff-arm-builder.test.sh

Find the shared resource each collides on (host-wide process names, a fixed temp path, a port, a shared state dir) and make it per-run, as faf78ec38 did for agy-timeout.

## Sub-item: intermittent alone
- hooks/tests/paid-batch-auth-stop.test.sh was red alone in 1 of 6 runs, 1 of 243 assertions. Which assertion: under investigation. Capture the failing assertion text on the next red before changing anything.
