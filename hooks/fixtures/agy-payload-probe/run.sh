set -uo pipefail
F="$1"; M="${2:-gemini-3.8-flash-high}"
N="NONCE-AGYWALL-7F3C9A21"
OUT=$(timeout 300 agy --model "$M" --input-format stream-json --output-format stream-json < "$F" 2>&1)
RES=$(printf '%s' "$OUT" | grep '"event":"result"' | tail -1)
ST=$(printf '%s' "$RES" | grep -oE '"status":"[A-Z]*"' | head -1)
RP=$(printf '%s' "$RES" | grep -oE '"response":"[^"]{0,60}"' | head -1)
if printf '%s' "$RES" | grep -q "$N"; then HIT="YES"; else HIT="NO "; fi
printf '%-18s sha=%s  tail_nonce=%s  %s  %s\n' \
  "$(basename "$F")" "$(sha256sum "$F" | cut -c1-12)" "$HIT" "$ST" "$RP"
