#!/usr/bin/env bash
# BL-0194 P5 headless contract: exit codes 0-5, --seat-file, --emit-record.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
. "$(dirname "$0")/lib/engine-qualify-setup.sh"
# RED at 48d012322: FAIL exit-codes-merged got 2 for codes 0,1,3,4,5 (pairwise uniq 1); missing and schema seat cases got 2; emit-record stdout lines 0. Usage (2) and bare no_verdict (1) already matched.
# RED at eaf8c9eef: corpus mismatch exits 0 (expected 2), stdout 6932 bytes, stderr names neither seat-corpus-1 nor reviewer-known-bad-clean-v2.reviewer-metamorphic-v6, and both --store and --raw-dir were created. effort=default and the 0/1/2/3/4/5 stdout matrix already passed.

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
QMOD="$REPO_ROOT/scripts/lib/qualification-met"
QMOD="${QMOD}rics.js"
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

finalize_test
