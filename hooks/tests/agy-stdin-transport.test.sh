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
  local name="$1" w="$TEST_TMP/stub-$1"; shift
  { printf '#!/usr/bin/env bash\n'; for kv in "$@"; do printf 'export %s\n' "$(printf '%q' "$kv")"; done; printf 'case " $* " in *" --print= "*) : > %q;; esac\n' "$TEST_TMP/called-$name"; printf 'exec %q "$@"\n' "$STUB"; } > "$w"
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
# --- BL-0021 fail-closed ceiling: the stdin wall (~175-200 KB on this deployment) is silent, so a
# prompt whose encoded line is over AUTOPILOT_AGY_STDIN_MAX_BYTES (default 170000) is refused, never sent.
OVER="$TEST_TMP/over.txt"; node -e 'process.stdout.write("y".repeat(172000)+"OVER-TAIL")' > "$OVER"
OVERDIFF="$TEST_TMP/over.diff"; node -e 'process.stdout.write("+"+"y".repeat(175000)+"\n")' > "$OVERDIFF"
for n in hover hraise; do mkdir -p "$TEST_TMP/sbx-$n"; mk_sbx "$TEST_TMP/sbx-$n"; done
OLOOP_BIG="$TEST_TMP/loop-over.txt"; python3 -c "open('$OLOOP_BIG','w').write('x'*175000)"
OS="$TEST_TMP/loop-over-repo"; mkdir -p "$OS" "$TEST_TMP/oloop-ledger"
(cd "$OS" && git init -q && git config user.email t@t && git config user.name t && echo base > keep.txt && git add keep.txt && git commit -q -m c1 \
  && git checkout -q -b work && python3 -c "open('big.txt','w').write('x'*175000)" && git add big.txt && git commit -q -m c2-over)
OLOOP_BASE="$(git -C "$OS" rev-parse HEAD~1)"
OWRAP="$TEST_TMP/review-wrap-over.sh"
printf '#!/usr/bin/env bash\nout="$(%q "$@" --bin %q)"; rc=$?\nprintf "%%s\\n" "$out" >> %q\nprintf "%%s\\n" "$out"\nexit $rc\n' "$REVIEW" "$(mk_stub oloop AGY_STUB_CAPTURE=1)" "$R/oloopseat.out" > "$OWRAP"; chmod +x "$OWRAP"
run_case aover env "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$OVER" --bin "$(mk_stub aover AGY_STUB_CAPTURE=1)"
run_case rover env "$REVIEW" --runner agy --model gemini-3.7-flash-high --diff-file "$OVERDIFF" --bin "$(mk_stub rover AGY_STUB_CAPTURE=1)"
run_case hover env -C "$TEST_TMP/sbx-hover" "$HETERO" --branch t/hover --prompt-file "$OVER" --agy-bin "$(mk_stub hover AGY_STUB_CAPTURE=1)" --model gemini-3.7-flash-high --runner agy
run_case oloop env -C "$OS" AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$OWRAP" node "$LOOP" collect \
  --repo-root "$OS" --ledger "$TEST_TMP/oloop-ledger" --phase p_agy --generation 1 --branch work --phase-base "$OLOOP_BASE" \
  --seats "gemini-3.7-flash-high/low@agy" --min-reviewed-seats 1
# override: raising the limit lets the same prompt through
run_case araise env AUTOPILOT_AGY_STDIN_MAX_BYTES=400000 "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$OVER" --bin "$(mk_stub araise AGY_STUB_CAPTURE=1)"
# --- BL-0021 response-side detection: the wall is in TOKENS (~97.6k input tokens, agy 1.4.6), so a
# SUCCESS with an empty response, or one whose usage.input_tokens is at/over the ceiling, is a failure.
for n in hemp htrk hok; do mkdir -p "$TEST_TMP/sbx-$n"; mk_sbx "$TEST_TMP/sbx-$n"; done
mkdir -p "$TEST_TMP/rloop-ledger"
run_case aemp env "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$SMALL" --bin "$(mk_stub aemp AGY_STUB_RESPONSE_EMPTY=1)"
run_case atrk env "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$SMALL" --bin "$(mk_stub atrk AGY_STUB_INPUT_TOKENS=97652)"
run_case aok env "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$SMALL" --bin "$(mk_stub aok AGY_STUB_INPUT_TOKENS=87366)"
run_case acust env AUTOPILOT_AGY_INPUT_TOKEN_CEILING=100000 "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$SMALL" --bin "$(mk_stub acust AGY_STUB_INPUT_TOKENS=97652)"
run_case acustlow env AUTOPILOT_AGY_INPUT_TOKEN_CEILING=50000 "$AUTHOR" --runner agy --model gemini-3.7-flash-high --prompt-file "$SMALL" --bin "$(mk_stub acustlow AGY_STUB_INPUT_TOKENS=87366)"
run_case remp env "$REVIEW" --runner agy --model gemini-3.7-flash-high --diff-file "$DIFFSMALL" --bin "$(mk_stub remp AGY_STUB_RESPONSE_EMPTY=1)"
run_case rtrk env "$REVIEW" --runner agy --model gemini-3.7-flash-high --diff-file "$DIFFSMALL" --bin "$(mk_stub rtrk AGY_STUB_INPUT_TOKENS=97652)"
run_case hemp env -C "$TEST_TMP/sbx-hemp" "$HETERO" --branch t/hemp --prompt-file "$SMALL" --agy-bin "$(mk_stub hemp AGY_STUB_RESPONSE_EMPTY=1)" --model gemini-3.7-flash-high --runner agy
run_case htrk env -C "$TEST_TMP/sbx-htrk" "$HETERO" --branch t/htrk --prompt-file "$SMALL" --agy-bin "$(mk_stub htrk AGY_STUB_INPUT_TOKENS=97652)" --model gemini-3.7-flash-high --runner agy
RWRAP="$TEST_TMP/review-wrap-trk.sh"
printf '#!/usr/bin/env bash\nout="$(%q "$@" --bin %q)"; rc=$?\nprintf "%%s\\n" "$out" >> %q\nprintf "%%s\\n" "$out"\nexit $rc\n' "$REVIEW" "$(mk_stub ltrk AGY_STUB_INPUT_TOKENS=97652)" "$R/ltrkseat.out" > "$RWRAP"; chmod +x "$RWRAP"
run_case ltrk env -C "$LS" AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$RWRAP" node "$LOOP" collect \
  --repo-root "$LS" --ledger "$TEST_TMP/rloop-ledger" --phase p_agy --generation 1 --branch work --phase-base "$LOOP_BASE" \
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

# --- 4. fail-closed ceiling (BL-0021) -----------------------------------------
OVERMSG="agy_stdin_ceiling"
OUT="$(AGY_STUB_RESULT=ok node "$HELPER" run --prompt-file "$OVER" -- "$(mk_stub hlp AGY_STUB_CAPTURE=1)" 2>&1)"; RC=$?
assert_eq "3" "$RC" "helper: over-ceiling prompt exits 3"
assert_contains "$OUT" "$OVERMSG" "helper: typed agy_stdin_ceiling reason on stderr"
[ ! -e "$TEST_TMP/called-hlp" ] && pass "helper: agy never invoked over the ceiling" || fail "helper: agy was invoked over the ceiling"
OUT="$(AUTOPILOT_AGY_STDIN_MAX_BYTES=400000 node "$HELPER" run --prompt-file "$OVER" -- "$(mk_stub hlp2 AGY_STUB_CAPTURE=1)" 2>&1)"; RC=$?
assert_eq "0" "$RC" "helper: raised limit lets the prompt through"
OUT="$(AUTOPILOT_AGY_STDIN_MAX_BYTES=junk node "$HELPER" run --prompt-file "$OVER" -- "$(mk_stub hlp3 AGY_STUB_CAPTURE=1)" 2>&1)"; RC=$?
assert_eq "3" "$RC" "NEGATIVE CONTROL: a malformed override falls back to the default (still refused)"
for c in aover rover hover oloop; do
  # (the stub runs inside bwrap on some rails, where a marker file cannot be written: the stub's own
  # `AGY-STUB bytes=` capture line is the evidence that a prompt reached agy)
  assert_not_contains "$(rail_text $c)$(rail_text ${c}seat)" "AGY-STUB bytes" "$c: agy stub never received the over-ceiling prompt"
done
assert_neq "0" "$(rc aover)" "author over-ceiling: non-zero exit"
assert_contains "$(cat "$R/aover.out")" '"status": "runner_failed"' "author over-ceiling: typed runner_failed"
assert_contains "$(rail_text aover)" "$OVERMSG" "author over-ceiling: reason surfaced"
assert_eq "1" "$(rc rover)" "review over-ceiling: exit 1"
assert_contains "$(cat "$R/rover.out")" '"status": "no_verdict"' "review over-ceiling: typed no_verdict"
assert_contains "$(rail_text rover)" "$OVERMSG" "review over-ceiling: reason surfaced"
assert_not_contains "$(cat "$R/hover.out")" '"status": "committed"' "hetero over-ceiling: never committed"
assert_neq "0" "$(rc hover)" "hetero over-ceiling: non-zero exit"
assert_contains "$(rail_text hover)" "$OVERMSG" "hetero over-ceiling: reason surfaced"
assert_not_contains "$(rail_text oloopseat)" "AGY-STUB bytes" "loop over-ceiling: seat prompt never reached agy"
assert_contains "$(rail_text oloopseat)$(cat "$R/oloop.out")" "$OVERMSG" "loop over-ceiling: reason surfaced"
assert_contains "$(rail_text araise)" "AGY-STUB bytes" "override: raised limit delivered the over-170000 prompt to agy"

# --- 5. response-side detection (BL-0021, tokens not bytes) -------------------
EMPTYMSG="agy_empty_response"; TRUNCMSG="agy_input_truncated"
OUT="$(AGY_STUB_RESPONSE_EMPTY=1 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "helper: SUCCESS + empty response exits 1"; assert_contains "$OUT" "$EMPTYMSG" "helper: agy_empty_response reason"
OUT="$(AGY_STUB_RESPONSE_EMPTY=1 node "$HELPER" run --emit envelope --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "helper: empty response also fails in envelope mode"
OUT="$(AGY_STUB_INPUT_TOKENS=97652 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "helper: 97652 input tokens (non-empty response) exits 1"; assert_contains "$OUT" "$TRUNCMSG" "helper: agy_input_truncated reason"
OUT="$(AGY_STUB_INPUT_TOKENS=87366 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "0" "$RC" "helper: 87366 input tokens succeeds"; assert_contains "$OUT" "stub ok" "helper: 87366 tokens keeps the response"
OUT="$(AGY_STUB_INPUT_TOKENS=95000 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "helper: exactly the ceiling (95000) is refused"
OUT="$(AGY_STUB_INPUT_TOKENS=94999 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "0" "$RC" "helper: just under the ceiling (94999) passes"
OUT="$(AUTOPILOT_AGY_INPUT_TOKEN_CEILING=100000 AGY_STUB_INPUT_TOKENS=97652 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "0" "$RC" "helper: raised token ceiling lets 97652 through"
OUT="$(AUTOPILOT_AGY_INPUT_TOKEN_CEILING=50000 AGY_STUB_INPUT_TOKENS=87366 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "helper: lowered token ceiling refuses 87366"
OUT="$(AUTOPILOT_AGY_INPUT_TOKEN_CEILING=junk AGY_STUB_INPUT_TOKENS=97652 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "NEGATIVE CONTROL: a malformed token-ceiling override falls back to the default (still refused)"
OUT="$(AUTOPILOT_AGY_INPUT_TOKEN_CEILING=0 AGY_STUB_INPUT_TOKENS=97652 node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "1" "$RC" "NEGATIVE CONTROL: a zero token-ceiling override falls back to the default"
OUT="$(node "$HELPER" run --prompt-file "$PF" -- "$STUB" 2>&1)"; RC=$?
assert_eq "0" "$RC" "helper: no usage field -> token check skipped, still succeeds"; assert_contains "$OUT" "token-ceiling check was skipped" "helper: missing usage field is noted on stderr"

assert_neq "0" "$(rc aemp)" "author empty response: non-zero exit"
assert_contains "$(cat "$R/aemp.out")" '"status": "runner_failed"' "author empty response: typed runner_failed"
assert_contains "$(rail_text aemp)" "$EMPTYMSG" "author empty response: reason surfaced"
assert_neq "0" "$(rc atrk)" "author 97652 tokens: non-zero exit"
assert_contains "$(cat "$R/atrk.out")" '"status": "runner_failed"' "author 97652 tokens: typed runner_failed"
assert_contains "$(rail_text atrk)" "$TRUNCMSG" "author 97652 tokens: reason surfaced"
# (the stub's answer carries no author frame, so a delivered response ends "truncated/frame_missing", rc 5 —
# what matters is that agy's answer got PAST the transport: not runner_failed, no agy_input_truncated)
for c in aok acust; do
  assert_not_contains "$(cat "$R/$c.out")" '"status": "runner_failed"' "author $c: transport let the response through"
  assert_not_contains "$(rail_text $c)" "$TRUNCMSG" "author $c: no agy_input_truncated"
  assert_contains "$(cat "$R/$c.out")" 'frame_missing' "author $c: response reached the author parser"
done
assert_neq "0" "$(rc acustlow)" "author 87366 tokens + lowered ceiling: refused"
assert_contains "$(rail_text acustlow)" "$TRUNCMSG" "author lowered ceiling: reason surfaced"
assert_eq "1" "$(rc remp)" "review empty response: exit 1"
assert_contains "$(cat "$R/remp.out")" '"status": "no_verdict"' "review empty response: typed no_verdict"
assert_contains "$(rail_text remp)" "$EMPTYMSG" "review empty response: reason surfaced"
assert_eq "1" "$(rc rtrk)" "review 97652 tokens: exit 1"
assert_contains "$(cat "$R/rtrk.out")" '"status": "no_verdict"' "review 97652 tokens: typed no_verdict"
assert_contains "$(rail_text rtrk)" "$TRUNCMSG" "review 97652 tokens: reason surfaced"
for c in hemp htrk; do
  assert_neq "0" "$(rc $c)" "hetero $c: non-zero exit"
  assert_not_contains "$(cat "$R/$c.out")" '"status": "committed"' "hetero $c: never reported committed"
done
assert_contains "$(rail_text hemp)" "$EMPTYMSG" "hetero empty response: reason surfaced"
assert_contains "$(rail_text htrk)" "$TRUNCMSG" "hetero 97652 tokens: reason surfaced"
assert_contains "$(rail_text ltrkseat)$(cat "$R/ltrk.out")" "$TRUNCMSG" "loop 97652 tokens: reason surfaced"
assert_not_contains "$(cat "$R/ltrk.out")" '"reviewed": 1' "loop 97652 tokens: seat not counted as reviewed"

finalize_test
