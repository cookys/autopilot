#!/usr/bin/env bash
# grok-4.7 brain-seat (depth-0) administration at the two ENDS of the effort scale.
# low and xhigh only (operator narrowed this from four cells, 2026-09-22): the middle
# tiers buy nothing the ends do not bracket, and every cell is a real 24-round sitting.
#
# Why four cells and not one: the grok CLI REALLY forwards --effort (live enum
# re-probed 2026-09-22: `grok --effort bogus -p hi` lists exactly xhigh|high|medium|low,
# and the adapter's grokEffortClamp passes it through). That is the opposite of the
# cc-shim / HTTP-broker path, where the body carries only model/max_tokens/temperature
# and any tier label would be fiction. So effort is part of the exam identity here and
# each tier gets its own semantic_fingerprint.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
G=docs/plans/evidence/2026-09-22-grok-4.7-seat-sweep

for EFFORT in low xhigh; do
  ID="$G/identity-brain-$EFFORT.json"
  PROMPT_HASH=$(node -e "console.log(require('./$ID').prompt_config_hash)")
  SEM=$(node -e "console.log(require('./$ID').semantic_fingerprint)")
  CON=$(node -e "console.log(require('./$ID').containment_fingerprint)")
  HARNESS=$(node -e "console.log(require('./$ID').harness_version)")
  mkdir -p "$G/raw-brain-$EFFORT"
  echo "=== brain $EFFORT start $(date -Is) ===" >> "$G/sweep-progress.txt"

  # The broker sets HOME to its own empty temp dir (credential isolation), so the grok
  # CLI cannot find ~/.grok and every round dies as provider_process_failed. The
  # adapter's generic QRP_CLI_HOME clone is the supported way through: point it at a
  # CREDENTIAL-ONLY seed (20 KB: auth.json + agent_id + .metadata_version), never the
  # real ~/.grok, which is 8 GB and would be copied per case.
  QRP_TRANSPORT=cli QRP_CLI_KIND=grok QRP_PROMPT_MODE=brain \
  QRP_CLI_HOME="$HOME/.autopilot/exam-grok-home" \
  QRP_MODEL=grok-4.7 QRP_PROVIDER=grok-cli QRP_CLI_EFFORT="$EFFORT" \
  timeout 5400 bash scripts/engine-qualify.sh brain \
    --engine grok-4.7 --model grok-4.7 --model-version grok-4.7 \
    --runner grok --runner-version 1.0.40 --family xai \
    --harness-version "$HARNESS" --effort "$EFFORT" \
    --prompt-config-hash "$PROMPT_HASH" \
    --semantic-fingerprint "$SEM" \
    --containment-fingerprint "$CON" \
    --remote-provider-cmd "node $PWD/scripts/qualification-review-provider.js" \
    --remote-provider grok-cli \
    --provider-env QRP_MODEL --provider-env QRP_PROVIDER \
    --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
    --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT \
    --provider-env QRP_CLI_HOME \
    --task-class brain-seat --domain cross-cutting --language en --tool read_only \
    --version-source operator-asserted \
    --raw-dir "$G/raw-brain-$EFFORT" \
    > "$G/out-brain-$EFFORT.json" 2> "$G/err-brain-$EFFORT.log"
  echo "=== brain $EFFORT exit=$? $(date -Is) ===" >> "$G/sweep-progress.txt"
done
echo "=== brain sweep complete $(date -Is) ===" >> "$G/sweep-progress.txt"
