#!/usr/bin/env bash
# depth-0 / reviewer against local sglang on 127.0.0.1:8012.
# Usage: run-seat.sh brain|reviewer
set -uo pipefail
cd "$(dirname "$0")/../../../.."
M=docs/plans/evidence/2026-09-23-sglang-8012-seats
ROLE="${1:?usage: run-seat.sh brain|reviewer}"
case "$ROLE" in
  brain|reviewer) ;;
  *) echo "unknown role $ROLE" >&2; exit 2 ;;
esac
ID="$M/identity-$ROLE.json"
export QRP_TRANSPORT=http
export QRP_HTTP_PROTOCOL=chat_completions
export QRP_PROMPT_MODE="$ROLE"
export QRP_BASE_URL=http://127.0.0.1:8012
export QRP_AUTH_TOKEN=local
export QRP_MODEL=mimo-nvfp4
export QRP_PROVIDER=sglang
export QRP_MAX_TOKENS=32768
export QRP_TIMEOUT_MS=570000
if [ "$ROLE" = "brain" ]; then
  SCOPE=(--task-class brain-seat --domain cross-cutting --language en --tool read_only)
else
  SCOPE=(--task-class code_review --domain cross-cutting --language en --tool read_only)
fi
mkdir -p "$M/raw-$ROLE"
echo "=== $ROLE start $(date -Is) ===" >> "$M/progress.txt"
timeout 10800 bash scripts/engine-qualify.sh "$ROLE" \
  --engine mimo-nvfp4 --model mimo-nvfp4 --model-version mimo-nvfp4 \
  --runner anthropic-compatible \
  --runner-version "$(node -e "console.log(require('./$ID').runner_version)")" \
  --family xiaomi \
  --harness-version "$(node -e "console.log(require('./$ID').harness_version)")" \
  --effort default \
  --prompt-config-hash "$(node -e "console.log(require('./$ID').prompt_config_hash)")" \
  --semantic-fingerprint "$(node -e "console.log(require('./$ID').semantic_fingerprint)")" \
  --containment-fingerprint "$(node -e "console.log(require('./$ID').containment_fingerprint)")" \
  --remote-provider-cmd "node $PWD/scripts/qualification-review-provider.js" \
  --remote-provider sglang \
  --remote-timeout-ms 600000 \
  --provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN \
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER \
  --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
  --provider-env QRP_HTTP_PROTOCOL \
  --provider-env QRP_MAX_TOKENS --provider-env QRP_TIMEOUT_MS \
  "${SCOPE[@]}" \
  --version-source operator-asserted \
  --raw-dir "$M/raw-$ROLE" \
  --emit-row \
  > "$M/out-$ROLE.json" 2> "$M/err-$ROLE.log"
echo "=== $ROLE exit=$? $(date -Is) ===" >> "$M/progress.txt"
