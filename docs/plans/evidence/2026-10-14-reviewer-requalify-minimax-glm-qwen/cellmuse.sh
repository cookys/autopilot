#!/usr/bin/env bash
# cellmuse.sh <consult|discuss|brain|verification_author|implementer> — Muse Spark 1.3 (OpenCode Go contributor tier) cell.
# Broker roles: HTTP OpenAI Responses via qualification-review-provider.js (QRP_HTTP_PROTOCOL=responses, x-opencode-session);
#   the opencode CLI is always refused by the provider for these modes. Key read from opencode's own auth.json, never printed.
# implementer: live opencode rail (engine-qualify.js implementer, runner opencode, effort high).
# Output: out/m-muse-<role>/{run.log,stdout.json,stderr.log,raw/,rc,emit-row.json}. DRY_RUN=1: no network, no spend.
# rc: 0 pass, 1 fail verdict, 2 usage/precondition, 3 credential unusable, 124 wall timeout.
set -uo pipefail
ROLE="${1:?role}"; EFF="${2:-default}"; LANE=muse; [ "$EFF" = default ] || LANE="muse_$EFF"; OUTLANE=muse; [ "$EFF" = default ] || OUTLANE="muse-$EFF"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
DRY="${DRY_RUN:-0}"
D="$HERE/out/m-$OUTLANE-$ROLE"; [ "$DRY" = 1 ] && D="$HERE/out/dry-m-$OUTLANE-$ROLE"
mkdir -p "$D/raw"; LOG="$D/run.log"
say() { echo "$(date -Is) $*" >> "$LOG"; }
fin() { echo "$1" > "$D/rc"; say "lane=$OUTLANE role=$ROLE END rc=$1 (0 pass,1 fail verdict,2 usage/precond,3 credential,124 wall)"; echo "rc=$1" >> "$LOG"; exit "$1"; }
cd "$REPO" || exit 2
KEY="$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.local/share/opencode/auth.json","utf8"))["opencode-go"].key)}catch(e){}')"
extra=(); PENV=()

if [ "$ROLE" = implementer ]; then
  ENGINE=opencode-go/muse-spark-1.3-contributor; MV=opencode-go:muse-spark-1.3-contributor; RUNNER=opencode; FAMILY=meta
  RV="$(node scripts/lib/runner-binary.js version --runner "$RUNNER" --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).token)')"
  ARGV=(node scripts/engine-qualify.js implementer --engine "$ENGINE" --model "$ENGINE" --model-version "$MV"
    --runner "$RUNNER" --runner-version "$RV" --family "$FAMILY" --harness-version dispatch-hetero:7481ead3 --effort $([ "$EFF" = default ] && echo high || echo $EFF)
    --prompt-config-hash 16b45e1a0ed185e494a602fd84e249f12fd6f86be0ab2b18ba3d5a6c64db7a5a
    --semantic-fingerprint d8af529058764fa0276f57633d26eb8a7e61089b441982a7cf29ed3913029d0a
    --containment-fingerprint 2c1042fc7187841565fa4c9fafa2f25fa7efda49f0ed911cd0363300e21738fd
    --task-class bounded_implementation --domain repository --language en --tool git_commit
    --version-source operator-asserted --expires-days 90 --raw-dir "$D/raw" --emit-row)
  if [ "$DRY" = 1 ]; then say "DRY implementer argv: ${ARGV[*]}"; fin 0; fi
  say "lane=$OUTLANE role=implementer START effort=$EFF"
  timeout 10800 "${ARGV[@]}" > "$D/stdout.json" 2> "$D/stderr.log"; rc=$?
  cp "$D/stdout.json" "$D/emit-row.json"; fin "$rc"
fi

node "$HERE/derive-matrix.js" "$LANE" "$ROLE" "$REPO" > /dev/null || { say "fingerprint derivation failed"; fin 2; }
idv() { node -e "console.log(require('$HERE/identity/$ROLE-$LANE.json')['$1'])"; }
MODEL="$(idv identity)"; ENGINE="$(idv engine)"; FAMILY="$(idv family)"; RUNNER="$(idv runner)"; EFFORT="$(idv effort)"
MODEL_VERSION="$MODEL"; VERSION_SOURCE=operator-asserted
case "$ROLE" in
  reviewer)            mode=reviewer; tc=code_review;;
  verification_author) mode=va;      tc=verification_authoring;;
  consult)             mode=consult; tc=consult; extra=(--execute);;
  discuss)             mode=discuss; tc=discuss; extra=(--execute);;
  brain)               mode=brain;   tc=brain-seat;;
  *) say "unsupported role $ROLE"; fin 2;;
esac
extra+=(--emit-row)
case "$ROLE" in consult|discuss) tmo=21600;; reviewer) tmo=18000;; *) tmo=10800;; esac
PROVIDER=opencode-go
PROVIDER_CMD="node $REPO/scripts/qualification-review-provider.js"
[ "$DRY" = 1 ] && PROVIDER_CMD="node /nonexistent-dry-run-provider.js" && extra+=(--store "$D/dry-store.jsonl")
PENV=(--provider-env QRP_BASE_URL --provider-env QRP_AUTH_TOKEN --provider-env QRP_MODEL --provider-env QRP_PROVIDER
      --provider-env QRP_PROMPT_MODE --provider-env QRP_TIMEOUT_MS --provider-env QRP_TRANSPORT --provider-env QRP_HTTP_PROTOCOL
      --provider-env QRP_OPENCODE_SESSION --provider-env QRP_MAX_TOKENS)
[ "$EFF" = default ] || PENV+=(--provider-env QRP_HTTP_EFFORT)
if [ "$DRY" = 1 ]; then export QRP_BASE_URL=http://127.0.0.1:9 QRP_AUTH_TOKEN=dry-run-not-a-token
else
  [ -n "$KEY" ] || { say "opencode-go key missing in opencode auth.json"; fin 3; }
  export QRP_BASE_URL=https://opencode.ai/zen/go QRP_AUTH_TOKEN="$KEY"
fi
SES="ses_$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)"
if [ "$DRY" != 1 ]; then
  probed="$(QRP_SES="$SES" EFFP="$([ "$EFF" = default ] || echo "$EFF")" node -e '
    (async()=>{const r=await fetch(process.env.QRP_BASE_URL+"/v1/responses",{method:"POST",
      headers:{"content-type":"application/json",authorization:"Bearer "+process.env.QRP_AUTH_TOKEN,"x-opencode-session":process.env.QRP_SES},
      body:JSON.stringify({model:"muse-spark-1.3-contributor",input:"ping",max_output_tokens:4096,...(process.env.EFFP?{reasoning:{effort:process.env.EFFP}}:{})}),signal:AbortSignal.timeout(90000)});
      const j=await r.json(); process.stdout.write(r.status+" "+String(j.model||"")+" "+String(j.status||(j.error&&j.error.message)||"")+" echo_effort="+String(j.reasoning&&j.reasoning.effort));})().catch(e=>process.stdout.write("ERR "+e.message));' 2>/dev/null)"
  say "runtime probe: status/model/state=${probed:-<none>}"
  case "$probed" in 200\ *) ;; *) say "credential/route unusable"; fin 3;; esac
  pm="$(echo "$probed" | awk '{print $2}')"
  if [[ "$pm" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then MODEL_VERSION="$pm"; VERSION_SOURCE=runtime; fi
fi
[ "$DRY" = 1 ] && { [ "$ROLE" = consult ] || [ "$ROLE" = discuss ]; } && extra=(--plan --emit-row)
say "lane=$OUTLANE role=$ROLE START model=$MODEL model_version=$MODEL_VERSION version_source=$VERSION_SOURCE dry=$DRY"
( export QRP_TIMEOUT_MS=570000 QRP_PROMPT_MODE="$mode" QRP_MODEL="$MODEL" QRP_PROVIDER="$PROVIDER" QRP_TRANSPORT=http
  export QRP_HTTP_PROTOCOL=responses QRP_OPENCODE_SESSION="$SES" QRP_MAX_TOKENS=32768
  [ "$EFF" = default ] || export QRP_HTTP_EFFORT="$EFF"
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
cp "$D/stdout.json" "$D/emit-row.json"
fin "$rc"
