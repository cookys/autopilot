#!/usr/bin/env bash
# dispatch_usage/1 ledger through the four model-calling rails (dispatch-hetero / -review / -author / -consult),
# each driven with a fake runner. One finished dispatch = one row in <live_dir>/dispatch-usage-YYYYMM.jsonl;
# the result JSON and the exit code are untouched; AUTOPILOT_DISPATCH_USAGE=off writes nothing; no token in the file.
# Writer unit tests: scripts/lib/dispatch-usage.test.js.
. "$(dirname "$0")/lib.sh"

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-dul-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="FAKE-ledger-token-must-not-leak"
export FLEET_BIN=/bin/false   # no courier in the base cases: courier is null
export AUTOPILOT_DISPATCH_LANE="lane-test" AUTOPILOT_UPSTREAM_TASK_ID="task-test" AUTOPILOT_UPSTREAM_MESSAGE_ID="msg-test"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_DISPATCH_ROLE \
  AUTOPILOT_DISPATCH_USAGE CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID 2>/dev/null || true

eq() { assert_eq "$2" "$1" "$3"; }
rows() { cat "$AUTOPILOT_LIVE_DIR"/dispatch-usage-*.jsonl 2>/dev/null; }
nrows() { rows | grep -c . || true; }
# row_get <n> <js expression over r> -> value as a string ("null" for null)
row_get() {
  rows | sed -n "${1}p" | node -e 'const r = JSON.parse(require("fs").readFileSync(0, "utf8")); const v = eval(process.argv[1]); process.stdout.write(v === null || v === undefined ? "null" : (typeof v === "object" ? JSON.stringify(v) : String(v)));' "$2"
}
reset_rows() { rm -f "$AUTOPILOT_LIVE_DIR"/dispatch-usage-*.jsonl; }

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"

# ---------------------------------------------------------------- hetero (cc-shim fake claude)
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' "$@" > "${CLAUDE_STUB_ARGV:?}"
echo edited > ledger-edit.txt
if [ -n "${STUB_NOCACHE:-}" ]; then
  printf '%s' '{"type":"result","is_error":false,"result":"ok","usage":{"input_tokens":120,"output_tokens":45}}'
else
  printf '%s' '{"type":"result","is_error":false,"result":"ok","usage":{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":7,"cache_creation_input_tokens":3}}'
fi
EOS
chmod +x "$BINDIR/claude"
HARGV="$TEST_TMP/hetero-claude-argv.txt"
run_hetero() {
  RC=0
  OUT="$(cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT CLAUDE_STUB_ARGV="$HARGV" PATH="$BINDIR:$PATH" \
      "$@" "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 \
      --prompt-file "$PROMPT" --context-window off --branch "feat/ledger-$RANDOM$RANDOM" 2>"$TEST_TMP/hetero.err")" || RC=$?
}
reset_rows
run_hetero env
eq "0" "$RC" "hetero: cc-shim run exits 0 ($(tail -c 200 "$TEST_TMP/hetero.err"))"
eq "1" "$(nrows)" "hetero: exactly one ledger row"
RES_RUN_ID="$(printf '%s' "$OUT" | node -e 'const s=require("fs").readFileSync(0,"utf8").split("\n").filter(l=>l.startsWith("{")).pop(); process.stdout.write(JSON.parse(s).run_id)')"
eq "dispatch_usage/1" "$(row_get 1 r.schema)" "hetero: schema"
eq "$RES_RUN_ID" "$(row_get 1 r.run_id)" "hetero: run_id is the result's run_id"
eq "implementer" "$(row_get 1 r.role)" "hetero: role"
eq "cc-shim" "$(row_get 1 r.runner)" "hetero: runner"
eq "MiniMax-M3" "$(row_get 1 r.model)" "hetero: model"
eq "cc-shim" "$(row_get 1 r.served_by.runner)" "hetero: served_by defaults to the requested seat"
eq "[]" "$(row_get 1 r.fallbacks)" "hetero: fallbacks empty"
assert_eq '{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":7,"cache_creation_input_tokens":3,"reasoning_tokens":null}' "$(row_get 1 r.usage)" "hetero: usage from the harness envelope, reasoning unknown stays null"
eq "provider_response" "$(row_get 1 r.usage_source)" "hetero: usage_source"
eq "committed" "$(row_get 1 r.status)" "hetero: status"
eq "lane-test" "$(row_get 1 r.requester.lane)" "hetero: lane from env"
eq "task-test" "$(row_get 1 r.upstream.task_id)" "hetero: upstream task from env"
eq "null" "$(row_get 1 r.courier)" "hetero: courier null when fleet whoami fails"
eq "null" "$(row_get 1 r.account)" "hetero: claude-family account unknown is null, not guessed"
CHILD_SID="$(sed -n '/^--session-id$/{n;p;}' "$HARGV")"
assert_contains "$CHILD_SID" "-" "hetero: the stub claude was given --session-id"
eq "$CHILD_SID" "$(row_get 1 r.provider_session_id)" "hetero: provider_session_id is the child Claude session id passed as --session-id"
assert_not_contains "$(rows)" "FAKE-ledger-token-must-not-leak" "hetero: no token in the ledger"
assert_not_contains "$(rows)" "agent_log" "hetero: result-only fields are not copied"

# envelope without the cache keys: the ledger says null (unknown), the result JSON keeps its 0 (unchanged contract)
reset_rows
run_hetero env STUB_NOCACHE=1
eq "0" "$RC" "hetero nocache: exit 0"
assert_eq '{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":null,"cache_creation_input_tokens":null,"reasoning_tokens":null}' "$(row_get 1 r.usage)" "hetero nocache: missing cache keys are null in the ledger, never 0"
assert_contains "$OUT" '"cache_read_input_tokens":0' "hetero nocache: the result JSON usage is unchanged (0-filled)"

# negative control: the same run with the switch off writes nothing and still exits 0
reset_rows
run_hetero env AUTOPILOT_DISPATCH_USAGE=off
eq "0" "$RC" "hetero off: exit code unchanged"
eq "0" "$(nrows)" "hetero off (negative control): no row written"
# negative control for the checker itself: a wrong expectation is detected
reset_rows
run_hetero env
if [ "$(row_get 1 r.usage.input_tokens)" = "121" ]; then fail "control: the row check cannot tell 120 from 121"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi

# ---------------------------------------------------------------- author (fake codex runner)
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session_isolation"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
APROMPT="$TEST_TMP/aprompt.txt"; printf '%s' "Write a verification plan." > "$APROMPT"
FAKE_RUNNER="$TEST_TMP/fake-runner"
export AUTOPILOT_TEST_LIB="$REPO_ROOT/hooks/tests/lib.sh"
cat <<EOF > "$FAKE_RUNNER"
#!/usr/bin/env bash
$(declare -f read_fake_runner_prompt extract_autopilot_frame_markers print_autopilot_frame_markers)
echo "OpenAI Codex v0.test.0" >&2
echo "--------" >&2
echo "session id: 00000000-0000-4000-8000-000000000000" >&2
echo "--------" >&2
sidecar=""
args=("\$@")
i=0
while [ "\$i" -lt "\${#args[@]}" ]; do
  if [ "\${args[\$i]}" = "--output-last-message" ]; then i=\$((i + 1)); [ "\$i" -lt "\${#args[@]}" ] && sidecar="\${args[\$i]}"; fi
  i=\$((i + 1))
done
msg="Success from stub runner"
if MARKERS="\$(print_autopilot_frame_markers AUTOPILOT-AUTHOR "\$@")"; then
  BEGIN="\$(printf '%s\\n' "\$MARKERS" | sed -n '1p')"; END="\$(printf '%s\\n' "\$MARKERS" | sed -n '2p')"
  framed=\$(printf '%s\\n%s\\n%s\\n' "\$BEGIN" "\$msg" "\$END")
  [ -n "\$sidecar" ] && printf '%s' "\$framed" > "\$sidecar"
  printf '%s' "\$framed"
else
  [ -n "\$sidecar" ] && printf '%s\\n' "\$msg" > "\$sidecar"
  printf '%s\\n' "\$msg"
fi
exit 0
EOF
chmod +x "$FAKE_RUNNER"
reset_rows
AOUT="$("$REPO_ROOT/scripts/dispatch-author.sh" --runner codex --model gpt-5.5 --prompt-file "$APROMPT" --bin "$FAKE_RUNNER" 2>/dev/null)"; AEXIT=$?
eq "0" "$AEXIT" "author: exit 0"
assert_contains "$AOUT" '"status": "authored"' "author: result unchanged"
eq "1" "$(nrows)" "author: exactly one ledger row"
eq "author" "$(row_get 1 r.role)" "author: role"
eq "codex" "$(row_get 1 r.runner)" "author: runner"
eq "gpt-5.5" "$(row_get 1 r.model)" "author: model"
eq "authored" "$(row_get 1 r.status)" "author: status"
eq "none" "$(row_get 1 r.usage_source)" "author: the rail reports no usage, so none (never estimated)"
eq "null" "$(row_get 1 r.usage.input_tokens)" "author: unknown tokens are null, not 0"
eq "null" "$(row_get 1 r.account)" "author: codex account alias unknown is null"
eq "lane-test" "$(row_get 1 r.requester.lane)" "author: lane"
reset_rows
AUTOPILOT_DISPATCH_ROLE=plan-review "$REPO_ROOT/scripts/dispatch-author.sh" --runner codex --model gpt-5.5 --prompt-file "$APROMPT" --bin "$FAKE_RUNNER" >/dev/null 2>&1
eq "plan-review" "$(row_get 1 r.role)" "author: a caller-stamped role (plan review) is the row's role"
reset_rows
AUTOPILOT_DISPATCH_USAGE=off "$REPO_ROOT/scripts/dispatch-author.sh" --runner codex --model gpt-5.5 --prompt-file "$APROMPT" --bin "$FAKE_RUNNER" >/dev/null 2>&1
eq "0" "$(nrows)" "author off (negative control): no row written"
reset_rows
"$REPO_ROOT/scripts/dispatch-author.sh" --runner codex --model gpt-5.5 --prompt-file "$TEST_TMP/missing-prompt" --bin "$FAKE_RUNNER" >/dev/null 2>&1
eq "0" "$(nrows)" "author precondition_failed (no model call): no row"

# ---------------------------------------------------------------- review (fake codex runner)
cat <<'EOF' > "$TEST_TMP/review-stub.sh"
#!/usr/bin/env bash
prompt=""
i=1
while [ "$i" -le "$#" ]; do
  arg="${!i}"
  if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then ni=$((i+1)); na="${!ni}"; if [ -n "$na" ] && [ -f "$na" ]; then prompt="$(cat "$na")"; else prompt="$na"; fi; break; fi
  i=$((i+1))
done
[ -z "$prompt" ] && prompt="$(cat)"
begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
if [ -z "$begin" ] || [ -z "$end" ]; then exit 0; fi
if [ "${REVIEW_STUB_MODE:-ok}" = "garbage" ]; then printf '%s\nnot a verdict\n%s\n' "$begin" "$end"; exit 0; fi
printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=fixture diff and acceptance contract; evidence=changed assignment is present in captured diff; conclusion=specified assignment change has no blocking failure\n%s\n' "$begin" "$end"
EOF
chmod +x "$TEST_TMP/review-stub.sh"
cat <<'EOF' > "$TEST_TMP/fixture.diff"
diff --git a/x.js b/x.js
--- a/x.js
+++ b/x.js
@@ -1 +1 @@
-const a = 1
+const a = 2
EOF
reset_rows
ROUT="$(bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test --diff-file "$TEST_TMP/fixture.diff" --bin "$TEST_TMP/review-stub.sh" 2>/dev/null)"; REXIT=$?
eq "0" "$REXIT" "review: exit 0"
assert_contains "$ROUT" '"status": "reviewed"' "review: result unchanged"
eq "1" "$(nrows)" "review: exactly one ledger row"
eq "reviewer" "$(row_get 1 r.role)" "review: role"
eq "codex" "$(row_get 1 r.runner)" "review: runner"
eq "gpt-test" "$(row_get 1 r.model)" "review: model"
eq "reviewed" "$(row_get 1 r.status)" "review: status"
eq "none" "$(row_get 1 r.usage_source)" "review: no usage reported, so none"
reset_rows
REVIEW_STUB_MODE=garbage bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test --diff-file "$TEST_TMP/fixture.diff" --bin "$TEST_TMP/review-stub.sh" >/dev/null 2>&1
eq "1" "$(nrows)" "review no_verdict: still one row"
eq "no_verdict" "$(row_get 1 r.status)" "review no_verdict: status recorded"
reset_rows
AUTOPILOT_DISPATCH_USAGE=off bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test --diff-file "$TEST_TMP/fixture.diff" --bin "$TEST_TMP/review-stub.sh" >/dev/null 2>&1
eq "0" "$(nrows)" "review off (negative control): no row written"

# ---------------------------------------------------------------- consult (fake author bin)
Q="$TEST_TMP/question.txt"; printf 'should we ship this diff?\n' > "$Q"
ART="$TEST_TMP/artifact.diff"; printf 'diff --git a/x b/x\n+line\n' > "$ART"
unset REVIEW_LOOP_CONFIG_OVERRIDE AUTOPILOT_QUALIFICATION_OVERRIDE
ON_CFG="$TEST_TMP/on.md"
printf -- '- override: consult | until 2099-01-01 | test fixture seat\n- consult_engine: gpt-5.6\n- consult_runner: codex\n- consult_effort: high\n- consult_dispatch: on\n' > "$ON_CFG"
OVR="$TEST_TMP/override.json"
cat > "$OVR" <<'JSON'
{"schema":1,"overrides":[
  {"engine":"gpt-5.6","runner":"codex","role":"consult","reason":"dispatch-usage-ledger.test.sh fixture","operator":"cookys","expires":"2099-01-01"}
]}
JSON
RESP="$TEST_TMP/consult-response.json"
cat > "$RESP" <<'EOF'
{ "answer": { "label": "insufficient_evidence", "artifact_ref": null },
  "aside": [ { "note": "unrelated aside, parked" } ],
  "authority": { "refused": true, "reference": "qc@depth-0" } }
EOF
CENV="$TEST_TMP/consult-author-env.txt"
CBIN="$TEST_TMP/consult-author.sh"
cat > "$CBIN" <<EOF
#!/usr/bin/env bash
printf 'usage_switch=%s\n' "\${AUTOPILOT_DISPATCH_USAGE:-unset}" > "$CENV"
printf '{ "runner": "codex", "model": "gpt-5.6", "status": "authored", "raw_log": "$RESP", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
EOF
chmod +x "$CBIN"
FLEETSTUB="$TEST_TMP/fleet-stub"
printf '#!/bin/sh\nprintf "address: a/b/c\\nnamespace: nsx\\ncourier: cx\\n"\n' > "$FLEETSTUB"; chmod +x "$FLEETSTUB"
reset_rows
COUT="$(FLEET_BIN="$FLEETSTUB" REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$REPO_ROOT/scripts/dispatch-consult.sh" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$CBIN" 2>/dev/null)"; CEXIT=$?
eq "0" "$CEXIT" "consult: exit 0"
assert_contains "$COUT" '"status": "advised"' "consult: result unchanged"
eq "1" "$(nrows)" "consult: exactly one row (the transport it called does not write a second)"
assert_contains "$(cat "$CENV")" "usage_switch=off" "consult: the transport is told not to write its own row"
eq "consult" "$(row_get 1 r.role)" "consult: role"
eq "codex" "$(row_get 1 r.runner)" "consult: runner"
eq "gpt-5.6" "$(row_get 1 r.model)" "consult: model (engine)"
eq "advised" "$(row_get 1 r.status)" "consult: status"
eq "nsx/cx" "$(row_get 1 r.courier)" "consult: courier from fleet whoami"
eq "[]" "$(row_get 1 r.fallbacks)" "consult: no fallback"
# a refusal before the transport writes no row
reset_rows
REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$REPO_ROOT/scripts/dispatch-consult.sh" --question-file "$Q" --artifact "$TEST_TMP/nope" --dispatch-author-bin "$CBIN" >/dev/null 2>&1
eq "0" "$(nrows)" "consult refusal before the transport: no row"
reset_rows
AUTOPILOT_DISPATCH_USAGE=off REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$REPO_ROOT/scripts/dispatch-consult.sh" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$CBIN" >/dev/null 2>&1
eq "0" "$(nrows)" "consult off (negative control): no row written"

finalize_test
