# mods/live recent conversation: groups expand by mouse only

Re-run 2026-10-16 on Claude Code 2.1.301 in tmux (isolated socket, mirrored data, `--plugin-dir` of the worktree).

- The group and section toggle lines are already `Button`s (`mods/live/pane.tsx` `line()`), so the mod draws them correctly.
- Probe: open the pane (Ctrl+x Tab), press Tab (or Down, or Right) n times, then Enter, n = 1..20, returning to the Now tab between probes. Enter only ever selected one of the tab-strip Buttons (tab changes at n = 1, 2, 3, 4, then it repeated); no probe folded or expanded a body Button. The host focus ring does not reach the body Buttons.
- Enter on the leading `›` chip (autoFocus) cycles tabs, which is the documented keyboard path.
- No change that keeps look and colour: the mod cannot add Buttons to the ring. Options: (a) a Button `hotkey` on the section/group lines (the host draws it as `k: label`, a visible change, owner call); (b) a host change so body Buttons join the ring; (c) accept mouse-only for the group toggles.
