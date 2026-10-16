#!/usr/bin/env bash
# kimi28-stage-probe.sh — fresh isolated kimi home for the "K2.8 Preview" lane (model alias kimi-code/kimi-for-coding).
# Rebuilds the staging dir from scratch every call (config.toml is copied only when absent, so a reused dir would keep a stale
# model list), proves the CLI's own config labels that alias "2.8", then one tiny prompt. Never touches the real ~/.kimi-code writes.
# exit 0 usable, 3 credential/model unusable (uncharged beyond one tiny prompt).
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
source "$REPO/scripts/lib/qualify-stage-credentials.sh"
ROOT="$HOME/.autopilot/qualify-staging/reviewer-kimi-k2.8-preview"; H="$ROOT/kimi-home"; KD="$H/.kimi-code"
rm -rf "$H"; mkdir -p "$KD/credentials" "$KD/oauth"; chmod 700 "$ROOT" "$H" "$KD" "$KD/credentials" "$KD/oauth" 2>/dev/null || true
for f in config.toml device_id; do qualify_stage_identity "$KD/$f" "$HOME/.kimi-code/$f"; done
qualify_stage_credential "$KD/credentials/kimi-code.json" "$HOME/.kimi-code/credentials/kimi-code.json" execute
qualify_stage_credential "$KD/oauth/kimi-code" "$HOME/.kimi-code/oauth/kimi-code" execute
label="$(awk '/^\[models\."kimi-code\/kimi-for-coding"\]/{f=1;next} /^\[/{f=0} f&&/^display_name/{print}' "$KD/config.toml")"
echo "kimi28 alias label: $label"
printf '%s' "$label" | grep -q '2\.8' || { echo "kimi28: alias kimi-code/kimi-for-coding is not labelled 2.8 in the CLI config"; exit 3; }
out="$(HOME="$H" timeout 120 kimi -m kimi-code/kimi-for-coding -p "reply with the single word PONG" 2>&1)"; rc=$?
echo "kimi28-probe rc=$rc: $(printf '%s' "$out" | head -c 600 | tr '\n' ' ')"
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q PONG && exit 0
if printf "%s" "$out" | grep -qi "usage limit"; then echo "kimi: quota exhausted, wait for reset (not a login problem)"; exit 4; fi
echo "kimi: credential or other error, owner may need to log in again"; exit 3
