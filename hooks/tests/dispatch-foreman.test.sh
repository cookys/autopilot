#!/usr/bin/env bash
# dispatch-foreman.test.sh — the non-Claude foreman rail (Shape B), every rail-owned
# enforcement from docs/plans/2026-09-13-foreman-rail-b-build.md pinned against a PATH-stubbed
# `kimi` (no network, no live LLM). The stub is driven ONLY through KIMI_* variables, which
# doubles as the proof that the allowlisted env reaches the foreman and nothing else does.
#
#   1  preconditions and argv hygiene
#   2  completed run: inputs copied read-only, -p stays small, stream OUTSIDE the worktree,
#      env allowlist (secret absent, KIMI_* present, push block present, depth=1), worktree
#      removed, branch left at base
#   3  tool cap: kill at N > cap, process group empty, forced handoff turn (-c, same cwd),
#      HANDOFF.md → handoff_written=true, worktree retained
#   4  deadline: no handoff written → handoff_written=false is DISTINGUISHABLE from a cap
#   5  escalation → worktree kept → --resume with an answer → completed
#   6  main checkout touched → main_checkout_mutated
#   7  merge commit on the foreman branch → foreman_integrated
#   8  plain foreman commit → allowed, counted; force-added ignored file → unsafe_commit_content
#   9  hands branches under hands/<run>/ are listed; a rogue ref is a mutation
#  10  push to a file remote is blocked by the env (remote unchanged)
#  11  --ledger: durable result + exit files; wait-dispatch-results.js finds them
#  12  a REAL nested dispatch-hetero.sh (agy stub) under the foreman env lands its commit
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

SCRIPT="$REPO_ROOT/scripts/dispatch-foreman.sh"
WAIT="$REPO_ROOT/scripts/wait-dispatch-results.js"

# --- sandbox main checkout + a bare remote ---------------------------------------------
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
printf 'secret.env\n' > "$SBX/.gitignore"
git -C "$SBX" add .gitignore && git -C "$SBX" -c user.email=t@t -c user.name=t commit -q -m gitignore
# a side branch with its OWN commit (so a merge of it is a real merge commit, not a no-op)
git -C "$SBX" update-ref refs/heads/side "$(git -C "$SBX" -c user.email=t@t -c user.name=t commit-tree "HEAD^{tree}" -p HEAD -m side-tip)"
REMOTE="$TEST_TMP/remote.git"; git init -q --bare "$REMOTE"
git -C "$SBX" remote add origin "$REMOTE"
git -C "$SBX" -c protocol.file.allow=always push -q origin develop 2>/dev/null
REMOTE_BEFORE="$(git -C "$REMOTE" rev-parse develop)"
BASE="$(git -C "$SBX" rev-parse HEAD)"

BRIEF="$TEST_TMP/brief.md"; PLAN="$TEST_TMP/plan.md"
echo "brief: do the plan" > "$BRIEF"; echo "plan: one unit" > "$PLAN"

# --- the kimi stub -----------------------------------------------------------------------
# Driven by KIMI_STUB_MODE: complete | spin | hang | escalate | script. Every invocation appends
# its argv to $KIMI_STUB_LOG, dumps its env to $KIMI_STUB_DIR/env.<n>, and its cwd to cwd.<n>.
# A `-c` invocation (the rail's handoff/resume turn) is honoured by KIMI_STUB_CONTINUE_MODE.
STUBDIR="$TEST_TMP/bin"; mkdir -p "$STUBDIR"
cat > "$STUBDIR/kimi" <<'STUB'
#!/usr/bin/env bash
n=0; while [ -e "$KIMI_STUB_DIR/argv.$n" ]; do n=$((n+1)); done
printf '%s\n' "$@" > "$KIMI_STUB_DIR/argv.$n"
env | LC_ALL=C sort > "$KIMI_STUB_DIR/env.$n"
pwd > "$KIMI_STUB_DIR/cwd.$n"
echo "$$" > "$KIMI_STUB_DIR/pid.$n"
mode="$KIMI_STUB_MODE"; cont=0
for a in "$@"; do [ "$a" = "-c" ] && cont=1; done
[ "$cont" -eq 1 ] && [ -n "${KIMI_STUB_CONTINUE_MODE:-}" ] && mode="$KIMI_STUB_CONTINUE_MODE"
echo '{"role":"meta","type":"system.version","version":"0.41.0"}'
call() { printf '{"role":"assistant","tool_calls":[{"type":"function","id":"t%s","function":{"name":"Bash","arguments":"{\\"command\\":\\"%s\\"}"}}]}\n' "$1" "$2"; printf '{"role":"tool","tool_call_id":"t%s","content":"ok"}\n' "$1"; }
finish() { printf '{"role":"assistant","content":"DONE"}\n{"role":"meta","type":"session.resume_hint","session_id":"session_stub_%s","command":"kimi -r x","content":"x"}\n' "$n"; }
case "$mode" in
  complete)
    echo "raw stdout leak line with \"name\":\"Bash\" inside — must NOT be counted"
    for i in 1 2 3; do call "$i" "echo $i"; sleep 0.1; done
    printf 'done: unit-1\nnot done: (none)\n' > "$KIMI_STUB_REPORT_DIR/REPORT.md"
    finish ;;
  spin)   i=0; while :; do i=$((i+1)); call "$i" "echo spin"; sleep 0.2; done ;;
  hang)   while :; do sleep 1; done ;;
  escalate)
    call 1 "echo q"; printf 'Question: which unit first?\n' > "$KIMI_STUB_REPORT_DIR/ESCALATION.md"; finish ;;
  handoff)
    call 1 "echo h"; printf 'done: part\nnot done: unit-2, unit-3\n' > "$KIMI_STUB_REPORT_DIR/HANDOFF.md"; finish ;;
  script)
    call 1 "bash script"; bash "$KIMI_STUB_SCRIPT" > "$KIMI_STUB_DIR/script.out.$n" 2>&1; echo "script rc=$?" >> "$KIMI_STUB_DIR/script.out.$n"
    printf 'done: script\nnot done: (none)\n' > "$KIMI_STUB_REPORT_DIR/REPORT.md"; finish ;;
  fail)   call 1 "echo boom"; exit 3 ;;
  *) echo "stub: unknown mode $mode" >&2; exit 9 ;;
esac
STUB
chmod +x "$STUBDIR/kimi"

RUNS="$TEST_TMP/runs"; mkdir -p "$RUNS"
N=0
# run_foreman <mode> <run_id> [extra rail args...] → OUT, RC, RD (run dir), SD (stub dir)
run_foreman() {
  local mode="$1" rid="$2"; shift 2
  N=$((N+1)); SD="$TEST_TMP/stub.$N"; mkdir -p "$SD"; RD="$RUNS/$rid"
  OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" SECRET_TOKEN=leak-me \
    KIMI_STUB_MODE="$mode" KIMI_STUB_DIR="$SD" KIMI_STUB_REPORT_DIR="$RD" KIMI_STUB_SCRIPT="${STUB_SCRIPT:-}" \
    KIMI_STUB_CONTINUE_MODE="${CONTINUE_MODE:-}" \
    bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" --run-id "$rid" --run-dir "$RD" --poll 0.2 "$@" 2>"$TEST_TMP/stderr.$N")"
  RC=$?
}
field() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=j[process.argv[1]];process.stdout.write(v===undefined?"<undef>":(typeof v==="object"?JSON.stringify(v):String(v)));})' "$2"; }

# ======================================================================= 1 preconditions
OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" bash "$SCRIPT" --plan-file "$PLAN" 2>/dev/null)"; RC=$?
assert_eq "$RC" "2" "1: missing brief → 2"
assert_contains "$OUT" '"status":"precondition_failed"' "1: precondition status"
OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" --bogus 2>/dev/null)"; RC=$?
assert_eq "$RC" "2" "1: unknown arg → 2"
OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" --tool-cap 0 --run-dir "$RUNS/pc1" 2>/dev/null)"; RC=$?
assert_eq "$RC" "2" "1: --tool-cap 0 → 2"
OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" --env-passthrough 'BAD-NAME' --run-dir "$RUNS/pc2" 2>/dev/null)"; RC=$?
assert_eq "$RC" "2" "1: bad passthrough name → 2"
OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" --kimi-bin /nonexistent/kimi --run-dir "$RUNS/pc3" 2>/dev/null)"; RC=$?
assert_eq "$RC" "2" "1: missing kimi → 2"
assert_contains "$OUT" 'kimi binary not found' "1: missing kimi named"
OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" bash "$SCRIPT" --resume --run-dir "$RUNS/nope" --answer-file "$PLAN" 2>/dev/null)"; RC=$?
assert_eq "$RC" "2" "1: resume of a non-run-dir → 2"
assert_eq "$(git -C "$SBX" worktree list --porcelain | grep -c '^worktree .*/foreman-')" "0" "1: preconditions created no worktree"

# ======================================================================= 2 completed
run_foreman complete r2 --env-passthrough PASS_ME --model kimi-code/k3
assert_eq "$RC" "0" "2: completed → exit 0"
assert_eq "$(field "$OUT" status)" "completed" "2: status completed"
assert_eq "$(field "$OUT" report_written)" "true" "2: report_written"
assert_eq "$(field "$OUT" tool_calls)" "3" "2: three Bash calls counted, the raw leak line NOT counted"
assert_eq "$(field "$OUT" base_sha)" "$BASE" "2: base pinned to HEAD sha"
assert_eq "$(field "$OUT" foreman_head)" "$BASE" "2: foreman branch left at base"
assert_eq "$(field "$OUT" foreman_commits)" "0" "2: no foreman commits"
assert_eq "$(field "$OUT" session_id)" "session_stub_0" "2: session id captured from resume hint"
assert_eq "$(field "$OUT" egress_policy)" "unbounded" "2: egress declared unbounded"
assert_eq "$(field "$OUT" env_policy)" "allowlist" "2: env policy declared"
assert_contains "$(field "$OUT" env_passthrough)" 'PASS_ME' "2: passthrough listed"
assert_file_exists "$RD/foreman.stream.jsonl" "2: stream log in run dir"
assert_eq "$(field "$OUT" stream_log)" "$RD/foreman.stream.jsonl" "2: stream_log path reported"
WT2="$(field "$OUT" worktree)"
case "$RD" in "$WT2"*) fail "2: run dir must be OUTSIDE the worktree" ;; *) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) ;; esac
[ -d "$WT2" ] && fail "2: worktree removed after clean completion" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
assert_eq "$(stat -c %a "$RD/brief.md")" "444" "2: brief copied read-only"
assert_file_exists "$RD/protocol.md" "2: protocol written"
assert_contains "$(cat "$RD/protocol.md")" "hands/r2/" "2: protocol names the hands namespace"
assert_contains "$(cat "$RD/protocol.md")" "wait-dispatch-results.js" "2: protocol points at the wait primitive"
# argv: -m model, -p under 1 KB, stream-json
ARGV="$(cat "$SD/argv.0")"
assert_contains "$ARGV" "kimi-code/k3" "2: model passed"
assert_contains "$ARGV" "stream-json" "2: stream-json requested"
PLEN="$(awk 'prev=="-p"{print length($0); exit} {prev=$0}' "$SD/argv.0")"
[ "${PLEN:-9999}" -lt 1024 ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "2: -p prompt stays under 1 KB (got $PLEN)"
# cwd = worktree
assert_eq "$(cat "$SD/cwd.0")" "$WT2" "2: kimi cwd is the foreman worktree"
# env allowlist
ENV0="$(cat "$SD/env.0")"
assert_not_contains "$ENV0" "SECRET_TOKEN" "2: secret NOT in foreman env"
assert_contains "$ENV0" "KIMI_STUB_MODE=complete" "2: KIMI_* passes"
assert_contains "$ENV0" "GIT_ALLOW_PROTOCOL=" "2: push block env present"
assert_contains "$ENV0" "=protocol.allow" "2: protocol.allow deny present"
assert_contains "$ENV0" "AUTOPILOT_DISPATCH_DEPTH=1" "2: hands will be depth 2"
assert_contains "$ENV0" "AUTOPILOT_PARENT_RUN_ID=r2" "2: parent run id forwarded"
assert_contains "$ENV0" "HOME=" "2: HOME kept"
# branch remains, at base
assert_eq "$(git -C "$SBX" rev-parse foreman/r2)" "$BASE" "2: foreman branch exists at base"

# passthrough value actually arrives when set
N=$((N+1)); SD="$TEST_TMP/stub.$N"; mkdir -p "$SD"; RD="$RUNS/r2b"
OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" PASS_ME=yes KIMI_STUB_MODE=complete KIMI_STUB_DIR="$SD" KIMI_STUB_REPORT_DIR="$RD" \
  bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" --run-id r2b --run-dir "$RD" --poll 0.2 --env-passthrough PASS_ME 2>/dev/null)"
assert_contains "$(cat "$SD/env.0")" "PASS_ME=yes" "2: passthrough value delivered"

# ======================================================================= 3 tool cap
CONTINUE_MODE=handoff run_foreman spin r3 --tool-cap 3 --timeout 60
assert_eq "$RC" "1" "3: cap → exit 1"
assert_eq "$(field "$OUT" status)" "tool_cap_reached" "3: status tool_cap_reached"
TC="$(field "$OUT" tool_calls)"
[ "$TC" -ge 4 ] && [ "$TC" -le 12 ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "3: killed shortly after call 4 (tool_calls=$TC)"
assert_eq "$(field "$OUT" handoff_written)" "true" "3: handoff turn wrote HANDOFF.md"
assert_eq "$(field "$OUT" handoff_path)" "$RD/HANDOFF.md" "3: handoff path outside the worktree"
assert_file_exists "$SD/argv.1" "3: a second kimi invocation (handoff turn) happened"
assert_contains "$(cat "$SD/argv.1")" "-c" "3: handoff turn continues the killed session in place"
assert_contains "$(cat "$SD/argv.1")" "tool-call cap (3)" "3: handoff turn names the cause"
assert_eq "$(cat "$SD/cwd.1")" "$(cat "$SD/cwd.0")" "3: handoff turn runs in the SAME cwd"
assert_file_exists "$RD/foreman.stream.handoff.jsonl" "3: handoff stream captured separately"
WT3="$(field "$OUT" worktree)"
[ -d "$WT3" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "3: worktree retained after cap"
# the spinning stub is dead (its process group was killed)
sleep 0.5
STUB_PID="$(cat "$SD/pid.0")"
if kill -0 "$STUB_PID" 2>/dev/null; then fail "3: stub pid $STUB_PID still alive after cap kill"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)); fi
# control: the same probe sees a real background process alive, then dead after a kill
sleep 30 & CTRL_PID=$!
kill -0 "$CTRL_PID" 2>/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "3: liveness probe control (alive)"
kill "$CTRL_PID" 2>/dev/null; wait "$CTRL_PID" 2>/dev/null
kill -0 "$CTRL_PID" 2>/dev/null && fail "3: liveness probe control (dead)" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
STREAM_LINES="$(wc -l < "$RD/foreman.stream.jsonl")"
[ "$STREAM_LINES" -lt 40 ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "3: stream stopped growing after kill ($STREAM_LINES lines)"

# ======================================================================= 4 deadline
CONTINUE_MODE=fail run_foreman hang r4 --timeout 2 --handoff-timeout 5
assert_eq "$(field "$OUT" status)" "deadline_expired" "4: status deadline_expired"
assert_eq "$(field "$OUT" handoff_written)" "false" "4: no HANDOFF.md → handoff_written=false (distinguishable)"
assert_eq "$(field "$OUT" report_written)" "false" "4: no report either"
assert_file_exists "$SD/argv.1" "4: handoff turn attempted"
assert_contains "$(cat "$SD/argv.1")" "deadline (2s) expired" "4: handoff turn names the deadline"

# ======================================================================= 5 escalation + resume
CONTINUE_MODE=complete run_foreman escalate r5
assert_eq "$RC" "0" "5: escalated → exit 0"
assert_eq "$(field "$OUT" status)" "escalated" "5: status escalated"
assert_eq "$(field "$OUT" escalation_path)" "$RD/ESCALATION.md" "5: escalation path reported"
WT5="$(field "$OUT" worktree)"
[ -d "$WT5" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "5: worktree kept for resume"
echo "unit-1 first" > "$TEST_TMP/answer.md"
SD5="$SD"
OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" KIMI_STUB_MODE=escalate KIMI_STUB_CONTINUE_MODE=complete KIMI_STUB_DIR="$SD5" KIMI_STUB_REPORT_DIR="$RD" \
  bash "$SCRIPT" --resume --run-dir "$RD" --answer-file "$TEST_TMP/answer.md" --poll 0.2 2>"$TEST_TMP/stderr.resume")"; RC=$?
assert_eq "$RC" "0" "5: resume → exit 0"
assert_eq "$(field "$OUT" status)" "completed" "5: resumed run completed"
assert_contains "$(cat "$SD5/argv.1")" "-c" "5: resume continues the session"
assert_contains "$(cat "$SD5/argv.1")" "ANSWER.md" "5: resume points at the answer"
assert_eq "$(cat "$SD5/cwd.1")" "$WT5" "5: resume runs in the original worktree"
assert_file_exists "$RD/ANSWER.md" "5: answer copied into the run dir"
assert_file_exists "$RD/foreman.stream.resume1.jsonl" "5: resume stream captured separately"
[ -d "$WT5" ] && fail "5: worktree removed after resumed completion" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

# ======================================================================= 6 main checkout touched
STUB_SCRIPT="$TEST_TMP/touch-main.sh"; printf 'echo tainted >> "%s/README.md"\n' "$SBX" > "$STUB_SCRIPT"
run_foreman script r6
assert_eq "$RC" "1" "6: mutated → exit 1"
assert_eq "$(field "$OUT" status)" "main_checkout_mutated" "6: status main_checkout_mutated"
assert_eq "$(field "$OUT" main_checkout_boundary)" "main_checkout_mutated" "6: boundary field"
rm -f "$SBX/README.md"

# ======================================================================= 7 merge commit
STUB_SCRIPT="$TEST_TMP/merge.sh"; cat > "$STUB_SCRIPT" <<'EOF'
git -c user.email=t@t -c user.name=t merge --no-ff --no-edit side
EOF
run_foreman script r7
assert_eq "$(field "$OUT" status)" "foreman_integrated" "7: merge on the foreman branch is foreman_integrated"
assert_contains "$(field "$OUT" error)" "merge commit" "7: reason names the merge"

# ======================================================================= 8 foreman commits
STUB_SCRIPT="$TEST_TMP/commit.sh"; cat > "$STUB_SCRIPT" <<'EOF'
echo notes > notes.md; git add notes.md; git -c user.email=t@t -c user.name=t commit -q -m "foreman: notes"
EOF
run_foreman script r8
assert_eq "$(field "$OUT" status)" "completed" "8: a plain foreman commit is allowed"
assert_eq "$(field "$OUT" foreman_commits)" "1" "8: commit counted"
assert_neq "$(field "$OUT" foreman_head)" "$BASE" "8: head moved"
STUB_SCRIPT="$TEST_TMP/commit-secret.sh"; cat > "$STUB_SCRIPT" <<'EOF'
echo TOKEN=x > secret.env; git add -f secret.env; git -c user.email=t@t -c user.name=t commit -q -m "oops"
EOF
run_foreman script r8b
assert_eq "$(field "$OUT" status)" "unsafe_commit_content" "8: force-added ignored file rejected by the content gate"

# ======================================================================= 9 hands namespace
STUB_SCRIPT="$TEST_TMP/hands.sh"; cat > "$STUB_SCRIPT" <<'EOF'
git branch "hands/$RUN/u1" HEAD
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m tmp
git branch -f "hands/$RUN/u1" HEAD
git reset -q --hard HEAD~1
EOF
sed -i "s/\$RUN/r9/g" "$STUB_SCRIPT"
run_foreman script r9
assert_eq "$(field "$OUT" status)" "completed" "9: hands branches under the namespace are allowed"
assert_contains "$(field "$OUT" hands_branches)" '"branch":"hands/r9/u1"' "9: hands branch listed"
assert_contains "$(field "$OUT" hands_branches)" '"head":"' "9: hands head listed"
STUB_SCRIPT="$TEST_TMP/rogue.sh"; printf 'git branch rogue HEAD\n' > "$STUB_SCRIPT"
run_foreman script r9b
assert_eq "$(field "$OUT" status)" "main_checkout_mutated" "9: a ref outside the namespace is a mutation"
git -C "$SBX" branch -D rogue >/dev/null 2>&1 || true

# ======================================================================= 10 push blocked
STUB_SCRIPT="$TEST_TMP/push.sh"; cat > "$STUB_SCRIPT" <<'EOF'
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "push me"
git push origin HEAD:develop 2>&1; echo "push rc=$?"
git push --no-verify origin HEAD:refs/tags/t1 2>&1; echo "tag push rc=$?"
EOF
run_foreman script r10
assert_eq "$(git -C "$REMOTE" rev-parse develop)" "$REMOTE_BEFORE" "10: remote develop unchanged"
git -C "$REMOTE" rev-parse --verify --quiet refs/tags/t1 >/dev/null 2>&1 && fail "10: tag push landed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
assert_contains "$(cat "$SD/script.out.0")" "push rc=" "10: script ran"
assert_not_contains "$(cat "$SD/script.out.0")" "push rc=0" "10: push did not succeed"
assert_eq "$(field "$OUT" main_checkout_boundary)" "verified" "10: a blocked push leaves the main checkout unchanged"

# ======================================================================= 11 --ledger detach
LEDGER="$TEST_TMP/foreman.ledger"; bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$LEDGER" >/dev/null 2>&1 || : > "$LEDGER"
run_foreman complete r11 --ledger "$LEDGER"
assert_eq "$RC" "0" "11: detached run relays exit 0"
assert_eq "$(field "$OUT" status)" "completed" "11: relayed result is the durable one"
assert_file_exists "$LEDGER.results/r11.foreman.result.json" "11: durable result landed"
assert_file_exists "$LEDGER.results/r11.foreman.exit" "11: exit file landed"
assert_eq "$(cat "$LEDGER.results/r11.foreman.exit")" "0" "11: exit file content"
WOUT="$(node "$WAIT" --ledger "$LEDGER" --expect r11.foreman --timeout 0)"; WRC=$?
assert_eq "$WRC" "0" "11: wait-dispatch-results sees the landed foreman"
assert_contains "$WOUT" '"key":"r11.foreman","exit_code":0' "11: wait reports the key"

# ======================================================================= 12 real nested dispatch-hetero under the foreman env
AGY="$TEST_TMP/agy-stub"; cat > "$AGY" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt; git add ok.txt; git -c user.email=t@t -c user.name=t commit -q -m "test: hand commit"
node -e 'process.stdout.write(JSON.stringify({conversation_id:"f",duration_seconds:1,num_turns:1,response:"self-report: DONE",status:"SUCCESS",usage:{input_tokens:1,output_tokens:1}})+"\n")'
EOF
chmod +x "$AGY"; make_agy_stub_versioned "$AGY"
echo "create ok.txt" > "$TEST_TMP/hand-prompt.txt"
STUB_SCRIPT="$TEST_TMP/nested.sh"; cat > "$STUB_SCRIPT" <<EOF
env | grep -E '^(GIT_ALLOW_PROTOCOL|GIT_CONFIG_COUNT)='
DISPATCH_DETACH=0 bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --branch hands/r12/u1 --base "$BASE" --prompt-file "$TEST_TMP/hand-prompt.txt" --agy-bin "$AGY" --model gemini-3.7-flash-low
echo "hetero rc=\$?"
EOF
run_foreman script r12 --timeout 300
assert_eq "$(field "$OUT" status)" "completed" "12: nested hetero dispatch under the foreman env does not trip the boundary (stderr: $(tail -c 300 "$TEST_TMP/stderr.$N"))"
assert_contains "$(tr -d ' ' < "$SD/script.out.0")" '"status":"committed"' "12: nested hand committed under GIT_ALLOW_PROTOCOL= (out: $(tail -c 400 "$SD/script.out.0"))"
assert_contains "$(field "$OUT" hands_branches)" '"branch":"hands/r12/u1"' "12: nested hand branch listed"
HAND_HEAD="$(git -C "$SBX" rev-parse --verify --quiet hands/r12/u1)"
assert_neq "$HAND_HEAD" "$BASE" "12: hand branch carries the commit"

# --- cleanup: retained worktrees + branches in the sandbox --------------------------------
git -C "$SBX" worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$SBX$" | while read -r wt; do
  git -C "$SBX" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
done
git -C "$SBX" worktree prune >/dev/null 2>&1 || true

finalize_test
