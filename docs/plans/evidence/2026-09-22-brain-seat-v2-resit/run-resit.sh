#!/usr/bin/env bash
# grok-4.7 low re-sits the depth-0 paper on brain-seat-v2.
#
# Why this sitting exists: on v1 every engine scored plants 4/5 and every miss was
# `reversal` (docs/plans/evidence/2026-09-22-depth0-reversal-attribution/). v2
# reshapes that plant, makes open_findings respond to close_finding, and closes
# three verified false passes. This is the empirical check that the reshape did
# what the attribution predicts — a fix that only passes its own unit tests is not
# evidence about the exam.
#
# Rail notes carried over from the v1 sweep (each cost a bisect once):
#  - THREE nested budgets. QRP_TIMEOUT_MS (adapter→CLI) must expire BEFORE
#    --remote-timeout-ms (broker), or the outer kills the child and the inner
#    diagnosis is never written. Broker caps at 600s.
#  - The broker replaces HOME, so the grok CLI cannot find ~/.grok. QRP_CLI_HOME
#    points at a CREDENTIAL-ONLY seed; never the real ~/.grok (8 GB) and never run
#    grok against the seed itself (it initialises to 491 files / 14 MB, over the
#    adapter's 8 MB clone cap).
#  - --remote-provider-cmd needs an absolute path: the broker's cwd is its own temp dir.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
G=docs/plans/evidence/2026-09-22-brain-seat-v2-resit
ID="$G/identity-brain-low.json"
PROMPT_HASH=$(node -e "console.log(require('./$ID').prompt_config_hash)")
SEM=$(node -e "console.log(require('./$ID').semantic_fingerprint)")
CON=$(node -e "console.log(require('./$ID').containment_fingerprint)")
HARNESS=$(node -e "console.log(require('./$ID').harness_version)")

QRP_TIMEOUT_MS=570000 \
QRP_TRANSPORT=cli QRP_CLI_KIND=grok QRP_PROMPT_MODE=brain \
QRP_CLI_HOME="$HOME/.autopilot/exam-grok-home" \
QRP_MODEL=grok-4.7 QRP_PROVIDER=grok-cli QRP_CLI_EFFORT=low \
timeout 5400 bash scripts/engine-qualify.sh brain \
  --engine grok-4.7 --model grok-4.7 --model-version grok-4.7 \
  --runner grok --runner-version 1.0.40 --family xai \
  --harness-version "$HARNESS" --effort low \
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
  --raw-dir "$G/raw-brain-low" \
  > "$G/out-brain-low.json" 2> "$G/err-brain-low.log"
echo "=== resit exit=$? $(date -Is) ===" >> "$G/progress.txt"
