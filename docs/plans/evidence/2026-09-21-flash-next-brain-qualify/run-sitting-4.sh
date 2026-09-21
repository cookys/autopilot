#!/usr/bin/env bash
# flash-next brain-seat administration (2026-09-21, cuda).
#
# TWO RECIPE ERRORS were corrected here after sitting 1 died on transport. Both are
# independently sufficient to fail, and both are present in the recipes that were
# circulating (the 2026-08-17 dogfood README and the aimax395 dispatch note):
#   1. --remote-provider-cmd MUST be an ABSOLUTE path. The broker runs the provider
#      command with cwd set to its own temp providerRoot, so a relative
#      'node scripts/qualification-review-provider.js' cannot resolve.
#   2. QRP_PROMPT_MODE MUST be in the --provider-env allowlist. The broker scrubs the
#      environment down to that list, so without it the adapter falls back to its
#      default 'reviewer' mode and refuses the owner-role brain case.
# QRP_TRANSPORT does not need to be listed (its default is already http).
#   3. QRP_MAX_TOKENS must be set AND listed for a reasoning deployment — same
#      allowlist mechanism as (2). See the export below.
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
# A reasoning deployment spends this budget on its thinking block. 8192 (the adapter
# default) ran out mid-thought at round 5-6 as the round bundle grew, and the reply
# came back as a lone thinking block with no answer (sittings 2 and 3). Measured:
# a 3.2 KB round-6 bundle already spent 7132 output tokens, and round-12 bundles are
# larger still. This value is part of the administration's disclosed identity.
export QRP_MAX_TOKENS=32768

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
  --semantic-fingerprint a5df1ecb7d113ea9b040c0e33a877437227056899c17ca02da861038db249075 \
  --containment-fingerprint cd222ee9ac6d9a9d97dd0e1fd98d4bcf052cd228cab6974248d9d5ffdf8ffa98 \
  --remote-provider-cmd "$PWD/docs/plans/evidence/2026-09-21-flash-next-brain-qualify/qrp-stderr-tee.sh" \
  --remote-provider sglang-flash-next \
  --provider-env QRP_BASE_URL \
  --provider-env QRP_AUTH_TOKEN \
  --provider-env QRP_MODEL \
  --provider-env QRP_PROVIDER \
  --provider-env QRP_PROMPT_MODE \
  --provider-env QRP_MAX_TOKENS \
  --task-class brain-seat \
  --domain cross-cutting \
  --language en \
  --tool read_only \
  --version-source runtime \
  --raw-dir "$B/raw-sitting-4"
