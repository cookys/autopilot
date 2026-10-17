# Three suites red on develop before 2026-10-18 work

Found at the close of the oc2 and budget lanes; re-run on commit 35f07d836 (before that day's work) confirmed they were already red.

| Suite | Result | Failing cases |
|---|---|---|
| opencode-v2-plugin | 6 pass, 3 fail | "plugin setup writes isolated smoke intent: expected != '', got ''" (plugin setup does not write the smoke intent) |

Note: the opencode-v2-plugin failures may be related to the local opencode being upgraded to 2.0.32. Unverified.

Effort M. Trigger: before running the full suite for a release.
