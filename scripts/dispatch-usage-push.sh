#!/usr/bin/env bash
# Push this host's seven-day dispatch usage snapshot to the configured fleet address.
set -euo pipefail

if [[ -z ${AUTOPILOT_USAGE_PUSH_TO:-} ]]; then
  printf '%s\n' 'dispatch-usage-push: AUTOPILOT_USAGE_PUSH_TO is unset; skipping'
  exit 0
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
umask 077
if ! usage_tmp=$(mktemp "${XDG_RUNTIME_DIR:-/dev/shm}/dispatch-usage-push.XXXXXXXX"); then
  printf '%s\n' 'dispatch-usage-push: temporary file creation failed' >&2
  exit 1
fi
export USAGE_PUSH_TMP="$usage_tmp"
trap 'node -e '\''try { require("fs").unlinkSync(process.env.USAGE_PUSH_TMP); } catch {}'\''' EXIT
if ! node "$script_dir/dispatch-usage-report.js" --since 7d --out "$usage_tmp" >/dev/null 2>&1; then
  printf '%s\n' 'dispatch-usage-push: report failed' >&2
  exit 1
fi
summary="dispatch-usage $(hostname) $(date +%F)"
if ! upload_output=$("${FLEET_BIN:-fleet}" upload "$usage_tmp" --summary "$summary" 2>/dev/null); then
  printf '%s\n' 'dispatch-usage-push: upload failed' >&2
  exit 1
fi
sha=$(printf '%s' "$upload_output" | node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => { const m = s.match(/[0-9a-fA-F]{64}/); if (m) process.stdout.write(m[0].toLowerCase()); else process.exitCode = 1; });') || {
  printf '%s\n' 'dispatch-usage-push: upload returned no sha256' >&2
  exit 1
}
if ! "${FLEET_BIN:-fleet}" send "$AUTOPILOT_USAGE_PUSH_TO" "$summary ref=$sha" >/dev/null 2>&1; then
  printf '%s\n' 'dispatch-usage-push: send failed' >&2
  exit 1
fi
