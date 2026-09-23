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

# ⚠ THE ENUM IS PER-MODEL, not per-CLI (probe 2026-09-23, grok 1.0.41):
#   grok-4.5 → high|medium|low      (xhigh REJECTED: "use one of: high, medium, low")
#   grok-4.6 / grok-4.7 → xhigh|high|medium|low
# A single global table can therefore be right for the default model and wrong for an explicit
# `--model grok-4.5` in the same CLI build — which is exactly how a dispatch failed rc=1 while
# this file's own live probe (default model only) stayed green. So: when the caller knows the
# model, ask THAT model for its live enum; the static table is only the fallback.

# grok_effort_live_enum <model> [bin] → comma-separated live enum for that model, or empty.
# One bogus value makes grok print its whole enum and exit before any inference. Empty result
# (no model, no binary, probe disabled with AUTOPILOT_GROK_EFFORT_PROBE=0, timeout, unparseable
# output) means "unknown" — callers then use the static table, never a guess.
grok_effort_live_enum() {
  local model="${1:-}" bin="${2:-${GROK_BIN:-grok}}" raw
  [ -n "$model" ] || return 0
  [ "${AUTOPILOT_GROK_EFFORT_PROBE:-1}" = 0 ] && return 0
  command -v "$bin" >/dev/null 2>&1 || return 0
  # Run from a neutral cwd: the probe must never touch the caller's worktree/repo (a CLI or wrapper
  # that writes files on invocation would otherwise dirty the tree the dispatch is about to use).
  raw="$(cd "${TMPDIR:-/tmp}" && timeout "${AUTOPILOT_GROK_EFFORT_PROBE_TIMEOUT:-20}" "$bin" --model "$model" \
          --reasoning-effort __autopilot_probe__ -p hi </dev/null 2>&1 | head -3 || true)"
  printf '%s' "$raw" | grep -q 'unknown effort level' || return 0
  printf '%s' "$raw" | sed -n 's/.*use one of: //p' | head -1 | tr -d ' \r'
}

# grok_effort_clamp <effort> [model] [bin] → grok-accepted level on stdout.
# With a model and a readable live enum: the requested level if that model accepts it, else the
# highest accepted level BELOW it, else the lowest accepted level. Without one: the static table.
# Unknown/empty input degrades to `xhigh` (then to that model's ceiling) rather than failing: this
# lib's job is to keep a dispatch runnable, and the caller's own --effort validation already
# rejected out-of-scale values before reaching here.
grok_effort_clamp() {
  local want enum lvl best="" first=""
  case "${1:-}" in
    low|medium|high|xhigh) want="$1" ;;
    *) want=xhigh ;;   # max / empty / unknown → grok's top level
  esac
  enum="$(grok_effort_live_enum "${2:-}" "${3:-}")"
  if [ -n "$enum" ]; then
    for lvl in low medium high xhigh; do
      case ",$enum," in *",$lvl,"*) ;; *) continue ;; esac
      [ -n "$first" ] || first="$lvl"
      best="$lvl"
      [ "$lvl" = "$want" ] && break
    done
    # `best` = highest accepted level <= want. It can overshoot only when want is below every
    # accepted level; then take the lowest accepted one.
    case "$want:$best" in
      low:medium|low:high|low:xhigh|medium:high|medium:xhigh|high:xhigh) best="$first" ;;
    esac
    [ -n "$best" ] && { printf '%s' "$best"; return 0; }
  fi
  printf '%s' "$want"
}

# grok_effort_note <requested> [context] [model] [bin] [clamped] — stderr heads-up only when a clamp
# actually happened. Pass the already-computed [clamped] value to avoid a second live-enum probe.
grok_effort_note() {
  local requested="${1:-}" context="${2:-grok}" model="${3:-}" clamped="${5:-}"
  [ -n "${DISPATCH_QUIET:-}" ] && return 0
  [ -n "$clamped" ] || clamped="$(grok_effort_clamp "$requested" "$model" "${4:-}")"
  [ "$requested" = "$clamped" ] && return 0
  printf '%s: effort %s is not accepted by grok%s — running at %s.\n' \
    "$context" "$requested" "${model:+ model $model}" "$clamped" >&2
}
