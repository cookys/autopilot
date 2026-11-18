# Pane chrome UX round 2, part B

Branch: `fix/pane-r3-chrome`; base: `28bae06a659cc67b39685042027cdc3405184d70`.

Acceptance: R6 named strip entries and hotkeys at 80/70/60 columns; R7 current-page digits stay open; R9 pending/fault badges, [+] and two band rows without digit hotkeys; R12 an accessible light-theme action role; R13 host-height dock and <=24-row inline pane. Each new regression was observed failing before its fix; the exact names and logs are in receipt.log.

## Final verification

- `AUTOPILOT_MODS_REAL_CLAUDE=<real Claude binary supplied by caller> bash mods/live/run-tests.sh < /dev/null`: exit **1**, **1449 pass / 15 fail** across 32 host test files; all 15 failures are the caller's baseline. The 10 preceding Node suites passed **186 / 186**. Artifacts: chrome-suite.log and chrome-suite.exit.
- Failure extraction: `sed -n '/^(fail)/s/ \[[^]]*\]$//p' chrome-suite.log > chrome-failures.txt`.
- `diff -u <(LC_ALL=C sort "$baseline") <(LC_ALL=C sort chrome-failures.txt)`, with baseline set to the caller's bandrow-brief/fb.txt: exit **0**, **empty output** (chrome-failures.diff), 15 lines in each input.
- `bash scripts/sync-all.sh`: exit **0**, `ok: true` (chrome-sync.log / .exit).
- `bash scripts/sync-all.sh --check`: exit **0**, `ok: true` (chrome-sync-check.log / .exit).
- `git diff --check`: exit **0**.

The two full-suite logs have fixture home paths and host names redacted with scripts/redact-personal.js to satisfy the repository leak guard; log-line trailing whitespace is also normalized. Test names, results and counts are unchanged.

The existing strip tests were strengthened to require 9/0. The additional own-key assertion in pages/decide.test.ts was updated to the same R7 behavior. The theme allowlist gained the host-supported remember token, and the design lint also gained detection of that token outside the palette. No test was deleted or skipped. The explicit legacyTabs path retains its existing behavior and tests.

The host's native remember token is RGB(0,0,255) / ANSI 21 in light mode: 8.59:1 on white and >4.5:1 on RGB(245,245,245). Colours remain selected through PALETTE.action; no page contains a new colour literal. The inspected host source is in chrome-host-contract.txt.

## Changed files — one reason each

- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-failures.diff` — Preserve the empty comparison output against the caller-provided 15-line baseline.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-failures.txt` — Extract the final fail lines with only their trailing elapsed times removed.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-followup-green.log` — Preserve the passing regression output after its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-host-contract.txt` — Record inspected host theme tokens and dock/inline placement plus available-height fields.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-legend-green.log` — Preserve the passing regression output after its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-legend-red.log` — Preserve the observed failing regression output before its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-lint.log` — Preserve the passing 56-test design lint run.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r12-green.log` — Preserve the passing regression output after its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r12-red.log` — Preserve the observed failing regression output before its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r13-green.log` — Preserve the passing regression output after its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r13-red.log` — Preserve the observed failing regression output before its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r6-green.log` — Preserve the passing regression output after its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r6-red.log` — Preserve the observed failing regression output before its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r7-green.log` — Preserve the passing regression output after its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r7-red.log` — Preserve the observed failing regression output before its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r9-green.log` — Preserve the passing regression output after its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-r9-red.log` — Preserve the observed failing regression output before its fix.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-report.md` — Record acceptance evidence, all changed files with reasons, and explicit scope exclusions.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-suite-before-compat.exit` — Record exit 1 from the first full run.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-suite-before-compat.log` — Preserve the first full run exposing legacy assertions and the tall-dock fold-focus defect.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-suite.exit` — Record exit 1 from the final full suite, due solely to the known baseline failures.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-suite.log` — Preserve the final required full suite output: 1449 pass and the 15 expected failures.
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-sync-check.exit` — Record sync generation/check output or its exit code (0).
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-sync-check.log` — Record sync generation/check output or its exit code (0).
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-sync.exit` — Record sync generation/check output or its exit code (0).
- `docs/plans/evidence/2026-11-18-pane-batch1/chrome-sync.log` — Record sync generation/check output or its exit code (0).
- `docs/plans/evidence/2026-11-18-pane-batch1/receipt.log` — Append only observed red-to-green test names and command exits for this task.
- `mods/live/band.tsx` — Draw the collapsed console marker [+], budget its width, keep the menu row fixed, and pass the console snapshot to its badges.
- `mods/live/chrome.test.ts` — Add eight regression tests for R6, R7, R9, R12 and R13, including mounted host callbacks and height allocation.
- `mods/live/frame.test.ts` — Strengthen the framed strip hotkey expectation to include 9 and 0.
- `mods/live/gate3.test.ts` — Strengthen the narrow strip hotkey expectation to include 9 and 0 while retaining its width matrix.
- `mods/live/live.test.ts` — Recognize the supported remember theme token while retaining the theme-only colour assertion.
- `mods/live/locales.ts` — Regenerate the English and Traditional Chinese tables from the locale sources.
- `mods/live/locales/en.json` — Add short Fleet/Pet/forge labels and update the action legend to the link role.
- `mods/live/locales/zh-TW.json` — Add short 艦/寵/鍛 labels and update the action legend to the link role.
- `mods/live/model.ts` — Add the host remember token to the ThemeKey type.
- `mods/live/pages/decide.test.ts` — Apply R7 to the additional own-page digit assertion after leaving note mode.
- `mods/live/pages/frame.ts` — Use localized short strip labels and allocate dock height from the host while retaining the inline cap.
- `mods/live/pages/keys.test.ts` — Change the two requested current-page digit assertions from close to no-op.
- `mods/live/pages/keys.ts` — Return no-op for the current page digit.
- `mods/live/pane.tsx` — Render all registered digit entries, including pet and forge, as hotkey Buttons with label-only text.
- `mods/live/register.ts` — Make the current pane page selection idempotent, pass host placement to height calculation, and reuse fold focus clamping.
- `mods/live/tabs.ts` — Append shared-snapshot pending/fault counts and compact badge labels when space is narrow.
- `mods/live/ui-lint.test.js` — Extend theme-key literal detection to remember, including the existing negative controls.
- `mods/live/ui.ts` — Map action to the host link token and centralize band badge formatting.

## Not done / scope

No edits to pages/now.ts, pages/fleet.ts, pages/quota.ts, pages/rows.ts, consolefeed.ts or the forge speed budget. No push, merge, release, installed-user-config changes or credential reads. Independent cross-family review is left to the caller, as specified by the dispatch contract. The branch is retained for that review.
