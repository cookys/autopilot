#!/usr/bin/env bash
# gate/widths.sh <cell-name> <tmux-target> [session-id]
#
# Width sweep for a running gate session (dev-time, not shipped). Resizes the tmux window of <tmux-target> to 209, 120 and 80 columns
# in turn (`tmux [-L socket] resize-window -t <target> -x <w>`), waits for the mod to redraw (>= 6 s; the mod ticks every 5 s), runs
# capture.sh into its own capture dir `<cell-name>-w<W>`, renders the colour screenshots (screenshot.sh), and puts the window back to
# its original width. One line per width: `<W> <capture dir>`; then run `node gate/check.js <dir>` on each.
# Environment: GATE_TMUX_SOCKET (tmux -L <name>), GATE_OUT, GATE_MODE, HOME ... exactly as capture.sh; GATE_REDRAW_S (default 8, min 6);
#   GATE_WIDTHS (default "209 120 80"); GATE_SKIP_SCREENSHOT=1 skips the PNGs.
# The window must be a session window that tmux lets you resize (an attached client larger than the target pins the size: use a
# detached private server `tmux -L gate new-session -d`, as DRIVER.md says; `window-size manual` is set for the sweep and restored).
set -u
set -o pipefail
if [ $# -lt 2 ] || [ $# -gt 3 ]; then echo "usage: $0 <cell-name> <tmux-target> [session-id]" >&2; exit 2; fi
CELL=$1; TARGET=$2; SID_ARG=${3:-}
HERE=$(cd "$(dirname "$0")" && pwd)
TMUX_CMD=(tmux)
[ -n "${GATE_TMUX_SOCKET:-}" ] && TMUX_CMD=(tmux -L "$GATE_TMUX_SOCKET")
WAIT=${GATE_REDRAW_S:-8}
[ "$WAIT" -ge 6 ] 2>/dev/null || WAIT=6
WIDTHS=${GATE_WIDTHS:-"209 120 80"}

ORIG_W=$("${TMUX_CMD[@]}" display -p -t "$TARGET" '#{window_width}') || { echo "tmux target not found: $TARGET" >&2; exit 2; }
ORIG_H=$("${TMUX_CMD[@]}" display -p -t "$TARGET" '#{window_height}')
ORIG_SIZE=$("${TMUX_CMD[@]}" show-window-options -v -t "$TARGET" window-size 2>/dev/null || true)
"${TMUX_CMD[@]}" set-window-option -t "$TARGET" window-size manual >/dev/null 2>&1 || true
restore() {
  "${TMUX_CMD[@]}" resize-window -t "$TARGET" -x "$ORIG_W" -y "$ORIG_H" >/dev/null 2>&1 || true
  if [ -n "$ORIG_SIZE" ]; then "${TMUX_CMD[@]}" set-window-option -t "$TARGET" window-size "$ORIG_SIZE" >/dev/null 2>&1 || true
  else "${TMUX_CMD[@]}" set-window-option -u -t "$TARGET" window-size >/dev/null 2>&1 || true; fi
}
trap restore EXIT
trap 'restore; exit 130' INT TERM # an interrupted sweep puts the window size back

RC=0
for W in $WIDTHS; do
  if ! "${TMUX_CMD[@]}" resize-window -t "$TARGET" -x "$W" -y "$ORIG_H" >/dev/null 2>&1; then echo "resize to $W failed" >&2; RC=1; continue; fi
  sleep "$WAIT"
  GOT=$("${TMUX_CMD[@]}" display -p -t "$TARGET" '#{window_width}')
  if [ "$GOT" != "$W" ]; then echo "window is $GOT columns after asking for $W (a larger attached client pins it?)" >&2; RC=1; fi
  OUT=$(bash "$HERE/capture.sh" "$CELL-w$W" "$TARGET" ${SID_ARG:+"$SID_ARG"} | head -n 1) || { echo "capture.sh failed at $W" >&2; RC=1; continue; }
  if [ ! -d "$OUT" ]; then echo "capture.sh printed no capture dir at $W: '$OUT'" >&2; RC=1; continue; fi
  [ "${GATE_SKIP_SCREENSHOT:-}" = 1 ] || bash "$HERE/screenshot.sh" "$OUT" >/dev/null || RC=1
  echo "$W $OUT"
done
exit $RC
