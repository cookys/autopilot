#!/usr/bin/env bash
# agy-remaining-stdin.test.sh — BL-0298: the agy call sites that used to put the prompt on argv now go
# through lib/agy-stream-json.js (prompt as one stream-json line on stdin). A recording fake agy captures
# argv and stdin for each site; the prompt text must be on stdin and absent from argv.
#   sites: probe-engine-capability.sh (agy), qc-panel.js (judge B)
#   (run-orchestration-eval.sh moved to the same transport in BL-0302: see orchestration-eval-agy-stdin.test.sh)
#   (probe-harness-capabilities.sh is covered by probe-harness-capabilities-agy-alias.test.sh,
#    qualification-review-provider.js by scripts/qualification-review-provider.test.js)
# Negative control: AGY_REMAINING_NEGCTL=1 makes the fake reject any run that is NOT stdin transport
# (it demands a -p on argv), and the suite asserts that this turns the sites red.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"

BIN="$TEST_TMP/bin"; REC="$TEST_TMP/rec"; mkdir -p "$BIN" "$REC"
cat > "$BIN/agy" <<'EOF'
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('1.4.6'); process.exit(0); }
if (a[0] === 'models') {
  console.log('gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)\ngemini-3.7-flash-high\tGemini 3.7 Flash (High)');
  process.exit(0);
}
const rec = process.env.REC;
const n = `${Date.now()}-${process.pid}`;
const stdin = fs.readFileSync(0);
fs.writeFileSync(`${rec}/${n}.argv`, JSON.stringify(a));
fs.writeFileSync(`${rec}/${n}.stdin`, stdin);
if (process.env.FAKE_AGY_MODE === 'fail') { process.stderr.write('fake agy failure\n'); process.exit(7); }
if (process.env.AGY_REMAINING_NEGCTL === '1' && !a.includes('-p')) { process.stderr.write('negctl: demands argv transport\n'); process.exit(2); }
try { fs.writeFileSync('verdict.txt', 'ACHIEVED: goal-1 done (agy)\n'); } catch (_e) { /* cwd may be read-only */ }
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'OK' } }));
EOF
chmod +x "$BIN/agy"
export PATH="$BIN:$PATH" REC

last_rec() { /bin/ls -t "$REC"/*.argv 2>/dev/null | head -1; }
clear_rec() { rm -f "$REC"/*; }

# ── 1. probe-engine-capability.sh ────────────────────────────────────────────
clear_rec
OUT="$(bash "$REPO_ROOT/scripts/probe-engine-capability.sh" quota --runner agy --model "Gemini 3.7 Flash (High)" --live-spend --store "$TEST_TMP/s1.jsonl" 2>&1)"
A="$(last_rec)"
assert_contains "$OUT" '"status":"available"' "probe-engine: agy live probe succeeds through the stdin transport"
assert_contains "$(cat "${A%.argv}.stdin")" '"content":"Respond only with OK"' "probe-engine: the prompt arrives on stdin as stream-json"
assert_not_contains "$(cat "$A")" "Respond only" "probe-engine: argv carries no prompt text"
assert_not_contains "$(cat "$A")" '"-p"' "probe-engine: argv has no -p"
assert_contains "$(cat "$A")" '"--print="' "probe-engine: argv carries --print= (with the =)"

# terminal path: agy exits non-zero -> the probe does not report available; no temp residue in the probe dir
clear_rec
OUT="$(FAKE_AGY_MODE=fail bash "$REPO_ROOT/scripts/probe-engine-capability.sh" quota --runner agy --model "Gemini 3.7 Flash (High)" --live-spend --store "$TEST_TMP/s2.jsonl" 2>&1)"
assert_not_contains "$OUT" '"status":"available"' "probe-engine: agy exit 7 is not reported as available"

# NEGATIVE CONTROL: with a fake that demands argv transport, the stdin site must go red.
clear_rec
OUT="$(AGY_REMAINING_NEGCTL=1 bash "$REPO_ROOT/scripts/probe-engine-capability.sh" quota --runner agy --model "Gemini 3.7 Flash (High)" --live-spend --store "$TEST_TMP/s3.jsonl" 2>&1)"
assert_not_contains "$OUT" '"status":"available"' "NEGATIVE CONTROL probe-engine: an argv-demanding agy turns the stdin transport red"

# ── 2. qc-panel.js judge B ───────────────────────────────────────────────────
CLAUDE_STUB="$TEST_TMP/claude-stub"
printf '#!/usr/bin/env bash\ncat >/dev/null\nprintf "ACHIEVED: goal-1 done\\n"\n' > "$CLAUDE_STUB"; chmod +x "$CLAUDE_STUB"
REPORT="$TEST_TMP/report.json"
printf '%s\n' '{"node":"n1","verdict":"pass","confidence":0.9,"evidence_pointers":["scripts/tree.js:1-10@HEAD"],"artifact_paths":[],"doa_log":[],"escalations":[]}' > "$REPORT"
ART="$TEST_TMP/artifact.txt"; printf 'build output: success\n' > "$ART"
run_qc() { # $@ extra env assignments
  clear_rec
  env "$@" QC_CLAUDE_BIN="$CLAUDE_STUB" QC_AGY_BIN="$BIN/agy" CALIBRATION_DATA_DIR="$TEST_TMP/cal" \
    node "$REPO_ROOT/scripts/qc-panel.js" --report "$REPORT" --artifacts "$ART" --out "$TEST_TMP/qc-out-$RANDOM" --node n1 >"$TEST_TMP/qc.out" 2>&1
}
run_qc FAKE_AGY_MODE=ok; QC_RC=$?; [ "$QC_RC" = 0 ] || head -5 "$TEST_TMP/qc.out" >&2
assert_eq "$QC_RC" "0" "qc-panel: panel completes with a stdin-transport judge B"
N_REC="$(/bin/ls "$REC"/*.argv | wc -l | tr -d ' ')"
assert_eq "$N_REC" "3" "qc-panel: three judge-B calls reached agy"
A="$(last_rec)"
assert_contains "$(cat "${A%.argv}.stdin")" "You are a code review judge" "qc-panel: the judge prompt arrives on stdin"
assert_not_contains "$(cat "$A")" "code review judge" "qc-panel: argv carries no judge prompt"
assert_not_contains "$(cat "$A")" '"-p"' "qc-panel: argv has no -p"
# terminal path: agy fails -> all judge-B calls reported failed, panel exits non-zero (as before the change)
run_qc FAKE_AGY_MODE=fail; QC_RC=$?
assert_neq "0" "$QC_RC" "qc-panel: failing agy judge still fails the panel"
# oversize: fail closed with the named reason, agy not spawned
BIGART="$TEST_TMP/big.txt"; head -c 10 /dev/zero | tr '\0' 'x' > "$BIGART"
QC_RC=0; clear_rec
env AUTOPILOT_AGY_STDIN_MAX_BYTES=50 QC_CLAUDE_BIN="$CLAUDE_STUB" QC_AGY_BIN="$BIN/agy" CALIBRATION_DATA_DIR="$TEST_TMP/cal" \
  node "$REPO_ROOT/scripts/qc-panel.js" --report "$REPORT" --artifacts "$ART" --out "$TEST_TMP/qc-out-big" --node n1 >"$TEST_TMP/qc-big.out" 2>&1 || QC_RC=$?
assert_neq "0" "$QC_RC" "qc-panel: a prompt over the stdin ceiling fails the panel"
assert_eq "$(/bin/ls "$REC"/*.argv 2>/dev/null | wc -l | tr -d ' ')" "0" "qc-panel: an over-ceiling prompt never spawns agy"
# NEGATIVE CONTROL
run_qc AGY_REMAINING_NEGCTL=1 FAKE_AGY_MODE=ok; QC_RC=$?
assert_neq "0" "$QC_RC" "NEGATIVE CONTROL qc-panel: an argv-demanding agy turns the stdin transport red"

finalize_test
