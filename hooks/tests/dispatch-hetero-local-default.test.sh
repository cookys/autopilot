#!/usr/bin/env bash
# Implementer dispatch defaults to the local qwen seat.
# Red on a dispatch-hetero.sh that still sends an omitted --runner to grok.
# Stub claude / stub grok only. No live CLI and no HTTP endpoint.
. "$(dirname "$0")/lib.sh"

TEST_NAME="dispatch-hetero-local-default"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_TEST_CN_GATE_OFF=1
export AUTOPILOT_ENDPOINT_PREPROBE=off
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL=http://127.0.0.1:9
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN=fake-test-token
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin"
unset AUTOPILOT_QUALIFICATION_OVERRIDE AUTOPILOT_DISPATCH_ROLE AUTOPILOT_TASK_CLASS 2>/dev/null || true

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
$GIT -C "$SBX" init -q
$GIT -C "$SBX" commit -q --allow-empty -m base

STUB_CLAUDE="$TEST_TMP/bin/claude"
cat > "$STUB_CLAUDE" <<'EOF'
#!/usr/bin/env bash
cat > got-prompt.txt
pwd > worktree-pwd.txt
printf '%s\n' "$@" > local-argv.txt
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
EOF
chmod +x "$STUB_CLAUDE"

STUB_GROK="$TEST_TMP/grok"
cat > "$STUB_GROK" <<'EOF'
#!/usr/bin/env bash
case " $* " in
  *" __autopilot_probe__ "*)
    echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: xhigh, high, medium, low" >&2
    exit 2 ;;
esac
if [ "${1:-}" = "--version" ]; then echo "grok-cli 0.2.111 (test stub)"; exit 0; fi
printf '%s\n' "$@" > "$GROK_ARGV"
printf 'grok fixture\n' >> impl-defaults-fixture.txt
EOF
chmod +x "$STUB_GROK"
export GROK_ARGV="$TEST_TMP/grok.argv"

json_get() {
  node -e '
    const lines = String(process.argv[1] || "").split(/\r?\n/).reverse();
    const raw = lines.find((l) => l.trim().startsWith("{"));
    if (!raw) { process.stdout.write("<no-json>"); process.exit(0); }
    const o = JSON.parse(raw); const k = process.argv[2];
    if (!(k in o)) process.stdout.write("<absent>");
    else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));
  ' "$1" "$2"
}

run_local() {
  local tag="$1"; shift
  local runs="$TEST_TMP/runs-$tag"
  mkdir -p "$runs"
  OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" \
    "$SCRIPT" --no-verify-tip --context-window off \
    --branch "feat/local-$tag" --prompt-file "$PROMPT" "$@" </dev/null 2>"$TEST_TMP/$tag.err")"
  EXIT=$?
  ERR="$(cat "$TEST_TMP/$tag.err" 2>/dev/null || true)"
  MF="$(find "$runs" -name '*.manifest.json' | head -1)"
}

# (a) implementer, no --runner -> manifest runner local, model qwen.
PROMPT="$TEST_TMP/prompt-a.txt"
printf 'Size: S\nRole: implementer\nScope: ok.txt\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
run_local a
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (a): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "a: implementer with no --runner exits 0"
assert_eq "local" "$(json_get "$OUT" runner)" "a: result runner is local"
assert_eq "qwen" "$(json_get "$OUT" model)" "a: result model is qwen"
assert_file_exists "$MF" "a: manifest written"
assert_eq "local" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).runner)' "$MF")" "a: manifest runner is local"
assert_eq "qwen" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).model)' "$MF")" "a: manifest model is qwen"

# (b) local, no Task-Class line -> dispatched prompt gains it; caller file unchanged.
PROMPT="$TEST_TMP/prompt-b.txt"
printf 'edit only this line\n' > "$PROMPT"
BEFORE="$(sha256sum "$PROMPT" | awk '{print $1}')"
run_local b --runner local --model qwen
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (b): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "b: local with no Task-Class exits 0"
AFTER="$(sha256sum "$PROMPT" | awk '{print $1}')"
assert_eq "$BEFORE" "$AFTER" "b: caller prompt file is unchanged"
SHA_B="$(git -C "$SBX" rev-parse "feat/local-b")"
DISPATCHED="$(git -C "$SBX" show "${SHA_B}:got-prompt.txt")"
assert_contains "$DISPATCHED" "Task-Class: simple-script" "b: dispatched prompt carries Task-Class: simple-script"
assert_contains "$ERR" "dispatched copy adds Task-Class: simple-script" "b: stderr says the copy was added"

# (b2) body prose names Task-Class: outside the header window. The gate reads only
# the first 8 lines, so the dispatched copy still gains the field. Caller file stays.
PROMPT="$TEST_TMP/prompt-b2.txt"
{
  printf 'edit only this line\n'
  i=2
  while [ "$i" -le 19 ]; do
    printf 'filler %s\n' "$i"
    i=$((i + 1))
  done
  printf 'please add a Task-Class: header\n'
} > "$PROMPT"
BEFORE="$(sha256sum "$PROMPT" | awk '{print $1}')"
run_local b2 --runner local --model qwen
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (b2): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "b2: body mention of Task-Class exits 0"
AFTER="$(sha256sum "$PROMPT" | awk '{print $1}')"
assert_eq "$BEFORE" "$AFTER" "b2: caller prompt file is unchanged"
SHA_B2="$(git -C "$SBX" rev-parse "feat/local-b2")"
DISPATCHED="$(git -C "$SBX" show "${SHA_B2}:got-prompt.txt")"
assert_contains "$DISPATCHED" "Task-Class: simple-script" "b2: dispatched prompt carries Task-Class: simple-script"
assert_contains "$ERR" "dispatched copy adds Task-Class: simple-script" "b2: stderr says the copy was added"

# (c) local, no --worktree-parent -> worktree is outside the repo root.
XDG_RUNTIME_DIR="$(mktemp -d /tmp/local-default-xdg.XXXXXX)"
chmod 700 "$XDG_RUNTIME_DIR"
PROMPT="$TEST_TMP/prompt-c.txt"
printf 'Task-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
run_local c --runner local --model qwen
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (c): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "c: local with no --worktree-parent exits 0"
SHA_C="$(git -C "$SBX" rev-parse "feat/local-c")"
WT_C="$(git -C "$SBX" show "${SHA_C}:worktree-pwd.txt" | tr -d '\n')"
REPO_TOP="$(git -C "$SBX" rev-parse --show-toplevel)"
case "$WT_C" in
  "$REPO_TOP"|"$REPO_TOP"/*) fail "c: worktree $WT_C is inside the repo $REPO_TOP" ;;
esac
case "$WT_C" in
  "$XDG_RUNTIME_DIR"/*) ;;
  *) fail "c: worktree $WT_C is not under XDG_RUNTIME_DIR $XDG_RUNTIME_DIR" ;;
esac
PARENT_C="$(dirname "$WT_C")"
assert_eq "$(stat -c '%a' "$PARENT_C")" "700" "c: worktree parent is mode 0700"

# (d) explicit --runner grok still goes to grok.
PROMPT="$TEST_TMP/prompt-d.txt"
printf 'edit impl-defaults-fixture.txt\n' > "$PROMPT"
: > "$GROK_ARGV"
RUNS="$TEST_TMP/runs-d"
mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --runner grok --grok-bin "$STUB_GROK" \
  --branch feat/local-d --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/d.err")"
EXIT=$?
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (d): %s\n%s\n' "$OUT" "$(cat "$TEST_TMP/d.err")" >&2
assert_eq "0" "$EXIT" "d: explicit --runner grok exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "d: result runner is grok"
assert_contains "$(cat "$GROK_ARGV")" "grok-4.7" "d: grok stub received the grok default model"

finalize_test
