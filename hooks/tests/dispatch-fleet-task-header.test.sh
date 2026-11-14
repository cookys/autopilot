#!/usr/bin/env bash
# S2 X-Fleet-Task gateway join (2026-11-14): gateway-bound dispatch requests carry
# `X-Fleet-Task: <ULID>` from AUTOPILOT_UPSTREAM_TASK_ID (validated once in
# scripts/lib/fleet-task-header.js). Covered here:
#   (1) dispatch-anthropic-review.js — header on the wire via a local http server
#       (valid ULID -> exact id; unset -> absent; invalid -> absent + the stderr refusal).
#   (2) dispatch-review.sh cc-shim — the claude child's ANTHROPIC_CUSTOM_HEADERS is exactly
#       the X-Fleet-Task line (stub claude dumps its env).
#   (3) dispatch-author.sh cc-shim — same.
# The dispatch-hetero.sh cc-shim cases (valid/unset+inherited/invalid+stderr) live in
# dispatch-hetero-ccshim-usage.test.sh; the claude-native no-header pin lives in
# dispatch-hetero-claude-native.test.sh.
. "$(dirname "$0")/lib.sh"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
export AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_UPSTREAM_TASK_ID ANTHROPIC_CUSTOM_HEADERS 2>/dev/null || true
ULID_OK="01ARZ3NDEKTSV4RRFFQ69G5FAV"

# --- (1) dispatch-anthropic-review.js: header on the wire ---
JS="$REPO_ROOT/scripts/dispatch-anthropic-review.js"
DIFF="$TEST_TMP/d.diff"; printf 'diff --git a/x b/x\n+x\n' > "$DIFF"
LOG="$TEST_TMP/headers.log"; PORTF="$TEST_TMP/port"; PIDF="$TEST_TMP/pid"; ERRF="$TEST_TMP/anthropic-stderr"
node - "$LOG" "$PORTF" "$PIDF" <<'NODE' &
const fs = require('fs'), http = require('http');
const [logPath, portPath, pidPath] = process.argv.slice(2);
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    fs.appendFileSync(logPath, `[xft=${req.headers['x-fleet-task'] === undefined ? 'absent' : req.headers['x-fleet-task']}]\n`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'VERDICT: SHIP\nFINDINGS:\nnone\n' }] }));
  });
}).listen(0, '127.0.0.1', function () {
  fs.writeFileSync(portPath, String(this.address().port)); fs.writeFileSync(pidPath, String(process.pid));
});
NODE
W=0; while { [ ! -f "$PORTF" ] || [ ! -f "$PIDF" ]; } && [ "$W" -lt 50 ]; do sleep 0.1; W=$((W+1)); done
PORT="$(cat "$PORTF")"; MPID="$(cat "$PIDF")"
anth() { env -u AUTOPILOT_SESSION_ID ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="tok-xft" \
  AUTOPILOT_UPSTREAM_TASK_ID="${1-}" node "$JS" --model GLM-5 --diff-file "$DIFF" > /dev/null 2>"$ERRF" < /dev/null; }

# valid ULID -> the wire header is exactly the id (red at base: absent)
: > "$LOG"; anth "$ULID_OK"
assert_eq "[xft=$ULID_OK]" "$(cat "$LOG")" "(1a) a valid ULID puts X-Fleet-Task: <V> on the anthropic-compatible request"
# unset -> absent (preservation)
: > "$LOG"; anth ""
assert_eq "[xft=absent]" "$(cat "$LOG")" "(1b) an unset/empty id sends no X-Fleet-Task"
# invalid -> absent + the one stderr refusal line (red at base: no warning exists)
: > "$LOG"; : > "$ERRF"; anth $'01ABC\nX-Evil: 1'
assert_eq "[xft=absent]" "$(cat "$LOG")" "(1c) a non-ULID id sends no X-Fleet-Task"
assert_contains "$(cat "$ERRF")" "dispatch-anthropic-review: AUTOPILOT_UPSTREAM_TASK_ID is not a ULID; X-Fleet-Task not sent" \
  "(1c) the refusal is named on stderr"
kill "$MPID" 2>/dev/null

# --- (2)+(3) cc-shim rails: the claude child's ANTHROPIC_CUSTOM_HEADERS ---
ENVF="$TEST_TMP/cc-env.txt"
# review stub (review-c pattern): dumps its ANTHROPIC_CUSTOM_HEADERS, echoes the nonce-wrapped verdict.
cat > "$TEST_TMP/claude-review" <<EOF
#!/usr/bin/env bash
printf '%s' "\${ANTHROPIC_CUSTOM_HEADERS-@UNSET@}" > "$ENVF"
PROMPT="\$(cat)"
begin="\$(printf '%s\n' "\$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)\$/\1/p' | sed -n '1p')"
end="\$(printf '%s\n' "\$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)\$/\1/p' | sed -n '1p')"
echo "\$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: checked=fixture; evidence=slice traced; conclusion=no concrete blocking discrepancy observed"
echo "\$end"
EOF
chmod +x "$TEST_TMP/claude-review"
# author stub: dumps its ANTHROPIC_CUSTOM_HEADERS, then echoes the nonce-framed draft the
# rail requires (AUTHOR markers come from the stdin prompt; dispatch-author.test.sh pattern).
cat > "$TEST_TMP/claude-author" <<EOF
#!/usr/bin/env bash
printf '%s' "\${ANTHROPIC_CUSTOM_HEADERS-@UNSET@}" > "$ENVF"
PROMPT="\$(cat)"
begin="\$(printf '%s\n' "\$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-AUTHOR-[0-9a-f]\{32\}>>>\)\$/\1/p' | sed -n '1p')"
end="\$(printf '%s\n' "\$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)\$/\1/p' | sed -n '1p')"
printf '%s\n%s\n%s\n' "\$begin" "one authored line" "\$end"
EOF
chmod +x "$TEST_TMP/claude-author"
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"

# dispatch-review.sh cc-shim (red at base: the child saw @UNSET@, not the header line)
: > "$ENVF"
OUT="$(env -u AUTOPILOT_SESSION_ID AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" AUTOPILOT_SETTLE_MS=0 \
  bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner cc-shim --model mini --endpoint TESTEP \
  --diff-file "$DIFF" --bin "$TEST_TMP/claude-review" --timeout 30s 2>&1 < /dev/null)"; EXIT=$?
assert_eq "0" "$EXIT" "(2) dispatch-review cc-shim run exit 0 (out tail: $(printf '%s' "$OUT" | tail -c 200))"
assert_eq "X-Fleet-Task: $ULID_OK" "$(cat "$ENVF")" \
  "(2) dispatch-review cc-shim child env is exactly 'X-Fleet-Task: <V>' (got: '$(cat "$ENVF")')"

# dispatch-author.sh cc-shim (red at base: the child saw @UNSET@). Runs inside a scratch git repo.
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false init -q
git -C "$SBX" -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"; printf 'write one line\n' > "$PROMPT"
: > "$ENVF"
OUT="$(cd "$SBX" && env -u AUTOPILOT_SESSION_ID AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" \
  ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="t" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 \
  bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner cc-shim --model mini \
  --prompt-file "$PROMPT" --bin "$TEST_TMP/claude-author" --timeout 30s 2>&1 < /dev/null)"; EXIT=$?
assert_eq "0" "$EXIT" "(3) dispatch-author cc-shim run exit 0 (out tail: $(printf '%s' "$OUT" | tail -c 200))"
assert_eq "X-Fleet-Task: $ULID_OK" "$(cat "$ENVF")" \
  "(3) dispatch-author cc-shim child env is exactly 'X-Fleet-Task: <V>' (got: '$(cat "$ENVF")')"

finalize_test
