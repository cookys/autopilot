#!/usr/bin/env bash
# dispatch-hetero --runner opencode integration test (v2.35.12).
#
# The opencode rail is grok/qoderclicn-shaped: EDIT-ONLY directive prepended, prompt via
# STDIN, `opencode run --dir <wt> --pure -m <model> --format json`, wrapper commits, verdict
# from git artifacts. Only the binary is stubbed; the real dispatch-hetero.sh runs.
. "$(dirname "$0")/lib.sh"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
export DISPATCH_QUIET=1
ARGV_LOG="$TEST_TMP/argv.log"
STDIN_LOG="$TEST_TMP/stdin.log"

# Stub opencode: records argv + stdin, honors --dir, writes a file (committed path).
STUB_OK="$TEST_TMP/opencode-ok"
cat > "$STUB_OK" <<__EOF1
#!/usr/bin/env bash
printf '%s\n' "\$*" > "$ARGV_LOG"
cat > "$STDIN_LOG"
dir=""
while [ \$# -gt 0 ]; do case "\$1" in --dir) dir="\$2"; shift 2 ;; *) shift ;; esac; done
[ -n "\$dir" ] || { echo "no --dir" >&2; exit 9; }
printf '%s\n' '{"type":"step_start","timestamp":1}'
printf '%s\n' '{"type":"tool_use","part":{"tool":"write","state":{"status":"completed"}}}'
echo opencode-edited > "\$dir/oc_out.txt"
printf '%s\n' '{"type":"step_finish","part":{"reason":"stop","tokens":{"total":100,"input":50,"output":20,"reasoning":10,"cache":{"write":0,"read":20}}}}'
__EOF1
chmod +x "$STUB_OK"

# Stub opencode: no edit, exit 0 (no_op).
STUB_NOOP="$TEST_TMP/opencode-noop"
cat > "$STUB_NOOP" <<'__EOF2'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' '{"type":"text","part":{"text":"nothing to do"}}'
__EOF2
chmod +x "$STUB_NOOP"

# Stub opencode: exits non-zero.
STUB_FAIL="$TEST_TMP/opencode-fail"
cat > "$STUB_FAIL" <<'__EOF3'
#!/usr/bin/env bash
cat >/dev/null
echo "provider error" >&2
exit 1
__EOF3
chmod +x "$STUB_FAIL"

# 1) committed path
OUT="$(cd "$SBX" && "$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor --branch feat/oc-ok --prompt-file "$PROMPT" --opencode-bin "$STUB_OK" --context-window off 2>&1)"
RC=$?
assert_eq "0" "$RC" "opencode committed path exit 0"
assert_contains "$OUT" '"status": "committed"' "opencode committed status"
assert_contains "$OUT" '"runner": "opencode"' "opencode runner in final JSON"
assert_contains "$OUT" '"model": "opencode-go/muse-spark-1.3-contributor"' "model id passed through verbatim"
OUT_JSON="$(printf '%s\n' "$OUT" | grep '^{ "status"' | tail -1)"
assert_contains "$OUT_JSON" '"files_changed": 1' "one file committed by the wrapper"
# argv contract: run --dir <wt> --pure -m <model> --format json
ARGV="$(cat "$ARGV_LOG")"
assert_contains "$ARGV" 'run --dir ' "argv starts with run --dir"
assert_contains "$ARGV" ' --pure ' "argv carries --pure (no external plugins)"
assert_contains "$ARGV" ' -m opencode-go/muse-spark-1.3-contributor ' "argv carries -m <model>"
assert_contains "$ARGV" ' --format json' "argv carries --format json"
# prompt via STDIN with the EDIT-ONLY directive prepended, task text intact
STDIN="$(cat "$STDIN_LOG")"
assert_contains "$STDIN" 'HARNESS DIRECTIVE' "STDIN prompt carries the EDIT-ONLY directive"
assert_contains "$STDIN" 'Do NOT
git commit' "directive forbids committing"
assert_contains "$STDIN" 'update repo file' "STDIN prompt carries the task text"
# the commit landed on the branch, HEAD of the caller repo untouched
assert_eq "base" "$(git -C "$SBX" log -1 --format=%s)" "caller HEAD untouched"
assert_eq "opencode-edited" "$(git -C "$SBX" show feat/oc-ok:oc_out.txt)" "edited file is on the dispatch branch"
RUN_ID="$(printf '%s' "$OUT_JSON" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p')"
assert_file_exists "$RUNS_DIR/$RUN_ID.manifest.json" "opencode run manifest written"
assert_contains "$(cat "$RUNS_DIR/$RUN_ID.manifest.json")" '"runner": "opencode"' "manifest runner provenance"
assert_contains "$(cat "$RUNS_DIR/$RUN_ID.manifest.json")" '"log_format": "plain"' "manifest log_format plain (usage parsing is a follow-up)"

# 2) no_op path
OUT="$(cd "$SBX" && "$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor --branch feat/oc-noop --prompt-file "$PROMPT" --opencode-bin "$STUB_NOOP" --context-window off 2>&1)"
assert_contains "$OUT" '"status": "no_op"' "no edit → no_op"
assert_contains "$OUT" '"runner": "opencode"' "no_op keeps runner provenance"

# 3) failure path
OUT="$(cd "$SBX" && "$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor --branch feat/oc-fail --prompt-file "$PROMPT" --opencode-bin "$STUB_FAIL" --context-window off 2>&1)"
RC=$?
# same classification every rail gives a nonzero exit with no commit: question_suspected
assert_contains "$OUT" '"status": "question_suspected"' "nonzero exit + no edit → question_suspected (worktree kept)"
assert_not_contains "$OUT" '"status": "committed"' "failure path is not committed"
[ "$RC" -ne 0 ] && assert_eq ok ok "failure path exits nonzero" || fail "failure path exited 0"

# 4) preconditions: missing binary; auto never selects opencode; --model required
OUT="$(cd "$SBX" && "$SCRIPT" --runner opencode --model opencode-go/x --branch feat/oc-nobin --prompt-file "$PROMPT" --opencode-bin "$TEST_TMP/does-not-exist" --context-window off 2>&1)"
assert_contains "$OUT" '"status": "precondition_failed"' "missing opencode binary fails closed"
assert_contains "$OUT" 'opencode binary not found' "missing binary names the fix"
OUT="$(cd "$SBX" && "$SCRIPT" --runner auto --model opencode-go/muse-spark-1.3-contributor --branch feat/oc-auto --prompt-file "$PROMPT" --agy-bin "$TEST_TMP/does-not-exist" --context-window off 2>&1)"
assert_not_contains "$OUT" '"runner": "opencode"' "auto never routes a provider/model id to opencode"
OUT="$(cd "$SBX" && "$SCRIPT" --runner bogus --model x --branch feat/oc-enum --prompt-file "$PROMPT" 2>&1)"
assert_contains "$OUT" 'qoderclicn|cursor|opencode' "runner enum error names opencode"

finalize_test
