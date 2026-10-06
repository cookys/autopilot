# TUI spike report (claude 2.1.289, tmux -L gate, 200x50)

Plugin: tui-spike/plug (register.tsx, spin.tsx). Captures: tui-spike/captures/*.ansi|.txt

## Dev-load command (typed in the tmux pane; hot-reload on save works, transcript shows "tuispike: reloaded")
CLAUDE_CODE_TMUX_TRUECOLOR=1 COLORTERM=truecolor claude --model sonnet --plugin-dir <scratch>/tui-spike/plug
(plugin.json minimal; hooks/hooks.json = {"modules":["../register.tsx"]}; `claude plugin validate` passes.)
Slash commands: /spike-pane (opens S5 pane), /spike-band s1|s2|s3|s4|s123|s1x (what the band draws).

## Key facts
- COLOR: inside tmux Claude CLAMPS to 256 colours (binary: `if(TMUX && level>2) level=2` unless env CLAUDE_CODE_TMUX_TRUECOLOR is set). Without it every hex/rgb colour arrives as 38;5;N (captures fs-band-*, fs-pane = 256). With CLAUDE_CODE_TMUX_TRUECOLOR=1 (COLORTERM=truecolor) real 38;2/48;2 are emitted (fs-truecolor-*, final-*, main-*). tmux itself passes truecolor (verified with printf). Owner's session needs that env var for exact colours; otherwise colours are nearest-256.
- Default layout under tmux here is FULLSCREEN: isFullscreen=true, band maxRows=18 (taller trees scroll with "N more"), band bodyColumns=195. CLAUDE_CODE_NO_FLICKER=0: isFullscreen=false, maxRows=50, pane opens INLINE above the prompt (~11 rows, bodyColumns 196).
- Fullscreen + pane docked (200 cols): pane bodyColumns=89 (~90 wide, right side); band narrows to bodyColumns=105 and AbovePrompt viewport.columns=110. S1 colour-format row then wraps badly (no wrap control) - size to e.props.bodyColumns.

## S1 band Box+Text: RENDERED
- Hex/rgb()/ansi256()/named all work for color and backgroundColor: #ff5555 -> 48;2;255;85;85; rgb(255,85,85) same; ansi256(203) -> 48;5;203; named red -> theme red 229;72;77.
- Theme keys work (dark theme values): warning 255;193;7, permission 177;185;249, inactive 153;153;153, success 78;186;101, error 255;107;128.
- GOTCHA: `inverse` + backgroundColor emits SGR 7 + 48;..., which a terminal shows as coloured TEXT on default-fg block (colours swapped), not a coloured badge. Use backgroundColor + explicit color WITHOUT inverse (final-fs-band-s123 row [S1b]: 1;38;2;0;0;0;48;2;255;85;85 etc.). Bare `inverse color=red` = 7 + 38;..; also swapped.
- Glyphs seen: █ ░ │ and CJK fine. dimColor = SGR 2 (or grey).
## S2 border: RENDERED. round ╭╮╰╯, single ┌┐└┘, double ╔╗╚╝ all draw correctly in tmux; borderColor #ff5555 -> 38;2;255;85;85 on the border glyphs. CJK content aligned inside.
## S3 Raster on band: RENDERED (no refusal). 20x1 gauge █ green 51;221;85 / ░ grey 102;102;102 truecolor; 20x2 sparkline with ▁..█ blocks, two colours. cells = base64 of u32 triplets (btoa over Uint8Array works). Degrades to nearest-256 without the TMUX_TRUECOLOR env.
## S4 Client on band: RENDERED. Client module (spin.tsx, module="./spin.tsx") draws; s.every(1000) spinner animated across captures (tick=2,3,4,5; frames ⠹⠸⠼⠴). Raster is NOT in the Client element table (ClientElements omits Client/Raster/Image) - types only, not run. Client receives s.columns (=105 when pane docked).
## S5 pane (opened by /spike-pane, command.run counts as asked; placed at 200 cols): RENDERED, bordered table, fixed-width row Boxes [14,10,10,8,8].
- CJK alignment: CORRECT. Display-width (east-asian W=2) of the column start for every row is identical: runner col 17, 階段 col 27, 經過 37, 安靜 45, Raster gauge 53, in both layouts (fs-truecolor-pane.txt, main-pane.txt). Naive character counts differ per row, so never measure alignment by len().
- Per-row Raster gauge (10x1) renders in the pane. Fullscreen: isFullscreen true, command presentation columns 200, pane body 89. Inline (NO_FLICKER=0): isFullscreen false, body 196.
## SGR summary (esc counts per capture; tc=truecolor sequences, c256=256): fs-band-s123-top esc29 tc0 c256 93 inv11 (no env) | fs-pane tc0 c256 206 | fs-truecolor-s123 esc28 tc87 | fs-truecolor-pane tc157 | main-pane tc166. 7 = inverse present only where inverse used; 38;2 truecolor appears only with CLAUDE_CODE_TMUX_TRUECOLOR=1.

## Left running
tmux session `tui` (server `gate`), fullscreen, truecolor, band shows S1+S2+S3 (17-18 rows, fits maxRows 18, no scroll). Owner attach (read-only):
  tmux -L gate attach -r -t tui
