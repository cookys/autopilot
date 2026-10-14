#!/usr/bin/env bash
# cell-msg-rv6.sh <glm_low|glm_high|minimax31_low|minimax31_high|minimax_think>
# One reviewer v6 administration (reviewer-metamorphic-v6) over the HTTP Messages protocol (Anthropic-compatible vendors).
# Effort rides as body output_config.effort via QRP_HTTP_EFFORT; the M3 thinking switch via QRP_HTTP_THINKING=adaptive
# (M3 has a switch, not a depth: its effort label is `default`). Both are listed in --provider-env and --effort equals the sent value.
# Before the exam: (1) capture-effort.js proves the provider body carries the value (local capture server, no spend);
# (2) a live ping with the same body fields is sent to the real endpoint and its status/usage logged (token never printed).
# Output: out/rv6-<lane>/{run.log,stdout.json,stderr.log,raw/,rc,emit-row.json,effort-evidence.log}. rc: 0 pass, 1 fail, 2 precondition.
set -uo pipefail
LANE="${1:?lane}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
D="$HERE/out/rv6-$LANE"; mkdir -p "$D/raw"; LOG="$D/run.log"; EV="$D/effort-evidence.log"
say() { echo "$(date -Is) $*" >> "$LOG"; }
fin() { echo "$1" > "$D/rc"; say "lane=$LANE END rc=$1"; echo "rc=$1" >> "$LOG"; exit "$1"; }
cd "$REPO" || exit 2
case "$LANE" in glm_*) EPFX=GLM;; minimax*) EPFX=MINIMAX;; *) say "bad lane"; fin 2;; esac
node "$HERE/derive-matrix.js" "$LANE" reviewer "$REPO" > /dev/null || { say "fingerprint derivation failed"; fin 2; }
idv() { node -e "console.log(require('$HERE/identity/reviewer-$LANE.json')['$1'])"; }
MODEL="$(idv identity)"; ENGINE="$(idv engine)"; FAMILY="$(idv family)"; RUNNER="$(idv runner)"; EFFORT="$(idv effort)"
THINK=""; [ "$LANE" = minimax_think ] && THINK=adaptive
source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1
uvar="AUTOPILOT_ENDPOINT_${EPFX}_URL"; tvar="AUTOPILOT_ENDPOINT_${EPFX}_TOKEN"
export QRP_BASE_URL="${!uvar:-}" QRP_AUTH_TOKEN="${!tvar:-}"
[ -n "$QRP_BASE_URL" ] && [ -n "$QRP_AUTH_TOKEN" ] || { say "endpoint $EPFX url/token missing"; fin 2; }
# (1) on-wire evidence from the real provider code path (local capture)
node "$HERE/capture-effort.js" "$REPO" "$MODEL" "$EFFORT" "${THINK:-default}" "$D/effort-capture.json" > "$EV" 2>&1
# (2) live ping carrying the same fields; status and usage only
EFFP="$([ "$EFFORT" = default ] && echo '' || echo "$EFFORT")" PMODEL="$MODEL" PTHINK="$THINK" node -e '
  (async()=>{const body={model:process.env.PMODEL,max_tokens:2048,messages:[{role:"user",content:"Reply with the single word PONG."}]};
    if(process.env.EFFP) body.output_config={effort:process.env.EFFP};
    if(process.env.PTHINK) body.thinking={type:process.env.PTHINK};
    const r=await fetch(process.env.QRP_BASE_URL.replace(/\/+$/,"")+"/v1/messages",{method:"POST",
      headers:{"content-type":"application/json","anthropic-version":"2023-06-01","x-api-key":process.env.QRP_AUTH_TOKEN,authorization:"Bearer "+process.env.QRP_AUTH_TOKEN},
      body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
    const j=await r.json().catch(()=>({}));
    console.log("live_ping status="+r.status+" model="+String(j.model||"")+" stop="+String(j.stop_reason||(j.error&&j.error.message)||"")+" output_tokens="+(j.usage&&j.usage.output_tokens)+" blocks="+((j.content||[]).map(b=>b&&b.type).join("+")));
  })().catch(e=>console.log("live_ping failed: "+e.message));' >> "$EV" 2>&1
say "effort evidence: $(tr '\n' ' ' < "$EV" | cut -c1-600)"
grep -q "live_ping status=200" "$EV" || { say "live ping not 200; refusing to sit the exam (effort acceptance unproven)"; fin 2; }
[ "${EVIDENCE_ONLY:-0}" = 1 ] && { cat "$EV"; exit 0; }
MODEL_VERSION="$MODEL"; VERSION_SOURCE=operator-asserted
probed="$(grep -o 'live_ping status=200 model=[A-Za-z0-9._:-]*' "$EV" | sed 's/.*model=//')"
if [[ "$probed" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then MODEL_VERSION="$probed"; VERSION_SOURCE=runtime; fi
PENV=(--provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN --provider-env QRP_MODEL --provider-env QRP_PROVIDER
      --provider-env QRP_PROMPT_MODE --provider-env QRP_TIMEOUT_MS --provider-env QRP_MAX_TOKENS --provider-env QRP_HTTP_PROTOCOL)
[ "$EFFORT" = default ] || PENV+=(--provider-env QRP_HTTP_EFFORT)
[ -n "$THINK" ] && PENV+=(--provider-env QRP_HTTP_THINKING)
say "lane=$LANE START model=$MODEL model_version=$MODEL_VERSION version_source=$VERSION_SOURCE effort=$EFFORT thinking=${THINK:-none}"
( export QRP_TIMEOUT_MS=570000 QRP_PROMPT_MODE=reviewer QRP_MODEL="$MODEL" QRP_PROVIDER="$LANE-anthropic" QRP_MAX_TOKENS=32768 QRP_HTTP_PROTOCOL=messages
  [ "$EFFORT" = default ] || export QRP_HTTP_EFFORT="$EFFORT"
  [ -n "$THINK" ] && export QRP_HTTP_THINKING="$THINK"
  timeout 18000 bash "$REPO/scripts/engine-qualify.sh" reviewer \
    --engine "$ENGINE" --model "$MODEL" --model-version "$MODEL_VERSION" \
    --runner "$RUNNER" --runner-version "$(idv runner_version)" --family "$FAMILY" \
    --harness-version "$(idv harness_version)" --effort "$EFFORT" \
    --prompt-config-hash "$(idv prompt_config_hash)" --semantic-fingerprint "$(idv semantic_fingerprint)" \
    --containment-fingerprint "$(idv containment_fingerprint)" \
    --remote-provider-cmd "node $REPO/scripts/qualification-review-provider.js" --remote-provider "$LANE-anthropic" --remote-timeout-ms 600000 "${PENV[@]}" \
    --task-class code_review --domain cross-cutting --language en --tool read_only --version-source "$VERSION_SOURCE" \
    --raw-dir "$D/raw" --emit-row > "$D/stdout.json" 2> "$D/stderr.log" )
rc=$?
cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null
fin "$rc"
