# TUI follow-ups (2026-10-10): OSC 8 in gate screenshots, keyboard tab cycling, spend sparkline

Real-machine facts, scratch plugin `aplive-scratch` (a copy of `mods/live` plus a debug trail rendered in the pane; the real autopilot disabled by `--settings`), private tmux server, Claude Code 2.1.296.

## B: Ctrl+x Tab, Enter at 120 columns

Reproduced before the fix. Pane open on Legend, ring on the pane: `C-x Tab` landed the ring on the pane's ACTIVE tab Button (autoFocus) and every Enter pressed that Button:
`Enter -> [IIIIIIIIIITl]`, `Enter -> [IIIIIIIITlTl]` (I = the band's ⓘ press, Tl = press on the Legend tab Button, a no-op: the tab already showing). Ring on the ⓘ instead (pane closed, or pane never visited): every Enter was an `I` and the tabs cycled, hence "intermittent". 209 columns: the pane auto-docks and the ring starts on ⓘ, so it passed there.

Fix: the first-drawn Button of the pane is a `▸` next-tab chip carrying the only autoFocus ("of several in one site the first drawn wins"); the tab Buttons keep their mouse / Tab-arrow press (select that tab) and no longer take autoFocus. Re-verified with the same scratch plugin: `C-x Tab, Enter x3` at 120 columns, then `C-x Tab, Enter x3` (pane open) gave `IIIIIIINNN` (the ring on the chip: `N` = chip press), 6 events per 6 Enters in 7 trials at 120 and 209 columns; Tab then Enter selects a tab (`Tn`) and the ring returns to the chip (`r`); an SGR click on 審查 selects it (`Tr`, ring move refused `r!` because a click leaves the keyboard in the prompt). `keyboard-w120-after-sequence.png` shows the strip with the chip highlighted.

## A: OSC 8

`ansi2html.py` now parses OSC 8 (ST or BEL terminated) into `<a href>` around the link text and strips every other OSC / DCS / APC / PM / SOS string; `gate/check.test.js` has a fixture with both terminators.

## C: spend sparkline

`<live>/runs/spend-history.json` (schema `autopilot.spend-history/1`, host-wide, one sample per 15 minutes, 48 hours, atomic) is written by the runs watcher; the Spend tab draws 24 hourly buckets of spend added per hour. `spend-<locale>-<width>.png` are drawn from the real model code (`spendTabLines`) with a synthetic day of samples at 60 / 76 / 90 columns in en and zh-TW.
