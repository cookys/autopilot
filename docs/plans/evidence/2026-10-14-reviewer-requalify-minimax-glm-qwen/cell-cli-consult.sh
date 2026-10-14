#!/usr/bin/env bash
# cell-cli-consult.sh <model> <effort> -- one consult administration on a codex seat (QRP_PROMPT_MODE=consult, --execute).
# Fingerprint recipe = 2026-10-14-gemini-4-argon-qualify/derive-fingerprints.js (consult branch: corpus+generator prompt hash,
# semantic base from the corpus, model+effort folded in), with codex surface strings from cell-cli-rv6.sh.
# Effort sent for real via QRP_CLI_EFFORT. Output: out/consult-<model>-<effort>/ (stdout.json = emit-row). rc 0 pass, 1 fail.
# DRY_RUN=1 prints the fingerprints only.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
MODEL="${1:?model}"; EFFORT="${2:?effort}"
D="$HERE/out/consult-$MODEL-$EFFORT"; mkdir -p "$D/raw"; cd "$REPO" || exit 2
export REPO MODEL EFFORT
FP=$(node -e '
const crypto=require("crypto"),fs=require("fs"),path=require("path"),cp=require("child_process");
const {canonicalJson}=require(path.join(process.env.REPO,"src/engine/owner-kernel/canonical.js"));
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const R=process.env.REPO, model=process.env.MODEL, effort=process.env.EFFORT;
const harness="engine-qualify:"+sha(fs.readFileSync(path.join(R,"scripts/engine-qualify.js"))).slice(0,8);
const rv=JSON.parse(cp.execFileSync("node",[path.join(R,"scripts/lib/runner-binary.js"),"version","--runner","codex","--json"])).token;
const c=fs.readFileSync(path.join(R,"evals/consult-capability-evidence-corpus.json")), g=fs.readFileSync(path.join(R,"evals/consult-eval-generator.js")), j=JSON.parse(c);
const prompt=sha(Buffer.concat([c,g]));
const base=sha(Buffer.from(JSON.stringify({corpus_version:j.corpus_version,families:j.families,thresholds:j.thresholds,canary_closure:"negative_control_admission_failed:true"}),"utf8"));
const sem=sha(Buffer.from(JSON.stringify({r:"consult",base,model,effort})));
const con=sha(canonicalJson({kind:"consult-containment-surface-v1",exam_transport:"qualification-case-broker-networkless-bwrap",cli_posture:"codex exec --sandbox read-only --skip-git-repo-check",credential_isolation:"codex-home-redirect-broker-env-allowlist"}));
console.log([prompt,sem,con,harness,rv,j.corpus_version].join(" "));
')
read -r PROMPT_HASH SEM CON HARNESS RV CV <<< "$FP"
echo "fp prompt=${PROMPT_HASH:0:8} sem=${SEM:0:8} con=${CON:0:8} harness=$HARNESS runner=codex/$RV corpus=$CV" > "$D/fingerprint.log"
if [ "${DRY_RUN:-0}" = 1 ]; then cat "$D/fingerprint.log"; exit 0; fi
SCR="${XDG_RUNTIME_DIR:-/dev/shm}/consult-codex-home-$MODEL-$EFFORT"; rm -rf "$SCR"; mkdir -p "$SCR"
cp "$HOME/.codex/auth.json" "$SCR/auth.json"; chmod 600 "$SCR/auth.json"
env CODEX_HOME="$SCR" QRP_TIMEOUT_MS=570000 QRP_TRANSPORT=cli QRP_CLI_KIND=codex QRP_PROMPT_MODE=consult \
  QRP_MODEL="$MODEL" QRP_PROVIDER=codex-cli QRP_CLI_EFFORT="$EFFORT" \
  timeout 21600 bash scripts/engine-qualify.sh consult \
  --engine "$MODEL" --model "$MODEL" --model-version "$MODEL" \
  --runner codex --runner-version "$RV" --family openai \
  --harness-version "$HARNESS" --effort "$EFFORT" \
  --prompt-config-hash "$PROMPT_HASH" --semantic-fingerprint "$SEM" --containment-fingerprint "$CON" \
  --remote-provider-cmd "node $REPO/scripts/qualification-review-provider.js" --remote-provider codex-cli \
  --remote-timeout-ms 600000 \
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
  --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT --provider-env CODEX_HOME --provider-env QRP_TIMEOUT_MS \
  --task-class consult --domain cross-cutting --language en --tool read_only \
  --version-source operator-asserted --raw-dir "$D/raw" --execute --emit-row \
  > "$D/stdout.json" 2> "$D/stderr.log"
rc=$?
cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null
echo "$rc" > "$D/rc"
exit "$rc"
