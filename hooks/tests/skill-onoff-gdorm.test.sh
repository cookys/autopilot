#!/usr/bin/env bash
# hooks/tests/skill-onoff-gdorm.test.sh — gdorm instrument (stub runner only).
# Markers come from Bash tool calls and cell artefacts, never from the agent's words.
# RED-first: run once against the unmodified tree before the gdorm row existed.
# RED at 3ec639777: FAIL: tree cell exit 2 (arm manifest arms/gdorm/base.json not found).
# RED at 03aa140b0: default dry-run is 60 cells at 6.60 USD (not 30); ONOFF_MAX_USD=5 dry-run exits 0; mutated ceo-agent pack --check-arms exits 0; score-gdorm.js is missing; stamp --check exits 2 (arm_manifests.change has no file).
# RED at 0dd539888: cat scripts/qc-panel.js makes q_qcpanel_run true (test exit 1). Same loose match would accept head, grep -n, ls, and cat scripts/review-ledger-archive.js | grep import. Scorer rows.find keeps the first row: timeout-then-success is "FAIL (infra failure blocks PASS: 1 cell(s))" exit 3; a later runner_timeout with an earlier null row is a content FAIL, not infra.
# RED at 8e500bd57: cat > run.sh << 'EOF' / node scripts/tree.js / EOF makes t_tree_run true (test exit 1). Heredoc body lines are split as commands.
# RED at c146eca31: cat <<'EOF' > run.sh / node scripts/tree.js / EOF makes t_tree_run true (test exit 1). The opener is anchored at the end of the segment, so a redirect, append, comment, leading-tab dash closer, or a second heredoc on the same line leaves the body classified as a command.
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

cell() { # $1 outdir, remaining args to run-skill-onoff-eval-gdorm.sh
  local out="$1"
  shift
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$HOME" \
    bash "$BASE/run-skill-onoff-eval-gdorm.sh" "$@" --out "$out" < /dev/null > "$out.stdout"
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

echo "=== reading a script is not executing it ==="
# Direct transcript fixtures. A Bash tool_use whose command only reads the
# script must leave the marker false; an execution-shaped command must set it.
MARKCWD="$TEST_TMP/markcwd"
mkdir -p "$MARKCWD"
write_tx() { # $1 command → jsonl path
  local f="$TEST_TMP/tx-$RANDOM-$$.jsonl"
  python3 - "$f" "$1" << 'PY'
import json, sys
ev = {"message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": sys.argv[2]}}]}}
open(sys.argv[1], "w").write(json.dumps(ev) + "\n")
PY
  printf '%s\n' "$f"
}
mark_of() { # $1 task $2 transcript $3 marker name → prints true|false
  local task="$1" tx="$2" name="$3" out
  out=$(
    cd "$MARKCWD" && \
    env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
      HOME="$HOME" TRANSCRIPT="$tx" QUERY="$BASE/lib/transcript-query.js" \
      ONOFF_LIB="$BASE/lib-gdorm" ONOFF_OUT="$TEST_TMP/no-such-out" \
      ONOFF_CELL_HOME="$TEST_TMP/no-such-home" \
      bash "$BASE/tasks/$task/markers.sh" < /dev/null
  ) || fail "markers.sh $task exited $?"
  printf '%s\n' "$out" | sed -n "s/^marker_${name}=//p"
}
expect_mark() { # $1 task $2 command $3 marker $4 true|false
  local got
  got=$(mark_of "$1" "$(write_tx "$2")" "$3")
  [ "$got" = "$4" ] || fail "marker $3 for [$2]: got ${got:-<empty>} want $4"
}
expect_mark gdorm-qcpanel 'cat scripts/qc-panel.js' q_qcpanel_run false
expect_mark gdorm-qcpanel 'head scripts/qc-panel.js' q_qcpanel_run false
expect_mark gdorm-qcpanel 'ls scripts/qc-panel.js' q_qcpanel_run false
expect_mark gdorm-qcpanel 'grep -n run scripts/qc-panel.js' q_qcpanel_run false
expect_mark gdorm-qcpanel 'node scripts/qc-panel.js run' q_qcpanel_run true
expect_mark gdorm-tree 'cat scripts/tree.js' t_tree_run false
expect_mark gdorm-tree 'grep -n x scripts/tree.js' t_tree_run false
expect_mark gdorm-tree 'head scripts/tree.js' t_tree_run false
expect_mark gdorm-tree 'ls scripts/tree.js' t_tree_run false
expect_mark gdorm-tree 'node scripts/tree.js init' t_tree_run true
expect_mark gdorm-archive 'cat scripts/review-ledger-archive.js | grep import' r_archive_import false
expect_mark gdorm-archive 'head scripts/review-ledger-archive.js | grep import' r_archive_import false
expect_mark gdorm-archive 'grep -n import scripts/review-ledger-archive.js' r_archive_import false
expect_mark gdorm-archive 'ls scripts/review-ledger-archive.js' r_archive_import false
expect_mark gdorm-archive 'node scripts/review-ledger-archive.js import' r_archive_import true

echo "=== a heredoc body is not an executed command ==="
# The body is source text being written. A real command after the closing
# delimiter still counts. bash run.sh after the heredoc is a known conservative
# undercount: run.sh does not contain the tracked script path.
heredoc_cmd() { # lines... → one command string
  printf '%s\n' "$@"
}
expect_mark gdorm-tree "$(heredoc_cmd "cat > run.sh << 'EOF'" "node scripts/tree.js" "EOF")" t_tree_run false
expect_mark gdorm-tree "$(heredoc_cmd "cat > run.sh << 'EOF'" "node scripts/tree.js" "EOF" "node scripts/tree.js")" t_tree_run true
expect_mark gdorm-qcpanel "$(heredoc_cmd "cat > run.sh << EOF" "node scripts/qc-panel.js" "EOF")" q_qcpanel_run false
expect_mark gdorm-qcpanel "$(heredoc_cmd "cat > run.sh << EOF" "node scripts/qc-panel.js" "EOF" "node scripts/qc-panel.js")" q_qcpanel_run true
expect_mark gdorm-archive "$(heredoc_cmd "tee x << 'EOF'" "node scripts/review-ledger-archive.js import" "EOF")" r_archive_import false
expect_mark gdorm-archive "$(heredoc_cmd "tee x << 'EOF'" "node scripts/review-ledger-archive.js import" "EOF" "node scripts/review-ledger-archive.js import")" r_archive_import true
expect_mark gdorm-tree "$(heredoc_cmd "cat > run.sh << 'EOF'" "node scripts/tree.js" "EOF" "bash run.sh")" t_tree_run false

echo "=== heredoc opener anywhere on the line; here-string is not a heredoc ==="
# Redirect, append, comment, dash-tab, and a second opener sit after or beside
# the delimiter. Bodies are not commands. A here-string does not skip the next line.
gdorm_exec_line() { # $1 task
  case "$1" in
    gdorm-tree) printf '%s\n' "node scripts/tree.js" ;;
    gdorm-qcpanel) printf '%s\n' "node scripts/qc-panel.js" ;;
    gdorm-archive) printf '%s\n' "node scripts/review-ledger-archive.js import" ;;
  esac
}
gdorm_exec_marker() { # $1 task
  case "$1" in
    gdorm-tree) printf '%s\n' t_tree_run ;;
    gdorm-qcpanel) printf '%s\n' q_qcpanel_run ;;
    gdorm-archive) printf '%s\n' r_archive_import ;;
  esac
}
for task in gdorm-tree gdorm-qcpanel gdorm-archive; do
  line=$(gdorm_exec_line "$task")
  name=$(gdorm_exec_marker "$task")
  expect_mark "$task" "$(heredoc_cmd "cat <<'EOF' > run.sh" "$line" "EOF")" "$name" false
  expect_mark "$task" "$(heredoc_cmd "cat <<'EOF' > run.sh" "$line" "EOF" "$line")" "$name" true
  expect_mark "$task" "$(heredoc_cmd "cat << EOF >> x.sh" "$line" "EOF")" "$name" false
  expect_mark "$task" "$(heredoc_cmd "cat << EOF >> x.sh" "$line" "EOF" "$line")" "$name" true
  expect_mark "$task" "$(heredoc_cmd "cat > run.sh << 'EOF' # init" "$line" "EOF")" "$name" false
  expect_mark "$task" "$(heredoc_cmd "cat > run.sh << 'EOF' # init" "$line" "EOF" "$line")" "$name" true
  expect_mark "$task" "$(heredoc_cmd "cat <<-EOF" "$line" $'\tEOF')" "$name" false
  expect_mark "$task" "$(heredoc_cmd "cat <<-EOF" "$line" $'\tEOF' "$line")" "$name" true
  expect_mark "$task" "$(heredoc_cmd "cat <<E1 <<E2" "$line" "E1" "$line" "E2")" "$name" false
  expect_mark "$task" "$(heredoc_cmd "cat <<E1 <<E2" "$line" "E1" "$line" "E2" "$line")" "$name" true
  expect_mark "$task" "grep x <<< '$line'" "$name" false
  expect_mark "$task" "$(heredoc_cmd "grep x <<< '$line'" "$line")" "$name" true
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
grep -q 'cells_total' <<<"$dry" || fail "dry-run did not print a cell count: $dry"
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

echo "=== dry-run default is 30 cells and at most 7 USD ==="
RES30="$TEST_TMP/gdorm-results-30.jsonl"
dry30=$(node "$BASE/run-gdorm-campaign.js" --results "$RES30" --dry-run) || fail "default dry-run exit $?"
python3 -c 'import json,sys
text=sys.argv[1]
j=json.loads([l for l in text.splitlines() if l.startswith("{")][-1])
assert j["cells_total"] == 30, j
assert j["cost_estimate_usd"] <= 7, j
' "$dry30" || fail "30-cell dry-run: $dry30"

echo "=== dry-run refuses when the estimate exceeds ONOFF_MAX_USD ==="
if env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID ONOFF_MAX_USD=5 \
  node "$BASE/run-gdorm-campaign.js" --results "$TEST_TMP/gdorm-cap.jsonl" --dry-run < /dev/null >/dev/null
then
  fail "dry-run with ONOFF_MAX_USD=5 should exit non-zero"
fi

echo "=== check-arms negative control: a mutated pack is not ok ==="
PACKS="$TEST_TMP/packs-mut"
rm -rf "$PACKS"
cp -a "$BASE/packs" "$PACKS"
python3 - "$BASE/arms/gdorm/base.json" "$PACKS" << 'PY'
import json, sys
arm = json.load(open(sys.argv[1]))
pid = arm["skills"]["ceo-agent"]
path = sys.argv[2] + "/" + pid + "/SKILL.md"
open(path, "ab").write(b"\n")
PY
if env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID ONOFF_PACKS_DIR="$PACKS" \
  node "$BASE/run-gdorm-campaign.js" --check-arms < /dev/null >/dev/null
then
  fail "mutated pack should make --check-arms non-zero"
fi

echo "=== score-gdorm planted red and a passing grid ==="
python3 - "$TEST_TMP" << 'PY'
import json, os, sys
tmp = sys.argv[1]
tasks = ["gdorm-qcpanel", "gdorm-archive", "gdorm-tree"]
markers = {
    "gdorm-qcpanel": "q_qcpanel_run",
    "gdorm-archive": "r_archive_import",
    "gdorm-tree": "t_tree_run",
}
def write(name, qc_base, qc_change, infra=False):
    rows = []
    plan = {
        ("gdorm-qcpanel", "base"): qc_base,
        ("gdorm-qcpanel", "change"): qc_change,
        ("gdorm-archive", "base"): 3,
        ("gdorm-archive", "change"): 3,
        ("gdorm-tree", "base"): 0,
        ("gdorm-tree", "change"): 0,
    }
    for task in tasks:
        for arm in ("base", "change"):
            hits = plan[(task, arm)]
            for rep in range(1, 6):
                row = {
                    "task_id": task, "arm": arm, "rep": rep, "model": "sonnet", "runner": "cc",
                    "failure_class": None, "skill_invoked": True,
                    "markers": {markers[task]: rep <= hits},
                }
                rows.append(row)
    if infra:
        rows[0]["failure_class"] = "infra"
    path = os.path.join(tmp, name)
    with open(path, "w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
    return path
write("score-pass.jsonl", 4, 1)
write("score-base-qc-2.jsonl", 2, 1)
write("score-change-qc-3.jsonl", 4, 3)
write("score-infra.jsonl", 4, 1, infra=True)
PY
score() { # $1 results $2 pass|fail
  local res="$1" expect="$2" out rc
  out=$(node "$BASE/score-gdorm.js" --prereg "$BASE/prereg/gdorm.json" --results "$res" 2>&1) || rc=$?
  rc=${rc:-0}
  if [ "$expect" = pass ]; then
    [ "$rc" = 0 ] || fail "expected PASS rc 0, got $rc: $out"
    grep -q 'PASS' <<<"$out" || fail "expected PASS text: $out"
  else
    [ "$rc" != 0 ] || fail "expected non-PASS, got rc 0: $out"
    grep -q '^gdorm: PASS' <<<"$out" && fail "verdict was PASS: $out"
  fi
}
score "$TEST_TMP/score-pass.jsonl" pass
score "$TEST_TMP/score-base-qc-2.jsonl" fail
score "$TEST_TMP/score-change-qc-3.jsonl" fail
score "$TEST_TMP/score-infra.jsonl" fail

echo "=== scorer uses the latest row when a retry is appended ==="
python3 - "$TEST_TMP" << 'PY'
import json, os, sys
tmp = sys.argv[1]
src = os.path.join(tmp, "score-pass.jsonl")
rows = [json.loads(l) for l in open(src) if l.strip()]
def key(r):
    return (r["task_id"], r["arm"], r["rep"])
# Same cell twice: stale infra row first, success appended (matrix retry).
# The success row drops one base qc hit so a scorer that reads it FAILs on
# the column rule; a scorer that reads the first row exits on infra instead.
late = []
for r in rows:
    if key(r) == ("gdorm-qcpanel", "base", 1):
        stale = dict(r)
        stale["failure_class"] = "runner_timeout"
        stale["markers"] = {"q_qcpanel_run": True}
        stale["skill_invoked"] = False
        fresh = dict(r)
        fresh["failure_class"] = None
        fresh["markers"] = {"q_qcpanel_run": False}
        fresh["skill_invoked"] = True
        late.append(stale)
        late.append(fresh)
    else:
        late.append(r)
with open(os.path.join(tmp, "score-retry-ok.jsonl"), "w") as f:
    for r in late:
        f.write(json.dumps(r) + "\n")
# Mirror: the later row is the infra failure and no row is null.
mir = []
for r in rows:
    if key(r) == ("gdorm-qcpanel", "base", 1):
        first = dict(r)
        first["failure_class"] = None
        second = dict(r)
        second["failure_class"] = "runner_timeout"
        second["markers"] = {"q_qcpanel_run": True}
        mir.append(first)
        mir.append(second)
    else:
        mir.append(r)
with open(os.path.join(tmp, "score-retry-infra.jsonl"), "w") as f:
    for r in mir:
        f.write(json.dumps(r) + "\n")
PY
rc=0
out=$(node "$BASE/score-gdorm.js" --prereg "$BASE/prereg/gdorm.json" --results "$TEST_TMP/score-retry-ok.jsonl" 2>&1) || rc=$?
grep -q 'infra failure' <<<"$out" && fail "retry success still judged infra: $out"
[ "$rc" = 3 ] || fail "retry success should FAIL on the latest markers (base qc 3), rc=$rc: $out"
grep -q '"base":3' <<<"$out" || fail "latest-row markers not used: $out"
rc=0
out=$(node "$BASE/score-gdorm.js" --prereg "$BASE/prereg/gdorm.json" --results "$TEST_TMP/score-retry-infra.jsonl" 2>&1) || rc=$?
[ "$rc" = 3 ] || fail "later infra row should stay infra, rc=$rc: $out"
grep -q 'infra failure' <<<"$out" || fail "later infra row lost the infra verdict: $out"

echo "=== stamp --check ==="
node "$BASE/stamp-prereg.js" --row gdorm --check >/dev/null || fail "stamp --check exit $?"

echo "=== shared runner matches the dcard-v3 freeze digest ==="
# RED at 353f3dd18: shared runner sha256 c693771066da10542fb6ecc1c239b1137f40403f920e07be4d06e3cf435398a1 != dcard-v3 freeze eb29cea61a05fdf9d6a41a04fbb0268840137bfe504324851b393a382ebcca1f (test exit 1). Same commit: stamp-prereg.js --row dcard-v3 --check rc=2, digest mismatch run-skill-onoff-eval.sh.
python3 - "$BASE/run-skill-onoff-eval.sh" "$BASE/prereg/FROZEN.json" << 'PY' || fail "shared runner digest"
import hashlib, json, sys
digest = hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest()
frozen = json.load(open(sys.argv[2]))
want = frozen["dcard-v3"]["files"]["run-skill-onoff-eval.sh"]
if digest != want:
    raise SystemExit(f"shared runner {digest} != dcard-v3 freeze {want}")
PY

echo "=== every FROZEN row that is ok at develop 778f39dee still checks ok ==="
# Measured with stamp-prereg.js --row <row> --check on a worktree of 778f39dee.
# Ok there: qs, qs-v2, qs-v3, dcard, dcard-v2, dcard-v3.
# Not ok there: stage-graph-g67 (FROZEN row not stamped), stage-graph-g8
# (digest mismatch: packs/manifest.json, run-skill-onoff-eval.sh,
# run-skill-onoff-matrix.sh, stamp-prereg.js). gdorm is this branch's row.
python3 - "$BASE" << 'PY' || fail "frozen row check"
import json, os, subprocess, sys
base = sys.argv[1]
frozen = json.load(open(os.path.join(base, "prereg/FROZEN.json")))
rows = []
for key, val in frozen.items():
    if not isinstance(val, dict) or not isinstance(val.get("files"), dict):
        continue
    if not val["files"] or not all(isinstance(h, str) and len(h) == 64 for h in val["files"].values()):
        continue
    if not os.path.isfile(os.path.join(base, "prereg", key + ".json")):
        continue
    rows.append(key)
expect_ok = {"qs", "qs-v2", "qs-v3", "dcard", "dcard-v2", "dcard-v3", "gdorm", "bpack"}
env = os.environ.copy()
env.pop("AUTOPILOT_SESSION_ID", None)
env.pop("CLAUDE_CODE_SESSION_ID", None)
bad = []
for row in rows:
    p = subprocess.run(
        ["node", os.path.join(base, "stamp-prereg.js"), "--row", row, "--check"],
        cwd=base, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True,
    )
    ok = p.returncode == 0
    if row in expect_ok and not ok:
        bad.append(f"{row} rc={p.returncode} {(p.stderr or p.stdout).strip().splitlines()[-1:]}")
    elif row not in expect_ok and ok:
        bad.append(f"{row} unexpectedly ok")
if bad:
    raise SystemExit("; ".join(bad))
PY

echo "=== negative: one byte in a copy of the shared runner voids dcard-v3 ==="
COPY="$TEST_TMP/skill-onoff-copy"
rm -rf "$COPY"
cp -a "$BASE" "$COPY"
python3 - "$COPY/run-skill-onoff-eval.sh" << 'PY'
import sys
p = sys.argv[1]
data = open(p, "rb").read()
i = data.find(b"set -")
if i < 0:
    i = 0
data = data[:i] + (b"#" if data[i:i+1] != b"#" else b"X") + data[i+1:]
open(p, "wb").write(data)
PY
if env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
  node "$COPY/stamp-prereg.js" --row dcard-v3 --check --root "$COPY" < /dev/null >/dev/null 2>&1
then
  fail "mutated shared runner should make dcard-v3 --check fail"
fi

echo "gdorm stub tests passed"
