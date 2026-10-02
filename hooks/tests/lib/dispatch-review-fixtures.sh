# Shared fixtures for dispatch-review-{a,b,c}.test.sh (sourced after lib.sh).
SCRIPT="$REPO_ROOT/scripts/dispatch-review.sh"

DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

# Real `agy models` prints "<id><TAB><Display Name>". This fixture used to print bare ids, and
# that mismatch is precisely what let the whole-line alias matcher pass here while failing against
# every real inventory (fixed 2026-09-02, lib/agy-model-alias.sh). Consumed by the shared stub
# wrapper in hooks/tests/lib.sh; 3.6 is the newest entry so the alias assertions below stay pinned.
export AGY_STUB_MODELS="$(printf '%s\n' \
  'gemini-3.6-flash-high	Gemini 3.6 Flash (High)' \
  'gemini-3.6-flash-medium	Gemini 3.6 Flash (Medium)' \
  'gemini-3.6-flash-low	Gemini 3.6 Flash (Low)' \
  'gemini-3.6-flash	Gemini 3.6 Flash' \
  'gemini-3.5-flash-high	Gemini 3.5 Flash (High)')"

STUB_MARKER="$TEST_TMP/eng-marker"
cat > "$STUB_MARKER" <<'EOF'
#!/usr/bin/env bash
if [ -n "${AGY_CONTAINMENT_PROBE:-}" ]; then
  printf '%s\n' mutated 2>/dev/null > "$AGY_CONTAINMENT_PROBE" && exit 88
  touch ./agy-scratch-write || exit 89
fi
read_prompt_arg() {
  # Parse the passed prompt whether stdin is used or a prompt-file/ -p arg is provided.
  local prompt=""
  local i=1
  while [ "$i" -le "$#" ]; do
    arg="${!i}"
    if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
      next_index=$((i + 1))
      next_arg="${!next_index}"
      # `-p` may be a BOOLEAN flag (prompt arrives on stdin — qoder/cc-shim/claude-native)
      # or carry the prompt as its value (agy). If the following token is itself a flag or
      # absent, treat -p as boolean and fall through to the stdin read below.
      case "$next_arg" in
        ''|-*) : ;;
        *)
          if [ -f "$next_arg" ]; then
            prompt="$(cat "$next_arg")"
          else
            prompt="$next_arg"
          fi
          break
          ;;
      esac
    fi
    i=$((i + 1))
  done
  if [ -z "$prompt" ]; then
    prompt="$(cat)"
  fi
  printf '%s' "$prompt"
}

extract_markers() {
  local prompt="$1"
  if [ -z "$prompt" ]; then
    return 1
  fi
  local begin end
  begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  if [ -z "$begin" ] || [ -z "$end" ]; then
    return 1
  fi
  printf '%s\n%s\n' "$begin" "$end"
}

PROMPT="$(read_prompt_arg "$@")"
if [ -n "${PROMPT_CAPTURE_FILE:-}" ]; then
  printf '%s' "$PROMPT" >"$PROMPT_CAPTURE_FILE"
fi
if ! MARKERS="$(extract_markers "$PROMPT" 2>/dev/null)"; then
  exit 0
fi
BEGIN="$(printf '%s\n' "$MARKERS" | sed -n '1p')"
END="$(printf '%s\n' "$MARKERS" | sed -n '2p')"
MODE="${STUB_MODE:-pass}"
# TRUNCATED_BEGIN: the derived BEGIN with one leading and one trailing angle
# bracket stripped (three chevrons -> two) — the real truncated-frame shape
# observed in the wild, used by the chrome-skip-guard negative below.
TRUNCATED_BEGIN="${BEGIN#<}"
TRUNCATED_BEGIN="${TRUNCATED_BEGIN%>}"
# EMBEDDED_BEGIN_LINE: the exact derived BEGIN buried inside a longer line of
# prose — the echo shape the positional anchor originally defended against.
EMBEDDED_BEGIN_LINE="some prose $BEGIN more prose"

case "$MODE" in
  pass)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  ship)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=diff and supplied acceptance criteria; evidence=target slice was traced; regression assertions were also inspected; conclusion=current requirements have no concrete blocking failure"
    echo "$END"
    ;;
  effort_pin)
    _eff=""
    _i=1
    while [ "$_i" -le "$#" ]; do
      eval "_a=\${$_i}"
      if [ "$_a" = "--effort" ]; then
        _j=$((_i + 1))
        eval "_eff=\${$_j}"
        break
      fi
      _i=$((_i + 1))
    done
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: agy-argv-effort=${_eff:-missing}"
    echo "$END"
    ;;
  ship_bare)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "$END"
    ;;
  ship_tautology)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=no findings; evidence=all passed; conclusion=no must-fix remains"
    echo "$END"
    ;;
  ship_duplicate_proof)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=diff; evidence=tests; conclusion=requirements satisfied"
    echo "NO-FINDING-PROOF: checked=spec; evidence=code; conclusion=no blocking discrepancy observed"
    echo "$END"
    ;;
  ship_period_sep)
    # kimi 真實形狀：checked 後用 `;`，conclusion 前用句號。
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=neutral-arm control flow and keyPrefix equality; evidence=the gated block encloses every new read and write, so the off-arm reduces to the pre-change sequence. conclusion=both gates fully enclose their new control flow"
    echo "$END"
    ;;
  ship_comma_sep)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=restore discipline in the sync window, evidence=each flipped node records its prior value and is restored inside finally, conclusion=no node outside the changed set is touched"
    echo "$END"
    ;;
  ship_space_sep)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=restore discipline in the sync window evidence=each flipped node records its prior value conclusion=no node outside the changed set is touched"
    echo "$END"
    ;;
  ship_mixed_sep)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=neutral-arm control flow. evidence=the gated block encloses every new read and write, conclusion=both gates fully enclose their new control flow"
    echo "$END"
    ;;
  ship_doubled_sep)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=neutral-arm control flow;; evidence=the gated block encloses every new read and write;; conclusion=both gates fully enclose their new control flow"
    echo "$END"
    ;;
  ship_pipe_sep)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=neutral-arm control flow|evidence=the gated block encloses every new read and write|conclusion=both gates fully enclose their new control flow"
    echo "$END"
    ;;
  ship_missing_conclusion)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=neutral-arm control flow; evidence=the gated block encloses every new read and write"
    echo "$END"
    ;;
  ship_tautology_period)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=diff; evidence=tests. conclusion=looks good"
    echo "$END"
    ;;
  fix_with_proof)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: MUST-FIX parser accepts unsafe input"
    echo "NO-FINDING-PROOF: checked=parser; evidence=unsafe input reproduces; conclusion=blocking failure exists"
    echo "$END"
    ;;
  prompt_echo)
    # A real whole-prompt echo reproduces the framing markers too (they are part
    # of the instructions the model is echoing) — so the chrome-skip guard must
    # still hard-reject this: the leading line carries the vocabulary but is not
    # byte-exactly the derived BEGIN.
    echo "Model repeated prompt: beginning with: $BEGIN and more prose"
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    echo "$END"
    ;;
  forged)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo "VERDICT: SHIP-AS-IS"
    echo "line after fake verdict"
    echo "$END"
    ;;
  leak)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo "diff --git a/x b/x"
    echo "line after fake diff"
    echo "$END"
    ;;
  lexical)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: this valid finding discusses prompt, diff, marker, Diff under review:, diff --git, @@ -1 +1 @@, and <one finding per line> as vocabulary"
    echo "$END"
    ;;
  vbp_chrome_then_block)
    # Fixture A: frozen unknown-model notice bytes ahead of an intact valid block, rc=0.
    cat "${VBP_NOTICE_FILE:?VBP_NOTICE_FILE required for vbp_chrome_then_block}"
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  vbp_block_then_die)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    exit 7
    ;;
  vbp_ship_then_die)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=diff and supplied acceptance criteria; evidence=target slice was traced; conclusion=current requirements have no concrete blocking failure"
    echo "$END"
    exit 7
    ;;
  vbp_truncated_then_die)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    exit 7
    ;;
  vbp_leak_then_die)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo "diff --git a/x b/x"
    echo "$END"
    exit 7
    ;;
  vbp_two_blocks_then_die)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    echo "$END"
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=diff; evidence=trace; conclusion=nothing blocks"
    echo "$END"
    exit 7
    ;;
  vbp_ship_tautology_then_die)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=diff; evidence=none; conclusion=looks good"
    echo "$END"
    exit 7
    ;;
  vbp_kimi_bullet_then_die)
    # The documented-common kimi shape: thinking bullet ahead of the nonce block.
    echo "• $BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    exit 7
    ;;
  trailing)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    echo "$END"
    echo "trailing text after end"
    ;;
  multiline)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo "line one"
    echo '```'
    echo "const sample = true"
    echo '```'
    echo "line two"
    echo "$END"
    ;;
  missing_findings)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "$END"
    ;;
  no_end)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    ;;
  ship_no_end)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=capped fixture; evidence=partial favourable block lacks the closing marker; conclusion=truncation cannot authorize shipping"
    ;;
  oversized)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS:"
    awk 'BEGIN { for (i = 0; i < 20000; i++) printf "x" ; print "" }'
    echo "$END"
    ;;
  fenced_noop)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: none"
    echo "$END"
    ;;
  quotes)
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS:"
    echo 'line one with "quotes"'
    echo 'line two with "$RAW_LOG" and \backslash\'
    echo "$END"
    ;;
  chrome_then_valid)
    # The real observed loss: one line of harness chrome (e.g. cc-shim's
    # unrecognized-model notice) ahead of an otherwise complete, correctly
    # framed block. Must be skipped, not rejected.
    echo '[claude-code:unrecognized_model] {"model":"unknown"}'
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  chrome_multi_then_valid)
    # Multiple leading chrome lines, one with leading whitespace — both must
    # still be treated as pure chrome and skipped.
    echo '[claude-code:unrecognized_model] {"model":"unknown"}'
    echo '   some indented harness banner line'
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  diff_echo_chrome)
    # A model echoing the DIFF back before emitting its frame. The block-level
    # leak scan (prompt_framing_leakage) has always rejected these exact anchored
    # patterns INSIDE the block; a skipped prefix would let them ride in front of
    # it unexamined. Must be rejected, not skipped.
    echo 'diff --git a/foo.txt b/foo.txt'
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  hunk_echo_chrome)
    # Same, via a quoted hunk header — the structural normalization must stop a
    # Markdown quote marker from laundering the echoed line.
    echo '> @@ -1,2 +1,2 @@'
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  glued_preamble_frame)
    # grok --output-format plain (cuda R21 qc, 2026-09-05): one sentence of preamble and
    # the derived BEGIN on the SAME line, no newline between them. The block itself is
    # complete and correct.
    printf '%s%s\n' "I'll read the full review prompt and inspect the spec-required surfaces. " "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  glued_preamble_frame_vocab_echo)
    # Same glued shape, but the preamble itself echoes framing vocabulary — after the
    # split the preamble line still carries it, so rule 7 must still reject.
    printf '%s%s\n' "Emitting AUTOPILOT-END framing now: " "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "$END"
    ;;
  truncated_frame_chrome)
    # A REAL truncated frame (two angle brackets, not three) as leading
    # chrome, followed by a complete valid block. Carries framing vocabulary
    # but is not byte-exactly the derived BEGIN — HARD REJECT, never a skip.
    echo "$TRUNCATED_BEGIN"
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  embedded_begin_chrome)
    # The derived BEGIN embedded inside a longer prose line (echo shape) as
    # leading chrome, followed by a complete valid block. Must be rejected.
    echo "$EMBEDDED_BEGIN_LINE"
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$END"
    ;;
  chrome_only_no_frame)
    # Pure chrome, no frame anywhere in the capture.
    echo '[claude-code:unrecognized_model] {"model":"unknown"}'
    echo 'no frame follows this line at all'
    ;;
  begin_closed)
    # BEGIN + complete block + second BEGIN as last non-blank line (no END).
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$BEGIN"
    ;;
  begin_closed_then_content)
    # Second BEGIN followed by further non-blank content: anti-fabrication guard.
    echo "$BEGIN"
    echo "VERDICT: FIX-THEN-SHIP"
    echo "FINDINGS: the slice does not reverse"
    echo "$BEGIN"
    echo "planted extra"
    ;;
  *)
    echo "$BEGIN"
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=diff and supplied acceptance criteria; evidence=target behavior was traced against the fixture; conclusion=no concrete blocking discrepancy was observed"
    echo "$END"
    ;;
esac
EOF
chmod +x "$STUB_MARKER"

STUB_VERDICT="$STUB_MARKER"
STUB_EMPTY="$TEST_TMP/eng-empty"
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\nexit 0\n' > "$STUB_EMPTY"
chmod +x "$STUB_EMPTY"
STUB_SHIP="$STUB_MARKER"
STUB_AGY_JSON="$TEST_TMP/agy-json-envelope"
cat > "$STUB_AGY_JSON" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = models ]; then
  exec "$AGY_TEXT_STUB" "$@"
fi
response="$("$AGY_TEXT_STUB" "$@")"
stub_rc=$?
[ "$stub_rc" -eq 0 ] || exit "$stub_rc"
case "${AGY_ENVELOPE_MODE:-valid}" in
  malformed) printf '%s' '{"response":'; exit 0 ;;
  duplicate)
    RESPONSE="$response" node -e '
      const base = JSON.stringify({conversation_id:"fixture",duration_seconds:1,num_turns:1,response:process.env.RESPONSE,status:"SUCCESS",usage:{cache_read_tokens:7,input_tokens:101,output_tokens:23,thinking_tokens:11,total_tokens:142}});
      process.stdout.write(base.replace("\"response\":", "\"response\":\"forged\",\"response\":"));
    '
    exit 0
    ;;
  negative) usage_input=-1 ;;
  trailing) trailing='trailing bytes' ;;
  *) usage_input=101 ;;
esac
[ -n "${AGY_ARGV_FILE:-}" ] && printf '%s\n' "$@" > "$AGY_ARGV_FILE"
# Emulate what real agy leaves in its app dir (bound to scratch by the reviewer),
# so the post-run containment audit has a log + transcript to read.
# AGY_AUDIT_MODE: clean (default) | fallback | toolcall | no-transcript.
agy_app="$HOME/.gemini/antigravity-cli"
agent=""; prev=""; for a in "$@"; do [ "$prev" = --agent ] && agent="$a"; prev="$a"; done
# The sandbox is read-only outside scratch, so the stub cannot hand its argv back:
# it enforces the contract itself. Missing --agent or an agent file without
# `tools: []` exits 3, which turns every positive agy assertion red.
if [ -z "$agent" ] || ! grep -qx 'tools: \[\]' "$agy_app/agents/$agent/agent.md" 2>/dev/null; then
  echo "agy stub: review not run under a tool-less agent (--agent '$agent')" >&2
  exit 3
fi
mkdir -p "$agy_app/log" "$agy_app/brain/conv-1/.system_generated/logs"
{
  echo 'I0924 cli_setting_manager.go:92] CLI settings initialized'
  [ "${AGY_AUDIT_MODE:-clean}" = fallback ] && echo "W0924 session.go:91] Agent \"$agent\" not found, falling back to default"
} > "$agy_app/log/cli-stub.log"
if [ "${AGY_AUDIT_MODE:-clean}" != no-transcript ]; then
  {
    echo '{"step_index":0,"type":"USER_INPUT","content":"prompt"}'
    [ "${AGY_AUDIT_MODE:-clean}" = toolcall ] && echo '{"step_index":1,"type":"PLANNER_RESPONSE","tool_calls":[{"name":"search_web"}]}'
    echo '{"step_index":2,"type":"PLANNER_RESPONSE","content":"answer"}'
  } > "$agy_app/brain/conv-1/.system_generated/logs/transcript.jsonl"
fi
RESPONSE="$response" USAGE_INPUT="${usage_input:-101}" node -e '
  process.stdout.write(JSON.stringify({
    conversation_id: "fixture",
    duration_seconds: 1,
    num_turns: 1,
    response: process.env.RESPONSE,
    status: "SUCCESS",
    usage: {
      cache_read_tokens: 7,
      input_tokens: Number(process.env.USAGE_INPUT),
      output_tokens: 23,
      thinking_tokens: 11,
      total_tokens: 142,
    },
  }));
'
[ -z "${trailing:-}" ] || printf '%s' "$trailing"
[ "${AGY_ENVELOPE_MODE:-valid}" != nonzero_valid ] || exit 77
EOF
chmod +x "$STUB_AGY_JSON"
make_agy_stub_versioned "$STUB_AGY_JSON"
export AGY_TEXT_STUB="$STUB_MARKER"
STUB_QODERCN_MARKER="$TEST_TMP/qoderclicn-marker"
cat > "$STUB_QODERCN_MARKER" <<'EOF'
#!/usr/bin/env bash
[ -z "${QODER_ARGV_FILE:-}" ] || printf '%s\n' "$@" > "$QODER_ARGV_FILE"
PROMPT="$(cat)"
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
[ -n "$begin" ] && [ -n "$end" ] || exit 0
echo "$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: checked=fixture diff and acceptance criteria; evidence=the changed slice was traced against the fixture; conclusion=no concrete blocking discrepancy was observed"
echo "$end"
EOF
chmod +x "$STUB_QODERCN_MARKER"

# A WELL-FORMED verdict block on stdout AND the engine process exits non-zero
# (an engine that answers correctly then crashes on teardown) — no runner
# previously exercised this combination end-to-end. Pins current production
# behaviour: the RC check runs BEFORE the parser on every rail, so a
# non-zero exit is fail-closed to no_verdict regardless of stdout content
# (verdict-bytes go through salvage_unratified_verdict, but status/exit are
# unchanged).
STUB_QODERCN_NONZERO="$TEST_TMP/qoderclicn-nonzero"
cat > "$STUB_QODERCN_NONZERO" <<'EOF'
#!/usr/bin/env bash
PROMPT="$(cat)"
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
[ -n "$begin" ] && [ -n "$end" ] || exit 0
echo "$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: checked=fixture diff and acceptance criteria; evidence=the changed slice was traced against the fixture; conclusion=no concrete blocking discrepancy was observed"
echo "$end"
exit 9
EOF
chmod +x "$STUB_QODERCN_NONZERO"

# OpenCode --format json shape: newline-delimited JSON events, final assistant text in
# the last {"type":"text",...} event's .part.text (probe-verified 2026-09-07, opencode
# 1.18.27 — see scripts/dispatch-review.sh header comment). Mirrors the plain-text
# qoderclicn stub above but wraps the wrapped block inside the real NDJSON envelope so
# the dedicated Node extraction scriptlet in the opencode branch is actually exercised.
STUB_OPENCODE_JSON="$TEST_TMP/opencode-json-marker"
cat > "$STUB_OPENCODE_JSON" <<'EOF'
#!/usr/bin/env bash
[ -z "${OPENCODE_ARGV_FILE:-}" ] || printf '%s\n' "$@" > "$OPENCODE_ARGV_FILE"
PROMPT="$(cat)"
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
[ -n "$begin" ] && [ -n "$end" ] || exit 0
TEXT="$(printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=fixture diff and acceptance criteria; evidence=the changed slice was traced against the fixture; conclusion=no concrete blocking discrepancy was observed\n%s\n' "$begin" "$end")"
echo '{"type":"step_start","timestamp":1,"sessionID":"ses_fixture","part":{"id":"prt_0","messageID":"msg_0","sessionID":"ses_fixture","type":"step-start"}}'
TEXT="$TEXT" node -e 'process.stdout.write(JSON.stringify({type:"text",timestamp:2,sessionID:"ses_fixture",part:{id:"prt_1",messageID:"msg_0",sessionID:"ses_fixture",type:"text",text:process.env.TEXT}})+"\n")'
echo '{"type":"step_finish","timestamp":3,"sessionID":"ses_fixture","part":{"id":"prt_2","reason":"stop","messageID":"msg_0","sessionID":"ses_fixture","type":"step-finish","tokens":{"total":1,"input":1,"output":1,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0}}'
EOF
chmod +x "$STUB_OPENCODE_JSON"

# Same well-formed-block-then-die combination as qoderclicn above, NDJSON-wrapped.
STUB_OPENCODE_NONZERO="$TEST_TMP/opencode-json-nonzero"
cat > "$STUB_OPENCODE_NONZERO" <<'EOF'
#!/usr/bin/env bash
PROMPT="$(cat)"
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
[ -n "$begin" ] && [ -n "$end" ] || exit 0
TEXT="$(printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=fixture diff and acceptance criteria; evidence=the changed slice was traced against the fixture; conclusion=no concrete blocking discrepancy was observed\n%s\n' "$begin" "$end")"
TEXT="$TEXT" node -e 'process.stdout.write(JSON.stringify({type:"text",timestamp:2,sessionID:"ses_fixture",part:{id:"prt_1",messageID:"msg_0",sessionID:"ses_fixture",type:"text",text:process.env.TEXT}})+"\n")'
exit 9
EOF
chmod +x "$STUB_OPENCODE_NONZERO"

STUB_SPAWN_MARKER="$TEST_TMP/spawn-marker-runner"
cat > "$STUB_SPAWN_MARKER" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' spawned > "$SPAWN_MARKER_FILE"
exit 99
EOF
chmod +x "$STUB_SPAWN_MARKER"

# Valid receipt whose D2 partition is foreign to this consumer's frozen claim IDs.
# Recompute both digests so rejection proves exact downstream ID binding rather
# than generic JSON/integrity failure.
FOREIGN_D2_RECEIPT="$TEST_TMP/foreign-d2-receipt.json"
node - "$REPO_ROOT/docs/projects/_archive/2026/08/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json" "$FOREIGN_D2_RECEIPT" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const [source, destination] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const d2 = receipt.consumer_manifest.consumers.find((row) => row.consumer_id === 'D2');
const d3 = receipt.consumer_manifest.consumers.find((row) => row.consumer_id === 'D3');
[d2.required_claim_ids, d3.required_claim_ids] = [d3.required_claim_ids, d2.required_claim_ids];
receipt.consumer_manifest_digest = digest(receipt.consumer_manifest);
receipt.receipt_digest = '';
const body = { ...receipt, receipt_digest: undefined };
receipt.receipt_digest = digest(body);
fs.writeFileSync(destination, `${JSON.stringify(receipt, null, 2)}\n`);
NODE

FAKE_NODE_DIR="$TEST_TMP/fake-node-bin"
mkdir -p "$FAKE_NODE_DIR"
cat > "$FAKE_NODE_DIR/node" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$ANTHROPIC_ARGV_FILE"
prompt_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prompt-file" ]; then
    prompt_file="$2"
    shift 2
  else
    shift
  fi
done
prompt="$(cat "$prompt_file")"
begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
echo "$begin"
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS: fixture finding"
echo "$end"
EOF
chmod +x "$FAKE_NODE_DIR/node"

