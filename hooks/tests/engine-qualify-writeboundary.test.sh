#!/usr/bin/env bash
# BL-0194 P5 write boundary: a headless exam may change only --store and --raw-dir.
# Negative controls (stray file, outbox line) pass only when the checker reports a violation.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export TMPDIR="$TEST_TMP/scratch-tmp"
mkdir -p "$TMPDIR"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_STRIKE_WRITER=off
REAL_HOME="$(getent passwd "$(id -u)" | awk -F: '{print $6}')"
REAL_AUTOPILOT="$REAL_HOME/.autopilot"
REAL_CLAUDE="$REAL_HOME/.claude"
REAL_RUN_AUTOPILOT="/run/user/$(id -u)/autopilot"

SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
. "$(dirname "$0")/lib/engine-qualify-setup.sh"

STORE="$TEST_TMP/wb-store"
RAW="$TEST_TMP/wb-raw"
SEAT="$TEST_TMP/seat.json"
SNAP_DIR="$TEST_TMP/snaps"
mkdir -p "$SNAP_DIR"

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

# Roots a headless exam could plausibly touch besides the two allowed directories.
WATCH_ROOTS=(
  "$HOME"
  "$XDG_RUNTIME_DIR"
  "$TMPDIR"
  "$CLAUDE_CONFIG_DIR"
  "$ENGINE_CAPABILITY_DIR"
  "$ENGINE_SCORECARD_DIR"
)
if [[ -n "${AUTOPILOT_LIVE_DIR:-}" ]]; then
  WATCH_ROOTS+=("$AUTOPILOT_LIVE_DIR")
fi

# fs_snapshot <outfile> — path, size, mtime, content hash of every regular file under the watch roots.
fs_snapshot() {
  local out="$1"
  python3 - "$out" "${WATCH_ROOTS[@]}" <<'PY'
import hashlib, os, stat, sys
out = sys.argv[1]
rows = []
for root in sys.argv[2:]:
    if not os.path.isdir(root):
        continue
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
        for name in filenames:
            path = os.path.join(dirpath, name)
            if os.path.islink(path):
                continue
            st = os.lstat(path)
            if not stat.S_ISREG(st.st_mode):
                continue
            digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
            rows.append(f"{path}\t{st.st_size}\t{int(st.st_mtime)}\t{digest}")
rows.sort()
with open(out, "w", encoding="utf-8") as fh:
    if rows:
        fh.write("\n".join(rows) + "\n")
PY
}

# boundary_violations <before> <after> <allowed-dir>...
# Prints one absolute path per added, removed, or changed file outside the allowed dirs.
boundary_violations() {
  python3 - "$@" <<'PY'
import sys
before_path, after_path = sys.argv[1], sys.argv[2]
allowed = [p.rstrip("/") for p in sys.argv[3:]]

def load(path):
    rows = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            file_path, rest = line.split("\t", 1)
            rows[file_path] = rest
    return rows

def inside(path):
    for prefix in allowed:
        if path == prefix or path.startswith(prefix + "/"):
            return True
    return False

before, after = load(before_path), load(after_path)
for path in sorted(set(before) | set(after)):
    if inside(path):
        continue
    if before.get(path) != after.get(path):
        print(path)
PY
}

assert_violations_include() {
  local violations="$1"
  local needle="$2"
  local msg="$3"
  if [[ -z "$violations" ]]; then
    fail "$msg: checker reported no violation"
  fi
  if ! printf '%s\n' "$violations" | grep -F -q -- "$needle"; then
    fail "$msg: checker missed $needle (got: $violations)"
  fi
}

# --- negative control: stray file outside the allowed dirs ---
BEFORE="$SNAP_DIR/stray-before"
AFTER="$SNAP_DIR/stray-after"
fs_snapshot "$BEFORE"
STRAY="$HOME/stray-outside.txt"
printf 'injected stray\n' >"$STRAY"
fs_snapshot "$AFTER"
STRAY_VIOLATIONS="$(boundary_violations "$BEFORE" "$AFTER" "$STORE" "$RAW")"
assert_violations_include "$STRAY_VIOLATIONS" "$STRAY" "write-outside-allowed-dirs stray file"
rm -f "$STRAY"

# --- negative control: outbox line under HOME/.autopilot ---
BEFORE="$SNAP_DIR/outbox-before"
AFTER="$SNAP_DIR/outbox-after"
fs_snapshot "$BEFORE"
OUTBOX_DIR="$HOME/.autopilot/qualification-outbox"
mkdir -p "$OUTBOX_DIR"
OUTBOX="$OUTBOX_DIR/outbox.jsonl"
printf '%s\n' '{"event":"enqueued"}' >>"$OUTBOX"
fs_snapshot "$AFTER"
OUTBOX_VIOLATIONS="$(boundary_violations "$BEFORE" "$AFTER" "$STORE" "$RAW")"
assert_violations_include "$OUTBOX_VIOLATIONS" "$OUTBOX" "write-outside-allowed-dirs outbox line"
rm -rf "$HOME/.autopilot"

# --- confined headless exam ---
BEFORE="$SNAP_DIR/exam-before"
AFTER="$SNAP_DIR/exam-after"
TRACE="$SNAP_DIR/exam.strace"
OUT="$SNAP_DIR/exam.out"
ERR="$SNAP_DIR/exam.err"
fs_snapshot "$BEFORE"
set +e
if command -v strace >/dev/null 2>&1; then
  strace -f -o "$TRACE" -e trace=file \
    "$SCRIPT" "${SEAT_ARGS[@]}" --panel-cmd "$PASS_PANEL" \
    --store "$STORE" --raw-dir "$RAW" --emit-record \
    >"$OUT" 2>"$ERR"
  EXAM_RC=$?
  STRACE_RAN=1
else
  echo "SKIP strace is not installed"
  "$SCRIPT" "${SEAT_ARGS[@]}" --panel-cmd "$PASS_PANEL" \
    --store "$STORE" --raw-dir "$RAW" --emit-record \
    >"$OUT" 2>"$ERR"
  EXAM_RC=$?
  STRACE_RAN=0
fi
set -e
fs_snapshot "$AFTER"
EXAM_VIOLATIONS="$(boundary_violations "$BEFORE" "$AFTER" "$STORE" "$RAW")"
if [[ -n "$EXAM_VIOLATIONS" ]]; then
  fail "confined headless exam changed files outside --store and --raw-dir: $EXAM_VIOLATIONS"
fi
assert_exit_code "$EXAM_RC" "0" "confined headless exam passed"
if [[ -d "$HOME/.autopilot" ]]; then
  fail "temp HOME has .autopilot after the confined exam"
fi
if [[ "$STRACE_RAN" == 1 ]]; then
  if [[ ! -s "$TRACE" ]]; then
    fail "process-level trace is empty"
  fi
  for forbidden in "$REAL_AUTOPILOT" "$REAL_CLAUDE" "$REAL_RUN_AUTOPILOT"; do
    if grep -F -q -- "$forbidden" "$TRACE"; then
      fail "process referenced $forbidden"
    fi
  done
fi

# --- ingest compatibility (llm-playground). Skip when the importer is absent. ---
INGEST="${LLM_PLAYGROUND_DIR:-$HOME/projects/llm-playground}/scripts/eval/ingest-qualification-record.py"
if [[ ! -f "$INGEST" ]]; then
  echo "SKIP ingest-qualification-record.py does not exist"
else
  # RED at e32bb974: second import asserted as creating a second file — FAIL second import still exactly one file: expected '2', got '1' (exit 1). A planted extra json under the workspace makes count_json != 1, which is the import-duplicate-record violation. A record_id of 64 zeroes or a record with transcript_hash deleted is rejected (exit 3) and the file count stays put; expecting exit 0 there is the record-id-mismatch red.
  QUAL_ROOT="$TEST_TMP/qual-root"
  WS="$QUAL_ROOT/ws"
  mkdir -p "$QUAL_ROOT"
  REC="$SNAP_DIR/record.json"
  python3 -c 'import pathlib,sys; p=pathlib.Path(sys.argv[1]).read_text().strip().splitlines();
assert len(p)==1, p; pathlib.Path(sys.argv[2]).write_text(p[0]+"\n")' "$OUT" "$REC"

  count_json() {
    find "$WS" -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' '
  }

  run_ingest() {
    local payload="$1"
    set +e
    python3 "$INGEST" --kind record --root "$QUAL_ROOT" --workspace ws "$payload" >"$SNAP_DIR/ingest.out" 2>"$SNAP_DIR/ingest.err"
    INGEST_RC=$?
    set -e
  }

  run_ingest "$REC"
  assert_exit_code "$INGEST_RC" "0" "first import of emit-record"
  assert_eq "$(count_json)" "1" "first import creates one file"

  run_ingest "$REC"
  assert_exit_code "$INGEST_RC" "0" "second import of the same record is a no-op"
  assert_eq "$(count_json)" "1" "second import still exactly one file"

  # import-duplicate-record control: a second file for the same record_id is what the checker rejects.
  python3 - "$REC" "$WS" <<'PY'
import json, pathlib, sys
rec = json.loads(pathlib.Path(sys.argv[1]).read_text())
ws = pathlib.Path(sys.argv[2])
existing = list(ws.glob("*.json"))
assert len(existing) == 1
planted = ws / ("planted-" + existing[0].name)
planted.write_text(existing[0].read_text())
assert len(list(ws.glob("*.json"))) == 2
PY
  DUP_COUNT="$(count_json)"
  if [[ "$DUP_COUNT" == "1" ]]; then
    fail "import-duplicate-record control did not plant a second file"
  fi
  rm -f "$WS"/planted-*.json
  assert_eq "$(count_json)" "1" "import-duplicate-record control removed the planted file"

  COLLIDE="$SNAP_DIR/collide.json"
  node -e '
const fs = require("fs");
const q = require(process.argv[1]);
const rec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
rec.transcript_hash = "ab".repeat(32);
rec.record_id = q.recordIdV1(rec.producer, rec.transcript_hash, rec.seat, rec.seat.corpus_version, rec.administered_at);
fs.writeFileSync(process.argv[3], JSON.stringify(rec) + "\n");
' "$REPO_ROOT/scripts/lib/qualification-metrics.js" "$REC" "$COLLIDE"
  BEFORE_N="$(count_json)"
  run_ingest "$COLLIDE"
  assert_exit_code "$INGEST_RC" "3" "secondary-key-collision exits 3"
  grep -q 'SECONDARY_KEY_COLLISION' "$SNAP_DIR/ingest.out"
  assert_eq "$(count_json)" "$BEFORE_N" "secondary-key-collision writes nothing"

  BAD_ID="$SNAP_DIR/bad-id.json"
  node -e '
const fs = require("fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
rec.record_id = "0".repeat(64);
fs.writeFileSync(process.argv[2], JSON.stringify(rec) + "\n");
' "$REC" "$BAD_ID"
  BEFORE_N="$(count_json)"
  run_ingest "$BAD_ID"
  assert_exit_code "$INGEST_RC" "3" "record_id that is not recordIdV1 is rejected"
  assert_eq "$(count_json)" "$BEFORE_N" "bad record_id writes nothing"

  NO_HASH="$SNAP_DIR/no-hash.json"
  node -e '
const fs = require("fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
delete rec.transcript_hash;
fs.writeFileSync(process.argv[2], JSON.stringify(rec) + "\n");
' "$REC" "$NO_HASH"
  BEFORE_N="$(count_json)"
  run_ingest "$NO_HASH"
  assert_exit_code "$INGEST_RC" "3" "record lacking transcript_hash is rejected"
  assert_eq "$(count_json)" "$BEFORE_N" "missing transcript_hash writes nothing"
fi

finalize_test
