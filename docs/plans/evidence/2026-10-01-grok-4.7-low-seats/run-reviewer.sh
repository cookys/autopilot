#!/usr/bin/env bash
# grok-4.7 reviewer, effort low. One administration.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
G=docs/plans/evidence/2026-10-01-grok-4.7-low-seats
ID="$G/fingerprint-reviewer.json"
PROMPT_HASH=$(node -e "console.log(require('./$ID').prompt_config_hash)")
SEM=$(node -e "console.log(require('./$ID').semantic_fingerprint)")
CON=$(node -e "console.log(require('./$ID').containment_fingerprint)")
HARNESS=$(node -e "console.log(require('./$ID').harness_version)")
RUNNER=$(node -e "console.log(require('./$ID').runner_version)")
mkdir -p "$G/reviewer/raw"
echo "=== reviewer low start $(date -Is) ===" >> "$G/reviewer-progress.txt"
QRP_TIMEOUT_MS=300000 \
QRP_TRANSPORT=cli QRP_CLI_KIND=grok QRP_PROMPT_MODE=reviewer \
QRP_CLI_HOME="$HOME/.autopilot/exam-grok-home" \
QRP_MODEL=grok-4.7 QRP_PROVIDER=grok-cli QRP_CLI_EFFORT=low \
timeout 14400 bash scripts/engine-qualify.sh reviewer \
  --engine grok-4.7 --model grok-4.7 --model-version grok-4.7 \
  --runner grok --runner-version "$RUNNER" --family xai \
  --harness-version "$HARNESS" --effort low \
  --prompt-config-hash "$PROMPT_HASH" \
  --semantic-fingerprint "$SEM" \
  --containment-fingerprint "$CON" \
  --remote-provider-cmd "node $PWD/scripts/qualification-review-provider.js" \
  --remote-provider grok-cli \
  --remote-timeout-ms 360000 \
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER \
  --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
  --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT \
  --provider-env QRP_CLI_HOME --provider-env QRP_TIMEOUT_MS \
  --task-class code_review --domain cross-cutting --language en --tool read_only \
  --version-source operator-asserted \
  --raw-dir "$G/reviewer/raw" --emit-row \
  > "$G/reviewer/qualify-out.json" 2> "$G/reviewer/qualify-err.log"
qexit=$?
echo "QUALIFY_EXIT=$qexit" >> "$G/reviewer/qualify-err.log"
if [ -s "$G/reviewer/qualify-out.json" ] && grep -q '{' < <(head -c 1 "$G/reviewer/qualify-out.json"); then
  node scripts/engine-scorecard.js record --file "$G/reviewer/qualify-out.json" \
    > "$G/reviewer/record-out.json" 2> "$G/reviewer/record-err.log"
  echo "RECORD_EXIT=$?" >> "$G/reviewer/record-err.log"
fi
echo "=== reviewer low exit=$qexit $(date -Is) ===" >> "$G/reviewer-progress.txt"
exit "$qexit"
