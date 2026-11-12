# BL-0432 group A — triage

Bisect range: good `9a0d2e409` (last merge on/before 2026-11-08 20:00 +0800; went further back for hook-hosting wiring) … bad `77c3497ad` (HEAD~1; local shim `f51e9461e` excluded).

Verify command (one suite at a time):
`env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node --test <file> < /dev/null`

| suite | failing tests | first bad commit (short sha + subject) | cause | wrong side | fix commit or "needs decision" | green after fix |
|---|---|---|---|---|---|---|
| hooks/card-title-write.test.js | (none at HEAD / HEAD~1) | n/a — could not reproduce | Suite green at HEAD and at HEAD~1; not caused by the local shim. Original backlog red not reproduced in this worktree. | n/a | no fix | yes (already) |
| hooks/hook-hosting.test.js | (1) wiring: UserPromptSubmit … timeout 10 — `70 !== 10`; (2)(3) ups fast path… — `EACCES … /dev/shm/fakebin/bin/autopilot.js` | (1) `1859f6241` advisory-relay: … raise hook timeout to 70 s…; (2)(3) not a product commit — host leftover `/dev/shm/fakebin` owned by another uid + test wrote via `dirname(live)` (= `/dev/shm`) | (1) Product raised UserPromptSubmit timeout 10→70; test expectation left at 10. (2)(3) `fakeWatcher` placed `fakebin` under shared `/dev/shm`, colliding with a foreign-owned leftover. | test | working tree (harness commits): update timeout expect 10→70; put fakebin under the per-run live dir | yes |
| hooks/plain-session-marker.test.js | dispatch-hetero classifier: a plain marker is skipped… — `plain marker must not change the exit code versus no marker` (`2 !== 1`) | `ec731f986` dispatch-hetero(grok): edits on hands/carbon/1 | Default model became literal `gemini-4-carbon-low` (no early alias fail). Two hetero calls shared `--branch feat/plain`; the first creates the branch (exit 1), the second hits `branch already exists` (exit 2). Plain marker itself is still skipped. | test | working tree (harness commits): distinct branch names for the two calls | yes |
| hooks/runs-watch-start.test.js | (none at HEAD / HEAD~1) | n/a — could not reproduce | Suite green at HEAD and at HEAD~1; not caused by the local shim. Original backlog red not reproduced in this worktree. | n/a | no fix | yes (already) |
| hooks/session-root-liveness.test.js | guard: block message carries the session root as a ready --root-run-id — regex `/ open --root-run-id root-abc --question /` | `2b4a98d7e` carddispatch: panel answers are delivered… (open requires --executor) | Same commit inserted `--executor <執行者位址>` into the guard reason string but left the test regex expecting `--root-run-id` immediately before `--question`. | test | working tree (harness commits): regex includes `--executor <執行者位址>` | yes |

## Final verify (exit codes)

| suite | exit |
|---|---|
| hooks/card-title-write.test.js | 0 |
| hooks/hook-hosting.test.js | 0 |
| hooks/plain-session-marker.test.js | 0 |
| hooks/runs-watch-start.test.js | 0 |
| hooks/session-root-liveness.test.js | 0 |

## Changed files

- `hooks/session-root-liveness.test.js` — align guard regex with `--executor` required by `2b4a98d7e`
- `hooks/hook-hosting.test.js` — expect timeout 70 (`1859f6241`); isolate fakebin under per-run live dir
- `hooks/plain-session-marker.test.js` — unique hetero branch names so carbon default cannot collide
- `project/backlog/triage-bl0432-A.md` — this report

## Deferred / out of scope

- No product-code changes (all three root causes were stale/fragile tests).
- No fix for card-title-write / runs-watch-start (not red here).
- Did not remove the host leftover under `/dev/shm/fakebin` (owned by another uid; test isolation is the durable fix).
- Did not edit BACKLOG.md; did not commit/push/PR (harness owns commits).
- Group B shell suites (decide-undo, decision-claim, …) not in this assignment.
