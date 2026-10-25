#!/usr/bin/env bash
# orchestration-eval-agy-stdin.test.sh — BL-0302: run-orchestration-eval.sh --runner agy sends the prompt
# on STDIN through lib/agy-stream-json.js, not as an argv argument. A recording fake agy on PATH captures
# argv and stdin; the harness prompt text must be on stdin and absent from argv.
# Negative control: run this suite with EVAL_HARNESS=<path to the pre-BL-0302 harness copy living inside an
# evals/orchestration/ directory> (its REPO_ROOT is ../..) and the argv assertions go red.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export ORCH_TIMEOUT="1m"

HARNESS="${EVAL_HARNESS:-$REPO_ROOT/evals/orchestration/run-orchestration-eval.sh}"
BIN="$TEST_TMP/bin"; REC="$TEST_TMP/rec"; mkdir -p "$BIN" "$REC"
cat >"$BIN/agy" <<'FAKE'
#!/usr/bin/env node
// Fake agy. Text mode (argv has -p, the pre-BL-0302 transport) prints plain text only. Stream-json mode
// prints NDJSON events; the formats follow scripts/lib/agy-stream-json.js: a `result` event is
// {"event":"result","result":{status,response,error}} (parseStream and lastResult read event==='result',
// result.status, result.response, result.error; status other than SUCCESS = failure, error carries the text).
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('1.4.6'); process.exit(0); }
const n = `${Date.now()}-${process.pid}`;
const stdin = fs.readFileSync(0);
fs.writeFileSync(`${process.env.REC}/${n}.argv`, JSON.stringify(a));
fs.writeFileSync(`${process.env.REC}/${n}.stdin`, stdin);
const mode = process.env.FAKE_MODE || 'ok';
const legacy = a.includes('-p');
const TEXT = { auth: ['authentication invalid API key', 7], exit3: ['some diagnostic', 3], empty: ['', 0], ws: ['   ', 0], nl: ['line one\n', 0], ok: ['FAKE-AGY-RESPONSE', 0] }[mode];
const [text, code] = TEXT;
if (legacy) { process.stdout.write(`${text}\n`); process.exit(code); }
const ev = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
ev({ event: 'init', session: 'fake' });
ev({ event: 'assistant', message: { content: text } });
if (code === 0) ev({ event: 'result', result: { status: 'SUCCESS', response: text } });
else ev({ event: 'result', result: { status: 'ERROR', error: text } });
process.exit(code);
FAKE
chmod +x "$BIN/agy"
export PATH="$BIN:$PATH" REC

OUT="$TEST_TMP/out"; mkdir -p "$OUT"
timeout 300 bash "$HARNESS" --task t1-fix-with-decoy --arm on --runner agy --model fake-model --out "$OUT" >"$TEST_TMP/run.log" 2>&1 </dev/null
RC=$?
A="$(/bin/ls -t "$REC"/*.argv 2>/dev/null | head -1)"
[ -n "$A" ] || fail "fake agy was never called (rc=$RC): $(tail -5 "$TEST_TMP/run.log")"
ARGV="$(cat "$A")"; STDIN="$(cat "${A%.argv}.stdin")"
assert_contains "$STDIN" 'HARNESS DIRECTIVE' "agy-eval: the harness prompt arrives on stdin"
assert_contains "$STDIN" '"event":"user"' "agy-eval: stdin is a stream-json user line"
assert_not_contains "$ARGV" 'HARNESS DIRECTIVE' "agy-eval: argv carries no prompt text"
assert_not_contains "$ARGV" '"-p"' "agy-eval: argv has no -p"
assert_contains "$ARGV" '"--print="' "agy-eval: argv carries --print="
assert_contains "$ARGV" '"--model","fake-model"' "agy-eval: model flag preserved"
assert_contains "$ARGV" '"--dangerously-skip-permissions"' "agy-eval: permission flag preserved"
assert_contains "$ARGV" '"--print-timeout","1m"' "agy-eval: print-timeout preserved"
assert_contains "$(cat "$OUT/run.log" 2>/dev/null)" 'FAKE-AGY-RESPONSE' "agy-eval: unwrapped response reaches the raw log"

# --- failure scenarios: run.log bytes and failure_cause must equal the pre-BL-0302 (text transport) harness ---
# Each harness runs from a throw-away tree (symlinks to the repo, REPO_ROOT = ../.. of the harness copy), so the
# base harness (git show a10bceef5:...) and the HEAD harness each see the repo, and EVAL_HELPER can swap the helper.
HELPER_REAL="$REPO_ROOT/scripts/lib/agy-stream-json.js"
HELPER_USE="${EVAL_HELPER:-$HELPER_REAL}"
build_tree() { # <name> <harness file> -> echoes the harness path inside the tree
  local t="$TEST_TMP/tree-$1" e
  mkdir -p "$t/evals/orchestration" "$t/scripts/lib"
  for e in "$REPO_ROOT"/* "$REPO_ROOT"/.[!.]*; do
    case "$(basename "$e")" in .git|evals|scripts) continue ;; esac
    ln -s "$e" "$t/$(basename "$e")"
  done
  for e in "$REPO_ROOT"/evals/*; do [ "$(basename "$e")" = orchestration ] || ln -s "$e" "$t/evals/$(basename "$e")"; done
  for e in "$REPO_ROOT"/evals/orchestration/*; do ln -s "$e" "$t/evals/orchestration/$(basename "$e")"; done
  for e in "$REPO_ROOT"/scripts/*; do [ "$(basename "$e")" = lib ] || ln -s "$e" "$t/scripts/$(basename "$e")"; done
  for e in "$REPO_ROOT"/scripts/lib/*; do ln -s "$e" "$t/scripts/lib/$(basename "$e")"; done
  rm -f "$t/scripts/lib/agy-stream-json.js" "$t/evals/orchestration/run-orchestration-eval.sh"
  cp "$HELPER_USE" "$t/scripts/lib/agy-stream-json.js"
  cp "$2" "$t/evals/orchestration/run-orchestration-eval.sh"
  echo "$t/evals/orchestration/run-orchestration-eval.sh"
}
git -C "$REPO_ROOT" show a10bceef5:evals/orchestration/run-orchestration-eval.sh >"$TEST_TMP/base-harness.sh" 2>/dev/null || fail "cannot read the base harness from a10bceef5"
BASE_H="$(build_tree base "$TEST_TMP/base-harness.sh")"
HEAD_H="$(build_tree head "$HARNESS")"
run_mode() { # <label> <harness> <mode> -> sets CAUSE, RUNLOG_FILE
  local o="$TEST_TMP/out-$1-$3"; mkdir -p "$o"
  FAKE_MODE="$3" timeout 300 bash "$2" --task t1-fix-with-decoy --arm on --runner agy --model fake-model --out "$o" >"$TEST_TMP/run-$1-$3.log" 2>&1 </dev/null || true
  CAUSE="$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).failure_cause))}catch(e){process.stdout.write("NO-RESULT")}' "$o/result.json")"
  RUNLOG_FILE="$o/run.log"
}
for m in auth exit3 empty ws nl ok; do
  run_mode base "$BASE_H" "$m"; BASE_CAUSE="$CAUSE"; BASE_LOG="$RUNLOG_FILE"
  run_mode head "$HEAD_H" "$m"; HEAD_CAUSE="$CAUSE"; HEAD_LOG="$RUNLOG_FILE"
  assert_eq "$BASE_CAUSE" "$HEAD_CAUSE" "agy-eval[$m]: failure_cause equals the text-transport harness ($BASE_CAUSE)"
  if cmp -s "$BASE_LOG" "$HEAD_LOG"; then pass_msg=1; else pass_msg=0; fi
  assert_eq "1" "$pass_msg" "agy-eval[$m]: run.log is byte-identical to the text-transport harness (base: $(od -An -c "$BASE_LOG" | tr -s ' ' | head -c 80) | head: $(od -An -c "$HEAD_LOG" | tr -s ' ' | head -c 80))"
done
assert_eq "authentication" "$(run_mode head "$HEAD_H" auth; echo "$CAUSE")" "agy-eval: auth scenario really classifies as authentication"

# --- helper level: exit code passthrough and the --text-compat contract ---
HELPER="$REPO_ROOT/scripts/lib/agy-stream-json.js"
printf 'p' >"$TEST_TMP/p.txt"
FAKE_MODE=exit3 node "$HELPER" run --text-compat --prompt-file "$TEST_TMP/p.txt" -- agy >"$TEST_TMP/h.out" 2>/dev/null; HRC=$?
assert_eq "3" "$HRC" "helper --text-compat: agy exit code passed through"
assert_eq "some diagnostic" "$(cat "$TEST_TMP/h.out")" "helper --text-compat: the failing result's text is replayed on failure"
FAKE_MODE=exit3 node "$HELPER" run --prompt-file "$TEST_TMP/p.txt" -- agy >"$TEST_TMP/h2.out" 2>/dev/null; HRC=$?
assert_eq "3" "$HRC" "helper default: exit code passed through"
assert_eq "" "$(cat "$TEST_TMP/h2.out")" "helper default: stdout stays empty on failure (unchanged)"
FAKE_MODE=empty node "$HELPER" run --prompt-file "$TEST_TMP/p.txt" -- agy >/dev/null 2>&1; HRC=$?
assert_eq "1" "$HRC" "helper default: empty SUCCESS still exits 1 (unchanged)"
FAKE_MODE=empty node "$HELPER" run --text-compat --prompt-file "$TEST_TMP/p.txt" -- agy >/dev/null 2>&1; HRC=$?
assert_eq "0" "$HRC" "helper --text-compat: empty SUCCESS exits 0"
assert_eq "FAKE-AGY-RESPONSE" "$(node "$HELPER" run --prompt-file "$TEST_TMP/p.txt" -- agy 2>/dev/null)" "helper default: response unchanged"
assert_eq "18" "$(node "$HELPER" run --text-compat --prompt-file "$TEST_TMP/p.txt" -- agy 2>/dev/null | wc -c | tr -d ' ')" "helper --text-compat: response is followed by one newline"
assert_eq "17" "$(node "$HELPER" run --prompt-file "$TEST_TMP/p.txt" -- agy 2>/dev/null | wc -c | tr -d ' ')" "helper default: no added newline"
finalize_test
