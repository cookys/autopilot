#!/usr/bin/env bash
# Four GPT-6 reviewer sittings at effort low, sequential.
# An honest fail still writes a row and the loop continues.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
G=docs/plans/evidence/2026-10-01-gpt6-low-sweep
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PROMPT_HASH=3cbe203c5958ec413269d63e2d5d1841336394d15f3c4a3ab4285ea3e73e3530
HARNESS=engine-qualify-a89579de
RUNNER=codex-cli-0.159.2
CON=93bf920ee1377cee7b8e5c27c3a59400f9b2d54f320d4a8d9a1addfd5b3341e3
# containment above is the grok surface. Recompute the codex one at start.
CON=$(node << 'EOF'
const crypto = require('crypto');
const { canonicalJson } = require('./src/engine/owner-kernel/canonical.js');
const surface = {
  kind: 'reviewer-containment-surface-v1',
  exam_transport: 'qualification-case-broker-networkless-bwrap',
  credential_isolation: 'codex-home-redirect-broker-env-allowlist',
  cli_posture: 'codex exec --sandbox read-only --skip-git-repo-check',
};
process.stdout.write(crypto.createHash('sha256').update(canonicalJson(surface)).digest('hex'));
EOF
)

sem_for() {
  node -e '
    const crypto = require("crypto");
    const { canonicalJson } = require("./src/engine/owner-kernel/canonical.js");
    const surface = {
      kind: "reviewer-semantic-surface-v1",
      model: process.argv[1],
      transport: "codex-cli-exec-read-only",
      reasoning_effort: "low",
      endpoint: "@none",
    };
    process.stdout.write(crypto.createHash("sha256").update(canonicalJson(surface)).digest("hex"));
  ' "$1"
}

fail=0
for MODEL in gpt-6.1-sol gpt-6-astra gpt-6-sol gpt-6-luna; do
  SEM=$(sem_for "$MODEL")
  D="$G/reviewer/$MODEL"
  mkdir -p "$D/raw"
  echo "=== reviewer $MODEL low start $(date -Is) sem=$SEM con=$CON ===" >> "$G/reviewer-progress.txt"
  QRP_TIMEOUT_MS=300000 \
  QRP_TRANSPORT=cli QRP_CLI_KIND=codex QRP_PROMPT_MODE=reviewer \
  QRP_MODEL="$MODEL" QRP_PROVIDER=codex-cli QRP_CLI_EFFORT=low \
  CODEX_HOME="$CODEX_HOME" \
  timeout 14400 bash scripts/engine-qualify.sh reviewer \
    --engine "$MODEL" --model "$MODEL" --model-version "$MODEL" \
    --runner codex --runner-version "$RUNNER" --family openai \
    --harness-version "$HARNESS" --effort low \
    --prompt-config-hash "$PROMPT_HASH" \
    --semantic-fingerprint "$SEM" \
    --containment-fingerprint "$CON" \
    --remote-provider-cmd "node $PWD/scripts/qualification-review-provider.js" \
    --remote-provider codex-cli \
    --remote-timeout-ms 360000 \
    --provider-env QRP_MODEL --provider-env QRP_PROVIDER \
    --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
    --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT \
    --provider-env CODEX_HOME --provider-env QRP_TIMEOUT_MS \
    --task-class code_review --domain cross-cutting --language en --tool read_only \
    --version-source operator-asserted \
    --raw-dir "$D/raw" --emit-row \
    > "$D/qualify-out.json" 2> "$D/qualify-err.log"
  qexit=$?
  echo "QUALIFY_EXIT=$qexit" >> "$D/qualify-err.log"
  if [ -s "$D/qualify-out.json" ] && node -e 'const r=require(process.argv[1]); if(!r.status||r.status==="transport_fail") process.exit(1)' "$D/qualify-out.json"; then
    node scripts/engine-scorecard.js record --file "$D/qualify-out.json" \
      > "$D/record-out.json" 2> "$D/record-err.log" || true
    echo "=== reviewer $MODEL low row exit=$qexit $(date -Is) ===" >> "$G/reviewer-progress.txt"
  else
    fail=$((fail + 1))
    echo "=== reviewer $MODEL low NO-ROW exit=$qexit $(date -Is) ===" >> "$G/reviewer-progress.txt"
  fi
done
echo "=== reviewer sweep done fails=$fail $(date -Is) ===" >> "$G/reviewer-progress.txt"
exit "$fail"
