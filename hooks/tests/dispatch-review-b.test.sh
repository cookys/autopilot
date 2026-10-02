#!/usr/bin/env bash
# dispatch-review.sh test, shard b (split from dispatch-review.test.sh for wall time).
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"

# 5. agy native JSON path: response feeds the existing framing parser while usage
# comes only from the closed harness envelope.
if command -v bwrap >/dev/null 2>&1; then
  printf '%s\n' protected > "$TEST_TMP/agy-protected"
  OUT="$(AGY_CONTAINMENT_PROBE="$TEST_TMP/agy-protected" STUB_MODE=ship AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
  assert_eq "0" "$EXIT" "agy reviewed exit 0 (native JSON capture)"
  assert_contains "$OUT" '"runner": "agy"' "agy runner provenance"
  assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "agy verdict parsed from the extracted response"
  assert_contains "$OUT" '"usage": {"total_tokens":142,"input_tokens":101,"output_tokens":23,"cache_read_tokens":7,"source":"agy-json"}' \
    "agy review exposes normalized harness-native usage"
  assert_eq "protected" "$(cat "$TEST_TMP/agy-protected")" "agy reviewer cannot mutate a path outside scratch"

  OUT="$(STUB_MODE=ship AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
  assert_eq "0" "$EXIT" "agy reviewer generic alias exits 0"
  assert_contains "$OUT" '"model": "gemini-3.6-flash-high"' "agy reviewer generic alias resolves before spend"
  assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "agy reviewer alias path preserves the verdict"

  # Tool containment (2026-09-24, agy 1.2.9): the review runs under the tool-less
  # agent, and agy's own log + transcript — not its exit code — decide. Every breach
  # shape below exits 0 in real agy with a plausible answer.
  # (Positive side: the stub exits 3 unless it runs under the tool-less agent, so every
  # green agy assertion above already proves --agent + the sandboxed agent file.)
  for AGY_MODE_CASE in fallback:'fell back to its default' toolcall:'called tool(s) [search_web]' no-transcript:'no agy transcript'; do
    AGY_MODE="${AGY_MODE_CASE%%:*}"; AGY_WANT="${AGY_MODE_CASE#*:}"
    OUT="$(AGY_AUDIT_MODE="$AGY_MODE" STUB_MODE=ship AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
    assert_eq "1" "$EXIT" "agy $AGY_MODE: review fails closed"
    assert_contains "$OUT" '"status": "no_verdict"' "agy $AGY_MODE: no_verdict"
    assert_contains "$OUT" "$AGY_WANT" "agy $AGY_MODE: reason names the breach"
    assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "agy $AGY_MODE: the answer is not accepted"
  done

  # agy argv-payload ceiling (v2.35.7): agy has no --prompt-file, so an oversized review prompt
  # is rejected by execve BEFORE agy runs — a bare 126/127 with no vendor text, indistinguishable
  # from a stalled seat. The rail must refuse first, by name, as no_verdict (the review was fully
  # set up, and no_verdict already means "do not ship" to every caller).
  BIG_DIFF="$TEST_TMP/big.diff"
  node -e 'process.stdout.write("+y".repeat(100000))' > "$BIG_DIFF"
  OUT="$(STUB_MODE=ship AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-3.6-flash-high --diff-file "$BIG_DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
  assert_eq "1" "$EXIT" "oversized agy review payload fails closed"
  assert_contains "$OUT" '"status": "no_verdict"' "oversized agy payload emits no_verdict, not a stall"
  assert_contains "$OUT" 'single-argv ceiling' "the no_verdict reason names the argv ceiling"
  assert_contains "$OUT" 'has no --prompt-file' "the reason says why it cannot be streamed"
  assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "an unexecable payload can never authorize shipping"

  for ENVELOPE_MODE in malformed duplicate negative trailing; do
    OUT="$(AGY_ENVELOPE_MODE="$ENVELOPE_MODE" STUB_MODE=ship AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
    assert_eq "1" "$EXIT" "agy $ENVELOPE_MODE envelope fails closed"
    assert_contains "$OUT" '"status": "no_verdict"' "agy $ENVELOPE_MODE envelope emits no_verdict"
    assert_contains "$OUT" '"usage": null' "agy $ENVELOPE_MODE envelope cannot expose usage"
    assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "agy $ENVELOPE_MODE envelope cannot authorize shipping"
  done
  OUT="$(AGY_ENVELOPE_MODE=nonzero_valid STUB_MODE=ship AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" --bin "$STUB_AGY_JSON" 2>&1)"; EXIT=$?
  assert_eq "1" "$EXIT" "agy nonzero after valid-looking envelope fails closed"
  assert_contains "$OUT" '"usage": null' "agy nonzero after valid-looking envelope discards usage"
  assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "agy nonzero after valid-looking response is never parsed"

  mkdir -p "$TEST_TMP/fail-bwrap"
  printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$*" > "$BWRAP_ARGS_FILE"' 'exit 77' > "$TEST_TMP/fail-bwrap/bwrap"
  chmod +x "$TEST_TMP/fail-bwrap/bwrap"
  BWRAP_ARGS_FILE="$TEST_TMP/bwrap.args" PATH="$TEST_TMP/fail-bwrap:$PATH" STUB_MODE=ship "$SCRIPT" --runner agy \
    --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" --bin "$STUB_AGY_JSON" \
    >"$TEST_TMP/agy-bwrap-fail.out" 2>&1
  EXIT=$?
  assert_eq "1" "$EXIT" "agy reviewer transport fails closed when sandbox execution fails"
  assert_contains "$(cat "$TEST_TMP/bwrap.args")" "--proc /proc" \
    "agy reviewer mounts a fresh proc for its private PID namespace"
else
  echo "  (skip agy native JSON case: 'bwrap' not available)"
fi

# 5b. qoderclicn path: prompt via STDIN, scratch cwd, text output parsed.
OUT="$("$SCRIPT" --runner qoderclicn --model Qwen3.8-Max-Preview --diff-file "$DIFF" --bin "$STUB_QODERCN_MARKER" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "qoderclicn reviewed exit 0"
assert_contains "$OUT" '"runner": "qoderclicn"' "qoderclicn runner provenance"
assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "qoderclicn verdict parsed"
OUT="$("$SCRIPT" --runner qoderclicn --model Qwen3.8-Max-Preview --diff-file "$DIFF" --bin "$STUB_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "qoderclicn empty clean exit is no_verdict"
assert_contains "$OUT" '"status": "no_verdict"' "qoderclicn empty clean output fails closed"
OUT="$(STUB_MODE=ship_no_end "$SCRIPT" --runner qoderclicn --model Qwen3.8-Max-Preview --diff-file "$DIFF" --bin "$STUB_VERDICT" --max-tokens 5 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "qoderclicn capped partial wrapped block is no_verdict"
assert_contains "$OUT" '"status": "no_verdict"' "qoderclicn capped partial SHIP never passes"
assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "qoderclicn partial SHIP is not accepted"

# A well-formed, complete, correctly-framed SHIP-AS-IS block on stdout, then
# the qoder process exits non-zero (rc=9) — engine answered correctly then
# crashed on teardown. Pinning current production behaviour: fail-closed to
# no_verdict, the well-formed block is NOT accepted despite being intact.
OUT="$("$SCRIPT" --runner qoderclicn --model Qwen3.8-Max-Preview --diff-file "$DIFF" --bin "$STUB_QODERCN_NONZERO" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "qoderclicn well-formed block + nonzero exit: exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "qoderclicn well-formed block + nonzero exit → no_verdict"
assert_contains "$OUT" "qoder exited non-zero (rc=9)" "qoderclicn well-formed block + nonzero exit names the exit code"
assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "qoderclicn well-formed block + nonzero exit never authorizes shipping"

# 5b'. opencode path: prompt via STDIN, scratch cwd, --format json NDJSON parsed (the
# dedicated Node scriptlet extracts the last {"type":"text"} event's .part.text before
# the shared plain-text VERDICT parser runs — see scripts/dispatch-review.sh header).
OPENCODE_ARGV_FILE="$TEST_TMP/opencode.argv"; export OPENCODE_ARGV_FILE
rm -f "$OPENCODE_ARGV_FILE"
OUT="$("$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor --diff-file "$DIFF" --bin "$STUB_OPENCODE_JSON" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode reviewed exit 0"
assert_contains "$OUT" '"runner": "opencode"' "opencode runner provenance"
assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "opencode verdict parsed out of the NDJSON text event"
assert_contains "$(paste -sd ' ' "$OPENCODE_ARGV_FILE")" 'run --dir' "opencode receives run --dir"
assert_contains "$(paste -sd ' ' "$OPENCODE_ARGV_FILE")" '--agent plan' "opencode reviewer runs under the read-only plan agent"
assert_contains "$(paste -sd ' ' "$OPENCODE_ARGV_FILE")" '--format json' "opencode requests JSON event output"
assert_not_contains "$(paste -sd ' ' "$OPENCODE_ARGV_FILE")" '--variant max' "opencode default effort is not the raw 'max' token"

# opencode: empty capture (binary present, no output at all) fails closed, same as
# every other rail — format-agnostic, the shared STUB_EMPTY covers this.
OUT="$("$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor --diff-file "$DIFF" --bin "$STUB_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "opencode empty capture exit is no_verdict"
assert_contains "$OUT" '"status": "no_verdict"' "opencode empty capture fails closed"

# opencode: rejection when the binary is missing — both the "--bin does not resolve"
# and "--bin points at a non-executable path" preconditions, mirroring the kimi rail.
OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$TEST_TMP/no-such-opencode-binary" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "opencode missing --bin path is a precondition"
assert_contains "$OUT" '"status": "precondition_failed"' "opencode missing binary fails closed before spawn"
assert_contains "$OUT" 'not executable' "opencode missing binary names the failure"

# opencode: a well-formed SHIP-AS-IS block lands on stdout (wrapped in NDJSON) and THEN
# the process exits non-zero (rc=9) — engine answered correctly then crashed on
# teardown. Same fail-closed contract as qoderclicn/kimi above: the well-formed block
# is NOT accepted despite being intact.
OUT="$("$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor --diff-file "$DIFF" --bin "$STUB_OPENCODE_NONZERO" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "opencode well-formed block + nonzero exit: exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "opencode well-formed block + nonzero exit → no_verdict"
assert_contains "$OUT" "opencode exited non-zero (rc=9)" "opencode well-formed block + nonzero exit names the exit code"
assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "opencode well-formed block + nonzero exit never authorizes shipping"

# opencode: effort clamp — autopilot's 'max' maps to opencode's '--variant xhigh'
# (same clamp as the dispatch-hetero.sh implementer rail; opencode has no 'max' tier).
rm -f "$OPENCODE_ARGV_FILE"
OUT="$("$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor --diff-file "$DIFF" --bin "$STUB_OPENCODE_JSON" --effort max 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode --effort max reviewed exit 0"
assert_contains "$(paste -sd ' ' "$OPENCODE_ARGV_FILE")" '--variant xhigh' "opencode clamps 'max' effort to '--variant xhigh'"

# opencode: scratch cwd is created (--dir), used, and reaped — never the repo (the
# shared spawn-marker stub only proves it was invoked; the cwd's own removal is
# structural in the branch, same as kimi/qoderclicn's "CWD=... ; CWD=\"\"" pattern above).
unset OPENCODE_ARGV_FILE

# 5c. Blind review: none-tier still requires no-tools containment (preservation).
# RED at base ceb7c81d: grok under blind → "blind review requires an enforceable no-tools runner profile (got: grok)"
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 "$SCRIPT" --runner grok --model fixture --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "blind grok review requires a no-tools profile (preservation)"
assert_contains "$OUT" 'enforceable no-tools runner profile (got: grok)' "blind grok precondition message unchanged"

# RED at base ceb7c81d: blind codex without packet → same no-tools message (got: codex)
OUT="$(AUTOPILOT_BLIND_DISCOVERY=1 "$SCRIPT" --runner codex --model fixture --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "blind codex without packet is a precondition failure"
assert_contains "$OUT" 'cleanroom seat requires a review packet' "blind codex without packet names the packet gate"
assert_not_contains "$OUT" 'enforceable no-tools runner profile' "blind codex is cleanroom-tier, not none-tier"

# RED at base 9b049c00: bash gate already agrees with the Node predicate for the
#   --runner vocabulary (preservation, green at base for the gate; Node side is new).
# Parity (codex r1 MUST-FIX: a capable runner must PROVE it reached the runner binary,
# not merely miss the gate text). The stub exits 99 — a signature no dispatch-review
# precondition produces — so `rc=99` in the envelope error is the "stub invoked" marker.
# Per-runner minimal setup: cc-shim/anthropic-compatible need an --endpoint fixture,
# anthropic-compatible's transport is `node` (a fake node on PATH exits 99).
PARITY_STUB="$TEST_TMP/blind-parity-stub"
printf '#!/usr/bin/env bash\nexit 99\n' > "$PARITY_STUB"
chmod +x "$PARITY_STUB"
PARITY_FAKE_NODE="$TEST_TMP/blind-parity-fake-node"
mkdir -p "$PARITY_FAKE_NODE"
printf '#!/usr/bin/env bash\nexit 99\n' > "$PARITY_FAKE_NODE/node"
chmod +x "$PARITY_FAKE_NODE/node"
export AUTOPILOT_ENDPOINT_PARITYEP_URL="http://127.0.0.1:9/v1"
export AUTOPILOT_ENDPOINT_PARITYEP_TOKEN="t"
PARITY_CAPABLE="$(node -e '
const { REVIEW_SEAT_TIERS } = require(process.argv[1]);
process.stdout.write(REVIEW_SEAT_TIERS.packet.join(" "));
' "$REPO_ROOT/src/engine/final-panel-qualification.js")"
SCHEMA_RUNNERS="$(node -e '
const schema = require(process.argv[1]);
process.stdout.write(schema.properties.reviewer_runner.enum.filter((r) => r !== "auto").join(" "));
' "$REPO_ROOT/schemas/review-loop-contract.schema.json")"
for PARITY_RUNNER in $SCHEMA_RUNNERS; do
  PARITY_EXTRA=()
  PARITY_PATH="$PATH"
  case "$PARITY_RUNNER" in
    cc-shim) PARITY_EXTRA=(--endpoint PARITYEP) ;;
    anthropic-compatible) PARITY_EXTRA=(--endpoint PARITYEP --context-window off); PARITY_PATH="$PARITY_FAKE_NODE:$PATH" ;;
  esac
  PARITY_OUT="$(PATH="$PARITY_PATH" AUTOPILOT_BLIND_DISCOVERY=1 DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 \
    "$SCRIPT" --runner "$PARITY_RUNNER" --model fixture --diff-file "$DIFF" --bin "$PARITY_STUB" "${PARITY_EXTRA[@]}" 2>&1)"; PARITY_EXIT=$?
  JS_TIER="$(node -e '
const { reviewSeatTier } = require(process.argv[1]);
process.stdout.write(reviewSeatTier(process.argv[2]));
' "$REPO_ROOT/src/engine/final-panel-qualification.js" "$PARITY_RUNNER")"
  SHELL_TIER="$(bash -c '
eval "$(sed -n "/^review_seat_tier()/,/^}/p" "$1")"
review_seat_tier "$2"
' bash "$REPO_ROOT/scripts/dispatch-review.sh" "$PARITY_RUNNER")"
  assert_eq "$JS_TIER" "$SHELL_TIER" "$PARITY_RUNNER: JS reviewSeatTier equals shell review_seat_tier"
  PARITY_NODE_CAPABLE="$(node -e '
const { isBlindDiscoveryCapableRunner } = require(process.argv[1]);
process.stdout.write(String(isBlindDiscoveryCapableRunner(process.argv[2])));
' "$REPO_ROOT/src/engine/final-panel-qualification.js" "$PARITY_RUNNER")"
  case " $PARITY_CAPABLE " in
    *" $PARITY_RUNNER "*) PARITY_LIST_CAPABLE=true ;;
    *) PARITY_LIST_CAPABLE=false ;;
  esac
  if [ "$JS_TIER" = "packet" ]; then
    assert_eq "true" "$PARITY_NODE_CAPABLE" "$PARITY_RUNNER: packet alias is capable"
    assert_eq "true" "$PARITY_LIST_CAPABLE" "$PARITY_RUNNER: packet is in REVIEW_SEAT_TIERS.packet"
    assert_contains "$PARITY_OUT" "rc=99" "$PARITY_RUNNER: packet-tier runner reached the stub binary (rc=99 signature)"
    assert_not_contains "$PARITY_OUT" "enforceable no-tools runner profile" "$PARITY_RUNNER: packet runner is not gated"
  elif [ "$JS_TIER" = "cleanroom" ]; then
    assert_eq "true" "$PARITY_NODE_CAPABLE" "$PARITY_RUNNER: cleanroom alias is capable (tier !== none)"
    assert_not_contains "$PARITY_OUT" "rc=99" "$PARITY_RUNNER: cleanroom never reaches the --bin stub without a packet"
    assert_contains "$PARITY_OUT" "cleanroom seat requires a review packet" "$PARITY_RUNNER: cleanroom names the packet gate"
  else
    assert_eq "false" "$PARITY_NODE_CAPABLE" "$PARITY_RUNNER: none-tier is not capable"
    assert_eq "false" "$PARITY_LIST_CAPABLE" "$PARITY_RUNNER: none-tier is not in the packet list"
    assert_eq "2" "$PARITY_EXIT" "$PARITY_RUNNER: incompatible runner is a precondition failure (exit 2)"
    assert_contains "$PARITY_OUT" "enforceable no-tools runner profile" "$PARITY_RUNNER: incompatible runner hits the no-tools gate"
    assert_not_contains "$PARITY_OUT" "rc=99" "$PARITY_RUNNER: incompatible runner never reaches the stub"
  fi
done

# Resolver mirror agrees for every contract enum member (minus auto).
RESOLVER_SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
EMPTY_SCDIR="$TEST_TMP/parity-empty-scorecard"
mkdir -p "$EMPTY_SCDIR"
for PARITY_RUNNER in $SCHEMA_RUNNERS; do
  RES_CFG="$TEST_TMP/parity-qc-${PARITY_RUNNER}.md"
  printf -- '- qc_panel: fixture-model\n- qc_panel_runners: %s\n- qc_panel_efforts: high\n- qc_panel_endpoints: @none\n' "$PARITY_RUNNER" > "$RES_CFG"
  RES_OVR="$TEST_TMP/parity-qc-${PARITY_RUNNER}-ovr.json"
  printf '{"schema":1,"overrides":[{"engine":"fixture-model","runner":"%s","role":"qc_panel","reason":"parity fixture admission","operator":"test","expires":"2099-12-31"}]}\n' "$PARITY_RUNNER" > "$RES_OVR"
  RES_STDOUT="$TEST_TMP/parity-res-${PARITY_RUNNER}.out"
  RES_STDERR="$TEST_TMP/parity-res-${PARITY_RUNNER}.err"
  ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" AUTOPILOT_QUALIFICATION_OVERRIDE="$RES_OVR" \
    REVIEW_LOOP_CONFIG_OVERRIDE="$RES_CFG" \
    bash "$RESOLVER_SCRIPT" --check-scorecard >"$RES_STDOUT" 2>"$RES_STDERR"
  RES_ERR_TEXT="$(cat "$RES_STDERR")"
  JS_TIER="$(node -e '
const { reviewSeatTier } = require(process.argv[1]);
process.stdout.write(reviewSeatTier(process.argv[2]));
' "$REPO_ROOT/src/engine/final-panel-qualification.js" "$PARITY_RUNNER")"
  RES_WARN="$(node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8").trim();
const v = raw ? JSON.parse(raw) : {};
process.stdout.write(JSON.stringify(v.capability_warnings || []));
' "$RES_STDOUT")"
  case "$JS_TIER" in
    cleanroom)
      assert_contains "$RES_WARN" "is a cleanroom-tier seat" "$PARITY_RUNNER: resolver advisory for cleanroom"
      assert_not_contains "$RES_ERR_TEXT" "resolve-review-loop: ⚠ qc_panel[0] seat (fixture-model/${PARITY_RUNNER}) cannot execute" \
        "$PARITY_RUNNER: resolver has no refusal ⚠ for cleanroom"
      ;;
    none)
      assert_contains "$RES_ERR_TEXT" "resolve-review-loop: ⚠ qc_panel[0] seat (fixture-model/${PARITY_RUNNER}) cannot execute a managed blind-discovery review" \
        "$PARITY_RUNNER: resolver stderr ⚠ for none"
      assert_contains "$RES_WARN" "cannot execute a managed blind-discovery review" "$PARITY_RUNNER: resolver refusal for none"
      ;;
    packet)
      assert_not_contains "$RES_WARN" "cannot execute a managed blind-discovery review" "$PARITY_RUNNER: packet has no refusal"
      assert_not_contains "$RES_WARN" "is a cleanroom-tier seat" "$PARITY_RUNNER: packet has no cleanroom advisory"
      assert_not_contains "$RES_ERR_TEXT" "cannot execute a managed blind-discovery review" "$PARITY_RUNNER: packet stderr has no refusal"
      ;;
  esac
done


finalize_test
