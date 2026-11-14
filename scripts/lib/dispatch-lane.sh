#!/usr/bin/env bash
# dispatch-lane.sh - sourceable: which lane a dispatch run belongs to, for the run manifest `lane` field.
#   dispatch_lane_json [prompt-file]  prints a JSON value: "<slug>" or null.
# Source order: $AUTOPILOT_LANE, else the `Lane:` field in the first 8 lines of the prompt file (either
# `Engine: x | Role: y | Lane: slug | Size: S` or one field per line), else null.
# A value that does not match ^[a-z0-9][a-z0-9._-]{0,63}$ is null (never an escaped or invented string).
# Pure bash, no node, never fails the caller.
dispatch_lane_json() {
  local lane="${AUTOPILOT_LANE:-}" pf="${1:-}" line n=0
  if [ -z "$lane" ] && [ -n "$pf" ] && [ -r "$pf" ]; then
    while { IFS= read -r line || [ -n "$line" ]; } && [ "$n" -lt 8 ]; do
      n=$((n + 1))
      line="${line%$'\r'}"
      if [[ "$line" =~ (^|\|)[[:space:]]*Lane:[[:space:]]*([^|[:space:]]*) ]]; then
        lane="${BASH_REMATCH[2]}"
        break
      fi
    done < "$pf"
  fi
  if [[ "$lane" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]]; then printf '"%s"' "$lane"; else printf 'null'; fi
  return 0
}

# dispatch_fleet_task_json [prompt-file]  prints "<ULID>" or null. Source order: a `Fleet-Task: <ULID>` line (or `| Fleet-Task:`
# header field) in the brief, else $AUTOPILOT_FLEET_TASK, else $AUTOPILOT_UPSTREAM_TASK_ID. Not a ULID -> null.
dispatch_fleet_task_json() {
  local pf="${1:-}" v="" line n=0
  local re='(^|\|)[[:space:]]*Fleet-Task:[[:space:]]*([^|[:space:]]*)'
  if [ -n "$pf" ] && [ -r "$pf" ]; then
    while { IFS= read -r line || [ -n "$line" ]; }; do
      line="${line%$'\r'}"
      if [[ "$line" =~ $re ]]; then v="${BASH_REMATCH[2]}"; break; fi
    done < "$pf"
  fi
  [ -n "$v" ] || v="${AUTOPILOT_FLEET_TASK:-}"
  [ -n "$v" ] || v="${AUTOPILOT_UPSTREAM_TASK_ID:-}"
  if [[ "$v" =~ ^[0-9A-HJKMNP-TV-Z]{26}$ ]]; then printf '"%s"' "$v"; else printf 'null'; fi
  return 0
}

# dispatch_pool_json <runner> [endpoint]  prints "<pool alias>" or null (lib/event-attribution.js; cached per run).
dispatch_pool_json() {
  if [ -z "${DISPATCH_POOL_JSON_CACHE:-}" ]; then
    local d="${BASH_SOURCE[0]%/*}" out=""
    out="$(node "$d/event-attribution.js" pool --runner "${1:-}" --endpoint "${2:-}" 2>/dev/null)" || out=""
    case "$out" in null|\"*\") ;; *) out=null ;; esac
    DISPATCH_POOL_JSON_CACHE="${out:-null}"
  fi
  printf '%s' "$DISPATCH_POOL_JSON_CACHE"
  return 0
}

# dispatch_attr_fields <prompt-file> <runner> <endpoint> [commit-sha]  prints `, "fleet_task": .., "pool": .., "commit": ..`
# for the run manifest. commit is only known once the run ended (a 7-64 hex sha), else null.
dispatch_attr_fields() {
  local commit="null"
  [[ "${4:-}" =~ ^[0-9a-f]{7,64}$ ]] && commit="\"$4\""
  printf ', "fleet_task": %s, "pool": %s, "commit": %s' "$(dispatch_fleet_task_json "${1:-}")" "$(dispatch_pool_json "${2:-}" "${3:-}")" "$commit"
  return 0
}

# dispatch_export_attribution <prompt-file>  hands the resolved lane and Fleet task to the child (its cost-tracker rows carry them).
# A null Fleet task exports AUTOPILOT_FLEET_TASK=none ("resolved, no task") so the child's fromEnv (lib/event-attribution.js, same
# first-non-empty-then-validate rule as dispatch_fleet_task_json; keep the two in agreement) does not fall back to an inherited id;
# AUTOPILOT_UPSTREAM_TASK_ID is left alone (the X-Fleet-Task header uses it). AUTOPILOT_PARENT_RUN_ID (already exported by the rails) is the child's run id.
dispatch_export_attribution() {
  local l t
  l="$(dispatch_lane_json "${1:-}")"; l="${l//\"/}"
  [ "$l" = "null" ] || export AUTOPILOT_LANE="$l"
  t="$(dispatch_fleet_task_json "${1:-}")"; t="${t//\"/}"
  if [ "$t" = "null" ]; then export AUTOPILOT_FLEET_TASK=none; else export AUTOPILOT_FLEET_TASK="$t"; fi
  return 0
}
