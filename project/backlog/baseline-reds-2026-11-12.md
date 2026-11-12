# BL-0432 — eleven baseline-red suites (2026-11-12)

Found by `node scripts/affected-suites.js --base b514bc773 --head d32f422c3 --run --record`: 141 green, 11 red.
Re-run on a detached worktree at b514bc773 (before the ctx-reset change): the same suites are red, also under `env -i`.

Red suites:
- hooks/card-title-write.test.js
- hooks/hook-hosting.test.js
- hooks/plain-session-marker.test.js (test 10: dispatch-hetero classifier exits 2, expected 1)
- hooks/runs-watch-start.test.js
- hooks/session-root-liveness.test.js
- hooks/tests/decide-undo.test.sh ("the real pane code, both surfaces": expected 0, got 15)
- hooks/tests/decision-claim.test.sh
- hooks/tests/dev-setup.test.sh
- hooks/tests/dispatch-detach.test.sh
- hooks/tests/dispatch-gitconfig-containment.test.sh
- hooks/tests/dispatch-hetero.test.sh (setsid-unavailable fallback cases)

Next step: bisect from the last green full run (2026-11-08) to b514bc773, one suite at a time (suites interfere when run in parallel).
