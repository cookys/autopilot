#!/usr/bin/env bash
# dispatch-tree 3c (D3) -- author and review (cc-shim) keep the child's transcript before removing the scratch
# HOME: <scratch>/.claude/projects/*/<child_session_id>.jsonl -> <runs>/<run_id>.child-transcript.jsonl, and
# the manifest's child_transcript names it (null when nothing was written). Run status never depends on the copy.
# Seam: a stub `claude` writing known bytes under its HOME; own temp dirs; no real claude is started.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-cct-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"   # the rails' mktemp scratch dirs land here, so leftovers are countable
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID 2>/dev/null || true

REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base

KNOWN='{"type":"user","message":"known-bytes-3c"}'
BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
# writing stub: records its transcript under its (scratch) HOME at the --session-id it was given.
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
sid=""; while [ $# -gt 0 ]; do [ "$1" = "--session-id" ] && sid="$2"; shift; done
cat >/dev/null
mkdir -p "$HOME/.claude/projects/-scratch"
printf '%s\n' "${STUB_KNOWN:?}" > "$HOME/.claude/projects/-scratch/$sid.jsonl"
echo "ok"
exit 0
EOS
cat > "$BINDIR/claude-silent" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
echo "ok"
exit 0
EOS
# symlink stub: the child's transcript is a symlink to another readable file (prompt-injection shape).
cat > "$BINDIR/claude-symlink" <<'EOS'
#!/usr/bin/env bash
sid=""; while [ $# -gt 0 ]; do [ "$1" = "--session-id" ] && sid="$2"; shift; done
cat >/dev/null
mkdir -p "$HOME/.claude/projects/-scratch"
echo SECRET > "$HOME/secret.txt"
ln -s "$HOME/secret.txt" "$HOME/.claude/projects/-scratch/$sid.jsonl"
echo "ok"
exit 0
EOS
chmod +x "$BINDIR/claude" "$BINDIR/claude-silent" "$BINDIR/claude-symlink"
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"

mf_get() { node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const k=process.argv[2];process.stdout.write(!(k in o)?"<absent>":(o[k]===null?"<null>":String(o[k])))' "$1" "$2"; }
one_manifest() { find "$1" -name '*.manifest.json' | head -1; }

run_case() { # <runs> <cmd...>
  local runs="$1"; shift
  mkdir -p "$runs"
  ( cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$runs" STUB_KNOWN="$KNOWN" \
      ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test PATH="$BINDIR:$PATH" "$@" >/dev/null 2>&1 ) || true
}

declare -A CMD_W CMD_S CMD_L
CMD_W[author]="$AUTHOR --runner cc-shim --model MiniMax-M3 --prompt-file $PROMPT --bin $BINDIR/claude"
CMD_S[author]="$AUTHOR --runner cc-shim --model MiniMax-M3 --prompt-file $PROMPT --bin $BINDIR/claude-silent"
CMD_L[author]="$AUTHOR --runner cc-shim --model MiniMax-M3 --prompt-file $PROMPT --bin $BINDIR/claude-symlink"
CMD_L[review]="$REVIEW --runner cc-shim --model MiniMax-M3 --endpoint TESTEP --diff-file $DIFF --bin $BINDIR/claude-symlink"
CMD_W[review]="$REVIEW --runner cc-shim --model MiniMax-M3 --endpoint TESTEP --diff-file $DIFF --bin $BINDIR/claude"
CMD_S[review]="$REVIEW --runner cc-shim --model MiniMax-M3 --endpoint TESTEP --diff-file $DIFF --bin $BINDIR/claude-silent"

for rail in author review; do
  runs="$TEST_TMP/runs-$rail-w"
  # shellcheck disable=SC2086
  run_case "$runs" ${CMD_W[$rail]}
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$rail/written: no manifest"; continue; }
  ct="$(mf_get "$mf" child_transcript)"
  rid="$(mf_get "$mf" run_id)"
  eq "$runs/${rid}.child-transcript.jsonl" "$ct" "$rail: child_transcript is <runs>/<run_id>.child-transcript.jsonl"
  if [ -f "$ct" ]; then eq "$KNOWN" "$(cat "$ct")" "$rail: the kept file holds exactly the bytes the child wrote"; else fail "$rail: kept transcript missing: $ct"; fi
  W_STATUS="$(mf_get "$mf" final_status)"
  eq "600" "$(stat -c %a "$ct")" "$rail: the kept transcript is mode 600"
  leftover="$(find "$TMPDIR" -maxdepth 1 -name "dispatch-$rail-ccshimcwd-*" 2>/dev/null | head -1)"
  eq "" "$leftover" "$rail: the scratch HOME is gone"

  runs="$TEST_TMP/runs-$rail-s"
  # shellcheck disable=SC2086
  run_case "$runs" ${CMD_S[$rail]}
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$rail/silent: no manifest"; continue; }
  eq "<null>" "$(mf_get "$mf" child_transcript)" "$rail: stub writes nothing -> child_transcript null"
  eq "0" "$(find "$runs" -name '*.child-transcript.jsonl' | wc -l | tr -d ' ')" "$rail: no transcript file created when none written"
  eq "$W_STATUS" "$(mf_get "$mf" final_status)" "$rail: run status identical with and without a transcript"

  runs="$TEST_TMP/runs-$rail-l"
  # shellcheck disable=SC2086
  run_case "$runs" ${CMD_L[$rail]}
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$rail/symlink: no manifest"; continue; }
  eq "<null>" "$(mf_get "$mf" child_transcript)" "$rail: symlink source -> child_transcript null"
  eq "0" "$(find "$runs" -name '*.child-transcript.jsonl*' | wc -l | tr -d ' ')" "$rail: symlink source is not copied"
  eq "$W_STATUS" "$(mf_get "$mf" final_status)" "$rail: run status identical with a symlink source"
done

finalize_test
