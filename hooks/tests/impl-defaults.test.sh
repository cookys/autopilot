#!/usr/bin/env bash
# impl-defaults.test.sh — dispatch-hetero.sh implementer defaults go cheap (Fleet task 01M7S1X1TD391XTGJ2Q6SEJN6S).
#   unpinned (no --runner/--model)  -> grok-4.7 @ low        (official:implementer:grok-4.7:grok:194)
#   --runner codex                  -> gpt-6.1-terra @ low     (scorecard event 38)
#   --runner opencode              -> opencode-go/beam-free, no variant (official:implementer:opencode-go/beam-free:opencode:339)
#   --runner agy                   -> gemini-4-hydrogen-low @ low (official scorecard event 37)
# An explicit --model / --effort always wins. Stub binaries only: never a real CLI.
. "$(dirname "$0")/lib.sh"

TEST_NAME="impl-defaults"
scrub_session_env
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

# IMPL_DEFAULTS_HETERO lets a red run point the suite at a pre-change copy of the script.
HETERO="${IMPL_DEFAULTS_HETERO:-$REPO_ROOT/scripts/dispatch-hetero.sh}"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
$GIT -C "$SBX" init -q
$GIT -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'Update impl-defaults-fixture.txt.\n' > "$PROMPT"

# --- stubs: each records argv and leaves an edit for the wrapper commit ---
STUB_GROK="$TEST_TMP/grok"
export GROK_ARGV="$TEST_TMP/grok.argv"
cat > "$STUB_GROK" <<'EOF'
#!/usr/bin/env bash
case " $* " in
  *" __autopilot_probe__ "*)
    echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: xhigh, high, medium, low" >&2
    exit 2 ;;
esac
if [ "${1:-}" = "--version" ]; then echo "grok-cli 0.2.111 (test stub)"; exit 0; fi
printf '%s\n' "$@" > "$GROK_ARGV"
printf 'grok fixture\n' >> impl-defaults-fixture.txt
EOF
chmod +x "$STUB_GROK"

STUB_CODEX="$TEST_TMP/codex"
export CODEX_ARGV="$TEST_TMP/codex.argv"
cat > "$STUB_CODEX" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
printf '%s\n' "$@" > "$CODEX_ARGV"
printf 'codex fixture\n' >> impl-defaults-fixture.txt
EOF
chmod +x "$STUB_CODEX"

STUB_OC="$TEST_TMP/opencode"
export OC_ARGV="$TEST_TMP/opencode.argv"
cat > "$STUB_OC" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo 1.19.2; exit 0; fi
printf '%s\n' "\$@" > "$OC_ARGV"
cat >/dev/null
printf 'opencode fixture\n' >> impl-defaults-fixture.txt
EOF
chmod +x "$STUB_OC"

AGY_FIXTURE_HELPER="$TEST_TMP/emit-agy-envelope"
cat > "$AGY_FIXTURE_HELPER" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({conversation_id:"fixture",duration_seconds:1,num_turns:1,response:"self-report: DONE",status:"SUCCESS",usage:{input_tokens:1,output_tokens:1,total_tokens:2}}))'
EOF
chmod +x "$AGY_FIXTURE_HELPER"
export AGY_FIXTURE_HELPER
STUB_AGY="$TEST_TMP/agy"
export AGY_SPAWN="$TEST_TMP/agy.spawned"
cat > "$STUB_AGY" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "$AGY_SPAWN"
printf 'agy fixture\n' >> impl-defaults-fixture.txt
"$AGY_FIXTURE_HELPER"
EOF
chmod +x "$STUB_AGY"
make_agy_stub_versioned "$STUB_AGY"

argv_flag_val() { awk -v flag="$2" 'prev == flag { print $0; exit } { prev = $0 }' "$1"; }
json_last_get() {
  node -e '
    const lines = String(process.argv[1] || "").split(/\r?\n/).reverse();
    const raw = lines.find((l) => l.trim().startsWith("{"));
    if (!raw) { process.stdout.write("<no-json>"); process.exit(0); }
    const o = JSON.parse(raw); const k = process.argv[2];
    if (!(k in o)) process.stdout.write("<absent>"); else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));
  ' "$1" "$2"
}
file_json_get() {
  node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const k = process.argv[2];
    if (!(k in o)) process.stdout.write("<absent>"); else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));
  ' "$1" "$2"
}
# run_case <tag> <extra args...>: sets OUT / EXIT / MF (manifest path) for a dispatch in a fresh runs dir.
run_case() {
  local tag="$1"; shift
  RUNS="$TEST_TMP/runs-$tag"; mkdir -p "$RUNS"
  OUT="$(cd "$SBX" && AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" "$HETERO" --no-verify-tip \
    --branch "feat/impl-$tag" --prompt-file "$PROMPT" "$@" --timeout 30s </dev/null 2>&1)"; EXIT=$?
  MF="$(find "$RUNS" -name '*.manifest.json' | head -1)"
}
assert_recorded() { # <tag> <model> <effort>: result JSON and manifest carry what was sent
  assert_eq "$2" "$(json_last_get "$OUT" model)" "$1: result JSON model is $2"
  assert_eq "$3" "$(json_last_get "$OUT" effort)" "$1: result JSON effort is $3"
  assert_file_exists "$MF" "$1: run manifest written"
  assert_eq "$2" "$(file_json_get "$MF" model)" "$1: manifest model is $2"
  assert_eq "$3" "$(file_json_get "$MF" effort)" "$1: manifest effort is $3"
}

# Case 1: no --runner / --model / --effort -> grok-4.7 @ low, never an expensive model.
: > "$GROK_ARGV"; : > "$AGY_SPAWN"
run_case unpinned --grok-bin "$STUB_GROK" --agy-bin "$STUB_AGY" --codex-bin "$STUB_CODEX"
assert_eq "0" "$EXIT" "unpinned: exits 0 ($OUT)"
assert_eq "grok-4.7" "$(argv_flag_val "$GROK_ARGV" --model)" "unpinned: argv carries --model grok-4.7"
assert_eq "low" "$(argv_flag_val "$GROK_ARGV" --reasoning-effort)" "unpinned: argv carries --reasoning-effort low"
assert_eq "0" "$(grep -ciE 'carbon|argon|astra|fable' "$GROK_ARGV")" "unpinned: argv never names carbon|argon|astra|fable"
assert_eq "0" "$(wc -c < "$AGY_SPAWN" | tr -d ' ')" "unpinned: agy is not spawned"
assert_eq "grok" "$(json_last_get "$OUT" runner)" "unpinned: runner is grok"
assert_recorded unpinned grok-4.7 low

# Case 2: --runner codex, no model/effort -> gpt-6.1-terra @ low; explicit --effort high still high.
: > "$CODEX_ARGV"
run_case codex --runner codex --codex-bin "$STUB_CODEX"
assert_eq "0" "$EXIT" "codex default: exits 0 ($OUT)"
assert_eq "gpt-6.1-terra" "$(argv_flag_val "$CODEX_ARGV" --model)" "codex default: argv carries --model gpt-6.1-terra"
assert_contains "$(cat "$CODEX_ARGV")" 'model_reasoning_effort="low"' "codex default: argv sends effort low"
assert_eq "0" "$(grep -ciE 'carbon|argon|astra|fable' "$CODEX_ARGV")" "codex default: argv never names an expensive model"
assert_recorded "codex default" gpt-6.1-terra low
: > "$CODEX_ARGV"
run_case codex-high --runner codex --effort high --codex-bin "$STUB_CODEX"
assert_eq "0" "$EXIT" "codex explicit effort: exits 0 ($OUT)"
assert_contains "$(cat "$CODEX_ARGV")" 'model_reasoning_effort="high"' "codex explicit --effort high still sends high"
assert_recorded "codex explicit effort" gpt-6.1-terra high

# Case 3: --runner opencode, no model/effort -> beam-free, no variant, never xhigh.
: > "$OC_ARGV"
run_case opencode --runner opencode --opencode-bin "$STUB_OC" --context-window off
assert_eq "0" "$EXIT" "opencode default: exits 0 ($OUT)"
assert_eq "1" "$(grep -c -x -e opencode-go/beam-free "$OC_ARGV")" "opencode default: argv carries the model opencode-go/beam-free"
assert_eq "0" "$(grep -c -e '--variant' -e 'xhigh' "$OC_ARGV")" "opencode default: no --variant and no xhigh in argv"
assert_recorded "opencode default" opencode-go/beam-free default

# Case 4: --runner agy without --model -> gemini-4-hydrogen-low @ low (never carbon); explicit carbon still passes through.
: > "$AGY_SPAWN"
run_case agy-default --runner agy --agy-bin "$STUB_AGY"
assert_eq "0" "$EXIT" "agy default: exits 0 ($OUT)"
assert_eq "1" "$(grep -c -x -e gemini-4-hydrogen-low "$AGY_SPAWN")" "agy default: argv carries gemini-4-hydrogen-low"
assert_eq "0" "$(grep -ciE 'carbon|argon|astra|fable' "$AGY_SPAWN")" "agy default: argv never names carbon|argon|astra|fable"
assert_recorded "agy default" gemini-4-hydrogen-low low
: > "$AGY_SPAWN"
run_case agy-carbon --runner agy --model gemini-4-carbon-low --agy-bin "$STUB_AGY"
assert_eq "0" "$EXIT" "agy explicit carbon: exits 0 ($OUT)"
assert_eq "1" "$(grep -c -x -e gemini-4-carbon-low "$AGY_SPAWN")" "agy explicit --model gemini-4-carbon-low passes through"
assert_recorded "agy explicit carbon" gemini-4-carbon-low xhigh

# Case 5: explicit grok model + effort pass through unchanged.
: > "$GROK_ARGV"
run_case grok-explicit --runner grok --model grok-4.6 --effort high --grok-bin "$STUB_GROK"
assert_eq "0" "$EXIT" "grok explicit: exits 0 ($OUT)"
assert_eq "grok-4.6" "$(argv_flag_val "$GROK_ARGV" --model)" "grok explicit: --model passes through"
assert_eq "high" "$(argv_flag_val "$GROK_ARGV" --reasoning-effort)" "grok explicit: --effort passes through"
assert_recorded "grok explicit" grok-4.6 high

# Negative controls: disabling a default must turn its case red (refusal instead of the cheap default).
PRE="$TEST_TMP/pre-codex"
make_pre_tree "$PRE"
rm -f "$PRE/scripts/dispatch-hetero.sh"
sed_mutant "$HETERO" "$PRE/scripts/dispatch-hetero.sh" \
  's/\[ "${IS_CODEX:-0}" -eq 1 \] && \[ "$MODEL_IS_DEFAULT" -eq 1 \]/[ "${IS_CODEX:-0}" -eq 99 ] \&\& [ "$MODEL_IS_DEFAULT" -eq 1 ]/'
chmod +x "$PRE/scripts/dispatch-hetero.sh"
RED_OUT="$(cd "$SBX" && "$PRE/scripts/dispatch-hetero.sh" --no-verify-tip --branch feat/impl-red-codex \
  --prompt-file "$PROMPT" --runner codex --codex-bin "$STUB_CODEX" --timeout 30s </dev/null 2>&1)"; RED_EXIT=$?
assert_eq "2" "$RED_EXIT" "negative control: without the codex model default --runner codex is refused"
assert_contains "$RED_OUT" "--model is required for runner 'codex'" "negative control: refusal names codex"

PRE2="$TEST_TMP/pre-auto"
make_pre_tree "$PRE2"
rm -f "$PRE2/scripts/dispatch-hetero.sh"
sed_mutant "$HETERO" "$PRE2/scripts/dispatch-hetero.sh" \
  '0,/      elif \[ "$MODEL_IS_DEFAULT" -eq 1 \]; then/s//      elif [ "$MODEL_IS_DEFAULT" -eq 99 ]; then/'
chmod +x "$PRE2/scripts/dispatch-hetero.sh"
RED_OUT2="$(cd "$SBX" && "$PRE2/scripts/dispatch-hetero.sh" --no-verify-tip --branch feat/impl-red-auto \
  --prompt-file "$PROMPT" --agy-bin "$STUB_AGY" --grok-bin "$STUB_GROK" --timeout 30s </dev/null 2>&1)"; RED_EXIT2=$?
assert_eq "agy" "$(json_last_get "$RED_OUT2" runner)" "negative control: without the unpinned grok route an unpinned call lands on agy"

finalize_test
