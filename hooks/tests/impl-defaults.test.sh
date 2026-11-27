#!/usr/bin/env bash
# impl-defaults.test.sh — dispatch-hetero.sh implementer defaults go cheap (Fleet task 01M7S1X1TD391XTGJ2Q6SEJN6S).
#   no --runner (implementer)       -> local / qwen           (hooks/tests/dispatch-hetero-local-default.test.sh)
#   --runner grok, no --model       -> grok-4.7 @ low        (official:implementer:grok-4.7:grok:194)
#   --runner codex                  -> gpt-6.1-terra @ low     (scorecard event 38)
#   --runner opencode              -> opencode-go/beam-free, no variant (official:implementer:opencode-go/beam-free:opencode:339)
#   --runner agy                   -> gemini-4-hydrogen-low @ low (official scorecard event 37)
# An explicit --model / --effort always wins. Stub binaries only: never a real CLI.
. "$(dirname "$0")/lib.sh"

install_cli_sentinels
TEST_NAME="impl-defaults"
scrub_session_env
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export AUTOPILOT_GROK_PROBE=off
mkdir -p "$HOME/.codex"
printf '{}\n' > "$HOME/.codex/auth.json"
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

# Case 1: --runner grok, no model/effort -> grok-4.7 @ low. No --runner is local (see dispatch-hetero-local-default.test.sh).
: > "$GROK_ARGV"; : > "$AGY_SPAWN"
run_case unpinned --runner grok --grok-bin "$STUB_GROK" --agy-bin "$STUB_AGY" --codex-bin "$STUB_CODEX"
assert_eq "0" "$EXIT" "grok default: exits 0 ($OUT)"
assert_eq "grok-4.7" "$(argv_flag_val "$GROK_ARGV" --model)" "grok default: argv carries --model grok-4.7"
assert_eq "low" "$(argv_flag_val "$GROK_ARGV" --reasoning-effort)" "grok default: argv carries --reasoning-effort low"
assert_eq "0" "$(grep -ciE 'carbon|argon|astra|fable' "$GROK_ARGV")" "grok default: argv never names carbon|argon|astra|fable"
assert_eq "0" "$(wc -c < "$AGY_SPAWN" | tr -d ' ')" "grok default: agy is not spawned"
assert_eq "grok" "$(json_last_get "$OUT" runner)" "grok default: runner is grok"
assert_recorded "grok default" grok-4.7 low

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
assert_recorded "agy explicit carbon" gemini-4-carbon-low low

# Case 5: explicit grok model + effort pass through unchanged.
: > "$GROK_ARGV"
run_case grok-explicit --runner grok --model grok-4.6 --effort high --grok-bin "$STUB_GROK"
assert_eq "0" "$EXIT" "grok explicit: exits 0 ($OUT)"
assert_eq "grok-4.6" "$(argv_flag_val "$GROK_ARGV" --model)" "grok explicit: --model passes through"
assert_eq "high" "$(argv_flag_val "$GROK_ARGV" --reasoning-effort)" "grok explicit: --effort passes through"
assert_recorded "grok explicit" grok-4.6 high

# Pace file: quota may pick a seat, but only a cheap one, at that seat's effort.
pace_row() { # pool used_pct hours
  printf '{"pool":"%s","class":"other","used_pct":%s,"expected_pct":60,"stale":false,"hours_to_reset":%s,"reset_at":"2026-11-20T00:00:00.000Z","seen_at":"2026-11-19T00:00:00Z","status":"ok"}' "$1" "$2" "$3"
}
write_pace() { # file, then pool:used:hours triples
  local file="$1"; shift
  local rows="" spec pool used hours
  for spec in "$@"; do
    pool="${spec%%:*}"; spec="${spec#*:}"; used="${spec%%:*}"; hours="${spec#*:}"
    [ -n "$rows" ] && rows="$rows,"
    rows="$rows$(pace_row "$pool" "$used" "$hours")"
  done
  printf '{"schema":"capacity.pace/1","generated_at":"2026-11-19T00:00:00Z","rows":[%s]}\n' "$rows" > "$file"
}
assert_no_expensive() { # label file
  [ -s "$2" ] || return 0
  assert_eq "0" "$(grep -ciE 'carbon|argon|astra|fable|opus' "$2")" "$1: argv never names carbon|argon|astra|fable|opus"
}

PACE_AGY="$TEST_TMP/pace-agy-wide.json"
write_pace "$PACE_AGY" "agy:1:1" "codex A:50:40" "grok-cli:50:40" "agyclaude:50:40"
: > "$AGY_SPAWN"; : > "$GROK_ARGV"; : > "$CODEX_ARGV"
AUTOPILOT_PACE_FILE="$PACE_AGY" run_case pace-agy --agy-bin "$STUB_AGY" --grok-bin "$STUB_GROK" --codex-bin "$STUB_CODEX"
assert_eq "0" "$EXIT" "pace agy widest: exits 0 ($OUT)"
assert_eq "1" "$(grep -c -x -e gemini-4-hydrogen-low "$AGY_SPAWN")" "pace agy widest: model gemini-4-hydrogen-low"
assert_eq "low" "$(awk 'prev=="--effort"{print; exit}{prev=$0}' "$AGY_SPAWN")" "pace agy widest: effort low"
assert_recorded "pace agy widest" gemini-4-hydrogen-low low
assert_no_expensive "pace agy widest" "$AGY_SPAWN"

PACE_CODEX="$TEST_TMP/pace-codex-wide.json"
write_pace "$PACE_CODEX" "agy:80:48" "codex A:1:1" "grok-cli:80:48" "agyclaude:80:48"
: > "$CODEX_ARGV"; : > "$AGY_SPAWN"
AUTOPILOT_PACE_FILE="$PACE_CODEX" run_case pace-codex --agy-bin "$STUB_AGY" --grok-bin "$STUB_GROK" --codex-bin "$STUB_CODEX"
assert_eq "0" "$EXIT" "pace codex widest: exits 0 ($OUT)"
assert_eq "gpt-6.1-terra" "$(argv_flag_val "$CODEX_ARGV" --model)" "pace codex widest: model gpt-6.1-terra"
assert_contains "$(cat "$CODEX_ARGV")" 'model_reasoning_effort="low"' "pace codex widest: effort low"
assert_recorded "pace codex widest" gpt-6.1-terra low
assert_no_expensive "pace codex widest" "$CODEX_ARGV"

PACE_CLAUDE="$TEST_TMP/pace-agyclaude-wide.json"
write_pace "$PACE_CLAUDE" "agy:40:24" "codex A:70:48" "grok-cli:80:24" "agyclaude:1:1"
: > "$AGY_SPAWN"; : > "$GROK_ARGV"; : > "$CODEX_ARGV"
AUTOPILOT_PACE_FILE="$PACE_CLAUDE" run_case pace-agyclaude --agy-bin "$STUB_AGY" --grok-bin "$STUB_GROK" --codex-bin "$STUB_CODEX"
assert_eq "0" "$EXIT" "pace agyclaude widest: exits 0 ($OUT)"
_exp_n="$(grep -ciE 'opus|carbon|argon|astra|fable' "$OUT" || true)"; _exp_n="${_exp_n:-0}"
assert_eq "$_exp_n" "0" "pace agyclaude widest: result never names opus or another expensive model"
model_got="$(json_last_get "$OUT" model)"
case "$model_got" in
  grok-4.7|gpt-6.1-terra|gemini-4-hydrogen-low|opencode-go/beam-free) ;;
  *) assert_eq "cheap-seat" "$model_got" "pace agyclaude widest: picks a cheap seat" ;;
esac
assert_no_expensive "pace agyclaude widest agy" "$AGY_SPAWN"
assert_no_expensive "pace agyclaude widest grok" "$GROK_ARGV"
assert_no_expensive "pace agyclaude widest codex" "$CODEX_ARGV"

for role in author reviewer; do
  : > "$AGY_SPAWN"; : > "$GROK_ARGV"; : > "$CODEX_ARGV"
  AUTOPILOT_PACE_FILE="$PACE_AGY" run_case "pace-$role" --pace-role "$role" --agy-bin "$STUB_AGY" --grok-bin "$STUB_GROK" --codex-bin "$STUB_CODEX"
  assert_eq "0" "$EXIT" "pace-role $role unpinned: exits 0 ($OUT)"
  assert_eq "0" "$(printf '%s' "$OUT" | grep -ciE 'carbon|argon|astra|fable|opus' || true)" "pace-role $role unpinned: result never names an expensive model"
  assert_no_expensive "pace-role $role" "$AGY_SPAWN"
  assert_no_expensive "pace-role $role grok" "$GROK_ARGV"
  assert_no_expensive "pace-role $role codex" "$CODEX_ARGV"
done

# Guard: a pace-roles copy that still names carbon dies before any CLI spawn.
ROLES_CARBON="$TEST_TMP/pace-roles-carbon.json"
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!r.unpinned_seats) r.unpinned_seats = { agy: { model: "gemini-4-hydrogen-low", effort: "low" } };
  r.unpinned_seats.agy.model = "gemini-4-carbon-high";
  if (r.role_models && r.role_models.implementer) r.role_models.implementer.agy = "gemini-4-carbon-high";
  if (r.pools) {}
  fs.writeFileSync(process.argv[2], JSON.stringify(r));
' "$REPO_ROOT/scripts/lib/pace-roles.json" "$ROLES_CARBON"
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const row of p.rows) if (row.pool === "agy" || row.pool === "agy(alias 2)") {}
  const pools = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  pools.agy.model = "gemini-4-carbon-high";
  if (pools["agy(alias 2)"]) pools["agy(alias 2)"].model = "gemini-4-carbon-high";
  fs.writeFileSync(process.argv[4], JSON.stringify(pools));
' "$PACE_AGY" "$ROLES_CARBON" "$REPO_ROOT/scripts/lib/noncq-pools.json" "$TEST_TMP/noncq-carbon.json"
: > "$AGY_SPAWN"; : > "$GROK_ARGV"; : > "$CODEX_ARGV"
AUTOPILOT_PACE_FILE="$PACE_AGY" AUTOPILOT_PACE_ROLES="$ROLES_CARBON" AUTOPILOT_NONCQ_POOLS="$TEST_TMP/noncq-carbon.json" \
  run_case pace-guard --agy-bin "$STUB_AGY" --grok-bin "$STUB_GROK" --codex-bin "$STUB_CODEX"
assert_eq "2" "$EXIT" "pace carbon guard: precondition exit ($OUT)"
assert_contains "$OUT" "unpinned dispatch never uses an expensive model" "pace carbon guard: names the rule"
assert_contains "$OUT" "gemini-4-carbon-high" "pace carbon guard: names the model"
assert_contains "$OUT" "pass --model to choose one" "pace carbon guard: tells the caller to pass --model"
assert_eq "0" "$(wc -c < "$AGY_SPAWN" | tr -d " ")" "pace carbon guard: agy not spawned"
assert_eq "0" "$(wc -c < "$GROK_ARGV" | tr -d " ")" "pace carbon guard: grok not spawned"
assert_eq "0" "$(wc -c < "$CODEX_ARGV" | tr -d " ")" "pace carbon guard: codex not spawned"

# EFFORT_SENT is the value the CLI actually received.
: > "$AGY_SPAWN"
run_case agy-effort-sent --runner agy --model gemini-4-carbon-low --effort high --agy-bin "$STUB_AGY"
assert_eq "0" "$EXIT" "agy effort sent: exits 0 ($OUT)"
agy_eff="$(awk 'prev=="--effort"{print; exit}{prev=$0}' "$AGY_SPAWN")"
assert_eq "low" "$agy_eff" "agy effort sent: stub received low (model suffix wins over --effort high)"
assert_eq "$agy_eff" "$(json_last_get "$OUT" effort)" "agy effort sent: recorded effort equals the stub"

STUB_PI="$TEST_TMP/pi"
cat > "$STUB_PI" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$STUB_PI"
printf '{}\n' > "$TEST_TMP/pi-models.json"
PI_MODELS_JSON="$TEST_TMP/pi-models.json" run_case pi-effort --runner pi --model pi-fixture --pi-bin "$STUB_PI" --timeout 15s
assert_eq "default" "$(json_last_get "$OUT" effort)" "pi effort sent: recorded effort is default ($(json_last_get "$OUT" status) exit $EXIT)"

: > "$GROK_ARGV"
run_case grok-max --runner grok --model grok-4.7 --effort max --grok-bin "$STUB_GROK"
assert_eq "0" "$EXIT" "grok max: exits 0 ($OUT)"
grok_eff="$(argv_flag_val "$GROK_ARGV" --reasoning-effort)"
assert_eq "$grok_eff" "$(json_last_get "$OUT" effort)" "grok max: recorded effort equals the clamp the stub received ($grok_eff)"

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
  's/RUNNER="local"/RUNNER="auto"/'
sed_mutate "$PRE2/scripts/dispatch-hetero.sh" \
  '0,/      elif \[ "$MODEL_IS_DEFAULT" -eq 1 \]; then/s//      elif [ "$MODEL_IS_DEFAULT" -eq 99 ]; then/'
chmod +x "$PRE2/scripts/dispatch-hetero.sh"
RED_OUT2="$(cd "$SBX" && "$PRE2/scripts/dispatch-hetero.sh" --no-verify-tip --branch feat/impl-red-auto \
  --prompt-file "$PROMPT" --agy-bin "$STUB_AGY" --grok-bin "$STUB_GROK" --timeout 30s </dev/null 2>&1)"; RED_EXIT2=$?
assert_eq "agy" "$(json_last_get "$RED_OUT2" runner)" "negative control: without the unpinned grok route an unpinned call lands on agy"

finalize_test
