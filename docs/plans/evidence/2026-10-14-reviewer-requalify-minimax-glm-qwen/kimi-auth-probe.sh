#!/usr/bin/env bash
# kimi-auth-probe.sh — one tiny prompt through the STAGED kimi home (never the real ~/.kimi-code writes sessions).
# Re-seeds credentials from the real home (read-only), then asks for PONG. exit 0 = usable, 3 = credential unusable.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
source "$REPO/scripts/lib/qualify-stage-credentials.sh"
ROOT="$HOME/.autopilot/qualify-staging/reviewer-kimi-k3"; H="$ROOT/kimi-home"; KD="$H/.kimi-code"
mkdir -p "$KD/credentials" "$KD/oauth"; chmod 700 "$ROOT" "$H" "$KD" "$KD/credentials" "$KD/oauth" 2>/dev/null || true
for f in config.toml device_id; do qualify_stage_identity "$KD/$f" "$HOME/.kimi-code/$f"; done
qualify_stage_credential "$KD/credentials/kimi-code.json" "$HOME/.kimi-code/credentials/kimi-code.json" execute
qualify_stage_credential "$KD/oauth/kimi-code" "$HOME/.kimi-code/oauth/kimi-code" execute
out="$(HOME="$H" timeout 120 kimi -m kimi-code/k3 -p "reply with the single word PONG" 2>&1)"; rc=$?
echo "kimi-auth-probe rc=$rc: $(printf '%s' "$out" | head -c 600 | tr '\n' ' ')"
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q PONG && exit 0
if printf "%s" "$out" | grep -qi "usage limit"; then echo "kimi: quota exhausted, wait for reset (not a login problem)"; exit 4; fi
echo "kimi: credential or other error, owner may need to log in again"; exit 3
