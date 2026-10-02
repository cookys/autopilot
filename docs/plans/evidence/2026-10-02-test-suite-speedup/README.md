# Evidence — test-suite speedup (v2.36.106, `d15a45a5`)

Diagnosis (sonnet, read-only, one run per file under host load ≈ 40): the suite's wall time was dominated by node spawns, not sleeps — `resolve-review-loop` 325 resolver calls × ~2.5 s (600–823 s, hit the per-file timeout), `engine-qualify` ~24 full qualifier runs (BAD_MODE loop alone ~230 s), `dispatch-review` 174 calls, L2 wrappers re-running `scripts/*.test.js` already run by L1 (~390 s), `foreman-guard-roles` one extra `node` per payload for JSON escaping.

Five parallel sonnet hands (`speed-common.md`): dedupe (count pins moved into the `.js` tails so L1 enforces them), rrl ×4 shards, eq ×3, dr ×3, fgr bash escaper (1429 payloads compared to node, 0 mismatches). Every unit kept its assertion count. Landing (`landing/`): full suite once at `--parallel 16` = 19.4 min (was ~25 min at `--parallel 8`), review SHIP-AS-IS (`3F6F2W`). The landing template now says `--parallel 16` once per release.
