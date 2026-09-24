#!/usr/bin/env bash
# OpenCode Go HTTP seat.
# Usage: run-seat.sh <muse-brain|muse-reviewer|mimo-brain|mimo-reviewer|flash-brain|flash-reviewer>
# muse-spark is Responses. Both MiMo 2.6 ids are Chat Completions (Go plan table).
set -uo pipefail
cd "$(dirname "$0")/../../../.."
M=docs/plans/evidence/2026-09-23-opencode-seat-sweep
WHICH="${1:?usage: run-seat.sh muse-brain|muse-reviewer|mimo-brain|mimo-reviewer|flash-brain|flash-reviewer}"
case "$WHICH" in
  muse-brain) ROLE=brain; ID="$M/identity-muse-brain.json"; ENGINE=muse-spark-1.3-contributor; FAMILY=meta; PROTO=responses ;;
  muse-reviewer) ROLE=reviewer; ID="$M/identity-muse-reviewer.json"; ENGINE=muse-spark-1.3-contributor; FAMILY=meta; PROTO=responses ;;
  mimo-brain) ROLE=brain; ID="$M/identity-mimo-brain.json"; ENGINE=mimo-v2.6-pro; FAMILY=xiaomi; PROTO=chat_completions ;;
  mimo-reviewer) ROLE=reviewer; ID="$M/identity-mimo-reviewer.json"; ENGINE=mimo-v2.6-pro; FAMILY=xiaomi; PROTO=chat_completions ;;
  flash-brain) ROLE=brain; ID="$M/identity-flash-brain.json"; ENGINE=mimo-v2.6-flash; FAMILY=xiaomi; PROTO=chat_completions ;;
  flash-reviewer) ROLE=reviewer; ID="$M/identity-flash-reviewer.json"; ENGINE=mimo-v2.6-flash; FAMILY=xiaomi; PROTO=chat_completions ;;
  *) echo "unknown seat $WHICH" >&2; exit 2 ;;
esac
export QRP_TRANSPORT=http
export QRP_HTTP_PROTOCOL="$PROTO"
export QRP_PROMPT_MODE="$ROLE"
export QRP_BASE_URL=https://opencode.ai/zen/go
export QRP_AUTH_TOKEN="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.local/share/opencode/auth.json","utf8"))["opencode-go"].key)')"
export QRP_OPENCODE_SESSION="ses_$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)"
export QRP_MODEL="$ENGINE"
export QRP_PROVIDER=opencode-go
export QRP_MAX_TOKENS=32768
export QRP_TIMEOUT_MS=570000
if [ "$ROLE" = "brain" ]; then
  SCOPE=(--task-class brain-seat --domain cross-cutting --language en --tool read_only)
else
  SCOPE=(--task-class code_review --domain cross-cutting --language en --tool read_only)
fi
mkdir -p "$M/raw-$WHICH"
echo "=== $WHICH start $(date -Is) ===" >> "$M/progress.txt"
timeout 10800 bash scripts/engine-qualify.sh "$ROLE" \
  --engine "$ENGINE" --model "$ENGINE" --model-version "$ENGINE" \
  --runner anthropic-compatible \
  --runner-version "$(node -e "console.log(require('./$ID').runner_version)")" \
  --family "$FAMILY" \
  --harness-version "$(node -e "console.log(require('./$ID').harness_version)")" \
  --effort default \
  --prompt-config-hash "$(node -e "console.log(require('./$ID').prompt_config_hash)")" \
  --semantic-fingerprint "$(node -e "console.log(require('./$ID').semantic_fingerprint)")" \
  --containment-fingerprint "$(node -e "console.log(require('./$ID').containment_fingerprint)")" \
  --remote-provider-cmd "node $PWD/scripts/qualification-review-provider.js" \
  --remote-provider opencode-go \
  --remote-timeout-ms 600000 \
  --provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN \
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER \
  --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
  --provider-env QRP_HTTP_PROTOCOL --provider-env QRP_OPENCODE_SESSION \
  --provider-env QRP_MAX_TOKENS --provider-env QRP_TIMEOUT_MS \
  "${SCOPE[@]}" \
  --version-source runtime \
  --raw-dir "$M/raw-$WHICH" \
  --emit-row \
  > "$M/out-$WHICH.json" 2> "$M/err-$WHICH.log"
echo "=== $WHICH exit=$? $(date -Is) ===" >> "$M/progress.txt"
