# Live TUI v2 — infographic redesign + i18n (2026-10-10)

Owner-approved design (6 tabs, tab badges, rule-line sections, key/value columns, colour semantics, glyph vocabulary, stage-walk diagram and spend bar in the band, spend + QC kept at narrow widths) and the zh-TW wording rulings (Hygiene tab = 殘留, Spend tab = 用量, Review = 審查).

| File | What |
|---|---|
| `ia.md` | information architecture, colour semantics, glyph vocabulary, band width table, data gaps (design hand, before the owner's changes) |
| `i18n.md` | string-table, locale-selection and CJK width plan (implemented as `mods/live/{i18n.ts,gen-locales.js,locales/}`) |
| `design-mockup.png` | the approved mockup (design hand's renderer) |
| `rendered-from-model.png` | the same states drawn by the REAL model code (`mods/live/model.ts` via a node script): band idle / running / blocked at 209 / 160 / 140 / 120 / 80 columns in en and zh-TW, then the panel tabs |
| `spike/` | active-tab style spike on the real machine |

## Active-tab spike (real machine: Claude Code 2.1.296 over a private tmux server, `claude --plugin-dir <scratch>`, 200 x 50)

Candidates, active tab "Dispatch" with badges: (a) `backgroundColor` WITHOUT inverse (theme key `subtle`, raw `#3a3a3a`, `claude` with black text, `suggestion` with black text, raw orange with white text), (b) a drawn bracket card with the baseline under the inactive tabs, (c) bold + underline + a `▔▔` under-bar, (d) background + a baseline rule. Also (e) a Button wrapping a Text that carries the background.

- Truecolor (`CLAUDE_CODE_TMUX_TRUECOLOR=1`): `spike/tabs-tc.png`, `spike/pane-tc.png`. Every background-only variant is legible (grey `subtle` with bold default text, orange with black text, lavender with black text); (b) and (c) read well but cost 2-3 rows and a width-sensitive baseline.
- 256 colours (no `CLAUDE_CODE_TMUX_TRUECOLOR`): `spike/tabs-256.png`. Claude Code maps `subtle` to xterm 239 (`48;5;239`), the raw `#3a3a3a` to 237, `claude` to 174, `suggestion` to 153; all stay legible, the grey ones with the least contrast change between the two modes.
- Earlier finding stands: `inverse` + `backgroundColor` swaps the colours (coloured text on a grey block) and is unreadable. Without `inverse`, background + default text is fine.
- (e) works: `<Button plain bold><Text backgroundColor="subtle" bold>…</Text></Button>` draws the background inside the Button.
- Fixed-width rules longer than the pane wrap in a ~90-column dock (the baseline overflowed in the spike): the shipped rule is sized to the pane's `bodyColumns` and `wrap="truncate"`.

Winner: `backgroundColor="subtle"` on the active tab, bold default text, a `subtle` baseline rule under the strip. It uses only a theme key (so a light theme keeps its own contrast), needs no raw colour, and is legible in both colour modes. Not verified: a light theme, and the ssh-only terminal the owner uses (depth-0 captures the live plugin after merge).
