#!/usr/bin/env bash
# BL-0194 P5 headless contract: exit codes 0-5, --seat-file, --emit-record.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_STRIKE_WRITER=off
SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
. "$(dirname "$0")/lib/engine-qualify-setup.sh"
# RED at 48d012322: FAIL exit-codes-merged got 2 for codes 0,1,3,4,5 (pairwise uniq 1); missing and schema seat cases got 2; emit-record stdout lines 0. Usage (2) and bare no_verdict (1) already matched.
# RED at eaf8c9eef: corpus mismatch exits 0 (expected 2), stdout 6932 bytes, stderr names neither seat-corpus-1 nor reviewer-known-bad-clean-v2.reviewer-metamorphic-v6, and both --store and --raw-dir were created. effort=default and the 0/1/2/3/4/5 stdout matrix already passed.
# RED at 891119040: owner/brain/verification_author/implementer/consult/discuss/foreman wrong corpus_version exits 0 (expected 2); seat.role disagreeing with the subcommand was untested; a headless throw (consult without --execute) exits 2. Reviewer mismatch already exits 2.
# RED at 4140e208f: a schema-valid foreman seat whose corpus_version is the pinned corpus hash plus generator version still exits 2; stderr names undefined because the sitting row has no corpus_version.
# RED at df6502222: foreman test-mode --emit-row has no corpus_version, so buildV2Record cannot hash the same value the pre-exam check compared; a mutated copy of a pinned foreman asset does not exit 2.
# RED at 06b8b6c85: a non-test-mode run with AUTOPILOT_FOREMAN_ASSET_ROOT set exits 3 and starts the foreman sitting; a missing or non-JSON pin file is reported as a qualification precondition failure; a live row corpus_version is overwritten instead of exiting 2.
# RED at 3abca8f0b: JSON null and [] exit 2 as "qualification precondition failed" (null throws on index; [] mismatches a pin) instead of the unreadable-or-invalid-JSON message that names the pin path.

STORE="$TEST_TMP/headless-store"
RAW="$TEST_TMP/headless-raw"
SEAT="$TEST_TMP/seat.json"
ERR="$TEST_TMP/err.txt"

cat >"$SEAT" <<EOF
{
  "engine": "eng-review",
  "model": "eng-review-exact",
  "model_version": "2026-07-26",
  "runner": "cc-shim",
  "role": "reviewer",
  "effort": "high",
  "prompt_config_hash": "$HASH_A",
  "corpus_version": "reviewer-known-bad-clean-v2.reviewer-metamorphic-v6"
}
EOF

# Identity flags the seat file replaces are omitted; the rest stay flags.
SEAT_ARGS=(
  reviewer
  --seat-file "$SEAT"
  --runner-version 1.0.0
  --family openai
  --harness-version reviewer-harness-v2
  --semantic-fingerprint "$HASH_B"
  --containment-fingerprint "$HASH_C"
  --task-class code_review
  --domain repository
  --language en
  --tool diff_read
  "${PANEL_BINDS[@]}"
)

run_q() {
  local out_file="$1"
  shift
  set +e
  "$SCRIPT" "$@" >"$out_file" 2>"$ERR"
  RUN_RC=$?
  set -e
}

# --- exit-codes-merged ---
PASS_OUT="$TEST_TMP/pass.out"
run_q "$PASS_OUT" "${SEAT_ARGS[@]}" --panel-cmd "$PASS_PANEL" \
  --store "$STORE-pass" --raw-dir "$RAW-pass" --emit-record
CODE_PASS=$RUN_RC

FAIL_OUT="$TEST_TMP/fail.out"
run_q "$FAIL_OUT" "${SEAT_ARGS[@]}" --panel-cmd "$ALL_PASS_PANEL" \
  --store "$STORE-fail" --raw-dir "$RAW-fail" --emit-record
CODE_FAIL=$RUN_RC

USE_OUT="$TEST_TMP/use.out"
run_q "$USE_OUT" reviewer --emit-record
CODE_USE=$RUN_RC

NV_OUT="$TEST_TMP/nv.out"
run_q "$NV_OUT" "${SEAT_ARGS[@]}" --panel-cmd "/panel/node /panel/does-not-exist.js" \
  --store "$STORE-nv" --raw-dir "$RAW-nv" --emit-record
CODE_NV=$RUN_RC

BAD_OUT="$TEST_TMP/bad.out"
run_q "$BAD_OUT" "${SEAT_ARGS[@]}" --seat-file "$TEST_TMP/missing-seat.json" \
  --panel-cmd "$PASS_PANEL" --store "$STORE-bad" --raw-dir "$RAW-bad" --emit-record
CODE_BAD=$RUN_RC

LEG_OUT="$TEST_TMP/leg.out"
EQ_HEADLESS_LEGACY_ROW=1 \
  run_q "$LEG_OUT" "${SEAT_ARGS[@]}" --panel-cmd "$PASS_PANEL" \
  --store "$STORE-leg" --raw-dir "$RAW-leg" --emit-record
CODE_LEG=$RUN_RC

assert_exit_code "$CODE_PASS" "0" "exit-codes-merged passed exam"
assert_exit_code "$CODE_FAIL" "1" "exit-codes-merged failed exam"
assert_exit_code "$CODE_USE" "2" "exit-codes-merged usage error"
assert_exit_code "$CODE_NV" "3" "exit-codes-merged no_verdict or infrastructure with flags"
assert_exit_code "$CODE_BAD" "4" "exit-codes-merged invalid seat file"
assert_exit_code "$CODE_LEG" "5" "exit-codes-merged record fails validation"

CODES=("$CODE_PASS" "$CODE_FAIL" "$CODE_USE" "$CODE_NV" "$CODE_BAD" "$CODE_LEG")
UNIQ="$(printf '%s\n' "${CODES[@]}" | sort -u | wc -l | tr -d ' ')"
assert_eq "$UNIQ" "6" "exit-codes-merged codes 0-5 are pairwise distinct (${CODES[*]})"

NV_BARE_OUT="$TEST_TMP/nv-bare.out"
run_q "$NV_BARE_OUT" "${QUALIFY_ARGS[@]}" --panel-cmd "/panel/node /panel/does-not-exist.js" \
  --store "$STORE-nv-bare" --raw-dir "$RAW-nv-bare"
assert_exit_code "$RUN_RC" "1" "without --seat-file/--emit-record a no_verdict run still exits 1"
assert_eq "$(wc -c <"$NV_OUT" | tr -d ' ')" "0" "infrastructure with --emit-record prints no record"

# --- seat-file invalid or missing: exit 4, store and raw-dir untouched ---
MISS_STORE="$TEST_TMP/miss-store"
MISS_RAW="$TEST_TMP/miss-raw"
run_q "$TEST_TMP/miss.out" "${QUALIFY_ARGS[@]}" --seat-file "$TEST_TMP/no-seat.json" \
  --panel-cmd "$PASS_PANEL" --store "$MISS_STORE" --raw-dir "$MISS_RAW"
assert_exit_code "$RUN_RC" "4" "missing seat file exits 4"
assert_file_absent "$MISS_STORE" "missing seat file does not create --store"
assert_file_absent "$MISS_RAW" "missing seat file does not create --raw-dir"
if [[ -d "$HOME/.autopilot/qualification-outbox" ]]; then
  fail "missing seat file must not enqueue ~/.autopilot/qualification-outbox"
fi

# --- seat-file schema ---
schema_reject() {
  local name="$1"
  local body="$2"
  local path="$TEST_TMP/seat-$name.json"
  printf '%s\n' "$body" >"$path"
  local st="$TEST_TMP/schema-$name-store"
  local raw="$TEST_TMP/schema-$name-raw"
  run_q "$TEST_TMP/schema-$name.out" reviewer --seat-file "$path" \
    --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
    --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
    --task-class code_review --domain repository --language en --tool diff_read \
    "${PANEL_BINDS[@]}" --panel-cmd "$PASS_PANEL" --store "$st" --raw-dir "$raw"
  assert_exit_code "$RUN_RC" "4" "seat schema rejects $name"
  assert_file_absent "$st" "schema reject $name creates no store"
}

schema_reject extra "$(node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.extra="no"; process.stdout.write(JSON.stringify(s));' "$SEAT")"
schema_reject token "$(node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.effort="bad token"; process.stdout.write(JSON.stringify(s));' "$SEAT")"
schema_reject missing "$(node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); delete s.engine; process.stdout.write(JSON.stringify(s));' "$SEAT")"

# Disagreement with an explicit flag is usage, not a seat-file failure.
run_q "$TEST_TMP/disagree.out" "${SEAT_ARGS[@]}" --effort low \
  --panel-cmd "$PASS_PANEL" --store "$STORE-disagree" --emit-record
assert_exit_code "$RUN_RC" "2" "seat file disagreeing with --effort is exit 2"

# --- emit-record ---
assert_file_exists "$PASS_OUT" "passed exam produced stdout"
QMOD="$REPO_ROOT/scripts/lib/qualification-metrics.js"
node -e '
const fs = require("fs");
const q = require(process.argv[1]);
const raw = fs.readFileSync(process.argv[2], "utf8").trim();
const lines = raw.split("\n").filter((l) => l.length);
if (lines.length !== 1) { console.error("stdout lines " + lines.length); process.exit(1); }
const rec = JSON.parse(lines[0]);
for (const k of ["schema","record_id","record_id_basis","source","seat","verdict","raw","imported_at","producer","transcript_hash","administered_at","origin_host_class"]) {
  if (rec[k] === undefined) { console.error("missing " + k); process.exit(1); }
}
if (!rec.transcript_hash) { console.error("no transcript_hash"); process.exit(1); }
const v = q.validateRecord(lines[0] + "\n", { semantic: true });
if (v.errors.length) { console.error(JSON.stringify(v.errors)); process.exit(1); }
const id = q.recordIdV1(rec.producer, rec.transcript_hash, rec.seat, rec.seat.corpus_version, rec.administered_at);
if (rec.record_id !== id) { console.error("record_id mismatch " + rec.record_id + " vs " + id); process.exit(1); }
rec.record_id = "0".repeat(64);
const bad = q.validateRecord(JSON.stringify(rec), { semantic: true });
if (!bad.errors.some((e) => e[0] === "RECORD_ID_MISMATCH")) {
  console.error("expected RECORD_ID_MISMATCH, got " + JSON.stringify(bad.errors));
  process.exit(1);
}
' "$QMOD" "$PASS_OUT"
assert_eq "$?" "0" "emit-record parses, validateRecord semantic, recordIdV1, mutated id is RECORD_ID_MISMATCH"

# Headless evidence stays under --store, not ENGINE_CAPABILITY_DIR.
if [[ -n "$(find "$ENGINE_CAPABILITY_DIR" -type f 2>/dev/null)" ]]; then
  fail "headless run wrote engine capability state outside --store: $(find "$ENGINE_CAPABILITY_DIR" -type f)"
fi
if [[ -d "$HOME/.autopilot/qualification-outbox" ]]; then
  fail "headless run enqueued qualification-outbox"
fi

# Exam methodology corpus hashed into record_id (row.corpus_version / seat.corpus_version).
EXAM_CORPUS="reviewer-known-bad-clean-v2.reviewer-metamorphic-v6"

# --- corpus mismatch: exit 2, both values on stderr, empty stdout, no store/raw ---
MIS_SEAT="$TEST_TMP/seat-mismatch.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.corpus_version="seat-corpus-1"; fs.writeFileSync(process.argv[2], JSON.stringify(s));' "$SEAT" "$MIS_SEAT"
MIS_STORE="$TEST_TMP/mismatch-store"
MIS_RAW="$TEST_TMP/mismatch-raw"
run_q "$TEST_TMP/mismatch.out" reviewer --seat-file "$MIS_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  "${PANEL_BINDS[@]}" --panel-cmd "$PASS_PANEL" \
  --store "$MIS_STORE" --raw-dir "$MIS_RAW" --emit-record
assert_exit_code "$RUN_RC" "2" "corpus mismatch exits 2"
assert_eq "$(wc -c <"$TEST_TMP/mismatch.out" | tr -d ' ')" "0" "corpus mismatch prints no record"
assert_contains "$(cat "$ERR")" "seat-corpus-1" "corpus mismatch stderr names the seat file corpus_version"
assert_contains "$(cat "$ERR")" "$EXAM_CORPUS" "corpus mismatch stderr spells the exam corpus_version"
assert_file_absent "$MIS_STORE" "corpus mismatch does not create --store"
assert_file_absent "$MIS_RAW" "corpus mismatch does not create --raw-dir"

# --- matching corpus: the passed record hashes the exam value ---
node -e '
const fs = require("fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
if (rec.seat.corpus_version !== process.argv[2]) {
  console.error("seat.corpus_version " + rec.seat.corpus_version);
  process.exit(1);
}
' "$PASS_OUT" "$EXAM_CORPUS"
assert_eq "$?" "0" "matching corpus record seat.corpus_version is the exam value"

# --- effort=default reaches a normal outcome and the record ---
DEF_SEAT="$TEST_TMP/seat-default.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.effort="default"; fs.writeFileSync(process.argv[2], JSON.stringify(s));' "$SEAT" "$DEF_SEAT"
DEF_OUT="$TEST_TMP/default.out"
run_q "$DEF_OUT" reviewer --seat-file "$DEF_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  "${PANEL_BINDS[@]}" --panel-cmd "$PASS_PANEL" \
  --store "$STORE-default" --raw-dir "$RAW-default" --emit-record
assert_exit_code "$RUN_RC" "0" "effort=default headless exam reaches the normal passed outcome"
node -e '
const fs = require("fs");
const q = require(process.argv[1]);
const raw = fs.readFileSync(process.argv[2], "utf8").trim();
const lines = raw.split("\n").filter((l) => l.length);
if (lines.length !== 1) { console.error("stdout lines " + lines.length); process.exit(1); }
const rec = JSON.parse(lines[0]);
if (rec.seat.effort !== "default") { console.error("effort " + rec.seat.effort); process.exit(1); }
const id = q.recordIdV1(rec.producer, rec.transcript_hash, rec.seat, rec.seat.corpus_version, rec.administered_at);
if (rec.record_id !== id) { console.error("record_id mismatch"); process.exit(1); }
' "$QMOD" "$DEF_OUT"
assert_eq "$?" "0" "effort=default record has seat.effort default and a valid record_id"

# --- emit-record stdout matrix: 0 and 1 print one record; 2, 3, 4, 5 print nothing ---
stdout_lines() { wc -l <"$1" | tr -d ' '; }
assert_eq "$(stdout_lines "$PASS_OUT")" "1" "exit 0 prints exactly one record"
assert_eq "$(stdout_lines "$FAIL_OUT")" "1" "exit 1 prints exactly one record"
assert_eq "$(wc -c <"$USE_OUT" | tr -d ' ')" "0" "exit 2 prints nothing on stdout"
assert_eq "$(wc -c <"$NV_OUT" | tr -d ' ')" "0" "exit 3 no_verdict prints nothing on stdout"
assert_eq "$(wc -c <"$BAD_OUT" | tr -d ' ')" "0" "exit 4 invalid seat prints nothing on stdout"
assert_eq "$(wc -c <"$LEG_OUT" | tr -d ' ')" "0" "exit 5 invalid record prints nothing on stdout"
node -e '
const fs = require("fs");
const passed = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
const failed = JSON.parse(fs.readFileSync(process.argv[2], "utf8").trim());
if (passed.verdict.status !== "qualified") { console.error("passed status " + passed.verdict.status); process.exit(1); }
if (failed.verdict.status !== "failed") { console.error("failed status " + failed.verdict.status); process.exit(1); }
if (passed.verdict.status === failed.verdict.status) { console.error("verdicts identical"); process.exit(1); }
' "$PASS_OUT" "$FAIL_OUT"
assert_eq "$?" "0" "printed record verdict.status distinguishes qualified from failed"

# --- seat.role disagrees with the subcommand: exit 2, no store ---
ROLE_SEAT="$TEST_TMP/seat-role.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.role="owner"; fs.writeFileSync(process.argv[2], JSON.stringify(s));' "$SEAT" "$ROLE_SEAT"
ROLE_STORE="$TEST_TMP/role-store"
ROLE_RAW="$TEST_TMP/role-raw"
run_q "$TEST_TMP/role.out" reviewer --seat-file "$ROLE_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  "${PANEL_BINDS[@]}" --panel-cmd "$PASS_PANEL" \
  --store "$ROLE_STORE" --raw-dir "$ROLE_RAW" --emit-record
assert_exit_code "$RUN_RC" "2" "seat.role disagreeing with the subcommand exits 2"
assert_eq "$(wc -c <"$TEST_TMP/role.out" | tr -d ' ')" "0" "role disagreement prints no record"
assert_file_absent "$ROLE_STORE" "role disagreement does not create --store"
assert_file_absent "$ROLE_RAW" "role disagreement does not create --raw-dir"

# Corpus strings are the ones buildV2Record copies from row.corpus_version.
exam_corpus_for() {
  node - "$REPO_ROOT" "$1" <<'NODE'
const path = require('path');
const root = process.argv[2];
const role = process.argv[3];
if (role === 'owner') {
  const q = require(path.join(root, 'scripts/engine-qualify.js'));
  const g = require(path.join(root, 'evals/owner-eval-generator.js'));
  const oracle = q.verifyPinnedOwnerEvaluationAssets();
  process.stdout.write(`${oracle.methodology_version}.${g.GENERATOR_VERSION}`);
} else if (role === 'foreman') {
  // methodology_version is foreman-live-rail/1; the seat schema rejects "/".
  // The pinned corpus hash plus the generator version is the schema-legal pin.
  const g = require(path.join(root, 'evals/foreman-eval-generator.js'));
  const pins = require(path.join(root, 'evals/foreman-asset-pins.json'));
  process.stdout.write(`${pins.corpus}.${g.GENERATOR_VERSION}`);
} else if (role === 'brain') {
  const g = require(path.join(root, 'evals/brain-eval-generator.js'));
  process.stdout.write(`${g.CORPUS.methodology_version}.${g.GENERATOR_VERSION}`);
} else if (role === 'verification_author') {
  const g = require(path.join(root, 'evals/va-eval-generator.js'));
  process.stdout.write(`${g.CORPUS.corpus_version}.${g.GENERATOR_VERSION}`);
} else if (role === 'implementer') {
  const g = require(path.join(root, 'evals/impl-eval-generator.js'));
  process.stdout.write(`${g.CORPUS.corpus_version}.${g.GENERATOR_VERSION}`);
} else if (role === 'consult') {
  const g = require(path.join(root, 'evals/consult-eval-generator.js'));
  process.stdout.write(`${g.CORPUS.corpus_version}.${g.GENERATOR_VERSION}`);
} else if (role === 'discuss') {
  const g = require(path.join(root, 'evals/discuss-eval-generator.js'));
  process.stdout.write(`${g.CORPUS.corpus_version}.${g.GENERATOR_VERSION}`);
} else {
  process.stderr.write('unknown role\n');
  process.exit(1);
}
NODE
}

dir_snapshot() {
  python3 - "$1" <<'PY'
import hashlib, os, sys
root = sys.argv[1]
if not os.path.exists(root):
    sys.exit(0)
for dirpath, dirnames, filenames in os.walk(root):
    dirnames.sort()
    for name in sorted(filenames):
        path = os.path.join(dirpath, name)
        if os.path.islink(path):
            continue
        digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
        print(f"{path}\t{digest}")
PY
}

# Wrong corpus_version: exit 2 before any exam write. brain, verification_author,
# implementer, consult, and discuss have no headless stub that finishes a sitting
# (implementer is the live rail; consult/discuss refuse without a paid broker).
# Foreman compares the pinned corpus hash plus generator version before the exam.
# AUTOPILOT_QUALIFY_SEED is the foreman test-mode gate that returns from parseArgs
# before the panel transport is required, so the corpus check is what runs.
for role in owner brain verification_author implementer consult discuss foreman; do
  EXAM_VALUE="$(exam_corpus_for "$role")"
  MIS_PATH="$TEST_TMP/seat-$role-mis.json"
  node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.role=process.argv[2]; s.corpus_version="seat-corpus-1"; fs.writeFileSync(process.argv[3], JSON.stringify(s));' "$SEAT" "$role" "$MIS_PATH"
  ST="$TEST_TMP/store-$role-mis"
  RW="$TEST_TMP/raw-$role-mis"
  mkdir -p "$ST" "$RW"
  printf 'kept\n' >"$ST/marker" 
  printf 'kept\n' >"$RW/marker"
  BEFORE_ST="$(dir_snapshot "$ST")"
  BEFORE_RW="$(dir_snapshot "$RW")"
  EXTRA=()
  if [[ "$role" != "implementer" && "$role" != "foreman" ]]; then
    EXTRA=(--panel-cmd "$PASS_PANEL" "${PANEL_BINDS[@]}")
  fi
  if [[ "$role" == "foreman" ]]; then
    export AUTOPILOT_QUALIFY_SEED=foreman-headless-corpus
  fi
  run_q "$TEST_TMP/$role-mis.out" "$role" --seat-file "$MIS_PATH" \
    --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
    --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
    --task-class code_review --domain repository --language en --tool diff_read \
    "${EXTRA[@]}" --store "$ST" --raw-dir "$RW" --emit-record
  unset AUTOPILOT_QUALIFY_SEED
  assert_exit_code "$RUN_RC" "2" "$role corpus mismatch exits 2"
  assert_eq "$(wc -c <"$TEST_TMP/$role-mis.out" | tr -d ' ')" "0" "$role corpus mismatch prints no record"
  assert_contains "$(cat "$ERR")" "seat-corpus-1" "$role corpus mismatch names the seat corpus_version"
  assert_contains "$(cat "$ERR")" "$EXAM_VALUE" "$role corpus mismatch spells the exam corpus_version"
  if grep -E '^engine-qualify: seat file corpus_version .* differs from exam corpus_version .*undefined' "$ERR"; then
    fail "$role corpus mismatch mentions undefined"
  fi
  assert_eq "$(dir_snapshot "$ST")" "$BEFORE_ST" "$role corpus mismatch leaves --store unchanged"
  assert_eq "$(dir_snapshot "$RW")" "$BEFORE_RW" "$role corpus mismatch leaves --raw-dir unchanged"
done

# Matching corpus where a stub can finish or can prove the check passed.
# Owner reuses the reviewer panel stub: the exam runs and the record hashes the exam value.
OWNER_CORPUS="$(exam_corpus_for owner)"
OWN_SEAT="$TEST_TMP/seat-owner.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.role="owner"; s.corpus_version=process.argv[2]; fs.writeFileSync(process.argv[3], JSON.stringify(s));' "$SEAT" "$OWNER_CORPUS" "$OWN_SEAT"
OWN_OUT="$TEST_TMP/owner-match.out"
run_q "$OWN_OUT" owner --seat-file "$OWN_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  "${PANEL_BINDS[@]}" --panel-cmd "$PASS_PANEL" \
  --store "$STORE-owner" --raw-dir "$RAW-owner" --emit-record
if [[ "$RUN_RC" != "0" && "$RUN_RC" != "1" ]]; then
  fail "owner matching corpus should reach an exam outcome, got $RUN_RC ($(cat "$ERR"))"
fi
node -e '
const fs = require("fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
if (rec.seat.corpus_version !== process.argv[2]) {
  console.error("seat.corpus_version " + rec.seat.corpus_version);
  process.exit(1);
}
' "$OWN_OUT" "$OWNER_CORPUS"
assert_eq "$?" "0" "owner matching corpus record uses the exam corpus_version"

# Foreman matching corpus: test mode is the whole sitting the CLI can run without a
# panel. It is inadmissible (qualified stays false), so headless exits 3 and writes
# no record. The corpus check must not reject the pinned value.
FOREMAN_CORPUS="$(exam_corpus_for foreman)"
FM_SEAT="$TEST_TMP/seat-foreman-match.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.role="foreman"; s.corpus_version=process.argv[2]; fs.writeFileSync(process.argv[3], JSON.stringify(s));' "$SEAT" "$FOREMAN_CORPUS" "$FM_SEAT"
FM_ST="$TEST_TMP/store-foreman-match"
FM_RW="$TEST_TMP/raw-foreman-match"
mkdir -p "$FM_ST" "$FM_RW"
printf 'kept\n' >"$FM_ST/marker"
printf 'kept\n' >"$FM_RW/marker"
BEFORE_FM_ST="$(dir_snapshot "$FM_ST")"
BEFORE_FM_RW="$(dir_snapshot "$FM_RW")"
export AUTOPILOT_QUALIFY_SEED=foreman-headless-match
run_q "$TEST_TMP/foreman-match.out" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --store "$FM_ST" --raw-dir "$FM_RW" --emit-record
unset AUTOPILOT_QUALIFY_SEED
assert_exit_code "$RUN_RC" "3" "foreman matching corpus test-mode sitting exits 3"
assert_eq "$(wc -c <"$TEST_TMP/foreman-match.out" | tr -d ' ')" "0" "foreman test-mode sitting prints no record"
if grep -q 'differs from exam corpus_version' "$ERR"; then
  fail "foreman matching corpus was rejected as a mismatch"
fi
if grep -E '^engine-qualify: seat file corpus_version .* differs from exam corpus_version .*undefined' "$ERR"; then
  fail "foreman matching corpus mentions undefined"
fi
assert_eq "$(dir_snapshot "$FM_ST")" "$BEFORE_FM_ST" "foreman matching corpus leaves --store unchanged"
assert_eq "$(dir_snapshot "$FM_RW")" "$BEFORE_FM_RW" "foreman matching corpus leaves --raw-dir unchanged"

# Consult and discuss: a matching corpus passes the pre-exam check and then the
# missing --execute guard throws. Headless maps that throw to exit 3. No store write.
for role in consult discuss; do
  MATCH="$(exam_corpus_for "$role")"
  MATCH_SEAT="$TEST_TMP/seat-$role-match.json"
  node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.role=process.argv[2]; s.corpus_version=process.argv[3]; fs.writeFileSync(process.argv[4], JSON.stringify(s));' "$SEAT" "$role" "$MATCH" "$MATCH_SEAT"
  ST="$TEST_TMP/store-$role-match"
  RW="$TEST_TMP/raw-$role-match"
  run_q "$TEST_TMP/$role-match.out" "$role" --seat-file "$MATCH_SEAT" \
    --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
    --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
    --task-class code_review --domain repository --language en --tool diff_read \
    "${PANEL_BINDS[@]}" --panel-cmd "$PASS_PANEL" \
    --store "$ST" --raw-dir "$RW" --emit-record
  assert_exit_code "$RUN_RC" "3" "$role matching corpus then missing --execute exits 3"
  assert_eq "$(wc -c <"$TEST_TMP/$role-match.out" | tr -d ' ')" "0" "$role throw prints no record"
  assert_file_absent "$ST" "$role throw does not create --store"
  assert_file_absent "$RW" "$role throw does not create --raw-dir"
  if grep -q 'differs from exam corpus_version' "$ERR"; then
    fail "$role matching corpus was rejected as a mismatch"
  fi
done

# Foreman test mode is inadmissible, so --emit-record still exits 3 with an empty
# stdout. --emit-row prints the row the record builder would consume. That row's
# corpus_version is the value compared before the exam, and buildV2Record hashes it.
FM_ROW_OUT="$TEST_TMP/foreman-row.out"
export AUTOPILOT_QUALIFY_SEED=foreman-headless-row
run_q "$FM_ROW_OUT" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --store "$TEST_TMP/store-foreman-row" --raw-dir "$TEST_TMP/raw-foreman-row" --emit-row
unset AUTOPILOT_QUALIFY_SEED
node -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];
const q = require(path.join(root, "scripts/lib/qualification-metrics.js"));
const { buildV2Record } = require(path.join(root, "scripts/lib/qualification-record-v2.js"));
const row = JSON.parse(fs.readFileSync(process.argv[2], "utf8").trim());
const expected = process.argv[3];
if (row.corpus_version !== expected) {
  console.error("row.corpus_version " + row.corpus_version);
  process.exit(1);
}
if (!row.evidence_store || row.evidence_store.producer !== "engine-qualify:foreman-test-seed") {
  console.error("producer " + (row.evidence_store && row.evidence_store.producer));
  process.exit(1);
}
const rec = buildV2Record(row, { originHostClass: "cloud-api" });
if (!rec) {
  console.error("buildV2Record returned null");
  process.exit(1);
}
if (rec.seat.corpus_version !== row.corpus_version) {
  console.error("seat.corpus_version " + rec.seat.corpus_version);
  process.exit(1);
}
const id = q.recordIdV1(rec.producer, rec.transcript_hash, rec.seat, rec.seat.corpus_version, rec.administered_at);
if (rec.record_id !== id) {
  console.error("record_id " + rec.record_id + " vs " + id);
  process.exit(1);
}
' "$REPO_ROOT" "$FM_ROW_OUT" "$FOREMAN_CORPUS"
assert_eq "$?" "0" "foreman test-mode row corpus_version matches the seat and recordIdV1"

# A real foreman run that returns no row must not gain a synthetic transcript.
# The CLI cannot reach that return without a live sitting: disk pins throw first.
# This stub replaces runForemanQualification so the headless path sees no row
# and no AUTOPILOT_QUALIFY_SEED, and must exit 3 with an empty stdout.
NO_ROW_STUB="$TEST_TMP/foreman-no-row-require.js"
cat >"$NO_ROW_STUB" <<'STUB'
const Module = require('module');
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  const exported = orig.apply(this, arguments);
  if (typeof id === 'string' && id.indexOf('foreman-eval-runner') !== -1 && exported && typeof exported === 'object') {
    exported.runForemanQualification = function () {
      return { qualified: false, verdict: { role: 'foreman', graded: false, evidence: null } };
    };
  }
  return exported;
};
STUB
NO_ROW_OUT="$TEST_TMP/foreman-no-row.out"
NO_ROW_ERR="$TEST_TMP/foreman-no-row.err"
unset AUTOPILOT_QUALIFY_SEED
set +e
node --require "$NO_ROW_STUB" "$REPO_ROOT/scripts/engine-qualify.js" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --panel-cmd true \
  --store "$TEST_TMP/store-foreman-no-row" --raw-dir "$TEST_TMP/raw-foreman-no-row" --emit-record \
  >"$NO_ROW_OUT" 2>"$NO_ROW_ERR"
NO_ROW_RC=$?
set -e
assert_exit_code "$NO_ROW_RC" "3" "non-test-mode foreman run without a row exits 3"
assert_eq "$(wc -c <"$NO_ROW_OUT" | tr -d ' ')" "0" "non-test-mode foreman run without a row prints nothing"
if grep -q 'foreman-test-seed' "$NO_ROW_OUT" "$NO_ROW_ERR"; then
  fail "non-test-mode foreman run wrote a test-seed row"
fi

# A mutated copy of a pinned foreman asset must exit 2 before any store write.
# The copy is the only tree that changes; the worktree evals stay as they are.
PIN_COPY="$TEST_TMP/foreman-pin-root"
mkdir -p "$PIN_COPY/evals"
for asset in foreman-eval-generator.js foreman-eval-grader.js foreman-capability-evidence-corpus.json foreman-harness-conformance.js foreman-asset-pins.json; do
  cp "$REPO_ROOT/evals/$asset" "$PIN_COPY/evals/$asset"
done
printf '\n' >>"$PIN_COPY/evals/foreman-eval-generator.js"
PINNED_GEN="$(node -e 'process.stdout.write(require(process.argv[1]).generator)' "$PIN_COPY/evals/foreman-asset-pins.json")"
COMPUTED_GEN="$(sha256sum "$PIN_COPY/evals/foreman-eval-generator.js" | awk '{print $1}')"
PIN_ST="$TEST_TMP/store-foreman-pin"
PIN_RW="$TEST_TMP/raw-foreman-pin"
mkdir -p "$PIN_ST" "$PIN_RW"
printf 'kept\n' >"$PIN_ST/marker"
printf 'kept\n' >"$PIN_RW/marker"
BEFORE_PIN_ST="$(dir_snapshot "$PIN_ST")"
BEFORE_PIN_RW="$(dir_snapshot "$PIN_RW")"
export AUTOPILOT_QUALIFY_SEED=foreman-headless-pin
export AUTOPILOT_FOREMAN_ASSET_ROOT="$PIN_COPY"
run_q "$TEST_TMP/foreman-pin.out" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --store "$PIN_ST" --raw-dir "$PIN_RW" --emit-record
unset AUTOPILOT_QUALIFY_SEED
unset AUTOPILOT_FOREMAN_ASSET_ROOT
assert_exit_code "$RUN_RC" "2" "mutated foreman pin asset exits 2"
assert_eq "$(wc -c <"$TEST_TMP/foreman-pin.out" | tr -d ' ')" "0" "foreman pin mismatch prints no record"
assert_contains "$(cat "$ERR")" "$PINNED_GEN" "foreman pin mismatch stderr names the pinned hash"
assert_contains "$(cat "$ERR")" "$COMPUTED_GEN" "foreman pin mismatch stderr names the computed hash"
assert_eq "$(dir_snapshot "$PIN_ST")" "$BEFORE_PIN_ST" "foreman pin mismatch leaves --store unchanged"
assert_eq "$(dir_snapshot "$PIN_RW")" "$BEFORE_PIN_RW" "foreman pin mismatch leaves --raw-dir unchanged"

# Non-test mode must refuse the asset-root seam before any sitting. A copy of
# the real pins would otherwise verify and the exam would run (exit 3).
REAL_COPY="$TEST_TMP/foreman-real-root"
mkdir -p "$REAL_COPY/evals"
for asset in foreman-eval-generator.js foreman-eval-grader.js foreman-capability-evidence-corpus.json foreman-harness-conformance.js foreman-asset-pins.json; do
  cp "$REPO_ROOT/evals/$asset" "$REAL_COPY/evals/$asset"
done
NTEST_ST="$TEST_TMP/store-foreman-asset-root"
NTEST_RW="$TEST_TMP/raw-foreman-asset-root"
mkdir -p "$NTEST_ST" "$NTEST_RW"
printf 'kept\n' >"$NTEST_ST/marker"
printf 'kept\n' >"$NTEST_RW/marker"
BEFORE_NTEST_ST="$(dir_snapshot "$NTEST_ST")"
BEFORE_NTEST_RW="$(dir_snapshot "$NTEST_RW")"
unset AUTOPILOT_QUALIFY_SEED
export AUTOPILOT_FOREMAN_ASSET_ROOT="$REAL_COPY"
run_q "$TEST_TMP/foreman-asset-root-nontest.out" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --panel-cmd true \
  --store "$NTEST_ST" --raw-dir "$NTEST_RW" --emit-record
unset AUTOPILOT_FOREMAN_ASSET_ROOT
assert_exit_code "$RUN_RC" "2" "non-test-mode AUTOPILOT_FOREMAN_ASSET_ROOT exits 2"
assert_eq "$(wc -c <"$TEST_TMP/foreman-asset-root-nontest.out" | tr -d ' ')" "0" "non-test-mode asset root prints no record"
assert_contains "$(cat "$ERR")" "AUTOPILOT_FOREMAN_ASSET_ROOT is limited to test mode" "non-test-mode asset root names the test-mode limit"
if grep -q 'foreman sitting start' "$ERR"; then
  fail "non-test-mode asset root started a sitting"
fi
assert_eq "$(dir_snapshot "$NTEST_ST")" "$BEFORE_NTEST_ST" "non-test-mode asset root leaves --store unchanged"
assert_eq "$(dir_snapshot "$NTEST_RW")" "$BEFORE_NTEST_RW" "non-test-mode asset root leaves --raw-dir unchanged"

# Missing and non-JSON pin files exit 2 from the verifier and name the file.
# Both use a temporary copy; the worktree evals stay as they are.
MISS_COPY="$TEST_TMP/foreman-missing-pin"
mkdir -p "$MISS_COPY/evals"
for asset in foreman-eval-generator.js foreman-eval-grader.js foreman-capability-evidence-corpus.json foreman-harness-conformance.js; do
  cp "$REPO_ROOT/evals/$asset" "$MISS_COPY/evals/$asset"
done
MISS_PIN="$MISS_COPY/evals/foreman-asset-pins.json"
MISS_ST="$TEST_TMP/store-foreman-missing-pin"
MISS_RW="$TEST_TMP/raw-foreman-missing-pin"
mkdir -p "$MISS_ST" "$MISS_RW"
printf 'kept\n' >"$MISS_ST/marker"
printf 'kept\n' >"$MISS_RW/marker"
BEFORE_MISS_ST="$(dir_snapshot "$MISS_ST")"
BEFORE_MISS_RW="$(dir_snapshot "$MISS_RW")"
export AUTOPILOT_QUALIFY_SEED=foreman-headless-missing-pin
export AUTOPILOT_FOREMAN_ASSET_ROOT="$MISS_COPY"
run_q "$TEST_TMP/foreman-missing-pin.out" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --store "$MISS_ST" --raw-dir "$MISS_RW" --emit-record
assert_exit_code "$RUN_RC" "2" "missing foreman pin file exits 2"
assert_eq "$(wc -c <"$TEST_TMP/foreman-missing-pin.out" | tr -d ' ')" "0" "missing foreman pin file prints no record"
assert_contains "$(cat "$ERR")" "foreman pin file unreadable or invalid JSON: $MISS_PIN" "missing foreman pin file names the path"
assert_eq "$(dir_snapshot "$MISS_ST")" "$BEFORE_MISS_ST" "missing foreman pin file leaves --store unchanged"
assert_eq "$(dir_snapshot "$MISS_RW")" "$BEFORE_MISS_RW" "missing foreman pin file leaves --raw-dir unchanged"

BAD_COPY="$TEST_TMP/foreman-bad-json-pin"
mkdir -p "$BAD_COPY/evals"
for asset in foreman-eval-generator.js foreman-eval-grader.js foreman-capability-evidence-corpus.json foreman-harness-conformance.js foreman-asset-pins.json; do
  cp "$REPO_ROOT/evals/$asset" "$BAD_COPY/evals/$asset"
done
BAD_PIN="$BAD_COPY/evals/foreman-asset-pins.json"
printf 'not-json\n' >"$BAD_PIN"
BAD_ST="$TEST_TMP/store-foreman-bad-json"
BAD_RW="$TEST_TMP/raw-foreman-bad-json"
mkdir -p "$BAD_ST" "$BAD_RW"
printf 'kept\n' >"$BAD_ST/marker"
printf 'kept\n' >"$BAD_RW/marker"
BEFORE_BAD_ST="$(dir_snapshot "$BAD_ST")"
BEFORE_BAD_RW="$(dir_snapshot "$BAD_RW")"
export AUTOPILOT_QUALIFY_SEED=foreman-headless-bad-json
export AUTOPILOT_FOREMAN_ASSET_ROOT="$BAD_COPY"
run_q "$TEST_TMP/foreman-bad-json.out" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --store "$BAD_ST" --raw-dir "$BAD_RW" --emit-record
unset AUTOPILOT_QUALIFY_SEED
unset AUTOPILOT_FOREMAN_ASSET_ROOT
assert_exit_code "$RUN_RC" "2" "non-JSON foreman pin file exits 2"
assert_eq "$(wc -c <"$TEST_TMP/foreman-bad-json.out" | tr -d ' ')" "0" "non-JSON foreman pin file prints no record"
assert_contains "$(cat "$ERR")" "foreman pin file unreadable or invalid JSON: $BAD_PIN" "non-JSON foreman pin file names the path"
assert_eq "$(dir_snapshot "$BAD_ST")" "$BEFORE_BAD_ST" "non-JSON foreman pin file leaves --store unchanged"
assert_eq "$(dir_snapshot "$BAD_RW")" "$BEFORE_BAD_RW" "non-JSON foreman pin file leaves --raw-dir unchanged"

# JSON null and [] are parsed values, not invalid JSON text. Both must still
# exit 2 from the verifier, name the pin file, and write nothing.
# RED at 3abca8f0b: JSON null and [] exit 2 as "qualification precondition failed" (null throws on index; [] mismatches a pin) instead of the unreadable-or-invalid-JSON message that names the pin path.
NULL_COPY="$TEST_TMP/foreman-null-pin"
mkdir -p "$NULL_COPY/evals"
for asset in foreman-eval-generator.js foreman-eval-grader.js foreman-capability-evidence-corpus.json foreman-harness-conformance.js foreman-asset-pins.json; do
  cp "$REPO_ROOT/evals/$asset" "$NULL_COPY/evals/$asset"
done
NULL_PIN="$NULL_COPY/evals/foreman-asset-pins.json"
printf 'null\n' >"$NULL_PIN"
NULL_ST="$TEST_TMP/store-foreman-null-pin"
NULL_RW="$TEST_TMP/raw-foreman-null-pin"
mkdir -p "$NULL_ST" "$NULL_RW"
printf 'kept\n' >"$NULL_ST/marker"
printf 'kept\n' >"$NULL_RW/marker"
BEFORE_NULL_ST="$(dir_snapshot "$NULL_ST")"
BEFORE_NULL_RW="$(dir_snapshot "$NULL_RW")"
export AUTOPILOT_QUALIFY_SEED=foreman-headless-null-pin
export AUTOPILOT_FOREMAN_ASSET_ROOT="$NULL_COPY"
run_q "$TEST_TMP/foreman-null-pin.out" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --store "$NULL_ST" --raw-dir "$NULL_RW" --emit-record
unset AUTOPILOT_QUALIFY_SEED
unset AUTOPILOT_FOREMAN_ASSET_ROOT
assert_exit_code "$RUN_RC" "2" "JSON null foreman pin file exits 2"
assert_eq "$(wc -c <"$TEST_TMP/foreman-null-pin.out" | tr -d ' ')" "0" "JSON null foreman pin file prints no record"
assert_contains "$(cat "$ERR")" "foreman pin file unreadable or invalid JSON: $NULL_PIN" "JSON null foreman pin file names the path"
assert_eq "$(dir_snapshot "$NULL_ST")" "$BEFORE_NULL_ST" "JSON null foreman pin file leaves --store unchanged"
assert_eq "$(dir_snapshot "$NULL_RW")" "$BEFORE_NULL_RW" "JSON null foreman pin file leaves --raw-dir unchanged"

ARR_COPY="$TEST_TMP/foreman-array-pin"
mkdir -p "$ARR_COPY/evals"
for asset in foreman-eval-generator.js foreman-eval-grader.js foreman-capability-evidence-corpus.json foreman-harness-conformance.js foreman-asset-pins.json; do
  cp "$REPO_ROOT/evals/$asset" "$ARR_COPY/evals/$asset"
done
ARR_PIN="$ARR_COPY/evals/foreman-asset-pins.json"
printf '[]\n' >"$ARR_PIN"
ARR_ST="$TEST_TMP/store-foreman-array-pin"
ARR_RW="$TEST_TMP/raw-foreman-array-pin"
mkdir -p "$ARR_ST" "$ARR_RW"
printf 'kept\n' >"$ARR_ST/marker"
printf 'kept\n' >"$ARR_RW/marker"
BEFORE_ARR_ST="$(dir_snapshot "$ARR_ST")"
BEFORE_ARR_RW="$(dir_snapshot "$ARR_RW")"
export AUTOPILOT_QUALIFY_SEED=foreman-headless-array-pin
export AUTOPILOT_FOREMAN_ASSET_ROOT="$ARR_COPY"
run_q "$TEST_TMP/foreman-array-pin.out" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --store "$ARR_ST" --raw-dir "$ARR_RW" --emit-record
unset AUTOPILOT_QUALIFY_SEED
unset AUTOPILOT_FOREMAN_ASSET_ROOT
assert_exit_code "$RUN_RC" "2" "JSON array foreman pin file exits 2"
assert_eq "$(wc -c <"$TEST_TMP/foreman-array-pin.out" | tr -d ' ')" "0" "JSON array foreman pin file prints no record"
assert_contains "$(cat "$ERR")" "foreman pin file unreadable or invalid JSON: $ARR_PIN" "JSON array foreman pin file names the path"
assert_eq "$(dir_snapshot "$ARR_ST")" "$BEFORE_ARR_ST" "JSON array foreman pin file leaves --store unchanged"
assert_eq "$(dir_snapshot "$ARR_RW")" "$BEFORE_ARR_RW" "JSON array foreman pin file leaves --raw-dir unchanged"

# A live row that already carries corpus_version must not be overwritten.
# The stub is the only way the CLI returns a row; the real runner does not.
ROW_STUB="$TEST_TMP/foreman-row-require.js"
cat >"$ROW_STUB" <<'STUB'
const Module = require('module');
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  const exported = orig.apply(this, arguments);
  if (typeof id === 'string' && id.indexOf('foreman-eval-runner') !== -1 && exported && typeof exported === 'object') {
    exported.runForemanQualification = function () {
      return {
        qualified: false,
        verdict: { role: 'foreman', graded: false, evidence: null },
        row: { corpus_version: 'live-row-corpus', engine: 'e' },
      };
    };
  }
  return exported;
};
STUB
ROW_ST="$TEST_TMP/store-foreman-row"
ROW_RW="$TEST_TMP/raw-foreman-row"
mkdir -p "$ROW_ST" "$ROW_RW"
printf 'kept\n' >"$ROW_ST/marker"
printf 'kept\n' >"$ROW_RW/marker"
BEFORE_ROW_ST="$(dir_snapshot "$ROW_ST")"
BEFORE_ROW_RW="$(dir_snapshot "$ROW_RW")"
unset AUTOPILOT_QUALIFY_SEED
unset AUTOPILOT_FOREMAN_ASSET_ROOT
set +e
node --require "$ROW_STUB" "$REPO_ROOT/scripts/engine-qualify.js" foreman --seat-file "$FM_SEAT" \
  --runner-version 1.0.0 --family openai --harness-version reviewer-harness-v2 \
  --semantic-fingerprint "$HASH_B" --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  --panel-cmd true \
  --store "$ROW_ST" --raw-dir "$ROW_RW" --emit-record \
  >"$TEST_TMP/foreman-row.out" 2>"$ERR"
ROW_RC=$?
set -e
assert_exit_code "$ROW_RC" "2" "live row corpus_version mismatch exits 2"
assert_contains "$(cat "$ERR")" "live-row-corpus" "live row mismatch names the row corpus_version"
assert_contains "$(cat "$ERR")" "$FOREMAN_CORPUS" "live row mismatch names the exam corpus_version"
assert_eq "$(wc -c <"$TEST_TMP/foreman-row.out" | tr -d ' ')" "0" "live row mismatch prints no record"
assert_eq "$(dir_snapshot "$ROW_ST")" "$BEFORE_ROW_ST" "live row mismatch leaves --store unchanged"
assert_eq "$(dir_snapshot "$ROW_RW")" "$BEFORE_ROW_RW" "live row mismatch leaves --raw-dir unchanged"

# The same throw without --seat-file/--emit-record stays exit 2.
run_q "$TEST_TMP/consult-bare-throw.out" consult \
  --engine eng-review --model eng-review-exact --model-version 2026-07-26 \
  --runner cc-shim --runner-version 1.0.0 --family openai \
  --harness-version reviewer-harness-v2 --effort high \
  --prompt-config-hash "$HASH_A" --semantic-fingerprint "$HASH_B" \
  --containment-fingerprint "$HASH_C" \
  --task-class code_review --domain repository --language en --tool diff_read \
  "${PANEL_BINDS[@]}" --panel-cmd "$PASS_PANEL"
assert_exit_code "$RUN_RC" "2" "non-headless consult throw still exits 2"

finalize_test
