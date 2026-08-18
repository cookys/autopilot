#!/usr/bin/env bash
# hooks/tests/skill-onoff-eval.test.sh — skill-onoff harness mechanics (spend-free, stub runner)
#
# Asserts (plan §9 test list, G1-F9/G1-F8 folds included):
#   1. arm plugin assembly: FULL/CARD carry the digest-pinned dev-flow pack (incl. the card's
#      references tree); OFF has no skills/dev-flow; companions byte-identical across arms
#   2. prompt byte-identity across arms for the same task
#   3. scratch isolation: HOME and CLAUDE_CONFIG_DIR are exported scratch paths, never the real ones
#   4. per-task branch topology: d4 builds main-default + develop; d3 develop-default + main
#   5. result.json schema + infra_fail classification (stub exit 124 → runner_timeout)
#   6. pack digest mismatch is a hard harness error (exit 2)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
TEST_TMP=$(mktemp -d -t "skill-onoff-eval-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# ── stub runner: probes its environment into the transcript as JSON lines ──
STUB="$TEST_TMP/stub.sh"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
set -eu
emit() { printf '%s\n' "$1"; }
sha() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
emit "{\"probe\":\"env\",\"home\":\"$HOME\",\"config\":\"${CLAUDE_CONFIG_DIR:-unset}\"}"
if [ -f "$ONOFF_PLUGIN_DIR/skills/dev-flow/SKILL.md" ]; then
  emit "{\"probe\":\"devflow\",\"sha\":\"$(sha "$ONOFF_PLUGIN_DIR/skills/dev-flow/SKILL.md")\"}"
else
  emit "{\"probe\":\"devflow\",\"sha\":\"absent\"}"
fi
if [ -f "$ONOFF_PLUGIN_DIR/skills/dev-flow/references/session-end.md" ]; then
  emit "{\"probe\":\"card_refs\",\"present\":true}"
fi
for c in finish-flow quality-pipeline learn; do
  emit "{\"probe\":\"companion\",\"name\":\"$c\",\"sha\":\"$(sha "$ONOFF_PLUGIN_DIR/skills/$c/SKILL.md")\"}"
done
emit "{\"probe\":\"branches\",\"current\":\"$(git branch --show-current)\",\"all\":\"$(git branch --format='%(refname:short)' | sort | paste -sd, -)\"}"
STUBEOF
chmod +x "$STUB"
export ONOFF_STUB_BIN="$STUB"

run_arm() { # $1 task $2 arm → out dir echoed
  local out="$TEST_TMP/$1-$2"
  bash "$BASE/run-skill-onoff-eval.sh" --task "$1" --arm "$2" --model stub-model \
    --runner stub --out "$out" >/dev/null
  echo "$out"
}

echo "=== 1+2+3: arm assembly, prompt identity, isolation (d4, all arms) ==="
OUT_FULL=$(run_arm d4-hotfix full)
OUT_CARD=$(run_arm d4-hotfix card)
OUT_OFF=$(run_arm d4-hotfix off)

cmp -s "$OUT_FULL/prompt.md" "$OUT_CARD/prompt.md" || fail "prompt differs full vs card"
cmp -s "$OUT_FULL/prompt.md" "$OUT_OFF/prompt.md" || fail "prompt differs full vs off"

man_digest() { # $1 pack $2 rel-in-pack
  node -e 'const m=require(process.argv[1]);process.stdout.write(m.packs[process.argv[2]][process.argv[3]])' \
    "$BASE/packs/manifest.json" "$1" "$2"
}
grep -q "\"sha\":\"$(man_digest dev-flow-full dev-flow-full/SKILL.md)\"" "$OUT_FULL/transcript.jsonl" \
  || fail "FULL arm dev-flow digest != manifest"
grep -q "\"sha\":\"$(man_digest dev-flow-card dev-flow-card/SKILL.md)\"" "$OUT_CARD/transcript.jsonl" \
  || fail "CARD arm dev-flow digest != manifest"
grep -q '"probe":"card_refs","present":true' "$OUT_CARD/transcript.jsonl" \
  || fail "CARD arm missing its references tree (content-ablation, G1-F9)"
grep -q '"sha":"absent"' "$OUT_OFF/transcript.jsonl" || fail "OFF arm still carries dev-flow"

for c in finish-flow quality-pipeline learn; do
  sf=$(grep -o "\"name\":\"$c\",\"sha\":\"[0-9a-f]*\"" "$OUT_FULL/transcript.jsonl")
  sc=$(grep -o "\"name\":\"$c\",\"sha\":\"[0-9a-f]*\"" "$OUT_CARD/transcript.jsonl")
  so=$(grep -o "\"name\":\"$c\",\"sha\":\"[0-9a-f]*\"" "$OUT_OFF/transcript.jsonl")
  { [ -n "$sf" ] && [ "$sf" = "$sc" ] && [ "$sf" = "$so" ]; } \
    || fail "companion $c not byte-identical across arms"
done

env_home=$(grep -o '"home":"[^"]*"' "$OUT_FULL/transcript.jsonl" | cut -d'"' -f4)
env_cfg=$(grep -o '"config":"[^"]*"' "$OUT_FULL/transcript.jsonl" | cut -d'"' -f4)
[ "$env_cfg" != "unset" ] || fail "CLAUDE_CONFIG_DIR not exported to stub env (G1-F9 leak)"
case "$env_cfg" in "$HOME/.claude"*) fail "CLAUDE_CONFIG_DIR points at real ~/.claude" ;; esac
# NOTE: stub runner intentionally does NOT rewrite HOME (only cc does); assert the cc
# contract at the flag level instead: the runner script must export both for cc runs.
grep -q 'export HOME="\$SCRATCH_HOME"' "$BASE/run-skill-onoff-eval.sh" \
  || fail "runner no longer exports scratch HOME for cc runs"
grep -q 'export CLAUDE_CONFIG_DIR="\$SCRATCH_CONFIG"' "$BASE/run-skill-onoff-eval.sh" \
  || fail "runner no longer exports scratch CLAUDE_CONFIG_DIR for cc runs"

echo "=== 4: per-task branch topology ==="
grep -q '"current":"main"' "$OUT_FULL/transcript.jsonl" || fail "d4 default branch is not main"
grep -q '"all":"develop,main"' "$OUT_FULL/transcript.jsonl" || fail "d4 missing develop branch"
OUT_D3=$(run_arm d3-fix-known-bug off)
grep -q '"current":"develop"' "$OUT_D3/transcript.jsonl" || fail "d3 default branch is not develop"
grep -q '"all":"develop,main"' "$OUT_D3/transcript.jsonl" || fail "d3 missing main branch"

echo "=== 5: result schema + infra classification ==="
node -e '
  const r=require(process.argv[1]);
  for (const k of ["task_id","arm","model","runner","rep","duration_s","frozen_base_sha","markers","skill_invoked_devflow","failure_class","failure_cause"])
    if (!(k in r)) { console.error("missing field: "+k); process.exit(1); }
' "$OUT_FULL/result.json" || fail "result.json schema"
TIMEOUT_STUB="$TEST_TMP/stub-timeout.sh"
printf '#!/usr/bin/env bash\nexit 124\n' > "$TIMEOUT_STUB"; chmod +x "$TIMEOUT_STUB"
OUT_TO="$TEST_TMP/timeout-run"
ONOFF_STUB_BIN="$TIMEOUT_STUB" bash "$BASE/run-skill-onoff-eval.sh" --task d1-s-tiny-feature \
  --arm off --model stub-model --runner stub --out "$OUT_TO" >/dev/null
grep -q '"failure_class":"infra_fail","failure_cause":"runner_timeout"' "$OUT_TO/result.json" \
  || fail "exit-124 not classified runner_timeout"

echo "=== 6: digest mismatch is fatal ==="
mkdir -p "$TEST_TMP/copy/evals"
cp -r "$BASE" "$TEST_TMP/copy/evals/skill-onoff"
echo "tamper" >> "$TEST_TMP/copy/evals/skill-onoff/packs/dev-flow-card/SKILL.md"
set +e
ONOFF_STUB_BIN="$STUB" bash "$TEST_TMP/copy/evals/skill-onoff/run-skill-onoff-eval.sh" \
  --task d1-s-tiny-feature --arm card --model stub-model --runner stub \
  --out "$TEST_TMP/tampered" >/dev/null 2>&1
rc=$?
set -e
[ "$rc" -eq 2 ] || fail "tampered card pack did not exit 2 (got $rc)"

echo "PASS: skill-onoff-eval harness mechanics"
