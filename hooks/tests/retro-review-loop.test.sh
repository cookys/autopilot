#!/usr/bin/env bash
# retro-review-loop.js unit test — hermetic (fixture transcript dir, --no-git).
# Proves: (1) real Bash tool_use commands are classified by dispatch/review pattern;
# (2) the anti-pollution invariant — a dispatch string that appears in a tool_result
# or a user message (e.g. CLAUDE.md content) is NEVER counted, only assistant tool_use.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/retro-review-loop.js"
FIX="$TEST_TMP/transcripts"
mkdir -p "$FIX"

# One session file. Each line is one transcript event.
{
  # non-message events (must be ignored)
  printf '%s\n' '{"type":"mode","mode":"default"}'
  printf '%s\n' '{"type":"file-history-snapshot"}'
  # malformed JSONL + a blank line — the parser MUST skip these without crashing.
  # (If the JSON.parse guard were removed, the script would throw and fail the exit-0 assert.)
  printf '%s\n' '{not valid json at all'
  printf '%s\n' ''
  # a user message whose text MENTIONS a dispatch command — must NOT be counted
  printf '%s\n' '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"remember scripts/dispatch-hetero.sh --runner auto exists"}]}}'
  # assistant tool_use: impl dispatch
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/dispatch-hetero.sh --runner auto --model gpt-5.3-codex-spark --branch b"}}]}}'
  # assistant tool_use: review dispatch
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/dispatch-review.sh --runner codex --diff-file d"}}]}}'
  # assistant tool_use: direct codex exec
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"codex exec --model gpt-5.5 -c x < /dev/null"}}]}}'
  # assistant tool_use: a non-matching Bash command (counts toward bash_calls only)
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"git status"}}]}}'
  # assistant tool_use: an Agent call (agent_calls, not bash)
  printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"prompt":"go"}}]}}'
  # a tool_result echoing a dispatch command — must NOT be counted
  printf '%s\n' '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ran scripts/dispatch-hetero.sh --runner auto and dispatch-review.sh --runner codex"}]}}'
} > "$FIX/session-a.jsonl"

OUT="$(RETRO_TRANSCRIPT_DIR="$FIX" node "$SCRIPT" --no-git --json 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "retro-review-loop exit 0"

# extract a field from the JSON
jf() { printf '%s' "$OUT" | node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));let v=d;for(const k of process.argv[1].split('.'))v=v[k];process.stdout.write(String(v))" "$1"; }

assert_eq "1" "$(jf transcript.sessions)" "one session parsed"
assert_eq "1" "$(jf transcript.impl_dispatch)" "impl dispatch counted once (user/tool_result mentions ignored)"
assert_eq "1" "$(jf transcript.review_dispatch)" "review dispatch counted once (tool_result echo ignored)"
assert_eq "1" "$(jf transcript.codex_exec)" "codex exec counted once"
assert_eq "4" "$(jf transcript.bash_calls)" "four Bash tool_use calls total"
assert_eq "1" "$(jf transcript.agent_calls)" "one Agent tool_use call"
assert_eq "3" "$(jf hetero_dispatch_total)" "hetero dispatch total = impl+review+codex"
assert_eq "false" "$(jf git_signals.available)" "--no-git → git signals unavailable"

# fail-safe: a missing transcript dir yields zero counts, exit 0 (never throws)
OUT2="$(RETRO_TRANSCRIPT_DIR="$TEST_TMP/does-not-exist" node "$SCRIPT" --no-git --json 2>&1)"; EXIT2=$?
assert_eq "0" "$EXIT2" "missing transcript dir → exit 0 (fail-safe)"
assert_contains "$OUT2" '"sessions": 0' "missing transcript dir → zero sessions"

finalize_test
