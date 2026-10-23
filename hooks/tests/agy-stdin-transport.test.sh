#!/usr/bin/env bash
# agy-stdin-transport.test.sh — every agy prompt rail sends the prompt as ONE stream-json NDJSON line
# on stdin (lib/agy-stream-json.js), so there is no argv-size ceiling. Stub agy only (no real agy):
# hooks/tests/lib/agy-stdin-adapter.js enforces the wire contract (`--print=` with the `=`,
# {"event":"user","message":{"content":...}}) and records the prompt byte-exact.
#   1. a >131071-byte prompt reaches the stub intact (byte count + sha256) through dispatch-author,
#      dispatch-review, dispatch-hetero and hetero-review-loop
#   2. result.status ERROR -> the rail's existing typed failure, error text surfaced
#   3. no `result` event -> the same typed failure
#   4. negative controls: a stub fed a bare `--print`, or a `message.text` line, fails
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AGY_STUB_MODELS="$(printf 'gemini-3.7-flash-high\tGemini 3.7 Flash (High)\ngemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)\ngemini-3.7-flash-low\tGemini 3.7 Flash (Low)')"

pass() { __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); echo "PASS [agy-stdin-transport] $1"; }
ADAPTER="$REPO_ROOT/hooks/tests/lib/agy-stdin-adapter.js"
HELPER="$REPO_ROOT/scripts/lib/agy-stream-json.js"
LIMIT=131071

# Trivial legacy stub: prints a fixed answer (the adapter handles the transport).
STUB="$TEST_TMP/agy-stub"
printf '#!/usr/bin/env bash\necho "stub ok"\n' > "$STUB"; chmod +x "$STUB"
make_agy_stub_versioned "$STUB"

# --- helper-level: negative controls through the REAL adapter -----------------
LINE_OK='{"event":"user","message":{"content":"hi"}}'
OUT="$(printf '%s\n' "$LINE_OK" | node "$ADAPTER" "$STUB" --input-format stream-json --output-format stream-json --print= 2>&1)"; RC=$?
assert_eq "0" "$RC" "adapter accepts the canonical invocation"
assert_contains "$OUT" '"event":"result"' "adapter emits a result event"
OUT="$(printf '%s\n' "$LINE_OK" | node "$ADAPTER" "$STUB" --input-format stream-json --output-format stream-json --print 2>&1)"; RC=$?
assert_eq "2" "$RC" "NEGATIVE CONTROL: a bare --print (no =) fails the stub"
OUT="$(printf '%s\n' '{"event":"user","message":{"text":"hi"}}' | node "$ADAPTER" "$STUB" --input-format stream-json --output-format stream-json --print= 2>&1)"; RC=$?
assert_eq "2" "$RC" "NEGATIVE CONTROL: message.text (not message.content) fails the stub"
OUT="$(printf '%s\n' "$LINE_OK" | node "$ADAPTER" "$STUB" -p hi --input-format stream-json --output-format stream-json --print= 2>&1)"; RC=$?
assert_eq "2" "$RC" "NEGATIVE CONTROL: -p on argv fails the stub"

# the helper itself: ERROR / no-result map to exit 1 with the reason on stderr
PF="$TEST_TMP/p.txt"; printf 'x' > "$PF"
OUT="$(AGY_STUB_RESULT=error AGY_STUB_ERROR_TEXT=boom-xyz node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "helper: ERROR result exits 1"; assert_contains "$OUT" "boom-xyz" "helper: ERROR text surfaced"
OUT="$(AGY_STUB_RESULT=none node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "helper: no result event exits 1"; assert_contains "$OUT" "no result event" "helper: no-result reason surfaced"

# Text a rail kept: its stdout plus every existing file whose absolute path it printed.
rail_text() { # name
  local f="$R/$1.out" p
  cat "$f" 2>/dev/null
  grep -aoE '/[A-Za-z0-9_./-]+' "$f" 2>/dev/null | sort -u | while read -r p; do [ -f "$p" ] && [ "$p" != "$f" ] && head -c 200000 "$p" 2>/dev/null; done
}
check_capture() { # $1 rail-name $2 label $3 min-bytes $4 source-file(optional: tail sha is checked)
  local t line bytes
  t="$(rail_text "$1")"; line="$(grep -a -o 'AGY-STUB bytes=[^]]*\]' <<<"$t" | head -1)"
  bytes="$(sed -n 's/^AGY-STUB bytes=\([0-9]*\) .*/\1/p' <<<"$line")"
  if [ -n "$bytes" ] && [ "$bytes" -gt "$LIMIT" ] && [ "$bytes" -ge "$3" ]; then pass "$2: stub received ${bytes} bytes (> $LIMIT)"
  else fail "$2: stub did not receive a >$LIMIT-byte prompt (line: ${line:-none})"; fi
  assert_contains "$line" "--print=" "$2: argv carries --print="
  assert_not_contains "$line" "|-p|" "$2: argv carries no -p"
  assert_not_contains "$line" "[-p|" "$2: argv carries no leading -p"
  if [ -n "${4:-}" ]; then
    assert_contains "$line" "tailsha=$(tail -c "$(wc -c < "$4")" "$4" | sha256sum | cut -d' ' -f1)" "$2: prompt tail sha256-identical to the source file"
  fi
}
sha_of() { sha256sum < "$1" | cut -d' ' -f1; }

SMALL="$TEST_TMP/small.txt"; echo "write a plan" > "$SMALL"
BIG="$TEST_TMP/big.txt"; node -e 'process.stdout.write("é".repeat(70000)+"TAIL-MARK")' > "$BIG"   # 140009 bytes, multibyte
BIG_BYTES=$(wc -c < "$BIG"); BIG_SHA="$(sha_of "$BIG")"
BIGDIFF="$TEST_TMP/big.diff"; node -e 'process.stdout.write("+"+"y".repeat(150000)+"\n")' > "$BIGDIFF"
DIFFSMALL="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFFSMALL"
export DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"; REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"; HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"
R="$TEST_TMP/r"; mkdir -p "$R"

# Each rail scenario is slow (preflight), so run them concurrently into $R/<name>.{out,rc}.
# The rails scrub the environment before exec'ing agy, so stub controls are baked into a
# per-scenario wrapper instead of being passed as env vars.
mk_stub() { # name VAR=val...  -> echoes the wrapper path
  local w="$TEST_TMP/stub-$1"; shift
  { printf '#!/usr/bin/env bash\n'; for kv in "$@"; do printf 'export %s\n' "$(printf '%q' "$kv")"; done; printf 'exec %q "$@"\n' "$STUB"; } > "$w"
  chmod +x "$w"; printf '%s' "$w"
}
run_case() { # name; env via caller; rest = command
  local n="$1"; shift
  ( "$@" > "$R/$n.out" 2>&1; echo $? > "$R/$n.rc" ) &
}
# hetero sandbox repos (one per scenario: the rail creates a branch/worktree)
mk_sbx() { git -C "$1" init -q -b develop 2>/dev/null || { mkdir -p "$1"; git -C "$1" init -q -b develop; }; git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base; }
for n in hbig herr hnone; do mkdir -p "$TEST_TMP/sbx-$n"; mk_sbx "$TEST_TMP/sbx-$n"; done

# loop scratch repo: oversized commit, real dispatch-review.sh behind a wrapper that adds --bin
LS="$TEST_TMP/loop-repo"; mkdir -p "$LS/scripts" "$TEST_TMP/loop-ledger"
(cd "$LS" && git init -q && git config user.email t@t && git config user.name t && echo base > keep.txt && git add keep.txt && git commit -q -m c1 \
  && git checkout -q -b work && python3 -c "open('big.txt','w').write('x'*150000)" && git add big.txt && git commit -q -m c2-oversized)
LOOP_BIG="$TEST_TMP/loop-big.txt"; python3 -c "open('$LOOP_BIG','w').write('x'*150000)"
LOOP_BASE="$(git -C "$LS" rev-parse HEAD~1)"
WRAP="$TEST_TMP/review-wrap.sh"
# the wrapper keeps the seat's stdout (it names the seat's raw_log) in $R/loopseat.out for rail_text
printf '#!/usr/bin/env bash\nout="$(%q "$@" --bin %q)"; rc=$?\nprintf "%%s\\n" "$out" >> %q\nprintf "%%s\\n" "$out"\nexit $rc\n' "$REVIEW" "$(mk_stub loop AGY_STUB_CAPTURE=1 AGY_STUB_RESULT=error AGY_STUB_NEEDLE_FILE=$LOOP_BIG)" "$R/loopseat.out" > "$WRAP"; chmod +x "$WRAP"

run_case abig env "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$BIG" --bin "$(mk_stub abig AGY_STUB_CAPTURE=1 AGY_STUB_TAIL=$BIG_BYTES)"
run_case aerr env "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$SMALL" --bin "$(mk_stub aerr AGY_STUB_RESULT=error AGY_STUB_ERROR_TEXT=zz-author-boom)"
run_case anone env "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$SMALL" --bin "$(mk_stub anone AGY_STUB_RESULT=none)"
run_case rbig env "$REVIEW" --runner agy --model gemini-3.7-flash-high --diff-file "$BIGDIFF" --bin "$(mk_stub rbig AGY_STUB_CAPTURE=1 AGY_STUB_RESULT=error AGY_STUB_NEEDLE_FILE=$BIGDIFF)"
run_case rerr env "$REVIEW" --runner agy --model gemini-3.7-flash-high --diff-file "$DIFFSMALL" --bin "$(mk_stub rerr AGY_STUB_RESULT=error AGY_STUB_ERROR_TEXT=zz-review-boom)"
run_case rnone env "$REVIEW" --runner agy --model gemini-3.7-flash-high --diff-file "$DIFFSMALL" --bin "$(mk_stub rnone AGY_STUB_RESULT=none)"
run_case hbig env -C "$TEST_TMP/sbx-hbig" "$HETERO" --branch t/hbig --prompt-file "$BIG" --agy-bin "$(mk_stub hbig AGY_STUB_CAPTURE=1 AGY_STUB_TAIL=$BIG_BYTES)" --model gemini-3.7-flash-high --runner agy
run_case herr env -C "$TEST_TMP/sbx-herr" "$HETERO" --branch t/herr --prompt-file "$SMALL" --agy-bin "$(mk_stub herr AGY_STUB_RESULT=error AGY_STUB_ERROR_TEXT=zz-hetero-boom)" --model gemini-3.7-flash-high --runner agy
run_case hnone env -C "$TEST_TMP/sbx-hnone" "$HETERO" --branch t/hnone --prompt-file "$SMALL" --agy-bin "$(mk_stub hnone AGY_STUB_RESULT=none)" --model gemini-3.7-flash-high --runner agy
run_case loop env -C "$LS" AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$WRAP" node "$LOOP" collect \
  --repo-root "$LS" --ledger "$TEST_TMP/loop-ledger" --phase p_agy --generation 1 --branch work --phase-base "$LOOP_BASE" \
  --seats "gemini-3.7-flash-high/low@agy" --min-reviewed-seats 1
wait

rc() { cat "$R/$1.rc" 2>/dev/null || echo missing; }
# --- 1. a >131071-byte prompt arrives intact through each caller --------------
check_capture abig "author" "$BIG_BYTES" "$BIG"
assert_not_contains "$(cat "$R/abig.out")" "single-argv ceiling" "author: no argv-ceiling refusal"
# The review/loop rails keep no agy response for a fixture-less stub (containment audit), but they
# do keep agy's stderr on a non-zero exit, so the capture stub runs in ERROR mode: its
# `AGY-STUB bytes=… sha256=…` line (written to stderr before the result) is read back from the rail's
# log. The prompt carries the rail's own framing, so byte-exactness is asserted as the stub finding
# the whole source payload inside the received prompt (needle=found), plus the >limit byte count.
check_capture rbig "review" 150000
assert_contains "$(rail_text rbig)" "needle=found" "review: the >131071-byte diff arrived byte-exact inside the prompt"
assert_contains "$(rail_text rbig)" "sha256=" "review: stub reported the prompt sha256"
assert_not_contains "$(rail_text rbig)" "single-argv ceiling" "review: oversized diff is not refused by an argv ceiling"
check_capture hbig "hetero" "$BIG_BYTES" "$BIG"
assert_not_contains "$(cat "$R/loop.out")" "single-argv ceiling" "loop: oversized agy seat is not refused by an argv ceiling"
check_capture loopseat "loop" 150000
assert_contains "$(rail_text loopseat)" "needle=found" "loop: the >131071-byte payload arrived byte-exact inside the agy seat prompt"

# --- 2+3. ERROR result / no result event -> the rail's existing typed failure --
assert_neq "0" "$(rc aerr)" "author ERROR: non-zero exit"
assert_contains "$(cat "$R/aerr.out")" '"status": "runner_failed"' "author ERROR: typed runner_failed"
assert_contains "$(rail_text aerr)" 'zz-author-boom' "author ERROR: the agy error text is surfaced"
assert_neq "0" "$(rc anone)" "author no-result: non-zero exit"
assert_contains "$(cat "$R/anone.out")" '"status": "runner_failed"' "author no-result: typed runner_failed"
assert_eq "1" "$(rc rerr)" "review ERROR: exit 1"
assert_contains "$(cat "$R/rerr.out")" '"status": "no_verdict"' "review ERROR: typed no_verdict"
assert_contains "$(rail_text rerr)" 'zz-review-boom' "review ERROR: the agy error text is surfaced"
assert_eq "1" "$(rc rnone)" "review no-result: exit 1"
assert_contains "$(cat "$R/rnone.out")" '"status": "no_verdict"' "review no-result: typed no_verdict"
assert_contains "$(cat "$R/herr.out")" '"status": "question_suspected"' "hetero ERROR: typed question_suspected (agent exited non-zero, no commit)"
assert_contains "$(rail_text herr)" 'zz-hetero-boom' "hetero ERROR: the agy error text is surfaced"
for c in herr hnone; do
  assert_neq "0" "$(rc $c)" "hetero $c: non-zero exit"
  assert_not_contains "$(cat "$R/$c.out")" '"status": "committed"' "hetero $c: never reported committed"
done

finalize_test
