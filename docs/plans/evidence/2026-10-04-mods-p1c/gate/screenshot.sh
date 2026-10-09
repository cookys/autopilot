#!/usr/bin/env bash
# gate/screenshot.sh <capture-dir>
#
# Colour screenshots of a capture (dev-time, not shipped): pane.ansi (`capture-pane -e -p`) -> ansi2html.py -> headless chrome.
#   <capture-dir>/band-<W>.png   the band line alone (W = window width from meta.json), at >= 10 px per column so the full width shows
#   <capture-dir>/pane.png       the whole pane
# The absolute PNG paths are written into meta.json under `screenshots`. Plain `capture-pane -p` has no colour: a readability or
# theme-key claim needs these PNGs (look at them). The headless font draws some glyphs (⏸ ▰) smaller than a real terminal.
# Environment: GATE_CHROME (chrome-headless-shell binary), GATE_ANSI2HTML (default the tui-band evidence dir's ansi2html.py).
set -u
if [ $# -ne 1 ] || [ ! -d "$1" ]; then echo "usage: $0 <capture-dir>" >&2; exit 2; fi
DIR=$(cd "$1" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
A2H=${GATE_ANSI2HTML:-$HERE/../../2026-10-06-tui-band/ansi2html.py}
CHROME=${GATE_CHROME:-$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell}
[ -f "$DIR/pane.ansi" ] || { echo "no pane.ansi in $DIR (captured by an older capture.sh?)" >&2; exit 2; }
[ -f "$A2H" ] || { echo "ansi2html.py not found: $A2H" >&2; exit 2; }
[ -x "$CHROME" ] || { echo "chrome-headless-shell not found: $CHROME" >&2; exit 2; }
export GATE_SHOT_DIR=$DIR
# one node step: pick the band line out of pane.ansi (the raw line, escapes kept), size the windows, print "<width> <cols> <rows>"
SIZES=$(node - <<'NODE'
const fs = require('fs'); const path = require('path');
const dir = process.env.GATE_SHOT_DIR;
const ansi = fs.readFileSync(path.join(dir, 'pane.ansi'), 'utf8').replace(/\n$/, '');
const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (_e) { return {}; } })();
const strip = (s) => s.replace(/\x1b\[[0-9;:]*[A-Za-z]/g, '');
const cells = (s) => { let w = 0; for (const ch of strip(s)) { const c = ch.codePointAt(0); w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1; } return w; };
const lines = ansi.split('\n');
let bandLine = '';
let plain = '';
try { plain = fs.readFileSync(path.join(dir, 'band.txt'), 'utf8').split('\n')[0]; } catch (_e) { /* none */ }
if (plain) { const hit = lines.findLast((l) => strip(l).includes(plain)); if (hit) bandLine = hit; }
fs.writeFileSync(path.join(dir, 'band.ansi'), `${bandLine}\n`);
const width = Number.isFinite(meta.window_width) ? meta.window_width : Math.max(...lines.map(cells));
process.stdout.write(`${width} ${Math.max(width, ...lines.map(cells))} ${lines.length}`);
NODE
) || exit 2
read -r W COLS ROWS <<<"$SIZES"
PX_W=$((COLS * 10 + 32))          # >= 9 px per column (15 px DejaVu Sans Mono is ~9.0) plus the 2 x 8 px padding
shoot() { # <ansi-file> <png> <rows>
  python3 -I "$A2H" "$1" "${1%.ansi}.html" || return 1
  "$CHROME" --no-sandbox --hide-scrollbars --screenshot="$2" --window-size="$PX_W,$(( $3 * 19 + 24 ))" "file://${1%.ansi}.html" >/dev/null 2>&1
  [ -s "$2" ]
}
BAND_PNG=$DIR/band-$W.png; PANE_PNG=$DIR/pane.png
if [ -s "$DIR/band.ansi" ] && [ "$(wc -c < "$DIR/band.ansi")" -gt 1 ]; then shoot "$DIR/band.ansi" "$BAND_PNG" 1 || { echo "band screenshot failed" >&2; BAND_PNG=; }
else echo "no band line in pane.ansi: band-$W.png skipped" >&2; BAND_PNG=; fi
shoot "$DIR/pane.ansi" "$PANE_PNG" "$ROWS" || { echo "pane screenshot failed" >&2; PANE_PNG=; }
export GATE_BAND_PNG=$BAND_PNG GATE_PANE_PNG=$PANE_PNG
node -e '
const fs = require("fs"); const f = process.env.GATE_SHOT_DIR + "/meta.json";
let m = {}; try { m = JSON.parse(fs.readFileSync(f, "utf8")); } catch (_e) { /* none */ }
m.screenshots = { band: process.env.GATE_BAND_PNG || null, pane: process.env.GATE_PANE_PNG || null };
fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");'
[ -n "$BAND_PNG" ] && echo "$BAND_PNG"
[ -n "$PANE_PNG" ] && echo "$PANE_PNG"
[ -n "$BAND_PNG$PANE_PNG" ]
