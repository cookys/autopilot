# affected-suites must report skips and never count them green (BL-0434)

Evidence: scripts/affected-suites.js decides pass or fail only from each suite's exit code (serial path around line 1074,
parallel path around line 1151). A suite that prints `SKIP [suite] ...` and exits 0 is counted green, and the summary does
not report how many were skipped. hooks/tests/run.sh collect_skips (around lines 622-631) does list skips, so the two
runners disagree. Found 2026-11-12 while fixing the hippo suites (merge 6e96e90a1), whose tests now print SKIP when hippo
is absent.

Ask (PM ruling 2026-11-12, fleet 01M76P6G6F17DHRDCYB61HRK6H): affected-suites lists the skip count and never counts skips as
passes; a suite whose whole run is skipped is reported as "unverified", never green. Implementer grok, reviewer agy;
scheduled after noncq.

Reported by the autopilot lane, 2026-11-12.
