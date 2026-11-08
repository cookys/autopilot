#!/usr/bin/env bash
# dispatch-hetero --sandbox bwrap: the worker may write only its worktree and its own scratch dir.
#   green  : a worker that writes inside the worktree commits.
#   red    : a worker that writes into the main checkout (the parent of its worktree's repo)
#            - sandbox OFF: the file lands and the fingerprint rejects the round (proves the
#              parent really is writable, so the next case is not an empty test)
#            - sandbox ON : the write fails (EROFS), the file does not exist, the result JSON
#              records the denied write, the fingerprint is untouched (status committed).
#   nested : a worktree under <repo>/.claude/worktrees with the sandbox on is refused.
#   no bwrap / bwrap cannot start: fail closed (precondition_failed, no worker, no worktree).
# Seam: a stub `claude` on PATH, no real model, no GPU. Own temp dirs.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-dhsbx-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID 2>/dev/null || true

if ! command -v bwrap >/dev/null 2>&1 || ! bwrap --ro-bind / / --dev /dev --proc /proc true >/dev/null 2>&1; then
  echo "SKIP: bwrap is not usable on this host; the sandbox cases cannot run"
  finalize_test
  exit 0
fi

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
WTPARENT="$TEST_TMP/wts"; mkdir -p "$WTPARENT"        # outside every repo
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
PARENT_TARGET="$SBX/parent-write.txt"                 # a file in the main checkout

BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
# stub claude: one edit inside the worktree (cwd), and, when asked, an attempt to write into
# the main checkout. The stub reports the attempt on stderr like a shell would (it lands in the
# worker log, where the rail looks for EROFS lines).
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
echo edited > sandbox-edit.txt
if [ -n "${STUB_PARENT_TARGET:-}" ]; then
  echo leaked > "$STUB_PARENT_TARGET"
fi
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
EOS
chmod +x "$BINDIR/claude"

# run_case <sandbox: off|bwrap|none> <write-parent: 1|0> [extra args...] -> OUT (stdout JSON) + RC
run_case() {
  local sandbox="$1" write_parent="$2"; shift 2
  local branch="feat/sbx-$RANDOM$RANDOM" sbx_args=() tgt=""
  [ "$sandbox" = none ] || sbx_args=(--sandbox "$sandbox")
  [ "$write_parent" = 1 ] && tgt="$PARENT_TARGET"
  rm -f "$PARENT_TARGET"
  RC=0
  OUT="$(cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
      STUB_PARENT_TARGET="$tgt" PATH="$BINDIR:$PATH" \
      "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 \
      --prompt-file "$PROMPT" --context-window off --branch "$branch" \
      ${sbx_args[@]+"${sbx_args[@]}"} "$@" 2>"$TEST_TMP/stderr")" || RC=$?
}
result_json() {
  node -e '
const s = require("fs").readFileSync(0, "utf8");
let best = "";
for (const line of s.split("\n")) {
  const t = line.trim();
  if (!t.startsWith("{")) continue;
  try { const o = JSON.parse(t); if (o && typeof o === "object" && !Array.isArray(o) && "status" in o) best = t; } catch {}
}
if (best === "") process.exit(3);
process.stdout.write(best);
'
}
# jfield <dotted.path>: stdin result JSON -> value (JSON-encoded), or <absent>
jfield() {
  node -e '
const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
let v = o;
for (const k of process.argv[1].split(".")) { v = v === null || v === undefined ? undefined : v[k]; }
process.stdout.write(v === undefined ? "<absent>" : JSON.stringify(v));
' "$1"
}
status_of() { printf '%s' "$OUT" | result_json | jfield status; }

# ---- green: worker writes inside the worktree only; sandbox on -> committed
run_case bwrap 0 --worktree-parent "$WTPARENT"
eq '"committed"' "$(status_of)" "green: in-worktree write under the sandbox commits (rc=$RC, stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
eq '"bwrap"' "$(printf '%s' "$OUT" | result_json | jfield sandbox.mode)" "green: result JSON carries sandbox.mode"
eq '"unknown"' "$(printf '%s' "$OUT" | result_json | jfield sandbox.denied_writes)" "green: no denied write seen is reported unknown, not 0"
WT_G="$(printf '%s' "$OUT" | result_json | jfield sandbox.writable.0 | tr -d '"')"
eq "$WTPARENT" "$(dirname "$WT_G")" "green: sandbox.writable[0] is the worktree, created under --worktree-parent (got: $WT_G)"

# ---- negative control: sandbox OFF, the same worker writes the main checkout -> the write lands and the fingerprint rejects the round
run_case off 1 --worktree-parent "$WTPARENT"
eq "yes" "$([ -e "$PARENT_TARGET" ] && echo yes || echo no)" "control(off): the unsandboxed worker really wrote the parent file"
eq '"boundary_rejected"' "$(status_of)" "control(off): the fingerprint rejects the round as boundary_rejected (rc=$RC)"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *main_checkout_mutated*|*main*checkout*) eq 0 0 "control(off): the error names the main checkout mutation" ;;
  *) fail "control(off): error does not name the main checkout mutation: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac
rm -f "$PARENT_TARGET"

# ---- red: sandbox ON, the same worker -> the write fails before it lands
run_case bwrap 1 --worktree-parent "$WTPARENT"
eq "no" "$([ -e "$PARENT_TARGET" ] && echo yes || echo no)" "red(on): the parent file does NOT exist"
eq '"committed"' "$(status_of)" "red(on): the fingerprint is untouched, the in-worktree edit commits (rc=$RC)"
DEN="$(printf '%s' "$OUT" | result_json | jfield sandbox.denied_writes)"
case "$DEN" in
  ''|'"unknown"'|'<absent>') fail "red(on): the result JSON must record the denied write, got denied_writes=$DEN" ;;
  *) eq 0 0 "red(on): result JSON records the denied write (denied_writes=$DEN)" ;;
esac
MF="$(grep -l '"sandbox"' "$AUTOPILOT_DISPATCH_RUNS_DIR"/*.manifest.json 2>/dev/null | head -1)"
if [ -n "$MF" ] && grep -q '"mode":"bwrap"' "$MF"; then eq 0 0 "red(on): the run manifest carries the sandbox object"; else fail "red(on): no manifest with a sandbox object under $AUTOPILOT_DISPATCH_RUNS_DIR"; fi
WLIST="$(printf '%s' "$OUT" | result_json | jfield sandbox.writable)"
case "$WLIST" in
  \[\"/*\",\"/*\"\]) eq 0 0 "red(on): writable lists exactly two non-empty absolute paths ($WLIST)" ;;
  *) fail "red(on): writable is not the two-entry list: $WLIST" ;;
esac
eq "0" "$(/bin/ls -A "$TMPDIR" | grep -c 'dispatch-hetero-sandbox-')" "red(on): the per-dispatch scratch dir is removed after the run"

# ---- nested worktree + sandbox -> refused (the default placement is <repo>/.claude/worktrees)
run_case bwrap 0
eq '"precondition_failed"' "$(status_of)" "nested: sandbox with the default (in-repo) worktree is refused (rc=$RC)"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *"sits inside the working tree"*) eq 0 0 "nested: the error explains the rule" ;;
  *) fail "nested: error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac
eq "0" "$({ /bin/ls -A "$SBX/.claude/worktrees" 2>/dev/null || true; } | wc -l | tr -d ' ')" "nested: no worktree was created"
# the same default placement without the sandbox still works (the rule is sandbox-only)
run_case none 0
eq '"committed"' "$(status_of)" "nested control: without the sandbox the in-repo worktree still commits (rc=$RC)"

# ---- bwrap unavailable -> fail closed
NOBW="$TEST_TMP/nobwrap-bin"; mkdir -p "$NOBW"
# every executable on PATH except bwrap (a hand-picked tool list missed things the rail needs)
IFS=: read -ra _pdirs <<< "$PATH"
for d in "${_pdirs[@]}"; do
  [ -d "$d" ] || continue
  for f in "$d"/*; do
    b="$(basename "$f")"
    [ "$b" = bwrap ] && continue
    [ -x "$f" ] && [ ! -d "$f" ] && [ ! -e "$NOBW/$b" ] && ln -s "$f" "$NOBW/$b"
  done
done
RC=0
OUT="$(cd "$SBX" && PATH="$NOBW:$BINDIR" env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 --prompt-file "$PROMPT" \
    --context-window off --branch "feat/sbx-nobwrap" --sandbox bwrap --worktree-parent "$WTPARENT" 2>"$TEST_TMP/stderr")" || RC=$?
eq '"precondition_failed"' "$(status_of)" "no-bwrap: fails closed with precondition_failed (rc=$RC, stderr: $(tail -c 200 "$TEST_TMP/stderr"))"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *"bwrap is not on PATH"*) eq 0 0 "no-bwrap: the error says bwrap is missing and nothing downgraded" ;;
  *) fail "no-bwrap: error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac
eq "null" "$(printf '%s' "$OUT" | result_json | jfield worktree)" "no-bwrap: no worktree was opened"
eq "0" "$({ git -C "$SBX" branch --list 'feat/sbx-nobwrap' 2>/dev/null || true; } | wc -l | tr -d ' ')" "no-bwrap: no branch was created"

# ---- bwrap present but cannot start (a stub that always fails) -> fail closed
BADBW="$TEST_TMP/badbwrap-bin"; mkdir -p "$BADBW"
printf '#!/bin/sh\necho "bwrap: No permissions to create new namespace" >&2\nexit 1\n' > "$BADBW/bwrap"; chmod +x "$BADBW/bwrap"
RC=0
OUT="$(cd "$SBX" && STUB_PARENT_TARGET="" PATH="$BADBW:$BINDIR:$PATH" env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 --prompt-file "$PROMPT" \
    --context-window off --branch "feat/sbx-badbwrap" --sandbox bwrap --worktree-parent "$WTPARENT" 2>"$TEST_TMP/stderr")" || RC=$?
eq '"precondition_failed"' "$(status_of)" "bad-bwrap: a bwrap that cannot start fails closed (rc=$RC)"
case "$(printf '%s' "$OUT" | result_json | jfield error)" in
  *"cannot start"*) eq 0 0 "bad-bwrap: the error says bwrap cannot start" ;;
  *) fail "bad-bwrap: error text: $(printf '%s' "$OUT" | result_json | jfield error)" ;;
esac

# ---- other runners and bad values are refused, never ignored
RC=0
OUT="$(cd "$SBX" && PATH="$BINDIR:$PATH" env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner codex --model gpt-x --prompt-file "$PROMPT" \
    --context-window off --branch "feat/sbx-codex" --sandbox bwrap 2>"$TEST_TMP/stderr")" || RC=$?
eq '"precondition_failed"' "$(status_of)" "runner: --sandbox bwrap with a non-cc-shim runner is refused (rc=$RC)"

finalize_test
