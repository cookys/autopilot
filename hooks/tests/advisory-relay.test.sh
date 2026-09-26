#!/usr/bin/env bash
# RED at ae262ac9: suite missing; group-S hooks do not enqueue; advisory-relay.js absent
# advisory-relay + group-S Stop queue (ha-p2). Isolated HOME / TMPDIR / XDG_RUNTIME_DIR / AUTOPILOT_LIVE_DIR.
. "$(dirname "$0")/lib.sh"

export HOME="$HOOK_HOME"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
LIVE_DIR="$(mktemp -d /dev/shm/ap-adv-live-XXXXXX 2>/dev/null || mktemp -d "$TEST_TMP/live-XXXXXX")"
chmod 700 "$LIVE_DIR"
export AUTOPILOT_LIVE_DIR="$LIVE_DIR"
unset AUTOPILOT_ADVISORY_RELAY

queue_path() {
  node -e '
    const path = require("path");
    const { resolveLiveDir, sanitizeSessionId } = require(process.argv[1]);
    const sid = process.argv[2];
    const q = path.join(resolveLiveDir().base, "advisory-queue", sanitizeSessionId(sid) + ".jsonl");
    process.stdout.write(q);
  ' "$REPO_ROOT/scripts/lib/live-state-dir.js" "$1"
}

queue_text_of() {
  local f="$1"
  [ -f "$f" ] || { echo ""; return; }
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    const texts = lines.map((l) => JSON.parse(l).text);
    process.stdout.write(texts.join("\n"));
  ' "$f"
}

# ── cost-tracker enqueues ────────────────────────────────────────────────────
CT_SID="adv-ct-session"
TR="$TEST_TMP/transcript.jsonl"
turn() {
  printf '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":0}}}\n' "$2" "$3" "$1"
}
ct_payload() {
  printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$1" "$TR" "$TEST_TMP"
}
export AUTOPILOT_COST_TRACKER_CACHE_READ_WARN=1000
unset AUTOPILOT_HOOK_COST_TRACKER AUTOPILOT_COST_TRACKER
{ turn 400 10 5; turn 700 10 5; } > "$TR"
run_hook cost-tracker.js "$(ct_payload "$CT_SID")"
assert_eq 0 "$__RUN_EXIT" "cost-tracker advisory exit 0"
assert_contains "$__RUN_STDERR" 'cost-tracker: session adv-ct-session has read 1,100 cache tokens' "cost-tracker stderr unchanged"
assert_not_contains "$__RUN_STDOUT" 'hookSpecificOutput' "cost-tracker stdout has no hookSpecificOutput"
assert_not_contains "$__RUN_STDOUT" 'additionalContext' "cost-tracker stdout has no additionalContext"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "cost-tracker stdout has no permissionDecision"
CT_Q="$(queue_path "$CT_SID")"
assert_file_exists "$CT_Q" "cost-tracker wrote queue file"
QTEXT="$(queue_text_of "$CT_Q")"
# stderr write includes trailing newline; queue text is that string minus trailing newline
CT_EXPECT="${__RUN_STDERR%$'\n'}"
assert_eq "$QTEXT" "$CT_EXPECT" "cost-tracker queue text byte-identical to stderr"

# ── check-console enqueues ───────────────────────────────────────────────────
CC_REPO="$TEST_TMP/cc-repo"
mkdir -p "$CC_REPO"
(
  cd "$CC_REPO"
  git init -q
  git config user.email t@t.t
  git config user.name t
  printf 'const a = 1;\n' > app.js
  git add app.js
  git commit -q -m init
  printf 'console.log(1);\n' > app.js
)
export AUTOPILOT_HOOK_CHECK_CONSOLE=1
CC_SID="adv-cc-session"
CC_PAYLOAD="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$CC_SID")"
CC_OUT="$TEST_TMP/cc.out"
CC_ERR="$TEST_TMP/cc.err"
(
  cd "$CC_REPO"
  HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    AUTOPILOT_LIVE_DIR="$AUTOPILOT_LIVE_DIR" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    AUTOPILOT_HOOK_CHECK_CONSOLE=1 \
    node "$HOOKS_DIR/check-console.js" >"$CC_OUT" 2>"$CC_ERR" <<< "$CC_PAYLOAD"
)
CC_EXIT=$?
assert_eq 0 "$CC_EXIT" "check-console advisory exit 0"
assert_contains "$(cat "$CC_ERR")" 'console.log found in modified files' "check-console stderr warning"
assert_not_contains "$(cat "$CC_OUT")" 'additionalContext' "check-console no additionalContext"
assert_not_contains "$(cat "$CC_OUT")" 'permissionDecision' "check-console no permissionDecision"
CC_Q="$(queue_path "$CC_SID")"
assert_file_exists "$CC_Q" "check-console wrote queue file"
CC_QTEXT="$(queue_text_of "$CC_Q")"
CC_EXPECT="$(cat "$CC_ERR")"
CC_EXPECT="${CC_EXPECT%$'\n'}"
assert_eq "$CC_QTEXT" "$CC_EXPECT" "check-console queue text matches stderr"

# ── batch-format enqueues ────────────────────────────────────────────────────
BF_REPO="$TEST_TMP/bf-repo"
mkdir -p "$BF_REPO/node_modules/.bin"
printf '#!/bin/sh\necho "prettier-w" >&2\n' > "$BF_REPO/node_modules/.bin/prettier"
chmod +x "$BF_REPO/node_modules/.bin/prettier"
printf 'const z = 1;\n' > "$BF_REPO/keep.js"
BF_SID="adv-bf-session"
# list file name uses env session id sanitization in getSessionId()
export CLAUDE_CODE_SESSION_ID="$BF_SID"
printf '%s\n' "$BF_REPO/keep.js" > "$HOOK_TMPDIR/claude-edited-${BF_SID}.txt"
export AUTOPILOT_HOOK_BATCH_FORMAT=1
BF_PAYLOAD="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$BF_SID")"
BF_OUT="$TEST_TMP/bf.out"
BF_ERR="$TEST_TMP/bf.err"
(
  cd "$BF_REPO"
  HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    AUTOPILOT_LIVE_DIR="$AUTOPILOT_LIVE_DIR" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    AUTOPILOT_HOOK_BATCH_FORMAT=1 CLAUDE_CODE_SESSION_ID="$BF_SID" \
    node "$HOOKS_DIR/batch-format.js" >"$BF_OUT" 2>"$BF_ERR" <<< "$BF_PAYLOAD"
)
BF_EXIT=$?
assert_eq 0 "$BF_EXIT" "batch-format advisory exit 0"
assert_contains "$(cat "$BF_ERR")" 'Prettier warnings:' "batch-format stderr"
assert_not_contains "$(cat "$BF_OUT")" 'additionalContext' "batch-format no additionalContext"
assert_not_contains "$(cat "$BF_OUT")" 'permissionDecision' "batch-format no permissionDecision"
BF_Q="$(queue_path "$BF_SID")"
assert_file_exists "$BF_Q" "batch-format wrote queue file"
BF_QTEXT="$(queue_text_of "$BF_Q")"
BF_EXPECT="$(cat "$BF_ERR")"
BF_EXPECT="${BF_EXPECT%$'\n'}"
assert_eq "$BF_QTEXT" "$BF_EXPECT" "batch-format queue text matches stderr"
unset CLAUDE_CODE_SESSION_ID AUTOPILOT_HOOK_BATCH_FORMAT AUTOPILOT_HOOK_CHECK_CONSOLE

# ── missing/empty session_id ⇒ no enqueue ────────────────────────────────────
MISS_DIR="$(dirname "$(queue_path 'should-not-exist')")"
rm -f "$MISS_DIR"/*.jsonl 2>/dev/null || true
{ turn 400 10 5; turn 700 10 5; } > "$TR"
# new cost-tracker session so watermark fires; empty session_id
printf '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":400,"cache_creation_input_tokens":0}}}\n' > "$TR"
printf '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":700,"cache_creation_input_tokens":0}}}\n' >> "$TR"
run_hook cost-tracker.js "$(printf '{"session_id":"","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$TR" "$TEST_TMP")"
assert_eq 0 "$__RUN_EXIT" "empty session_id still exit 0"
assert_contains "$__RUN_STDERR" 'cost-tracker: session' "empty session_id still warns on stderr"
# sanitized empty would be 'unknown' — must not create that file either
UNK="$(queue_path 'unknown')"
# queue_path('unknown') uses sanitize of literal 'unknown', not empty. Empty skip means no file for unknown from empty sid.
assert_file_absent "$UNK" "empty session_id did not enqueue unknown.jsonl"
# also no empty-named file
assert_eq "$(find "$MISS_DIR" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')" "0" "no queue files after empty session_id" || true
if [ -d "$MISS_DIR" ]; then
  leftover="$(find "$MISS_DIR" -name '*.jsonl' -print)"
  assert_eq "$leftover" "" "queue dir has no jsonl after empty session_id"
fi

# ── delivery once + no double delivery ───────────────────────────────────────
DEL_SID="adv-deliver"
DEL_Q="$(queue_path "$DEL_SID")"
mkdir -p "$(dirname "$DEL_Q")"
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
printf '%s\n' "{\"ts\":\"$NOW\",\"source\":\"cost-tracker\",\"text\":\"first-line\"}" > "$DEL_Q"
printf '%s\n' "{\"ts\":\"$NOW\",\"source\":\"check-console\",\"text\":\"second-line\"}" >> "$DEL_Q"
run_hook advisory-relay.js "$(printf '{"session_id":"%s","hook_event_name":"UserPromptSubmit"}' "$DEL_SID")"
assert_eq 0 "$__RUN_EXIT" "relay delivery exit 0"
assert_contains "$__RUN_STDOUT" '"hookEventName":"UserPromptSubmit"' "relay hookEventName"
assert_contains "$__RUN_STDOUT" 'first-line' "relay first text"
assert_contains "$__RUN_STDOUT" 'second-line' "relay second text"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "relay no permissionDecision"
node -e '
  const o = JSON.parse(process.argv[1]);
  const t = o.hookSpecificOutput.additionalContext;
  if (t !== "first-line\nsecond-line") process.exit(2);
  if (o.permissionDecision !== undefined) process.exit(3);
  if (o.hookSpecificOutput.hookEventName !== "UserPromptSubmit") process.exit(4);
' "$__RUN_STDOUT"
assert_eq $? 0 "relay stdout is merged JSON in enqueue order"
assert_file_absent "$DEL_Q" "queue deleted after drain"
run_hook advisory-relay.js "$(printf '{"session_id":"%s","hook_event_name":"UserPromptSubmit"}' "$DEL_SID")"
assert_eq 0 "$__RUN_EXIT" "second relay exit 0"
assert_eq "" "$__RUN_STDOUT" "second relay no stdout (no double delivery)"

# ── session isolation ────────────────────────────────────────────────────────
ISO_A="adv-iso-a"
ISO_B="adv-iso-b"
ISO_QA="$(queue_path "$ISO_A")"
mkdir -p "$(dirname "$ISO_QA")"
printf '%s\n' "{\"ts\":\"$NOW\",\"source\":\"cost-tracker\",\"text\":\"only-a\"}" > "$ISO_QA"
run_hook advisory-relay.js "$(printf '{"session_id":"%s"}' "$ISO_B")"
assert_eq 0 "$__RUN_EXIT" "relay other session exit 0"
assert_eq "" "$__RUN_STDOUT" "relay other session silent"
assert_file_exists "$ISO_QA" "session A queue still present"
run_hook advisory-relay.js "$(printf '{"session_id":"%s"}' "$ISO_A")"
assert_contains "$__RUN_STDOUT" 'only-a' "session A still deliverable"

# ── cap at 20 entries (via writer after 25 constructed lines + one append) ───
CAP_SID="adv-cap20"
CAP_Q="$(queue_path "$CAP_SID")"
mkdir -p "$(dirname "$CAP_Q")"
: > "$CAP_Q"
i=1
while [ "$i" -le 25 ]; do
  printf '%s\n' "{\"ts\":\"$NOW\",\"source\":\"cost-tracker\",\"text\":\"cap-entry-$i\"}" >> "$CAP_Q"
  i=$((i + 1))
done
# Drive cost-tracker advisory to append + cap (new session + threshold)
CAP_TR="$TEST_TMP/cap-transcript.jsonl"
{ turn 400 10 5; turn 700 10 5; } > "$CAP_TR"
run_hook cost-tracker.js "$(printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$CAP_SID" "$CAP_TR" "$TEST_TMP")"
# After writer cap, at most 20 lines on disk
CAP_LINES="$(grep -c . "$CAP_Q" || true)"
if [ "${CAP_LINES:-0}" -gt 20 ]; then
  fail "writer left $CAP_LINES lines (>20)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
run_hook advisory-relay.js "$(printf '{"session_id":"%s"}' "$CAP_SID")"
node -e '
  const o = JSON.parse(process.argv[1]);
  const parts = String(o.hookSpecificOutput.additionalContext).split("\n");
  const set = new Set(parts);
  if (set.has("cap-entry-1") || set.has("cap-entry-6")) process.exit(2);
  if (!set.has("cap-entry-25")) process.exit(3);
' "$__RUN_STDOUT"
assert_eq $? 0 "oldest constructed entries dropped; newest 20 retained"

# ── 8 KiB size cap (writer) ──────────────────────────────────────────────────
SZ_SID="adv-8k"
SZ_Q="$(queue_path "$SZ_SID")"
mkdir -p "$(dirname "$SZ_Q")"
node -e '
  const fs = require("fs");
  const big = "B".repeat(3000);
  const now = new Date().toISOString();
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += JSON.stringify({ ts: now, source: "cost-tracker", text: big + i }) + "\n";
  }
  fs.writeFileSync(process.argv[1], out);
' "$SZ_Q"
SZ_TR="$TEST_TMP/sz-transcript.jsonl"
{ turn 400 10 5; turn 700 10 5; } > "$SZ_TR"
run_hook cost-tracker.js "$(printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$SZ_SID" "$SZ_TR" "$TEST_TMP")"
SZ_BYTES="$(wc -c < "$SZ_Q" | tr -d ' ')"
if [ "$SZ_BYTES" -le 8192 ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "queue file is $SZ_BYTES bytes (>8192)"
fi

# ── age cap (24h) ────────────────────────────────────────────────────────────
AGE_SID="adv-age"
AGE_Q="$(queue_path "$AGE_SID")"
mkdir -p "$(dirname "$AGE_Q")"
OLD="$(node -e 'process.stdout.write(new Date(Date.now()-25*3600*1000).toISOString())')"
printf '%s\n' "{\"ts\":\"$OLD\",\"source\":\"cost-tracker\",\"text\":\"stale-old\"}" > "$AGE_Q"
printf '%s\n' "{\"ts\":\"$NOW\",\"source\":\"cost-tracker\",\"text\":\"fresh-new\"}" >> "$AGE_Q"
run_hook advisory-relay.js "$(printf '{"session_id":"%s"}' "$AGE_SID")"
assert_eq 0 "$__RUN_EXIT" "age filter exit 0"
assert_contains "$__RUN_STDOUT" 'fresh-new' "recent entry delivered"
assert_not_contains "$__RUN_STDOUT" 'stale-old' "stale entry not delivered"
assert_file_absent "$AGE_Q" "age-filtered queue deleted"

# ── fail-open on corrupt queue ───────────────────────────────────────────────
COR_SID="adv-corrupt"
COR_Q="$(queue_path "$COR_SID")"
mkdir -p "$(dirname "$COR_Q")"
printf '%s\n' 'not-json' > "$COR_Q"
printf '%s\n' "{\"ts\":\"$NOW\",\"source\":\"cost-tracker\",\"text\":\"ok-line\"}" >> "$COR_Q"
printf '%s\n' '{"ts":' >> "$COR_Q"
run_hook advisory-relay.js "$(printf '{"session_id":"%s"}' "$COR_SID")"
assert_eq 0 "$__RUN_EXIT" "corrupt queue fail-open exit 0"
# either empty or only parseable
if [ -n "$__RUN_STDOUT" ]; then
  assert_contains "$__RUN_STDOUT" 'ok-line' "corrupt: parseable line kept"
  assert_not_contains "$__RUN_STDOUT" 'not-json' "corrupt: raw junk not emitted as-is unless parsed"
fi

# ── opt-out ──────────────────────────────────────────────────────────────────
OFF_SID="adv-off"
OFF_Q="$(queue_path "$OFF_SID")"
mkdir -p "$(dirname "$OFF_Q")"
printf '%s\n' "{\"ts\":\"$NOW\",\"source\":\"cost-tracker\",\"text\":\"keep-me\"}" > "$OFF_Q"
BEFORE="$(cat "$OFF_Q")"
AUTOPILOT_ADVISORY_RELAY=off run_hook advisory-relay.js "$(printf '{"session_id":"%s"}' "$OFF_SID")"
assert_eq 0 "$__RUN_EXIT" "opt-out exit 0"
assert_eq "" "$__RUN_STDOUT" "opt-out no stdout"
assert_file_exists "$OFF_Q" "opt-out left queue file"
assert_eq "$(cat "$OFF_Q")" "$BEFORE" "opt-out queue unchanged"

# ── missing session_id on relay ──────────────────────────────────────────────
run_hook advisory-relay.js '{}'
assert_eq 0 "$__RUN_EXIT" "relay empty payload exit 0"
assert_eq "" "$__RUN_STDOUT" "relay empty payload silent"

finalize_test
