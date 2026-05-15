#!/usr/bin/env bash
# risk-counter.sh — persistent WTF-Likelihood Cap counter.
# Removes the cross-round LLM tracking burden documented at
# skills/quality-pipeline/SKILL.md:89-103.
#
# Usage:
#   scripts/risk-counter.sh status                        # JSON state
#   scripts/risk-counter.sh increment --event <kind>      # add risk delta
#   scripts/risk-counter.sh threshold-hit                 # exit 1 if risk > 20
#   scripts/risk-counter.sh reset                         # zero out
#
# Events and increments (from SKILL.md):
#   reverted          +15  (fix didn't work)
#   multi-file         +5  (fix touches 3+ files)
#   late-fix           +1  (10th+ fix in same run)
#   unrelated-files   +20  (fix touches files unrelated to original change)
#   fix                 0  (just counts toward fixes total)
#
# State lives at: $AUTOPILOT_STATE_DIR/risk-<repo>-<branch>.json
#   Default: $HOME/.autopilot/state/

set -euo pipefail

STATE_DIR="${AUTOPILOT_STATE_DIR:-$HOME/.autopilot/state}"
mkdir -p "$STATE_DIR"

REPO_KEY="$(git rev-parse --show-toplevel 2>/dev/null | sed 's|/|_|g' | sed 's|^_||')"
BRANCH_KEY="$(git branch --show-current 2>/dev/null | sed 's|/|_|g' || echo no-branch)"
STATE_FILE="$STATE_DIR/risk-${REPO_KEY:-norepo}-${BRANCH_KEY}.json"

init_state() {
  echo '{"risk":0,"fixes":0,"reverted":0,"events":[]}' > "$STATE_FILE"
}
[[ -f "$STATE_FILE" ]] || init_state

mutate_state() {
  # $1 event, $2 delta
  local event="$1" delta="$2"
  if command -v jq >/dev/null 2>&1; then
    local tmp; tmp="$(mktemp)"
    jq --arg evt "$event" --argjson d "$delta" \
      '.risk += $d
       | .fixes += 1
       | (if $evt == "reverted" then .reverted += 1 else . end)
       | .events += [{event:$evt, delta:$d, ts:(now|todate)}]' \
      "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$STATE_FILE" "$event" "$delta" <<'PY'
import json, sys, datetime
path, event, delta = sys.argv[1], sys.argv[2], int(sys.argv[3])
with open(path) as f: d = json.load(f)
d['risk']  = d.get('risk', 0) + delta
d['fixes'] = d.get('fixes', 0) + 1
if event == 'reverted':
    d['reverted'] = d.get('reverted', 0) + 1
d.setdefault('events', []).append({
    'event': event, 'delta': delta,
    'ts': datetime.datetime.utcnow().isoformat() + 'Z',
})
with open(path, 'w') as f: json.dump(d, f, indent=2)
PY
  else
    echo "neither jq nor python3 available; cannot mutate state" >&2
    exit 2
  fi
}

read_risk() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.risk' "$STATE_FILE"
  else
    python3 -c "import json,sys; print(json.load(open('$STATE_FILE'))['risk'])"
  fi
}

CMD="${1:-status}"
shift || true

case "$CMD" in
  status)
    cat "$STATE_FILE"
    ;;
  reset)
    init_state
    echo "reset: $STATE_FILE"
    ;;
  increment)
    EVENT=""
    while [[ $# -gt 0 ]]; do
      case "$1" in --event) EVENT="$2"; shift 2 ;; *) shift ;; esac
    done
    [[ -z "$EVENT" ]] && { echo "missing --event" >&2; exit 2; }
    case "$EVENT" in
      reverted)        DELTA=15 ;;
      multi-file)      DELTA=5  ;;
      late-fix)        DELTA=1  ;;
      unrelated-files) DELTA=20 ;;
      fix)             DELTA=0  ;;
      *) echo "unknown event: $EVENT (known: reverted|multi-file|late-fix|unrelated-files|fix)" >&2; exit 2 ;;
    esac
    mutate_state "$EVENT" "$DELTA"
    cat "$STATE_FILE"
    ;;
  threshold-hit)
    risk="$(read_risk)"
    echo "risk=$risk threshold=20"
    [[ "$risk" -gt 20 ]] && exit 1 || exit 0
    ;;
  path)
    echo "$STATE_FILE"
    ;;
  *)
    echo "usage: $0 {status|reset|increment --event <kind>|threshold-hit|path}" >&2
    exit 2
    ;;
esac
