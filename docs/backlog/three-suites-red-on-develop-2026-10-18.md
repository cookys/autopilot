# Three suites red on develop before 2026-10-18 work

Found at the close of the oc2 and budget lanes; re-run on commit 35f07d836 (before that day's work) confirmed they were already red.

| Suite | Result | Failing cases |
|---|---|---|
| p7-watcher-data | 24 pass, 7 fail | D3 residue (4 cases), R4 residue (3 cases) |
| opencode-v2-plugin | 6 pass, 3 fail | "plugin setup writes isolated smoke intent: expected != '', got ''" (plugin setup does not write the smoke intent) |
| implementation-campaign-state | 298 pass, 3 fail | "campaign intake refuses blind-incompatible qc seats before claim" (final-panel-blind-intake assertion not found) |

Note: the opencode-v2-plugin failures may be related to the local opencode being upgraded to 2.0.32. Unverified.

Effort M. Trigger: before running the full suite for a release.
