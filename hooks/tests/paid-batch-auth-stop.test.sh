#!/usr/bin/env bash
# hooks/tests/paid-batch-auth-stop.test.sh -- BL-0294: every per-id paid batch stops at the FIRST authentication
# failure (STOP_AUTH line + exit 6, no later id launched) and keeps going on a generic failure.
# Each script runs in a throwaway copy of the repo layout with FAKE runners (no model call, no real ~/.claude:
# HOME is a mktemp dir). Each scenario also runs against a MUTANT layout whose helper never reports a
# failure; the stop assertion must then be false (negative control, printed as MUTANT-RED).
. "$(dirname "$0")/lib.sh"

SCRIPTS="$REPO_ROOT/scripts"
ENVX=(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CONFIG_DIR)

# mk_layout <dir> [mutant]: the wired scripts + shared helper copied into a throwaway repo layout. In a mutant layout the
# WIRING is removed from the copied scripts (every auth_stop_check / authStop.checkSources call becomes a no-op), the helper
# itself is untouched: the stop assertions must then be false (negative control, printed as MUTANT-RED).
mk_layout() {
  local d="$1" mutant="${2:-}" f
  mkdir -p "$d/scripts/lib" "$d/evals/skill-transport/lib" "$d/evals/skill-transport/packs" "$d/evals/pipeline-bench" "$d/evals/context-budget-t2"
  cp "$SCRIPTS/run-eval-batch.sh" "$SCRIPTS/bench-engine-capability.sh" "$SCRIPTS/qualification-sweep.sh" \
     "$SCRIPTS/run-grok-implementer-ab.sh" "$SCRIPTS/benchmark-hook-latency.js" "$d/scripts/"
  cp "$SCRIPTS/lib/auth-stop.js" "$SCRIPTS/lib/auth-stop.sh" "$SCRIPTS/lib/repo-identity.sh" \
     "$SCRIPTS/lib/claude-call-capture.js" "$SCRIPTS/lib/claude-call-capture.sh" "$SCRIPTS/lib/claude-call-capture-exec.sh" "$d/scripts/lib/"
  cp "$SCRIPTS/run-skill-opt.sh" "$d/scripts/"
  cp "$REPO_ROOT/evals/run-trigger-test.sh" "$d/evals/"
  cp "$REPO_ROOT/evals/skill-transport/run-matrix.sh" "$REPO_ROOT/evals/skill-transport/run-implementer-matrix.sh" "$REPO_ROOT/evals/skill-transport/match-eval.js" "$d/evals/skill-transport/"
  cp -r "$REPO_ROOT/evals/skill-transport/lib/." "$d/evals/skill-transport/lib/"
  cp "$REPO_ROOT/evals/skill-transport/packs/implementer-pack.md" "$d/evals/skill-transport/packs/"
  cp "$REPO_ROOT/evals/pipeline-bench/run-pipeline-bench.sh" "$d/evals/pipeline-bench/"
  cp "$REPO_ROOT/evals/context-budget-t2/run-t2-eval.js" "$d/evals/context-budget-t2/"
  ln -sfn "$REPO_ROOT/hooks" "$d/hooks"
  # test seam: the matrix pins a frozen pack digest that the shipped pack no longer has (separate, pre-existing drift);
  # the layout copy pins the digest of the pack it ships so the cell loop can be reached
  sed -i "s/3f29d5fd224d45ac96630e642fa9ada1f24446d538b6c2b2ed020ad3f8a7beca/$(sha256sum "$d/evals/skill-transport/packs/implementer-pack.md" | awk '{print $1}')/" "$d/evals/skill-transport/run-implementer-matrix.sh"
  if [ -n "$mutant" ]; then
    for f in "$d/scripts/run-eval-batch.sh" "$d/scripts/bench-engine-capability.sh" "$d/scripts/qualification-sweep.sh" \
             "$d/evals/run-trigger-test.sh" "$d/evals/skill-transport/run-matrix.sh" "$d/evals/skill-transport/run-implementer-matrix.sh" \
             "$d/evals/pipeline-bench/run-pipeline-bench.sh"; do
      grep -q 'auth_stop_check' "$f" || fail "mutant: no wiring found in $f"
      sed -i 's/auth_stop_check/:/g' "$f"
    done
    for f in "$d/scripts/run-grok-implementer-ab.sh" "$d/scripts/benchmark-hook-latency.js" "$d/evals/context-budget-t2/run-t2-eval.js"; do
      grep -q 'authStop\.checkSources(' "$f" || fail "mutant: no wiring found in $f"
      sed -i 's/authStop\.checkSources(/((_s) => null)(/g' "$f"
    done
  fi
}
# Fresh git repo with two commits (the grok A/B harness clones it and resolves HEAD^).
git_layout() {
  ( cd "$1" && git init -q -b main && git config user.email t@t.invalid && git config user.name t \
    && git add -A && git commit -q -m one && git commit -q --allow-empty -m two )
}
# quote_case <label> <expect_calls> <expect_rc>: a SUCCESSFUL call whose output quotes an auth phrase must not stop the batch
quote_case() { assert_neq "$RC" "6" "$1: a successful call quoting an auth phrase does not stop"; assert_eq "$CALLS" "$2" "$1: every unit still runs"; }
# stop_case <label> <expect_calls> : the scenario's globals RC/CALLS/OUT must show the stop
stop_case() { assert_eq "$RC" "6" "$1: exits 6"; assert_eq "$CALLS" "$2" "$1: nothing is launched after the failing call"; assert_contains "$OUT" "STOP_AUTH after $3" "$1: stop line"; }
# mutant_red <label> <expect_calls>: with the wiring removed the stop must NOT happen
mutant_red() { if [ "$RC" = 6 ] || [ "$CALLS" = "$2" ]; then fail "$1: mutant (wiring removed) still stopped -- negative control broken (rc=$RC calls=$CALLS)"; fi; echo "MUTANT-RED $1: rc=$RC calls=$CALLS"; }

# Every scenario function takes <layout> <mode> and sets RC (exit code), CALLS (paid units launched) and OUT (stdout+stderr).
count() { wc -l < "$1" | tr -d ' '; }

# ============================ 1. scripts/run-eval-batch.sh (one run_eval per skill) ============================
# outputs of a paid call: run_eval stdout JSON (eval-output.json) and stderr (eval-log.txt)
eb_run() {
  local L="$1" mode="$2" H="$1/home"
  rm -rf "$H" "$L/skills" "$L/skill-creator-workspace" "$L/calls"; : > "$L/calls"
  mkdir -p "$H/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator" "$L/tmp"
  for s in alpha beta gamma; do
    mkdir -p "$L/skills/$s" "$L/skill-creator-workspace/evals"; : > "$L/skill-creator-workspace/evals/$s-evals.json"
  done
  cat > "$L/fake-run-eval" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  exit0) echo "Please log in to continue." >&2; exit 0 ;;
  cross) if [ "$(wc -l < "$FAKE_CALLS" | tr -d " ")" = 1 ]; then echo '{"summary": {"passed": 1, "total": 1}}'; echo "the skill text mentions: Invalid API key" >&2; exit 0; fi
         echo '{"summary": {"passed": 0, "total": 1}}'; echo "API Error: 429 rate limit reached" >&2; exit 1 ;;
  auth) echo '{"summary": {"passed": 1, "total": 1}}'; echo "Failed to authenticate. API Error: 401" >&2; exit 1 ;;
  authjson) echo '{"summary": {"passed": 0, "total": 1}, "error": "OAuth session expired"}'; exit 1 ;;
  authweak) echo '{"summary": {"passed": 0, "total": 1}}'; echo "error: invalid api key" >&2; exit 1 ;;
  quote) echo '{"summary": {"passed": 1, "total": 1}}'; echo "the skill text mentions: Invalid API key" >&2; exit 0 ;;
  *) echo '{"summary": {"passed": 1, "total": 1}}'; echo "API Error: 429 rate limit reached" >&2; exit 1 ;;
esac
EOS
  chmod +x "$L/fake-run-eval"
  OUT="$("${ENVX[@]}" HOME="$H" TMPDIR="$L/tmp" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" RUN_EVAL_CMD="$L/fake-run-eval" \
    bash "$L/scripts/run-eval-batch.sh" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/eb"
eb_run "$TEST_TMP/eb" auth;     stop_case "run-eval-batch (stderr)" 1 "alpha:"
eb_run "$TEST_TMP/eb" authjson; stop_case "run-eval-batch (stdout JSON only)" 1 "alpha:"
eb_run "$TEST_TMP/eb" authweak; stop_case "run-eval-batch (failed call, weak phrase in stderr)" 1 "alpha:"
eb_run "$TEST_TMP/eb" exit0;    stop_case "run-eval-batch (exit 0, no summary, only an auth message)" 1 "alpha:"
eb_run "$TEST_TMP/eb" cross;    quote_case "run-eval-batch (call 1 ok quoting, calls 2-3 fail 429)" 3
eb_run "$TEST_TMP/eb" quote;    quote_case "run-eval-batch" 3
assert_eq "$RC" "0" "run-eval-batch: quote case exit code unchanged"
# The REAL skill-creator run_eval.py / run_loop.py cannot be changed or fetched here. These stand-ins copy the behaviour that matters,
# as seen in the cv4-cv6 acceptances of BL-0294 (2026-10-25): Popen(claude -p ..., stdout=PIPE, stderr=DEVNULL); return as soon as a
# type=result line is read (optionally after STANDIN_GRACE seconds) or when the per-query timeout expires; then SIGKILL the child;
# the exit code is never read; a valid {"summary": ...} is always printed with exit 0.
procs_left() { # number of claude fakes / mirror processes of this layout still alive after the batch
  sleep 1
  local n=0 p
  for p in $(cat "$1/pids" 2>/dev/null); do [ -d "/proc/$p" ] && ! grep -q '^State:.*Z' "/proc/$p/status" 2>/dev/null && n=$((n + 1)); done
  n=$(( n + $(ps -eo args | awk -v pat="$1/skill-creator-workspace" '$1 != "awk" && index($0, pat) > 0' | wc -l) ))
  echo "$n"
}
kill_grandchildren() { for p in $(cat "$1/pids2" 2>/dev/null); do kill -9 "$p" 2>/dev/null; done; for p in $(cat "$1/pids" 2>/dev/null); do kill -9 "$p" 2>/dev/null; done; }
write_standins() {
  local L="$1"
  cat > "$L/standin_common.py" <<'EOS'
import json, os, selectors, subprocess, threading, time

def run_one():
    p = subprocess.Popen(["claude", "-p", "a query", "--output-format", "stream-json"],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    sel = selectors.DefaultSelector()
    sel.register(p.stdout, selectors.EVENT_READ)
    t0 = time.time()
    limit = float(os.environ.get("STANDIN_TIMEOUT", "20"))
    while time.time() - t0 < limit:
        if not sel.select(timeout=0.1):
            continue
        line = p.stdout.readline()
        if not line:
            break
        try:
            if json.loads(line).get("type") == "result":
                time.sleep(float(os.environ.get("STANDIN_GRACE", "0")))
                break
        except ValueError:
            pass
    p.kill()   # SIGKILL, like run_eval's finally
    p.wait()

def summary():
    print(json.dumps({"summary": {"passed": 0, "total": 1}, "results": []}))
EOS
  cat > "$L/standin_run_eval.py" <<'EOS'
import sys
from standin_common import run_one, summary
for _ in range(2):
    run_one()
summary(); sys.exit(0)
EOS
  # boundary probe: query 1 and 2 overlap (parallel workers), query 3 starts after both were killed
  cat > "$L/standin_probe.py" <<'EOS'
import sys, threading, time
from standin_common import run_one, summary
t1 = threading.Thread(target=run_one); t1.start()
time.sleep(0.2)
t2 = threading.Thread(target=run_one); t2.start()
t1.join(); t2.join()
run_one()
summary(); sys.exit(0)
EOS
  # run_loop: 3 iterations x 3 parallel queries
  cat > "$L/standin_loop.py" <<'EOS'
import sys, threading
from standin_common import run_one, summary
for _ in range(3):
    ts = [threading.Thread(target=run_one) for _ in range(3)]
    [t.start() for t in ts]; [t.join() for t in ts]
summary(); sys.exit(0)
EOS
}
write_fake_claude() {
  local L="$1"
  mkdir -p "$L/fb"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
echo $$ >> "${FAKE_PIDS:?}"
n="$(wc -l < "$FAKE_CALLS" | tr -d " ")"
case "${FAKE_MODE}" in
  wrap-auth) echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Invalid API key · Please run /login"}'; echo "Authentication error" >&2; exec sleep 60 ;;
  wrap-late) echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom"}'; sleep 1.0; echo "Authentication error" >&2; exec sleep 60 ;;
  wrap-late1) if [ "$n" = 1 ]; then echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom"}'; sleep 1.0; echo "Authentication error" >&2; exec sleep 60; fi
              echo '{"type":"result","subtype":"success","is_error":false,"result":"fine"}'; exec sleep 60 ;;
  wrap-late1gc) if [ "$n" = 1 ]; then echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom"}'; sleep 1.0; echo "Authentication error" >&2
                  sleep 60 & echo $! >> "${FAKE_PIDS2:?}"; exec sleep 60; fi
              echo '{"type":"result","subtype":"success","is_error":false,"result":"fine"}'; exec sleep 60 ;;
  wrap-grandchild) echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Invalid API key · Please run /login"}'
                   sleep 60 & echo $! >> "${FAKE_PIDS2:?}"; exec sleep 60 ;;
  wrap-exit0) echo "Please log in to continue."; exit 0 ;;
  wrap-quote) echo '{"type":"result","subtype":"success","is_error":false,"result":"the docs quote: Invalid API key"}'; exec sleep 60 ;;
  wrap-cross) if [ "$n" = 1 ]; then echo '{"type":"result","subtype":"success","is_error":false,"result":"Invalid API key quoted"}'; exec sleep 60; fi
              echo "API Error: 429 rate limit" >&2; echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"rate limited"}'; exec sleep 60 ;;
  wrap-hang) exec sleep 60 ;;
esac
EOS
  chmod +x "$L/fb/claude"
}
ebw_run() {   # <layout> <mode> [standin file] [grace seconds]
  local L="$1" mode="$2" H="$1/home" standin="${3:-standin_run_eval.py}" grace="${4:-0}"
  rm -rf "$H" "$L/skills" "$L/skill-creator-workspace" "$L/calls" "$L/fb" "$L/pids" "$L/pids2"; : > "$L/calls"; : > "$L/pids"; : > "$L/pids2"
  mkdir -p "$H/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator" "$L/tmp"
  for sk in alpha beta gamma; do
    mkdir -p "$L/skills/$sk" "$L/skill-creator-workspace/evals"; : > "$L/skill-creator-workspace/evals/$sk-evals.json"
  done
  write_standins "$L"; write_fake_claude "$L"
  OUT="$(cd "$L" && "${ENVX[@]}" HOME="$H" TMPDIR="$L/tmp" PATH="$L/fb:$PATH" PYTHONPATH="$L" FAKE_CALLS="$L/calls" FAKE_PIDS="$L/pids" FAKE_PIDS2="$L/pids2" FAKE_MODE="$mode" \
    STANDIN_GRACE="$grace" STANDIN_TIMEOUT="$([ "$mode" = wrap-hang ] && echo 0.5 || echo 20)" RUN_EVAL_CMD="python3 $L/$standin" \
    bash "$L/scripts/run-eval-batch.sh" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"; LEFT="$(procs_left "$L")"
}
ebw_run "$TEST_TMP/eb" wrap-auth;  stop_case "run-eval-batch (run_eval returns on the result line and SIGKILLs: json is_error + stderr)" 1 "alpha/"
assert_eq "$LEFT" "0" "run-eval-batch: no claude / mirror process is left behind after run_eval killed claude (exec life cycle kept)"
ebw_run "$TEST_TMP/eb" wrap-exit0; stop_case "run-eval-batch (exit 0, only an auth message, no result line)" 1 "alpha/"
assert_eq "$LEFT" "0" "run-eval-batch: nothing left behind (exit 0 case)"
ebw_run "$TEST_TMP/eb" wrap-quote; quote_case "run-eval-batch (wrapper: successful calls quoting a phrase)" 6
assert_eq "$RC" "0" "run-eval-batch: quote case completes"
assert_eq "$LEFT" "0" "run-eval-batch: nothing left behind (quote case)"
ebw_run "$TEST_TMP/eb" wrap-cross; quote_case "run-eval-batch (wrapper: call 1 ok quoting, later calls fail with 429)" 6
ebw_run "$TEST_TMP/eb" wrap-hang;  quote_case "run-eval-batch (wrapper: per-query timeout kill, no auth message)" 6
assert_eq "$LEFT" "0" "run-eval-batch: a timeout-killed claude leaves nothing behind"
# (a) boundary probe: the failed result line arrives first, the authentication stderr 0.4 s later, the process stays alive until the
# caller kills it; query 2 overlaps query 1 (parallel worker); query 3 starts after both are dead and MUST be refused.
ebw_run "$TEST_TMP/eb" wrap-late1 standin_probe.py 1.6
stop_case "run-eval-batch (boundary probe: failed result first, authentication stderr later)" 2 "alpha/"
assert_eq "$LEFT" "0" "run-eval-batch: nothing left behind (boundary probe)"
# (a2) same, but a grandchild of claude 1 keeps the pipes open: its record is dead-but-not-closed when query 3 starts -> pending, waited for
ebw_run "$TEST_TMP/eb" wrap-late1gc standin_probe.py 1.6
stop_case "run-eval-batch (boundary probe: dead record still draining -> pending, not skipped)" 2 "alpha/"
kill_grandchildren "$TEST_TMP/eb"
# (b) claude is SIGKILLed while its own child still holds stdout / stderr: the mirrors must still finish
ebw_run "$TEST_TMP/eb" wrap-grandchild
assert_eq "$RC" "6" "run-eval-batch: stop with a grandchild holding the pipes"
assert_eq "$LEFT" "0" "run-eval-batch: mirrors end although a grandchild of claude still holds the pipes (no process left but the grandchild itself)"
kill_grandchildren "$TEST_TMP/eb"
eb_run "$TEST_TMP/eb" generic
assert_eq "$CALLS" "3" "run-eval-batch: a generic failure does not stop the batch"
assert_eq "$RC" "0" "run-eval-batch: a generic failure keeps the original exit code 0"
mk_layout "$TEST_TMP/eb-mut" mutant
eb_run "$TEST_TMP/eb-mut" auth; mutant_red "run-eval-batch" 1
# negative controls on the shared capture lib (the layout copies are mutated, the real files are not)
# 1. no boundary check before a claude start -> the second paid call of the same skill happens
mk_layout "$TEST_TMP/ebw-mut"
grep -q 'judge --dir "\$EVAL_CALL_RECORD_DIR"' "$TEST_TMP/ebw-mut/scripts/lib/claude-call-capture-exec.sh" || fail "boundary mutation anchor missing"
sed -i '/judge --dir "\$EVAL_CALL_RECORD_DIR"/d' "$TEST_TMP/ebw-mut/scripts/lib/claude-call-capture-exec.sh"
ebw_run "$TEST_TMP/ebw-mut" wrap-auth
if [ "$CALLS" -le 1 ]; then fail "run-eval-batch: boundary check removed but only $CALLS claude call happened -- negative control broken"; fi
echo "MUTANT-RED run-eval-batch (boundary check removed): claude calls=$CALLS (a second paid call of the same skill happened; the outer check still ends with rc=$RC)"
kill_grandchildren "$TEST_TMP/ebw-mut"
# 2. the mirror back to tee, with a grandchild holding the pipes -> the tee survives (orphan)
mk_layout "$TEST_TMP/ebw-mut2"
grep -q 'mirror --pid' "$TEST_TMP/ebw-mut2/scripts/lib/claude-call-capture-exec.sh" || fail "tee mutation anchor missing"
sed -i 's#>(node "\$CLAUDE_CAPTURE_JS" mirror --pid "\$\$" --rec "\$_rec.err" --fd 2)#>(tee "$_rec.err" >\&2)#; s#>(node "\$CLAUDE_CAPTURE_JS" mirror --pid "\$\$" --rec "\$_rec.out" --fd 1)#>(tee "$_rec.out")#' "$TEST_TMP/ebw-mut2/scripts/lib/claude-call-capture-exec.sh"
ebw_run "$TEST_TMP/ebw-mut2" wrap-grandchild
if [ "$LEFT" = 0 ]; then fail "run-eval-batch: tee mirrors left no orphan -- negative control broken"; fi
echo "MUTANT-RED run-eval-batch (mirror back to tee): $LEFT process(es) left behind after claude was killed while a grandchild held the pipes"
kill_grandchildren "$TEST_TMP/ebw-mut2"; sleep 1
# 3. the record-state function skips a dead record whose streams are not closed yet (the old "only judge what is already closed" hole)
#    -> claude 1 was just killed, its mirror is still draining, so query 3 starts before the authentication stderr is on disk
mk_layout "$TEST_TMP/ebw-mut3"
grep -q "isClosed(base) ? 'ready' : 'pending'" "$TEST_TMP/ebw-mut3/scripts/lib/claude-call-capture.js" || fail "state-function mutation anchor missing"
sed -i "s/return isClosed(base) ? 'ready' : 'pending';/return isClosed(base) ? 'ready' : 'alive';/" "$TEST_TMP/ebw-mut3/scripts/lib/claude-call-capture.js"
grep -q "isClosed(base) ? 'ready' : 'alive'" "$TEST_TMP/ebw-mut3/scripts/lib/claude-call-capture.js" || fail "state-function mutation did not apply"
ebw_run "$TEST_TMP/ebw-mut3" wrap-late1gc standin_probe.py 1.6
if [ "$CALLS" -le 2 ]; then fail "run-eval-batch: judging a live record did not let query 3 through (calls=$CALLS) -- negative control broken"; fi
echo "MUTANT-RED run-eval-batch (recordState: unclosed dead record skipped): claude calls=$CALLS (the probe's third query was paid)"
kill_grandchildren "$TEST_TMP/ebw-mut3"
# 4. judge ignores .writeerror (incomplete record trusted) -> a record whose write failed, with a success prefix and auth stderr, is not stopped
mk_layout "$TEST_TMP/ebw-mut4"
JSM="$TEST_TMP/ebw-mut4/scripts/lib/claude-call-capture.js"
sed -i "s/if (exists(\`\${base}.out.writeerror\`) || exists(\`\${base}.err.writeerror\`)) return 'writeerror';//" "$JSM"
grep -q "return 'writeerror'" "$JSM" && fail "writeerror mutation did not apply"
MD="$TEST_TMP/ebw-mut4/jd"; mkdir -p "$MD"; echo "999999 1" > "$MD/m.pid"
echo '{"type":"result","subtype":"success","is_error":false,"result":"fine"}' > "$MD/m.out"; echo 'Authentication error' > "$MD/m.err"
: > "$MD/m.out.closed"; : > "$MD/m.err.closed"; echo EIO > "$MD/m.out.writeerror"
node "$JSM" judge --dir "$MD" < /dev/null 2>/dev/null; MRC=$?
if [ "$MRC" = 6 ]; then fail "writeerror mutant still stopped -- negative control broken"; fi
echo "MUTANT-RED claude-call-capture (writeerror ignored): rc=$MRC (the incomplete record was trusted)"

# ============================ 2. scripts/bench-engine-capability.sh (one dispatch per case) ============================
# outputs of a paid call: dispatch stdout+stderr (captured together) and the agent_log it names
bc_run() {
  local L="$1" mode="$2" H="$1/home"
  rm -rf "$H" "$L/calls"; : > "$L/calls"; mkdir -p "$H" "$L/evals/engine-capabilities"
  for c in brainstorm-gate quality-review-findings-first dev-flow-branch-check no-skill-claim; do
    : > "$L/evals/engine-capabilities/$c.prompt.txt"; : > "$L/evals/engine-capabilities/$c.expected.txt"
  done
  cat > "$L/scripts/dispatch-hetero.sh" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
log="${FAKE_CALLS}.agent.log"
echo '{"type":"result","is_error":false,"result":"fine"}' > "$log"
err=""
case "${FAKE_MODE}" in
  exit0) echo 'Please log in to continue.' > "$log"; printf '{"status":"no_op","worktree":"","agent_log":"%s","files_changed":0}\n' "$log"; exit 0 ;;
  cross) if [ "$(wc -l < "$FAKE_CALLS" | tr -d " ")" = 1 ]; then echo 'the answer quotes: Invalid API key' > "$log"; printf '{"status":"committed","worktree":"","agent_log":"%s","files_changed":0}\n' "$log"; exit 0; fi
         echo 'API Error: 429 rate limit' > "$log"; printf '{"status":"failure","worktree":"","agent_log":"%s","files_changed":0}\n' "$log"; exit 1 ;;
  authlog) echo '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}' > "$log" ;;
  authjson) err=', "error": "OAuth session expired"' ;;
  authweak) echo 'agent output: invalid api key' > "$log"; printf '{"status":"failure","worktree":"","agent_log":"%s","files_changed":0}\n' "$log"; exit 1 ;;
  quote) echo 'the answer quotes: Invalid API key' > "$log"; printf '{"status":"committed","worktree":"","agent_log":"%s","files_changed":0}\n' "$log"; exit 0 ;;
  generic) echo '{"type":"result","is_error":true,"result":"rate limit 429, retry later"}' > "$log" ;;
esac
printf '{"status":"failure","worktree":"","agent_log":"%s","files_changed":0%s}\n' "$log" "$err"
EOS
  chmod +x "$L/scripts/dispatch-hetero.sh"
  echo 'process.exit(0);' > "$L/scripts/engine-capability-state.js"
  OUT="$("${ENVX[@]}" HOME="$H" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    bash "$L/scripts/bench-engine-capability.sh" --runner agy --model m1 --skill-mode prompt --live-spend < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/bc"
bc_run "$TEST_TMP/bc" authlog;  stop_case "bench-engine-capability (agent_log only)" 1 "brainstorm-gate:"
bc_run "$TEST_TMP/bc" authjson; stop_case "bench-engine-capability (stdout JSON only)" 1 "brainstorm-gate:"
bc_run "$TEST_TMP/bc" authweak; stop_case "bench-engine-capability (failed call, weak phrase in plain agent_log)" 1 "brainstorm-gate:"
bc_run "$TEST_TMP/bc" exit0;    stop_case "bench-engine-capability (exit 0, status no_op, only an auth message in agent_log)" 1 "brainstorm-gate:"
bc_run "$TEST_TMP/bc" cross;    quote_case "bench-engine-capability (call 1 ok quoting, later calls fail 429)" 4
bc_run "$TEST_TMP/bc" quote;    quote_case "bench-engine-capability" 4
bc_run "$TEST_TMP/bc" generic
assert_eq "$CALLS" "4" "bench-engine-capability: a generic failure runs every case"
assert_eq "$RC" "0" "bench-engine-capability: a generic failure keeps the original exit code 0"
mk_layout "$TEST_TMP/bc-mut" mutant
bc_run "$TEST_TMP/bc-mut" authlog; mutant_red "bench-engine-capability" 1

# ============================ 3. scripts/qualification-sweep.sh (one administration per seat) ============================
# outputs of a paid call: probe = dispatch stdout, stderr, agent_log; administration = stderr log, stdout row JSON, raw dir files
qs_run() {
  local L="$1" mode="$2"
  rm -rf "$L/home" "$L/dcalls" "$L/qcalls" "$L/ev"; : > "$L/dcalls"; : > "$L/qcalls"; mkdir -p "$L/home"
  if [ "$mode" = qualify-stale ]; then   # an OLD run left an auth message in the bundle's raw dir, written right now (same second)
    mkdir -p "$L/ev/s1-qualify/raw"; echo "old run: OAuth session expired" > "$L/ev/s1-qualify/raw/old.log"
  fi
  cat > "$L/roster.json" <<'EOS'
{ "corpus": { "prompt_config_hash": "a", "semantic_fingerprint": "b", "containment_fingerprint": "c", "harness_version": "h", "expires_days": 90 },
  "evidence_root": "ev", "role": "implementer",
  "seats": [
    { "slug": "s1", "runner": "codex", "model": "m1", "family": "f", "version_source": "operator-asserted", "endpoint": "-", "effort": "high" },
    { "slug": "s2", "runner": "codex", "model": "m2", "family": "f", "version_source": "operator-asserted", "endpoint": "-", "effort": "high" },
    { "slug": "s3", "runner": "codex", "model": "m3", "family": "f", "version_source": "operator-asserted", "endpoint": "-", "effort": "high" } ] }
EOS
  cat > "$L/scripts/lib/runner-binary.js" <<'EOS'
module.exports = { receiptSafe: (v) => String(v) };
if (require.main === module) console.log(JSON.stringify({ ok: true, token: '1.0.0', binary_path: '/fake/codex', version_line: '1.0.0' }));
EOS
  printf 'autopilot_load_endpoints_env() { return 0; }\n' > "$L/scripts/load-endpoints-env.sh"
  echo 'process.exit(0);' > "$L/scripts/engine-scorecard.js"
  cat > "$L/scripts/dispatch-hetero.sh" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_DCALLS:?}"
log="${FAKE_DCALLS}.agent.log"
echo '{"type":"result","is_error":false,"result":"fine"}' > "$log"
case "${FAKE_MODE}" in
  probe-auth) printf '{"status":"failure","agent_log":"%s","error":"Failed to authenticate. API Error: 401"}\n' "$log" ;;
  probe-exit0) echo 'Please log in to continue.' > "$log"; printf '{"status":"no_op","agent_log":"%s"}\n' "$log" ;;
  probe-authlog) echo '{"type":"result","is_error":true,"result":"OAuth session expired"}' > "$log"; printf '{"status":"failure","agent_log":"%s"}\n' "$log" ;;
  probe-autherr) echo "Failed to authenticate" >&2; echo '{"status":"failure"}' ;;
  generic) printf '{"status":"failure","agent_log":"%s","error":"API Error: 429 rate limit reached"}\n' "$log" ;;
  *) echo '{"status": "committed"}' ;;
esac
EOS
  cat > "$L/scripts/engine-qualify.js" <<'EOS'
const fs = require('fs');
fs.appendFileSync(process.env.FAKE_QCALLS, 'call\n');
const rawDir = process.argv[process.argv.indexOf('--raw-dir') + 1];
const row = { status: 'PASS', quality: { corpus_pass: '1/1' }, capability_score: 1, latency: { sample_wall_time_s: 1 } };
if (process.env.FAKE_MODE === 'qualify-autherr') { console.error('OAuth session expired, please log in'); process.exit(3); }
if (process.env.FAKE_MODE === 'qualify-authweak') { console.error('error: invalid api key'); process.exit(3); }
if (process.env.FAKE_MODE === 'qualify-authjson') { console.log(JSON.stringify({ ...row, status: 'infra_abort', error: 'Failed to authenticate' })); process.exit(3); }
if (process.env.FAKE_MODE === 'qualify-authraw') {
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(`${rawDir}/case-1.log`, 'agent said: OAuth session expired\n');
  console.log(JSON.stringify(row)); process.exit(3);
}
if (process.env.FAKE_MODE === 'qualify-stale') { console.error('boom: unrelated failure'); process.exit(3); }
if (process.env.FAKE_MODE === 'qualify-quote') {
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(`${rawDir}/case-1.log`, 'candidate wrote: Invalid API key\n');
}
console.log(JSON.stringify(row));
EOS
  OUT="$(cd "$L" && "${ENVX[@]}" HOME="$L/home" FAKE_DCALLS="$L/dcalls" FAKE_QCALLS="$L/qcalls" FAKE_MODE="$mode" \
    bash "$L/scripts/qualification-sweep.sh" --roster "$L/roster.json" --execute --yes < /dev/null 2>&1)"
  RC=$?; CALLS=$(( $(count "$L/dcalls") + $(count "$L/qcalls") ))
}
mk_layout "$TEST_TMP/qs"; git_layout "$TEST_TMP/qs"
qs_run "$TEST_TMP/qs" probe-auth;     stop_case "qualification-sweep (probe stdout JSON)" 1 "probe-codex/m1:"
qs_run "$TEST_TMP/qs" probe-exit0;    stop_case "qualification-sweep (probe exit 0, status no_op, only an auth message)" 1 "probe-codex/m1:"
qs_run "$TEST_TMP/qs" probe-authlog;  stop_case "qualification-sweep (probe agent_log only)" 1 "probe-codex/m1:"
qs_run "$TEST_TMP/qs" probe-autherr;  stop_case "qualification-sweep (probe stderr only)" 1 "probe-codex/m1:"
qs_run "$TEST_TMP/qs" qualify-autherr;  stop_case "qualification-sweep (qualify stderr)" 2 "s1:"
qs_run "$TEST_TMP/qs" qualify-authjson; stop_case "qualification-sweep (qualify stdout row JSON only)" 2 "s1:"
qs_run "$TEST_TMP/qs" qualify-authraw;  stop_case "qualification-sweep (qualify raw dir file only)" 2 "s1:"
assert_file_exists "$TEST_TMP/qs/ev/s1-qualify/raw/case-1.log" "qualification-sweep: the judged raw files are copied into the evidence bundle"
qs_run "$TEST_TMP/qs" qualify-stale
assert_neq "$RC" "6" "qualification-sweep: a stale auth message from an older run (same second) is not this administration's"
assert_eq "$CALLS" "6" "qualification-sweep: every seat is still administered after the unrelated failure"
qs_run "$TEST_TMP/qs" qualify-authweak; stop_case "qualification-sweep (failed qualify, weak phrase in stderr log)" 2 "s1:"
qs_run "$TEST_TMP/qs" qualify-quote;    quote_case "qualification-sweep" 6
assert_eq "$RC" "0" "qualification-sweep: quote case exit code unchanged"
qs_run "$TEST_TMP/qs" generic
assert_eq "$CALLS" "3" "qualification-sweep: a generic probe failure still probes every seat"
assert_eq "$RC" "1" "qualification-sweep: a generic failure keeps its old exit code 1 (INCOMPLETE)"
mk_layout "$TEST_TMP/qs-mut" mutant; git_layout "$TEST_TMP/qs-mut"
qs_run "$TEST_TMP/qs-mut" probe-authlog; mutant_red "qualification-sweep (probe)" 1
qs_run "$TEST_TMP/qs-mut" qualify-authraw; mutant_red "qualification-sweep (qualify)" 2

# ============================ 4. scripts/run-grok-implementer-ab.sh (one session per arm, with retries) ============================
# outputs of a paid call: dispatch stdout JSON, stderr, and the agent_log it names
ga_run() {
  local L="$1" mode="$2" bin="$1/fakebin"
  rm -rf "$L/calls" "$L/scratch" "$L/report.json"; : > "$L/calls"; mkdir -p "$bin" "$L/home"
  printf '#!/usr/bin/env bash\n[ "${1:-}" = "--version" ] && { echo grok-test 0.0.1; exit 0; }\nexit 1\n' > "$bin/grok"; chmod +x "$bin/grok"
  cat > "$L/fake-dispatch.sh" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
log="${FAKE_CALLS}.agent.log"; echo '{"type":"result","is_error":false}' > "$log"
case "${FAKE_MODE}" in
  exit0) echo 'Please log in to continue.' > "$log"; printf '{"status":"no_op","runner":"grok","model":"grok-4.5","commit":null,"files_changed":0,"model_calls":1,"agent_log":"%s","error":null}\n' "$log"; exit 0 ;;
  cross) if [ "$(wc -l < "$FAKE_CALLS" | tr -d " ")" = 1 ]; then echo 'candidate says: Invalid API key' > "$log"; printf '{"status":"committed","runner":"grok","model":"grok-4.5","commit":null,"files_changed":0,"model_calls":1,"agent_log":"%s","error":null}\n' "$log"; exit 0; fi
         err="API Error: 429 rate limit" ;;
  auth) err="Failed to authenticate. API Error: 401" ;;
  authlog) err="simulated failure"; echo '{"type":"result","is_error":true,"result":"OAuth session expired"}' > "$log" ;;
  authweak) err="simulated failure"; echo 'agent output: invalid api key' > "$log" ;;
  quote) echo 'candidate says: Invalid API key' > "$log"; printf '{"status":"committed","runner":"grok","model":"grok-4.5","commit":null,"files_changed":0,"model_calls":1,"agent_log":"%s","error":null}\n' "$log"; exit 0 ;;
  autherr) err="simulated failure"; echo "Failed to authenticate" >&2 ;;
  *) err="simulated failure" ;;
esac
printf '{"status":"failure","runner":"grok","model":"grok-4.5","commit":null,"files_changed":0,"model_calls":1,"agent_log":"%s","error":"%s"}\n' "$log" "$err"
EOS
  node -e '
    const fs = require("fs"); const [seed, tasks] = process.argv.slice(1);
    fs.writeFileSync(seed, JSON.stringify({ schema_version: 1, seed: 20260806, bootstrap_resamples: 64, initial_pairs: 3, max_pairs: 3,
      max_provider_sessions: 30, max_retries_per_arm: 6, arms: { A: { effort: "medium" }, B: { effort: "high" } },
      actor: { runner: "grok", model: "Grok-4.5", family: "xai" }, primary_endpoint: "usable_session_rate_diff",
      material_effect_pp: 10, quality_non_inferiority_pp: 5, arm_order: "ABBA" }));
    fs.writeFileSync(tasks, JSON.stringify({ schema_version: 1, tasks: [1, 2, 3].map((i) => ({ id: "t0" + i, prompt: "p", acceptance: ["git diff --check"], max_files: 2 })) }));
  ' "$L/seed.json" "$L/tasks.json"
  local base cand; base="$(git -C "$L" rev-parse HEAD^)"; cand="$(git -C "$L" rev-parse HEAD)"
  OUT="$("${ENVX[@]}" HOME="$L/home" PATH="$bin:$PATH" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    AUTOPILOT_GROK_AB_DISPATCH_BIN="$L/fake-dispatch.sh" AUTOPILOT_GROK_AB_SCRATCH="$L/scratch" \
    bash "$L/scripts/run-grok-implementer-ab.sh" --tasks "$L/tasks.json" --seed "$L/seed.json" --report "$L/report.json" \
      --base-sha "$base" --candidate-sha "$cand" --timeout 1s < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/ga"; git_layout "$TEST_TMP/ga"
ga_run "$TEST_TMP/ga" auth;    stop_case "run-grok-implementer-ab (stdout JSON)" 1 "t01/A:"
assert_file_absent "$TEST_TMP/ga/scratch" "run-grok-implementer-ab: the scratch clone is removed on the stop path"
ga_run "$TEST_TMP/ga" authlog; stop_case "run-grok-implementer-ab (agent_log only)" 1 "t01/A:"
ga_run "$TEST_TMP/ga" autherr; stop_case "run-grok-implementer-ab (stderr only)" 1 "t01/A:"
ga_run "$TEST_TMP/ga" authweak; stop_case "run-grok-implementer-ab (failed call, weak phrase in plain agent_log)" 1 "t01/A:"
ga_run "$TEST_TMP/ga" exit0;   stop_case "run-grok-implementer-ab (exit 0, status no_op, only an auth message)" 1 "t01/A:"
ga_run "$TEST_TMP/ga" cross
assert_neq "$RC" "6" "run-grok-implementer-ab: call 1 ok quoting, later calls fail 429 -> not an auth stop"
if [ "$CALLS" -le 2 ]; then fail "run-grok-implementer-ab: cross case must keep retrying (calls=$CALLS)"; fi
ga_run "$TEST_TMP/ga" quote
assert_neq "$RC" "6" "run-grok-implementer-ab: a successful call quoting an auth phrase does not stop"
if [ "$CALLS" -le 1 ]; then fail "run-grok-implementer-ab: quote case must keep running (calls=$CALLS)"; fi
ga_run "$TEST_TMP/ga" generic
assert_eq "$RC" "1" "run-grok-implementer-ab: a generic failure keeps its original exit code 1"
if [ "$CALLS" -le 1 ]; then fail "run-grok-implementer-ab: a generic failure must keep retrying (calls=$CALLS)"; fi
mk_layout "$TEST_TMP/ga-mut" mutant; git_layout "$TEST_TMP/ga-mut"
ga_run "$TEST_TMP/ga-mut" authlog; mutant_red "run-grok-implementer-ab" 1

# ============================ 5. evals/run-trigger-test.sh (two prompt loops, one claude -p each) ============================
# outputs of a paid call: stdout+stderr in one file ($outfile)
tt_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/res" "$L/fb"; : > "$L/calls"; mkdir -p "$L/fb" "$L/evals/trigger-prompts" "$L/home"
  printf 'dev-flow|start a feature\nbrainstorm|think it through\n' > "$L/evals/trigger-prompts/should-trigger.txt"
  printf 'what is the weather\nwrite a poem\n' > "$L/evals/trigger-prompts/should-not-trigger.txt"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  auth) echo "Invalid API key · Please run /login" ;;
  authjson) echo '{"type":"result","is_error":true,"api_error_status":401,"result":"x"}' ;;
  authweak) echo "error: invalid api key" ;;
  exit0) echo "Please log in to continue."; exit 0 ;;
  cross) if [ "$(wc -l < "$FAKE_CALLS" | tr -d " ")" = 1 ]; then echo '{"type":"result","subtype":"success","is_error":false,"result":"Invalid API key quoted"}'; exit 0; fi
         echo "API Error: 429 rate limit"; exit 1 ;;
  quote) echo '{"type":"assistant","message":"the key was an Invalid API key in the docs"}'; echo '{"type":"result","subtype":"success","is_error":false,"result":"done"}'; exit 0 ;;
  *) echo '{"type":"result","is_error":true,"api_error_status":429,"result":"rate limit"}' ;;
esac
exit 1
EOS
  chmod +x "$L/fb/claude"
  OUT="$("${ENVX[@]}" HOME="$L/home" PATH="$L/fb:$PATH" AUTOPILOT_EVAL_INTEGRATION=1 AUTOPILOT_EVAL_RESULTS_DIR="$L/res" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    bash "$L/evals/run-trigger-test.sh" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/tt"
tt_run "$TEST_TMP/tt" auth;     stop_case "run-trigger-test (plain stdout)" 1 "dev-flow:"
tt_run "$TEST_TMP/tt" authjson; stop_case "run-trigger-test (JSON api_error_status 401)" 1 "dev-flow:"
tt_run "$TEST_TMP/tt" authweak; stop_case "run-trigger-test (failed call, weak phrase in merged stream)" 1 "dev-flow:"
tt_run "$TEST_TMP/tt" exit0;    stop_case "run-trigger-test (exit 0, only an auth message)" 1 "dev-flow:"
tt_run "$TEST_TMP/tt" cross;    quote_case "run-trigger-test (call 1 ok quoting, later calls fail 429)" 4
tt_run "$TEST_TMP/tt" quote;    quote_case "run-trigger-test" 4
tt_run "$TEST_TMP/tt" generic
assert_eq "$CALLS" "4" "run-trigger-test: a generic failure runs every prompt"
assert_eq "$RC" "1" "run-trigger-test: a generic failure keeps its original exit code 1 (FAIL counted)"
mk_layout "$TEST_TMP/tt-mut" mutant; tt_run "$TEST_TMP/tt-mut" auth; mutant_red "run-trigger-test" 1

# ============================ 6. evals/context-budget-t2/run-t2-eval.js (one claude -p per case run) ============================
# outputs of a paid call: stdout (plain answer or CLI error line) and stderr
t2_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/fb"; : > "$L/calls"; mkdir -p "$L/fb" "$L/home/.claude" "$L/cfg"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  auth) echo "Invalid API key · Please run /login"; exit 1 ;;
  autherr) echo "OAuth session expired" >&2; exit 1 ;;
  authweak) echo "error: invalid api key" >&2; exit 1 ;;
  exit0) echo "Please log in to continue."; exit 0 ;;
  cross) if [ "$(wc -l < "$FAKE_CALLS" | tr -d " ")" = 1 ]; then echo "ACTION: CONTINUE (mentions Invalid API key)"; exit 0; fi
         echo "API Error: 429 rate limit" >&2; exit 1 ;;
  quote) echo "ACTION: CONTINUE (the hook text mentions Invalid API key)"; exit 0 ;;
  *) echo "API Error: 429 rate limit" >&2; exit 1 ;;
esac
EOS
  chmod +x "$L/fb/claude"
  OUT="$(cd "$L" && "${ENVX[@]}" HOME="$L/home" CLAUDE_EVAL_CONFIG_DIR="$L/cfg" PATH="$L/fb:$PATH" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    node "$L/evals/context-budget-t2/run-t2-eval.js" --runs-on 1 --runs-control 1 --out "$L/t2.json" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/t2"
t2_run "$TEST_TMP/t2" auth;    stop_case "run-t2-eval (stdout)" 1 "A-headless"
t2_run "$TEST_TMP/t2" autherr; stop_case "run-t2-eval (stderr)" 1 "A-headless"
t2_run "$TEST_TMP/t2" authweak; stop_case "run-t2-eval (failed call, weak phrase)" 1 "A-headless"
t2_run "$TEST_TMP/t2" exit0;   stop_case "run-t2-eval (exit 0, unparseable reply that is an auth message)" 1 "A-headless"
t2_run "$TEST_TMP/t2" cross
assert_neq "$RC" "6" "run-t2-eval: call 1 ok quoting, later calls fail 429 -> not an auth stop"
if [ "$CALLS" -le 1 ]; then fail "run-t2-eval: cross case must run every job (calls=$CALLS)"; fi
t2_run "$TEST_TMP/t2" quote
assert_neq "$RC" "6" "run-t2-eval: a successful call quoting an auth phrase does not stop"
if [ "$CALLS" -le 1 ]; then fail "run-t2-eval: quote case must run every job (calls=$CALLS)"; fi
t2_run "$TEST_TMP/t2" generic
assert_eq "$RC" "0" "run-t2-eval: a generic failure keeps its original exit code 0"
if [ "$CALLS" -le 1 ]; then fail "run-t2-eval: a generic failure must run every job (calls=$CALLS)"; fi
mk_layout "$TEST_TMP/t2-mut" mutant; t2_run "$TEST_TMP/t2-mut" auth; mutant_red "run-t2-eval" 1

# ============================ 7. evals/skill-transport/run-matrix.sh (one reviewer dispatch per cell) ============================
# outputs of a paid call: dispatch-review result JSON (names a raw_log) and stderr
rm_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/mx"; : > "$L/calls"; mkdir -p "$L/mx/kb" "$L/mx/clean" "$L/home"
  for c in a b; do echo "diff $c" > "$L/mx/kb/$c.diff"; echo "diff $c" > "$L/mx/clean/$c.diff"; done
  echo pack > "$L/mx/pack.md"; echo placebo > "$L/mx/placebo.md"
  cat > "$L/fake-review" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
raw="${FAKE_CALLS}.raw"; echo "nothing" > "$raw"
case "${FAKE_MODE}" in
  auth) echo '{"status":"precondition_failed","verdict":"","findings":"","error":"Failed to authenticate"}' ;;
  authraw) echo "OAuth session expired" > "$raw"; printf '{"status":"no_verdict","verdict":"","findings":"","raw_log":"%s"}\n' "$raw" ;;
  autherr) echo "Failed to authenticate" >&2; echo '{"status":"no_verdict","verdict":"","findings":""}' ;;
  authweak) echo "invalid api key" > "$raw"; printf '{"status":"no_verdict","verdict":"","findings":"","raw_log":"%s"}\n' "$raw" ;;
  exit0) echo "Please log in to continue." > "$raw"; printf '{"status":"no_verdict","verdict":"","findings":"","raw_log":"%s"}\n' "$raw" ;;
  cross) if [ "$(wc -l < "$FAKE_CALLS" | tr -d " ")" = 1 ]; then echo "the diff mentions Invalid API key" > "$raw"; printf '{"status":"reviewed","verdict":"SHIP-AS-IS","findings":"","raw_log":"%s"}\n' "$raw"
         else echo "429 rate limit" >&2; echo "429 rate limit" > "$raw"; printf '{"status":"no_verdict","verdict":"","findings":"","raw_log":"%s"}\n' "$raw"; fi ;;
  quote) echo "the diff mentions Invalid API key" > "$raw"; printf '{"status":"reviewed","verdict":"SHIP-AS-IS","findings":"","raw_log":"%s"}\n' "$raw" ;;
  *) echo "429 rate limit" >&2; echo '{"status":"no_verdict","verdict":"","findings":""}' ;;
esac
EOS
  chmod +x "$L/fake-review"
  OUT="$("${ENVX[@]}" HOME="$L/home" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" DISPATCH_REVIEW_CMD="$L/fake-review" \
    bash "$L/evals/skill-transport/run-matrix.sh" --engine e1 --runner r --model m --arms nopack --known-bad-dir "$L/mx/kb" --clean-dir "$L/mx/clean" \
      --pack "$L/mx/pack.md" --placebo "$L/mx/placebo.md" --out "$L/mx/out.jsonl" --seed 7 < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/rm"
rm_run "$TEST_TMP/rm" auth;    stop_case "run-matrix (result JSON)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" authraw; stop_case "run-matrix (raw_log only)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" autherr; stop_case "run-matrix (stderr only)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" authweak; stop_case "run-matrix (failed result, weak phrase in raw_log)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" exit0;    stop_case "run-matrix (exit 0, status no_verdict, only an auth message in raw_log)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" cross;    quote_case "run-matrix (call 1 ok quoting, later calls fail 429)" 4
rm_run "$TEST_TMP/rm" quote;    quote_case "run-matrix" 4
rm_run "$TEST_TMP/rm" generic
assert_eq "$CALLS" "4" "run-matrix: a generic failure runs every cell"
assert_neq "$RC" "6" "run-matrix: a generic failure does not exit 6"
mk_layout "$TEST_TMP/rm-mut" mutant; rm_run "$TEST_TMP/rm-mut" authraw; mutant_red "run-matrix" 1

# ============================ 8. evals/skill-transport/run-implementer-matrix.sh (one codex dispatch per cell) ============================
# outputs of a paid call: dispatch.json (names an agent_log) and dispatch.stderr
im_run() {
  local L="$1" mode="$2" t pk
  rm -rf "$L/calls" "$L/im"; : > "$L/calls"; mkdir -p "$L/im/tasks" "$L/home"; : > "$L/scripts/dispatch-hetero.sh"; echo "process.exit(0);" > "$L/scripts/engine-capability-state.js"
  pk="$(sha256sum "$L/evals/skill-transport/packs/implementer-pack.md" | awk '{print $1}')"
  local entries=""
  for t in ta tb; do
    mkdir -p "$L/im/tasks/$t/repo"; echo "base" > "$L/im/tasks/$t/repo/f.txt"; echo "task $t" > "$L/im/tasks/$t/task.md"
    printf '#!/usr/bin/env bash\necho "STATUS: FAIL"\nexit 1\n' > "$L/im/tasks/$t/oracle.sh"
    entries="$entries{\"id\":\"$t\",\"path\":\"$t\",\"task_sha256\":\"$(sha256sum "$L/im/tasks/$t/task.md" | awk '{print $1}')\",\"oracle_sha256\":\"$(sha256sum "$L/im/tasks/$t/oracle.sh" | awk '{print $1}')\",\"verify_cmd\":[\"bash\",\"oracle.sh\"]},"
  done
  printf '{"schema_version":1,"pack_sha256":"%s","tasks":[%s]}\n' "$pk" "${entries%,}" > "$L/im/manifest.json"
  cat > "$L/fake-impl-dispatch" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
log="${FAKE_CALLS}.agent.log"; echo "fine" > "$log"
case "${FAKE_MODE}" in
  auth) echo '{"status":"failure","model_calls":1,"error":"Failed to authenticate"}' ;;
  authlog) echo "OAuth session expired" > "$log"; printf '{"status":"failure","model_calls":1,"agent_log":"%s"}\n' "$log" ;;
  autherr) echo "Failed to authenticate" >&2; echo '{"status":"failure","model_calls":1}' ;;
  exit0) echo "Please log in to continue." > "$log"; printf '{"status":"no_op","model_calls":1,"agent_log":"%s"}\n' "$log" ;;
  review-*) echo "work $RANDOM" > "w-$RANDOM.txt"; git add -A >/dev/null 2>&1; git commit -qm work >/dev/null 2>&1
    printf '{"status":"committed","commit":"%s","model_calls":1,"skill_mode_effective":"off","worktree":""}\n' "$(git rev-parse HEAD)" ;;
  *) echo "429 rate limit" >&2; echo '{"status":"failure","model_calls":1}' ;;
esac
EOS
  chmod +x "$L/fake-impl-dispatch"
  : > "$L/rcalls"
  cat > "$L/fake-reviewer" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_RCALLS:?}"
case "${FAKE_MODE}" in
  review-auth) echo '{"status":"precondition_failed","error":"Failed to authenticate"}'; exit 1 ;;
  review-authweak) echo "error: invalid api key" >&2; echo '{"status":"no_verdict"}'; exit 1 ;;
  review-quote) echo "the diff mentions Invalid API key" >&2; echo '{"status":"reviewed","verdict":"SHIP-AS-IS","findings":""}'; exit 0 ;;
esac
EOS
  chmod +x "$L/fake-reviewer"
  OUT="$("${ENVX[@]}" HOME="$L/home" FAKE_CALLS="$L/calls" FAKE_RCALLS="$L/rcalls" FAKE_MODE="$mode" \
    bash "$L/evals/skill-transport/run-implementer-matrix.sh" --test-mode --manifest "$L/im/manifest.json" --tasks-root "$L/im/tasks" \
      --pack "$L/evals/skill-transport/packs/implementer-pack.md" --out "$L/im/out.jsonl" --seed-file "$L/im/seed" --seed 5 \
      --private-root "$L/im/private" --dispatch-cmd "$L/fake-impl-dispatch" --reviewer-cmd "$L/fake-reviewer" --codex-bin /bin/true < /dev/null 2>&1)"
  RC=$?; CALLS=$(( $(count "$L/calls") + $(count "$L/rcalls") ))
}
mk_layout "$TEST_TMP/im"
im_run "$TEST_TMP/im" auth;    stop_case "run-implementer-matrix (dispatch.json)" 1 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" authlog; stop_case "run-implementer-matrix (agent_log only)" 1 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" autherr; stop_case "run-implementer-matrix (stderr only)" 1 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" exit0;           stop_case "run-implementer-matrix (dispatch exit 0, status no_op, only an auth message)" 1 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" review-auth;     stop_case "run-implementer-matrix (reviewer call, result JSON)" 2 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" review-authweak; stop_case "run-implementer-matrix (failed reviewer, weak phrase in stderr)" 2 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" review-quote
assert_neq "$RC" "6" "run-implementer-matrix: a successful reviewer quoting an auth phrase does not stop"
if [ "$CALLS" -le 2 ]; then fail "run-implementer-matrix: reviewer quote case must run every cell (calls=$CALLS) -- $OUT"; fi
im_run "$TEST_TMP/im" generic
assert_neq "$RC" "6" "run-implementer-matrix: a generic failure does not exit 6"
if [ "$CALLS" -le 1 ]; then fail "run-implementer-matrix: a generic failure must run every cell (calls=$CALLS) -- $OUT"; fi
mk_layout "$TEST_TMP/im-mut" mutant; im_run "$TEST_TMP/im-mut" authlog; mutant_red "run-implementer-matrix (dispatch)" 1
im_run "$TEST_TMP/im-mut" review-auth; mutant_red "run-implementer-matrix (reviewer)" 2

# ============================ 9. evals/pipeline-bench/run-pipeline-bench.sh (author rounds + reviewer calls) ============================
# outputs of a paid call: RAW_LOG (claude stdout+stderr), the reviewer's result JSON (names a raw_log) and its stderr (into RAW_LOG)
pb_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/rcalls" "$L/fb" "$L/pb-out" "$L/evals/orchestration"; : > "$L/calls"; : > "$L/rcalls"; mkdir -p "$L/fb" "$L/evals/orchestration/tasks/t1/repo" "$L/home"
  echo base > "$L/evals/orchestration/tasks/t1/repo/f.txt"; echo "do it" > "$L/evals/orchestration/tasks/t1/task.md"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$L/scripts/error-path-scan.sh"; echo "process.exit(0);" > "$L/scripts/secret-scan-diff.js"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
echo "change $RANDOM" >> f.txt
case "${FAKE_MODE}" in
  claude-auth) echo "Failed to authenticate" >&2; exit 1 ;;
  claude-authweak) echo "error: invalid api key" >&2; exit 1 ;;
  claude-exit0) echo "Please log in to continue."; exit 0 ;;
  cross) if [ "$(wc -l < "$FAKE_CALLS" | tr -d " ")" = 1 ]; then echo '{"type":"result","is_error":false,"result":"the docs say Invalid API key","total_cost_usd":0}'; exit 0; fi
         echo "API Error: 429 rate limit" >&2; exit 1 ;;
  quote) echo '{"type":"result","is_error":false,"result":"the docs say Invalid API key","total_cost_usd":0}'; exit 0 ;;
esac
echo '{"type":"result","is_error":false,"result":"done","total_cost_usd":0}'
EOS
  chmod +x "$L/fb/claude"
  cat > "$L/fake-review" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_RCALLS:?}"
raw="${FAKE_RCALLS}.raw"; echo ok > "$raw"
case "${FAKE_MODE}" in
  review-auth) echo '{"status":"no_verdict","verdict":"null","findings":"","error":"Failed to authenticate"}' ;;
  review-exit0) echo "Please log in to continue." >&2; echo '{"status":"no_verdict","verdict":"null","findings":""}' ;;
  review-cross429) echo "API Error: 429 rate limit" >&2; echo '{"status":"no_verdict","verdict":"null","findings":""}'; exit 1 ;;
  review-authraw) echo "OAuth session expired" > "$raw"; printf '{"status":"no_verdict","verdict":"null","findings":"","raw_log":"%s"}\n' "$raw" ;;
  *) echo '{"status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"fix it"}' ;;
esac
EOS
  chmod +x "$L/fake-review"
  OUT="$("${ENVX[@]}" HOME="$L/home" PATH="$L/fb:$PATH" FAKE_CALLS="$L/calls" FAKE_RCALLS="$L/rcalls" FAKE_MODE="$mode" PIPELINE_BENCH_REVIEW_CMD="$L/fake-review" \
    bash "$L/evals/pipeline-bench/run-pipeline-bench.sh" --task t1 --arm pipeline --model m --out "$L/pb-out" --max-rounds 3 < /dev/null 2>&1)"
  RC=$?; CALLS=$(( $(count "$L/calls") + $(count "$L/rcalls") ))
}
mk_layout "$TEST_TMP/pb"
pb_run "$TEST_TMP/pb" claude-auth;    stop_case "run-pipeline-bench (author call, RAW_LOG)" 1 "t1/round-1:"
pb_run "$TEST_TMP/pb" claude-authweak; stop_case "run-pipeline-bench (failed author call, weak phrase in merged log)" 1 "t1/round-1:"
pb_run "$TEST_TMP/pb" claude-exit0;   stop_case "run-pipeline-bench (author call exit 0, only an auth message)" 1 "t1/round-1:"
pb_run "$TEST_TMP/pb" cross
assert_neq "$RC" "6" "run-pipeline-bench: round 1 ok quoting, round 2 fails 429 -> not an auth stop (RAW_LOG is cumulative, never judged)"
if [ "$CALLS" -le 2 ]; then fail "run-pipeline-bench: cross case must reach round 2 (calls=$CALLS) -- $OUT"; fi
pb_run "$TEST_TMP/pb" quote
assert_neq "$RC" "6" "run-pipeline-bench: a successful call quoting an auth phrase does not stop"
pb_run "$TEST_TMP/pb" review-auth;    stop_case "run-pipeline-bench (reviewer result JSON)" 2 "t1/review-1:"
pb_run "$TEST_TMP/pb" review-exit0;   stop_case "run-pipeline-bench (reviewer exit 0, status no_verdict, only an auth message in stderr)" 2 "t1/review-1:"
pb_run "$TEST_TMP/pb" review-cross429
assert_neq "$RC" "6" "run-pipeline-bench: a reviewer 429 failure is not an auth stop"
pb_run "$TEST_TMP/pb" review-authraw; stop_case "run-pipeline-bench (reviewer raw_log only)" 2 "t1/review-1:"
pb_run "$TEST_TMP/pb" generic
assert_neq "$RC" "6" "run-pipeline-bench: a generic failure does not exit 6"
if [ "$CALLS" -le 2 ]; then fail "run-pipeline-bench: a generic failure must keep running rounds (calls=$CALLS) -- $OUT"; fi
mk_layout "$TEST_TMP/pb-mut" mutant; pb_run "$TEST_TMP/pb-mut" review-authraw; mutant_red "run-pipeline-bench" 2

# ============================ 10. scripts/benchmark-hook-latency.js (one claude -p per arm and sample) ============================
# outputs of a paid call: stdout (JSON envelope) and stderr
bh_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/fb" "$L/bh"; : > "$L/calls"; mkdir -p "$L/fb" "$L/bh" "$L/home" "$L/hooks-repo/hooks"
  echo '{"hooks":{}}' > "$L/hooks-repo/hooks/hooks.json"
  ( cd "$L/hooks-repo" && git init -q -b main && git config user.email t@t.invalid && git config user.name t && git add -A && git commit -q -m x )
  echo '{}' > "$L/bh/cred.json"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  auth) echo '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login","total_cost_usd":0}'; exit 1 ;;
  autherr) echo "OAuth session expired" >&2; exit 1 ;;
  authweak) echo "error: invalid api key" >&2; exit 1 ;;
  exit0) echo "Please log in to continue."; exit 0 ;;
  cross) if [ "$(wc -l < "$FAKE_CALLS" | tr -d " ")" = 1 ]; then echo '{"type":"result","is_error":false,"result":"Invalid API key is a phrase","total_cost_usd":0.01}'; exit 0; fi
         echo "API Error: 429 rate limit" >&2; exit 1 ;;
  quote) echo '{"type":"result","is_error":false,"result":"Invalid API key is a phrase","total_cost_usd":0.01}'; exit 0 ;;
  *) echo "API Error: 429 rate limit" >&2; exit 1 ;;
esac
EOS
  chmod +x "$L/fb/claude"
  OUT="$(cd "$L/hooks-repo" && "${ENVX[@]}" HOME="$L/home" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" BENCH_CLAUDE_BIN="$L/fb/claude" BENCH_CREDENTIALS="$L/bh/cred.json" \
    node "$L/scripts/benchmark-hook-latency.js" --max-usd 5 --samples 2 --out "$L/bh/report.json" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/bh"
bh_run "$TEST_TMP/bh" auth;    stop_case "benchmark-hook-latency (stdout envelope)" 1 "enabled sample 1:"
bh_run "$TEST_TMP/bh" autherr; stop_case "benchmark-hook-latency (stderr)" 1 "enabled sample 1:"
assert_file_absent "$TEST_TMP/bh/bh/report.json" "benchmark-hook-latency: no report is written on the auth stop"
bh_run "$TEST_TMP/bh" authweak; stop_case "benchmark-hook-latency (failed call, weak phrase)" 1 "enabled sample 1:"
bh_run "$TEST_TMP/bh" exit0;   stop_case "benchmark-hook-latency (exit 0, stdout is only an auth message)" 1 "enabled sample 1:"
bh_run "$TEST_TMP/bh" cross
assert_neq "$RC" "6" "benchmark-hook-latency: call 1 ok quoting, later calls fail 429 -> not an auth stop"
bh_run "$TEST_TMP/bh" quote
assert_neq "$RC" "6" "benchmark-hook-latency: a successful call quoting an auth phrase does not stop"
bh_run "$TEST_TMP/bh" generic
assert_neq "$RC" "6" "benchmark-hook-latency: a generic failure does not exit 6"
if [ "$CALLS" -le 1 ]; then fail "benchmark-hook-latency: a generic failure must keep sampling (calls=$CALLS) -- $OUT"; fi
assert_eq "$RC" "4" "benchmark-hook-latency: a generic failure keeps its original exit code 4 (refused conclusion)"
mk_layout "$TEST_TMP/bh-mut" mutant; bh_run "$TEST_TMP/bh-mut" auth; mutant_red "benchmark-hook-latency" 1

# ============================ 11. scripts/run-skill-opt.sh (external run_loop -> run_eval, 3 iterations x parallel queries) ============================
# The external skill-creator (run_loop.py / run_eval.py / improve_description.py) is replaced by a minimal package with the behaviour that
# matters (see the stand-in notes in section 1): 3 iterations, each starting 3 parallel `claude -p` queries, the child killed on the
# first result line, exit codes never read. The anthropic SDK is stubbed. HOME is a throwaway dir with fake credentials.
so_run() {   # <layout> <mode>
  local L="$1" mode="$2" H="$1/home" SC
  rm -rf "$H" "$L/skills" "$L/skill-creator-workspace" "$L/calls" "$L/fb" "$L/pids" "$L/pids2"; : > "$L/calls"; : > "$L/pids"; : > "$L/pids2"
  SC="$H/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
  mkdir -p "$SC/scripts" "$L/skills/alpha" "$L/skill-creator-workspace/evals" "$L/tmp"
  : > "$L/skill-creator-workspace/evals/alpha-evals.json"
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({claudeAiOauth:{accessToken:"tok",expiresAt:Date.now()+36e5*5}}))' "$H/.claude/.credentials.json"
  write_standins "$L"; write_fake_claude "$L"
  : > "$SC/scripts/__init__.py"
  printf 'def improve_description(*a, **k):\n    return ""\n' > "$SC/scripts/improve_description.py"
  printf 'import sys\nclass Anthropic:\n    def __init__(self, **k): pass\n' > "$SC/anthropic.py"
  cat > "$SC/scripts/run_loop.py" <<EOS
import sys
sys.path.insert(0, "$L")
from scripts.improve_description import improve_description
import runpy
def main():
    runpy.run_path("$L/standin_loop.py", run_name="__main__")
EOS
  OUT="$("${ENVX[@]}" HOME="$H" TMPDIR="$L/tmp" PATH="$L/fb:$PATH" FAKE_CALLS="$L/calls" FAKE_PIDS="$L/pids" FAKE_PIDS2="$L/pids2" FAKE_MODE="$mode" \
    bash "$L/scripts/run-skill-opt.sh" alpha < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"; LEFT="$(procs_left "$L")"
}
mk_layout "$TEST_TMP/so"
so_run "$TEST_TMP/so" wrap-auth
assert_eq "$RC" "6" "run-skill-opt: the real-run_eval-like loop dies on authentication -> exit 6"
if [ "$CALLS" -lt 1 ] || [ "$CALLS" -gt 3 ]; then fail "run-skill-opt: at most the 3 queries already in flight may be paid, none of iterations 2 and 3 (calls=$CALLS) -- $OUT"; fi
assert_contains "$OUT" "STOP_AUTH after " "run-skill-opt: stop line"
assert_eq "$LEFT" "0" "run-skill-opt: nothing left behind"
so_run "$TEST_TMP/so" wrap-quote
assert_neq "$RC" "6" "run-skill-opt: successful calls quoting an auth phrase do not stop"
assert_eq "$CALLS" "9" "run-skill-opt: all 3 iterations x 3 queries run when nothing failed"
so_run "$TEST_TMP/so" wrap-cross
assert_neq "$RC" "6" "run-skill-opt: a 429 failure after a quoting success is not an auth stop"
# negative control: no capture wiring in the script (no record dir) -> all 9 paid calls happen and nothing stops
mk_layout "$TEST_TMP/so-mut"
grep -q '^claude_capture_begin ' "$TEST_TMP/so-mut/scripts/run-skill-opt.sh" || fail "run-skill-opt mutation anchor missing"
sed -i 's/^claude_capture_begin .*$/export EVAL_CALL_RECORD_DIR=/' "$TEST_TMP/so-mut/scripts/run-skill-opt.sh"
so_run "$TEST_TMP/so-mut" wrap-auth
if [ "$CALLS" -le 3 ]; then fail "run-skill-opt: wiring removed but only $CALLS calls -- negative control broken (rc=$RC)"; fi
echo "MUTANT-RED run-skill-opt (capture wiring removed): rc=$RC calls=$CALLS (every iteration paid)"
kill_grandchildren "$TEST_TMP/so-mut"

# ============================ 12. evals/test-behavior.sh (three run_skill claude -p calls) ============================
tb_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/fb"; : > "$L/calls"; mkdir -p "$L/fb" "$L/home"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  auth) echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Invalid API key · Please run /login"}'; exit 1 ;;
  exit0) echo "Please log in to continue."; exit 0 ;;
  quote) echo '{"type":"result","subtype":"success","is_error":false,"result":"verify branch test: the docs quote Invalid API key"}'; exit 0 ;;
  *) echo "API Error: 429 rate limit" >&2; exit 1 ;;
esac
EOS
  chmod +x "$L/fb/claude"
  OUT="$("${ENVX[@]}" HOME="$L/home" PATH="$L/fb:$PATH" AUTOPILOT_EVAL_INTEGRATION=1 FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    bash "$L/evals/test-behavior.sh" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/tb"; cp "$REPO_ROOT/evals/test-helpers.sh" "$REPO_ROOT/evals/test-behavior.sh" "$TEST_TMP/tb/evals/"
tb_run "$TEST_TMP/tb" auth;  stop_case "test-behavior (json is_error)" 1 "run_skill:"
tb_run "$TEST_TMP/tb" exit0; stop_case "test-behavior (exit 0, only an auth message)" 1 "run_skill:"
tb_run "$TEST_TMP/tb" quote
assert_neq "$RC" "6" "test-behavior: a successful call quoting a phrase does not stop"
assert_eq "$CALLS" "3" "test-behavior: all three calls run"
tb_run "$TEST_TMP/tb" generic
assert_neq "$RC" "6" "test-behavior: a 429 failure is not an auth stop"
assert_eq "$CALLS" "3" "test-behavior: every call still runs after a 429 failure"
mk_layout "$TEST_TMP/tb-mut"; cp "$REPO_ROOT/evals/test-helpers.sh" "$REPO_ROOT/evals/test-behavior.sh" "$TEST_TMP/tb-mut/evals/"
sed -i 's/^stop_if_auth_failed .*$//; s/auth_stop_check /:  /' "$TEST_TMP/tb-mut/evals/test-behavior.sh" "$TEST_TMP/tb-mut/evals/test-helpers.sh"
tb_run "$TEST_TMP/tb-mut" auth; mutant_red "test-behavior" 1

finalize_test
