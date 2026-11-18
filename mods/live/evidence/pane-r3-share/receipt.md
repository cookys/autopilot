# Pane batch 2 UX round 3 — W2 W4 W5 V1 V2 V4 U1 U3

Fleet-Task: 01M7PC93PGG8FQ28EMT6ZDP7NY
Base: `cc9bde3db` (`feat/pane-batch2-r4`). Scope: only `mods/live/`.

## 1. Task and acceptance

Correct the assigned 現況 overflow, 額度, 艦隊, and band stale/missing behavior while preserving the other branch's scope.

| ID | Acceptance (production frame/band assertions in `../../pages/pane-r3-share.test.ts`) |
|---|---|
| W2 | Wide 現況 lists all five fictional waste pools and percentages; compact/overflow uses 額度浪費 ▲5. |
| W4 | Three bus cards remain 待決 3 張; same-row categories do not count as 另有; waste counts once; long overflow counts only hidden bus items/pools. |
| W5 | Band names stale fleet, age, quota forecast cause and repair; missing console is red; missing console preserves a stale live reason/age; compact red quota names staleness/age. |
| V1 | Narrow pool numbers have 7天/5時/預 labels; compact verdict names its pool; one content row keeps both red pool names and three unknown pools. |
| V2 | Narrow fleet operations share one row; summary/offline hosts survive; one/two content rows retain focused line and severe abnormality. |
| V4 | Pool o/previous/next controls occupy one operation row immediately above tabs, including 12 pools at 160x40. |
| U1 | Optional speed narrowing preserves 艦隊 and ✗ 2  ⊘ 4 at 160/120 columns; existing sub-120 width behavior remains. |
| U3 | Now/fleet summaries order ✗2 ⊘4 ○3. |

All new tests must pass. The named full suite may retain only the 15 accepted baseline failures, with no new failing test names. UI lint must exit 0. Existing tests are retained; conflicting static expectations carry finding-id comments. Frame fallback tests explicitly provide actionless pages because V4 makes the real quota page always navigable.

## 2. Located lines before editing

Exact original statements changed (the commit diff supplies context):

- W2, `mods/live/pages/now.ts`: `.filter(v => v.role === 'broken' || isUnknownPool(v)).map(v => poolRowOf(ctx, v, wide))`.
- W4, `mods/live/pages/now.ts`: `if (pRow !== null) entries.push({ rows: pNoTruncate ? wrapRow(pRow, size.cols, WRAP_HANG) : [truncateSegs(pRow, size.cols)], count: 1 })`.
- W5, `mods/live/band.tsx`: `const sourceFailure = !legacyTabs && con?.snap !== null && con?.snap !== undefined && Object.values(con.snap.sources).some(s => s.state === 'expired')`.
- V1, `mods/live/pages/quota.ts`: `mark(numCell(p.seven_day_pct === null ? DASH : Math.round(p.seven_day_pct) + '%', isStale, c.d7)),` and `const verdictRow = kv(t('page.quota.f_verdict'), ...`.
- V2, `mods/live/pages/fleet.ts`: `else actions.push(nav)`.
- V4, `mods/live/pages/quota.ts`: `const cutActions = (clipped: boolean): Row[] => (clipped && tier === 'narrow' ? [navRow()] : actions)`.
- U1, `mods/live/model.ts`: `for (const step of steps.slice(0, n)) for (const id of step) drop.add(id)`.
- U3, `mods/live/pages/now.ts`: `const LINE_ORDER = ['running', 'waiting', 'stalled', 'failed', 'pending'] as const`; matching array in `pages/fleet.ts`.

## 3–4. Per-finding red, minimal fix, green

Each test was added and executed before the corresponding product edit. Logs contain behavioral assertion failures, not import/setup failures. Commands use the same real Claude binary and empty-config guard as the named runner, with a temporary wrapper selecting the named test file:

`bash mods/live/evidence/pane-r3-share/focused.sh mods/live/pages/pane-r3-share.test.ts`

| Finding | Red artifact / exit | Green artifact / exit |
|---|---|---|
| W2 | `W2-red.log` / 1 | `W2-green.log` / 0 |
| W4 | `W4-red.log` / 1 | `W4-green.log` / 0 |
| W5 | `W5-red.log` / 1 | `W5-green.log` / 0 |
| V1 | `V1-red.log` / 1 | `V1-green.log` / 0 |
| V2 | `V2-red.log` / 1 | `V2-green.log` / 0 |
| V4 | `V4-red.log` / 1 | `V4-green.log` / 0 |
| U1 | `U1-red.log` / 1 | `U1-green.log` / 0 |
| U1 caller-supplied compact preset | `U1-preset-red.log` / 1 | `U1-preset-green.log` / 0 |
| U3 | `U3-red.log` / 1 | `U3-green.log` / 0 |
| W2/W4 long overflow | `overflow-red.log` / 1 | `overflow-green.log` / 0 |
| V1 retain reset/rate facts | `V1-retain-fields-red.log` / 1 | `V1-retain-fields-green.log` / 0 |
| W4 same-row waste deduplication | `W4-dedup-red.log` / 1 | `W4-dedup-green.log` / 0 |
| W5 simultaneous missing console / stale live | `W5-combined-red.log` / 1 | `W5-combined-green.log` / 0 |

The 80x20/80x16 host allocations are 4/3 rendered rows (existing `pages/ux-gate2-share.test.ts` documents these allocations); tests also cover 7/8-row compact and full 160x40 page contexts.

## 5. Final verification

- Baseline named full suite: exit 1, **1567 pass / 15 fail**, `base.log`.
- Final tests against immutable base: `PANE_R3_BASE_REF=cc9bde3db bash mods/live/evidence/pane-r3-share/focused.sh mods/live/pages/pane-r3-share.test.ts`, exit 1, **0 pass / 9 assertion failures**, `final-tests-on-base.log`.
- Final band integration (`U1-preset-green.log`): focused runner on `mods/live/pages/pane-r3-share.test.ts mods/live/ux-gate2.test.ts`, exit 0, **28 pass / 0 fail**, `U1-preset-green.log`.
- Affected page/frame suites: focused runner on the 17 files named in `affected-final.log`, exit 0, **425 pass / 0 fail**.
- `node --test mods/live/ui-lint.test.js`: exit 0, **56 pass / 0 fail**, `ui-lint.log`.
- `node mods/live/gen-locales.js --check`: exit 0 (also rerun by the final full suite).
- Named full suite: `AUTOPILOT_MODS_REAL_CLAUDE=/home/team/.local/share/claude/versions/2.1.327 bash mods/live/run-tests.sh < /dev/null`; **exit 1, 1576 pass / 15 accepted baseline fail**, `final.log`. Exact failing names equal the baseline; no new failures; nine additional tests pass. The acceptance comparison exits **0**; see `verification.json`.
- `git diff --check`: exit 0 before commit (absolute worktree path pinned in tool invocation).

Earlier diagnostic runs are retained: `affected.log`, `affected-2.log`, `affected-3.log`, `affected-4.log`, `affected-final.log`, `prefinal.log`, `gate1-green.log`, `locales-cleanup.log`, `verdict-green.log`. They are not presented as the final full-suite result.

## Deferred / out of scope

- W1, W3 and every finding outside the assigned eight; no host-row investigation or parallel-branch edits.
- 120x30 stale screenshot: owner explicitly reserved capture for this round; no screenshot fabricated.
- The 15 accepted baseline failures; no tests disabled or deleted to hide them.
- No merge, deployment or release. Cross-model-family review belongs to the caller's independent review step; this receipt does not claim that review occurred.

## Changed files and reasons

See [changed-files.md](changed-files.md), generated from the actual diff and evidence paths; each changed file has one reason.

Final comparison: `verification.json` records 0 new failing names, 0 removed failing names and all nine new tests passing. No tests were removed from the total: baseline 1582 tests, final 1591 tests.

Commit gate note: the lab hook flagged the task-supplied verification executable path as local-path content. Its documented `Lab-Hook-Override` false-positive trailer records that provenance; hooks remain enabled. Evidence logs retain all output text and assertion values, with trailing whitespace on physical lines normalized for the staged whitespace check.
