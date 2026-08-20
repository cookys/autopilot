#!/usr/bin/env bash
# Tests for the pre-dispatch context-window gate:
#   scripts/check-context-window.js   (estimator + window resolution + verdict)
#   scripts/lib/context-window.sh     (shell policy wrapper)
#   the three dispatch rails' fail-closed wiring
#
# Why this gate exists: 90 days of local codex telemetry (1231 headless dispatch
# sessions) showed 53 sessions (4.3%) hitting a context wall and burning 322.9M
# tokens = 41.0% of the entire corpus; 52 of the 53 were gpt-5.3-codex-spark
# (observed window 121600). The regression this file protects against is an
# oversized payload reaching a small-window engine silently.
. "$(dirname "$0")/lib.sh"

SOURCE_ROOT="$REPO_ROOT"
git clone -q --no-local "$SOURCE_ROOT" "$TEST_TMP/hermetic-repo"
git -C "$SOURCE_ROOT" diff --binary HEAD | git -C "$TEST_TMP/hermetic-repo" apply
REPO_ROOT="$TEST_TMP/hermetic-repo"

GATE="$REPO_ROOT/scripts/check-context-window.js"
LIB="$REPO_ROOT/scripts/lib/context-window.sh"

assert_file_exists "$GATE" "check-context-window.js exists"
assert_file_exists "$LIB" "lib/context-window.sh exists"

TMP="$(mktemp -d -t context-window-test-XXXXXX)"
# The hetero probe below asks dispatch-hetero.sh to create branch
# test/context-window-selftest. On a GATED tree the gate blocks first and nothing is
# created — that is exactly what the probe asserts. But this same file is also run
# against an UNGATED tree during red-green validation, where the dispatch really does
# create a worktree + branch. Reap both unconditionally so the test cannot leave the
# repo dirtier than it found it in either direction.
SELFTEST_BRANCH="test/context-window-selftest"
cleanup_context_window_test() {
  rm -rf "$TMP"
  local wt
  while IFS= read -r wt; do
    [ -n "$wt" ] && git -C "$REPO_ROOT" worktree remove --force "$wt" > /dev/null 2>&1
  done < <(git -C "$REPO_ROOT" worktree list --porcelain 2> /dev/null \
    | awk '/^worktree /{p=$2} /^branch .*'"${SELFTEST_BRANCH##*/}"'$/{print p}')
  git -C "$REPO_ROOT" worktree prune > /dev/null 2>&1
  git -C "$REPO_ROOT" branch -D "$SELFTEST_BRANCH" > /dev/null 2>&1
  return 0
}
trap cleanup_context_window_test EXIT

# Fixtures. 400000 bytes / 3.5 = 114286 est. tokens, which overflows spark's
# 0.7 x 121600 = 85120 threshold but fits grok-4.5's 0.7 x 500000 = 350000.
head -c 400000 /dev/zero | tr '\0' 'x' > "$TMP/big.txt"
head -c 10000 /dev/zero | tr '\0' 'x' > "$TMP/small.txt"

json_field() { printf '%s' "$1" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { process.stdout.write(String(JSON.parse(s)[process.argv[1]])); } catch { process.stdout.write("PARSE_ERROR"); }
});' "$2"; }

# --- estimator: must round UP, never under-estimate ---------------------------
# Under-estimating tokens is the one direction that silently defeats the gate.
OUT="$(node "$GATE" --model gpt-5.5 --bytes 100 --quiet)"
assert_eq "$(json_field "$OUT" estimated_tokens)" "29" "100 bytes / 3.5 rounds UP to 29 (not 28)"

OUT="$(node "$GATE" --model gpt-5.5 --bytes 1 --quiet)"
assert_eq "$(json_field "$OUT" estimated_tokens)" "1" "1 byte estimates to 1 token, never 0"

# --- window resolution: observed default table --------------------------------
OUT="$(node "$GATE" --model gpt-5.3-codex-spark --file "$TMP/small.txt" --quiet)"
assert_eq "$(json_field "$OUT" window)" "121600" "spark window from observed table"
assert_eq "$(json_field "$OUT" window_source)" "observed-default-table" "window_source reported"
assert_eq "$(json_field "$OUT" verdict)" "OK" "small input fits spark"

# --- the measured failure mode: same input, two engines -----------------------
OUT="$(node "$GATE" --model gpt-5.3-codex-spark --file "$TMP/big.txt" --quiet)"
assert_eq "$(json_field "$OUT" verdict)" "OVER_BUDGET" "400KB overflows spark's 121600 window"
assert_eq "$(json_field "$OUT" blocked)" "true" "over budget is blocked, not merely warned"
node "$GATE" --model gpt-5.3-codex-spark --file "$TMP/big.txt" --quiet > /dev/null 2>&1
assert_exit_code 1 $? "OVER_BUDGET exits 1"

OUT="$(node "$GATE" --model grok-4.5 --file "$TMP/big.txt" --quiet)"
assert_eq "$(json_field "$OUT" verdict)" "OK" "same 400KB fits grok-4.5's 500000 window"

# --- unknown window: reported, but NOT undispatchable by default --------------
OUT="$(node "$GATE" --model brand-new-engine --file "$TMP/small.txt" --quiet)"
assert_eq "$(json_field "$OUT" verdict)" "UNKNOWN_WINDOW" "unknown model yields UNKNOWN_WINDOW"
assert_eq "$(json_field "$OUT" blocked)" "false" "unknown window does NOT block by default"
node "$GATE" --model brand-new-engine --file "$TMP/small.txt" --quiet > /dev/null 2>&1
assert_exit_code 0 $? "UNKNOWN_WINDOW exits 0 without --strict"

node "$GATE" --model brand-new-engine --file "$TMP/small.txt" --strict --quiet > /dev/null 2>&1
assert_exit_code 1 $? "--strict turns UNKNOWN_WINDOW into a block"

# --- reason strings carry no double quotes ------------------------------------
# They are interpolated into shell-assembled JSON by the rails; an unescaped quote
# produced INVALID JSON that a parsing caller misreads as a transport failure.
OUT="$(node "$GATE" --model gpt-5.3-codex-spark --file "$TMP/big.txt" --quiet)"
REASON="$(json_field "$OUT" reason)"
assert_not_contains "$REASON" '"' "OVER_BUDGET reason contains no double quotes"
OUT="$(node "$GATE" --model brand-new-engine --file "$TMP/small.txt" --quiet)"
assert_not_contains "$(json_field "$OUT" reason)" '"' "UNKNOWN_WINDOW reason contains no double quotes"

# --- model normalization: effort suffix is not part of model identity ---------
OUT="$(node "$GATE" --model 'GPT-5.5 (High)' --file "$TMP/small.txt" --quiet)"
assert_eq "$(json_field "$OUT" window)" "258400" "effort suffix stripped before table lookup"
assert_eq "$(json_field "$OUT" model_normalized)" "gpt-5.5" "normalized model reported"

# --- capability-state precedence ----------------------------------------------
STORE="$TMP/capability.jsonl"
cat > "$STORE" <<'EOF'
{"schema_version":1,"observed_at":"2026-07-25T10:00:00Z","runner":"codex","model":"seat-engine","role":"implementer","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0},"context_window":{"total_tokens":40000}},"event_id":1}
EOF
OUT="$(node "$GATE" --model seat-engine --file "$TMP/small.txt" --capability-state "$STORE" --quiet)"
assert_eq "$(json_field "$OUT" window)" "40000" "window resolved from capability state"
assert_eq "$(json_field "$OUT" window_source)" "capability-state" "capability-state reported as source"

OUT="$(node "$GATE" --model seat-engine --file "$TMP/small.txt" --capability-state "$STORE" --window 999000 --quiet)"
assert_eq "$(json_field "$OUT" window_source)" "explicit" "--window outranks capability state"

# A null observation must never clobber a valid one.
cat >> "$STORE" <<'EOF'
{"schema_version":1,"observed_at":"2026-07-25T11:00:00Z","runner":"codex","model":"seat-engine","role":"reviewer","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0},"context_window":{"total_tokens":null}},"event_id":2}
EOF
OUT="$(node "$GATE" --model seat-engine --file "$TMP/small.txt" --capability-state "$STORE" --quiet)"
assert_eq "$(json_field "$OUT" window)" "40000" "null total_tokens does not clobber a valid window"

# --- missing input file is a usage error, never a silent zero -----------------
node "$GATE" --model gpt-5.5 --file "$TMP/does-not-exist" --quiet > /dev/null 2>&1
assert_exit_code 2 $? "unreadable --file is a usage error (silent zero would under-estimate)"

# --- capability dimension round-trips through engine-capability-state.js ------
CAP="$REPO_ROOT/scripts/engine-capability-state.js"
CAPSTORE="$TMP/capstore"
mkdir -p "$CAPSTORE"
cat > "$TMP/ev.json" <<'EOF'
{"schema_version":1,"observed_at":"2026-07-25T10:00:00Z","runner":"codex","model":"roundtrip-engine","role":"implementer","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0},"context_window":{"total_tokens":77000,"evidence":"unit test"}}}
EOF
node "$CAP" record --file "$TMP/ev.json" --store "$CAPSTORE" > /dev/null 2>&1
assert_exit_code 0 $? "context_window event is accepted by the capability store"
CUR="$(node "$CAP" current --runner codex --model roundtrip-engine --role implementer --store "$CAPSTORE" 2>/dev/null)"
assert_eq "$(printf '%s' "$CUR" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).capability.context_window.total_tokens))}catch{process.stdout.write("ERR")}})')" \
  "77000" "merged current view returns the recorded window"

cat > "$TMP/bad.json" <<'EOF'
{"schema_version":1,"observed_at":"2026-07-25T10:00:00Z","runner":"codex","model":"bad","role":"implementer","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0},"context_window":{"total_tokens":-5}}}
EOF
node "$CAP" record --file "$TMP/bad.json" --store "$CAPSTORE" > /dev/null 2>&1
assert_exit_code 1 $? "negative total_tokens is rejected"

# --- shell wrapper: mode resolution -------------------------------------------
# shellcheck disable=SC1090
. "$LIB" 2>/dev/null || fail "lib/context-window.sh not sourceable"
assert_eq "$(context_window_mode off)" "off" "explicit off honored"
assert_eq "$(context_window_mode warn)" "warn" "explicit warn honored"
assert_eq "$(context_window_mode '')" "block" "empty mode defaults to block"
assert_eq "$(context_window_mode garbage)" "block" "garbage mode fails closed to block"
assert_eq "$(AUTOPILOT_CONTEXT_WINDOW_GATE=warn context_window_mode '')" "warn" "env supplies the mode when arg is empty"

# REGRESSION: the rails run under `set -u`. An unguarded $HOME expansion aborted the
# ENTIRE rail when HOME was unset (systemd scope / container / cron), turning a
# fail-open cost gate into a hard dispatch outage.
NOHOME_RC=0
env -u HOME bash -c "set -uo pipefail; . '$LIB'; context_window_gate block '$REPO_ROOT/scripts' 'gpt-5.5'" > /dev/null 2>&1 || NOHOME_RC=$?
assert_eq "0" "$NOHOME_RC" "gate survives an unset HOME under set -u (fail-open, not abort)"
NOHOME_BLOCK_RC=0
env -u HOME bash -c "set -uo pipefail; . '$LIB'; context_window_gate block '$REPO_ROOT/scripts' 'gpt-5.3-codex-spark' '$TMP/big.txt'" > /dev/null 2>&1 || NOHOME_BLOCK_RC=$?
assert_eq "1" "$NOHOME_BLOCK_RC" "gate still blocks over-budget with HOME unset"

# --- dispatch rails: fail closed WITHOUT spawning the runner ------------------
# The strongest assertion available here: a marker file the fake runner would
# create if it ever ran. Status comes from artifacts, never from self-report.
FAKE="$TMP/fake-runner"
cat > "$FAKE" <<'EOF'
#!/usr/bin/env bash
touch "$RUNNER_MARKER"
echo "fake runner ran"
EOF
chmod +x "$FAKE"

export RUNNER_MARKER="$TMP/spawned"

for rail in review author; do
  rm -f "$RUNNER_MARKER"
  if [ "$rail" = "review" ]; then
    RAIL_OUT="$(timeout 90 bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex \
      --model gpt-5.3-codex-spark --diff-file "$TMP/big.txt" --bin "$FAKE" 2> /dev/null | tail -1)"
  else
    RAIL_OUT="$(timeout 90 bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner codex \
      --model gpt-5.3-codex-spark --prompt-file "$TMP/big.txt" --bin "$FAKE" 2> /dev/null | tail -1)"
  fi
  assert_file_absent "$RUNNER_MARKER" "dispatch-$rail: over-budget never spawns the runner"
  assert_eq "$(json_field "$RAIL_OUT" status)" "precondition_failed" \
    "dispatch-$rail: over-budget yields precondition_failed"
  # The emitted JSON must PARSE. A model id inside a reason string used to inject
  # an unescaped quote and produce invalid JSON.
  assert_neq "$(json_field "$RAIL_OUT" status)" "PARSE_ERROR" \
    "dispatch-$rail: precondition JSON is parseable"
done

# Escape hatch is real: mode=off reaches the runner with the same oversized input.
rm -f "$RUNNER_MARKER"
timeout 90 bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex \
  --model gpt-5.3-codex-spark --diff-file "$TMP/big.txt" --bin "$FAKE" \
  --context-window off > /dev/null 2>&1
assert_file_exists "$RUNNER_MARKER" "--context-window off still dispatches (escape hatch works)"

# In-budget input must NOT be blocked (no false positives).
rm -f "$RUNNER_MARKER"
timeout 90 bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner codex \
  --model gpt-5.3-codex-spark --prompt-file "$TMP/small.txt" --bin "$FAKE" > /dev/null 2>&1
assert_file_exists "$RUNNER_MARKER" "in-budget input dispatches normally"

# --- REGRESSION: the gate must not corrupt the machine-parsable result channel -
# The rails' callers do OUT="$(dispatch-... 2>&1)" and then JSON-parse OUT. The first
# cut of this gate printed a WARNING to stderr on UNKNOWN_WINDOW — which is the NORMAL
# state for most models — and broke JSON parsing for 5 dispatch-author test files.
# An unknown model here is the exact trigger.
rm -f "$RUNNER_MARKER"
NOISE_OUT="$(DISPATCH_QUIET=1 timeout 90 bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner codex \
  --model definitely-unknown-engine --prompt-file "$TMP/small.txt" --bin "$FAKE" 2>&1 | tail -1)"
assert_neq "$(json_field "$NOISE_OUT" status)" "PARSE_ERROR" \
  "unknown-window dispatch still emits parseable JSON on the 2>&1 channel"
assert_not_contains "$NOISE_OUT" "WARNING:" \
  "gate prints no stderr chrome under DISPATCH_QUIET (would corrupt 2>&1 JSON parsing)"

# --- hetero rail: blocked BEFORE the worktree is created ----------------------
WT_BEFORE="$(git -C "$REPO_ROOT" worktree list | wc -l)"
timeout 90 bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner codex \
  --model gpt-5.3-codex-spark --branch test/context-window-selftest \
  --prompt-file "$TMP/big.txt" > /dev/null 2>&1
WT_AFTER="$(git -C "$REPO_ROOT" worktree list | wc -l)"
assert_eq "$WT_AFTER" "$WT_BEFORE" "dispatch-hetero: over-budget creates no worktree"
assert_eq "$(git -C "$REPO_ROOT" branch --list 'test/context-window-selftest' | wc -l | tr -d ' ')" "0" \
  "dispatch-hetero: over-budget leaks no branch"

# --- resolver: reports over-budget seats without inventing fields -------------
RESOLVED="$(bash "$REPO_ROOT/scripts/resolve-review-loop.sh" --input-bytes 2000000 2> /dev/null)"
FIELD_COUNT="$(printf '%s' "$RESOLVED" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(Object.keys(JSON.parse(s)).length))}catch{process.stdout.write("ERR")}})')"
# The no-invented-fields pin derives from the schema's own top-level key order —
# a literal count here rotted twice as fields landed (62 vs 64, pre-existing red
# caught by the v2.34.15 review). The schema suite pins order/content; this case
# pins only "the resolver emits exactly the schema's surface, nothing invented".
SCHEMA_FIELD_COUNT="$(node -e 'process.stdout.write(String((require(process.argv[1])["x-field-order"]||[]).length))' "$REPO_ROOT/schemas/review-loop-contract.schema.json")"
assert_eq "$FIELD_COUNT" "$SCHEMA_FIELD_COUNT" "resolver emits exactly the schema x-field-order surface while window checks reuse capability_warnings"
assert_contains "$RESOLVED" "cannot hold the intended input" "resolver reports an over-budget seat"

# A model id containing spaces must not be split into phantom seats.
assert_not_contains "$RESOLVED" '"3.5 seat' "space-containing model id is not word-split into phantom seats"
assert_not_contains "$RESOLVED" '"Flash seat' "space-containing model id is not word-split into phantom seats (2)"

# Small input produces no window warnings at all (UNKNOWN_WINDOW must stay silent,
# else the default roster emits constant noise). The repo's own config pins a
# brain seat (2026-08-17) whose advisory is out of scope here — measure the
# window-warning surface against an ambient-minus-brain fixture.
CW_NO_BRAIN="$TEST_TMP/ambient-config-no-brain.md"
grep -v 'brain_seat_identity_file' "$REPO_ROOT/.claude/review-loop-config.md" > "$CW_NO_BRAIN" 2>/dev/null || : > "$CW_NO_BRAIN"
RESOLVED_SMALL="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CW_NO_BRAIN" bash "$REPO_ROOT/scripts/resolve-review-loop.sh" --input-bytes 10000 2> /dev/null)"
assert_contains "$RESOLVED_SMALL" '"capability_warnings": []' "in-budget resolve emits no warnings"

# Absent --input-bytes must leave the resolver byte-identical to before.
RESOLVED_NONE="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CW_NO_BRAIN" bash "$REPO_ROOT/scripts/resolve-review-loop.sh" 2> /dev/null)"
assert_contains "$RESOLVED_NONE" '"capability_warnings": []' "no --input-bytes ⇒ no window checks"

finalize_test
