#!/usr/bin/env bash
# codex model_unsupported: (1) error lists the cache's model ids, (2) a same-tier model from the
# cache is retried once and recorded as model_substituted {from,to} in the manifest, (3) no
# same-tier model -> no retry, the run fails as before. Fake HOME + stub codex only.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID \
  AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH CODEX_HOME 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"
mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export HOME="$TEST_TMP/home"
mkdir -p "$HOME/.codex"

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email "t@t"
git -C "$SBX" config user.name "t"
git -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
CALLS="$TEST_TMP/calls.log"

last_json() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }

# Stub: fails with "model unavailable" for gpt-6.1-terra, succeeds (no edits) for any other model.
STUB="$TEST_TMP/codex"
cat > "$STUB" <<'EOS'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*) echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
cat >/dev/null
model=""; prev=""
for a in "$@"; do [ "$prev" = "--model" ] && model="$a"; prev="$a"; done
echo "$model" >> "$STUB_CALLS"
if [ "$model" = "gpt-6.1-terra" ]; then echo "ERROR: model unavailable: $model"; exit 1; fi
echo "done"; exit 0
EOS
chmod +x "$STUB"
export STUB_CALLS="$CALLS"

run_codex() {
  (cd "$SBX" && "$SCRIPT" --no-verify-tip --runner codex --pin-reason "test fixture" --model gpt-6.1-terra \
    --codex-bin "$STUB" --branch "$1" --prompt-file "$PROMPT" --context-window off 2>"$TEST_TMP/stderr.txt")
}

# A. cache offers a same-tier model (gpt-6.2-terra) and a different tier (gpt-6.1-luna)
printf '{"models":[{"slug":"gpt-6.1-terra"},{"slug":"gpt-6.1-luna"},{"slug":"gpt-6.2-terra"}]}\n' > "$HOME/.codex/models_cache.json"
: > "$CALLS"
OUT="$(run_codex feat/sub-a)"
JSON="$(last_json "$OUT")"
assert_eq "$(tr '\n' ' ' < "$CALLS")" "gpt-6.1-terra gpt-6.2-terra " "second call uses the same-tier substitute, exactly one retry"
grep -q 'retrying once with same-tier substitute gpt-6.2-terra' "$TEST_TMP/stderr.txt" || fail "one stderr line announces the substitution"
MAN="$(find "$HOME" "$TEST_TMP" -name '*.manifest.json' -newer "$PROMPT" 2>/dev/null | head -n 1)"
[ -n "$MAN" ] || fail "run manifest exists"
node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const s = m.model_substituted;
  if (!s || s.from !== "gpt-6.1-terra" || s.to !== "gpt-6.2-terra") { console.error(JSON.stringify(s)); process.exit(1); }
' "$MAN" || fail "manifest carries model_substituted {from,to}"

# B. only a different tier is offered: no substitution, one call, error lists the cache ids
printf '{"models":[{"slug":"gpt-6.1-terra"},{"slug":"gpt-6.1-luna"}]}\n' > "$HOME/.codex/models_cache.json"
: > "$CALLS"
OUT="$(run_codex feat/sub-b)"
JSON="$(last_json "$OUT")"
assert_eq "$(tr '\n' ' ' < "$CALLS")" "gpt-6.1-terra " "no same-tier model: no retry"
node -e '
  const o = JSON.parse(process.argv[1]);
  if (o.error_category !== "model_unsupported") { console.error(JSON.stringify(o)); process.exit(1); }
  const want = "codex model gpt-6.1-terra is not available for this account (models_cache: gpt-6.1-terra, gpt-6.1-luna)";
  if (o.error !== want) { console.error(JSON.stringify(o.error)); process.exit(1); }
' "$JSON" || fail "error lists only the cache model ids, no cross-tier substitution"
grep -q 'retrying' "$TEST_TMP/stderr.txt" && fail "no substitution line when no same-tier model"

# C. no cache at all
rm -f "$HOME/.codex/models_cache.json"
: > "$CALLS"
OUT="$(run_codex feat/sub-c)"
JSON="$(last_json "$OUT")"
assert_eq "$(tr '\n' ' ' < "$CALLS")" "gpt-6.1-terra " "missing cache: no retry"
node -e '
  const o = JSON.parse(process.argv[1]);
  if (!String(o.error).endsWith("(models_cache: unavailable)")) { console.error(JSON.stringify(o.error)); process.exit(1); }
' "$JSON" || fail "missing cache reports models_cache: unavailable"

finalize_test
