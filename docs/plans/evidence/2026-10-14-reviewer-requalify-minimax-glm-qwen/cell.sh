#!/usr/bin/env bash
# cell.sh <minimax|glm|qwen>
# One reviewer administration at effort=high. Never records to the scorecard; the operator records
# emit-row.json by hand (record.sh) after reading the result.
# Run detached: setsid nohup bash cell.sh <lane> > /dev/null 2>&1 &   ; wait for 'rc=' in out/<lane>/run.log
# DRY_RUN=1: parameter-layer check only — fake provider, scratch --store, no network, no staging, no spend.
set -uo pipefail
LANE="${1:?lane minimax|glm|qwen}"
case "$LANE" in minimax|glm|qwen) ;; *) echo "bad lane" >&2; exit 2;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
DRY="${DRY_RUN:-0}"
D="$HERE/out/$LANE"; [ "$DRY" = 1 ] && D="$HERE/out/dry-$LANE"
mkdir -p "$D/raw"
LOG="$D/run.log"
say() { echo "$(date -Is) $*" >> "$LOG"; }
cd "$REPO" || exit 2

node "$HERE/derive-fingerprints.js" "$LANE" "$REPO" > /dev/null || { say "fingerprint derivation failed"; echo "rc=2" >> "$LOG"; exit 2; }
idv() { node -e "console.log(require('$HERE/identity/reviewer-$LANE.json')['$1'])"; }
MODEL="$(idv identity)"; ENGINE="$(idv engine)"; FAMILY="$(idv family)"; RUNNER="$(idv runner)"
[ "$LANE" = qwen ] && MODEL="$ENGINE"   # qwen: display id == --model Qwen3.8-Max (event 161/183 form)

PROVIDER_CMD="node $REPO/scripts/qualification-review-provider.js"
[ "$DRY" = 1 ] && PROVIDER_CMD="node /nonexistent-dry-run-provider.js"
extra_flags=(); exports=()
MODEL_VERSION="$MODEL"; VERSION_SOURCE=operator-asserted

if [ "$LANE" = qwen ]; then
  PROVIDER=qoderclicn-qwen
  STAGING_ROOT="$HOME/.autopilot/qualify-staging/reviewer-qwen3.8-max-qoderclicn"
  STAGING_HOME="$STAGING_ROOT/qoder-config-dir"; AUTH="$STAGING_HOME/.auth"
  if [ "$DRY" != 1 ]; then
    source "$REPO/scripts/lib/qualify-stage-credentials.sh"
    mkdir -p "$AUTH"; chmod 700 "$STAGING_ROOT" "$STAGING_HOME" 2>/dev/null || true
    for f in dynamic-error-codes.json machine_id; do qualify_stage_identity "$AUTH/$f" "$HOME/.qoder-cn/.auth/$f"; done
    for f in user .credential-transaction; do qualify_stage_credential "$AUTH/$f" "$HOME/.qoder-cn/.auth/$f" execute; done
    [ -f "$AUTH/user" ] || { say "no qoder credential staged"; echo "rc=2" >> "$LOG"; exit 2; }
  fi
  PENV=(--provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE
        --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT
        --provider-env QRP_CLI_HOME --provider-env QRP_TIMEOUT_MS)
else
  PROVIDER="$LANE-anthropic"
  [ "$DRY" = 1 ] && export QRP_BASE_URL=http://127.0.0.1:9 QRP_AUTH_TOKEN=dry-run-not-a-token
  if [ "$DRY" != 1 ]; then
    source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1
    uvar="AUTOPILOT_ENDPOINT_$(echo "$LANE" | tr a-z A-Z)_URL"; tvar="AUTOPILOT_ENDPOINT_$(echo "$LANE" | tr a-z A-Z)_TOKEN"
    export QRP_BASE_URL="${!uvar:-}" QRP_AUTH_TOKEN="${!tvar:-}"
    [ -n "$QRP_BASE_URL" ] && [ -n "$QRP_AUTH_TOKEN" ] || { say "endpoint $LANE url/token missing"; echo "rc=2" >> "$LOG"; exit 2; }
    # one-token runtime identity probe (not an exam case): record the model id the endpoint resolves to.
    probed="$(QRP_PROBE_MODEL="$MODEL" node -e '
      (async()=>{const r=await fetch(process.env.QRP_BASE_URL.replace(/\/+$/,"")+"/v1/messages",{method:"POST",
        headers:{"content-type":"application/json","anthropic-version":"2023-06-01","x-api-key":process.env.QRP_AUTH_TOKEN,authorization:"Bearer "+process.env.QRP_AUTH_TOKEN},
        body:JSON.stringify({model:process.env.QRP_PROBE_MODEL,max_tokens:16,messages:[{role:"user",content:"ping"}]}),signal:AbortSignal.timeout(60000)});
        const j=await r.json(); process.stdout.write(String(j.model||""));})().catch(()=>process.stdout.write(""));' 2>/dev/null)"
    say "runtime probe: requested=$MODEL resolved=${probed:-<none>}"
    if [[ "$probed" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then MODEL_VERSION="$probed"; VERSION_SOURCE=runtime; fi
  fi
  PENV=(--provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN --provider-env QRP_MODEL
        --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_TIMEOUT_MS)
fi
[ "$DRY" = 1 ] && extra_flags+=(--store "$D/dry-store.jsonl")

say "lane=$LANE START model=$MODEL model_version=$MODEL_VERSION version_source=$VERSION_SOURCE dry=$DRY"
( export QRP_TIMEOUT_MS=570000 QRP_PROMPT_MODE=reviewer QRP_MODEL="$MODEL" QRP_PROVIDER="$PROVIDER"
  if [ "$LANE" = qwen ]; then export QRP_TRANSPORT=cli QRP_CLI_KIND=qoderclicn QRP_CLI_EFFORT=high QRP_CLI_HOME="${STAGING_HOME:-/nonexistent}"; fi
  timeout 18000 bash "$REPO/scripts/engine-qualify.sh" reviewer \
    --engine "$ENGINE" --model "$MODEL" --model-version "$MODEL_VERSION" \
    --runner "$RUNNER" --runner-version "$(idv runner_version)" --family "$FAMILY" \
    --harness-version "$(idv harness_version)" --effort high \
    --prompt-config-hash "$(idv prompt_config_hash)" \
    --semantic-fingerprint "$(idv semantic_fingerprint)" \
    --containment-fingerprint "$(idv containment_fingerprint)" \
    --remote-provider-cmd "$PROVIDER_CMD" --remote-provider "$PROVIDER" \
    --remote-timeout-ms 600000 "${PENV[@]}" \
    --task-class code_review --domain cross-cutting --language en --tool read_only \
    --version-source "$VERSION_SOURCE" \
    --raw-dir "$D/raw" --emit-row "${extra_flags[@]}" > "$D/stdout.json" 2> "$D/stderr.log" )
rc=$?
cp "$D/stdout.json" "$D/emit-row.json"
echo "$rc" > "$D/rc"
say "lane=$LANE END rc=$rc (0=pass 1=fail-verdict 2=usage/precondition 124=wall timeout)"
echo "rc=$rc" >> "$LOG"
