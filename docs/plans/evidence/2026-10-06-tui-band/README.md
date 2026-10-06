# Band as a TUI (2026-10-06) — owner decisions, spike facts, open questions

Context: after the W4 real-machine gate passed across all modes (`../2026-10-04-mods-p1c/gate/runs/RESULTS.md`), the owner asked why the band is plain text 「你應該學 BBS 或是 TUI？」 and chose **B: make the band a TUI first, re-run the real-machine gate, then release 2.37.0** (v2.37.0 stays unreleased; origin is 2.36.116).

## Owner decisions (binding)

1. **B** — TUI before 2.37.0, then re-gate, then release.
2. **Variant V4a** — ONE band line: colored glyph + verdict word + indicators, ending in a clickable `ⓘ`. Capture: `captures/v4a.png`.
3. **Clean `ⓘ`** — no `hotkey` on the Button (a hotkey draws as `i: ⓘ`); the keyboard path is Ctrl+x Tab then Enter (the ⓘ has `autoFocus`).
4. **The legend lives in a click-to-open panel, not next to the icons** — pressing `ⓘ` opens a pane with 「圖例」 (glyph → meaning) and 「目前」 (project, phase, reason, dispatch table). Capture: `captures/v4-legend.png`.
5. **Colors follow the Claude Code theme** — theme keys as TEXT color only; no backgroundColor, no inverse, no hex/rgb/ansi256 (the first spike's inverse/background badges were unreadable: `captures/s123-first-spike.png`).
6. **codeforge** (`~/projects/codeforge`, the status-line/pet CLI) should also become its own Claude Code mod plugin — not merged into autopilot (different product narrative; data contract via live context files stays). Separate repo/session; after autopilot's TUI lands, share one TUI style guide (theme-key palette, glyph table, ⓘ legend pattern) and agree a band-row budget between the two mods.

## Palette and glyphs (as built in the spike, owner-previewed)

| State | Glyph | Theme key |
|---|---|---|
| 要你決定 | ▲ | warning |
| 疑似卡住 | ⏸ | error |
| 完成待驗收 | ✓ | success |
| 進行中 | ● | suggestion |
| 待命 | ◌ | inactive |

Indicators: progress `▰` success / `▱` inactive (`2 done*` dim and no bar when the denominator is unfrozen); `◷` elapsed; `⚙ n` live dispatches; `⏸ n` stalled (error); `◆ n` decided on your behalf (claude); `? n` no decision record (inactive). Zero values are omitted. A reason line appears only for 要你決定 / 疑似卡住 — and with V4a it moves into the ⓘ panel.
Theme keys present in Claude Code 2.1.289 (dark/light/ansi/daltonized variants exist): claude, permission, planMode, ide, promptBorder, text, inactive, subtle, suggestion, remember, success, error, warning.

## Spike facts (Claude Code 2.1.289, over ssh + tmux) — `spike-REPORT.md`

- Band (AbovePrompt): size to `e.props.bodyColumns` (narrower when a pane is docked); fullscreen `maxRows` ≈ 16–18, taller trees scroll with "n more". Box borders (round/single/double…) draw correctly in tmux. **Raster** (truecolor cell grid, `[codePoint, fg, bg]`) renders on the band and in the pane. **Client** (TSX surface module, 1 s `every`) renders on the band; a Client cannot contain a Raster.
- Colors: `#hex`, `rgb()`, `ansi256()`, named and theme keys all parse; but **inside tmux Claude Code clamps to 256 colors unless `CLAUDE_CODE_TMUX_TRUECOLOR=1`** (read in the binary, confirmed by captures). `inverse` + `backgroundColor` swaps them (colored text on a block) — never use.
- Pane: docks right from ~110 columns in the fullscreen layout (tmux default is fullscreen); a pane opened by a press/command counts as "asked" and is placed. A mouse click on a Button works in tmux (`set -g mouse on` on this host); hover tooltips via an absolute Box at `top: -1` work.
- Keyboard: the band takes the keys after **Ctrl+x Tab**; Tab/arrows walk buttons, Enter presses, Esc returns to the prompt; a pane opened with `focus, closeOnEscape` behaves as a dialog. A Button `hotkey` presses it while the site holds the keys.
- CJK: double-width alignment in fixed-width Box columns is correct (measure by display width, not `len()`).
- Verification: plain `capture-pane -p` strips all color — a readability claim needs the colored screenshot: `capture-pane -e -p` → `ansi2html.py` (this dir) → headless chrome (`~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell --no-sandbox --hide-scrollbars --screenshot=X.png --window-size=1720,1000 file://X.html`) → look at the PNG. The headless font draws `⏸` / `▰` smaller than a real terminal.

Spike plugin (static sample data, not product code): `spike-plugin/` — `/spike-band v1|v2|v3|v3b|v4a|v4b|v4a1|s123`, `/spike-legend`, `/spike-pane`; dev-load with `claude --plugin-dir <dir>` (see `spike-REPORT.md`).

## Open questions (owner raised; not decided)

> **2026-10-06 update:** owner ruled no placeholder UI. The band waits for the stage graph: [`../../2026-10-06-dev-flow-stage-graph.md`](../../2026-10-06-dev-flow-stage-graph.md). Its P7 implements V4a on the structured marker fields; the questions below are answered there (progress = frozen `unit k/N`; position = `size·level ▸ stage`; review strength `·n族`).

- **What the progress slot means.** Today `3/5` is either campaign deliverables (frozen controller receipt) or session tasks (`done*`, unfrozen) — ambiguous to the reader. Proposal: show `60%` (frozen only), plus a two-level position `▸ 4/5 <deliverable>·<phase>`.
- **ETA** `⏳ 約 8m` — no source exists; only a naive estimate (average completed deliverable × remaining), frozen-only, dim.
- **Gantt in the panel** — `src/status/planned-input.js` already lists campaign deliverables (done/remaining, titles) or session tasks; per-deliverable timing source is unverified.
- **"Which phase / which task"** depends on dev-flow's stage model, which the owner judged badly designed → inventory `../2026-10-06-dev-flow-stage-inventory/README.md`; a stage-model redesign (one vocabulary across S/Fix/L/H, no clash with /l3–/l6, a mechanical writer into the marker `phase`) is a guidance change → eval evidence first. Decide with the owner: ship the TUI on today's data (deliverables/tasks) and plug the stage model in later, or redesign stages first.
