#!/usr/bin/env bash
# hooks/tests/orchestration-eval-hook.test.sh - BL-0055 phase 2, W5 and NC7: harness `--gate hook`.
# The harness installs the opt-in per-turn-gate Stop hook into the temp repo's project settings; with
# `--gate off` (or observe) it installs nothing. The stub runner emulates what the CLI does with Stop
# hooks: it reads .claude/settings.json of the temp repo, runs the Stop commands with a Stop payload on
# stdin, and when one answers {"decision":"block"} it fixes the repo and calls the hook again with
# stop_hook_active true. So a harness that does not install the hook produces no hook log at all.
# Negative control (evidence-discipline section 58): check_hook_mode must hold for the real harness and FAIL
# for a copy whose install step is switched off ("parsed but not installed"); the mutation tool fails when
# its pattern matches nothing (no no-op mutant).
# RED at the harness without --gate hook (develop 1ce92330d): `--gate hook` exits 2 "--gate must be off|observe|enforce".
. "$(dirname "$0")/lib.sh"

EVAL_DIR="$REPO_ROOT/evals/orchestration"
HARNESS="$EVAL_DIR/run-orchestration-eval.sh"
TASK="$EVAL_DIR/tasks/t14-constraint-horizon"
export ORCH_TIMEOUT=1m

STUB="$TEST_TMP/hook-emulating-stub.sh"
cat >"$STUB" <<'SH'
#!/usr/bin/env bash
# Stand-in model + Claude Code Stop-hook runner. Turn work: plant a violation on the first call of the run,
# keep the good file afterwards. After a block the "model" fixes the repo (good file).
GOOD="$STUB_FIXTURES/good/cli.py"; BAD="$STUB_FIXTURES/bad-localtime/cli.py"
STATE="$STUB_STATE"; mkdir -p "$STATE"
n=$(cat "$STATE/calls" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STATE/calls"
if [ "$n" -eq 1 ]; then cp "$BAD" "$PWD/cli.py"; else cp "$GOOD" "$PWD/cli.py"; fi
CMD=$(node -e 'try{const s=JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"));const h=((s.hooks||{}).Stop||[]);console.log(h.map(x=>(x.hooks||[]).map(y=>y.command).join("\n")).join("\n"))}catch(e){}')
[ -n "$CMD" ] || exit 0
active=false; i=0
while [ "$i" -lt 6 ]; do
  i=$((i + 1))
  out=$(printf '{"session_id":"stub-session","cwd":"%s","stop_hook_active":%s,"prompt_id":"p%s"}' "$PWD" "$active" "$n" | sh -c "$CMD")
  [ -n "${ORCH_STUB_TRACE_FILE:-}" ] && printf 'Hooks: Stop [%s] finished with status 0 (1ms)\n' "$CMD" >> "$ORCH_STUB_TRACE_FILE"
  case "$out" in
    *'"decision":"block"'*) cp "$GOOD" "$PWD/cli.py"; active=true ;;
    *) break ;;
  esac
done
exit 0
SH
chmod +x "$STUB"
export ORCH_STUB_BIN="$STUB" STUB_FIXTURES="$TASK/gate/fixtures"

copy_harness() { # <dest> [python replace: old new]
  mkdir -p "$(dirname "$1")"; cp "$HARNESS" "$1"
  python3 - "$1" "$REPO_ROOT" <<'PY'
import sys
p, root = sys.argv[1], sys.argv[2]
f = open(p).read()
old = 'REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"'
if old not in f: raise SystemExit('REPO_ROOT line not found')
open(p, 'w').write(f.replace(old, "REPO_ROOT='" + root + "'", 1))
PY
}

# mutate <file> <old> <new>: fails when <old> is absent (no no-op mutants).
mutate() {
  python3 - "$1" "$2" "$3" <<'PY' || return 1
import sys
p, old, new = sys.argv[1:4]
f = open(p).read()
if old not in f:
    sys.stderr.write('mutant pattern matched nothing: ' + old + '\n'); raise SystemExit(1)
open(p, 'w').write(f.replace(old, new, 1))
PY
}

run_h() { # <harness> <out> <gate args...>
  local h="$1" out="$2"; shift 2
  rm -rf "$out" "$TEST_TMP/state"; mkdir -p "$out"
  STUB_STATE="$TEST_TMP/state" bash "$h" --task t14-constraint-horizon --arm off --runner stub --model m --out "$out" "$@" >"$out.stdout" 2>"$out.stderr"
}

nrec() { cat "$1"/hook/live/per-turn-gate/*.jsonl 2>/dev/null | grep -c "$2" || true; }

# check_hook_mode <harness>: 0 when `--gate hook` leaves the full trail and `--gate off` leaves none.
check_hook_mode() {
  local h="$1" o="$TEST_TMP/chk" rc=0
  run_h "$h" "$o-hook" --gate hook --hook-trace-dir "$o-hook/trace" || { echo "hook run failed" >&2; return 1; }
  [ -s "$o-hook/gate.jsonl" ] || { echo "no gate.jsonl in hook mode" >&2; rc=1; }
  [ "$(nrec "$o-hook" '"decision":"block"')" = "1" ] || { echo "hook log: want exactly 1 block record, got $(nrec "$o-hook" '"decision":"block"')" >&2; rc=1; }
  run_h "$h" "$o-off" --gate off --hook-trace-dir "$o-off/trace" || { echo "off run failed" >&2; return 1; }
  [ ! -e "$o-off/gate.jsonl" ] || { echo "gate.jsonl exists with --gate off" >&2; rc=1; }
  [ ! -e "$o-off/hook" ] || { echo "hook dir exists with --gate off" >&2; rc=1; }
  return $rc
}

HARNESS_REAL="$TEST_TMP/real/evals/orchestration/run-orchestration-eval.sh"; copy_harness "$HARNESS_REAL"
HARNESS_MUT="$TEST_TMP/mut/evals/orchestration/run-orchestration-eval.sh"; copy_harness "$HARNESS_MUT"
# Mutation: `--gate hook` is parsed but the install block never runs.
mutate "$HARNESS_MUT" 'if [ "$GATE_MODE" = "hook" ]; then
  HOOK_STATE=' 'if false; then
  HOOK_STATE=' || fail "mutant could not be built"

TASK_BEFORE=$(cd "$TASK" && find . -type f | LC_ALL=C sort | while read -r f; do git hash-object "$f"; done | sha256sum)

if check_hook_mode "$HARNESS_MUT" 2>"$TEST_TMP/mut.err"; then
  fail "NC7 mutant (hook not installed) passed the check: the control cannot go red"
else
  echo "RED NC7: $(tr '\n' ';' < "$TEST_TMP/mut.err")"
fi
if check_hook_mode "$HARNESS_REAL" 2>"$TEST_TMP/real.err"; then
  echo "GREEN NC7: real harness holds"
else
  fail "NC7 real harness failed: $(cat "$TEST_TMP/real.err")"
fi

# Details of the green run (the last real run was --gate off; redo the hook run).
O="$TEST_TMP/detail"
run_h "$HARNESS_REAL" "$O" --gate hook --hook-trace-dir "$O/trace"
assert_eq "$(nrec "$O" '"decision":"block"')" 1 "hook: one block record"
assert_eq "$(nrec "$O" '"decision":"allow"')" 5 "hook: five allow records (turn 1 re-entry plus turns 2-5)"
assert_eq "$(cat "$O"/trace/trace-turn*.log | grep -c 'per-turn-gate.js')" 6 "hook: trace count equals log count"
assert_eq "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.gate+":"+j.turns_completed)' "$O/result.json")" "hook:5" "result.json records gate hook and 5 turns"
assert_eq "$(wc -l < "$O/gate.jsonl" | tr -d ' ')" 5 "hook: harness verifier recorded once per turn (observe-style)"
run_h "$HARNESS_REAL" "$O-obs" --gate observe --hook-trace-dir "$O-obs/trace"
assert_file_exists "$O-obs/gate.jsonl"
assert_file_absent "$O-obs/hook"
assert_eq "$(cat "$O-obs"/trace/trace-turn*.log 2>/dev/null | grep -c 'per-turn-gate.js' || true)" 0 "observe arm: no gate hook in the trace"
TASK_AFTER=$(cd "$TASK" && find . -type f | LC_ALL=C sort | while read -r f; do git hash-object "$f"; done | sha256sum)
assert_eq "$TASK_AFTER" "$TASK_BEFORE" "task directory untouched"
bash "$HARNESS" --task t14-constraint-horizon --arm off --runner stub --model m --gate nope --out "$TEST_TMP/x" >/dev/null 2>&1; assert_eq "$?" 2 "unknown --gate value still exits 2"

finalize_test
