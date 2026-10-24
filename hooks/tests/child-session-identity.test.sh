#!/usr/bin/env bash
# Live-pane plan 7.1 identity hand-off 3 -- every rail that starts a `claude` child (author: cc-shim and
# claude-native; review: cc-shim and claude-native; hetero: cc-shim) mints the child's session id, passes it
# as `--session-id`, records it as the manifest's child_session_id, and hands the child
# AUTOPILOT_PARENT_SESSION_ID=<the rail's own marker write target> (dispatch-tree 3b: $CLAUDE_CODE_SESSION_ID when that is the
# launcher's id; with no id at all, the cwd-derived id). The child's SessionStart marker writer (ensurePlainMarker) turns that
# variable into parent_session_id; `session-mode set` never does.
# Seam: a stub `claude` that records its argv and env; own temp dirs; no real claude is ever started.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
seed_fake_claude_credentials "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-csid-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID 2>/dev/null || true

HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base

# Stub claude: appends argv (one per line) and the parent variable to $STUB_LOG, answers with a plain line.
BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
{
  printf 'ARGV:'; printf ' %s' "$@"; printf '\n'
  printf 'PARENT:%s\n' "${AUTOPILOT_PARENT_SESSION_ID-<unset>}"
} >> "${STUB_LOG:?}"
cat >/dev/null
echo "ok"
exit 0
EOS
chmod +x "$BINDIR/claude"
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"

mf_get() { node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const k=process.argv[2];process.stdout.write(!(k in o)?"<absent>":(o[k]===null?"<null>":String(o[k])))' "$1" "$2"; }
one_manifest() { find "$1" -name '*.manifest.json' | head -1; }
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

run_case() { # <name> <runs> <log> <parent-or-empty> <cmd...>
  local name="$1" runs="$2" log="$3" parent="$4"; shift 4
  mkdir -p "$runs"; : > "$log"
  local -a envs=()
  [ -n "$parent" ] && envs=(CLAUDE_CODE_SESSION_ID="$parent")
  ( cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$runs" STUB_LOG="$log" \
      ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test PATH="$BINDIR:$PATH" ${envs[@]+"${envs[@]}"} \
      "$@" >/dev/null 2>&1 ) || true
}
check_case() { # <name> <runs> <log> <parent-or-empty>
  local name="$1" runs="$2" log="$3" parent="$4" mf argv sid
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$name: no manifest"; return; }
  argv="$(grep '^ARGV:' "$log" | head -1)"
  [ -n "$argv" ] || { fail "$name: the stub claude was never started (log empty)"; return; }
  sid="$(printf '%s' "$argv" | sed -n 's/.* --session-id \([^ ]*\).*/\1/p')"
  [[ "$sid" =~ $UUID_RE ]] && eq ok ok "$name: --session-id is a lowercase uuid" || fail "$name: --session-id missing or not a uuid: '$sid' in: $argv"
  eq "$sid" "$(mf_get "$mf" child_session_id)" "$name: manifest child_session_id == the id passed to claude"
  if [ -n "$parent" ]; then
    eq "PARENT:$parent" "$(grep '^PARENT:' "$log" | head -1)" "$name: child gets AUTOPILOT_PARENT_SESSION_ID=\$CLAUDE_CODE_SESSION_ID"
    eq "$parent" "$(mf_get "$mf" session_id)" "$name: manifest session_id is still the parent id"
  else
    # 3b rule 3: a launcher with no session id still has a write target (cwd), and the child gets it.
    eq "PARENT:$CWD_ID" "$(grep '^PARENT:' "$log" | head -1)" "$name: no session id => the child gets the rail's cwd-derived write target"
  fi
}

PARENT="aaaaaaaa-1111-2222-3333-444444444444"
CWD_ID="$(cd "$SBX" && node -e 'process.stdout.write(process.cwd().replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,64))')"
declare -A CMDS
CMDS[author-native]="$AUTHOR --runner claude-native --model claude-haiku --prompt-file $PROMPT --bin $BINDIR/claude"
CMDS[author-ccshim]="$AUTHOR --runner cc-shim --model MiniMax-M3 --prompt-file $PROMPT --bin $BINDIR/claude"
CMDS[review-native]="$REVIEW --runner claude-native --model claude-haiku --diff-file $DIFF --bin $BINDIR/claude"
CMDS[review-ccshim]="$REVIEW --runner cc-shim --model MiniMax-M3 --endpoint TESTEP --diff-file $DIFF --bin $BINDIR/claude"
CMDS[hetero-ccshim]="$HETERO --runner cc-shim --model MiniMax-M3 --effort high --branch feat/csid-BRX --prompt-file $PROMPT"

for name in author-native author-ccshim review-native review-ccshim hetero-ccshim; do
  # shellcheck disable=SC2086
  run_case "$name" "$TEST_TMP/runs-$name" "$TEST_TMP/log-$name" "$PARENT" ${CMDS[$name]//BRX/p}
  check_case "$name (parent set)" "$TEST_TMP/runs-$name" "$TEST_TMP/log-$name" "$PARENT"
  # shellcheck disable=SC2086
  run_case "$name" "$TEST_TMP/runs-$name-np" "$TEST_TMP/log-$name-np" "" ${CMDS[$name]//BRX/np}
  check_case "$name (parent unset)" "$TEST_TMP/runs-$name-np" "$TEST_TMP/log-$name-np" ""
done

# Detached hetero (--ledger/--run-id/--stage, the foreman hands path): the state serialized across the
# setsid boundary must carry CHILD_SESSION_ID and the manifest helpers, or the child loses --session-id and
# the final manifest rewrite nulls session_id/child_session_id.
LEDGER="$TEST_TMP/detach-ledger.jsonl"
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$LEDGER" >/dev/null
DRUNS="$TEST_TMP/runs-detached"; DLOG="$TEST_TMP/log-detached"; mkdir -p "$DRUNS"; : > "$DLOG"
( cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$DRUNS" STUB_LOG="$DLOG" DISPATCH_DETACH=1 \
    ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$PARENT" \
    "$HETERO" --runner cc-shim --model MiniMax-M3 --effort high --branch feat/csid-det --prompt-file "$PROMPT" \
    --ledger "$LEDGER" --run-id det-1 --stage implement >/dev/null 2>&1 ) || true
check_case "hetero-ccshim detached" "$DRUNS" "$DLOG" "$PARENT"
# Without a usable setsid the rail stays inline, so the checks above would pass without ever crossing the
# setsid boundary. The skip condition mirrors dispatch-hetero.sh HAVE_SETSID (setsid present AND --help has
# --wait); a setsid lacking --wait (busybox) makes the rail fall back, so it must skip, not fail.
if command -v setsid >/dev/null 2>&1 && setsid --help 2>&1 | grep -q -- --wait; then
  eq "setsid-detached" "$(mf_get "$(one_manifest "$DRUNS")" containment_planned)" "detached hetero: manifest containment_planned is setsid-detached"
else
  echo "SKIP [child-session-identity] detached containment: no setsid, or setsid does not support --wait; setsid-boundary assertion not run" >&2
fi

# A rail that starts no claude child leaves child_session_id null and still has the key.
GROK_STUB="$TEST_TMP/grok-stub"
printf '#!/usr/bin/env bash\nif [ "${1:-}" = "--list-models" ]; then printf "Available models\\n\\ngrok-4.5 - Grok 4.5\\n"; fi\nexit 0\n' > "$GROK_STUB"; chmod +x "$GROK_STUB"
mkdir -p "$TEST_TMP/runs-grok"
( cd "$SBX" && timeout 60 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-grok" AUTOPILOT_GROK_EFFORT_PROBE=0 \
    "$REVIEW" --runner grok --model grok-4.5 --diff-file "$DIFF" --bin "$GROK_STUB" >/dev/null 2>&1 ) || true
MF="$(one_manifest "$TEST_TMP/runs-grok")"
[ -n "$MF" ] && eq "<null>" "$(mf_get "$MF" child_session_id)" "grok review: child_session_id null (no claude child)" || fail "grok review: no manifest"

# --- the child's marker: SessionStart path records parent_session_id; set does not --------------
MD="$TEST_TMP/markers"; mkdir -p "$MD"
EPM='const sm=require(process.argv[1]);const r=sm.ensurePlainMarker({sessionId:process.argv[2],repoRoot:process.argv[3],scope:{project_key:"k",repo_identity:null},dir:process.argv[4]});process.stdout.write(r)'
env AUTOPILOT_PARENT_SESSION_ID="$PARENT" AUTOPILOT_CHILD_SESSION_ID=child-1 node -e "$EPM" "$REPO_ROOT/scripts/session-mode.js" child-1 "$SBX" "$MD" >/dev/null
eq "$PARENT" "$(mf_get "$MD/child-1.json" parent_session_id)" "SessionStart marker: parent_session_id from AUTOPILOT_PARENT_SESSION_ID when the payload id is AUTOPILOT_CHILD_SESSION_ID (3d)"
env -u AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID=child-2 node -e "$EPM" "$REPO_ROOT/scripts/session-mode.js" child-2 "$SBX" "$MD" >/dev/null
eq "<absent>" "$(mf_get "$MD/child-2.json" parent_session_id)" "SessionStart marker: no variable => no parent_session_id key"
# 3b rule 2: a session id equal to the launching session's own is the PARENT's marker: refused, nothing written.
eq "refused_parent" "$(env AUTOPILOT_PARENT_SESSION_ID=child-3 node -e "$EPM" "$REPO_ROOT/scripts/session-mode.js" child-3 "$SBX" "$MD")" "SessionStart marker: a session equal to the parent is refused"
[ ! -e "$MD/child-3.json" ] && eq ok ok "SessionStart marker: no file for a session equal to the parent" || fail "SessionStart marker: wrote the parent's own marker"
( cd "$SBX" && env AUTOPILOT_PARENT_SESSION_ID="$PARENT" AUTOPILOT_SESSION_MODE_DIR="$MD" CLAUDE_CODE_SESSION_ID=set-1 AUTOPILOT_RUNS_WATCH_AUTOSTART=0 \
    node "$REPO_ROOT/scripts/session-mode.js" set --level l3 --size S --repo-root "$SBX" >/dev/null 2>&1 ) || true
eq "<absent>" "$(mf_get "$MD/set-1.json" parent_session_id)" "session-mode set never writes parent_session_id (even with the variable in the env)"

finalize_test
