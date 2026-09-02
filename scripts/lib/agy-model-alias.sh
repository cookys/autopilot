#!/usr/bin/env bash
# agy model-alias resolution — the single owner for `gemini-flash[-tier]` -> live model id.
#
# WHY A SHARED LIB: three rails (dispatch-hetero.sh, dispatch-review.sh, dispatch-author.sh) each
# carried their own copy of this resolver, and all three carried the same defect — see below. That
# is the drift the runner->binary map was consolidated to stop in v2.34.44; one owner, one fix.
#
# THE DEFECT THIS FIXES (found 2026-09-02 by running the real CLI, not by reading the code):
# `agy models` emits TWO tab-separated columns — the id and its display name:
#
#     gemini-3.7-flash-high<TAB>Gemini 3.7 Flash (High)
#
# The old resolvers matched `^gemini-…-flash-<tier>$` against the WHOLE LINE, so the `$` anchor
# never matched anything real and every alias resolution failed closed with "no current canonical
# model". It looked healthy because the test stubs emitted id-only lines — a fixture that did not
# match reality, so a green suite proved nothing about the live path. Match the FIRST FIELD.
#
# CONTRACT: prints the resolved id on stdout and returns 0; on failure prints a one-line reason on
# stdout and returns non-zero. It never calls die_precondition itself: these run inside `$( )`, and
# a die there prints its JSON into the caller's variable instead of exiting the script.
#
#   MODEL="$(agy_resolve_model_alias "$MODEL" "$AGY_BIN" "$EFFORT")" \
#     || die_precondition "$MODEL"

# agy_is_model_alias <model> — true for the alias vocabulary, so callers do not restate the list.
agy_is_model_alias() {
  case "$1" in
    gemini-flash|gemini-flash-low|gemini-flash-medium|gemini-flash-high) return 0 ;;
    *) return 1 ;;
  esac
}

# agy_resolve_model_alias <model> <agy-bin> [effort]
# A non-alias model is echoed back unchanged — callers can pipe every model through this.
agy_resolve_model_alias() {
  local requested="$1" agy_bin="$2" effort="${3:-}" tier=high models resolved
  agy_is_model_alias "$requested" || { printf '%s' "$requested"; return 0; }

  # The alias suffix wins over --effort; a bare `gemini-flash` takes its tier from effort.
  case "$effort" in low) tier=low ;; medium) tier=medium ;; esac
  case "$requested" in *-low) tier=low ;; *-medium) tier=medium ;; *-high) tier=high ;; esac

  models="$(timeout 20 "$agy_bin" models 2>/dev/null)" || {
    printf 'agy model inventory unavailable; alias resolution fails closed'
    return 1
  }
  # awk takes field 1 so the display-name column cannot defeat the anchor; `sort -Vr` is version
  # order, not lexicographic — 3.10 must outrank 3.7.
  resolved="$(printf '%s\n' "$models" \
    | awk '{print $1}' \
    | grep -E "^gemini-[0-9]+([.][0-9]+)*-flash-${tier}$" \
    | sort -Vr | head -n 1)"
  if [ -z "$resolved" ]; then
    printf "agy alias '%s' has no current canonical model in the live inventory" "$requested"
    return 1
  fi
  printf '%s' "$resolved"
}
