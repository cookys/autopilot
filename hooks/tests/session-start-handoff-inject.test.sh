#!/usr/bin/env bash
# session-start-handoff-inject.test.sh — tests for SessionStart handoff injection.

. "$(dirname "$0")/lib.sh"

HOOK="session-start.js"

repo_hash() {
  local repo_root="$1"
  node -e "const crypto = require('crypto'); const fs = require('fs'); console.log(crypto.createHash('sha1').update(fs.realpathSync(process.argv[1])).digest('hex'));" "$repo_root"
}

write_handoff_state() {
  local repo_root="$1"
  local body="$2"
  local session_id="$3"
  local written_at="$4"
  local hash
  local handoff_dir="$HOOK_HOME/.autopilot/handoff"
  local body_file
  local meta_file

  hash=$(repo_hash "$repo_root")
  mkdir -p "$handoff_dir"
  body_file="$handoff_dir/$hash.md"
  meta_file="$handoff_dir/$hash.meta.json"

  printf '%s' "$body" > "$body_file"
  # Mirror the real writer: meta carries `gen` = sha1(body) so the reader's
  # generation binding is exercised.
  node -e "const fs = require('fs'); const crypto = require('crypto'); const content = fs.readFileSync(process.argv[5]); const meta = { repo_root: process.argv[1], written_at: process.argv[2], session_id: process.argv[3], body_bytes: content.length, gen: crypto.createHash('sha1').update(content).digest('hex') }; fs.writeFileSync(process.argv[4], JSON.stringify(meta));" \
    "$repo_root" \
    "$written_at" \
    "$session_id" \
    "$meta_file" \
    "$body_file"
  echo "$hash"
}

extract_context() {
  node -e "const fs = require('fs'); const input = fs.readFileSync(0,'utf8'); if (!input.trim()) { process.stdout.write(''); process.exit(0); } const parsed = JSON.parse(input); const context = parsed?.hookSpecificOutput?.additionalContext || parsed?.additional_context || ''; process.stdout.write(context);" <<< "$1"
}

# 1. Default-off gate: no config + no env = no inject/read.
REPO_DEFAULT="$TEST_TMP/repo-default"
mkdir -p "$REPO_DEFAULT"; (cd "$REPO_DEFAULT" && git init -q -b main && git config user.email t@t && git config user.name t && echo "x" > f.txt && git add f.txt && git commit -qm init)
mkdir -p "$REPO_DEFAULT/docs"
printf 'DO_NOT_READ_DOCS_HANDOFF' > "$REPO_DEFAULT/docs/HANDOFF.md"
DEFAULT_HASH=$(write_handoff_state "$REPO_DEFAULT" "# old handoff" "s-default" "$(node -e 'process.stdout.write(new Date().toISOString())')")
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"clear\"}"
DEFAULT_CTX=$(extract_context "$__RUN_STDOUT")
assert_not_contains "$DEFAULT_CTX" "machine session snapshot at last /clear" "default-off: no handoff label"
assert_not_contains "$DEFAULT_CTX" "DO_NOT_READ_DOCS_HANDOFF" "default-off: does not read docs/HANDOFF.md"
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$DEFAULT_HASH.md" "default-off: handoff state file untouched when not injected"
assert_contains "$DEFAULT_CTX" "Autopilot" "default-off: keeps baseline context"

# 2. Gate ON via config.json and source in {clear,startup} (the WIRED sources): injects handoff.
echo '{"handoff_inject":true}' > "$HOOK_HOME/.autopilot/config.json"

for source in clear startup; do
  HASH=$(write_handoff_state "$REPO_DEFAULT" "# session handoff $source" "s-$source" "$(node -e 'process.stdout.write(new Date().toISOString())')")
  run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"$source\"}"
  CTX=$(extract_context "$__RUN_STDOUT")
  assert_contains "$CTX" "machine session snapshot at last /clear" "gated-$source: label injected"
  assert_file_absent "$HOOK_HOME/.autopilot/handoff/$HASH.md" "gated-$source: handoff consumed"
done

# 2b. source=resume is NOT a wired source (hooks.json matcher is startup|clear|compact;
#     a resumed session already has its context) → does NOT inject, state preserved.
HASH=$(write_handoff_state "$REPO_DEFAULT" "# resume handoff" "s-resume" "$(node -e 'process.stdout.write(new Date().toISOString())')")
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"resume\"}"
CTX=$(extract_context "$__RUN_STDOUT")
assert_not_contains "$CTX" "machine session snapshot at last /clear" "resume: not a wired source → no inject"
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$HASH.md" "resume: state preserved (not consumed)"

# 3. Source compact never injects and should not fall back to docs/HANDOFF.md.
HASH=$(write_handoff_state "$REPO_DEFAULT" "# compact handoff" "s-compact" "$(node -e 'process.stdout.write(new Date().toISOString())')")
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"compact\"}"
CTX=$(extract_context "$__RUN_STDOUT")
assert_not_contains "$CTX" "machine session snapshot at last /clear" "compact: source gate blocks handoff injection"
assert_not_contains "$CTX" "DO_NOT_READ_DOCS_HANDOFF" "compact: does not read repo HANDOFF.md"
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$HASH.md" "compact: state file stays for next start"

# 4. Consume-once semantics.
HASH=$(write_handoff_state "$REPO_DEFAULT" "# consume once" "s-once" "$(node -e 'process.stdout.write(new Date().toISOString())')")
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"clear\"}"
CTX=$(extract_context "$__RUN_STDOUT")
assert_contains "$CTX" "machine session snapshot at last /clear" "consume-once: first start injects"
assert_file_absent "$HOOK_HOME/.autopilot/handoff/$HASH.md" "consume-once: file removed after consume"
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"clear\"}"
CTX=$(extract_context "$__RUN_STDOUT")
assert_not_contains "$CTX" "machine session snapshot at last /clear" "consume-once: second start no handoff"

# 5. Cap: additionalContext < 10k chars with truncation notice.
LONG_BODY="$(node -e "process.stdout.write('x'.repeat(12050))")"
HASH=$(write_handoff_state "$REPO_DEFAULT" "$LONG_BODY" "s-long" "$(node -e 'process.stdout.write(new Date().toISOString())')")
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"clear\"}"
CTX=$(extract_context "$__RUN_STDOUT")
CTX_LEN=${#CTX}
if [ "$CTX_LEN" -ge 10000 ]; then
  fail "cap: additionalContext should be < 10000 chars, got $CTX_LEN"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_contains "$CTX" "[…truncated]" "cap: large handoff truncated with notice"

# 6. Precedence: handoff injection suppresses intent hint.
HOSTNAME="$(node -e "console.log(require('os').hostname() || 'unknown')")"
MANUAL_HASH=$(repo_hash "$REPO_DEFAULT")
mkdir -p "$HOOK_HOME/.autopilot/intent"
cat > "$HOOK_HOME/.autopilot/intent/$MANUAL_HASH.json" <<EOF
{"hostname":"$HOSTNAME","last_updated":"12:34","last_tool_input_summary":"git commit -m 'hello'","git_branch":"feat/test-branch"}
EOF
HASH=$(write_handoff_state "$REPO_DEFAULT" "# precedence" "s-pre" "$(node -e 'process.stdout.write(new Date().toISOString())')")
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"clear\"}"
CTX=$(extract_context "$__RUN_STDOUT")
assert_contains "$CTX" "machine session snapshot at last /clear" "precedence: handoff injected"
assert_not_contains "$CTX" "Autopilot Resume Hint" "precedence: intent hint suppressed"

# 7. TTL-clean stale state older than 24h is cleaned without inject.
OLD_TS=$(node -e "const t = new Date(Date.now() - 25 * 60 * 60 * 1000); process.stdout.write(t.toISOString());")
HASH=$(write_handoff_state "$REPO_DEFAULT" "# stale" "s-stale" "$OLD_TS")
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"startup\"}"
CTX=$(extract_context "$__RUN_STDOUT")
assert_not_contains "$CTX" "machine session snapshot at last /clear" "ttl: stale state not injected"
assert_file_absent "$HOOK_HOME/.autopilot/handoff/$HASH.md" "ttl: stale handoff body cleaned"
assert_file_absent "$HOOK_HOME/.autopilot/handoff/$HASH.meta.json" "ttl: stale handoff meta cleaned"

# 7b. TTL cleanup is generation-bound (decorrelated review 🟠): it reaps only the
#     stale canonical pair, never an in-flight `.tmp.*` / `.consuming.*` belonging to a
#     concurrent writer publish or reader consume.
HDIR_T="$HOOK_HOME/.autopilot/handoff"
RHASH_T=$(repo_hash "$REPO_DEFAULT")
rm -f "$HDIR_T/$RHASH_T".*
write_handoff_state "$REPO_DEFAULT" "# stale" "s-stale2" "$OLD_TS" >/dev/null
printf 'inflight' > "$HDIR_T/$RHASH_T.md.tmp.77777"
printf 'inflight' > "$HDIR_T/$RHASH_T.md.consuming.66666"
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"startup\"}"
assert_file_absent "$HDIR_T/$RHASH_T.meta.json" "ttl-gen: stale meta reaped"
assert_file_exists "$HDIR_T/$RHASH_T.md.tmp.77777" "ttl-gen: in-flight writer .tmp not nuked"
assert_file_exists "$HDIR_T/$RHASH_T.md.consuming.66666" "ttl-gen: in-flight reader .consuming not nuked"
rm -f "$HDIR_T/$RHASH_T".*

# 8. Race lock (decorrelated review 🔴×2): a consume MISS must DELETE NOTHING, so it
#    cannot nuke a concurrent writer's temp/meta or a racing reader's .consuming file.
HDIR="$HOOK_HOME/.autopilot/handoff"
RHASH=$(repo_hash "$REPO_DEFAULT")
NOW_TS=$(node -e "process.stdout.write(new Date().toISOString());")
# 8a. writer mid-publish: fresh META present, BODY absent (writer publishes meta, then body).
rm -f "$HDIR/$RHASH".*
node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({repo_root:process.argv[2],written_at:process.argv[3],session_id:'w',body_bytes:5}));" "$HDIR/$RHASH.meta.json" "$(cd "$REPO_DEFAULT" && pwd -P)" "$NOW_TS"
printf 'tmpbd' > "$HDIR/$RHASH.md.tmp.99999"
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"clear\"}"
CTX=$(extract_context "$__RUN_STDOUT")
assert_not_contains "$CTX" "machine session snapshot at last /clear" "race: body-absent injects nothing"
assert_file_exists "$HDIR/$RHASH.meta.json" "race: writer META not nuked on consume-miss"
assert_file_exists "$HDIR/$RHASH.md.tmp.99999" "race: writer TEMP body not nuked on consume-miss"
# 8b. reader/reader: a rival's .consuming.<pid> present, canonical body already gone.
rm -f "$HDIR/$RHASH".*
printf 'rival' > "$HDIR/$RHASH.md.consuming.88888"
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"clear\"}"
assert_file_exists "$HDIR/$RHASH.md.consuming.88888" "race: rival reader's .consuming not nuked"

# 8c. Generation binding (decorrelated review 🟠): a body whose hash does NOT match the
#     meta's `gen` (a torn read — old body under a fresh meta) is NOT injected, and the
#     meta is PRESERVED for the matching body still to come.
rm -f "$HDIR/$RHASH".*
printf 'fresh body content for gen' > "$HDIR/$RHASH.md"
node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({repo_root:process.argv[2],written_at:process.argv[3],session_id:'g',body_bytes:99,gen:'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'}));" "$HDIR/$RHASH.meta.json" "$(cd "$REPO_DEFAULT" && pwd -P)" "$NOW_TS"
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$REPO_DEFAULT\",\"source\":\"clear\"}"
CTX=$(extract_context "$__RUN_STDOUT")
assert_not_contains "$CTX" "machine session snapshot at last /clear" "gen: body not matching meta.gen is not injected"
assert_file_exists "$HDIR/$RHASH.meta.json" "gen: mismatched-gen meta preserved for the matching body"
rm -f "$HDIR/$RHASH".*

finalize_test
