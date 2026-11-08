#!/usr/bin/env bash
# endpoint-probe.sh — sourced by dispatch-hetero.sh and dispatch-consult.sh. One function:
#   endpoint_preprobe <endpoint-name> <model>
# Runs scripts/lib/endpoint-probe.js (GET <base>/models, 2 s total) and sets
#   PROBE_JSON  the helper's one-line JSON ("" when the probe is off or produced nothing)
#   PROBE_DECISION  ok|unreachable|busy|inconclusive|skipped|"" (off)
#   PROBE_CLASS  endpoint_unreachable|endpoint_busy|""   PROBE_STATUS  PROBE_MS  PROBE_REASON
# AUTOPILOT_ENDPOINT_PREPROBE=off turns the probe off (a LAN endpoint that serves no /models).
# Pure: no state is written, so one failed probe never marks the endpoint down for the next dispatch.

endpoint_preprobe() {
  local name="$1" model="$2" helper_dir
  helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROBE_JSON=""; PROBE_DECISION=""; PROBE_CLASS=""; PROBE_STATUS=""; PROBE_MS=""; PROBE_REASON=""
  [ "${AUTOPILOT_ENDPOINT_PREPROBE:-on}" = "off" ] && return 0
  PROBE_JSON="$(node "$helper_dir/endpoint-probe.js" --endpoint "$name" --model "$model" 2>/dev/null < /dev/null)" || PROBE_JSON=""
  [ -n "$PROBE_JSON" ] || return 0
  local parsed
  parsed="$(node -e '
let j; try { j = JSON.parse(process.argv[1]); } catch { process.exit(0); }
const f = (v) => (v === null || v === undefined ? "" : String(v)).replace(/[|\n]/g, " ");
process.stdout.write([j.decision, j.class, j.status, j.ms, j.reason].map(f).join("|"));
' "$PROBE_JSON" 2>/dev/null)" || parsed=""
  IFS='|' read -r PROBE_DECISION PROBE_CLASS PROBE_STATUS PROBE_MS PROBE_REASON <<< "$parsed"
  return 0
}
