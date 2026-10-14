#!/usr/bin/env bash
# cell.sh <reviewer|brain|verification_author|consult|discuss> <low|high>
# One administration of gemini-4-argon-<effort> over agy (QRP_CLI_KIND=agy). Never records to the scorecard;
# the operator records emit-row.json by hand after reading the result (as the 2026-10-12 claude lanes did).
# Run detached: setsid nohup bash cell.sh <role> <effort> > /dev/null 2>&1 &  ; wait for 'rc=' in out/<role>-<effort>/run.log
set -uo pipefail
ROLE="${1:?role}"; EFFORT="${2:?effort}"
case "$EFFORT" in low|medium|high) ;; *) echo "bad effort" >&2; exit 2;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
MODEL="gemini-4-argon-$EFFORT"
D="$HERE/out/rv6-argon-$ROLE-$EFFORT"
mkdir -p "$D/raw"
LOG="$D/run.log"
say() { echo "$(date -Is) $*" >> "$LOG"; }
cd "$REPO" || exit 2

source "$REPO/scripts/lib/qualify-stage-credentials.sh"
STAGING_ROOT="$HOME/.autopilot/qualify-staging/argon-agy"
STAGING_HOME="$STAGING_ROOT/agy-home"
STAGING_AGY_DIR="$STAGING_HOME/.gemini/antigravity-cli"
mkdir -p "$STAGING_AGY_DIR"; chmod 700 "$STAGING_ROOT" "$STAGING_HOME" 2>/dev/null || true
REAL_AGY_DIR="$HOME/.gemini/antigravity-cli"
for f in installation_id settings.json; do qualify_stage_identity "$STAGING_AGY_DIR/$f" "$REAL_AGY_DIR/$f"; done
qualify_stage_credential "$STAGING_AGY_DIR/antigravity-oauth-token" "$REAL_AGY_DIR/antigravity-oauth-token" execute
[ -f "$STAGING_AGY_DIR/antigravity-oauth-token" ] || { say "no oauth token staged"; echo "rc=2" >> "$LOG"; exit 2; }

node "$HERE/argon-derive.js" "$EFFORT" "$REPO" > /dev/null || { say "fingerprint derivation failed"; echo "rc=2" >> "$LOG"; exit 2; }
idv() { node -e "console.log(require('$HERE/identity/$1-argon-$EFFORT.json')['$2'])"; }

extra=(); emit=1
case "$ROLE" in
  reviewer)            mode=reviewer; tc=code_review;;
  brain)               mode=brain; tc=brain-seat; emit=0;;
  verification_author) mode=va; tc=verification_authoring;;
  consult)             mode=consult; tc=consult; extra=(--execute);;
  discuss)             mode=discuss; tc=discuss; extra=(--execute);;
  *) say "unsupported role $ROLE"; echo "rc=2" >> "$LOG"; exit 2;;
esac
[ "$emit" = 1 ] && extra+=(--emit-row)
case "$ROLE" in consult|discuss) tmo=21600;; reviewer) tmo=18000;; *) tmo=10800;; esac

say "role=$ROLE effort=$EFFORT START model=$MODEL"
( export QRP_TIMEOUT_MS=570000 QRP_TRANSPORT=cli QRP_CLI_KIND=agy QRP_PROMPT_MODE="$mode" \
    QRP_MODEL="$MODEL" QRP_PROVIDER=agy-gemini QRP_CLI_HOME="$STAGING_HOME"
  timeout "$tmo" bash "$REPO/scripts/engine-qualify.sh" "$ROLE" \
    --engine "$MODEL" --model "$MODEL" --model-version "$MODEL" \
    --runner agy --runner-version "$(idv "$ROLE" runner_version)" --family google \
    --harness-version "$(idv "$ROLE" harness_version)" --effort "$EFFORT" \
    --prompt-config-hash "$(idv "$ROLE" prompt_config_hash)" \
    --semantic-fingerprint "$(idv "$ROLE" semantic_fingerprint)" \
    --containment-fingerprint "$(idv "$ROLE" containment_fingerprint)" \
    --remote-provider-cmd "node $REPO/scripts/qualification-review-provider.js" --remote-provider agy-gemini \
    --remote-timeout-ms 600000 \
    --provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE \
    --provider-env QRP_TRANSPORT --provider-env QRP_CLI_KIND --provider-env QRP_CLI_HOME --provider-env QRP_TIMEOUT_MS \
    --task-class "$tc" --domain cross-cutting --language en --tool read_only \
    --version-source operator-asserted \
    --raw-dir "$D/raw" "${extra[@]}" > "$D/stdout.json" 2> "$D/stderr.log" )
rc=$?
[ "$emit" = 1 ] && cp "$D/stdout.json" "$D/emit-row.json"
echo "$rc" > "$D/rc"
say "role=$ROLE effort=$EFFORT END rc=$rc (0=pass 1=fail-verdict 2=usage/precondition 124=wall timeout)"
echo "rc=$rc" >> "$LOG"
