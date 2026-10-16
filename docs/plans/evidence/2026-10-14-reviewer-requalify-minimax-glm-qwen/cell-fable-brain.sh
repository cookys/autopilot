#!/usr/bin/env bash
# cell-fable-brain.sh [suffix] — claude-fable-5-1 / claude-native / high, brain (owner_brain_seat) administration.
# Output out/m-fable-brain-high<suffix>/ ; run.log ends with 'rc=<n>'. Never records.
set -uo pipefail
SFX="${1:-}"; MODEL=claude-fable-5-1; EFFORT=high
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
D="$HERE/out/m-fable-brain-high$SFX"; mkdir -p "$D/raw"; LOG="$D/run.log"
LANE_DIR="$HOME/.autopilot/exam-claude-config-fable-high"
say() { echo "$(date -Is) $*" >> "$LOG"; }
fin() { echo "$1" > "$D/rc"; say "END rc=$1"; echo "rc=$1" >> "$LOG"; exit "$1"; }
cd "$REPO" || exit 2
source "$REPO/scripts/lib/qualify-stage-credentials.sh"
mkdir -p "$LANE_DIR" && chmod 700 "$LANE_DIR"
qualify_stage_credential "$LANE_DIR/.credentials.json" "$HOME/.claude/.credentials.json" execute
[ -f "$LANE_DIR/.credentials.json" ] || { say "no credentials staged"; fin 3; }
idv() { node -e "console.log(require('$HERE/identity-brain-fable-high.json')['$1'])"; }
say "START $MODEL $EFFORT"
( export QRP_TIMEOUT_MS=570000 QRP_TRANSPORT=cli QRP_CLI_KIND=claude QRP_PROMPT_MODE=brain QRP_MODEL=$MODEL QRP_PROVIDER=anthropic QRP_CLI_EFFORT=$EFFORT CLAUDE_CONFIG_DIR="$LANE_DIR"
  timeout 10800 bash scripts/engine-qualify.sh brain --engine $MODEL --model $MODEL --model-version $MODEL \
    --runner claude-native --runner-version "$(idv runner_version)" --family anthropic \
    --harness-version "$(idv harness_version)" --effort $EFFORT \
    --prompt-config-hash "$(idv prompt_config_hash)" --semantic-fingerprint "$(idv semantic_fingerprint)" \
    --containment-fingerprint "$(idv containment_fingerprint)" \
    --remote-provider-cmd "node $REPO/scripts/qualification-review-provider.js" --remote-provider anthropic --remote-timeout-ms 600000 \
    --provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_TIMEOUT_MS --provider-env QRP_CLI_EFFORT --provider-env CLAUDE_CONFIG_DIR \
    --task-class brain-seat --domain cross-cutting --language en --tool read_only --version-source operator-asserted \
    --raw-dir "$D/raw" --emit-row > "$D/stdout.json" 2> "$D/stderr.log" )
rc=$?; cp "$D/stdout.json" "$D/emit-row.json"; fin $rc
