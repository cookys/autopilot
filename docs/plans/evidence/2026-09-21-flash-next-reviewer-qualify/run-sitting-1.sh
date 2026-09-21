#!/usr/bin/env bash
# flash-next reviewer-seat administration (2026-09-21, cuda).
#
# Recipe follows docs/plans/evidence/2026-08-17-roster-qualification/glm53-qualify/README.md
# (same corpus, same prompt, same runner label) with three corrections that the older
# recipes do not carry — each one independently fatal, all three learned the hard way
# on the brain seat the same day:
#   1. --remote-provider-cmd MUST be an ABSOLUTE path. The broker runs the provider
#      command with cwd set to its own temp providerRoot.
#   2. QRP_PROMPT_MODE MUST be in the --provider-env allowlist. The broker scrubs the
#      child environment down to that list; without it the adapter falls back to its
#      'reviewer' default (harmless HERE, since this IS the reviewer seat — but the
#      allowlist mechanism is the same and is listed for symmetry and clarity).
#   3. QRP_MAX_TOKENS must be set AND listed for a reasoning deployment: the thinking
#      block is billed against the same completion budget as the answer.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
R=docs/plans/evidence/2026-09-21-flash-next-reviewer-qualify

. <(grep -E '^AUTOPILOT_ENDPOINT_FLASH_NEXT_(URL|TOKEN)=' ~/.autopilot/endpoints.env)

export QRP_TRANSPORT=http
export QRP_PROMPT_MODE=reviewer
export QRP_BASE_URL="$AUTOPILOT_ENDPOINT_FLASH_NEXT_URL"
export QRP_AUTH_TOKEN="$AUTOPILOT_ENDPOINT_FLASH_NEXT_TOKEN"
export QRP_MODEL=qwen3.8-flash-next
export QRP_PROVIDER=sglang-flash-next
export QRP_MAX_TOKENS=32768

exec bash scripts/engine-qualify.sh reviewer \
  --engine qwen3.8-flash-next \
  --model qwen3.8-flash-next \
  --model-version qwen3.8-flash-next \
  --runner anthropic-compatible \
  --runner-version 0.0.0.dev17270-gfb1216c6c \
  --family alibaba \
  --harness-version engine-qualify-5c498e99 \
  --effort default \
  --prompt-config-hash 3cbe203c5958ec413269d63e2d5d1841336394d15f3c4a3ab4285ea3e73e3530 \
  --semantic-fingerprint fe4a102a684751cd962edbf76ce2e9aa9b3b2d64bf59d0bf2eba305019a98b11 \
  --containment-fingerprint 8b46dca183416dba76098551ea81c0db5766df3fb97c93718671cb8d0686343c \
  --remote-provider-cmd "$PWD/$R/qrp-stderr-tee.sh" \
  --remote-provider sglang-flash-next \
  --provider-env QRP_BASE_URL \
  --provider-env QRP_AUTH_TOKEN \
  --provider-env QRP_MODEL \
  --provider-env QRP_PROVIDER \
  --provider-env QRP_PROMPT_MODE \
  --provider-env QRP_MAX_TOKENS \
  --task-class code_review \
  --domain cross-cutting \
  --language en \
  --tool read_only \
  --version-source runtime \
  --emit-row
