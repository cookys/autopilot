#!/usr/bin/env bash
# lib/context-window.sh — sourceable pre-dispatch context-window gate.
#
# Shared by the three dispatch rails (dispatch-hetero.sh / dispatch-review.sh /
# dispatch-author.sh) so the "does this input fit the engine's window?" question
# is asked in exactly one place. The arithmetic lives in
# scripts/check-context-window.js; this file is the shell-side policy wrapper.
#
# Contract:
#   context_window_gate <mode> <self_dir> <model> [input-file...]
#     mode      off | warn | block
#     self_dir  the caller's scripts/ dir (SELF_DIR / _REVIEW_SELF_DIR / ...)
#     model     the --model value, effort suffix included (the JS normalizes)
#     files     every file whose bytes will reach the engine
#
#   returns 0 => caller may dispatch
#   returns 1 => caller MUST fail closed (only possible in `block` mode)
#
#   sets CONTEXT_WINDOW_JSON    verdict object (empty when mode=off)
#        CONTEXT_WINDOW_VERDICT OK | OVER_BUDGET | UNKNOWN_WINDOW | skipped | gate_unavailable
#        CONTEXT_WINDOW_REASON  human-readable reason
#
# Deliberate posture — the gate is a COST control, not a security boundary. If
# the gate itself cannot run (node missing, script missing), it warns and lets
# the dispatch through rather than turning a tooling problem into a total
# dispatch outage. Only a real OVER_BUDGET verdict blocks.

# Resolve the effective mode: explicit arg wins, else AUTOPILOT_CONTEXT_WINDOW_GATE,
# else `block`. Garbage resolves to `block` (fail-closed on config typos, the
# same discipline resolve-qc-gate.sh uses).
context_window_mode() {
  local requested="${1:-}"
  [ -n "$requested" ] || requested="${AUTOPILOT_CONTEXT_WINDOW_GATE:-}"
  case "$requested" in
    off | warn | block) printf '%s' "$requested" ;;
    '') printf 'block' ;;
    *) printf 'block' ;;
  esac
}

# The dispatch rails' stdout+stderr is a MACHINE-PARSABLE result channel: callers do
# `OUT="$(dispatch-... 2>&1)"` and then JSON-parse it. Any chrome this gate prints there
# corrupts that parse. So every advisory line here respects the rails' existing
# DISPATCH_QUIET convention, exactly like the surrounding scripts do. The structured
# verdict always reaches the caller through CONTEXT_WINDOW_JSON / _VERDICT / _REASON,
# which the rails write into their raw log — diagnosis never depends on this printing.
_context_window_warn() {
  [ -n "${DISPATCH_QUIET:-}" ] && return 0
  printf 'WARNING: %s\n' "$1" >&2
  return 0
}

context_window_gate() {
  local mode="${1:-block}"
  local self_dir="${2:-}"
  local model="${3:-}"
  shift 3 2>/dev/null || true

  CONTEXT_WINDOW_JSON=""
  CONTEXT_WINDOW_VERDICT="skipped"
  CONTEXT_WINDOW_REASON=""

  if [ "$mode" = "off" ]; then
    CONTEXT_WINDOW_REASON="context-window gate disabled (mode=off)"
    return 0
  fi

  local gate="$self_dir/check-context-window.js"
  if [ ! -r "$gate" ] || ! command -v node > /dev/null 2>&1; then
    CONTEXT_WINDOW_VERDICT="gate_unavailable"
    CONTEXT_WINDOW_REASON="context-window gate unavailable (node or check-context-window.js missing); dispatch allowed"
    _context_window_warn "$CONTEXT_WINDOW_REASON"
    return 0
  fi

  local args=(--model "$model" --quiet)
  local f
  for f in "$@"; do
    # Only count files that exist and are readable. A caller-side optional input
    # (no spec file, no pack file) is simply absent, not an error — the JS treats
    # an unreadable --file as a usage error, so filter here.
    [ -n "$f" ] && [ -f "$f" ] && [ -r "$f" ] && args+=(--file "$f")
  done

  # Consult a recorded context_window observation when the store exists; the JS
  # treats a store without the dimension as a clean miss.
  # ${HOME:-} not $HOME: the rails run under `set -u`, and a dispatch launched from a
  # systemd scope / container / cron context can have no HOME at all. An unguarded
  # expansion aborts the ENTIRE rail — turning a fail-open cost gate into a hard outage,
  # the exact opposite of this file's stated posture.
  local cap_store="${AUTOPILOT_CAPABILITY_STATE:-${HOME:-}/.autopilot/engine-capability/capability.jsonl}"
  [ -r "$cap_store" ] && args+=(--capability-state "$cap_store")

  local out rc
  out="$(node "$gate" "${args[@]}" 2> /dev/null)"
  rc=$?

  if [ -z "$out" ]; then
    CONTEXT_WINDOW_VERDICT="gate_unavailable"
    CONTEXT_WINDOW_REASON="context-window gate produced no output (rc=$rc); dispatch allowed"
    _context_window_warn "$CONTEXT_WINDOW_REASON"
    return 0
  fi

  CONTEXT_WINDOW_JSON="$out"
  CONTEXT_WINDOW_VERDICT="$(printf '%s' "$out" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { process.stdout.write(String(JSON.parse(s).verdict || "")); } catch { process.stdout.write(""); }
});' 2> /dev/null)"
  CONTEXT_WINDOW_REASON="$(printf '%s' "$out" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { process.stdout.write(String(JSON.parse(s).reason || "")); } catch { process.stdout.write(""); }
});' 2> /dev/null)"

  [ -n "$CONTEXT_WINDOW_VERDICT" ] || CONTEXT_WINDOW_VERDICT="gate_unavailable"

  case "$CONTEXT_WINDOW_VERDICT" in
    OK)
      return 0
      ;;
    OVER_BUDGET)
      if [ "$mode" = "warn" ]; then
        _context_window_warn "context-window OVER_BUDGET (mode=warn, dispatching anyway): $CONTEXT_WINDOW_REASON"
        return 0
      fi
      return 1
      ;;
    UNKNOWN_WINDOW)
      # Never block, and never print: most models have no recorded window, so this
      # is the NORMAL state, not an anomaly. Printing it on every dispatch would be
      # constant noise. Same call made on the resolver side (it omits UNKNOWN_WINDOW
      # from capability_warnings). The verdict still reaches the rail's raw log via
      # CONTEXT_WINDOW_JSON.
      return 0
      ;;
    *)
      # Any unexpected verdict: report (this one IS anomalous), never block.
      _context_window_warn "context-window $CONTEXT_WINDOW_VERDICT: $CONTEXT_WINDOW_REASON"
      return 0
      ;;
  esac
}
