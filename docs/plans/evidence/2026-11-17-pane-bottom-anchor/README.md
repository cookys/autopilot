Repair of `cf9f25bee2bd9ecef7e4d3b95ba3df8bcf5947a0`; comparison base `b28dbc5e6`; task `01M7MCEGZ52PNEHQR4F1THBEA5`.

1. Task / acceptance: retain the product layout changes, move all bottom-anchor geometry cases to the existing plugin test harness without npm dependencies, retain behavioral negative controls, keep concise evidence, add no failing host test names, and pass both sync commands.
2. Located / exact replaced lines: `const ts = require('typescript')`, the `require.extensions` compiler setup, `const test = require('node:test')`, and fixture `fs.readFileSync` in the old JS golden; `node --test "$here/bottom-anchor.test.js"` and the npm prerequisite comment in the runner. The commit diff preserves every replaced line.
3. Reproduced the fresh-clone crash (exit 1, `Cannot find module 'typescript'`), then migrated the golden to `claude-code/testing`, static product imports and the existing fictional fixture module. The host's JSX nodes are normalized as in `consoleframe.test.ts`. All 35 cases passed. Strengthened the renderer control so the footer assertion rejects top alignment and a trailing spacer; its focused run also passed 35/35. Replaying that same final test against immutable base product sources gave 1 pass / 34 behavioral failures ([red.log](red.log)); head gave 35 pass / 0 fail ([green.log](green.log)).
4. Removed the four raw logs. Retained only test names, counts and exits. [host-summary.log](host-summary.log) lists both failure sets; [comparison.json](comparison.json) records their mechanical difference.
5. Verification results are recorded below; the final pass reran all named commands. The caller owns the independent cross-family review; no review verdict is claimed here.

| Command / check | Final exit | Evidence |
|---|---:|---|
| `AUTOPILOT_MODS_REAL_CLAUDE=<local-claude-binary> bash mods/live/run-tests.sh < /dev/null` | 1 | 1084 host pass / 15 fail; all eight preceding Node test files passed (162 pass / 0 fail); [host summary](host-summary.log) |
| Base full host suite, equivalent guarded plugin wrapper | 1 | 1049 pass / 15 fail; [host summary](host-summary.log) |
| Final golden alone, guarded `claude plugin test` | 0 | 35 pass / 0 fail; [green.log](green.log) |
| Identical golden + base `b28dbc5e6` product sources | 1 (expected red) | 1 pass / 34 fail; [red.log](red.log) |
| Base/head failing-name comparison | 0 | No added or removed names; [comparison.json](comparison.json) |
| `bash scripts/sync-all.sh` | 0 | [sync-generate.log](sync-generate.log) |
| `bash scripts/sync-all.sh --check` | 0 | All 16 checks; [sync-check.log](sync-check.log) |
| `git diff --check` | 0 | No whitespace errors |

The local 2.1.326 plugin test binary runs through `mods/lib/real-claude-env.sh` with empty HOME/config/XDG directories and authentication variables removed. `TMPDIR` points inside this worktree. No credentials or real `~/.claude` are read. No npm install or network operation is used. Base product sources come from `git archive b28dbc5e6 mods`; wrappers match `run-tests.sh` (live tests plus viewer sources). The golden-only wrappers retain the same final test artifact on base and head. Raw scratch output is not committed.

The first sync check saw the deleted JS test still in `git ls-files` and exited 1. Staging the deletion removed that obsolete index entry; the next complete sync check exited 0. The source-only base runner initially stopped before host tests because its snapshot omitted `scripts/lib/test-git-env`; the subsequent base host run uses the equivalent guarded plugin wrapper directly.

Every changed path and why (relative to the parent commit):

| File | Reason |
|---|---|
| `mods/live/bottom-anchor.test.js` | Delete the standalone compiler loader that crashes without an npm install. |
| `mods/live/bottom-anchor.test.ts` | Run the same 35 geometry goldens through the plugin TSX harness, including explicit negative controls. |
| `mods/live/package.json` | Remove the new compiler dependency declaration. |
| `mods/live/package-lock.json` | Remove its dependency lockfile. |
| `mods/live/run-tests.sh` | Remove the Node golden invocation and npm prerequisite comment. |
| `mods/live/live.test.ts` | Update two comments to the migrated golden's filename; assertions unchanged. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/README.md` | Record this repair's sequence, commands, limits and changed-file reasons. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/red.log` | Replace raw traces with final golden test names and counts on base. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/green.log` | Replace raw output with final golden test names and counts on head. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/host-summary.log` | Record base/head host counts and both failing-name lists. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/comparison.json` | Record the mechanically derived failure-set comparison. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/host.log` | Delete the long raw head host log. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/host-base.log` | Delete the long raw base host log. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/host-cohort.log` | Delete the long raw cohort host log. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/node-all.log` | Delete the long standalone Node log. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/sync-generate.log` | Record the final generator command's exit and short summary. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/sync-check.log` | Record the final check command's exit and short summary. |

Out of scope: repairing the pre-existing fleet/speed host failures, physical terminal validation, merge/push/deployment, version changes, and the caller's independent cross-family review. The listed product source files and existing TS assertion goldens are preserved.
