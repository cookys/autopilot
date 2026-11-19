#!/usr/bin/env bash
# grok-effort.test.sh — wires scripts/test-grok-effort.sh into the L2 suite.
#
# scripts/test-grok-effort.sh existed since 2026-08-19 but is named `test-*.sh`, while
# hooks/tests/run.sh only collects `hooks/tests/*.test.sh` + `scripts/*.test.sh` — so it had
# zero executions in CI. Its live-probe section only asked the CLI's DEFAULT model, and the
# per-model enum bug (grok-4.5 rejects xhigh; 4.6+ accept) shipped under it (2026-09-23).
. "$(dirname "$0")/lib.sh"

install_cli_sentinels
TEST_NAME="grok-effort"
OUT="$(bash "$REPO_ROOT/scripts/test-grok-effort.sh" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "scripts/test-grok-effort.sh passes"
assert_contains "$OUT" "test-grok-effort: PASS" "scripts/test-grok-effort.sh reached its PASS line"

# --- dispatch-hetero.sh grok implementer default (grok-4.7 at effort low) ---
# Qualified seat: official:implementer:grok-4.7:grok:194 (Fleet task 01M7S0RPFQJ217HXV3X11WXDVP).
# Hermetic stub grok binary only — never invokes the real grok CLI.
scrub_session_env
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
$GIT -C "$SBX" init -q
$GIT -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'Update grok-default-fixture.txt.\n' > "$PROMPT"

# Reuse the stub grok probe contract from scripts/test-grok-effort.sh + argv capture (never real grok).
STUB_GROK="$TEST_TMP/grok"
export GROK_ARGV="$TEST_TMP/grok.argv"
cat > "$STUB_GROK" <<'EOF'
#!/usr/bin/env bash
case " $* " in
  *" __autopilot_probe__ "*)
    echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: xhigh, high, medium, low" >&2
    exit 2
    ;;
esac
if [ "${1:-}" = "--version" ]; then
  echo "grok-cli 0.2.111 (test stub)"
  exit 0
fi
printf '%s\n' "$@" > "$GROK_ARGV"
printf 'grok fixture %s\n' "$$" >> grok-default-fixture.txt
EOF
chmod +x "$STUB_GROK"

argv_flag_val() {
  awk -v flag="$2" 'prev == flag { print $0; exit } { prev = $0 }' "$1"
}

json_last_get() {
  node -e '
    const lines = String(process.argv[1] || "").split(/\r?\n/).reverse();
    const raw = lines.find((l) => l.trim().startsWith("{"));
    if (!raw) { process.stdout.write("<no-json>"); process.exit(0); }
    const o = JSON.parse(raw);
    const k = process.argv[2];
    if (!(k in o)) process.stdout.write("<absent>");
    else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));
  ' "$1" "$2"
}

file_json_get() {
  node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const k = process.argv[2];
    if (!(k in o)) process.stdout.write("<absent>");
    else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));
  ' "$1" "$2"
}

# Negative control (red on unchanged script): without the grok model default, `--runner grok`
# with no --model/--effort exits 2 with "--model is required for runner 'grok'"; without the grok
# effort default, an unpinned grok call sends xhigh instead of low.
PRE_MODEL="$TEST_TMP/pre-model"
make_pre_tree "$PRE_MODEL"
rm -f "$PRE_MODEL/scripts/dispatch-hetero.sh"
sed_mutant "$HETERO" "$PRE_MODEL/scripts/dispatch-hetero.sh" \
  's/\[ "${IS_GROK:-0}" -eq 1 \] && \[ "$MODEL_IS_DEFAULT" -eq 1 \]/[ "${IS_GROK:-0}" -eq 99 ] \&\& [ "$MODEL_IS_DEFAULT" -eq 1 ]/'
chmod +x "$PRE_MODEL/scripts/dispatch-hetero.sh"
RED_OUT="$(cd "$SBX" && "$PRE_MODEL/scripts/dispatch-hetero.sh" --no-verify-tip \
  --branch feat/grok-red-nomodel --prompt-file "$PROMPT" --runner grok --grok-bin "$STUB_GROK" \
  --timeout 30s </dev/null 2>&1)"; RED_EXIT=$?
assert_eq "2" "$RED_EXIT" "negative control: unchanged script exits 2 on --runner grok without --model"
assert_contains "$RED_OUT" "--model is required for runner 'grok'" \
  "negative control: unchanged script refuses --runner grok without --model"

PRE_EFFORT="$TEST_TMP/pre-effort"
make_pre_tree "$PRE_EFFORT"
rm -f "$PRE_EFFORT/scripts/dispatch-hetero.sh"
sed_mutant "$HETERO" "$PRE_EFFORT/scripts/dispatch-hetero.sh" \
  's/\[ "${IS_GROK:-0}" -eq 1 \] && \[ "$EFFORT_EXPLICIT" -eq 0 \]/[ "${IS_GROK:-0}" -eq 99 ] \&\& [ "$EFFORT_EXPLICIT" -eq 0 ]/'
chmod +x "$PRE_EFFORT/scripts/dispatch-hetero.sh"
: > "$GROK_ARGV"
RED_EFF_OUT="$(cd "$SBX" && AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-red-eff" \
  "$PRE_EFFORT/scripts/dispatch-hetero.sh" --no-verify-tip \
  --branch feat/grok-red-effort --prompt-file "$PROMPT" --runner grok --grok-bin "$STUB_GROK" \
  --timeout 30s </dev/null 2>&1)"; RED_EFF_EXIT=$?
assert_eq "0" "$RED_EFF_EXIT" "negative control (effort): runs to completion ($RED_EFF_OUT)"
assert_eq "xhigh" "$(argv_flag_val "$GROK_ARGV" --reasoning-effort)" \
  "negative control (effort): without grok effort default, unpinned call sends xhigh"

# Case (a): `--runner grok` with no --model and no --effort defaults to grok-4.7 at effort low,
# and records final model + effort in both result JSON and run manifest.
: > "$GROK_ARGV"
RUNS_A="$TEST_TMP/runs-a"
mkdir -p "$RUNS_A"
OUT_A="$(cd "$SBX" && AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_A" "$HETERO" --no-verify-tip \
  --branch feat/grok-default-a --prompt-file "$PROMPT" --runner grok --grok-bin "$STUB_GROK" \
  --timeout 30s </dev/null 2>&1)"; EXIT_A=$?
assert_eq "0" "$EXIT_A" "case (a): --runner grok with no --model/--effort exits 0 ($OUT_A)"
assert_eq "grok-4.7" "$(argv_flag_val "$GROK_ARGV" --model)" \
  "case (a): stub argv carries --model grok-4.7"
assert_eq "low" "$(argv_flag_val "$GROK_ARGV" --reasoning-effort)" \
  "case (a): stub argv carries --reasoning-effort low"
assert_eq "committed" "$(json_last_get "$OUT_A" status)" "case (a): result JSON status is committed"
assert_eq "grok" "$(json_last_get "$OUT_A" runner)" "case (a): result JSON runner is grok"
assert_eq "grok-4.7" "$(json_last_get "$OUT_A" model)" "case (a): result JSON model is grok-4.7"
assert_eq "low" "$(json_last_get "$OUT_A" effort)" "case (a): result JSON effort is low"
MF_A="$(find "$RUNS_A" -name '*.manifest.json' | head -1)"
assert_file_exists "$MF_A" "case (a): run manifest written"
assert_eq "grok-4.7" "$(file_json_get "$MF_A" model)" "case (a): manifest model is grok-4.7"
assert_eq "low" "$(file_json_get "$MF_A" effort)" "case (a): manifest effort is low"
assert_eq "committed" "$(file_json_get "$MF_A" final_status)" "case (a): manifest final_status is committed"

# Case (b): explicit `--model grok-4.6 --effort high` overrides both defaults.
: > "$GROK_ARGV"
RUNS_B="$TEST_TMP/runs-b"
mkdir -p "$RUNS_B"
OUT_B="$(cd "$SBX" && AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_B" "$HETERO" --no-verify-tip \
  --branch feat/grok-explicit-b --prompt-file "$PROMPT" --runner grok \
  --model grok-4.6 --effort high --grok-bin "$STUB_GROK" \
  --timeout 30s </dev/null 2>&1)"; EXIT_B=$?
assert_eq "0" "$EXIT_B" "case (b): explicit --model grok-4.6 --effort high exits 0 ($OUT_B)"
assert_eq "grok-4.6" "$(argv_flag_val "$GROK_ARGV" --model)" \
  "case (b): stub argv passes through --model grok-4.6"
assert_eq "high" "$(argv_flag_val "$GROK_ARGV" --reasoning-effort)" \
  "case (b): stub argv passes through --reasoning-effort high"
assert_eq "grok-4.6" "$(json_last_get "$OUT_B" model)" "case (b): result JSON model is grok-4.6"
assert_eq "high" "$(json_last_get "$OUT_B" effort)" "case (b): result JSON effort is high"
MF_B="$(find "$RUNS_B" -name '*.manifest.json' | head -1)"
assert_file_exists "$MF_B" "case (b): run manifest written"
assert_eq "grok-4.6" "$(file_json_get "$MF_B" model)" "case (b): manifest model is grok-4.6"
assert_eq "high" "$(file_json_get "$MF_B" effort)" "case (b): manifest effort is high"

# Case (c): another non-agy runner without its own default (pi) without --model still exits 2
# with the "--model is required" precondition, and its precondition result JSON carries no effort key (nothing was sent).
OUT_C="$(cd "$SBX" && "$HETERO" --no-verify-tip \
  --branch feat/non-agy-nomodel-c --prompt-file "$PROMPT" --runner pi \
  --timeout 30s </dev/null 2>&1)"; EXIT_C=$?
assert_eq "2" "$EXIT_C" "case (c): non-agy runner without --model exits 2 ($OUT_C)"
assert_eq "precondition_failed" "$(json_last_get "$OUT_C" status)" \
  "case (c): non-agy runner without --model status is precondition_failed"
assert_contains "$OUT_C" "--model is required for runner 'pi'" \
  "case (c): precondition names the runner and states --model is required"
assert_eq "<absent>" "$(json_last_get "$OUT_C" effort)" \
  "case (c): refused dispatch result JSON omits effort (none sent)"

finalize_test
