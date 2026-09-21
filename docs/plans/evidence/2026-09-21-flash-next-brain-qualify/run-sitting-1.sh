#!/usr/bin/env bash
# flash-next brain-seat administration, sitting 1 (2026-09-21, cuda).
# HTTP transport variant of the 2026-08-17 dogfood recipe (that one was CLI transport).
set -uo pipefail
cd "$(dirname "$0")/../../../.."
B=docs/plans/evidence/2026-09-21-flash-next-brain-qualify

# endpoint token: host-held, never printed, never into the evaluator sandbox
. <(grep -E '^AUTOPILOT_ENDPOINT_FLASH_NEXT_(URL|TOKEN)=' ~/.autopilot/endpoints.env)

export QRP_TRANSPORT=http
export QRP_PROMPT_MODE=brain
export QRP_BASE_URL="$AUTOPILOT_ENDPOINT_FLASH_NEXT_URL"
export QRP_AUTH_TOKEN="$AUTOPILOT_ENDPOINT_FLASH_NEXT_TOKEN"
export QRP_MODEL=qwen3.8-flash-next
export QRP_PROVIDER=sglang-flash-next

exec bash scripts/engine-qualify.sh brain \
  --engine qwen3.8-flash-next \
  --model qwen3.8-flash-next \
  --model-version qwen3.8-flash-next \
  --runner anthropic-compatible \
  --runner-version 0.0.0.dev17270-gfb1216c6c \
  --family alibaba \
  --harness-version engine-qualify-e9ecc652 \
  --effort default \
  --prompt-config-hash 5feb7076fc7ee775e8adfde08e56cc54bc5d715ea0d36c665a127ac7a7e41a84 \
  --semantic-fingerprint ce16a20ec9d79132886e6c8283f0e880f5782a2530c48d92c168f1e5cd3098f4 \
  --containment-fingerprint cd222ee9ac6d9a9d97dd0e1fd98d4bcf052cd228cab6974248d9d5ffdf8ffa98 \
  --remote-provider-cmd 'node scripts/qualification-review-provider.js' \
  --remote-provider sglang-flash-next \
  --provider-env QRP_BASE_URL \
  --provider-env QRP_AUTH_TOKEN \
  --provider-env QRP_MODEL \
  --provider-env QRP_PROVIDER \
  --task-class brain-seat \
  --domain cross-cutting \
  --language en \
  --tool read_only \
  --version-source runtime \
  --raw-dir "$B/raw-sitting-1"
