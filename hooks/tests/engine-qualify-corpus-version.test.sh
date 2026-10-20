#!/usr/bin/env bash
# corpus-version prints each role's current corpus_version and writes nothing.
# RED at 61a8b14d8: corpus-version without --role exits 2 (expected 0) as an unknown subcommand; the JSON reader then throws ERR_INVALID_ARG_TYPE because stdout is the usage text, not an object. Later cases did not run.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_STRIKE_WRITER=off
. "$(dirname "$0")/lib/engine-qualify-setup.sh"

JS="$REPO_ROOT/scripts/engine-qualify.js"
ERR="$TEST_TMP/err.txt"
ROLES=(reviewer owner implementer foreman brain consult discuss verification_author)
TOKEN_RE='^[A-Za-z0-9._:-]{1,128}$'

home_snapshot() {
  (cd "$HOME" && find . -print | sort)
}

run_cv() {
  local out_file="$1"
  shift
  set +e
  node "$JS" corpus-version "$@" >"$out_file" 2>"$ERR"
  RUN_RC=$?
  set -e
}

# 1. All eight roles, each value matches the seat schema TOKEN pattern.
ALL_OUT="$TEST_TMP/all.json"
run_cv "$ALL_OUT"
assert_exit_code "$RUN_RC" "0" "corpus-version without --role exits 0"
node -e '
const fs = require("fs");
const roles = process.argv.slice(1, 9);
const token = /^[A-Za-z0-9._:-]{1,128}$/;
const body = JSON.parse(fs.readFileSync(process.argv[9], "utf8"));
const keys = Object.keys(body);
if (keys.length !== 8) {
  console.error("key count " + keys.length);
  process.exit(1);
}
for (const role of roles) {
  if (!Object.prototype.hasOwnProperty.call(body, role)) {
    console.error("missing " + role);
    process.exit(1);
  }
  if (typeof body[role] !== "string" || !token.test(body[role])) {
    console.error(role + " value " + JSON.stringify(body[role]));
    process.exit(1);
  }
}
' "${ROLES[@]}" "$ALL_OUT"
assert_eq "$?" "0" "all 8 corpus-version values match the seat TOKEN pattern"

# 2. Printed version is the value the pre-exam comparison uses.
match_role() {
  local role="$1"
  local version
  version="$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(o[process.argv[2]])' "$ALL_OUT" "$role")"
  if ! [[ "$version" =~ $TOKEN_RE ]]; then
    fail "$role printed corpus_version is not a TOKEN: $version"
  fi
  local seat="$TEST_TMP/seat-$role.json"
  cat >"$seat" <<EOF
{
  "engine": "eng-review",
  "model": "eng-review-exact",
  "model_version": "2026-07-26",
  "runner": "cc-shim",
  "role": "$role",
  "effort": "high",
  "prompt_config_hash": "$HASH_A",
  "corpus_version": "$version"
}
EOF
  local out="$TEST_TMP/$role-match.out"
  set +e
  node "$JS" "$role" --seat-file "$seat" \
    --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
    --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
    --task-class code_review --domain repository --language en --tool diff_read \
    "${PANEL_BINDS[@]}" --panel-cmd "$PASS_PANEL" \
    --store "$TEST_TMP/store-$role" --raw-dir "$TEST_TMP/raw-$role" --emit-record \
    >"$out" 2>"$ERR"
  local rc=$?
  set -e
  if grep -q 'differs from exam corpus_version' "$ERR"; then
    fail "$role printed corpus_version disagreed with the exam comparison"
  fi
  if [[ "$rc" == "2" ]]; then
    fail "$role matching corpus exited 2 ($(cat "$ERR"))"
  fi
}
match_role reviewer
match_role owner

# 3. Unknown role.
UNK_OUT="$TEST_TMP/unknown.out"
: >"$UNK_OUT"
run_cv "$UNK_OUT" --role not-a-role
assert_exit_code "$RUN_RC" "2" "unknown role exits 2"
assert_eq "$(wc -c <"$UNK_OUT" | tr -d ' ')" "0" "unknown role prints nothing on stdout"
assert_contains "$(cat "$ERR")" "unknown role" "unknown role names the failure"

# 4. Tampered foreman asset root (same shape as the headless R9 pin case).
PIN_COPY="$TEST_TMP/foreman-pin-root"
mkdir -p "$PIN_COPY/evals"
for asset in foreman-eval-generator.js foreman-eval-grader.js foreman-capability-evidence-corpus.json foreman-harness-conformance.js foreman-asset-pins.json; do
  cp "$REPO_ROOT/evals/$asset" "$PIN_COPY/evals/$asset"
done
printf '\n' >>"$PIN_COPY/evals/foreman-eval-generator.js"
export AUTOPILOT_QUALIFY_SEED=corpus-version-foreman-pin
export AUTOPILOT_FOREMAN_ASSET_ROOT="$PIN_COPY"
FM_OUT="$TEST_TMP/foreman-role.out"
run_cv "$FM_OUT" --role foreman
assert_exit_code "$RUN_RC" "2" "--role foreman pin mismatch exits 2"
assert_eq "$(wc -c <"$FM_OUT" | tr -d ' ')" "0" "--role foreman pin mismatch prints nothing"
assert_contains "$(cat "$ERR")" "foreman pin" "--role foreman pin mismatch names the pin"
ALL_BAD="$TEST_TMP/all-bad.json"
run_cv "$ALL_BAD"
assert_exit_code "$RUN_RC" "2" "all-roles foreman pin mismatch exits 2"
node -e '
const fs = require("fs");
const roles = ["reviewer","owner","implementer","foreman","brain","consult","discuss","verification_author"];
const token = /^[A-Za-z0-9._:-]{1,128}$/;
const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!body.foreman || typeof body.foreman !== "object" || typeof body.foreman.error !== "string" || !body.foreman.error) {
  console.error("foreman entry " + JSON.stringify(body.foreman));
  process.exit(1);
}
for (const role of roles) {
  if (role === "foreman") continue;
  if (typeof body[role] !== "string" || !token.test(body[role])) {
    console.error(role + " " + JSON.stringify(body[role]));
    process.exit(1);
  }
}
' "$ALL_BAD"
assert_eq "$?" "0" "pin mismatch replaces only the foreman value with an error"
unset AUTOPILOT_QUALIFY_SEED
unset AUTOPILOT_FOREMAN_ASSET_ROOT

# 5. Write boundary: --store and --raw-dir are not created; HOME is unchanged.
WB_STORE="$TEST_TMP/should-not-exist-store"
WB_RAW="$TEST_TMP/should-not-exist-raw"
BEFORE_HOME="$(home_snapshot)"
WB_OUT="$TEST_TMP/write-boundary.out"
run_cv "$WB_OUT" --store "$WB_STORE" --raw-dir "$WB_RAW"
assert_exit_code "$RUN_RC" "0" "corpus-version with unused write flags still exits 0"
assert_file_absent "$WB_STORE" "corpus-version does not create --store"
assert_file_absent "$WB_RAW" "corpus-version does not create --raw-dir"
AFTER_HOME="$(home_snapshot)"
assert_eq "$AFTER_HOME" "$BEFORE_HOME" "corpus-version leaves the temp HOME unchanged"

finalize_test
