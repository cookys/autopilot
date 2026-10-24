#!/usr/bin/env bash
# hooks/tests/p2-batch-env.test.sh - BL-0055 P2-3: claude child environment (HOME, CLAUDE*, ANTHROPIC*, XDG), expiresAt and window values, --first/--last range, audit git environment, the batch worker entry. Fake claude only.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib-p2.sh"

echo "--- environment, time values, ranges, worker entry"
# claude --version runs in a throwaway home, never the real HOME
RV="$TEST_TMP/run-ver"; run_batch "$WRAP" "$MAN" "$RV" >/dev/null 2>&1
assert_eq "$(grep -cv "^$FHOME\$" "$FAKE_STATE_DIR/version.home")" "$(wc -l <"$FAKE_STATE_DIR/version.home" | tr -d ' ')" "claude --version never saw the real HOME"
assert_contains "$(cat "$FAKE_STATE_DIR/version.home")" "/homes/_version" "claude --version ran in the throwaway home"
RVM="$TEST_TMP/run-ver-mut"; run_batch "$TEST_TMP/mut-realver/run-p2-batch.js" "$MAN_REALVER" "$RVM" >/dev/null 2>&1
assert_contains "$(cat "$FAKE_STATE_DIR/version.home")" "$FHOME" "RED: the wrapper without the isolated home runs --version with the real HOME"
# CLAUDE_CONFIG_DIR exported outside must not reach any claude child (probe, harness turns)
mkdir -p "$TEST_TMP/extcfg"; echo '{"hooks":{}}' >"$TEST_TMP/extcfg/settings.json"
RC1="$TEST_TMP/run-cfg"; CLAUDE_CONFIG_DIR="$TEST_TMP/extcfg" run_batch "$WRAP" "$MAN" "$RC1"; assert_eq "$?" 0 "batch with CLAUDE_CONFIG_DIR exported outside completes"
assert_eq "$(sort -u "$FAKE_STATE_DIR/cfgdir.seen" | tr '\n' ' ')" "unset " "claude children (probe and turns) never see the outside CLAUDE_CONFIG_DIR"
assert_eq "$([ "$(wc -l <"$FAKE_STATE_DIR/cfgdir.seen")" -gt 6 ] && echo y)" y "the fake recorded every claude call"
RC2="$TEST_TMP/run-cfg-mut"; CLAUDE_CONFIG_DIR="$TEST_TMP/extcfg" run_batch "$TEST_TMP/mut-nocfgunset/run-p2-batch.js" "$MAN_NOCFG" "$RC2"
assert_contains "$(cat "$FAKE_STATE_DIR/cfgdir.seen")" "extcfg" "RED: the wrapper without the unset hands the outside CLAUDE_CONFIG_DIR to claude"
# the launcher drops it too (stub wrapper records what it was started with)
mkdir -p "$TEST_TMP/stubw"; cat >"$TEST_TMP/stubw/w.js" <<'JS'
const fs = require('fs'); module.exports = { makeOrder: () => [{ id: 'X-01' }], credExpiresAt: () => null, scrubEnv: require(process.env.REAL_WRAP).scrubEnv };
if (require.main === module) fs.writeFileSync(process.env.STUB_OUT, process.env.CLAUDE_CONFIG_DIR || 'unset');
JS
mkdir -p "$TEST_TMP/mut-loopcfg"; cp "$LOOP" "$TEST_TMP/mut-loopcfg/l.js"; mutate "$TEST_TMP/mut-loopcfg/l.js" "const env = w.scrubEnv(process.env);" "const env = { ...process.env };" || fail "loopcfg mutant"
for pair in "real:$LOOP" "mut:$TEST_TMP/mut-loopcfg/l.js"; do
  REAL_WRAP="$WRAP_SRC" STUB_OUT="$TEST_TMP/stub.out.${pair%%:*}" CLAUDE_CONFIG_DIR="$TEST_TMP/extcfg" node "${pair#*:}" --manifest "$MAN" --run-dir "$TEST_TMP/run-stub-${pair%%:*}" --clone "$CLONE" --wrapper "$TEST_TMP/stubw/w.js" </dev/null >/dev/null 2>&1
done
assert_eq "$(cat "$TEST_TMP/stub.out.real")" "unset" "launcher starts the wrapper without CLAUDE_CONFIG_DIR"
assert_contains "$(cat "$TEST_TMP/stub.out.mut")" "extcfg" "RED: the launcher without the delete passes CLAUDE_CONFIG_DIR on"
# every CLAUDE*, ANTHROPIC* and XDG home variable is gone from every claude child (probe, --version, turns)
RE1="$TEST_TMP/run-envscrub"
CLAUDE_CONFIG_DIR="$TEST_TMP/extcfg" CLAUDE_CODE_OAUTH_TOKEN=tok ANTHROPIC_API_KEY=key ANTHROPIC_BASE_URL=http://example.invalid CLAUDECODE=1 XDG_CONFIG_HOME="$TEST_TMP/xdg" run_batch "$WRAP" "$MAN" "$RE1"; assert_eq "$?" 0 "batch with CLAUDE*, ANTHROPIC* and XDG variables exported outside completes"
assert_eq "$(cat "$FAKE_STATE_DIR/claude.env.seen" | wc -l | tr -d ' ')" 0 "no CLAUDE*, ANTHROPIC* or XDG_*_HOME variable reaches any claude child"
RE2="$TEST_TMP/run-envscrub-mut"
CLAUDE_CONFIG_DIR="$TEST_TMP/extcfg" ANTHROPIC_API_KEY=key XDG_CONFIG_HOME="$TEST_TMP/xdg" run_batch "$TEST_TMP/mut-nocfgunset/run-p2-batch.js" "$MAN_NOCFG" "$RE2"
assert_contains "$(cat "$FAKE_STATE_DIR/claude.env.seen")" "ANTHROPIC_API_KEY=key" "RED: the wrapper that scrubs nothing hands ANTHROPIC_API_KEY to claude"
# time units: expiresAt is read in milliseconds (seconds are normalised), 9 minutes ahead pauses, 11 minutes ahead goes on
node -e 'const w=require(process.argv[1]),fs=require("fs"),d=process.argv[2];const wr=(n,v)=>{fs.writeFileSync(d+"/"+n,JSON.stringify({claudeAiOauth:{expiresAt:v}}));return d+"/"+n};
const now=Date.now();const ok=(a,b,m)=>{if(a!==b){console.error("FAIL "+m+": "+a+" vs "+b);process.exit(1)}};
ok(w.credExpiresAt(wr("ms",now+7200000))>now,true,"ms");ok(Math.abs(w.credExpiresAt(wr("sec",Math.floor(now/1000)+7200))-(now+7200000))<2000,true,"seconds normalised");
ok(w.credExpiresAt(wr("str","soon")),0,"string is expired");ok(w.credExpiresAt(wr("numstr",String(now+7200000))),0,"numeric string is expired");ok(w.credExpiresAt(wr("neg",-5)),0,"negative is expired");ok(w.credExpiresAt(wr("zero",0)),0,"zero is expired");ok(w.credExpiresAt(wr("nul",null)),0,"null is expired");
fs.writeFileSync(d+"/noexp",JSON.stringify({claudeAiOauth:{accessToken:"x"}}));ok(w.credExpiresAt(d+"/noexp"),null,"field absent: not judged");fs.writeFileSync(d+"/nooauth","{}");ok(w.credExpiresAt(d+"/nooauth"),null,"no oauth block: not judged");
fs.writeFileSync(d+"/bad","{broken");ok(w.credExpiresAt(d+"/bad"),0,"unparsable file is expired");ok(w.credExpiresAt(d+"/absent"),0,"missing file is expired")' "$WRAP_SRC" "$TEST_TMP" || fail "credExpiresAt units"
assert_eq "$?" 0 "credExpiresAt: milliseconds as is, seconds normalised, a present but invalid value counts as expired, an absent field is not judged"
mkcred "$TEST_TMP/cred-9.json" 9; mkcred "$TEST_TMP/cred-11.json" 11
RU1="$TEST_TMP/run-u9"; RUN_ARGS="--credentials-source $TEST_TMP/cred-9.json" run_batch "$WRAP" "$MAN" "$RU1"; assert_eq "$?" 7 "source 9 minutes from expiry: pause"
RU2="$TEST_TMP/run-u11"; RUN_ARGS="--credentials-source $TEST_TMP/cred-11.json --last 1" run_batch "$WRAP" "$MAN" "$RU2"; assert_eq "$?" 0 "source 11 minutes from expiry: the id runs"
RU3="$TEST_TMP/run-u9mut"; RUN_ARGS="--credentials-source $TEST_TMP/cred-9.json" run_batch "$TEST_TMP/mut-secondsunit/run-p2-batch.js" "$MAN_SECS" "$RU3"; assert_neq "$?" 7 "RED: an expiry margin in the wrong unit lets a 9-minute token through"
# expiresAt present but invalid (0, -1, a string, null) pauses like an expired token; an absent field is not judged
for v in 0 -1 '"soon"' null; do
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({claudeAiOauth:{accessToken:"x",expiresAt:JSON.parse(process.argv[2])}}))' "$TEST_TMP/cred-bad.json" "$v"
  RB="$TEST_TMP/run-credbad"; rm -rf "$RB"; RUN_ARGS="--credentials-source $TEST_TMP/cred-bad.json" run_batch "$WRAP" "$MAN" "$RB"; assert_eq "$?" 7 "expiresAt=$v: treated as expired, the id pauses"
  RBP="$TEST_TMP/run-credbad-prev"; rm -rf "$RBP"; RUN_ARGS="--credentials-source $TEST_TMP/cred-bad.json --last 1" run_batch "$TEST_TMP/mut-prevwrap/run-p2-batch.js" "$MAN_PREV" "$RBP"; assert_eq "$?" 0 "RED expiresAt=$v: the previous wrapper let the id through"
done
echo '{"claudeAiOauth":{"accessToken":"x"}}' >"$TEST_TMP/cred-noexp.json"
RUN_ARGS="--credentials-source $TEST_TMP/cred-noexp.json --last 1" run_batch "$WRAP" "$MAN" "$TEST_TMP/run-credabsent"; assert_eq "$?" 0 "no expiresAt field: not judged, the id runs"
# window values: a manifest window_s of 0, a window.start that is not a number
RWZ="$TEST_TMP/run-window0"; run_batch "$WRAP" "$MAN_W0" "$RWZ"; assert_eq "$?" 3 "window_s 0 in the manifest: abort"
RWG="$TEST_TMP/run-windowbad"; mkdir -p "$RWG"; echo abc >"$RWG/window.start"; run_batch "$WRAP" "$MAN" "$RWG"; assert_eq "$?" 3 "window.start not a number: abort"
assert_eq "$(grep -c ' COSTCHK ' "$RWG/invocation.log")" 0 "window.start not a number: nothing was started (no COSTCHK)"
RWGP="$TEST_TMP/run-windowbad-prev"; mkdir -p "$RWGP"; echo abc >"$RWGP/window.start"; RUN_ARGS="--last 1" run_batch "$TEST_TMP/mut-nowinchk/run-p2-batch.js" "$MAN_NOWIN" "$RWGP"
assert_neq "$(grep -c ' COSTCHK ' "$RWGP/invocation.log")" 0 "RED window.start=abc: without the check the wrapper gets as far as COSTCHK with a NaN elapsed"
RWL="$TEST_TMP/run-loopwinbad"; mkdir -p "$RWL"; echo abc >"$RWL/window.start"
loop_run "$RWL" "$TEST_TMP/cred-fresh.json"; assert_eq "$?" 9 "launcher: window.start not a number: stop (exit 9)"
assert_file_absent "$RWL/invocation.log"
# --first / --last outside the order are refused before anything is written
for a in "--first 999" "--first 0" "--last 99" "--first 3 --last 2" "--first abc"; do
  RR="$TEST_TMP/run-range"; rm -rf "$RR"; RUN_ARGS="$a" run_batch "$WRAP" "$MAN" "$RR"; assert_eq "$?" 2 "$a: usage error (exit 2)"
  assert_file_absent "$RR/invocation.log"
done
RRP="$TEST_TMP/run-range-prev"; rm -rf "$RRP"; RUN_ARGS="--first 999" run_batch "$TEST_TMP/mut-prevwrap/run-p2-batch.js" "$MAN_PREV" "$RRP"; assert_eq "$?" 0 "RED --first 999: the previous wrapper exited 0 having done nothing"
# the worker entry: a real child process runs a 2-id batch to the end and the audit passes
RN1="$TEST_TMP/run-n1"; run_batch "$WRAP" "$MAN_N1" "$RN1"; assert_eq "$?" 0 "real --run subprocess, n=1 (2 ids): exits 0"
node "$WRAP" --audit --manifest "$MAN_N1" --run-dir "$RN1" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/rn1-audit.out" 2>&1; assert_eq "$?" 0 "n=1 batch: audit OK ($(head -c 150 "$TEST_TMP/rn1-audit.out"))"
# audit: git calls of the audit run without the outside CLAUDE*/ANTHROPIC* variables
mkdir -p "$TEST_TMP/gitshim"; printf '#!/bin/sh\necho "${CLAUDE_CONFIG_DIR-unset}" >>"%s/git.env.seen"\nexec /usr/bin/git "$@"\n' "$TEST_TMP" >"$TEST_TMP/gitshim/git"; chmod +x "$TEST_TMP/gitshim/git"
rm -f "$TEST_TMP/git.env.seen"; PATH="$TEST_TMP/gitshim:$PATH" CLAUDE_CONFIG_DIR=/outside/cfg node "$WRAP" --audit --manifest "$MAN_N1" --run-dir "$RN1" --clone "$CLONE" --wrapper-file "$WRAP" >/dev/null 2>&1
assert_eq "$(sort -u "$TEST_TMP/git.env.seen" | tr '\n' ' ')" "unset " "audit: git is started without the outside CLAUDE_CONFIG_DIR"
rm -f "$TEST_TMP/git.env.seen"; PATH="$TEST_TMP/gitshim:$PATH" CLAUDE_CONFIG_DIR=/outside/cfg node "$TEST_TMP/mut-prevwrap/run-p2-batch.js" --audit --manifest "$MAN_N1" --run-dir "$RN1" --clone "$CLONE" --wrapper-file "$WRAP" >/dev/null 2>&1
assert_contains "$(cat "$TEST_TMP/git.env.seen")" "/outside/cfg" "RED audit: the previous wrapper's git inherits the outside CLAUDE_CONFIG_DIR"
mkdir -p "$TEST_TMP/mut-noworker"; cp "$WRAP_SRC" "$TEST_TMP/mut-noworker/run-p2-batch.js"; mutate "$TEST_TMP/mut-noworker/run-p2-batch.js" "parentPort.postMessage({ code: main(process.argv.slice(2)) });" "void main;" || fail "noworker mutant"
RN2="$TEST_TMP/run-n1-mut"; run_batch "$TEST_TMP/mut-noworker/run-p2-batch.js" "$MAN_N1" "$RN2"; assert_neq "$?" 0 "RED worker entry: a worker that never runs main makes --run exit non-zero"

finalize_test
