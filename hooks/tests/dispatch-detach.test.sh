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

# Let it get past worktree setup + into the detached run, then SIGKILL the wrapper.
sleep 2
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

# ledger shows the stage committed
COMMIT_ROWS="$(grep -c '"state":"committed"' "$LEDGER_A" 2>/dev/null)"; COMMIT_ROWS="${COMMIT_ROWS:-0}"
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
echo "$b"; echo "VERDICT: SHIP-AS-IS"; echo "FINDINGS: none"; echo "$e"
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

# --- cleanup any KEEP=1 detached worktrees so they don't leak into /tmp ---
for wt in "${LEAKED_WTS[@]}"; do
  [ -n "$wt" ] || continue
  git -C "$SBX" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt" 2>/dev/null || true
done

finalize_test
