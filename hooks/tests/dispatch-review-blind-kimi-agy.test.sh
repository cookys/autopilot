#!/usr/bin/env bash
# RED at 92455ca3: migrated layout (config/agents + dangling alias) reviewed -> expected 0 got 1 (2 FAIL); launcher seeds config/agents -> file missing (1 FAIL)
# dispatch-review-blind-kimi-agy.test.sh — final-panel isolation phase 3: the BLIND kimi/agy rail.
#
# Stub kimi/agy binaries and a stub launcher that fabricates the kept seat. No model call, no real
# bwrap, no real ~/.kimi-code or ~/.gemini. Every case has the launcher EXIT 0: exit 0 must never be
# proof of containment, so each void condition (tool call, non-empty/missing tool snapshot, unknown
# record, missing wire/transcript/log, agent fallback, wrong agent) must yield no_verdict.
#
# RED at 47a0e1c6 (blind kimi/agy with a review packet dies at the tier-table gate, exit 2; 81 FAILs):
#   FAIL blind kimi clean seat is reviewed: expected '2', got '0'   (lib prints actual first: actual 2, wanted 0)
#   FAIL blind agy clean seat is reviewed: expected '2', got '0'
#   FAIL blind kimi [tool-call] with launcher exit 0 is no_verdict: expected '2', got '1'
#   ... same shape for every void case (error text "enforceable no-tools runner profile")
# Negative controls run: audit calls disabled -> 73 FAILs; non-blind kimi argv + "--x" -> byte-compare FAILs.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"

PKT="$TEST_TMP/pkt"; mkdir -p "$PKT/tree"; printf '{}\n' > "$PKT/MANIFEST.json"; printf 'x\n' > "$PKT/tree/README.md"
FAKE_BWRAP="$TEST_TMP/fake-bwrap"; printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BWRAP"; chmod +x "$FAKE_BWRAP"
KIMI_WIRE="$REPO_ROOT/scripts/lib/fixtures/kimi-containment/k2-clean/wire.jsonl"
export LIB_DIR="$REPO_ROOT/scripts/lib"

# stub kimi entry + stub agy (agy: --version/models via the shared versioned stub; never executed)
STUB_KIMI="$TEST_TMP/stub-kimi"; printf '#!/usr/bin/env bash\nexit 99\n' > "$STUB_KIMI"; chmod +x "$STUB_KIMI"
STUB_AGY="$TEST_TMP/stub-agy"; printf '#!/usr/bin/env bash\nexit 99\n' > "$STUB_AGY"; chmod +x "$STUB_AGY"
make_agy_stub_versioned "$STUB_AGY"

LAUNCH_LOG="$TEST_TMP/launch.log"; LAUNCH_ARGV="$TEST_TMP/launch.argv"; PF_ARGV="$TEST_TMP/pf.argv"
LAUNCHER="$TEST_TMP/stub-launcher.sh"
cat > "$LAUNCHER" <<'EOF'
#!/usr/bin/env bash
# stub launcher: records argv, fabricates the kept seat per $SCEN, ALWAYS exits $LAUNCH_RC (default 0).
printf '%s\n' "$*" >> "$LAUNCH_LOG"
if printf '%s\n' "$@" | grep -qx -- '--preflight'; then
  printf '%s\n' "$@" > "$PF_ARGV"
  if [ "${PF_RC:-0}" != 0 ]; then echo "${PF_ERR:-preflight red}" >&2; exit "$PF_RC"; fi
  # real launcher shape: one JSON line, runner_version only for kimi/agy preflight
  if [ -n "${PF_VER:-}" ]; then
    printf '{ "schema_version": 1, "artifact_type": "cleanroom_launch", "profile": "x", "runner": "x", "runner_version": "%s", "exit_status": 0 }\n' "$PF_VER"
  fi
  exit 0
fi
printf '%s\n' "$@" > "$LAUNCH_ARGV"
out=""; err=""; seat=""; prompt=""; prof=""
while [ $# -gt 0 ]; do
  case "$1" in --out) out="$2"; shift;; --err) err="$2"; shift;; --seat-root) seat="$2"; shift;;
    --prompt-file) prompt="$2"; shift;; --profile) prof="$2"; shift;; esac
  shift
done
begin="$(sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' "$prompt" | sed -n 1p)"
end="$(sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' "$prompt" | sed -n 1p)"
body="$(printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=diff and supplied acceptance criteria; evidence=target behavior was traced against the fixture; conclusion=no concrete blocking discrepancy was observed\n%s\n' "$begin" "$end")"
: > "$err"
if [ "$prof" = kimi ]; then
  printf '%s\n' "$body" > "$out"
  [ "${SCEN:-clean}" = no-seat ] && exit "${LAUNCH_RC:-0}"
  if [ "${SCEN:-clean}" != no-wire ]; then
    d="$seat/home/.kimi-code/sessions/s1"; mkdir -p "$d"
    SCEN="${SCEN:-clean}" node -e '
      const fs=require("fs"); const [src,dst]=process.argv.slice(1); const S=process.env.SCEN;
      let lines=fs.readFileSync(src,"utf8").split("\n").filter(Boolean);
      if(S==="tool-call") lines.push(JSON.stringify({type:"context.append_loop_event",event:{type:"tool.call",name:"Shell"}}));
      if(S==="no-snapshot") lines=lines.filter(l=>!l.includes("llm.tools_snapshot"));
      if(S==="snapshot-nonempty") lines=lines.map(l=>l.includes("llm.tools_snapshot")?l.replace("\"tools\":[]","\"tools\":[{\"name\":\"Shell\"}]"):l);
      if(S==="unknown-type") lines.push(JSON.stringify({type:"some.new.record"}));
      if(S==="unparseable") lines.push("{not json");
      if(S==="wrong-agent") lines=lines.map(l=>l.replace("\"profileName\":\"toolless-reviewer\"","\"profileName\":\"default\""));
      if(S==="empty-wire") lines=[];
      fs.writeFileSync(dst,lines.join("\n")+(lines.length?"\n":""));
    ' "$KIMI_WIRE" "$d/wire.jsonl"
  fi
else
  printf '%s' "$(RESPONSE="$body" node -e 'process.stdout.write(JSON.stringify({conversation_id:"f",duration_seconds:1,num_turns:1,response:process.env.RESPONSE,status:"SUCCESS",usage:{cache_read_tokens:1,input_tokens:2,output_tokens:3,thinking_tokens:4,total_tokens:10}}))')" > "$out"
  [ "${SCEN:-clean}" = no-seat ] && exit "${LAUNCH_RC:-0}"
  app="$seat/home/.gemini/antigravity-cli"; mkdir -p "$app/log" "$app/brain/c1" "$app/agents"
  node "$LIB_DIR/agy-containment.js" write "$app/agents"
  S="${SCEN:-clean}"
  log='I0924 conversation_manager.go:512] Starting new conversation (agent=true)
I0924 x.go:1] Creating new cascade trajectory (agentScript=true)'
  [ "$S" = fallback ] && log='I0924 x.go:1] Agent "autopilot-toolless-reviewer" not found, falling back to default
Starting new conversation (agent=false) agentScript=false'
  [ "$S" = no-marker ] && log='I0924 x.go:1] Starting new conversation (agent=false)'
  [ "$S" = no-log ] || printf '%s\n' "$log" > "$app/log/a.log"
  [ "$S" = second-agent ] && mkdir -p "$app/agents/other"
  # agy 1.2.15 layout: the agent lives in config/agents and antigravity-cli/agents is an ABSOLUTE symlink
  # that dangles on the host (target is the in-seat /home/review path).
  case "$S" in migrated|migrated-second-agent|migrated-empty)
    rm -r "$app/agents"; mkdir -p "$seat/home/.gemini/config"
    node "$LIB_DIR/agy-containment.js" write "$seat/home/.gemini/config/agents"
    ln -s /home/review/.gemini/config/agents "$app/agents"
    [ "$S" = migrated-second-agent ] && mkdir -p "$seat/home/.gemini/config/agents/other"
    [ "$S" = migrated-empty ] && rm -r "$seat/home/.gemini/config/agents/autopilot-toolless-reviewer"
    ;;
  esac
  if [ "$S" != no-transcript ]; then
    {
      printf '%s\n' '{"step_index":0,"type":"USER_INPUT"}'
      [ "$S" = tool-call ] && printf '%s\n' '{"step_index":1,"type":"PLANNER_RESPONSE","tool_calls":[{"name":"run_command"}]}'
      [ "$S" = unknown-step ] && printf '%s\n' '{"step_index":1,"type":"RUN_COMMAND"}'
      [ "$S" = unparseable ] && printf '%s\n' '{oops'
      printf '%s\n' '{"step_index":2,"type":"PLANNER_RESPONSE"}'
    } > "$app/brain/c1/transcript.jsonl"
  fi
fi
exit "${LAUNCH_RC:-0}"
EOF
chmod +x "$LAUNCHER"
export LAUNCH_LOG LAUNCH_ARGV PF_ARGV KIMI_WIRE

run_blind() { # runner scen [extra env assignments via env]
  local runner="$1" scen="$2" bin
  bin="$STUB_KIMI"; [ "$runner" = agy ] && bin="$STUB_AGY"
  : > "$LAUNCH_LOG"
  SCEN="$scen" AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$PKT" \
    AUTOPILOT_CLEANROOM_BWRAP="$FAKE_BWRAP" AUTOPILOT_CLEANROOM_LAUNCHER="$LAUNCHER" \
    AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
    "$SCRIPT" --runner "$runner" --model "${MODEL_ARG:-fixture}" --diff-file "$DIFF" --bin "$bin" 2>&1
}

# ---- clean seats are reviewed; launcher shape ----
for R in kimi agy; do
  M=fixture; [ "$R" = agy ] && M=gemini-3.6-flash-high
  MODEL_ARG="$M"
  rm -f "$LAUNCH_ARGV" "$PF_ARGV"
  OUT="$(run_blind "$R" clean)"; EXIT=$?
  assert_eq "0" "$EXIT" "blind $R clean seat is reviewed"
  assert_contains "$OUT" '"status": "reviewed"' "blind $R clean seat status"
  LA="$(tr '\n' ' ' < "$LAUNCH_ARGV")"
  assert_contains "$LA" "--profile $R" "blind $R launcher received --profile $R"
  assert_contains "$LA" '--keep-seat' "blind $R seat is kept for the audit"
  assert_contains "$LA" "--bwrap $FAKE_BWRAP" "blind $R launcher receives bwrap"
  assert_contains "$LA" "--model $M" "blind $R launcher receives the model"
  assert_not_contains "$LA" "$PKT" "blind $R launch argv carries no packet path"
  PA="$(tr '\n' ' ' < "$PF_ARGV")"
  assert_contains "$PA" "--preflight --profile $R" "blind $R preflight is profile-specific"
  assert_contains "$PA" "--deny-path $PKT" "blind $R preflight denies the packet dir"
  assert_not_contains "$PA" '--prompt-file' "blind $R preflight carries no prompt"
  assert_not_contains "$PA" '--cred-dir' "blind $R preflight carries no credential"
  assert_eq "preflight-before-launch" "$(awk 'NR==1&&/--preflight/{a=1} NR==2&&/--profile/{b=1} END{print (a&&b)?"preflight-before-launch":"bad"}' "$LAUNCH_LOG")" "blind $R preflight runs before launch"
done
assert_contains "$(tr '\n' ' ' < "$LAUNCH_ARGV")" '--effort' "blind agy launcher receives --effort"
MODEL_ARG=fixture; run_blind kimi clean >/dev/null
KA="$(tr '\n' ' ' < "$LAUNCH_ARGV")"
assert_contains "$KA" '--agent-file' "blind kimi launcher receives the lib's tool-less agent file"
assert_contains "$(tr '\n' ' ' < "$PF_ARGV")" '--agent-file' "blind kimi preflight checks the agent file"
assert_not_contains "$KA" '--effort' "blind kimi launcher gets no --effort (unchanged kimi argv)"

# ---- void conditions: launcher exits 0 every time; the audit must void the verdict ----
for C in tool-call no-snapshot snapshot-nonempty unknown-type unparseable wrong-agent empty-wire no-wire no-seat; do
  MODEL_ARG=fixture
  OUT="$(run_blind kimi "$C")"; EXIT=$?
  assert_eq "1" "$EXIT" "blind kimi [$C] with launcher exit 0 is no_verdict"
  assert_contains "$OUT" '"status": "no_verdict"' "blind kimi [$C] status"
  assert_contains "$OUT" 'fail-closed' "blind kimi [$C] is a fail-closed void"
  assert_not_contains "$OUT" '"status": "reviewed"' "blind kimi [$C] never reviewed"
done
for C in tool-call unknown-step unparseable no-transcript no-log fallback no-marker second-agent no-seat; do
  MODEL_ARG=gemini-3.6-flash-high
  OUT="$(run_blind agy "$C")"; EXIT=$?
  assert_eq "1" "$EXIT" "blind agy [$C] with launcher exit 0 is no_verdict"
  assert_contains "$OUT" '"status": "no_verdict"' "blind agy [$C] status"
  assert_contains "$OUT" 'fail-closed' "blind agy [$C] is a fail-closed void"
  assert_not_contains "$OUT" '"status": "reviewed"' "blind agy [$C] never reviewed"
done

# ---- agy 1.2.15 migrated layout (phase-5 live-fire repair) ----
MODEL_ARG=gemini-3.6-flash-high
OUT="$(run_blind agy migrated)"; EXIT=$?
assert_eq "0" "$EXIT" "blind agy migrated layout (config/agents + dangling alias) is reviewed"
assert_contains "$OUT" '"status": "reviewed"' "blind agy migrated layout status"
for C in migrated-second-agent migrated-empty; do
  OUT="$(run_blind agy "$C")"; EXIT=$?
  assert_eq "1" "$EXIT" "blind agy [$C] is no_verdict"
  assert_contains "$OUT" 'fail-closed' "blind agy [$C] is a fail-closed void"
done

# ---- launcher non-zero / preflight red / missing pieces ----
MODEL_ARG=fixture
OUT="$(LAUNCH_RC=124 run_blind kimi clean)"; EXIT=$?
assert_eq "1" "$EXIT" "blind kimi launcher rc=124 is no_verdict"
OUT="$(PF_RC=3 PF_ERR='deny path readable' run_blind kimi clean)"; EXIT=$?
assert_eq "2" "$EXIT" "blind kimi red preflight refuses (exit 2)"
assert_contains "$OUT" 'cleanroom runtime unusable: deny path readable' "blind kimi preflight red is named"
assert_eq "0" "$(grep -c -- '--profile kimi --prompt-file' "$LAUNCH_LOG")" "blind kimi red preflight never launches"
MODEL_ARG=gemini-3.6-flash-high
OUT="$(PF_RC=2 PF_ERR='userns blocked' run_blind agy clean)"; EXIT=$?
assert_eq "2" "$EXIT" "blind agy red preflight refuses (exit 2)"
assert_contains "$OUT" 'cleanroom runtime unusable: userns blocked' "blind agy preflight red is named"
OUT="$(LAUNCH_RC=124 run_blind agy clean)"; EXIT=$?
assert_eq "1" "$EXIT" "blind agy launcher rc=124 is no_verdict"
MISSING="$TEST_TMP/no-such-launcher"
OUT="$(AUTOPILOT_CLEANROOM_LAUNCHER="$MISSING" SCEN=clean AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$PKT" \
  AUTOPILOT_CLEANROOM_BWRAP="$FAKE_BWRAP" DISPATCH_QUIET=1 "$SCRIPT" --runner kimi --model fixture --diff-file "$DIFF" --bin "$STUB_KIMI" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "blind kimi with a missing launcher refuses"
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$PKT" AUTOPILOT_CLEANROOM_BWRAP=/nonexistent \
  AUTOPILOT_CLEANROOM_LAUNCHER="$LAUNCHER" DISPATCH_QUIET=1 "$SCRIPT" --runner kimi --model fixture --diff-file "$DIFF" --bin "$STUB_KIMI" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "blind kimi with a missing bwrap refuses"
assert_contains "$OUT" 'bwrap not found' "blind kimi names the missing bwrap"
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$PKT" AUTOPILOT_CLEANROOM_BWRAP="$FAKE_BWRAP" \
  AUTOPILOT_CLEANROOM_LAUNCHER="$LAUNCHER" DISPATCH_QUIET=1 "$SCRIPT" --runner kimi --model fixture --diff-file "$DIFF" --bin "$TEST_TMP/no-such-kimi" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "blind kimi with a missing binary refuses"

# ---- preserved refusals ----
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 DISPATCH_QUIET=1 "$SCRIPT" --runner kimi --model fixture --diff-file "$DIFF" --bin "$STUB_KIMI" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "blind kimi without a packet keeps the tier-table refusal"
# phase 4 made kimi cleanroom tier, so the no-packet refusal is now the cleanroom one (was the tier-table text at phase 3)
assert_contains "$OUT" 'cleanroom seat requires a review packet' "blind kimi without a packet: refused as cleanroom seat"
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$PKT" AUTOPILOT_CLEANROOM_BWRAP="$FAKE_BWRAP" \
  AUTOPILOT_CLEANROOM_LAUNCHER="$LAUNCHER" DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model fixture --diff-file "$DIFF" --bin "$STUB_KIMI" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "blind grok with a packet is still refused (rail is kimi/agy only)"
assert_contains "$OUT" 'enforceable no-tools runner profile (got: grok)' "blind grok message unchanged"
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 AUTOPILOT_REVIEW_PACKET_DIR="$PKT" DISPATCH_QUIET=1 "$SCRIPT" --runner nope --model fixture --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "invalid --runner is still precondition_failed"

# ---- NON-BLIND byte-compare: launcher wrap absent, argv/cwd/env as at base ----
KIMI_REC="$TEST_TMP/kimi-nonblind-rec"
cat > "$KIMI_REC" <<'EOF'
#!/usr/bin/env bash
{ printf 'ARGV:'; printf ' [%s]' "$@"; printf '\nCWD-IS-TMP:%s\n' "$(case "$PWD" in /tmp/*|"${TMPDIR:-/tmp}"/*) echo yes;; *) echo no;; esac)"; env | grep -E '^(AUTOPILOT_|HOME=|PATH=)' | grep -v -E '^(AUTOPILOT_CLEANROOM|AUTOPILOT_REVIEW_PACKET)' | sort; } > "$KIMI_REC_OUT"
begin="$(printf '%s\n' "$2" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n 1p)"
end="$(printf '%s\n' "$2" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n 1p)"
printf '%s\nVERDICT: FIX-THEN-SHIP\nFINDINGS: x\n%s\n' "$begin" "$end"
EOF
chmod +x "$KIMI_REC"
export KIMI_REC_OUT="$TEST_TMP/kimi-nonblind.rec"
: > "$LAUNCH_LOG"
OUT="$(AUTOPILOT_CLEANROOM_LAUNCHER="$LAUNCHER" AUTOPILOT_CLEANROOM_BWRAP="$FAKE_BWRAP" AUTOPILOT_REVIEW_PACKET_DIR="$PKT" \
  AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$SCRIPT" --runner kimi --model kimi-code/k3 --diff-file "$DIFF" --bin "$KIMI_REC" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "non-blind kimi still reviewed"
assert_eq "0" "$(wc -c < "$LAUNCH_LOG" | tr -d ' ')" "non-blind kimi never touches the cleanroom launcher (wrap absent)"
REC="$(cat "$KIMI_REC_OUT")"
assert_contains "$REC" 'ARGV: [-p] [' "non-blind kimi argv starts with -p <prompt>"
assert_contains "$REC" '[-m] [kimi-code/k3] [--output-format] [text]' "non-blind kimi argv tail is exactly -m <model> --output-format text"
assert_not_contains "$REC" '--agent-file' "non-blind kimi argv has no --agent-file"
assert_contains "$REC" 'CWD-IS-TMP:yes' "non-blind kimi still runs in a scratch cwd"
assert_not_contains "$REC" 'AUTOPILOT_BLIND' "non-blind kimi env carries no blind flag"
# The wrap must also be absent from the non-blind branch SOURCE: every launcher reference sits under the blind guard.
NB_REFS="$(awk '/elif \[\[ "\$RUNNER" = "kimi" \]\]/{k=1} /elif \[\[ "\$RUNNER" = "opencode" \]\]/{k=0} k' "$SCRIPT" | awk '/BLIND_RUNNER_CLEANROOM" -eq 1/{g=1} /^  else$/{g=0} !g' | grep -c '_CLEANROOM_LAUNCHER')"
assert_eq "0" "$NB_REFS" "negative control: kimi launcher references exist only under the blind guard"

# ---- NON-BLIND argv/cwd/env byte-compare against the phase-2 base script (nonces/run ids normalised) ----
BASE_SHA=47a0e1c6
BASE_COPY="$REPO_ROOT/scripts/.dispatch-review-base-$$.sh"
if git -C "$REPO_ROOT" show "$BASE_SHA:scripts/dispatch-review.sh" > "$BASE_COPY" 2>/dev/null; then
  chmod +x "$BASE_COPY"
  CMP_REC="$TEST_TMP/cmp-rec"
  cat > "$CMP_REC" <<'EOF'
#!/usr/bin/env bash
{ printf 'ARGV:'; printf ' [%s]' "$@"; printf '\nPWDSHAPE:%s\n' "$(basename "$PWD" | sed -E 's/[A-Za-z0-9]{6}$/X/')"; env | grep -E '^(AUTOPILOT_|HOME=|PATH=)' | sort; } >> "$CMP_REC_OUT"
[ "${1:-}" = "--version" ] && { echo 1.1.10; exit 0; }
[ "${1:-}" = "models" ] && { printf 'gemini-3.6-flash-high\tG\n'; exit 0; }
exit 99
EOF
  chmod +x "$CMP_REC"
  mkdir -p "$TEST_TMP/cmp-home"
  export CMP_REC_OUT
  for CR in kimi agy; do
    CM=kimi-code/k3; [ "$CR" = agy ] && CM=gemini-3.6-flash-high
    for WHO in "$BASE_COPY" "$SCRIPT"; do
      CMP_REC_OUT="$TEST_TMP/cmp-$CR-$(basename "$WHO").rec" HOME="$TEST_TMP/cmp-home" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 \
        bash "$WHO" --runner "$CR" --model "$CM" --diff-file "$DIFF" --bin "$CMP_REC" >/dev/null 2>&1 < /dev/null
    done
    NORM='s/[0-9a-f]{32}/N/g; s/review-[0-9a-f-]+/RUNID/g'
    assert_eq "$(sed -E "$NORM" "$TEST_TMP/cmp-$CR-$(basename "$BASE_COPY").rec")" "$(sed -E "$NORM" "$TEST_TMP/cmp-$CR-$(basename "$SCRIPT").rec")" \
      "non-blind $CR argv/cwd-shape/env are byte-identical to base $BASE_SHA"
    assert_contains "$(cat "$TEST_TMP/cmp-$CR-$(basename "$SCRIPT").rec")" 'ARGV:' "non-blind $CR byte-compare actually ran the recorder"
  done
  rm -f "$BASE_COPY"
fi

# ---- dispatch-time version warning (plan §8.3): advisory only, never blocks, never changes the verdict ----
# RED at 033750f9 (no warning code): the mismatch cases below FAIL on assert_contains 'WARNING'.
for R in kimi agy; do
  M=fixture; [ "$R" = agy ] && M=gemini-3.6-flash-high
  MODEL_ARG="$M"
  OUT_MATCH="$(PF_VER=1.2.15 AUTOPILOT_CLEANROOM_EXPECTED_VERSION=1.2.15 run_blind "$R" clean)"; EXIT=$?
  assert_eq "0" "$EXIT" "version match: blind $R reviewed"
  assert_not_contains "$OUT_MATCH" 'WARNING' "version match: blind $R is silent"
  OUT_MIS="$(PF_VER=1.2.15 AUTOPILOT_CLEANROOM_EXPECTED_VERSION=1.2.14 run_blind "$R" clean)"; EXIT=$?
  assert_eq "0" "$EXIT" "version mismatch: blind $R still reviewed (never blocks)"
  assert_contains "$OUT_MIS" 'WARNING' "version mismatch: blind $R warns"
  assert_contains "$OUT_MIS" '1.2.14' "version mismatch: warning names the recorded version ($R)"
  assert_contains "$OUT_MIS" '1.2.15' "version mismatch: warning names the observed version ($R)"
  assert_eq "$(printf '%s\n' "$OUT_MATCH" | grep -v WARNING | sed -E 's/[0-9a-f]{32}/N/g; s/review-[0-9a-f-]+/RUNID/g; s/dispatch-review-log-[A-Za-z0-9]+/LOG/g')" \
    "$(printf '%s\n' "$OUT_MIS" | grep -v WARNING | sed -E 's/[0-9a-f]{32}/N/g; s/review-[0-9a-f-]+/RUNID/g; s/dispatch-review-log-[A-Za-z0-9]+/LOG/g')" \
    "version mismatch: blind $R output identical apart from the warning line"
  OUT_ABS="$(PF_VER=1.2.15 run_blind "$R" clean)"; EXIT=$?
  assert_eq "0" "$EXIT" "no expected version: blind $R reviewed"
  assert_not_contains "$OUT_ABS" 'WARNING' "no expected version: blind $R is silent"
  OUT_NOV="$(AUTOPILOT_CLEANROOM_EXPECTED_VERSION=1.2.14 run_blind "$R" clean)"; EXIT=$?
  assert_eq "0" "$EXIT" "expected but preflight reports no version: blind $R reviewed"
  assert_not_contains "$OUT_NOV" 'WARNING' "expected but preflight reports no version: blind $R is silent"
  OUT_VOID="$(PF_VER=1.2.15 AUTOPILOT_CLEANROOM_EXPECTED_VERSION=1.2.14 run_blind "$R" tool-call)"; EXIT=$?
  assert_eq "1" "$EXIT" "version mismatch never rescues a breach: blind $R tool-call is still no_verdict"
done

finalize_test
