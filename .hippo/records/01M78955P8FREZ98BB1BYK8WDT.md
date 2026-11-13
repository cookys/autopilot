---
id: 01M78955P8FREZ98BB1BYK8WDT
kind: issue
created: 2026-11-12T00:00:00.000Z
---
- **Since**: 2026-11-12
- **Report**: 2026-11-12 fleet (PM ruling)
- **Reply**: 2026-11-12 01M76P6G6F17DHRDCYB61HRK6H
- **Problem**: The affected-suites runner decides pass or fail only from each suite exit code, so a suite that prints SKIP and exits 0 counts as green and the summary never says how many were skipped. The full-suite runner does list skips, so the two runners disagree.
- **Impact**: A run where the hippo suites skipped because hippo is absent reads as fully verified, though nothing was asserted.
- **Trigger**: ready
- **Source**: found 2026-11-12 while fixing the hippo suites (merge 6e96e90a1); PM ruling fleet 01M76P6G6F17DHRDCYB61HRK6H
- **Pointer**: project/backlog/affected-suites-skip-count.md
