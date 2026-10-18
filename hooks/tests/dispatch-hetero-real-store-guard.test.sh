#!/usr/bin/env bash
# RED at 2377ad913: FAIL [dispatch-hetero-real-store-guard] a: default store has no new strike: expected '0', got '1'
# A non-PATH --*-bin override without an isolated capability store must not
# write strikes or passive-capture events into the default store.
# Incident 2026-10-19: a hand-run fake runner polluted ~/.autopilot strikes.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_STRIKE_WRITER \
  AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE 2>/dev/null || true
# lib.sh isolates ENGINE_CAPABILITY_DIR. These cases need the default store,
# which resolves under HOME. Point HOME at the suite sandbox and unset both
# store selectors unless a case sets them.
unset ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE
export HOME="$HOOK_HOME"
mkdir -p "$HOME/.autopilot"

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
DEFAULT_STORE="$HOME/.autopilot/engine-capability"

make_fail_stub() {
  local stub="$1"
  cat > "$stub" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: committed then errored"
exit 3
EOF
  chmod +x "$stub"
  make_agy_stub_versioned "$stub"
}

make_quota_stub() {
  local stub="$1"
  cat > "$stub" <<'EOF'
#!/usr/bin/env bash
echo "ERROR: OpenAI billing quota exceeded" >&2
exit 123
EOF
  chmod +x "$stub"
  make_agy_stub_versioned "$stub"
}

strike_count() {
  node -e '
    const fs = require("fs");
    const f = process.argv[1];
    if (!fs.existsSync(f)) { process.stdout.write("0"); process.exit(0); }
    process.stdout.write(String(fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length));
  ' "$1"
}

latest_manifest_field() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const dir = process.argv[1];
    const field = process.argv[2];
    const files = fs.readdirSync(dir).filter((n) => n.endsWith(".manifest.json"))
      .map((n) => path.join(dir, n));
    if (!files.length) { process.stdout.write(""); process.exit(0); }
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    const doc = JSON.parse(fs.readFileSync(files[0], "utf8"));
    const v = doc[field];
    process.stdout.write(v === undefined ? "" : String(v));
  ' "$AUTOPILOT_DISPATCH_RUNS_DIR" "$1"
}

reset_stores() {
  rm -rf "$DEFAULT_STORE" "$TEST_TMP/iso-store"
  rm -f "$AUTOPILOT_DISPATCH_RUNS_DIR"/*.manifest.json
}

run_dispatch() {
  local errfile="$1"; shift
  (cd "$SBX" && "$@" >"$TEST_TMP/last-out.json" 2>"$errfile")
}

# (a) fake runner, no isolated store: no strike in the default store.
reset_stores
STUB_A="$TEST_TMP/agy-a"
make_fail_stub "$STUB_A"
ERR_A="$TEST_TMP/err-a"
run_dispatch "$ERR_A" "$SCRIPT" --branch feat/guard-a --prompt-file "$PROMPT" \
  --agy-bin "$STUB_A" --model guard-engine-a --runner agy
SC_A="$(strike_count "$DEFAULT_STORE/strikes.jsonl")"
assert_eq "$SC_A" "0" "a: default store has no new strike"
assert_contains "$(cat "$ERR_A")" "ENGINE_CAPABILITY_DIR" "a: stderr names ENGINE_CAPABILITY_DIR"
assert_contains "$(cat "$ERR_A")" "--store" "a: stderr names --store"
assert_contains "$(cat "$ERR_A")" "AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE=1" "a: stderr names the release variable"
NOTE_A="$(grep -c 'not writing the capability store' "$ERR_A" || true)"
assert_eq "$NOTE_A" "1" "a: stderr explanation once"
assert_eq "$(latest_manifest_field capability_write_suppressed)" "test_double_without_isolated_store" "a: manifest capability_write_suppressed"

# (b) same failure, isolated store: the strike lands there, not in the default store.
reset_stores
ISO_B="$TEST_TMP/iso-store"
mkdir -p "$ISO_B"
ERR_B="$TEST_TMP/err-b"
run_dispatch "$ERR_B" env ENGINE_CAPABILITY_DIR="$ISO_B" "$SCRIPT" --branch feat/guard-b --prompt-file "$PROMPT" \
  --agy-bin "$STUB_A" --model guard-engine-b --runner agy
assert_eq "$(strike_count "$ISO_B/strikes.jsonl")" "1" "b: strike written to isolated store"
assert_eq "$(strike_count "$DEFAULT_STORE/strikes.jsonl")" "0" "b: default store untouched"
assert_eq "$(latest_manifest_field capability_write_suppressed)" "" "b: no suppression field"

# (c) --agy-bin is the same binary command -v finds on a temp PATH: write as usual.
reset_stores
PATHBIN="$TEST_TMP/pathbin"
mkdir -p "$PATHBIN"
STUB_C="$PATHBIN/agy"
make_fail_stub "$STUB_C"
ERR_C="$TEST_TMP/err-c"
run_dispatch "$ERR_C" env PATH="$PATHBIN:$PATH" "$SCRIPT" --branch feat/guard-c --prompt-file "$PROMPT" \
  --agy-bin "$STUB_C" --model guard-engine-c --runner agy
assert_eq "$(strike_count "$DEFAULT_STORE/strikes.jsonl")" "1" "c: same-path override writes a strike"
assert_eq "$(latest_manifest_field capability_write_suppressed)" "" "c: no suppression field"

# (d) release variable: a non-PATH override writes the default store.
reset_stores
ERR_D="$TEST_TMP/err-d"
run_dispatch "$ERR_D" env AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE=1 "$SCRIPT" \
  --branch feat/guard-d --prompt-file "$PROMPT" \
  --agy-bin "$STUB_A" --model guard-engine-d --runner agy
assert_eq "$(strike_count "$DEFAULT_STORE/strikes.jsonl")" "1" "d: release variable writes a strike"
assert_eq "$(latest_manifest_field capability_write_suppressed)" "" "d: no suppression field"

# (e) passive_capture blocked without a store, written when isolated.
reset_stores
STUB_E="$TEST_TMP/agy-quota"
make_quota_stub "$STUB_E"
ERR_E="$TEST_TMP/err-e"
run_dispatch "$ERR_E" "$SCRIPT" --branch feat/guard-e --prompt-file "$PROMPT" \
  --agy-bin "$STUB_E" --model gpt-5.5 --runner agy
if [ -f "$DEFAULT_STORE/capability.jsonl" ]; then
  fail "e: passive capture did not write the default store"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_contains "$(cat "$ERR_E")" "not writing the capability store" "e: stderr explains the skipped passive write"
assert_eq "$(latest_manifest_field capability_write_suppressed)" "test_double_without_isolated_store" "e: manifest field on suppressed passive capture"

reset_stores
ISO_E="$TEST_TMP/iso-store"
mkdir -p "$ISO_E"
ERR_EI="$TEST_TMP/err-ei"
run_dispatch "$ERR_EI" env ENGINE_CAPABILITY_DIR="$ISO_E" "$SCRIPT" --branch feat/guard-ei --prompt-file "$PROMPT" \
  --agy-bin "$STUB_E" --model gpt-5.5 --runner agy
assert_file_exists "$ISO_E/capability.jsonl" "e-iso: passive capture writes the isolated store"
assert_eq "$(latest_manifest_field capability_write_suppressed)" "" "e-iso: no suppression field"

# Negative control: the live-rail smoke allowlist must pass the store selectors.
# This assertion fails on an unpatched scripts/engine-qualify.js.
node - "$REPO_ROOT/scripts/engine-qualify.js" <<'NODE'
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const idx = src.indexOf("DISPATCH_QUIET: '1'");
if (idx < 0) { console.error("FAIL: qualify spawn env anchor missing"); process.exit(1); }
const window = src.slice(idx, idx + 900);
for (const name of ["ENGINE_CAPABILITY_DIR", "ENGINE_CAPABILITY_FILE"]) {
  if (!window.includes(name)) {
    console.error("FAIL: smoke env does not carry " + name);
    process.exit(1);
  }
}
console.log("PASS: qualify smoke env carries ENGINE_CAPABILITY_DIR and ENGINE_CAPABILITY_FILE");
NODE
assert_eq "$?" "0" "qualify: smoke env passthrough"

finalize_test
