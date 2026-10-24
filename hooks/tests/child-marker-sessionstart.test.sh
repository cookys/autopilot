#!/usr/bin/env bash
# dispatch-tree step 3a (D2, BL-0142) -- the child end of the loop-back edge for author and review.
# The four claude launches (author/review x claude-native/cc-shim) hand the child `--settings` carrying a
# SessionStart hook; the hook is `session-mode.js ensure-child`, which writes a plain marker for the payload
# session id only, with parent_session_id from AUTOPILOT_PARENT_SESSION_ID. The rail also exports
# AUTOPILOT_SESSION_MODE_DIR (the launcher's marker dir) so a cc-shim scratch HOME cannot hide it.
# Seam: a stub `claude` that behaves like Claude Code's SessionStart for the one hook in `--settings`: it runs
# the configured command with {session_id:<its --session-id>, cwd} on stdin, in the stub's own environment.
# No real claude is started. Negative control: the same stub behind a wrapper that drops the `--settings`
# flag must leave no marker.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
seed_fake_claude_credentials "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-cmss-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID AUTOPILOT_SESSION_MODE_DIR 2>/dev/null || true

REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base

BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
# Stub claude: record cwd/HOME, then emulate SessionStart for the `--settings` hook (if any).
sid=""; settings=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-id) sid="$2"; shift 2 ;;
    --settings) settings="$2"; shift 2 ;;
    *) shift ;;
  esac
done
{ printf 'CWD:%s\n' "$PWD"; printf 'HOME:%s\n' "$HOME"; printf 'SID:%s\n' "$sid"; printf 'SETTINGS:%s\n' "${settings:+yes}"; } >> "${STUB_LOG:?}"
if [ -n "$settings" ] && [ -n "$sid" ]; then
  cmd="$(printf '%s' "$settings" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(o.hooks.SessionStart[0].hooks[0].command)')"
  printf 'HOOKCMD:%s\n' "$cmd" >> "${STUB_LOG}"
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup"}' "$sid" "$PWD" | bash -c "$cmd" >> "${STUB_LOG}.hook" 2>&1 || true
fi
cat >/dev/null
echo "ok"
exit 0
EOS
chmod +x "$BINDIR/claude"
# Negative-control wrapper: drops `--settings <value>` before the stub sees the argv.
cat > "$BINDIR/claude-nosettings" <<EOS
#!/usr/bin/env bash
args=()
while [ \$# -gt 0 ]; do
  if [ "\$1" = "--settings" ]; then shift 2; continue; fi
  args+=("\$1"); shift
done
exec "$BINDIR/claude" "\${args[@]}"
EOS
chmod +x "$BINDIR/claude-nosettings"
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"

mf_get() { node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const k=process.argv[2];process.stdout.write(!(k in o)?"<absent>":(o[k]===null?"<null>":String(o[k])))' "$1" "$2"; }
one_manifest() { find "$1" -name '*.manifest.json' | head -1; }

PARENT="aaaaaaaa-1111-2222-3333-444444444444"
declare -A CMDS
CMDS[author-native]="$AUTHOR --runner claude-native --model claude-haiku --prompt-file $PROMPT --bin @BIN@"
CMDS[author-ccshim]="$AUTHOR --runner cc-shim --model MiniMax-M3 --prompt-file $PROMPT --bin @BIN@"
CMDS[review-native]="$REVIEW --runner claude-native --model claude-haiku --diff-file $DIFF --bin @BIN@"
CMDS[review-ccshim]="$REVIEW --runner cc-shim --model MiniMax-M3 --endpoint TESTEP --diff-file $DIFF --bin @BIN@"

# run_shape <shape> <stub-bin> <tag> -> sets MD (marker dir), RUNS, LOG
run_shape() {
  local name="$1" bin="$2" tag="$3" cmd
  MD="$TEST_TMP/markers-$tag"; RUNS="$TEST_TMP/runs-$tag"; LOG="$TEST_TMP/log-$tag"
  mkdir -p "$MD" "$RUNS"; : > "$LOG"
  # P's marker, written before the rail runs; it must come out byte-identical.
  printf '{"session_id":"%s","level":null,"repo_root":"%s","expires_at":"2099-01-01T00:00:00.000Z","note":"parent"}\n' "$PARENT" "$SBX" > "$MD/$PARENT.json"
  PBEFORE="$(cksum < "$MD/$PARENT.json")"
  cmd="${CMDS[$name]//@BIN@/$bin}"
  # shellcheck disable=SC2086
  ( cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" STUB_LOG="$LOG" \
      AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_RUNS_WATCH_AUTOSTART=0 \
      ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$PARENT" \
      $cmd >/dev/null 2>&1 ) || true
}

for name in author-native author-ccshim review-native review-ccshim; do
  run_shape "$name" "$BINDIR/claude" "$name"
  mf="$(one_manifest "$RUNS")"
  [ -n "$mf" ] || { fail "$name: no manifest"; continue; }
  csid="$(mf_get "$mf" child_session_id)"
  eq "SETTINGS:yes" "$(grep '^SETTINGS:' "$LOG" | head -1)" "$name: the claude child is launched with --settings"
  # 3a left this untested: the hook command must name node by ABSOLUTE path, because a cc-shim child runs under a
  # scratch HOME where a $HOME-based node shim (asdf, nvm) would not resolve a bare `node`.
  hookcmd="$(grep '^HOOKCMD:' "$LOG" | head -1 | cut -d: -f2-)"
  case "$hookcmd" in "'/"*) eq ok ok "$name: the --settings hook command starts with an absolute node path" ;; *) fail "$name: the hook command does not start with an absolute node path: $hookcmd" ;; esac
  eq "$csid" "$(grep '^SID:' "$LOG" | head -1 | cut -d: -f2-)" "$name: stub saw --session-id == manifest child_session_id"
  if [ -f "$MD/$csid.json" ]; then
    eq "$PARENT" "$(mf_get "$MD/$csid.json" parent_session_id)" "$name: child marker parent_session_id == P"
    eq "$csid" "$(mf_get "$MD/$csid.json" session_id)" "$name: child marker session_id == manifest child_session_id"
  else
    fail "$name: no marker $csid.json in the launcher's marker dir ($(ls "$MD" | tr '\n' ' ')); hook output: $(cat "$LOG.hook" 2>/dev/null)"
  fi
  eq "$PBEFORE" "$(cksum < "$MD/$PARENT.json")" "$name: P.json is byte-identical"
  eq "2" "$(ls "$MD" | grep -c '\.json$')" "$name: exactly two markers (P and the child), nothing else"
  sh_home="$(grep '^HOME:' "$LOG" | head -1 | cut -d: -f2-)"; sh_cwd="$(grep '^CWD:' "$LOG" | head -1 | cut -d: -f2-)"
  case "$name" in
    *ccshim) [ "$sh_home" != "$HOME" ] && [ ! -e "$sh_home" ] && eq ok ok "$name: scratch HOME existed and is removed" || fail "$name: scratch HOME '$sh_home' still exists (or equals real HOME)" ;;
    *) [ ! -e "$sh_cwd" ] && eq ok ok "$name: scratch cwd removed" || fail "$name: scratch cwd '$sh_cwd' still exists" ;;
  esac
  [ ! -e "$HOME/.autopilot/session-mode/$csid.json" ] && eq ok ok "$name: nothing written under the real HOME" || fail "$name: marker leaked into the real HOME"
done

# The rail's own AUTOPILOT_SESSION_MODE_DIR export: the launcher sets NO marker-dir variable, only a scratch
# HOME holding .autopilot/session-mode. cc-shim swaps HOME for a scratch dir, so without the rail's export the
# child's hook would look under the (deleted) scratch HOME and the marker would be lost.
for name in author-ccshim review-ccshim; do
  FH="$TEST_TMP/fakehome-$name"; mkdir -p "$FH/.autopilot/session-mode"; RUNS="$TEST_TMP/runs-fh-$name"; LOG="$TEST_TMP/log-fh-$name"
  mkdir -p "$RUNS"; : > "$LOG"
  cmd="${CMDS[$name]//@BIN@/$BINDIR/claude}"
  # shellcheck disable=SC2086
  ( cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT -u AUTOPILOT_SESSION_MODE_DIR HOME="$FH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" STUB_LOG="$LOG" \
      AUTOPILOT_RUNS_WATCH_AUTOSTART=0 ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$PARENT" \
      $cmd >/dev/null 2>&1 ) || true
  mf="$(one_manifest "$RUNS")"; csid="$(mf_get "$mf" child_session_id)"
  if [ -f "$FH/.autopilot/session-mode/$csid.json" ]; then
    eq "$PARENT" "$(mf_get "$FH/.autopilot/session-mode/$csid.json" parent_session_id)" "$name (no marker-dir env at launch): child marker lands in the launcher's <HOME>/.autopilot/session-mode with parent P"
  else
    fail "$name (no marker-dir env at launch): no $csid.json under the launcher's HOME marker dir; hook output: $(cat "$LOG.hook" 2>/dev/null)"
  fi
done

# Negative control: with the hook flag removed there is no child marker (and P.json is untouched).
for name in author-native review-ccshim; do
  run_shape "$name" "$BINDIR/claude-nosettings" "nc-$name"
  mf="$(one_manifest "$RUNS")"; csid="$(mf_get "$mf" child_session_id)"
  eq "SETTINGS:" "$(grep '^SETTINGS:' "$LOG" | head -1)" "negative control $name: --settings really dropped"
  [ ! -e "$MD/$csid.json" ] && eq ok ok "negative control $name: no child marker without the hook flag" || fail "negative control $name: marker present without the hook flag"
done

# ensure-child unit rules: payload only, existing marker kept, no parent var => no parent key, fail-open.
UD="$TEST_TMP/unit"; mkdir -p "$UD"
printf '{"session_id":"u-1","cwd":"%s"}' "$SBX" | env AUTOPILOT_SESSION_MODE_DIR="$UD" AUTOPILOT_PARENT_SESSION_ID=pp AUTOPILOT_CHILD_SESSION_ID=u-1 node "$REPO_ROOT/scripts/session-mode.js" ensure-child
eq "pp" "$(mf_get "$UD/u-1.json" parent_session_id)" "ensure-child: parent from AUTOPILOT_PARENT_SESSION_ID when the payload id is AUTOPILOT_CHILD_SESSION_ID (3d)"
BEFORE="$(cksum < "$UD/u-1.json")"
printf '{"session_id":"u-1","cwd":"/elsewhere"}' | env AUTOPILOT_SESSION_MODE_DIR="$UD" AUTOPILOT_PARENT_SESSION_ID=other node "$REPO_ROOT/scripts/session-mode.js" ensure-child
eq "$BEFORE" "$(cksum < "$UD/u-1.json")" "ensure-child: an existing marker is kept"
printf '{"session_id":"u-2","cwd":"%s"}' "$SBX" | env -u AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID=u-2 AUTOPILOT_SESSION_MODE_DIR="$UD" AUTOPILOT_SESSION_ID=not-me CLAUDE_CODE_SESSION_ID=not-me-either node "$REPO_ROOT/scripts/session-mode.js" ensure-child
eq "<absent>" "$(mf_get "$UD/u-2.json" parent_session_id)" "ensure-child: no parent variable => no parent_session_id"
eq "2" "$(ls "$UD" | grep -c '\.json$')" "ensure-child: writes for payload.session_id only, never an env-derived id"
printf 'not json' | env AUTOPILOT_SESSION_MODE_DIR="$UD" node "$REPO_ROOT/scripts/session-mode.js" ensure-child; eq "0" "$?" "ensure-child: malformed payload exits 0"

# 3a left this untested: a scripts path containing a quote cannot be quoted into the hook command, so the rail
# installs no hook and must say so on stderr (otherwise the child just has no marker, silently).
QD="$TEST_TMP/q'uote"; mkdir -p "$QD"; cp -R "$REPO_ROOT/scripts" "$QD/scripts"
QLOG="$TEST_TMP/log-quote"; : > "$QLOG"; QRUNS="$TEST_TMP/runs-quote"; mkdir -p "$QRUNS"
QERR="$( cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$QRUNS" STUB_LOG="$QLOG" \
    AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers-quote" AUTOPILOT_RUNS_WATCH_AUTOSTART=0 PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$PARENT" \
    "$QD/scripts/dispatch-review.sh" --runner claude-native --model claude-haiku --diff-file "$DIFF" --bin "$BINDIR/claude" 2>&1 >/dev/null )" || true
case "$QERR" in *"contains a quote or backslash"*) eq ok ok "quoted scripts path: the rail warns on stderr that the child marker hook is not installed" ;; *) fail "quoted scripts path: no warning on stderr (got: ${QERR:0:200})" ;; esac
eq "SETTINGS:" "$(grep '^SETTINGS:' "$QLOG" | head -1)" "quoted scripts path: the claude child is launched without --settings"

finalize_test
