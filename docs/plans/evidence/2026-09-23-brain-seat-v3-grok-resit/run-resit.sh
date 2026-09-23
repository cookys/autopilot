#!/usr/bin/env bash
# grok-4.7 low and xhigh re-sit depth-0 on brain-seat-v3.
# Paper change: family_standard is on the artifact, severity is exactly major,
# round 12 converges only on declare_done.
# Rail notes (each previously cost a bisect):
#  - QRP_TIMEOUT_MS must expire before --remote-timeout-ms (broker cap 600s).
#  - QRP_CLI_HOME is a credential-only seed. Never run grok against that directory.
#  - --remote-provider-cmd is an absolute path.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
G=docs/plans/evidence/2026-09-23-brain-seat-v3-grok-resit

run_one() {
  local EFFORT="$1"
  local ID="$G/identity-brain-$EFFORT.json"
  local PROMPT_HASH SEM CON HARNESS
  PROMPT_HASH=$(node -e "console.log(require('./$ID').prompt_config_hash)")
  SEM=$(node -e "console.log(require('./$ID').semantic_fingerprint)")
  CON=$(node -e "console.log(require('./$ID').containment_fingerprint)")
  HARNESS=$(node -e "console.log(require('./$ID').harness_version)")
  mkdir -p "$G/raw-brain-$EFFORT"
  echo "=== brain $EFFORT start $(date -Is) ===" >> "$G/progress.txt"
  QRP_TIMEOUT_MS=570000 \
  QRP_TRANSPORT=cli QRP_CLI_KIND=grok QRP_PROMPT_MODE=brain \
  QRP_CLI_HOME="$HOME/.autopilot/exam-grok-home" \
  QRP_MODEL=grok-4.7 QRP_PROVIDER=grok-cli QRP_CLI_EFFORT="$EFFORT" \
  timeout 10800 bash scripts/engine-qualify.sh brain \
    --engine grok-4.7 --model grok-4.7 --model-version grok-4.7 \
    --runner grok --runner-version 1.0.41 --family xai \
    --harness-version "$HARNESS" --effort "$EFFORT" \
    --prompt-config-hash "$PROMPT_HASH" \
    --semantic-fingerprint "$SEM" \
    --containment-fingerprint "$CON" \
    --remote-provider-cmd "node $PWD/scripts/qualification-review-provider.js" \
    --remote-provider grok-cli \
    --remote-timeout-ms 600000 \
    --provider-env QRP_MODEL --provider-env QRP_PROVIDER \
    --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
    --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT \
    --provider-env QRP_CLI_HOME --provider-env QRP_TIMEOUT_MS \
    --task-class brain-seat --domain cross-cutting --language en --tool read_only \
    --version-source operator-asserted \
    --raw-dir "$G/raw-brain-$EFFORT" \
    > "$G/out-brain-$EFFORT.json" 2> "$G/err-brain-$EFFORT.log"
  echo "=== brain $EFFORT exit=$? $(date -Is) ===" >> "$G/progress.txt"
}

run_one low &
run_one xhigh &
wait
echo "=== both exit $(date -Is) ===" >> "$G/progress.txt"
