#!/usr/bin/env bash
# sit.sh <k31|beam|longcat|terra> <role> [--dry-run]  -- one non-implementer qualification sitting through intake-qualify.py.
# Identity/flags from derive.js; credentials staged into a copy-only exam home (kimi: BL-0199 write-back armed by
# qualify_stage_credential ... execute). Output: out/<lane>-<role>/{intake.log,args.json,rc}; scratch under it.
set -uo pipefail
LANE="${1:?lane}"; ROLE="${2:?role}"; MODE="${3:---write}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AP=/home/cookys/projects/autopilot; LP=/home/cookys/projects/llm-playground
D="$HERE/out/$LANE-$ROLE"; mkdir -p "$D"; LOG="$D/intake.log"
case "$LANE" in
  k31)     CELL=kimi/kimi-k3.1-pro-high; MV=kimi-k3.1-pro;;
  beam)    CELL=beam-1.0-free-opencode;  MV=beam-1.0-free;;
  longcat) CELL=longcat-2.0-opencode;    MV=longcat-2.0;;
  terra)   CELL=openai/codex-gpt6.1-terra-low; MV=gpt-6.1-terra;;
  *) echo "bad lane" >&2; exit 2;;
esac
case "$ROLE" in consult|discuss) TMO=21600;; reviewer) TMO=18000;; *) TMO=10800;; esac
node "$HERE/derive.js" "$LANE" "$ROLE" "$AP" > "$D/derive.json" || { echo "derive failed" >&2; exit 2; }
PCH="$(node -e 'console.log(require(process.argv[1]).prompt_config_hash)' "$D/derive.json")"

source "$AP/scripts/lib/qualify-stage-credentials.sh"
if [ "$LANE" = k31 ]; then
  ROOT="$HOME/.autopilot/qualify-staging/roles-kimi-k3.1-pro"; H="$ROOT/kimi-home"; KD="$H/.kimi-code"
  if [ "$MODE" != --dry-run ]; then
    rm -rf "$H"; mkdir -p "$KD/credentials" "$KD/oauth"; chmod 700 "$ROOT" "$H" "$KD" "$KD/credentials" "$KD/oauth"
    for f in config.toml device_id; do qualify_stage_identity "$KD/$f" "$HOME/.kimi-code/$f"; done
    qualify_stage_credential "$KD/credentials/kimi-code.json" "$HOME/.kimi-code/credentials/kimi-code.json" execute
    qualify_stage_credential "$KD/oauth/kimi-code" "$HOME/.kimi-code/oauth/kimi-code" execute
    out="$(HOME="$H" KIMI_MODEL_THINKING_EFFORT=high timeout 120 kimi -m kimi-code/k3.1-pro -p "reply with the single word PONG" 2>&1)"; prc=$?
    echo "$(date -Is) kimi probe rc=$prc: $(printf '%s' "$out" | head -c 300 | tr '\n' ' ')" >> "$LOG"
    { [ "$prc" -eq 0 ] && printf '%s' "$out" | grep -q PONG; } || { echo "kimi unusable (quota/login)"; echo 3 > "$D/rc"; exit 3; }
  fi
elif [ "$LANE" = terra ]; then
  # codex: CODEX_HOME seeded with auth.json only (same as 10-14 cell-cli-rv6.sh), never the live ~/.codex
  H="${XDG_RUNTIME_DIR:-/dev/shm}/qualify-codex-home-terra-$ROLE"
  if [ "$MODE" != --dry-run ]; then
    rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"; cp "$HOME/.codex/auth.json" "$H/auth.json"; chmod 600 "$H/auth.json"
  fi
else
  H="$HOME/.autopilot/exam-opencode-home"
  if [ "$MODE" != --dry-run ]; then
    mkdir -p "$H/.local/share/opencode"; cp "$HOME/.local/share/opencode/auth.json" "$H/.local/share/opencode/auth.json"
    chmod 600 "$H/.local/share/opencode/auth.json"
  fi
fi
node -e '
const d=require(process.argv[1]); const env={...d.env, [d.home_var]: process.argv[3]};
require("fs").writeFileSync(process.argv[2], JSON.stringify({[d.role]: {args: d.args, env}}, null, 1)+"\n");' \
  "$D/derive.json" "$D/args.json" "$H"

echo "$(date -Is) START $LANE $ROLE cell=$CELL mode=$MODE" >> "$LOG"
cd "$LP" || exit 2
env -u GOROOT python3 scripts/eval/intake-qualify.py --cell "$CELL" --model-version "$MV" --role "$ROLE" \
  --prompt-config-hash "$PCH" --engine-qualify-args "$D/args.json" --scratch "$D/scratch" --timeout "$TMO" \
  "$MODE" >> "$LOG" 2>&1
rc=$?
echo "$(date -Is) END $LANE $ROLE rc=$rc" >> "$LOG"; echo "$rc" > "$D/rc"
exit "$rc"
