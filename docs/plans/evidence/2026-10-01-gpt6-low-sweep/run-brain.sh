#!/usr/bin/env bash
# Four GPT-6 depth-0 sittings at effort low, sequential.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
G=docs/plans/evidence/2026-10-01-gpt6-low-sweep
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
HARNESS=engine-qualify-a89579de
RUNNER=codex-cli-0.159.2

PROMPT_HASH=$(node << 'EOF'
const crypto = require('crypto');
const fs = require('fs');
const src = fs.readFileSync('scripts/qualification-review-provider.js', 'utf8');
const marker = 'const BRAIN_SYSTEM_PROMPT = `';
const at = src.indexOf(marker);
if (at < 0) process.exit(2);
let out = '';
let i = at + marker.length;
while (i < src.length) {
  const ch = src[i];
  if (ch === '\\') { out += ch + (src[i + 1] ?? ''); i += 2; continue; }
  if (ch === '`') break;
  out += ch;
  i += 1;
}
process.stdout.write(crypto.createHash('sha256').update(out).digest('hex'));
EOF
)

CON=$(node << 'EOF'
const crypto = require('crypto');
const { canonicalJson } = require('./src/engine/owner-kernel/canonical.js');
const surface = {
  kind: 'brain-seat-containment-surface-v2',
  exam_transport: 'qualification-case-broker-networkless-bwrap',
  cli_posture: 'codex exec --sandbox read-only --skip-git-repo-check',
  credential_isolation: 'codex-home-redirect-broker-env-allowlist',
};
process.stdout.write(crypto.createHash('sha256').update(canonicalJson(surface)).digest('hex'));
EOF
)

sem_for() {
  ROW_MODEL="$1" node << 'EOF'
const crypto = require('crypto');
const { canonicalJson } = require('./src/engine/owner-kernel/canonical.js');
const surface = {
  kind: 'brain-seat-semantic-surface-v1',
  model: process.env.ROW_MODEL,
  transport: 'codex-cli-exec-read-only',
  reasoning_effort: 'low',
  setting_sources: 'none',
};
process.stdout.write(crypto.createHash('sha256').update(canonicalJson(surface)).digest('hex'));
EOF
}

row_ok() {
  ROW="$1" node << 'EOF'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.env.ROW, 'utf8'));
process.exit(!r.status || r.status === 'transport_fail' ? 1 : 0);
EOF
}

missing=0
for MODEL in gpt-6.1-sol gpt-6-astra gpt-6-sol gpt-6-luna; do
  SEM=$(sem_for "$MODEL")
  D="$G/brain/$MODEL"
  mkdir -p "$D/raw"
  echo "=== brain $MODEL low start $(date -Is) prompt=$PROMPT_HASH sem=$SEM con=$CON ===" >> "$G/brain-progress.txt"
  QRP_TIMEOUT_MS=570000 \
  QRP_TRANSPORT=cli QRP_CLI_KIND=codex QRP_PROMPT_MODE=brain \
  QRP_MODEL="$MODEL" QRP_PROVIDER=codex-cli QRP_CLI_EFFORT=low \
  CODEX_HOME="$CODEX_HOME" \
  timeout 10800 bash scripts/engine-qualify.sh brain \
    --engine "$MODEL" --model "$MODEL" --model-version "$MODEL" \
    --runner codex --runner-version "$RUNNER" --family openai \
    --harness-version "$HARNESS" --effort low \
    --prompt-config-hash "$PROMPT_HASH" \
    --semantic-fingerprint "$SEM" \
    --containment-fingerprint "$CON" \
    --remote-provider-cmd "node $PWD/scripts/qualification-review-provider.js" \
    --remote-provider codex-cli \
    --remote-timeout-ms 600000 \
    --provider-env QRP_MODEL --provider-env QRP_PROVIDER \
    --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
    --provider-env QRP_CLI_KIND --provider-env QRP_CLI_EFFORT \
    --provider-env CODEX_HOME --provider-env QRP_TIMEOUT_MS \
    --task-class brain-seat --domain cross-cutting --language en --tool read_only \
    --version-source operator-asserted \
    --raw-dir "$D/raw" --emit-row \
    > "$D/qualify-out.json" 2> "$D/qualify-err.log"
  qexit=$?
  echo "QUALIFY_EXIT=$qexit" >> "$D/qualify-err.log"
  if row_ok "$D/qualify-out.json"; then
    node scripts/engine-scorecard.js record --file "$D/qualify-out.json" \
      > "$D/record-out.json" 2> "$D/record-err.log" || true
    echo "=== brain $MODEL low row exit=$qexit $(date -Is) ===" >> "$G/brain-progress.txt"
  else
    missing=$((missing + 1))
    echo "=== brain $MODEL low NO-ROW exit=$qexit $(date -Is) ===" >> "$G/brain-progress.txt"
  fi
done
echo "=== brain sweep done missing=$missing $(date -Is) ===" >> "$G/brain-progress.txt"
exit "$missing"
