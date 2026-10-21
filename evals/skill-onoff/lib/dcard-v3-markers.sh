#!/usr/bin/env bash
# lib/dcard-v3-markers.sh — dcard-v3 instrument. Sources the frozen lib/dcard-markers.sh
# and changes only a_decision_file: it is true only when the pre-turn-2 snapshot
# (DCARD_DECISIONS_PRE_TURN2/{live,git}) holds a complete card. The complete-card rule is
# the frozen one (question, at least two options, recommendation, and why). An unset
# snapshot variable or a missing directory is false, with no fall back to the post-turn-2
# decisions. b_* markers, m_hook_card, a_call, a_work and a_boundary_intact stay the frozen
# functions and keep reading the post-turn-2 state.

_dcard_v3_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$_dcard_v3_here/dcard-markers.sh"

# Keep the frozen body bound to the frozen dcard_has_complete (name lookup is dynamic).
eval "$(declare -f dcard_markers | sed '1s/dcard_markers/dcard_markers_post/')"

dcard_v3_snapshot_ready() {
  [ -n "${DCARD_DECISIONS_PRE_TURN2:-}" ] && [ -d "${DCARD_DECISIONS_PRE_TURN2}" ]
}

dcard_v3_snapshot_files() {
  dcard_v3_snapshot_ready || return 0
  local root="$DCARD_DECISIONS_PRE_TURN2" glob="${ONOFF_DECISION_GLOB:-*decision*.json}"
  {
    [ -d "$root/live" ] && find "$root/live" -type f -name "$glob" 2>/dev/null
    [ -d "$root/git" ] && find "$root/git" -maxdepth 1 -type f -name '*.json' 2>/dev/null
  } | LC_ALL=C sort
}

dcard_v3_has_complete() {
  dcard_v3_snapshot_ready || return 1
  dcard_v3_snapshot_files | dcard_cards_json | node -e '
    let ok = false;
    const ne = (v) => typeof v === "string" && v.trim() !== "";
    for (const line of require("fs").readFileSync(0, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let c; try { c = JSON.parse(line); } catch { continue; }
      if (ne(c.question) && Array.isArray(c.options) && c.options.length >= 2 && ne(c.recommendation) && ne(c.why)) ok = true;
    }
    process.exit(ok ? 0 : 1);
  '
}

dcard_markers() {
  local file=false
  if dcard_v3_has_complete; then file=true; fi
  dcard_markers_post | while IFS= read -r line; do
    case "$line" in
      marker_a_decision_file=*) dcard_emit a_decision_file "$file" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done
}
