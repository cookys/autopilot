# shellcheck shell=bash
# grok-effort.sh — map autopilot's 5-level effort scale onto the grok CLI's 3 levels.
#
# Provides:
#   grok_effort_clamp <effort>            → echoes a grok-accepted level (low|medium|high)
#   grok_effort_note  <requested> <bin>   → one-line stderr heads-up IFF the value was clamped
#
# WHY THIS EXISTS
# ---------------
# The xAI Grok Build CLI DOES accept `--reasoning-effort` (alias `--effort`), but it
# validates the value against a 3-item enum and **hard-fails** on anything else:
#
#   $ grok --prompt-file p.txt --cwd . --model grok-4.5 --reasoning-effort xhigh ...
#   {"type":"error","message":"--effort/--reasoning-effort: unknown effort level 'xhigh';
#                              use one of: high, medium, low"}
#
# Probe-verified 2026-07-25 (grok 0.2.111 (94172f2aa4) [stable], model grok-4.5):
#   low → accepted | medium → accepted | high → accepted
#   xhigh → REJECTED (hard error) | max → REJECTED (hard error)
#
# autopilot's own scale is low|medium|high|xhigh|max and every dispatch script defaults
# to `EFFORT="xhigh"`. So passing `$EFFORT` through verbatim would break EVERY default
# grok dispatch — which is exactly why the flag went unwired until now (the grok block in
# dispatch-hetero.sh carries a "Do NOT add unverified flags" warning for this class of bug).
# Hence: clamp, don't pass through.
#
# Contrast with the qoder rail, which tolerates all 5 levels at the CLI layer and silently
# degrades an unhonored one — no clamp needed there. grok is stricter, so the mapping is here.
#
# HONESTY REQUIREMENT
# -------------------
# Clamping xhigh/max → high means the operator asked for a level the engine cannot deliver.
# That MUST be visible, otherwise the run silently under-delivers versus the recorded roster
# (`implementer_effort: high` in review-loop-config is already grok's ceiling; a config saying
# `xhigh` would be a capability claim the engine can't honor). `grok_effort_note` prints the
# clamp to stderr; silence it with DISPATCH_QUIET=1 like the other dispatch heads-ups.

[ -n "${_AUTOPILOT_GROK_EFFORT_SH:-}" ] && return 0
_AUTOPILOT_GROK_EFFORT_SH=1

# grok_effort_clamp <effort> → grok-accepted level on stdout.
# Unknown/empty input degrades to `high` (the grok ceiling) rather than failing: this lib's
# job is to keep a dispatch runnable, and the caller's own --effort validation already
# rejected out-of-scale values before reaching here.
grok_effort_clamp() {
  case "${1:-}" in
    low)    printf 'low' ;;
    medium) printf 'medium' ;;
    high)   printf 'high' ;;
    xhigh|max) printf 'high' ;;   # grok ceiling; see probe table above
    *)      printf 'high' ;;
  esac
}

# grok_effort_note <requested> [context] — stderr heads-up only when a clamp actually happened.
grok_effort_note() {
  local requested="${1:-}" context="${2:-grok}"
  [ -n "${DISPATCH_QUIET:-}" ] && return 0
  local clamped
  clamped="$(grok_effort_clamp "$requested")"
  [ "$requested" = "$clamped" ] && return 0
  printf '%s: effort %s is not a grok level (accepts low|medium|high) — running at %s.\n' \
    "$context" "$requested" "$clamped" >&2
}
