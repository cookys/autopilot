#!/usr/bin/env bash
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [ "${AUTOPILOT_LIVE_CODEX:-0}" != "1" ]; then
  echo "SKIP codex-pre-effect-production-live: set AUTOPILOT_LIVE_CODEX=1"
  exit 0
fi

command -v codex >/dev/null 2>&1 || {
  echo "FAIL codex-pre-effect-production-live: codex binary is unavailable" >&2
  exit 1
}

OUTPUT="${AUTOPILOT_CODEX_PRE_EFFECT_RECEIPT:-$REPO_ROOT/docs/projects/2026-08-05-codex-native-lifecycle-enforcement/evidence/codex-pre-effect-production-live-receipt.json}"
node "$REPO_ROOT/platforms/codex/hook-probe/pre-effect-contract-probe.js" --output "$OUTPUT"
