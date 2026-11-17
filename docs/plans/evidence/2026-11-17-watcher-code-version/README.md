# Watcher checkout-version evidence

Fleet-Task: 01M7MBGKSN23P3RRX832DK4KJ0

Base: `b28dbc5e661625dfc12531c20545eed2741491a2`. The containing commit is the implementation artifact; [verification.log](verification.log) records command output and exit codes. Worktree paths in stack traces are replaced with `<worktree>` and trailing whitespace is trimmed.

1. Task and acceptance: replace a structurally confirmed watcher when its recorded code SHA differs from the plugin checkout's current HEAD; migrate a legacy record once; preserve unknown-version behavior and all existing writer fields; verify cases (a)–(d), card visibility and generated mirrors.
2. Located the writer identity in `src/status/code-fingerprint.js`: `return { plugin_root: real, plugin_version: version };`, captured once by `runs-watch.js` at watcher creation. Located acceptance in `inspectWatcher`: `if (recordedRoot === own.root && (w.plugin_version || null) === own.version) return { state: 'current', pid };`. Extended identity and inserted the SHA check before that acceptance. The strict writer schema also needed the new optional field.
3. Added regression cases before changing production code. The baseline autostart suite exited **1** (59 passed, 7 failed): both (a) and (d) returned `current` and kept the original PID. After implementing SHA recording/comparison, the same suite exited **0** (66 assertions).
4. Extended coverage for PostToolUse stamps, unknown and legacy records, loose/packed refs, linked/detached worktrees and ambient Git selectors. Updated the current-stamp hot-path fixture and the README row. The existing schema/data suite then reproduced rejection of the new writer property (exit **1**); adding an optional string/null schema property made all 31 tests pass. No property was removed or made required.
5. Re-ran the final checks below, regenerated the three Codex mirrors, and checked whitespace. All final checks exited **0**.

| Case | Before | Final |
|---|---|---|
| (a) Same root, recorded A, current B | `current`; original PID retained | `stale`, reason `code_version`; `run()` reaps and relaunches; replacement records HEAD |
| (b) Same code version | — | `current` |
| (c) Current version unknown (non-git root) | — | `current`, including a legacy record; explicit null recorded version also stays current |
| (d) Legacy record, current HEAD known | `current`; original PID retained | stale once; replacement records HEAD, is current, and survives the next ensure with the same PID |

| Final command | Exit | Result |
|---|---|---|
| `bash hooks/tests/runs-watch-autostart.test.sh` | 0 | 77 assertions |
| `bash hooks/tests/open-decision-card-visible.test.sh` | 0 | 51 assertions |
| `node --test hooks/runs-watch-hotpath.test.js` | 0 | 2 tests, including negative control |
| `node --test scripts/watch-code-change.test.js` | 0 | 10 tests |
| `node --test scripts/p7-watcher-data.test.js` | 0 | 31 tests, including live-envelope schema validation |
| `bash scripts/sync-all.sh` | 0 | `ok: true` |
| `bash scripts/sync-all.sh --check` | 0 | `ok: true`, no failures or skipped checks |
| `git diff --check` | 0 | No whitespace errors |

Files changed (one purpose each):

- `hooks/runs-watch-autostart.js`: classify SHA mismatches and known-HEAD legacy records as stale; include SHA in PostToolUse stamps so that fast path cannot bypass replacement.
- `src/status/watcher-identity.js`: read checkout HEAD from local Git metadata, supporting linked worktrees and packed refs without spawning Git; unreadable metadata returns null.
- `src/status/code-fingerprint.js`: add `plugin_code_version` to the identity already captured once in each watcher's writer block.
- `schemas/runs-live.schema.json`: allow the optional string/null writer property while preserving legacy records.
- `hooks/tests/runs-watch-autostart.test.sh`: cover (a)–(d), real reap/relaunch, no restart loop, PostToolUse stamps and Git metadata layouts.
- `hooks/runs-watch-hotpath.test.js`: give the current-watcher stamp fixture its SHA and retain the no-directory/no-chmod regression checks.
- `hooks/README.md`: document code-version replacement and unknown-version fallback in the existing hook row.
- `platforms/codex/plugin/src/status/watcher-identity.js`: generated mirror of the shared HEAD reader.
- `platforms/codex/plugin/src/status/code-fingerprint.js`: generated mirror of the writer identity change.
- `platforms/codex/plugin/schemas/runs-live.schema.json`: generated mirror of the optional writer property.
- `docs/plans/evidence/2026-11-17-watcher-code-version/README.md`: task receipt, case outcomes, file purposes and scope limits.
- `docs/plans/evidence/2026-11-17-watcher-code-version/verification.log`: recorded red controls and final green command output.

Deferred/out of scope: no network calls, version bump, deployment, merge or live operator-watcher intervention. Independent review by another model family remains with the caller. The source-file affected-suite selection was 884/926 suites; the controller's full pre-merge suite remains deferred, and this receipt claims only the commands above. Uncommitted edits and unsupported/unreadable Git metadata continue to use the existing fingerprint/root/version behavior; the new identity represents Git HEAD.
