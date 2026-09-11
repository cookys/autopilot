#!/usr/bin/env bash
# dispatch-hetero --runner kimi integration test (v2.36.x, kimi-implementer-rail).
#
# The kimi rail is grok/qoderclicn/opencode-shaped (EDIT-ONLY directive prepended,
# wrapper commits, verdict from git artifacts) EXCEPT for prompt transport: kimi 0.41.0
# takes the prompt ONLY as one -p argv string (no --prompt-file, no STDIN — Stage-0 spike
# 2026-09-11, docs/plans/2026-09-11-kimi-implementer-rail.md §0), so a pre-spend argv-byte
# gate (copied in shape from scripts/dispatch-review.sh's kimi gate) refuses an oversized
# prompt BEFORE any worktree exists. `-p` cannot combine with --auto/-y — no such flags are
# passed. Only the binary is stubbed; the real dispatch-hetero.sh runs.
. "$(dirname "$0")/lib.sh"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
export DISPATCH_QUIET=1
ARGV_LOG="$TEST_TMP/argv.log"

# Stub kimi: records argv (the -p value included, since kimi takes it as one argv string),
# honors process cwd (no --dir/--cwd flag on this rail), writes a file (committed path).
STUB_OK="$TEST_TMP/kimi-ok"
cat > "$STUB_OK" <<__EOF1
#!/usr/bin/env bash
printf '%s\n' "\$*" > "$ARGV_LOG"
echo kimi-edited > ki_out.txt
printf 'done\n'
__EOF1
chmod +x "$STUB_OK"

# Stub kimi: no edit, exit 0 (no_op).
STUB_NOOP="$TEST_TMP/kimi-noop"
cat > "$STUB_NOOP" <<'__EOF2'
#!/usr/bin/env bash
printf 'nothing to do\n'
__EOF2
chmod +x "$STUB_NOOP"

# Stub kimi: exits non-zero.
STUB_FAIL="$TEST_TMP/kimi-fail"
cat > "$STUB_FAIL" <<'__EOF3'
#!/usr/bin/env bash
echo "provider error" >&2
exit 1
__EOF3
chmod +x "$STUB_FAIL"

# 1) committed path
OUT="$(cd "$SBX" && "$SCRIPT" --runner kimi --model kimi-code/k3 --branch feat/kimi-ok --prompt-file "$PROMPT" --kimi-bin "$STUB_OK" --context-window off 2>&1)"
RC=$?
assert_eq "0" "$RC" "kimi committed path exit 0"
assert_contains "$OUT" '"status": "committed"' "kimi committed status"
assert_contains "$OUT" '"runner": "kimi"' "kimi runner in final JSON"
assert_contains "$OUT" '"model": "kimi-code/k3"' "model id passed through verbatim"
OUT_JSON="$(printf '%s\n' "$OUT" | grep '^{ "status"' | tail -1)"
assert_contains "$OUT_JSON" '"files_changed": 1' "one file committed by the wrapper"
# argv contract: -m <model> -p <combined-prompt-string> --output-format text
ARGV="$(cat "$ARGV_LOG")"
assert_contains "$ARGV" '-m kimi-code/k3' "argv carries -m <model>"
assert_contains "$ARGV" '--output-format text' "argv carries --output-format text"
assert_not_contains "$ARGV" '--auto' "argv never carries --auto (cannot combine with -p)"
assert_not_contains "$ARGV" ' -y ' "argv never carries -y (cannot combine with -p)"
# prompt travels as ONE argv string with the EDIT-ONLY directive prepended, task text intact
assert_contains "$ARGV" 'HARNESS DIRECTIVE' "argv -p string carries the EDIT-ONLY directive"
assert_contains "$ARGV" 'Do NOT
git commit' "directive forbids committing"
assert_contains "$ARGV" 'update repo file' "argv -p string carries the task text"
# the commit landed on the branch, HEAD of the caller repo untouched
assert_eq "base" "$(git -C "$SBX" log -1 --format=%s)" "caller HEAD untouched"
assert_eq "kimi-edited" "$(git -C "$SBX" show feat/kimi-ok:ki_out.txt)" "edited file is on the dispatch branch"
RUN_ID="$(printf '%s' "$OUT_JSON" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p')"
assert_file_exists "$RUNS_DIR/$RUN_ID.manifest.json" "kimi run manifest written"
assert_contains "$(cat "$RUNS_DIR/$RUN_ID.manifest.json")" '"runner": "kimi"' "manifest runner provenance"
assert_contains "$(cat "$RUNS_DIR/$RUN_ID.manifest.json")" '"log_format": "plain"' "manifest log_format plain (kimi stream-json has no usage today)"

# 2) no_op path
OUT="$(cd "$SBX" && "$SCRIPT" --runner kimi --model kimi-code/k3 --branch feat/kimi-noop --prompt-file "$PROMPT" --kimi-bin "$STUB_NOOP" --context-window off 2>&1)"
assert_contains "$OUT" '"status": "no_op"' "no edit → no_op"
assert_contains "$OUT" '"runner": "kimi"' "no_op keeps runner provenance"

# 3) failure path
OUT="$(cd "$SBX" && "$SCRIPT" --runner kimi --model kimi-code/k3 --branch feat/kimi-fail --prompt-file "$PROMPT" --kimi-bin "$STUB_FAIL" --context-window off 2>&1)"
RC=$?
# same classification every rail gives a nonzero exit with no commit: question_suspected
assert_contains "$OUT" '"status": "question_suspected"' "nonzero exit + no edit → question_suspected (worktree kept)"
assert_not_contains "$OUT" '"status": "committed"' "failure path is not committed"
[ "$RC" -ne 0 ] && assert_eq ok ok "failure path exits nonzero" || fail "failure path exited 0"

# 4) oversized prompt → precondition_failed BEFORE any worktree exists (KR4). kimi takes the
# prompt only as one -p argv string; a prompt above KIMI_ARGV_LIMIT (default 120000) must
# never reach execve (Linux MAX_ARG_STRLEN 131072 would rc=126 opaquely). Real oversized file,
# not an env-shrunk seam — same style as dispatch-review.sh's kimi argv-wall test.
BIG_PROMPT="$TEST_TMP/kimi-big-prompt.txt"
{ for i in $(seq 1 3000); do printf 'line %05d %s\n' "$i" "$(printf 'x%.0s' $(seq 1 40))"; done; } > "$BIG_PROMPT"
rm -f "$ARGV_LOG"
OUT="$(cd "$SBX" && "$SCRIPT" --runner kimi --model kimi-code/k3 --branch feat/kimi-big --prompt-file "$BIG_PROMPT" --kimi-bin "$STUB_OK" --context-window off 2>&1)"
RC=$?
assert_eq "2" "$RC" "kimi: oversized prompt is a precondition failure (exit 2), never an rc=126 death"
assert_contains "$OUT" '"status": "precondition_failed"' "kimi: oversized prompt reports precondition_failed"
assert_contains "$OUT" 'MAX_ARG_STRLEN' "kimi: refusal names the kernel argv limit"
assert_contains "$OUT" 'reads a prompt file' "kimi: refusal names the runner remedy"
# git never gained a feat/kimi-big branch — nothing was created (the precondition_failed contract)
assert_eq "" "$(git -C "$SBX" branch --list feat/kimi-big)" "kimi: oversized prompt created no branch (no worktree, no dispatch)"
# The stub (which would have written the argv log) was never invoked — refused pre-spend.
assert_file_absent "$ARGV_LOG" "kimi: argv log absent — the stub never ran (refused before spawn)"

# 5) preconditions: missing binary; auto never selects kimi; --model required; runner enum names kimi
OUT="$(cd "$SBX" && "$SCRIPT" --runner kimi --model kimi-code/x --branch feat/kimi-nobin --prompt-file "$PROMPT" --kimi-bin "$TEST_TMP/does-not-exist" --context-window off 2>&1)"
assert_contains "$OUT" '"status": "precondition_failed"' "missing kimi binary fails closed"
assert_contains "$OUT" 'kimi binary not found' "missing binary names the fix"
OUT="$(cd "$SBX" && "$SCRIPT" --runner auto --model kimi-code/k3 --branch feat/kimi-auto --prompt-file "$PROMPT" --agy-bin "$TEST_TMP/does-not-exist" --context-window off 2>&1)"
assert_not_contains "$OUT" '"runner": "kimi"' "auto never routes a provider/alias id to kimi"
OUT="$(cd "$SBX" && "$SCRIPT" --runner bogus --model x --branch feat/kimi-enum --prompt-file "$PROMPT" 2>&1)"
assert_contains "$OUT" 'opencode|kimi' "runner enum error names kimi"

finalize_test
