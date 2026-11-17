Verification is **blocked**, not DONE: the required host suite has baseline failures, and standalone Node cannot load the host-only TypeScript testing kit. Independent cross-family review remains with the caller. Base: `b28dbc5e6`; task: `01M7MCEGZ52PNEHQR4F1THBEA5`.

1. Task / acceptance: all live and console pages grow above final navigation; short content leaves top blanks; decision options sit beside submit; overflow opens at the bottom and scrolls upward; preserve labels, palette and glyphs. Chosen order: **content → L2 → L3 → band/tabs (last)**.
2. Located the old order in `pane.tsx` (`{strip}` before header/body), `band.tsx` (`return <Box flexDirection="column">{band}{below}</Box>`, menu before quick), `scroll.tsx` (`<Text key="spare"> </Text>` after the fixed frame), and `commandtab.ts` (hint/data age appended to `bar`). The commit diff preserves the exact before/after lines.
3. Added the real-TSX golden before product edits: initial run exited 1 (1 pass, 33 behavioral failures). Replayed the final 35-test artifact against immutable base product sources: exit 1, 1 pass / 34 fail ([red.log](red.log)). Imports and renderer controls succeeded; these are assertion failures, not infrastructure failures.
4. Verified pane/console frame group (30/30), band/shell group (3/3), hot-zone builders, then scroll defaults. Updated the old host goldens for the new order. The final direct JavaScript run is exit 0, 49/49 ([green.log](green.log)).
5. Final checks below. No completion claim while required checks remain red.

| Command / check | Exit | Evidence |
|---|---:|---|
| `node --test mods/live/bottom-anchor.test.js mods/live/commandtab.test.js` | 0 | [green.log](green.log), 49 pass |
| `node --test` over all seven touched test files | 1 | [node-all.log](node-all.log): the five `.test.ts` files require `claude-code/testing`, unavailable to Node; 49 assertions pass in the JS workers |
| `AUTOPILOT_MODS_REAL_CLAUDE=<local 2.1.326 binary> bash mods/live/run-tests.sh < /dev/null` | 1 | [host.log](host.log): 1049 pass / 15 fail; same failing names reproduced at base |
| Focused original host tests at base `b28dbc5e6` | 1 | [host-base.log](host-base.log): 45 pass, 15 fail |
| Same host cohort plus attachment tests on current sources | 1 | [host-cohort.log](host-cohort.log): 54 pass, same 15 failures |
| Baseline/current failing-name comparison | 0 | [comparison.json](comparison.json): no added or removed failures in that cohort |
| Guarded decision / console pure host tests | 0 | 54 pass / 0 fail; also included in the complete host run |
| `bash scripts/sync-all.sh` | 0 | [sync-generate.log](sync-generate.log), `ok: true`, no generated changes |
| `bash scripts/sync-all.sh --check` | 0 | [sync-check.log](sync-check.log), all 16 checks, `ok: true` |
| `git diff --check` | 0 | no whitespace errors |

The guarded runner uses the repository's `mods/lib/real-claude-env.sh`: empty HOME/config/XDG directories, auth variables removed, no credentials copied, and no credential/transcript files produced. It ran the local host binary; exit-97 fallback was not needed. Tests use fictional fixtures. No network was used. Absolute scratch paths in logs are replaced with `<worktree>` / `<temporary-host-path>`; trailing terminal padding is trimmed in the saved logs.

The focused baseline replay copied committed `mods/` files with `git show b28dbc5e6:<path>` into a throwaway plugin inside this worktree. It registered only original live tests whose names matched `G33a|C1 U7|speed tab:|band row: idle fleet|P7 panel: the tab|P7 band: the ⓘ is|each option is a Button|model.json entry has origin|pane-attach 3|data older than a minute|sent card of five options|no tab clips`. Current replay used the same selector plus the complete attachment test file. No shipped assertions were suppressed. Both raw logs retain the individual failure details; the complete suite ran without this selector.

TypeScript 5.7.3 is a test-only compiler, installed from the existing npm cache using `npm install --offline --prefix mods/live --ignore-scripts --no-audit --no-fund` (exit 0). Node's standard type stripper cannot parse JSX, and the repository had no JSX compiler dependency. Production continues to ship source; no runtime dependency was added. New checkouts need `npm ci --offline --prefix mods/live` with the package cached, or an ordinary developer install outside this task's no-network constraint.

Every changed file and why (one row each):

| File | Reason |
|---|---|
| `CHANGELOG.md` | Record the visible layout correction without a version bump. |
| `mods/live/pane.tsx` | Shared bottom windows, cold headers in scroll content, submit/navigation footer, top padding and short fallback alignment. |
| `mods/live/scroll.tsx` | Allow live frames to end at navigation while preserving the viewer's default spare-row behavior. |
| `mods/live/band.tsx` | Put band/menu last, pad short main content above, start overflowing cards at their bottom, keep paging hints above options. |
| `mods/live/register.ts` | Reset bottom scroll state when cards change and keep the outer host offset from hiding fixed navigation. |
| `mods/live/commandtab.ts` | Move hints/data age and other feed cards above the held card and submit. |
| `mods/live/tabs.ts` | Move advice and note fields before options so the final options meet submit. |
| `mods/live/bottom-anchor.test.js` | New real-Pane, console, speed and shell golden at 160×40 / 80×24, with short-content and overflow checks and a red-base replay. |
| `mods/live/commandtab.test.js` | Golden now requires cold data age/hints and final held options/submit. |
| `mods/live/console.test.ts` | End queue-card extraction at the separator before final navigation. |
| `mods/live/consoleframe.test.ts` | Golden now requires data age above the hot queue and submit/navigation fixed during scrolling. |
| `mods/live/decide.test.ts` | Pin advice/notes before options; retain complete wrapping, field, text and choice assertions. |
| `mods/live/live.test.ts` | Update footer/thumb/paging goldens and semantic readers; retain content, keyboard, palette, width and wrapping checks. |
| `mods/live/pane-attach.test.ts` | Update the semantic frame reader for final navigation while retaining card/step/look and submit assertions. |
| `mods/live/run-tests.sh` | Wire the new Node golden into the suite and document its compiler prerequisite. |
| `mods/live/package.json` | Declare the pinned test-only JSX compiler. |
| `mods/live/package-lock.json` | Pin the compiler install for reproducible offline tests. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/README.md` | Record commands, results, scope, changed files and blockers. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/red.log` | Preserve failing assertions from final golden against base. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/green.log` | Preserve direct JavaScript success output. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/node-all.log` | Preserve standalone Node's host-kit loading limitation. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/host.log` | Preserve the complete final host suite output. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/host-base.log` | Preserve actual base reproduction of the existing host failures. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/host-cohort.log` | Preserve current results for the same failure cohort and attachment tests. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/comparison.json` | Record the mechanical comparison of failing test names. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/sync-generate.log` | Preserve generator result and unchanged mirror inventory. |
| `docs/plans/evidence/2026-11-17-pane-bottom-anchor/sync-check.log` | Preserve the complete mirror-check result. |

Not done / deferred: repairing the 15 reproduced pre-existing fleet/speed host failures; making the host-only test kit runnable under standalone Node; physical terminal keyboard/screenshot validation; deployment, merge/push, version bump, and the caller's independent cross-family review. No generated mirrors changed. These limitations are explicit; the all-green evidence contract is not satisfied.
