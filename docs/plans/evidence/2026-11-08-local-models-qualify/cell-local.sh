#!/usr/bin/env bash
# cell-local.sh <qwen|glm> <reviewer|verification_author|consult|implementer>
# One administration of a locally served vLLM model (plaintext-private endpoint qwen_local / glm_local).
# Recipes copied, not invented: reviewer/va/consult = ../2026-10-14-reviewer-requalify-minimax-glm-qwen/{cell-msg-rv6.sh,cellx2.sh}
# (HTTP Messages via qualification-review-provider.js, QRP_HTTP_PROTOCOL=messages); implementer = cellx.sh minimax31 branch
# (engine-qualify.js implementer --runner cc-shim --endpoint <name>, local-model-team-recipe.md step 3).
# Effort: broker roles carry label `default` and send NO output_config.effort (effort_check=match). The implementer
# effort is FORWARDED by cc-shim (11-08 run: effort=high got HTTP 500 from qwen_local, which accepts xhigh|medium|low); use medium.
# Never records to the scorecard; the operator records emit-row.json (see README).
# DRY_RUN=1: parameter layer only. No network, no live ping, no staging; scratch --store; implementer prints argv.
# Output: out/<lane>-<role>/{run.log,stdout.json,stderr.log,raw/,rc,emit-row.json[,effort-evidence.log]}.
# rc: 0 pass, 1 fail verdict, 2 usage/precondition, 124 wall timeout.
set -uo pipefail
LANE="${1:?lane qwen|glm}"; ROLE="${2:?role}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
DRY="${DRY_RUN:-0}"
D="$HERE/out/$LANE-$ROLE"; [ "$DRY" = 1 ] && D="$HERE/out/dry-$LANE-$ROLE"
mkdir -p "$D/raw"; LOG="$D/run.log"; EV="$D/effort-evidence.log"; : > "$LOG"
say() { echo "$(date -Is) $*" >> "$LOG"; }
fin() { echo "$1" > "$D/rc"; say "lane=$LANE role=$ROLE END rc=$1"; echo "rc=$1" >> "$LOG"; exit "$1"; }
case "$LANE" in
  qwen) EPNAME=qwen_local; EPFX=QWEN_LOCAL; SERVED=Qwen3.8-27B-QUASAR-NVFP4; FAMILY=alibaba;;
  glm)  EPNAME=glm_local;  EPFX=GLM_LOCAL;  SERVED=GLM-5.3-Flash-NVFP4;       FAMILY=zhipu;;
  *) echo "bad lane" >&2; exit 2;;
esac
cd "$REPO" || exit 2

# ---------- implementer: live rail, cc-shim through the named endpoint ----------
if [ "$ROLE" = implementer ]; then
  RV="$(node scripts/lib/runner-binary.js version --runner cc-shim --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).token)')"
  ARGV=(node scripts/engine-qualify.js implementer --engine "$SERVED" --model "$SERVED" --model-version "$SERVED"
    --runner cc-shim --runner-version "$RV" --family "$FAMILY" --harness-version dispatch-hetero:7481ead3 --effort medium
    --prompt-config-hash 16b45e1a0ed185e494a602fd84e249f12fd6f86be0ab2b18ba3d5a6c64db7a5a
    --semantic-fingerprint d8af529058764fa0276f57633d26eb8a7e61089b441982a7cf29ed3913029d0a
    --containment-fingerprint 2c1042fc7187841565fa4c9fafa2f25fa7efda49f0ed911cd0363300e21738fd
    --task-class bounded_implementation --domain repository --language en --tool git_commit
    --version-source operator-asserted --endpoint "$EPNAME" --raw-dir "$D/raw" --emit-row)
  if [ "$DRY" = 1 ]; then say "DRY implementer argv: ${ARGV[*]}"; fin 0; fi
  source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1
  say "lane=$LANE role=implementer START model=$SERVED endpoint=$EPNAME effort=medium (forwarded; qwen_local accepts xhigh|medium|low only)"
  timeout 10800 "${ARGV[@]}" > "$D/stdout.json" 2> "$D/stderr.log"; rc=$?
  cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null; fin "$rc"
fi

# ---------- broker roles ----------
case "$ROLE" in
  reviewer)            mode=reviewer; tc=code_review;   extra=(--emit-row);;
  verification_author) mode=va;       tc=verification_authoring; extra=(--emit-row);;
  consult)             mode=consult;  tc=consult;       extra=(--execute --emit-row);;
  *) say "unsupported role $ROLE"; fin 2;;
esac
IDENTITY_DIR="$HERE/identity" node "$HERE/derive-local.js" "$LANE" "$ROLE" "$REPO" > /dev/null || { say "fingerprint derivation failed"; fin 2; }
idv() { node -e "console.log(require('$HERE/identity/$ROLE-$LANE.json')['$1'])"; }
MODEL="$(idv identity)"; ENGINE="$(idv engine)"; RUNNER="$(idv runner)"; EFFORT="$(idv effort)"
[ "$MODEL" = "$SERVED" ] || { say "identity model $MODEL != served id $SERVED"; fin 2; }
PROVIDER_CMD="node $REPO/scripts/qualification-review-provider.js"; MODEL_VERSION="$MODEL"; VERSION_SOURCE=operator-asserted
if [ "$DRY" = 1 ]; then
  PROVIDER_CMD="node /nonexistent-dry-run-provider.js"; extra=(--store "$D/dry-store.jsonl" --emit-row)
  [ "$ROLE" = consult ] && extra=(--plan --store "$D/dry-store.jsonl")
  export QRP_BASE_URL=http://127.0.0.1:9 QRP_AUTH_TOKEN=dry-run-not-a-token
else
  source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1
  uvar="AUTOPILOT_ENDPOINT_${EPFX}_URL"; tvar="AUTOPILOT_ENDPOINT_${EPFX}_TOKEN"
  export QRP_BASE_URL="${!uvar:-}" QRP_AUTH_TOKEN="${!tvar:-}"
  [ -n "$QRP_BASE_URL" ] && [ -n "$QRP_AUTH_TOKEN" ] || { say "endpoint $EPNAME url/token missing"; fin 2; }
  # (1) on-wire evidence from the real provider path (local capture server, no spend). reviewer wire shape; same transport for va/consult.
  node "$HERE/capture-effort.js" "$REPO" "$MODEL" "$EFFORT" default "$D/effort-capture.json" > "$EV" 2>&1
  # (2) live ping, same body fields (none for default effort): status/model/usage only; token never printed.
  PMODEL="$MODEL" node -e '
    (async()=>{const body={model:process.env.PMODEL,max_tokens:2048,messages:[{role:"user",content:"Reply with the single word PONG."}]};
      const r=await fetch(process.env.QRP_BASE_URL.replace(/\/+$/,"")+"/v1/messages",{method:"POST",
        headers:{"content-type":"application/json","anthropic-version":"2023-06-01","x-api-key":process.env.QRP_AUTH_TOKEN,authorization:"Bearer "+process.env.QRP_AUTH_TOKEN},
        body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
      const j=await r.json().catch(()=>({}));
      console.log("live_ping status="+r.status+" model="+String(j.model||"")+" stop="+String(j.stop_reason||(j.error&&j.error.message)||"")+" output_tokens="+(j.usage&&j.usage.output_tokens)+" blocks="+((j.content||[]).map(b=>b&&b.type).join("+")));
    })().catch(e=>console.log("live_ping failed: "+e.message));' >> "$EV" 2>&1
  say "effort evidence: $(tr '\n' ' ' < "$EV" | cut -c1-600)"
  grep -q "live_ping status=200" "$EV" || { say "live ping not 200 (503+Retry-After = overloaded/unhealthy); not sitting the exam"; fin 2; }
  probed="$(grep -o 'live_ping status=200 model=[A-Za-z0-9._:-]*' "$EV" | sed 's/.*model=//')"
  if [[ "$probed" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then MODEL_VERSION="$probed"; VERSION_SOURCE=runtime; fi
fi
PENV=(--provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN --provider-env QRP_MODEL --provider-env QRP_PROVIDER
      --provider-env QRP_PROMPT_MODE --provider-env QRP_TIMEOUT_MS --provider-env QRP_MAX_TOKENS --provider-env QRP_HTTP_PROTOCOL)
case "$ROLE" in consult) tmo=21600;; reviewer) tmo=18000;; *) tmo=10800;; esac
say "lane=$LANE role=$ROLE START runner=$RUNNER model=$MODEL model_version=$MODEL_VERSION version_source=$VERSION_SOURCE effort=$EFFORT(none sent) endpoint=$EPNAME dry=$DRY"
( export QRP_TIMEOUT_MS=570000 QRP_PROMPT_MODE="$mode" QRP_MODEL="$MODEL" QRP_PROVIDER="$LANE-local-anthropic" QRP_MAX_TOKENS=32768 QRP_HTTP_PROTOCOL=messages
  timeout "$tmo" bash "$REPO/scripts/engine-qualify.sh" "$ROLE" \
    --engine "$ENGINE" --model "$MODEL" --model-version "$MODEL_VERSION" \
    --runner "$RUNNER" --runner-version "$(idv runner_version)" --family "$FAMILY" \
    --harness-version "$(idv harness_version)" --effort "$EFFORT" \
    --prompt-config-hash "$(idv prompt_config_hash)" --semantic-fingerprint "$(idv semantic_fingerprint)" \
    --containment-fingerprint "$(idv containment_fingerprint)" \
    --remote-provider-cmd "$PROVIDER_CMD" --remote-provider "$LANE-local-anthropic" --remote-timeout-ms 600000 "${PENV[@]}" \
    --task-class "$tc" --domain cross-cutting --language en --tool read_only --version-source "$VERSION_SOURCE" \
    --raw-dir "$D/raw" "${extra[@]}" > "$D/stdout.json" 2> "$D/stderr.log" )
rc=$?
cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null
fin "$rc"
