#!/usr/bin/env bash
# cellx.sh <glm|minimax|minimax31|qwen|kimi> <reviewer|verification_author|consult|discuss|brain|implementer>
# One administration (one matrix cell). Never records to the scorecard; the operator records emit-row.json by hand.
# Output: out/m-<lane>-<role>/{run.log,stdout.json,stderr.log,raw/,rc,emit-row.json}; run.log ends with 'rc=<n>'.
# DRY_RUN=1: parameter layer only. consult/discuss use the qualifier's own --plan; others run with a nonexistent
#   provider command and a scratch --store; implementer prints the argv. No network, no staging, no spend.
# rc: 0 pass, 1 fail verdict, 2 usage/precondition, 3 credential unusable (uncharged), 124 wall timeout.
# FAIL-FAST NOTE: this script adds none. The qualifier's own early-stop rules (see matrix.md) are NOT disabled here.
set -uo pipefail
LANE="${1:?lane}"; ROLE="${2:?role}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
DRY="${DRY_RUN:-0}"
D="$HERE/out/m-$LANE-$ROLE"; [ "$DRY" = 1 ] && D="$HERE/out/dry-m-$LANE-$ROLE"
mkdir -p "$D/raw"; LOG="$D/run.log"
say() { echo "$(date -Is) $*" >> "$LOG"; }
fin() { echo "$1" > "$D/rc"; say "lane=$LANE role=$ROLE END rc=$1 (0 pass,1 fail verdict,2 usage/precond,3 credential,124 wall)"; echo "rc=$1" >> "$LOG"; exit "$1"; }
case "$LANE" in glm|minimax|minimax31|qwen|kimi) ;; *) echo "bad lane" >&2; exit 2;; esac
cd "$REPO" || exit 2
extra=(); emit=1; PENV=(); MODEL_VERSION=""; VERSION_SOURCE=operator-asserted

# ---------- implementer: live rail (qualification-sweep.sh's administration command, minus its scorecard record) ----------
if [ "$ROLE" = implementer ]; then
  case "$LANE" in
    minimax31) ENGINE=MiniMax-M3.1-Flash-Preview; MODEL=$ENGINE; MV=$ENGINE; RUNNER=cc-shim; FAMILY=minimax; EXTRA=(--endpoint minimax);;
    kimi)      ENGINE=kimi-code/k3; MODEL=$ENGINE; MV=kimi-code:k3; RUNNER=kimi; FAMILY=moonshot; EXTRA=();;
    *) say "implementer not scheduled for $LANE (already qualified)"; fin 2;;
  esac
  if [ "$RUNNER" = kimi ] && [ "$DRY" != 1 ]; then bash "$HERE/kimi-auth-probe.sh" >> "$LOG" 2>&1 || { say "kimi credential unusable"; fin 3; }; fi
  RV="$(node scripts/lib/runner-binary.js version --runner "$RUNNER" --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).token)')"
  ARGV=(node scripts/engine-qualify.js implementer --engine "$ENGINE" --model "$MODEL" --model-version "$MV"
    --runner "$RUNNER" --runner-version "$RV" --family "$FAMILY" --harness-version dispatch-hetero:7481ead3 --effort high
    --prompt-config-hash 16b45e1a0ed185e494a602fd84e249f12fd6f86be0ab2b18ba3d5a6c64db7a5a
    --semantic-fingerprint d8af529058764fa0276f57633d26eb8a7e61089b441982a7cf29ed3913029d0a
    --containment-fingerprint 2c1042fc7187841565fa4c9fafa2f25fa7efda49f0ed911cd0363300e21738fd
    --task-class bounded_implementation --domain repository --language en --tool git_commit
    --version-source operator-asserted --expires-days 90 "${EXTRA[@]}" --raw-dir "$D/raw" --emit-row)
  if [ "$DRY" = 1 ]; then say "DRY implementer argv: ${ARGV[*]}"; fin 0; fi
  if [ -n "${EXTRA[*]:-}" ]; then source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1; fi
  say "lane=$LANE role=implementer START"
  timeout 10800 "${ARGV[@]}" > "$D/stdout.json" 2> "$D/stderr.log"; rc=$?
  cp "$D/stdout.json" "$D/emit-row.json"; fin "$rc"
fi

# ---------- broker roles ----------
node "$HERE/derive-matrix.js" "$LANE" "$ROLE" "$REPO" > /dev/null || { say "fingerprint derivation failed"; fin 2; }
idv() { node -e "console.log(require('$HERE/identity/$ROLE-$LANE.json')['$1'])"; }
MODEL="$(idv identity)"; ENGINE="$(idv engine)"; FAMILY="$(idv family)"; RUNNER="$(idv runner)"; EFFORT="$(idv effort)"
MODEL_VERSION="$MODEL"; [ "$LANE" = kimi ] && MODEL_VERSION="$ENGINE"; [ "$LANE" = qwen ] && MODEL="$ENGINE"
case "$ROLE" in
  reviewer)            mode=reviewer; tc=code_review;;
  verification_author) mode=va;       tc=verification_authoring;;
  consult)             mode=consult;  tc=consult; extra=(--execute);;
  discuss)             mode=discuss;  tc=discuss; extra=(--execute);;
  brain)               mode=brain;    tc=brain-seat; emit=0;;
  *) say "unsupported role $ROLE"; fin 2;;
esac
[ "$emit" = 1 ] && extra+=(--emit-row)
case "$ROLE" in consult|discuss) tmo=21600;; reviewer) tmo=18000;; *) tmo=10800;; esac
PROVIDER_CMD="node $HERE/qrp-lenient.js"   # cellx2: VA malformed-JSON replies are graded, not aborted
[ "$DRY" = 1 ] && PROVIDER_CMD="node /nonexistent-dry-run-provider.js"
[ "$DRY" = 1 ] && extra+=(--store "$D/dry-store.jsonl")
MAXTOK=""; if [ "$ROLE" = brain ] || [ "$LANE" = minimax31 ]; then MAXTOK=32768; fi   # thinking shares max_tokens (provider header); brain bundle grows

if [ "$LANE" = qwen ] || [ "$LANE" = kimi ]; then
  if [ "$LANE" = qwen ]; then
    PROVIDER=qoderclicn-qwen; STAGING_ROOT="$HOME/.autopilot/qualify-staging/reviewer-qwen3.8-max-qoderclicn"
    STAGING_HOME="$STAGING_ROOT/qoder-config-dir"; AUTH="$STAGING_HOME/.auth"
    if [ "$DRY" != 1 ]; then
      source "$REPO/scripts/lib/qualify-stage-credentials.sh"; mkdir -p "$AUTH"; chmod 700 "$STAGING_ROOT" "$STAGING_HOME" 2>/dev/null || true
      for f in dynamic-error-codes.json machine_id; do qualify_stage_identity "$AUTH/$f" "$HOME/.qoder-cn/.auth/$f"; done
      for f in user .credential-transaction; do qualify_stage_credential "$AUTH/$f" "$HOME/.qoder-cn/.auth/$f" execute; done
      [ -f "$AUTH/user" ] || { say "no qoder credential staged"; fin 2; }
    fi
  else
    PROVIDER=moonshot; STAGING_ROOT="$HOME/.autopilot/qualify-staging/reviewer-kimi-k3"; STAGING_HOME="$STAGING_ROOT/kimi-home"
    if [ "$DRY" != 1 ]; then bash "$HERE/kimi-auth-probe.sh" >> "$LOG" 2>&1 || { say "kimi credential unusable (owner must log in again)"; fin 3; }; fi
  fi
  PENV=(--provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT
        --provider-env QRP_CLI_KIND --provider-env QRP_CLI_HOME --provider-env QRP_TIMEOUT_MS)
  [ "$LANE" = qwen ] && PENV+=(--provider-env QRP_CLI_EFFORT)
else
  PROVIDER="$LANE-anthropic"
  PENV=(--provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN --provider-env QRP_MODEL --provider-env QRP_PROVIDER
        --provider-env QRP_PROMPT_MODE --provider-env QRP_TIMEOUT_MS)
  [ -n "$MAXTOK" ] && PENV+=(--provider-env QRP_MAX_TOKENS)
  if [ "$DRY" = 1 ]; then export QRP_BASE_URL=http://127.0.0.1:9 QRP_AUTH_TOKEN=dry-run-not-a-token
  else
    source "$REPO/scripts/load-endpoints-env.sh"; autopilot_load_endpoints_env > /dev/null 2>&1
    up="$(echo "$LANE" | tr a-z A-Z | sed s/31//)"; uvar="AUTOPILOT_ENDPOINT_${up}_URL"; tvar="AUTOPILOT_ENDPOINT_${up}_TOKEN"
    export QRP_BASE_URL="${!uvar:-}" QRP_AUTH_TOKEN="${!tvar:-}"
    [ -n "$QRP_BASE_URL" ] && [ -n "$QRP_AUTH_TOKEN" ] || { say "endpoint $LANE url/token missing"; fin 2; }
    probed="$(QRP_PROBE_MODEL="$MODEL" node -e '
      (async()=>{const r=await fetch(process.env.QRP_BASE_URL.replace(/\/+$/,"")+"/v1/messages",{method:"POST",
        headers:{"content-type":"application/json","anthropic-version":"2023-06-01","x-api-key":process.env.QRP_AUTH_TOKEN,authorization:"Bearer "+process.env.QRP_AUTH_TOKEN},
        body:JSON.stringify({model:process.env.QRP_PROBE_MODEL,max_tokens:16,messages:[{role:"user",content:"ping"}]}),signal:AbortSignal.timeout(60000)});
        const j=await r.json(); process.stdout.write(String(j.model||""));})().catch(()=>process.stdout.write(""));' 2>/dev/null)"
    say "runtime probe: requested=$MODEL resolved=${probed:-<none>}"
    if [[ "$probed" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then MODEL_VERSION="$probed"; VERSION_SOURCE=runtime; fi
  fi
fi
[ "$DRY" = 1 ] && [ "$ROLE" = consult -o "$ROLE" = discuss ] && extra=(--plan)

say "lane=$LANE role=$ROLE START model=$MODEL model_version=$MODEL_VERSION version_source=$VERSION_SOURCE dry=$DRY"
( export QRP_TIMEOUT_MS=570000 QRP_PROMPT_MODE="$mode" QRP_MODEL="$MODEL" QRP_PROVIDER="$PROVIDER"
  [ -n "$MAXTOK" ] && export QRP_MAX_TOKENS="$MAXTOK"
  [ "$LANE" = qwen ] && export QRP_TRANSPORT=cli QRP_CLI_KIND=qoderclicn QRP_CLI_EFFORT=high QRP_CLI_HOME="${STAGING_HOME:-/nonexistent}"
  [ "$LANE" = kimi ] && export QRP_TRANSPORT=cli QRP_CLI_KIND=kimi QRP_CLI_HOME="${STAGING_HOME:-/nonexistent}"
  timeout "$tmo" bash "$REPO/scripts/engine-qualify.sh" "$ROLE" \
    --engine "$ENGINE" --model "$MODEL" --model-version "$MODEL_VERSION" \
    --runner "$RUNNER" --runner-version "$(idv runner_version)" --family "$FAMILY" \
    --harness-version "$(idv harness_version)" --effort "$EFFORT" \
    --prompt-config-hash "$(idv prompt_config_hash)" --semantic-fingerprint "$(idv semantic_fingerprint)" \
    --containment-fingerprint "$(idv containment_fingerprint)" \
    --remote-provider-cmd "$PROVIDER_CMD" --remote-provider "$PROVIDER" --remote-timeout-ms 600000 "${PENV[@]}" \
    --task-class "$tc" --domain cross-cutting --language en --tool read_only --version-source "$VERSION_SOURCE" \
    --raw-dir "$D/raw" "${extra[@]}" > "$D/stdout.json" 2> "$D/stderr.log" )
rc=$?
[ "$emit" = 1 ] && cp "$D/stdout.json" "$D/emit-row.json"
fin "$rc"
