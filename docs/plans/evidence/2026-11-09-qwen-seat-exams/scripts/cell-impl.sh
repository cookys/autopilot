#!/usr/bin/env bash
# cell-impl.sh <seq> [effort=medium]   qwen_local implementer via cc-shim (live rail, dispatch-hetero), one administration.
# Copy of the implementer branch of docs/plans/evidence/2026-11-08-local-models-qualify/cell-local.sh with: GPU gate, output
# root outside the repo, effort parameter, and harness_version RECOMPUTED (B8): the 11-08 cells copied dispatch-hetero:7481ead3;
# that value equals sha256(scripts/dispatch-hetero.sh) first 8 hex at commit 69c4d2397 (found by scanning the file's history),
# so the algorithm is  "dispatch-hetero:" + sha256(scripts/dispatch-hetero.sh)[0:8]  taken from the REPO that runs the exam.
# Does not record to the scorecard. rc: 0 pass, 1 fail verdict, 2 precondition, 4 gate timeout, 124 wall cap. DRY_RUN=1 prints argv.
set -uo pipefail
SEQ="${1:?seq}"; EFF="${2:-medium}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; SEATDIR="${SEATDIR:-$(cd "$HERE/.." && pwd)}"; REPO="${REPO:-$SEATDIR/land}"
DRY="${DRY_RUN:-0}"; D="$SEATDIR/cells/$SEQ-implementer-effort-$EFF"; [ "$DRY" = 1 ] && D="$SEATDIR/cells/dry-$SEQ-implementer-effort-$EFF"
mkdir -p "$D/raw"; LOG="$D/run.log"; : > "$LOG"
say() { echo "$(date -Is) $*" >> "$LOG"; }
fin() { echo "$1" > "$D/rc"; say "implementer effort=$EFF END rc=$1"; echo "rc=$1" >> "$LOG"; exit "$1"; }
EPNAME=qwen_local; EPFX=QWEN_LOCAL; SERVED=Qwen3.8-27B-QUASAR-NVFP4; FAMILY=alibaba
cd "$REPO" || exit 2
HV="dispatch-hetero:$(sha256sum scripts/dispatch-hetero.sh | cut -c1-8)"
RV="$(node scripts/lib/runner-binary.js version --runner cc-shim --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).token)')"
ARGV=(node scripts/engine-qualify.js implementer --engine "$SERVED" --model "$SERVED" --model-version "$SERVED"
  --runner cc-shim --runner-version "$RV" --family "$FAMILY" --harness-version "$HV" --effort "$EFF"
  --prompt-config-hash 16b45e1a0ed185e494a602fd84e249f12fd6f86be0ab2b18ba3d5a6c64db7a5a
  --semantic-fingerprint d8af529058764fa0276f57633d26eb8a7e61089b441982a7cf29ed3913029d0a
  --containment-fingerprint 2c1042fc7187841565fa4c9fafa2f25fa7efda49f0ed911cd0363300e21738fd
  --task-class bounded_implementation --domain repository --language en --tool git_commit
  --version-source operator-asserted --endpoint "$EPNAME" --raw-dir "$D/raw" --emit-row)
[ -n "${STORE:-}" ] && ARGV+=(--store "$STORE")
if [ "$DRY" = 1 ]; then say "DRY implementer argv: ${ARGV[*]}"; fin 0; fi
source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1
uvar="AUTOPILOT_ENDPOINT_${EPFX}_URL"; tvar="AUTOPILOT_ENDPOINT_${EPFX}_TOKEN"
waited=0
while { [ ! -f "$SEATDIR/GO" ] || [ -f "$SEATDIR/PAUSE" ]; } && [ "$waited" -lt 1500 ]; do sleep 20; waited=$((waited+20)); done
{ [ -f "$SEATDIR/GO" ] && [ ! -f "$SEATDIR/PAUSE" ]; } || { say "gate: GO missing or PAUSE present after ${waited}s"; fin 4; }
hs="$(QRP_BASE_URL="${!uvar:-}" QRP_AUTH_TOKEN="${!tvar:-}" node -e '(async()=>{try{const r=await fetch(process.env.QRP_BASE_URL.replace(/\/+$/,"")+"/v1/models",{headers:{authorization:"Bearer "+process.env.QRP_AUTH_TOKEN,"x-api-key":process.env.QRP_AUTH_TOKEN},signal:AbortSignal.timeout(30000)});process.stdout.write(String(r.status))}catch(e){process.stdout.write("000")}})()')"
say "gate: GO present, PAUSE absent, /v1/models=$hs"
[ "$hs" = 200 ] || { say "/v1/models not 200 ($hs): not sitting"; fin 2; }
say "implementer START model=$SERVED endpoint=$EPNAME effort=$EFF (forwarded by cc-shim) harness=$HV runner_version=$RV"
timeout "${CAP_S:-2400}" "${ARGV[@]}" > "$D/stdout.json" 2> "$D/stderr.log"; rc=$?
cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null; fin "$rc"
