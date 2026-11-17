#!/usr/bin/env bash
# Offline sentinel shared by pace default dispatch tests; never invokes a model.
set -eu
printf '%s\n' "$(basename "$0") $*" >> "${PACE_SENTINEL_LOG:?}"
if [ "$(basename "$0")" = codex ]; then
  printf '%s\n' 'OpenAI Codex v0.0.0' '--------' 'session id: 00000000-0000-4000-8000-000000000000' '--------' >&2
fi
sidecar=""
for ((i=1;i<=$#;i++)); do
  if [ "${!i}" = "--output-last-message" ]; then j=$((i+1)); sidecar="${!j}"; fi
done
prompt=""
for ((i=1;i<=$#;i++)); do
  if [ "${!i}" = "--prompt-file" ]; then j=$((i+1)); prompt="$(cat "${!j}")"; fi
done
[ -n "$prompt" ] || prompt="$(cat)"
begin="$(printf '%s\n' "$prompt" | sed -n '/^<<<AUTOPILOT-\(REVIEW\|AUTHOR\)-[a-f0-9]*>>>$/p' | head -1)"
end="$(printf '%s\n' "$prompt" | sed -n '/^<<<AUTOPILOT-END-[a-f0-9]*>>>$/p' | head -1)"
if [[ "$prompt" == *'AUTOPILOT-REVIEW-'* ]]; then
  msg="${begin}
VERDICT: SHIP-AS-IS
FINDINGS: none
NO-FINDING-PROOF: checked=the supplied fixture diff; evidence=the one changed line preserves its value; conclusion=no blocking discrepancy
${end}"
else
  msg="${begin}
Offline sentinel author result.
${end}"
fi
[ -z "$sidecar" ] || printf '%s\n' "$msg" > "$sidecar"
printf '%s\n' "$msg"
