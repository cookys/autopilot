#!/usr/bin/env bash
# hooks/tests/skill-onoff-gdorm.test.sh — gdorm instrument (stub runner only).
# Markers come from Bash tool calls and cell artefacts, never from the agent's words.
# RED-first: run once against the unmodified tree before the gdorm row existed.
# RED at 3ec639777: FAIL: tree cell exit 2 (arm manifest arms/gdorm/base.json not found).
set -uo pipefail
. "$(dirname "$0")/lib.sh"
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
case "$HOME" in
  "$TEST_TMP"/*) ;;
  *) echo "FAIL: HOME is not under TEST_TMP: $HOME" >&2; exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
fail() { echo "FAIL: $*" >&2; exit 1; }

cell() { # $1 outdir, remaining args to run-skill-onoff-eval.sh
  local out="$1"
  shift
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$HOME" \
    bash "$BASE/run-skill-onoff-eval.sh" "$@" --out "$out" < /dev/null > "$out.stdout"
}

# Positive: the stub really executes the script, then records a Bash tool_use.
echo "=== positive: each script run makes its marker true ==="
TREE_STUB="$TEST_TMP/stub-tree.sh"
cat > "$TREE_STUB" << 'EOS'
#!/usr/bin/env bash
printf '%s\n' '{"type":"system","subtype":"init","session_id":"gdorm-tree"}'
node scripts/tree.js init gdormproj
printf '%s\n' '{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node scripts/tree.js init gdormproj"}}]}}'
printf '%s\n' '{"type":"result","is_error":false}'
EOS
chmod +x "$TREE_STUB"
OUTT="$TEST_TMP/out-tree"
ONOFF_STUB_BIN="$TREE_STUB" ONOFF_LIB_OVERRIDE="$BASE/lib-gdorm" \
  cell "$OUTT" --task gdorm-tree --arm-manifest "$BASE/arms/gdorm/base.json" --model sonnet --runner stub --rep 1 \
  || fail "tree cell exit $?"
python3 - "$OUTT/result.json" << 'PY' || fail "t_tree_run"
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("failure_class") not in (None,): raise SystemExit(r.get("failure_cause"))
if r["markers"].get("t_tree_run") is not True: raise SystemExit(r["markers"])
PY

QC_STUB="$TEST_TMP/stub-qc.sh"
cat > "$QC_STUB" << 'EOS'
#!/usr/bin/env bash
printf '%s\n' '{"type":"system","subtype":"init","session_id":"gdorm-qc"}'
node scripts/qc-panel.js --report docs/projects/gdorm-sample/tree/nodes/root/report.json --proj gdorm-sample --node root >/dev/null 2>&1 || true
printf '%s\n' '{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node scripts/qc-panel.js --report docs/projects/gdorm-sample/tree/nodes/root/report.json --proj gdorm-sample --node root"}}]}}'
printf '%s\n' '{"type":"result","is_error":false}'
EOS
chmod +x "$QC_STUB"
OUTQ="$TEST_TMP/out-qc"
ONOFF_STUB_BIN="$QC_STUB" ONOFF_LIB_OVERRIDE="$BASE/lib-gdorm" \
  cell "$OUTQ" --task gdorm-qcpanel --arm-manifest "$BASE/arms/gdorm/base.json" --model sonnet --runner stub --rep 1 \
  || fail "qc cell exit $?"
python3 - "$OUTQ/result.json" << 'PY' || fail "q_qcpanel_run"
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("failure_class") not in (None,): raise SystemExit(r.get("failure_cause"))
if r["markers"].get("q_qcpanel_run") is not True: raise SystemExit(r["markers"])
PY

ARCH_STUB="$TEST_TMP/stub-arch.sh"
cat > "$ARCH_STUB" << 'EOS'
#!/usr/bin/env bash
printf '%s\n' '{"type":"system","subtype":"init","session_id":"gdorm-arch"}'
node scripts/review-ledger-archive.js import --ledger reviews/ledger-last-week --repo .
printf '%s\n' '{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node scripts/review-ledger-archive.js import --ledger reviews/ledger-last-week --repo ."}}]}}'
printf '%s\n' '{"type":"result","is_error":false}'
EOS
chmod +x "$ARCH_STUB"
OUTA="$TEST_TMP/out-arch"
ONOFF_STUB_BIN="$ARCH_STUB" ONOFF_LIB_OVERRIDE="$BASE/lib-gdorm" \
  cell "$OUTA" --task gdorm-archive --arm-manifest "$BASE/arms/gdorm/base.json" --model sonnet --runner stub --rep 1 \
  || fail "archive cell exit $?"
python3 - "$OUTA/result.json" << 'PY' || fail "archive both true"
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("failure_class") not in (None,): raise SystemExit(r.get("failure_cause"))
m=r["markers"]
if m.get("r_archive_import") is not True or m.get("r_archive_file") is not True: raise SystemExit(m)
PY

echo "=== negative A: no script run => every marker false ==="
QUIET="$TEST_TMP/stub-quiet.sh"
printf '%s\n' '#!/bin/sh' 'printf "%s\n" "{\"type\":\"result\",\"is_error\":false}"' > "$QUIET"
chmod +x "$QUIET"
for task in gdorm-tree gdorm-qcpanel gdorm-archive; do
  out="$TEST_TMP/out-quiet-$task"
  ONOFF_STUB_BIN="$QUIET" ONOFF_LIB_OVERRIDE="$BASE/lib-gdorm" \
    cell "$out" --task "$task" --arm-manifest "$BASE/arms/gdorm/base.json" --model sonnet --runner stub --rep 1 \
    || fail "quiet $task exit $?"
  python3 - "$out/result.json" "$task" << 'PY' || fail "quiet markers $task"
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("failure_class") not in (None,): raise SystemExit(r.get("failure_cause"))
if not r["markers"]: raise SystemExit("no markers")
bad=[k for k,v in r["markers"].items() if v is not False]
if bad: raise SystemExit(bad)
PY
done

echo "=== negative B: words without a Bash tool call => every marker false ==="
SAY="$TEST_TMP/stub-say.sh"
cat > "$SAY" << 'EOS'
#!/usr/bin/env bash
printf '%s\n' '{"type":"result","is_error":false,"result":"I will run node scripts/tree.js init gdormproj, then node scripts/qc-panel.js, then node scripts/review-ledger-archive.js import --ledger reviews/ledger-last-week."}'
EOS
chmod +x "$SAY"
for task in gdorm-tree gdorm-qcpanel gdorm-archive; do
  out="$TEST_TMP/out-say-$task"
  ONOFF_STUB_BIN="$SAY" ONOFF_LIB_OVERRIDE="$BASE/lib-gdorm" \
    cell "$out" --task "$task" --arm-manifest "$BASE/arms/gdorm/base.json" --model sonnet --runner stub --rep 1 \
    || fail "say $task exit $?"
  python3 - "$out/result.json" << 'PY' || fail "say markers"
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("failure_class") not in (None,): raise SystemExit(r.get("failure_cause"))
bad=[k for k,v in r["markers"].items() if v is not False]
if bad: raise SystemExit(r["markers"])
PY
done

echo "=== archive fields are independent ==="
IMPORT_ONLY="$TEST_TMP/stub-import-only.sh"
cat > "$IMPORT_ONLY" << 'EOS'
#!/usr/bin/env bash
printf '%s\n' '{"type":"system","subtype":"init","session_id":"gdorm-import-only"}'
printf '%s\n' '{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node scripts/review-ledger-archive.js import --ledger reviews/ledger-last-week --repo ."}}]}}'
printf '%s\n' '{"type":"result","is_error":false}'
EOS
chmod +x "$IMPORT_ONLY"
OUTI="$TEST_TMP/out-import-only"
ONOFF_STUB_BIN="$IMPORT_ONLY" ONOFF_LIB_OVERRIDE="$BASE/lib-gdorm" \
  cell "$OUTI" --task gdorm-archive --arm-manifest "$BASE/arms/gdorm/base.json" --model sonnet --runner stub --rep 1 \
  || fail "import-only cell exit $?"
python3 - "$OUTI/result.json" << 'PY' || fail "import true file false"
import json,sys
m=json.load(open(sys.argv[1]))["markers"]
if m.get("r_archive_import") is not True or m.get("r_archive_file") is not False: raise SystemExit(m)
PY

FILE_ONLY="$TEST_TMP/stub-file-only.sh"
cat > "$FILE_ONLY" << 'EOS'
#!/usr/bin/env bash
printf '%s\n' '{"type":"system","subtype":"init","session_id":"gdorm-file-only"}'
node << 'JS'
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.autopilot', 'config.json'), 'utf8'));
const dir = cfg.review_ledger_archive.dir;
fs.mkdirSync(path.join(dir, 'planted-ledger'), { recursive: true });
fs.writeFileSync(path.join(dir, 'planted-ledger', 'chain.json'), '[{"generation":1}]\n');
JS
printf '%s\n' '{"type":"result","is_error":false,"result":"The ledger is already stored."}'
EOS
chmod +x "$FILE_ONLY"
OUTF="$TEST_TMP/out-file-only"
ONOFF_STUB_BIN="$FILE_ONLY" ONOFF_LIB_OVERRIDE="$BASE/lib-gdorm" \
  cell "$OUTF" --task gdorm-archive --arm-manifest "$BASE/arms/gdorm/base.json" --model sonnet --runner stub --rep 1 \
  || fail "file-only cell exit $?"
python3 - "$OUTF/result.json" << 'PY' || fail "import false file true"
import json,sys
m=json.load(open(sys.argv[1]))["markers"]
if m.get("r_archive_import") is not False or m.get("r_archive_file") is not True: raise SystemExit(m)
PY

echo "=== campaign dry-run and check-arms ==="
RES="$TEST_TMP/gdorm-results.jsonl"
dry=$(node "$BASE/run-gdorm-campaign.js" --results "$RES" --dry-run) || fail "dry-run exit $?"
printf '%s\n' "$dry" | grep -q 'cells_total' || fail "dry-run did not print a cell count: $dry"
python3 -c 'import json,sys
text=sys.argv[1]
line=[l for l in text.splitlines() if l.startswith("{")][-1]
j=json.loads(line)
assert j["dry_run"] is True
assert isinstance(j["cells_total"], int) and j["cells_total"] > 0
assert j["cost_estimate_usd"] <= 7
' "$dry" || fail "dry-run cost: $dry"
chk=$(node "$BASE/run-gdorm-campaign.js" --check-arms) || fail "check-arms exit $?"
python3 -c 'import json,sys; r=json.loads(sys.argv[1]); assert r["ok"] is True' "$chk" || fail "check-arms body: $chk"

echo "gdorm stub tests passed"
