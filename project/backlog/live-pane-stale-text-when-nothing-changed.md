# live pane says stale when nothing changed (BL-0365)

Reported by the openclaw fleet session (report 01M6BK2FVVCH6BHAJJPE095XEQ, reply 01M6BK34N1Z70RKBGGVJRX9X2J), relaying the operator:

> 打字打到一半跳出「資料過舊 · 上次發佈 20:54 · watcher 沒有在發佈」是在幹嘛？我不是說沒有新的就沒有過期嗎？

## Defect

`mods/live/register.ts:449-457` returns `STATE_TEXT.stale(at)` when `fresh` is empty and `found.moved !== true`. That one branch merges two cases:

- (a) The watcher has exited (writer null) and the source did not change. By the owner's rule this is not stale. It should be a neutral state, for example "no new change (last hh:mm)".
- (b) The watcher is alive but has not published for longer than valid_for_s (stuck). This deserves a warning, but the text must say the watcher is not moving, not that the data is stale.

## Also check

"Pops up while typing": does the pane's refresh switch the state in a way that disturbs input?

## Constraints

- Trigger: after the two migration-plan P1 prerequisite lanes (planpath, sealbase) merge.
- UI text and state change: before merge, show the owner real-terminal before and after screenshots and get confirmation (docs/plans/2026-10-13-live-pane-design-system.md section 12: one colour one meaning; colours only through PALETTE in mods/live/ui.ts).
- After the fix merges, send the sha back to the fleet session.
