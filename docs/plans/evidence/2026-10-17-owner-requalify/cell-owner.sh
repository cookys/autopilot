#!/usr/bin/env bash
# cell-owner.sh <lane> [attempt-suffix]   -- one owner (foreman intent/control) sitting, effort per lane (see derive-owner.js).
# Never records to the scorecard (record.sh does, by hand, after reading emit-row.json / stderr.log).
# Detach: setsid nohup bash cell-owner.sh <lane> > /dev/null 2>&1 < /dev/null &    wait for 'rc=' in out/<lane>/run.log
# DRY_RUN=1: parameter layer only -- fake provider command, scratch --store, no staging, no network, no spend.
set -uo pipefail
LANE="${1:?lane}"; SUF="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
OLD="$REPO/docs/plans/evidence/2026-10-14-reviewer-requalify-minimax-glm-qwen"
DRY="${DRY_RUN:-0}"
D="$HERE/out/$LANE$SUF"; [ "$DRY" = 1 ] && D="$HERE/out/dry-$LANE"
mkdir -p "$D/raw"; LOG="$D/run.log"; : > "$LOG"
say() { echo "$(date -Is) $*" >> "$LOG"; }
cd "$REPO" || exit 2
node "$HERE/derive-owner.js" "$LANE" "$REPO" > "$D/identity.json" || { say "identity derivation failed"; echo "rc=2" >> "$LOG"; exit 2; }
idv() { node -e "const v=require('$D/identity.json')['$1'];console.log(v===null?'':v)"; }
KIND="$(idv kind)"; ENGINE="$(idv engine)"; MODEL="$(idv model)"; MV="$(idv model_version)"; RUNNER="$(idv runner)"; RV="$(idv runner_version)"
FAMILY="$(idv family)"; EFFORT="$(idv effort)"; PROVIDER="$(idv provider)"; HARNESS="$(idv harness_version)"
PCMD="node $REPO/scripts/qualification-review-provider.js"
[ "$DRY" = 1 ] && PCMD="node /nonexistent-dry-run-provider.js"
VSRC=operator-asserted; TIMEOUT_MS=570000; REMOTE_MS=600000
ENVV=(QRP_PROMPT_MODE=owner QRP_MODEL="$MODEL" QRP_PROVIDER="$PROVIDER")
PENV=(--provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_TIMEOUT_MS)
source "$REPO/scripts/lib/qualify-stage-credentials.sh"
cli() { ENVV+=(QRP_TRANSPORT=cli QRP_CLI_KIND="$1"); PENV+=(--provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND); }
home() { ENVV+=("$1=$2"); PENV+=(--provider-env "$1"); }
effort() { ENVV+=(QRP_CLI_EFFORT="$EFFORT"); PENV+=(--provider-env QRP_CLI_EFFORT); }
case "$KIND" in
  claude)
    CD="$HOME/.autopilot/exam-claude-config-owner-$LANE"
    if [ "$DRY" != 1 ]; then mkdir -p "$CD"; chmod 700 "$CD"; qualify_stage_credential "$CD/.credentials.json" "$HOME/.claude/.credentials.json" execute
      [ -f "$CD/.credentials.json" ] || { say "no claude credentials staged"; echo "rc=2" >> "$LOG"; exit 2; }; fi
    cli claude; effort; home CLAUDE_CONFIG_DIR "$CD";;
  codex)
    SCR="${XDG_RUNTIME_DIR:-/dev/shm}/owner-codex-home-$LANE"
    if [ "$DRY" != 1 ]; then rm -rf "$SCR"; mkdir -p "$SCR"; cp "$HOME/.codex/auth.json" "$SCR/auth.json"; chmod 600 "$SCR/auth.json"; fi
    cli codex; effort; home CODEX_HOME "$SCR"; TIMEOUT_MS=300000; REMOTE_MS=360000;;
  grok)
    cli grok; effort; home QRP_CLI_HOME "$HOME/.autopilot/exam-grok-home"; TIMEOUT_MS=300000; REMOTE_MS=360000;;
  agy)
    SR="$HOME/.autopilot/qualify-staging/owner-argon-$LANE"; SH="$SR/agy-home"; SA="$SH/.gemini/antigravity-cli"; RA="$HOME/.gemini/antigravity-cli"
    if [ "$DRY" != 1 ]; then mkdir -p "$SA"; chmod 700 "$SR" "$SH"; for f in installation_id settings.json; do qualify_stage_identity "$SA/$f" "$RA/$f"; done
      qualify_stage_credential "$SA/antigravity-oauth-token" "$RA/antigravity-oauth-token" execute
      [ -f "$SA/antigravity-oauth-token" ] || { say "no agy oauth token staged"; echo "rc=2" >> "$LOG"; exit 2; }; fi
    cli agy; home QRP_CLI_HOME "$SH";;
  qoderclicn)
    SR="$HOME/.autopilot/qualify-staging/owner-qwen3.8-max-qoderclicn"; SH="$SR/qoder-config-dir"; AUTH="$SH/.auth"
    if [ "$DRY" != 1 ]; then mkdir -p "$AUTH"; chmod 700 "$SR" "$SH"
      for f in dynamic-error-codes.json machine_id; do qualify_stage_identity "$AUTH/$f" "$HOME/.qoder-cn/.auth/$f"; done
      for f in user .credential-transaction; do qualify_stage_credential "$AUTH/$f" "$HOME/.qoder-cn/.auth/$f" execute; done
      [ -f "$AUTH/user" ] || { say "no qoder credential staged"; echo "rc=2" >> "$LOG"; exit 2; }; fi
    cli qoderclicn; effort; home QRP_CLI_HOME "$SH";;
  kimi)
    if [ "$LANE" = kimi-k3-high ]; then PROBE=kimi-auth-probe.sh; SH="$HOME/.autopilot/qualify-staging/reviewer-kimi-k3/kimi-home"
    else PROBE=kimi28-stage-probe.sh; SH="$HOME/.autopilot/qualify-staging/reviewer-kimi-k2.8-preview/kimi-home"; fi
    if [ "$DRY" != 1 ]; then
      bash "$OLD/$PROBE" > "$D/probe.log" 2>&1; prc=$?
      if [ "$prc" != 0 ]; then say "kimi probe rc=$prc: $(tail -c 300 "$D/probe.log" | tr '\n' ' ')"; echo "rc=3" >> "$LOG"; echo 3 > "$D/rc"; exit 3; fi
      qualify_kimi_arm_writeback "$SH/.kimi-code"
    fi
    cli kimi; home QRP_CLI_HOME "$SH";;
  opencode)
    SH="$HOME/.autopilot/exam-opencode-home"
    if [ "$DRY" != 1 ]; then mkdir -p "$SH/.local/share/opencode"; cp "$HOME/.local/share/opencode/auth.json" "$SH/.local/share/opencode/auth.json"; chmod 600 "$SH/.local/share/opencode/auth.json"; fi
    cli opencode; effort; home QRP_CLI_HOME "$SH"; TIMEOUT_MS=300000; REMOTE_MS=360000;;
  http)
    EP="$(idv endpoint)"; U="AUTOPILOT_ENDPOINT_$(echo "$EP" | tr a-z A-Z)_URL"; T="AUTOPILOT_ENDPOINT_$(echo "$EP" | tr a-z A-Z)_TOKEN"
    if [ "$DRY" = 1 ]; then export QRP_BASE_URL=http://127.0.0.1:9 QRP_AUTH_TOKEN=dry-run-not-a-token
    else source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1
      export QRP_BASE_URL="${!U:-}" QRP_AUTH_TOKEN="${!T:-}"
      [ -n "$QRP_BASE_URL" ] && [ -n "$QRP_AUTH_TOKEN" ] || { say "endpoint $EP url/token missing"; echo "rc=2" >> "$LOG"; exit 2; }
      probed="$(QRP_PROBE_MODEL="$MODEL" node -e '(async()=>{const r=await fetch(process.env.QRP_BASE_URL.replace(/\/+$/,"")+"/v1/messages",{method:"POST",headers:{"content-type":"application/json","anthropic-version":"2023-06-01","x-api-key":process.env.QRP_AUTH_TOKEN,authorization:"Bearer "+process.env.QRP_AUTH_TOKEN},body:JSON.stringify({model:process.env.QRP_PROBE_MODEL,max_tokens:16,messages:[{role:"user",content:"ping"}]}),signal:AbortSignal.timeout(60000)});const j=await r.json();process.stdout.write(String(j.model||""));})().catch(()=>process.stdout.write(""));' 2>/dev/null)"
      say "runtime probe: requested=$MODEL resolved=${probed:-<none>}"
      if [[ "$probed" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then MV="$probed"; VSRC=runtime; fi
    fi
    PENV+=(--provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN);;
esac
XF=(); [ "$DRY" = 1 ] && XF+=(--store "$D/dry-store.jsonl")
say "lane=$LANE START kind=$KIND model=$MODEL mv=$MV vsrc=$VSRC dry=$DRY harness=$HARNESS"
( set -o pipefail
  env QRP_TIMEOUT_MS=$TIMEOUT_MS "${ENVV[@]}" timeout 10800 bash "$REPO/scripts/engine-qualify.sh" owner \
    --engine "$ENGINE" --model "$MODEL" --model-version "$MV" \
    --runner "$RUNNER" --runner-version "$RV" --family "$FAMILY" \
    --harness-version "$HARNESS" --effort "$EFFORT" \
    --prompt-config-hash "$(idv prompt_config_hash)" \
    --semantic-fingerprint "$(idv semantic_fingerprint)" \
    --containment-fingerprint "$(idv containment_fingerprint)" \
    --remote-provider-cmd "$PCMD" --remote-provider "$PROVIDER" \
    --remote-timeout-ms $REMOTE_MS "${PENV[@]}" \
    --task-class owner_intent_control --domain cross-cutting --language en --tool read_only \
    --version-source "$VSRC" --raw-dir "$D/raw" --emit-row "${XF[@]}" > "$D/stdout.json" 2> "$D/stderr.log" )
rc=$?
cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null
echo "$rc" > "$D/rc"
say "lane=$LANE END rc=$rc (0=pass 1=fail-verdict 2=usage/precondition 124=wall timeout)"
echo "rc=$rc" >> "$LOG"
exit "$rc"
