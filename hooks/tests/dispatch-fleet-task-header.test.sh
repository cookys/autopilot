#!/usr/bin/env bash
# S2 X-Fleet-Task gateway join (2026-11-14): gateway-bound dispatch requests carry
# `X-Fleet-Task: <ULID>` from AUTOPILOT_UPSTREAM_TASK_ID (validated once in
# scripts/lib/fleet-task-header.js). S2 round 2 (2026-11-14): the header goes ONLY to
# endpoints allowlisted as fleet gateways (AUTOPILOT_FLEET_GATEWAY_ENDPOINTS, comma-
# separated, case-insensitive; empty = no endpoint is a gateway). Covered here:
#   (1) dispatch-anthropic-review.js — header on the wire via a local http server
#       (allowlisted + valid ULID -> exact id; unset -> absent; invalid -> absent + the
#       stderr refusal; NOT allowlisted / allowlist names another endpoint / no endpoint
#       name -> absent with NO warning).
#   (2) dispatch-review.sh cc-shim — the claude child's ANTHROPIC_CUSTOM_HEADERS is exactly
#       the X-Fleet-Task line (stub claude dumps its env); allowlist names another
#       endpoint -> absent.
#   (3) dispatch-author.sh cc-shim — same, including the not-allowlisted negative.
# The dispatch-hetero.sh cc-shim cases (valid/unset+inherited/invalid+stderr/not-allowlisted/
# case-insensitive) live in dispatch-hetero-ccshim-usage.test.sh; the claude-native no-header
# pin lives in dispatch-hetero-claude-native.test.sh.
. "$(dirname "$0")/lib.sh"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
export AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_UPSTREAM_TASK_ID ANTHROPIC_CUSTOM_HEADERS \
  AUTOPILOT_FLEET_GATEWAY_ENDPOINTS AUTOPILOT_FLEET_TASK_ENDPOINT 2>/dev/null || true
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
# anth <task-id> [endpoint-name] [allowlist]: runs dispatch-anthropic-review.js against the
# local server. The endpoint name rides AUTOPILOT_FLEET_TASK_ENDPOINT (what dispatch-review.sh
# / dispatch-author.sh set from their --endpoint). The allowlist defaults to EMPTY — set-but-
# empty wins over any host config.json, so the negative cases are hermetic.
anth() { env -u AUTOPILOT_SESSION_ID ANTHROPIC_COMPATIBLE_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_COMPATIBLE_AUTH_TOKEN="tok-xft" \
  AUTOPILOT_UPSTREAM_TASK_ID="${1-}" AUTOPILOT_FLEET_TASK_ENDPOINT="${2-}" AUTOPILOT_FLEET_GATEWAY_ENDPOINTS="${3-}" \
  node "$JS" --model GLM-5 --diff-file "$DIFF" > /dev/null 2>"$ERRF" < /dev/null; }

# allowlisted endpoint + valid ULID -> the wire header is exactly the id
: > "$LOG"; anth "$ULID_OK" testep testep
assert_eq "[xft=$ULID_OK]" "$(cat "$LOG")" "(1a) a valid ULID on an allowlisted endpoint puts X-Fleet-Task: <V> on the anthropic-compatible request"
# unset -> absent (preservation)
: > "$LOG"; anth "" testep testep
assert_eq "[xft=absent]" "$(cat "$LOG")" "(1b) an unset/empty id sends no X-Fleet-Task"
# invalid -> absent + the one stderr refusal line (the endpoint IS a gateway, so the refusal is named)
: > "$LOG"; : > "$ERRF"; anth $'01ABC\nX-Evil: 1' testep testep
assert_eq "[xft=absent]" "$(cat "$LOG")" "(1c) a non-ULID id sends no X-Fleet-Task"
assert_contains "$(cat "$ERRF")" "dispatch-anthropic-review: AUTOPILOT_UPSTREAM_TASK_ID is not a ULID; X-Fleet-Task not sent" \
  "(1c) the refusal is named on stderr"
# valid ULID + endpoint NOT allowlisted (cloud-looking name glm, https URL) -> absent, and no
# warning line: not a gateway is the normal case. Red at 2180f0238: the header was present.
: > "$LOG"; : > "$ERRF"; anth "$ULID_OK" glm ""
assert_eq "[xft=absent]" "$(cat "$LOG")" "(1d) a valid ULID on a non-allowlisted endpoint (glm) sends no X-Fleet-Task"
assert_not_contains "$(cat "$ERRF")" "X-Fleet-Task not sent" "(1d) not-allowlisted is the normal case: no warning line"
# valid ULID + the allowlist names a DIFFERENT endpoint -> absent. Red at 2180f0238: present.
: > "$LOG"; anth "$ULID_OK" glm testep
assert_eq "[xft=absent]" "$(cat "$LOG")" "(1e) an allowlist naming a different endpoint sends no X-Fleet-Task"
# valid ULID + no endpoint name at all (raw ANTHROPIC_COMPATIBLE_BASE_URL) -> absent.
# Red at 2180f0238: present.
: > "$LOG"; anth "$ULID_OK" "" testep
assert_eq "[xft=absent]" "$(cat "$LOG")" "(1f) a run with no endpoint name never sends X-Fleet-Task"
# case-insensitive allowlist matching (QWEN_LOCAL vs qwen_local)
: > "$LOG"; anth "$ULID_OK" qwen_local QWEN_LOCAL
assert_eq "[xft=$ULID_OK]" "$(cat "$LOG")" "(1g) allowlist matching is case-insensitive (QWEN_LOCAL vs qwen_local)"
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

# dispatch-review.sh cc-shim: allowlisted --endpoint -> the child env is exactly the header line.
: > "$ENVF"
OUT="$(env -u AUTOPILOT_SESSION_ID AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" AUTOPILOT_SETTLE_MS=0 \
  AUTOPILOT_FLEET_GATEWAY_ENDPOINTS=TESTEP \
  bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner cc-shim --model mini --endpoint TESTEP \
  --diff-file "$DIFF" --bin "$TEST_TMP/claude-review" --timeout 30s 2>&1 < /dev/null)"; EXIT=$?
assert_eq "0" "$EXIT" "(2a) dispatch-review cc-shim run exit 0 (out tail: $(printf '%s' "$OUT" | tail -c 200))"
assert_eq "X-Fleet-Task: $ULID_OK" "$(cat "$ENVF")" \
  "(2a) dispatch-review cc-shim child env is exactly 'X-Fleet-Task: <V>' (got: '$(cat "$ENVF")')"
# same run with the allowlist naming a DIFFERENT endpoint -> no header, no warning.
# Red at 2180f0238: the child saw the header line.
: > "$ENVF"
OUT="$(env -u AUTOPILOT_SESSION_ID AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" AUTOPILOT_SETTLE_MS=0 \
  AUTOPILOT_FLEET_GATEWAY_ENDPOINTS=OTHER_EP \
  bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner cc-shim --model mini --endpoint TESTEP \
  --diff-file "$DIFF" --bin "$TEST_TMP/claude-review" --timeout 30s 2>&1 < /dev/null)"; EXIT=$?
assert_eq "0" "$EXIT" "(2b) dispatch-review cc-shim run exit 0 with a non-matching allowlist (out tail: $(printf '%s' "$OUT" | tail -c 200))"
assert_eq "@UNSET@" "$(cat "$ENVF")" \
  "(2b) allowlist naming a different endpoint -> no X-Fleet-Task in the child env (got: '$(cat "$ENVF")')"
assert_not_contains "$OUT" "X-Fleet-Task not sent" "(2b) no warning line: not allowlisted is the normal case"

# dispatch-author.sh cc-shim: allowlisted --endpoint -> header; not allowlisted -> absent.
# Runs inside a scratch git repo.
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false init -q
git -C "$SBX" -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"; printf 'write one line\n' > "$PROMPT"
: > "$ENVF"
OUT="$(cd "$SBX" && env -u AUTOPILOT_SESSION_ID AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" \
  ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="t" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 \
  AUTOPILOT_FLEET_GATEWAY_ENDPOINTS=TESTEP \
  bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner cc-shim --model mini --endpoint TESTEP \
  --prompt-file "$PROMPT" --bin "$TEST_TMP/claude-author" --timeout 30s 2>&1 < /dev/null)"; EXIT=$?
assert_eq "0" "$EXIT" "(3a) dispatch-author cc-shim run exit 0 (out tail: $(printf '%s' "$OUT" | tail -c 200))"
assert_eq "X-Fleet-Task: $ULID_OK" "$(cat "$ENVF")" \
  "(3a) dispatch-author cc-shim child env is exactly 'X-Fleet-Task: <V>' (got: '$(cat "$ENVF")')"
# not allowlisted (cloud-looking glm) -> no header, no warning. Red at 2180f0238: present.
: > "$ENVF"
OUT="$(cd "$SBX" && env -u AUTOPILOT_SESSION_ID AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" \
  ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="t" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 \
  AUTOPILOT_FLEET_GATEWAY_ENDPOINTS=OTHER_EP \
  bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner cc-shim --model mini --endpoint TESTEP \
  --prompt-file "$PROMPT" --bin "$TEST_TMP/claude-author" --timeout 30s 2>&1 < /dev/null)"; EXIT=$?
assert_eq "0" "$EXIT" "(3b) dispatch-author cc-shim run exit 0 with a non-matching allowlist (out tail: $(printf '%s' "$OUT" | tail -c 200))"
assert_eq "@UNSET@" "$(cat "$ENVF")" \
  "(3b) allowlist naming a different endpoint -> no X-Fleet-Task in the child env (got: '$(cat "$ENVF")')"
assert_not_contains "$OUT" "X-Fleet-Task not sent" "(3b) no warning line: not allowlisted is the normal case"

finalize_test
