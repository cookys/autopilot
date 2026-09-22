#!/usr/bin/env bash
# muse-spark-1.3-contributor: brain (depth-0) and reviewer (also covering the qc seat).
#
# Usage: run-seat.sh <brain|reviewer>
#
# Transport: the OpenAI RESPONSES protocol (v2.36.87). This model is one of the 5
# OpenCode Go ids served only there; /v1/messages answers 503 for it, which reads like
# an outage and is not one. x-opencode-session is mandatory on both protocols.
# QRP_MAX_TOKENS is set high because the thinking block is billed against the same
# budget: at 64 this model spends 61 on reasoning and returns no output_text at all.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
M=docs/plans/evidence/2026-09-22-muse-spark-1.3-seat-sweep
ROLE="${1:?usage: run-seat.sh <brain|reviewer>}"
ID="$M/identity-$ROLE.json"

export QRP_TRANSPORT=http
export QRP_HTTP_PROTOCOL=responses
export QRP_PROMPT_MODE="$ROLE"
export QRP_BASE_URL=https://opencode.ai/zen/go
export QRP_AUTH_TOKEN="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.local/share/opencode/auth.json","utf8"))["opencode-go"].key)')"
export QRP_OPENCODE_SESSION="ses_$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)"
export QRP_MODEL=muse-spark-1.3-contributor
export QRP_PROVIDER=opencode-go
export QRP_MAX_TOKENS=32768

if [ "$ROLE" = "brain" ]; then
  SCOPE=(--task-class brain-seat --domain cross-cutting --language en --tool read_only)
else
  SCOPE=(--task-class code_review --domain cross-cutting --language en --tool read_only)
fi

exec bash scripts/engine-qualify.sh "$ROLE" \
  --engine muse-spark-1.3-contributor \
  --model muse-spark-1.3-contributor \
  --model-version muse-spark-1.3-contributor \
  --runner anthropic-compatible \
  --runner-version opencode-go-responses-v1 \
  --family meta \
  --harness-version "$(node -e "console.log(require('./$ID').harness_version)")" \
  --effort default \
  --prompt-config-hash "$(node -e "console.log(require('./$ID').prompt_config_hash)")" \
  --semantic-fingerprint "$(node -e "console.log(require('./$ID').semantic_fingerprint)")" \
  --containment-fingerprint "$(node -e "console.log(require('./$ID').containment_fingerprint)")" \
  --remote-provider-cmd "node $PWD/scripts/qualification-review-provider.js" \
  --remote-provider opencode-go \
  --provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN \
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER \
  --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
  --provider-env QRP_HTTP_PROTOCOL --provider-env QRP_OPENCODE_SESSION \
  --provider-env QRP_MAX_TOKENS \
  "${SCOPE[@]}" \
  --version-source runtime \
  --raw-dir "$M/raw-$ROLE" \
  --emit-row
