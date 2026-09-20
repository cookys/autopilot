# Managed rail: repair scope is derived from the reviewer's claim text

Observed 2026-09-20, 2-D D2 attempt 3 (campaign-v1-6c2313d7…): the depth-0 disposition was accepted
(`repair_authorized`) and the campaign then hit `terminal_stop` with
`finding spurious-live-flip-single-station has no explicit allowed repair path`.

`src/engine/autopilot-engine.js` `findingBoundRepairPaths` scans each must-fix finding's `claim`/`source`
text for paths under the sealed `allowed_path_prefixes`; the fable seat wrote "Engine `snapshotStation`"
with no file path → throw → terminalize, attempt burned. The disposition's `task_surface` is never read.

Fix shape: fall back to `disposition.task_surface` and then to the round's changed files; when no scope can
be sealed, PARK (`awaiting_disposition` with a named reason) instead of terminalizing.

Evidence: `docs/plans/evidence/2026-09-19-blind-review-2d-overlap/d2-snapshot-contract/impl-run5-repair-scope-terminal.json`.
