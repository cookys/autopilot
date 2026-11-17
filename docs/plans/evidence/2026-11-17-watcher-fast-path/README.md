# Watcher fast-path fixture regression

Fleet task: `01M7MBGKSN23P3RRX832DK4KJ0`.
Base: `8ae6f4e7416a770ef0ec82fc14527dcb127c2178`.
Branch: `fix/watcher-code-version2`.
Command output and exit codes: [verification.log](verification.log).
Absolute worktree paths in the log are normalized to `<worktree>`; trailing
whitespace from assertion output is removed.

1. Task and acceptance: keep the base commit's watcher replacement behavior;
   mark the fast-path fixture as current; prove a missing code-version field
   takes the full path and replaces the writer record; merge the local
   `origin/develop`; pass every named verification command; commit the test fix.
2. Located change: `hooks/plain-session-marker.test.js`, `fastPathFixture()`'s
   writer record originally contained only `pid`, `plugin_root`, and
   `plugin_version`. The adjacent zero-spawn assertion failed because that record
   was classified as legacy. The added field reads the code version from the
   same real plugin root named by the record.
3. First change and verification: add only `plugin_code_version` to the fixture.
   Before: marker suite 43/44 passing, exit 1, with the reported zero-spawn
   assertion failure. After: 44/44 passing, exit 0.
4. Legacy criterion and verification: add an adjacent test using the same
   fixture with the field deleted. It checks the `code_version` stale reason,
   a git invocation on the full path, a replacement writer PID, and its current
   code version. Marker suite: 45/45 passing, exit 0. Negative control: a
   temporary test-only copy retains the field and fails with
   `'current' !== 'stale'`, exit 1 as expected; the copy was removed.
   `git merge --no-ff origin/develop` exited 0, reporting `Already up to date.`
   The local ref was `b28dbc5e661625dfc12531c20545eed2741491a2`, already an
   ancestor of the base; no merge commit or conflict resolution was needed.
5. Final verification: all five commands below exited 0. Sync generation left
   no tracked changes; the full check ran all 16 rituals, including hook counts
   and the profile catalog, with no skips or failures. Additional preservation
   and whitespace checks are recorded in the log.

| Final command | Result | Exit |
| --- | --- | --- |
| `node --test hooks/plain-session-marker.test.js` | 45/45 tests pass | 0 |
| `bash hooks/tests/runs-watch-autostart.test.sh` | 77 assertions pass | 0 |
| `node --test hooks/runs-watch-hotpath.test.js` | 2/2 tests pass | 0 |
| `bash scripts/sync-all.sh` | 5 generators pass | 0 |
| `bash scripts/sync-all.sh --check` | 16 checks pass | 0 |

Changed files, one line each:

- `hooks/plain-session-marker.test.js`: record the current code version and pin legacy-record replacement.
- `docs/plans/evidence/2026-11-17-watcher-fast-path/README.md`: map acceptance criteria to verification evidence and scope.
- `docs/plans/evidence/2026-11-17-watcher-fast-path/verification.log`: retain baseline, per-change, negative-control, merge, and final command outputs with exit codes.

No implementation items were deferred. Product code, published contracts, and
version metadata were not changed. No network, fetch, push, deployment, or merge
of this branch into `develop` was performed. Independent review by another model
family is the caller's next stage; this implementer claims no review verdict.
