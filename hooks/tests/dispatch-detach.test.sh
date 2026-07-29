#!/usr/bin/env bash
# dispatch-detach.test.sh — R1 detach-by-default + heartbeat + atomic durable result.
#
# Exercises dispatch-hetero.sh's detached execution with a PATH/--agy-bin-stubbed fake engine
# (no network, no real agy/codex, NO live LLM). Covers the three DoD scenarios:
#   (a) KILL-SURVIVAL     — kill the wrapper mid-run; the setsid worker still completes, the
#                           heartbeat advanced, the result landed atomically, and the ledger
#                           shows the stage committed + recoverable via `run-ledger resume`.
#   (b) BYTE-IDENTICAL    — DISPATCH_DETACH=0 (+ ledger coords) runs the legacy INLINE path:
#                           same stdout/exit as a no-coords run, and NO ledger side effects.
#   (c) TRANSPARENT NORMAL— default (detach on) un-killed run relays the SAME final JSON/exit
#                           to the caller (so implementer.js's strict parse still works).
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
LEDGER_SH="$REPO_ROOT/scripts/run-ledger.sh"

# --- sandbox git repo (never touch the real repo) ---
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"

# track worktrees KEEP=1 leaves behind so we can reap them at the end (no /tmp leak)
LEAKED_WTS=()
reap_wt() { # <json>  → extract "worktree" and remove it
  local wt; wt="$(printf '%s' "$1" | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
  [ -n "$wt" ] && LEAKED_WTS+=("$wt")
}

# --- stub engine: sleeps (so we can kill mid-run) then commits one file ---
mk_slow_stub() { # <path> <sleep-secs>
  cat > "$1" <<EOF
#!/usr/bin/env bash
sleep $2
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: detached commit"
EOF
  chmod +x "$1"
}

# =========================================================================================
# (a) KILL-SURVIVAL
# =========================================================================================
LEDGER_A="$TEST_TMP/a/ledger.jsonl"
mkdir -p "$TEST_TMP/a"
bash "$LEDGER_SH" init --ledger "$LEDGER_A" >/dev/null
STUB_SLOW="$TEST_TMP/agy-slow"
mk_slow_stub "$STUB_SLOW" 5

# Launch the wrapper as a direct background child (NOT a subshell) so $! is the wrapper PID.
_prev_pwd="$PWD"
cd "$SBX"
DISPATCH_HEARTBEAT_SECS=1 bash "$SCRIPT" \
  --branch feat/kill --prompt-file "$PROMPT" --agy-bin "$STUB_SLOW" \
  --ledger "$LEDGER_A" --run-id rk --stage implement >/dev/null 2>&1 &
WRAPPER_PID=$!
cd "$_prev_pwd"

# Wait until the detached worker is provably running (first heartbeat row), then
# SIGKILL the wrapper. Fixed sleep races under parallel CPU contention.
if ! poll_until 20 grep -q '"kind":"heartbeat"' "$LEDGER_A"; then
  fail "kill-survival: detached worker never heartbeated before SIGKILL (readiness timeout)"
fi
kill -9 "$WRAPPER_PID" 2>/dev/null || true
wait "$WRAPPER_PID" 2>/dev/null || true

# The detached setsid worker must keep running and land its result.
RESULT_A="${LEDGER_A}.results/rk.implement.result.json"
for _ in $(seq 1 40); do [ -f "$RESULT_A" ] && break; sleep 0.5; done

assert_file_exists "$RESULT_A" "killed wrapper: detached worker still landed its result atomically"
RES_JSON="$(cat "$RESULT_A" 2>/dev/null)"
reap_wt "$RES_JSON"
assert_contains "$RES_JSON" '"status": "committed"' "kill-survival: result is a clean committed outcome"
# result file must be COMPLETE JSON (atomic write → never torn)
assert_eq "committed" "$(printf '%s' "$RES_JSON" | jq -r '.status' 2>/dev/null)" "kill-survival: result file is valid, untorn JSON"

# heartbeat advanced (immediate beat + ≥1 more before the 5s worker finished)
HB_COUNT="$(grep -c '"kind":"heartbeat"' "$LEDGER_A" 2>/dev/null)"; HB_COUNT="${HB_COUNT:-0}"
assert_eq "yes" "$([ "$HB_COUNT" -ge 2 ] && echo yes || echo no)" "kill-survival: heartbeat advanced (>=2 beats, got $HB_COUNT)"

# ledger shows the stage committed. detached_main writes RESULT_FILE (line ~1037) strictly
# BEFORE the ledger stage-transition to committed (line ~1042) — a real ordering gap, not test
# noise — so poll here the same way we polled for RESULT_A above instead of checking once.
COMMIT_ROWS=0
for _ in $(seq 1 20); do
  COMMIT_ROWS="$(grep -c '"state":"committed"' "$LEDGER_A" 2>/dev/null)"; COMMIT_ROWS="${COMMIT_ROWS:-0}"
  [ "$COMMIT_ROWS" -ge 1 ] && break
  sleep 0.25
done
assert_eq "yes" "$([ "$COMMIT_ROWS" -ge 1 ] && echo yes || echo no)" "kill-survival: ledger recorded the committed stage"

# recoverable: the committed stage + the durable atomic result reconcile to resolved (the
# work is adoptable). (A linked worktree's .git is a FILE, so R3's git-truth path can't see it;
# the durable RESULT_FILE + terminal committed state are the authoritative recovery evidence.)
RECON_JSON="$(bash "$LEDGER_SH" stage-reconcile --ledger "$LEDGER_A" --run-id rk --stage implement --result-json "$RESULT_A" --git-dir "$SBX" 2>/dev/null)"
assert_eq "resolved" "$(printf '%s' "$RECON_JSON" | jq -r '.status' 2>/dev/null)" "kill-survival: committed stage + durable result reconcile to resolved (recoverable)"
# and `resume` runs the recovery handoff without error
RESUME_JSON="$(bash "$LEDGER_SH" resume --ledger "$LEDGER_A" --run-id rk --idempotency-key rec-a 2>/dev/null)"
assert_eq "resumed" "$(printf '%s' "$RESUME_JSON" | jq -r '.status' 2>/dev/null)" "kill-survival: run-ledger resume recovers the run"

# =========================================================================================
# (f) DISPATCH_DETACH helper: detached child stderr is preserved in a durable sidecar.
# =========================================================================================
DD_HELPER_SELF="$TEST_TMP/detach-helper-stderr.sh"
cat > "$DD_HELPER_SELF" <<'EOF'
#!/usr/bin/env bash
echo '{"status":"child-result"}'
echo "detach helper stderr payload" >&2
exit 9
EOF
chmod +x "$DD_HELPER_SELF"

LEDGER_HELPER="$TEST_TMP/f/ledger.jsonl"
mkdir -p "$TEST_TMP/f"
bash "$LEDGER_SH" init --ledger "$LEDGER_HELPER" >/dev/null

(
  source "$REPO_ROOT/scripts/lib/dispatch-detach.sh"
  dispatch_detach_supervise "$DD_HELPER_SELF" "$LEDGER_HELPER" r1 stage1 "$REPO_ROOT/scripts"
) > "$TEST_TMP/dd-helper.out" 2> "$TEST_TMP/dd-helper.err"
DD_HELPER_RC=$?
DD_HELPER_RESULT="${LEDGER_HELPER}.results/r1.stage1.result.json"
DD_HELPER_STDERR="${DD_HELPER_RESULT}.stderr"

assert_eq "9" "$DD_HELPER_RC" "dispatch_detach_supervise propagates detached child exit code"
assert_file_exists "$DD_HELPER_RESULT" "dispatch_detach_supervise writes durable result json"
assert_file_exists "$DD_HELPER_STDERR" "dispatch_detach_supervise preserves re-exec stderr in sidecar"
assert_contains "$(cat "$DD_HELPER_STDERR")" "detach helper stderr payload" "dispatch_detach_supervise sidecar contains stderr text"

# =========================================================================================
# (g) Parent SIGTERM after detach handoff does not delete PACKED_PROMPT_TEMP.
# =========================================================================================
STUB_PACK_TERM="$TEST_TMP/agy-pack-term"
cat > "$STUB_PACK_TERM" <<EOF
#!/usr/bin/env bash
sleep 5
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: packed prompt detached"
EOF
chmod +x "$STUB_PACK_TERM"

LEDGER_PACK="$TEST_TMP/g/ledger.jsonl"
mkdir -p "$TEST_TMP/g"
bash "$LEDGER_SH" init --ledger "$LEDGER_PACK" >/dev/null
mkdir -p "$TEST_TMP/pack-term"

(
  cd "$SBX"
  TMPDIR="$TEST_TMP/pack-term" DISPATCH_HEARTBEAT_SECS=1 \
    bash "$SCRIPT" --branch feat/pack-term --prompt-file "$PROMPT" --agy-bin "$STUB_PACK_TERM" \
      --skill-mode prompt --skill autopilot:dev-flow --ledger "$LEDGER_PACK" --run-id pg --stage implement > "$TEST_TMP/pack-term.out" 2> "$TEST_TMP/pack-term.err"
) &
WRAPPER_G_PID=$!

PACKED_PROMPT_TEMP=""
for _ in $(seq 1 80); do
  PACKED_PROMPT_TEMP="$(find "$TEST_TMP/pack-term" -maxdepth 1 -name 'dispatch-hetero-packed-prompt-*' -type f 2>/dev/null | head -n 1)"
  [ -n "$PACKED_PROMPT_TEMP" ] && break
  sleep 0.1
done
assert_neq "" "$PACKED_PROMPT_TEMP" "skill-mode prompt created a child-owned prompt temp path"

kill -TERM "$WRAPPER_G_PID" 2>/dev/null || true
wait "$WRAPPER_G_PID" 2>/dev/null || true
assert_file_exists "$PACKED_PROMPT_TEMP" "parent TERM does not delete PACKED_PROMPT_TEMP immediately"

RESULT_G="${LEDGER_PACK}.results/pg.implement.result.json"
for _ in $(seq 1 40); do [ -f "$RESULT_G" ] && break; sleep 0.5; done
assert_file_exists "$RESULT_G" "detached run survived parent TERM and still wrote result"
assert_eq "committed" "$(cat "$RESULT_G" | jq -r '.status' 2>/dev/null)" "parent TERM preserves detached outcome state"
PACK_WT="$(cat "$RESULT_G" | jq -r '.worktree' 2>/dev/null)"
[ -n "$PACK_WT" ] && [ "$PACK_WT" != "null" ] && LEAKED_WTS+=("$PACK_WT")

# =========================================================================================
# (c) TRANSPARENT NORMAL default (detach on), un-killed → relays SAME JSON/exit
# =========================================================================================
LEDGER_C="$TEST_TMP/c/ledger.jsonl"
mkdir -p "$TEST_TMP/c"
bash "$LEDGER_SH" init --ledger "$LEDGER_C" >/dev/null
STUB_QUICK="$TEST_TMP/agy-quick"
mk_slow_stub "$STUB_QUICK" 1

OUT_C="$(cd "$SBX" && DISPATCH_HEARTBEAT_SECS=1 bash "$SCRIPT" \
  --branch feat/normal --prompt-file "$PROMPT" --agy-bin "$STUB_QUICK" \
  --ledger "$LEDGER_C" --run-id rc --stage implement 2>/dev/null)"; EXIT_C=$?
reap_wt "$OUT_C"
assert_eq "0" "$EXIT_C" "transparent normal: relayed exit code is 0 (committed)"
assert_contains "$OUT_C" '"status": "committed"' "transparent normal: relayed stdout is the committed outcome JSON"
assert_contains "$OUT_C" '"runner": "agy"' "transparent normal: outcome JSON keeps runner field"
# strict-parse sanity: the relayed stdout is a single valid JSON object (implementer.js contract)
assert_eq "committed" "$(printf '%s' "$OUT_C" | jq -r '.status' 2>/dev/null)" "transparent normal: stdout parses as strict JSON"
# durable artifacts present too
assert_file_exists "${LEDGER_C}.results/rc.implement.result.json" "transparent normal: durable result file also landed"
HB_C="$(grep -c '"kind":"heartbeat"' "$LEDGER_C" 2>/dev/null)"; HB_C="${HB_C:-0}"
assert_eq "yes" "$([ "$HB_C" -ge 1 ] && echo yes || echo no)" "transparent normal: heartbeat written during the run"

# =========================================================================================
# (h) SAME-TUPLE CONCURRENCY: durable claim precedes worktree/manifest/runner effects.
# =========================================================================================
COMMON_H="$(git -C "$SBX" rev-parse --path-format=absolute --git-common-dir)"
LEDGER_H="$COMMON_H/autopilot/same-tuple-ledger.jsonl"
MANIFEST_H="$TEST_TMP/h/manifests"
RUNNER_CALLS_H="$TEST_TMP/h/runner-calls"
mkdir -p "$TEST_TMP/h"
bash "$LEDGER_SH" init --ledger "$LEDGER_H" >/dev/null
STUB_CONCURRENT="$TEST_TMP/agy-concurrent"
cat > "$STUB_CONCURRENT" <<EOF
#!/usr/bin/env bash
echo call >> "$RUNNER_CALLS_H"
sleep 2
echo ok > concurrent.txt
git add concurrent.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: concurrent"
EOF
chmod +x "$STUB_CONCURRENT"
(
  cd "$SBX"
  AUTOPILOT_DISPATCH_RUNS_DIR="$MANIFEST_H" bash "$SCRIPT" \
    --branch feat/concurrent --prompt-file "$PROMPT" --agy-bin "$STUB_CONCURRENT" \
    --ledger "$LEDGER_H" --run-id same-tuple --stage implement \
    > "$TEST_TMP/h/first.out" 2> "$TEST_TMP/h/first.err"
) &
FIRST_H_PID=$!
if ! poll_until 20 grep -q '"state":"leased"' "$LEDGER_H"; then
  fail "same-tuple: first caller never published durable preclaim"
fi
(
  cd "$SBX"
  AUTOPILOT_DISPATCH_RUNS_DIR="$MANIFEST_H" bash "$SCRIPT" \
    --branch feat/concurrent --prompt-file "$PROMPT" --agy-bin "$STUB_CONCURRENT" \
    --ledger "$LEDGER_H" --run-id same-tuple --stage implement
) > "$TEST_TMP/h/second.out" 2> "$TEST_TMP/h/second.err"
SECOND_H_RC=$?
assert_neq "0" "$SECOND_H_RC" "second same-tuple caller is rejected"
assert_contains "$(cat "$TEST_TMP/h/second.out")" '"status": "precondition_failed"' "second caller fails at precondition rail"
assert_contains "$(cat "$TEST_TMP/h/second.out")" "durable dispatch claim rejected" "second caller is fenced by durable tuple claim"
wait "$FIRST_H_PID"
FIRST_H_OUT="$(cat "$TEST_TMP/h/first.out")"
reap_wt "$FIRST_H_OUT"
assert_eq "1" "$(wc -l < "$RUNNER_CALLS_H" | tr -d ' ')" "same tuple dispatches runner exactly once"
H_MANIFESTS="$(find "$MANIFEST_H" -maxdepth 1 -name '*.manifest.json' -type f 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "1" "$H_MANIFESTS" "same tuple creates at most one manifest"
H_WORKTREES="$(git -C "$SBX" worktree list --porcelain \
  | grep -c '^branch refs/heads/feat/concurrent$' || true)"
assert_eq "1" "$H_WORKTREES" "same tuple creates at most one worktree"

# =========================================================================================
# (h2) SAME-TUPLE WITHOUT SETSID: detach was requested, so the parent preclaim still fences
#      duplicates even though process topology falls back to the inline runner.
# =========================================================================================
COMMON_H2="$(git -C "$SBX" rev-parse --path-format=absolute --git-common-dir)"
LEDGER_H2="$COMMON_H2/autopilot/same-tuple-no-setsid-ledger.jsonl"
MANIFEST_H2="$TEST_TMP/h2/manifests"
RUNNER_CALLS_H2="$TEST_TMP/h2/runner-calls"
FAKEBIN_H2="$TEST_TMP/h2/bin"
mkdir -p "$FAKEBIN_H2" "$MANIFEST_H2"
bash "$LEDGER_SH" init --ledger "$LEDGER_H2" >/dev/null
cat > "$FAKEBIN_H2/setsid" <<'EOF'
#!/usr/bin/env bash
echo "fixture setsid without wait support"
exit 0
EOF
chmod +x "$FAKEBIN_H2/setsid"
STUB_CONCURRENT_H2="$TEST_TMP/h2/agy-concurrent"
cat > "$STUB_CONCURRENT_H2" <<EOF
#!/usr/bin/env bash
echo call >> "$RUNNER_CALLS_H2"
sleep 2
echo ok > concurrent-no-setsid.txt
git add concurrent-no-setsid.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: concurrent without setsid"
EOF
chmod +x "$STUB_CONCURRENT_H2"
(
  cd "$SBX"
  PATH="$FAKEBIN_H2:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$MANIFEST_H2" bash "$SCRIPT" \
    --branch feat/concurrent-no-setsid --prompt-file "$PROMPT" \
    --agy-bin "$STUB_CONCURRENT_H2" \
    --ledger "$LEDGER_H2" --run-id same-tuple-no-setsid --stage implement \
    > "$TEST_TMP/h2/first.out" 2> "$TEST_TMP/h2/first.err"
) &
FIRST_H2_PID=$!
if ! poll_until 20 grep -q '"state":"leased"' "$LEDGER_H2"; then
  fail "same-tuple without setsid: first caller never published durable parent preclaim"
fi
if ! poll_until 20 test -f "$RUNNER_CALLS_H2"; then
  fail "same-tuple without setsid: inline runner never started"
fi
H2_WORKTREES_DURING="$(git -C "$SBX" worktree list --porcelain \
  | grep -c '^branch refs/heads/feat/concurrent-no-setsid$' || true)"
assert_eq "1" "$H2_WORKTREES_DURING" \
  "no-setsid first caller owns exactly one worktree while runner is active"
(
  cd "$SBX"
  PATH="$FAKEBIN_H2:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$MANIFEST_H2" bash "$SCRIPT" \
    --branch feat/concurrent-no-setsid --prompt-file "$PROMPT" \
    --agy-bin "$STUB_CONCURRENT_H2" \
    --ledger "$LEDGER_H2" --run-id same-tuple-no-setsid --stage implement
) > "$TEST_TMP/h2/second.out" 2> "$TEST_TMP/h2/second.err"
SECOND_H2_RC=$?
assert_neq "0" "$SECOND_H2_RC" "second same-tuple caller is rejected without setsid"
assert_contains "$(cat "$TEST_TMP/h2/second.out")" '"status": "precondition_failed"' \
  "no-setsid duplicate fails at precondition rail"
assert_contains "$(cat "$TEST_TMP/h2/second.out")" "durable dispatch claim rejected" \
  "no-setsid duplicate is fenced by the parent-owned tuple lease"
wait "$FIRST_H2_PID"
FIRST_H2_OUT="$(cat "$TEST_TMP/h2/first.out")"
reap_wt "$FIRST_H2_OUT"
assert_eq "1" "$(wc -l < "$RUNNER_CALLS_H2" | tr -d ' ')" \
  "no-setsid same tuple dispatches inline runner exactly once"
H2_MANIFESTS="$(find "$MANIFEST_H2" -maxdepth 1 -name '*.manifest.json' -type f 2>/dev/null \
  | wc -l | tr -d ' ')"
assert_eq "1" "$H2_MANIFESTS" "no-setsid same tuple creates at most one manifest"
H2_WORKTREES_AFTER="$(git -C "$SBX" worktree list --porcelain \
  | grep -c '^branch refs/heads/feat/concurrent-no-setsid$' || true)"
assert_eq "0" "$H2_WORKTREES_AFTER" "no-setsid inline path reaps its sole worktree after completion"

# =========================================================================================
# (i) OWNERSHIP-TRANSFER CAS: A preclaims, its child pauses before transfer,
#     A dies, B acquires, then A's child must be fenced without running.
# =========================================================================================
LEDGER_I="$TEST_TMP/i/ledger.jsonl"
MANIFEST_I="$TEST_TMP/i/manifests"
FAKEBIN_I="$TEST_TMP/i/bin"
HANDOFF_WAIT_I="$TEST_TMP/i/handoff-wait"
HANDOFF_RELEASE_I="$TEST_TMP/i/handoff-release"
RUNNER_CALLS_I="$TEST_TMP/i/runner-calls"
mkdir -p "$FAKEBIN_I" "$MANIFEST_I"
bash "$LEDGER_SH" init --ledger "$LEDGER_I" >/dev/null
REAL_BASH_I="$(command -v bash)"
cat > "$FAKEBIN_I/bash" <<EOF
#!/bin/sh
if [ "\${1:-}" = "$LEDGER_SH" ] && [ "\${2:-}" = "stage-transfer" ]; then
  touch "$HANDOFF_WAIT_I"
  while [ ! -f "$HANDOFF_RELEASE_I" ]; do sleep 0.01; done
fi
exec "$REAL_BASH_I" "\$@"
EOF
chmod +x "$FAKEBIN_I/bash"
STUB_NEVER_I="$TEST_TMP/i/agy-never"
cat > "$STUB_NEVER_I" <<EOF
#!/usr/bin/env bash
echo call >> "$RUNNER_CALLS_I"
exit 0
EOF
chmod +x "$STUB_NEVER_I"
(
  cd "$SBX"
  PATH="$FAKEBIN_I:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$MANIFEST_I" \
    bash "$SCRIPT" --branch feat/handoff-fail --prompt-file "$PROMPT" \
    --agy-bin "$STUB_NEVER_I" --ledger "$LEDGER_I" \
    --run-id handoff-fail --stage implement \
    > "$TEST_TMP/i/parent.out" 2> "$TEST_TMP/i/parent.err"
) &
PARENT_I_PID=$!
if ! poll_until 20 test -f "$HANDOFF_WAIT_I"; then
  fail "ownership-transfer CAS: detached child never reached transfer barrier"
fi

A_PRECLAIM_I="$(bash "$LEDGER_SH" query-latest --ledger "$LEDGER_I" \
  --run-id handoff-fail --stage implement)"
A_PID_I="$(jq -r '.pid' <<<"$A_PRECLAIM_I")"
A_GEN_I="$(jq -r '.generation' <<<"$A_PRECLAIM_I")"
A_NONCE_I="$(jq -r '.nonce' <<<"$A_PRECLAIM_I")"
kill -TERM "$A_PID_I" 2>/dev/null || true
poll_until 20 sh -c "! kill -0 '$A_PID_I' 2>/dev/null" \
  || fail "ownership-transfer CAS: preclaim owner A did not exit"

sleep 120 &
B_PID_I=$!
B_ACQUIRE_I="$(bash "$LEDGER_SH" stage-acquire --ledger "$LEDGER_I" \
  --run-id handoff-fail --stage implement --pid "$B_PID_I" \
  --git-ref refs/heads/feat/handoff-fail --exclusive-live)"
B_GEN_I="$(jq -r '.generation' <<<"$B_ACQUIRE_I")"
B_NONCE_I="$(jq -r '.nonce' <<<"$B_ACQUIRE_I")"
assert_eq "$((A_GEN_I + 1))" "$B_GEN_I" "B acquires the next tuple generation after A dies"
assert_neq "$A_NONCE_I" "$B_NONCE_I" "B receives a distinct ownership nonce"

I_MANIFEST_COUNT_BEFORE="$(find "$MANIFEST_I" -maxdepth 1 -name '*.manifest.json' -type f \
  | wc -l | tr -d ' ')"
assert_eq "1" "$I_MANIFEST_COUNT_BEFORE" "A creates exactly one pre-dispatch manifest"
I_MANIFEST_FILE="$(find "$MANIFEST_I" -maxdepth 1 -name '*.manifest.json' -type f | head -1)"
I_MANIFEST_SHA_BEFORE="$(sha256sum "$I_MANIFEST_FILE" | awk '{print $1}')"
touch "$HANDOFF_RELEASE_I"
wait "$PARENT_I_PID" 2>/dev/null || true
sleep 0.1
assert_file_absent "$RUNNER_CALLS_I" "stale child fenced by CAS never starts runner"
LATEST_I="$(bash "$LEDGER_SH" query-latest --ledger "$LEDGER_I" \
  --run-id handoff-fail --stage implement)"
assert_eq "$B_GEN_I" "$(jq -r '.generation' <<<"$LATEST_I")" "stale child cannot supersede B generation"
assert_eq "$B_NONCE_I" "$(jq -r '.nonce' <<<"$LATEST_I")" "stale child cannot supersede B nonce"
I_MANIFEST_COUNT_AFTER="$(find "$MANIFEST_I" -maxdepth 1 -name '*.manifest.json' -type f \
  | wc -l | tr -d ' ')"
assert_eq "$I_MANIFEST_COUNT_BEFORE" "$I_MANIFEST_COUNT_AFTER" "stale child creates no additional manifest"
assert_eq "$I_MANIFEST_SHA_BEFORE" "$(sha256sum "$I_MANIFEST_FILE" | awk '{print $1}')" \
  "stale child leaves the pre-dispatch manifest byte-identical"
kill "$B_PID_I" 2>/dev/null || true
wait "$B_PID_I" 2>/dev/null || true
I_WT="$(git -C "$SBX" worktree list --porcelain | awk '
  /^worktree / { wt=substr($0,10) }
  $0 == "branch refs/heads/feat/handoff-fail" { print wt }
')"
[ -n "$I_WT" ] && LEAKED_WTS+=("$I_WT")

# =========================================================================================
# (b) BYTE-IDENTICAL fallback: DISPATCH_DETACH=0 runs the legacy INLINE path
# =========================================================================================
STUB_OK="$TEST_TMP/agy-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: inline"
EOF
chmod +x "$STUB_OK"

normalize() { # strip run-volatile fields (commit sha / worktree / agent_log / branch /
  # observability run_id + wall_secs — Stage 1 additive fields, volatile per run) → stable text
  printf '%s' "$1" | sed -E \
    -e 's/"commit": "[0-9a-f]{40}"/"commit": "SHA"/' \
    -e 's#"worktree": "[^"]*"#"worktree": "WT"#' \
    -e 's#"agent_log": "[^"]*"#"agent_log": "LOG"#' \
    -e 's#"branch": "[^"]*"#"branch": "BR"#' \
    -e 's#"run_id": "[^"]*"#"run_id": "RID"#' \
    -e 's#"wall_secs": [0-9]+#"wall_secs": W#'
}

# Baseline: a NO-coords run (unambiguously the legacy inline path).
LEDGER_B="$TEST_TMP/b/ledger.jsonl"
mkdir -p "$TEST_TMP/b"
bash "$LEDGER_SH" init --ledger "$LEDGER_B" >/dev/null
OUT_BASE="$(cd "$SBX" && bash "$SCRIPT" --branch feat/inline-base --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>/dev/null)"; EXIT_BASE=$?

# DISPATCH_DETACH=0 WITH ledger coords → must take the SAME inline path (detach fully bypassed).
OUT_OFF="$(cd "$SBX" && DISPATCH_DETACH=0 bash "$SCRIPT" --branch feat/inline-off --prompt-file "$PROMPT" --agy-bin "$STUB_OK" \
  --ledger "$LEDGER_B" --run-id rb --stage implement 2>/dev/null)"; EXIT_OFF=$?

assert_eq "$EXIT_BASE" "$EXIT_OFF" "DISPATCH_DETACH=0: exit code matches the legacy inline path"
assert_eq "0" "$EXIT_OFF" "DISPATCH_DETACH=0: committed success exit 0"
assert_eq "$(normalize "$OUT_BASE")" "$(normalize "$OUT_OFF")" "DISPATCH_DETACH=0: stdout JSON byte-identical to inline (modulo run-volatile paths)"
# inline path removes the worktree on success → worktree null (detach keeps it, so this proves inline ran)
assert_contains "$OUT_OFF" '"worktree": null' "DISPATCH_DETACH=0: inline path removed the worktree on success"
# and NO ledger side effects at all (detach fully bypassed)
HB_B="$(grep -c '"kind":"heartbeat"' "$LEDGER_B" 2>/dev/null)"; HB_B="${HB_B:-0}"
assert_eq "0" "$HB_B" "DISPATCH_DETACH=0: no heartbeat rows (detach bypassed)"
assert_file_absent "${LEDGER_B}.results/rb.implement.result.json" "DISPATCH_DETACH=0: no durable result file written (detach bypassed)"

# =========================================================================================
# (d) detach engages ONLY with ledger coords: default detach-on but NO coords → inline
# =========================================================================================
OUT_NC="$(cd "$SBX" && bash "$SCRIPT" --branch feat/nocoords --prompt-file "$PROMPT" --agy-bin "$STUB_OK" 2>/dev/null)"; EXIT_NC=$?
assert_eq "0" "$EXIT_NC" "no ledger coords: inline committed exit 0"
assert_contains "$OUT_NC" '"worktree": null' "no ledger coords: inline path (worktree removed)"

# =========================================================================================
# (e) READ RAIL wiring: dispatch-review.sh detach engages only with coords, byte-identical off
# =========================================================================================
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
LEDGER_E="$TEST_TMP/e/ledger.jsonl"
mkdir -p "$TEST_TMP/e"
bash "$LEDGER_SH" init --ledger "$LEDGER_E" >/dev/null
RDIFF="$TEST_TMP/e.diff"; printf '+def f(): return 1\n' > "$RDIFF"
RSTUB="$TEST_TMP/codex-review-stub"
cat > "$RSTUB" <<'EOF'
#!/usr/bin/env bash
p="$(cat)"
b="$(printf '%s\n' "$p" | grep -o '<<<AUTOPILOT-REVIEW-[0-9a-f]*>>>' | head -1)"
e="$(printf '%s\n' "$p" | grep -o '<<<AUTOPILOT-END-[0-9a-f]*>>>' | head -1)"
echo "$b"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: checked=fixture diff and acceptance criteria; evidence=target slice was traced against the fixture; conclusion=no concrete blocking discrepancy was observed"
echo "$e"
EOF
chmod +x "$RSTUB"

# detach ON (default) + coords → relays reviewed verdict AND lands durable result + heartbeat
OUT_RE="$(DISPATCH_HEARTBEAT_SECS=1 DISPATCH_QUIET=1 bash "$REVIEW" --runner codex --model gpt-x --bin "$RSTUB" \
  --diff-file "$RDIFF" --ledger "$LEDGER_E" --run-id re --stage review 2>/dev/null)"; EXIT_RE=$?
assert_eq "0" "$EXIT_RE" "review detach: relayed exit 0 (reviewed)"
assert_eq "reviewed" "$(printf '%s' "$OUT_RE" | jq -r '.status' 2>/dev/null)" "review detach: relayed status reviewed"
assert_eq "SHIP-AS-IS" "$(printf '%s' "$OUT_RE" | jq -r '.verdict' 2>/dev/null)" "review detach: relayed verdict transparently"
assert_file_exists "${LEDGER_E}.results/re.review.result.json" "review detach: durable result file landed"
HB_E="$(grep -c '"kind":"heartbeat"' "$LEDGER_E" 2>/dev/null)"; HB_E="${HB_E:-0}"
assert_eq "yes" "$([ "$HB_E" -ge 1 ] && echo yes || echo no)" "review detach: heartbeat written during the run"

# DISPATCH_DETACH=0 + coords → inline (no ledger side effects), same verdict
LEDGER_E0="$TEST_TMP/e0/ledger.jsonl"; mkdir -p "$TEST_TMP/e0"
bash "$LEDGER_SH" init --ledger "$LEDGER_E0" >/dev/null
OUT_RE0="$(DISPATCH_QUIET=1 DISPATCH_DETACH=0 bash "$REVIEW" --runner codex --model gpt-x --bin "$RSTUB" \
  --diff-file "$RDIFF" --ledger "$LEDGER_E0" --run-id re0 --stage review 2>/dev/null)"; EXIT_RE0=$?
assert_eq "0" "$EXIT_RE0" "review DISPATCH_DETACH=0: inline exit 0"
assert_eq "reviewed" "$(printf '%s' "$OUT_RE0" | jq -r '.status' 2>/dev/null)" "review DISPATCH_DETACH=0: inline reviewed"
assert_file_absent "${LEDGER_E0}.results/re0.review.result.json" "review DISPATCH_DETACH=0: no durable result (detach bypassed)"

# =========================================================================================
# (h) Strict contract with default detachment
# =========================================================================================
STRICT_SBX="$TEST_TMP/strict-repo"
STRICT_SCORES_DIR="$TEST_TMP/strict-engine-scores"
STRICT_CAPS_DIR="$TEST_TMP/strict-engine-caps"
STRICT_SESSION_DIR="$TEST_TMP/strict-session-mode"
STRICT_LEDGER="$TEST_TMP/strict-ledger.jsonl"
STRICT_STUB="$TEST_TMP/strict-codex-stub"
STRICT_CONTRACT="$TEST_TMP/strict-contract.json"
STRICT_PROMPT="$TEST_TMP/strict-prompt.txt"
STRICT_ACCEPTANCE_MARKER="$TEST_TMP/strict-acceptance-ran.txt"

mkdir -p "$STRICT_SBX" "$STRICT_SCORES_DIR" "$STRICT_CAPS_DIR" "$STRICT_SESSION_DIR"

cat > "$STRICT_STUB" <<'EOF_STUB'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
echo done > done.txt
git add done.txt
git -c user.email=t@t -c user.name=t commit -q -m "stub work"
exit 0
EOF_STUB
chmod +x "$STRICT_STUB"

git -C "$STRICT_SBX" init -q -b main
git -C "$STRICT_SBX" config user.email "t@t"
git -C "$STRICT_SBX" config user.name "t"

mkdir -p "$STRICT_SBX/docs/plans"
mkdir -p "$STRICT_SBX/.claude"

printf 'Prereq content\n' > "$STRICT_SBX/preq.txt"
git -C "$STRICT_SBX" add -A
git -C "$STRICT_SBX" commit -q -m "Prereq commit"
STRICT_DEP_SHA=$(git -C "$STRICT_SBX" rev-parse HEAD)

printf '## Unit spec\nStable spec content\n' > "$STRICT_SBX/docs/plans/spec.md"
printf '# Review Loop Config\n- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n' > "$STRICT_SBX/.claude/review-loop-config.md"
git -C "$STRICT_SBX" add -A
git -C "$STRICT_SBX" commit -q -m "Base commit"
STRICT_BASE_SHA=$(git -C "$STRICT_SBX" rev-parse HEAD)

cat > "$STRICT_CONTRACT" <<EOF
{
  "schema": 1,
  "unit_id": "strict-detach-unit",
  "role": "implementer",
  "goal": "fixture",
  "spec": {"path": "docs/plans/spec.md", "section": "Unit spec"},
  "base_sha": "$STRICT_BASE_SHA",
  "depends_on": ["$STRICT_DEP_SHA"],
  "scope": {"allow_paths": ["done.txt"], "deny_paths": ["secret/**"], "max_files": 2, "max_diff_lines": 50},
  "go": {"required_paths": ["docs/plans/spec.md"], "required_engine_role": "implementer", "required_red_command": ["bash", "-n", "docs/plans/spec.md"]},
  "no_go": {"on_missing_spec": "stop", "on_dirty_base": "stop", "on_unknown_engine": "stop", "on_quota_unavailable": "stop", "on_scope_violation": "stop", "on_budget_exceeded": "stop", "on_clarification_needed": "stop", "forbidden_actions": ["push", "merge", "network", "dependency-change"]},
  "output": {"kind": "commit", "paths": ["done.txt"]},
  "acceptance": [{"argv": ["touch", "$STRICT_ACCEPTANCE_MARKER"], "exit": 0}],
  "budget": {"wall_seconds": 120, "max_attempts": 1, "max_context_files": 4}
}
EOF

ENGINE_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
RUNTIME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Exact resolver tuple: implementer_effort defaults to high; endpoint "" → null/@none.
ENGINE_EVENT="{\"schema_version\":1,\"observed_at\":\"$RUNTIME_UTC\",\"runner\":\"codex\",\"model\":\"gpt-5.3-codex-spark\",\"role\":\"implementer\",\"effort\":\"high\",\"endpoint\":null,\"runner_version\":\"v1.0.0\",\"capability\":{\"quota\":{\"status\":\"available\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"reset_at\":null,\"evidence\":\"test\"}}}"

printf '%s\n' "$ENGINE_ROW" > "$TEST_TMP/strict-engine-row.json"
printf '%s\n' "$ENGINE_EVENT" > "$TEST_TMP/strict-engine-event.json"

ENGINE_SCORECARD_DIR="$STRICT_SCORES_DIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$TEST_TMP/strict-engine-row.json" >/dev/null
ENGINE_CAPABILITY_DIR="$STRICT_CAPS_DIR" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/strict-engine-event.json" >/dev/null

bash "$LEDGER_SH" init --ledger "$STRICT_LEDGER" >/dev/null
echo "Do the needful." > "$STRICT_PROMPT"

CHECKER_OUT=$(ENGINE_SCORECARD_DIR="$STRICT_SCORES_DIR" ENGINE_CAPABILITY_DIR="$STRICT_CAPS_DIR" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$STRICT_CONTRACT" --repo "$STRICT_SBX" --json 2>&1)
CHECKER_JSON=$(echo "$CHECKER_OUT" | grep '^{' | tail -n 1)
GATE_VERDICT=$(echo "$CHECKER_JSON" | jq -r '.verdict' 2>/dev/null)
assert_eq "GO" "$GATE_VERDICT" "pre-dispatch contract checker reaches GO"

EXPECTED_CONTRACT_SHA=$(echo "$CHECKER_JSON" | jq -r '.contract_sha256' 2>/dev/null)
EXPECTED_SPEC_SHA=$(echo "$CHECKER_JSON" | jq -r '.spec_sha256' 2>/dev/null)

OUT_STRICT="$(cd "$STRICT_SBX" && ENGINE_SCORECARD_DIR="$STRICT_SCORES_DIR" ENGINE_CAPABILITY_DIR="$STRICT_CAPS_DIR" AUTOPILOT_SESSION_MODE_DIR="$STRICT_SESSION_DIR" DISPATCH_HEARTBEAT_SECS=1 bash "$SCRIPT" \
  --branch feat/strict-detach --prompt-file "$STRICT_PROMPT" --runner codex --model gpt-5.3-codex-spark --codex-bin "$STRICT_STUB" \
  --ledger "$STRICT_LEDGER" --run-id strict-detach-run --stage implement --strict-contract --contract-file "$STRICT_CONTRACT" 2>/dev/null)"; EXIT_STRICT=$?

assert_eq "0" "$EXIT_STRICT" "strict detach: relayed exit code is 0 (committed)"
reap_wt "$OUT_STRICT"

assert_eq "committed" "$(printf '%s' "$OUT_STRICT" | jq -r '.status' 2>/dev/null)" "strict detach: outcome status is committed"
assert_eq "strict-detach-unit" "$(printf '%s' "$OUT_STRICT" | jq -r '.unit_id' 2>/dev/null)" "strict detach: outcome preserves unit_id"
assert_eq "$EXPECTED_CONTRACT_SHA" "$(printf '%s' "$OUT_STRICT" | jq -r '.contract_sha256' 2>/dev/null)" "strict detach: outcome preserves contract_sha256"
assert_eq "$EXPECTED_SPEC_SHA" "$(printf '%s' "$OUT_STRICT" | jq -r '.spec_sha256' 2>/dev/null)" "strict detach: outcome preserves spec_sha256"
assert_eq "GO" "$(printf '%s' "$OUT_STRICT" | jq -r '.go' 2>/dev/null)" "strict detach: outcome preserves go field"

DURABLE_RESULT="${STRICT_LEDGER}.results/strict-detach-run.implement.result.json"
assert_file_exists "$DURABLE_RESULT" "strict detach: durable result file also landed"
DURABLE_JSON="$(cat "$DURABLE_RESULT" 2>/dev/null)"
reap_wt "$DURABLE_JSON"

assert_eq "committed" "$(printf '%s' "$DURABLE_JSON" | jq -r '.status' 2>/dev/null)" "strict detach: durable status is committed"
assert_eq "strict-detach-unit" "$(printf '%s' "$DURABLE_JSON" | jq -r '.unit_id' 2>/dev/null)" "strict detach: durable preserves unit_id"
assert_eq "$EXPECTED_CONTRACT_SHA" "$(printf '%s' "$DURABLE_JSON" | jq -r '.contract_sha256' 2>/dev/null)" "strict detach: durable preserves contract_sha256"
assert_eq "$EXPECTED_SPEC_SHA" "$(printf '%s' "$DURABLE_JSON" | jq -r '.spec_sha256' 2>/dev/null)" "strict detach: durable preserves spec_sha256"
assert_eq "GO" "$(printf '%s' "$DURABLE_JSON" | jq -r '.go' 2>/dev/null)" "strict detach: durable preserves go field"

assert_file_exists "$STRICT_ACCEPTANCE_MARKER" "strict detach: strict acceptance check completed and touched the marker file"

# --- cleanup any KEEP=1 detached worktrees so they don't leak into /tmp ---
for wt in "${LEAKED_WTS[@]}"; do
  [ -n "$wt" ] || continue
  git -C "$SBX" worktree remove --force "$wt" >/dev/null 2>&1 || git -C "$STRICT_SBX" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt" 2>/dev/null || true
done

finalize_test
