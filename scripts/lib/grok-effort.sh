# shellcheck shell=bash
# grok-effort.sh — map autopilot's 5-level effort scale onto the grok CLI's 4 levels.
#
# Provides:
#   grok_effort_clamp <effort>            → echoes a grok-accepted level (low|medium|high|xhigh)
#   grok_effort_note  <requested> <bin>   → one-line stderr heads-up IFF the value was clamped
#
# WHY THIS EXISTS
# ---------------
# The xAI Grok Build CLI DOES accept `--reasoning-effort` (alias `--effort`), but it
# validates the value against a 3-item enum and **hard-fails** on anything else:
#
#   $ grok --effort max -p hi
#   {"type":"error","message":"--effort/--reasoning-effort: unknown effort level 'max';
#                              use one of: xhigh, high, medium, low"}
#
# Probe-verified 2026-08-19 (grok 1.0.5 (5115b46bc9)):
#   low → accepted | medium → accepted | high → accepted | xhigh → accepted
#   max → REJECTED (hard error)
#
# ⚠ THIS ENUM MOVES. The 2026-07-25 probe (grok 0.2.111, grok-4.5) found xhigh REJECTED,
# and this file clamped xhigh→high for a month after xAI shipped it. A stale clamp is
# worse than no clamp: it silently under-delivers a level the operator asked for and the
# engine can now honour, while printing a confident note saying the level does not exist.
# Re-probe with `grok --effort bogus -p hi` — the CLI's own error lists the live enum.
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
# Unknown/empty input degrades to `xhigh` (the grok ceiling) rather than failing: this lib's
# job is to keep a dispatch runnable, and the caller's own --effort validation already
# rejected out-of-scale values before reaching here.
grok_effort_clamp() {
  case "${1:-}" in
    low)    printf 'low' ;;
    medium) printf 'medium' ;;
    high)   printf 'high' ;;
    xhigh)  printf 'xhigh' ;;
    max)    printf 'xhigh' ;;     # grok ceiling; see probe table above
    *)      printf 'xhigh' ;;
  esac
}

# grok_effort_note <requested> [context] — stderr heads-up only when a clamp actually happened.
grok_effort_note() {
  local requested="${1:-}" context="${2:-grok}"
  [ -n "${DISPATCH_QUIET:-}" ] && return 0
  local clamped
  clamped="$(grok_effort_clamp "$requested")"
  [ "$requested" = "$clamped" ] && return 0
  printf '%s: effort %s is not a grok level (accepts low|medium|high|xhigh) — running at %s.\n' \
    "$context" "$requested" "$clamped" >&2
}
