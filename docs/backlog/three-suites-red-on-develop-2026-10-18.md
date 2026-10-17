# Three suites red on develop before 2026-10-18 work

Found at the close of the oc2 and budget lanes; re-run on commit 35f07d836 (before that day's work) confirmed they were already red.

| Suite | Result | Failing cases |
|---|---|---|
| p7-watcher-data | 24 pass, 7 fail | D3 residue (4 cases), R4 residue (3 cases) |
| implementation-campaign-state | 298 pass, 3 fail | "campaign intake refuses blind-incompatible qc seats before claim" (final-panel-blind-intake assertion not found) |

opencode-v2-plugin was fixed on 2026-10-18 (lane ocport): the plugin exported the 1.x `{id, server}` shape, which opencode 2.0.32 rejects, and its config pointed at a file where 2.x wants a directory. Row removed; the two suites above remain.

Effort M. Trigger: before running the full suite for a release.
