#!/usr/bin/env bash
# cell-cli-rv6.sh <codex|grok> <model> <effort>  -- one reviewer v6 sitting (reviewer-metamorphic-v6) on a codex/grok CLI seat.
# Effort is sent for real via QRP_CLI_EFFORT (codex -c model_reasoning_effort=, grok --reasoning-effort after the clamp).
# Fingerprints derived as in 2026-10-01-gpt6-low-sweep/run-reviewer.sh and 2026-10-01-grok-4.7-low-seats/fingerprint-reviewer.json,
# with the current harness hash and runner token. Output: out/rv6-<model>-<effort>/ (qualify-out.json = emit-row). rc 0 pass, 1 fail.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
KIND="${1:?codex|grok}"; MODEL="${2:?model}"; EFFORT="${3:?effort}"
D="$HERE/out/rv6-$MODEL-$EFFORT"; mkdir -p "$D/raw"; cd "$REPO" || exit 2
export REPO KIND MODEL EFFORT
FP=$(node -e '
const crypto=require("crypto"),fs=require("fs"),path=require("path");
const {canonicalJson}=require(path.join(process.env.REPO,"src/engine/owner-kernel/canonical.js"));
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const j=o=>sha(canonicalJson(o));
const kind=process.env.KIND, model=process.env.MODEL, effort=process.env.EFFORT;
const src=fs.readFileSync(path.join(process.env.REPO,"scripts/qualification-review-provider.js"),"utf8");
const harness="engine-qualify-"+sha(fs.readFileSync(path.join(process.env.REPO,"scripts/engine-qualify.js"))).slice(0,8);
const prompt="3cbe203c5958ec413269d63e2d5d1841336394d15f3c4a3ab4285ea3e73e3530";
let sem,con,runner,rv,family;
if(kind==="codex"){
  runner="codex";rv="codex-cli-0.162.1";family="openai";
  sem={kind:"reviewer-semantic-surface-v1",model,transport:"codex-cli-exec-read-only",reasoning_effort:effort,endpoint:"@none"};
  con={kind:"reviewer-containment-surface-v1",exam_transport:"qualification-case-broker-networkless-bwrap",credential_isolation:"codex-home-redirect-broker-env-allowlist",cli_posture:"codex exec --sandbox read-only --skip-git-repo-check"};
}else{
  runner="grok";rv="grok-1.0.52-0920c8169e27-stable";family="xai";
  sem={kind:"reviewer-semantic-surface-v1",model,transport:"grok-cli-prompt-file",reasoning_effort:effort,endpoint:"@none"};
  con={kind:"reviewer-containment-surface-v1",exam_transport:"qualification-case-broker-networkless-bwrap",cli_posture:"grok --prompt-file --permission-mode dontAsk --no-subagents --deny *",credential_isolation:"qrp-cli-home-credential-only-seed"};
}
console.log([prompt,j(sem),j(con),harness,runner,rv,family].join(" "));
')
read -r PROMPT_HASH SEM CON HARNESS RUNNER RV FAMILY <<< "$FP"
echo "fp prompt=${PROMPT_HASH:0:8} sem=${SEM:0:8} con=${CON:0:8} harness=$HARNESS runner=$RUNNER/$RV" > "$D/fingerprint.log"
if [ "${DRY_RUN:-0}" = 1 ]; then cat "$D/fingerprint.log"; exit 0; fi
if [ "$KIND" = codex ]; then
  SCR="${XDG_RUNTIME_DIR:-/dev/shm}/rv6-codex-home-$MODEL-$EFFORT"; rm -rf "$SCR"; mkdir -p "$SCR"; cp "$HOME/.codex/auth.json" "$SCR/auth.json"; chmod 600 "$SCR/auth.json"
  HOMEENV=(CODEX_HOME="$SCR"); HOMEVAR=CODEX_HOME
else
  HOMEENV=(QRP_CLI_HOME="$HOME/.autopilot/exam-grok-home"); HOMEVAR=QRP_CLI_HOME
fi
env "${HOMEENV[@]}" QRP_TIMEOUT_MS=300000 QRP_TRANSPORT=cli QRP_CLI_KIND="$KIND" QRP_PROMPT_MODE=reviewer \
  QRP_MODEL="$MODEL" QRP_PROVIDER="$KIND-cli" QRP_CLI_EFFORT="$EFFORT" \
  timeout 14400 bash scripts/engine-qualify.sh reviewer \
  --engine "$MODEL" --model "$MODEL" --model-version "$MODEL" \
  --runner "$RUNNER" --runner-version "$RV" --family "$FAMILY" \
  --harness-version "$HARNESS" --effort "$EFFORT" \
  --prompt-config-hash "$PROMPT_HASH" --semantic-fingerprint "$SEM" --containment-fingerprint "$CON" \
  --remote-provider-cmd "node $REPO/scripts/qualification-review-provider.js" --remote-provider "$KIND-cli" \
  --remote-timeout-ms 360000 \
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
  --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT --provider-env "$HOMEVAR" --provider-env QRP_TIMEOUT_MS \
  --task-class code_review --domain cross-cutting --language en --tool read_only \
  --version-source operator-asserted --raw-dir "$D/raw" --emit-row \
  > "$D/stdout.json" 2> "$D/stderr.log"
rc=$?
cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null
exit "$rc"
