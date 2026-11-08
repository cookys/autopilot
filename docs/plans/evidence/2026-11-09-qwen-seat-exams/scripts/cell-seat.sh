#!/usr/bin/env bash
# cell-seat.sh <seq> <role> <on|off>
#   role: reviewer | verification_author | consult | discuss | owner | brain   (qwen_local, Qwen3.8-27B-QUASAR-NVFP4)
#   on|off: thinking switch. on = chat_completions+enabled (reviewer also response_format json_schema, the formal 2026-11-08 shape);
#           off = messages+disabled (no response_format: chat has no disabled, rf exists only on chat).
# One administration. Generalised copy of docs/plans/evidence/2026-11-08-local-models-qualify/cell-local-rf-formal.sh and
# cell-local-think.sh (originals untouched); adds discuss/owner/brain, an explicit thinking-off cell, a GPU gate and an
# output root outside the repo. Does NOT record to the scorecard (record-seat.sh does, after the row is read).
# Env: SEATDIR (default: parent of this script's dir; holds land/ qrpt/ cells/ identity/ GO PAUSE)
#      REPO (default $SEATDIR/land, a develop worktree), QRPT (default $SEATDIR/qrpt, detached at 046f7fcde, reviewer-on provider)
#      CAP_S wall cap seconds for the engine-qualify call, DRY_RUN=1 parameter layer only (no network, no gate, scratch store)
# rc: 0 pass, 1 fail verdict, 2 usage/precondition, 3 thinking switch not honoured by the server (no case sent), 4 gate timeout, 124 wall cap
set -uo pipefail
SEQ="${1:?seq}"; ROLE="${2:?role}"; THINK="${3:?on|off}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; SEATDIR="${SEATDIR:-$(cd "$HERE/.." && pwd)}"
REPO="${REPO:-$SEATDIR/land}"; QRPT="${QRPT:-$SEATDIR/qrpt}"
DRY="${DRY_RUN:-0}"
case "$THINK" in on|off|on-rf) ;; *) echo "bad think $THINK" >&2; exit 2;; esac
# on-rf: thinking on + response_format json_schema for every JSON role, provider AND engine-qualify taken from the qrprf worktree
# (hands/qrprf/1 tip c02b06fbf2dd7f61f31d5fdc5e6f77a8f228550a, not merged into develop; PM supplement 2026-11-09).
if [ "$THINK" = on-rf ]; then
  REPO="${QRPRF:-$SEATDIR/../qrprf}"
  [ "$(git -C "$REPO" rev-parse HEAD)" = c02b06fbf2dd7f61f31d5fdc5e6f77a8f228550a ] || { echo "qrprf not at c02b06fbf" >&2; exit 2; }
fi
D="$SEATDIR/cells/$SEQ-$ROLE-think-$THINK"; [ "$DRY" = 1 ] && D="$SEATDIR/cells/dry-$SEQ-$ROLE-think-$THINK"
mkdir -p "$D/raw"; LOG="$D/run.log"; EV="$D/effort-evidence.log"; : > "$LOG"
say() { echo "$(date -Is) $*" >> "$LOG"; }
fin() { echo "$1" > "$D/rc"; say "role=$ROLE think=$THINK END rc=$1"; echo "rc=$1" >> "$LOG"; exit "$1"; }
EPNAME=qwen_local; EPFX=QWEN_LOCAL; SERVED=Qwen3.8-27B-QUASAR-NVFP4; FAMILY=alibaba; LANE=qwen
case "$ROLE" in
  reviewer)            mode=reviewer; tc=code_review;             extra=(--emit-row);           cap=3000;;
  verification_author) mode=va;       tc=verification_authoring;  extra=(--emit-row);           cap=1800;;
  consult)             mode=consult;  tc=consult;                 extra=(--execute --emit-row); cap=3600;;
  discuss)             mode=discuss;  tc=discuss;                 extra=(--execute --emit-row); cap=3600;;
  owner)               mode=owner;    tc=owner_intent_control;    extra=(--emit-row);           cap=3600;;
  brain)               mode=brain;    tc=brain-seat;              extra=(--emit-row);           cap=7200;;
  *) echo "unsupported role $ROLE" >&2; exit 2;;
esac
cap="${CAP_S:-$cap}"
cd "$REPO" || exit 2
IDENTITY_DIR="$SEATDIR/identity" node "$HERE/derive-seat.js" "$LANE" "$ROLE" "$REPO" > /dev/null || { say "fingerprint derivation failed"; fin 2; }
idv() { node -e "console.log(require('$SEATDIR/identity/$ROLE-$LANE.json')['$1'])"; }
MODEL="$(idv identity)"; ENGINE="$(idv engine)"; RUNNER="$(idv runner)"; EFFORT="$(idv effort)"
[ "$MODEL" = "$SERVED" ] || { say "identity model $MODEL != served id $SERVED"; fin 2; }
PROVIDER_CMD="node $REPO/scripts/qualification-review-provider.js"; MODEL_VERSION="$MODEL"; VERSION_SOURCE=operator-asserted
RF=""
# thinking ON is only reachable through chat_completions + chat_template_kwargs.enable_thinking (provider QRP_HTTP_THINKING=enabled):
# on qwen_local the messages protocol with thinking:{type:adaptive} returns no thinking block (2026-11-09 ping, cell 2 attempt 1), and
# the 2026-11-08 VA "think" row (event 10) was in fact a chat-protocol sitting. OFF = messages + thinking:disabled.
if [ "$THINK" != off ]; then
  TP=chat; HPROTO=chat_completions; HTHINK=enabled
  if [ "$THINK" = on-rf ]; then RF=json_schema; fi
  if [ "$ROLE" = reviewer ] && [ "$THINK" = on ]; then
    RF=json_schema
    [ "$(git -C "$QRPT" rev-parse HEAD)" = 046f7fcde4974f45491f5be31b661974fd9ce6f2 ] || { say "QRPT not at 046f7fcde4974f45491f5be31b661974fd9ce6f2"; fin 2; }
    PROVIDER_CMD="node $QRPT/scripts/qualification-review-provider.js"
  fi
else TP=messages; HPROTO=messages; HTHINK=disabled; fi
MAXTOK="${THINK_MAX_TOKENS:-32768}"
if [ "$DRY" = 1 ]; then
  PROVIDER_CMD="node /nonexistent-dry-run-provider.js"; extra=(--store "$D/dry-store.jsonl" --emit-row)
  [ "$ROLE" = consult ] || [ "$ROLE" = discuss ] && extra=(--plan --store "$D/dry-store.jsonl")
  export QRP_BASE_URL=http://127.0.0.1:9 QRP_AUTH_TOKEN=dry-run-not-a-token
else
  source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1
  uvar="AUTOPILOT_ENDPOINT_${EPFX}_URL"; tvar="AUTOPILOT_ENDPOINT_${EPFX}_TOKEN"
  export QRP_BASE_URL="${!uvar:-}" QRP_AUTH_TOKEN="${!tvar:-}"
  [ -n "$QRP_BASE_URL" ] && [ -n "$QRP_AUTH_TOKEN" ] || { say "endpoint $EPNAME url/token missing"; fin 2; }
  # ---- GPU gate: GO present, PAUSE absent, /v1/models 200 (single concurrency is the caller's job: one cell at a time) ----
  waited=0
  while { [ ! -f "$SEATDIR/GO" ] || [ -f "$SEATDIR/PAUSE" ]; } && [ "$waited" -lt 1500 ]; do sleep 20; waited=$((waited+20)); done
  { [ -f "$SEATDIR/GO" ] && [ ! -f "$SEATDIR/PAUSE" ]; } || { say "gate: GO missing or PAUSE present after ${waited}s"; fin 4; }
  hs="$(node -e '(async()=>{try{const r=await fetch(process.env.QRP_BASE_URL.replace(/\/+$/,"")+"/v1/models",{headers:{authorization:"Bearer "+process.env.QRP_AUTH_TOKEN,"x-api-key":process.env.QRP_AUTH_TOKEN},signal:AbortSignal.timeout(30000)});process.stdout.write(String(r.status))}catch(e){process.stdout.write("000")}})()')"
  say "gate: GO present, PAUSE absent, /v1/models=$hs"
  [ "$hs" = 200 ] || { say "/v1/models not 200 ($hs): not sitting the exam"; fin 2; }
  # ---- (1) on-wire evidence (local capture server, no spend); messages shape only ----
  if [ "$TP" = messages ]; then
    node "$HERE/capture-effort.js" "$REPO" "$MODEL" "$EFFORT" "$HTHINK" "$D/effort-capture.json" > "$EV" 2>&1
  else echo "capture skipped: chat protocol not expressible by the capture server" > "$EV"; fi
  # ---- (2) live ping with the same switch; on => a thinking block must exist, off => none ----
  TP="$TP" HTHINK="$HTHINK" PMODEL="$MODEL" node -e '
    (async()=>{const chat=process.env.TP==="chat";const base=process.env.QRP_BASE_URL.replace(/\/+$/,"");
      const msg=[{role:"user",content:"Reply with the single word PONG."}];
      const body=chat?{model:process.env.PMODEL,max_tokens:4096,messages:msg,chat_template_kwargs:{enable_thinking:true}}
                     :{model:process.env.PMODEL,max_tokens:4096,messages:msg,thinking:{type:process.env.HTHINK}};
      const r=await fetch(base+(chat?"/v1/chat/completions":"/v1/messages"),{method:"POST",
        headers:{"content-type":"application/json","anthropic-version":"2023-06-01","x-api-key":process.env.QRP_AUTH_TOKEN,authorization:"Bearer "+process.env.QRP_AUTH_TOKEN},
        body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
      const j=await r.json().catch(()=>({}));
      let has,blocks="";
      if(chat){const m=(j.choices&&j.choices[0]&&j.choices[0].message)||{};
        has=(typeof m.reasoning==="string"&&m.reasoning.length>0)||(typeof m.reasoning_content==="string"&&m.reasoning_content.length>0)||(typeof m.content==="string"&&m.content.includes("<think>"));
        blocks="finish="+(j.choices&&j.choices[0]&&j.choices[0].finish_reason);}
      else{has=(j.content||[]).some(b=>b&&b.type==="thinking");blocks="blocks="+((j.content||[]).map(b=>b&&b.type).join("+"));}
      console.log("live_ping status="+r.status+" model="+String(j.model||"")+" stop="+String(j.stop_reason||(j.error&&j.error.message)||"")+" output_tokens="+((j.usage&&(j.usage.output_tokens||j.usage.completion_tokens)))+" "+blocks);
      console.log("thinking_protocol="+process.env.TP+" thinking_switch="+process.env.HTHINK+" thinking_content_present="+has);
    })().catch(e=>console.log("live_ping failed: "+e.message));' >> "$EV" 2>&1
  say "ping evidence: $(tr '\n' ' ' < "$EV" | cut -c1-700)"
  grep -q "live_ping status=200" "$EV" || { say "live ping not 200 (503+Retry-After = overloaded/unhealthy); not sitting the exam"; fin 2; }
  if [ "$THINK" != off ]; then
    grep -q "thinking_content_present=true" "$EV" || { say "thinking not on in the ping (gpu-lead rule 01M6WSEJFR): not sitting the exam"; fin 3; }
  else
    grep -q "thinking_content_present=false" "$EV" || { say "thinking=disabled sent but the server still produced thinking content: the off cell would be mislabelled; not sitting the exam"; fin 3; }
  fi
  probed="$(grep -o 'live_ping status=200 model=[A-Za-z0-9._:-]*' "$EV" | sed 's/.*model=//')"
  if [[ "$probed" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then MODEL_VERSION="$probed"; VERSION_SOURCE=runtime; fi
fi
# STORE=<path>: write the evidence row to this store instead of ~/.autopilot/engine-capability/qualification-evidence.jsonl.
# Why it exists: VA/consult/discuss/implementer persist with supersedes:null, so a FAILED sitting for an identity that already has a
# qualified row is refused ("restrictive evidence ... is not bound to the active qualification") and the result is lost.
STOREARG=(); [ -n "${STORE:-}" ] && STOREARG=(--store "$STORE")
PENV=(--provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN --provider-env QRP_MODEL --provider-env QRP_PROVIDER
      --provider-env QRP_PROMPT_MODE --provider-env QRP_TIMEOUT_MS --provider-env QRP_MAX_TOKENS --provider-env QRP_HTTP_PROTOCOL --provider-env QRP_HTTP_THINKING)
[ -n "$RF" ] && PENV+=(--provider-env QRP_HTTP_RESPONSE_FORMAT)
say "provider=$PROVIDER_CMD protocol=$HPROTO thinking=$HTHINK rf=${RF:-none (not available for this role/protocol: provider restriction)} max_tokens=$MAXTOK cap_s=$cap"
say "role=$ROLE think=$THINK START runner=$RUNNER model=$MODEL model_version=$MODEL_VERSION version_source=$VERSION_SOURCE effort=$EFFORT(none sent) endpoint=$EPNAME dry=$DRY identity: prompt=$(idv prompt_config_hash | cut -c1-12) sem=$(idv semantic_fingerprint | cut -c1-12) con=$(idv containment_fingerprint | cut -c1-12) harness=$(idv harness_version)"
( export QRP_TIMEOUT_MS=570000 QRP_PROMPT_MODE="$mode" QRP_MODEL="$MODEL" QRP_PROVIDER="$LANE-local-anthropic" QRP_MAX_TOKENS="$MAXTOK" QRP_HTTP_PROTOCOL="$HPROTO" QRP_HTTP_THINKING="$HTHINK"
  [ -n "$RF" ] && export QRP_HTTP_RESPONSE_FORMAT="$RF"
  timeout "$cap" bash "$REPO/scripts/engine-qualify.sh" "$ROLE" \
    --engine "$ENGINE" --model "$MODEL" --model-version "$MODEL_VERSION" \
    --runner "$RUNNER" --runner-version "$(idv runner_version)" --family "$FAMILY" \
    --harness-version "$(idv harness_version)" --effort "$EFFORT" \
    --prompt-config-hash "$(idv prompt_config_hash)" --semantic-fingerprint "$(idv semantic_fingerprint)" \
    --containment-fingerprint "$(idv containment_fingerprint)" \
    --remote-provider-cmd "$PROVIDER_CMD" --remote-provider "$LANE-local-anthropic" --remote-timeout-ms 600000 "${PENV[@]}" \
    --task-class "$tc" --domain cross-cutting --language en --tool read_only --version-source "$VERSION_SOURCE" \
    --raw-dir "$D/raw" "${STOREARG[@]}" "${extra[@]}" > "$D/stdout.json" 2> "$D/stderr.log" )
rc=$?
cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null
fin "$rc"
