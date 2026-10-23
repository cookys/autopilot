#!/usr/bin/env bash
# dispatch-tree step 3d (D10, BL-0176) -- a child's parent record needs the rail's own child id.
# `ensurePlainMarker` records parent_session_id = P (AUTOPILOT_PARENT_SESSION_ID) only when the marker's own id equals
# C (AUTOPILOT_CHILD_SESSION_ID), the uuid the launching rail minted for that child. P alone is an inherited
# environment (a tmux or shell started inside a child), never proof of a child. Failure direction: not recorded.
#   (a) tmux reproduction: the environment a stub claude received, replayed for a new session Z, through
#       `session-mode.js ensure-child` AND `hooks/runs-watch-autostart.js` (full path; PATH carries git only, so no
#       flock and no watcher is started): Z.json has no parent_session_id; payload = C gives parent == P.
#   (b) P without C: no parent for any payload id.   (c) C without P: no parent.   (d) payload = P: refused_parent.
#   (e) per rail, pass: author and review x cc-shim, claude-native, and hetero cc-shim (all six run_worker wrapper
#       branches): the stub claude sees C == manifest child_session_id == its --session-id, and the hook-written
#       <C>.json has parent_session_id == P.
#   (f) per rail, scrub: with C pre-set in the rail's own environment, every other runner's stub sees C unset on every
#       invocation (`--version` and `--help` included). A runner with no stub that ran is `not_run` = FAIL.
# Seams: stub binaries that dump their own environment; the hook paths run for real against scratch dirs.
. "$(dirname "$0")/lib.sh"
export AUTOPILOT_TEST_ALLOW_HETERO_SEAMS=1   # HETERO_TEST_* seams in dispatch-hetero.sh are inert without it
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-cpr-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1 AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID \
  AUTOPILOT_CHILD_SESSION_ID AUTOPILOT_SESSION_MODE_DIR GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL 2>/dev/null || true

SM="$REPO_ROOT/scripts/session-mode.js"
HOOK="$REPO_ROOT/hooks/runs-watch-autostart.js"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
EXPLORE="$REPO_ROOT/scripts/dispatch-explore.sh"
FOREMAN="$REPO_ROOT/scripts/dispatch-foreman.sh"
PROBE="$REPO_ROOT/scripts/probe-engine-capability.sh"
NODE="$(command -v node)"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX/.claude"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
: > "$SBX/.claude/cpr-config.md"   # opted in: the SessionStart hook reaches ensurePlainMarker
printf 'secret.env\n' > "$SBX/.gitignore"; $GIT -C "$SBX" add .gitignore; $GIT -C "$SBX" commit -q -m gitignore
SBX="$(cd "$SBX" && pwd -P)"
GITONLY="$TEST_TMP/gitonly"; mkdir -p "$GITONLY"; ln -sf "$(command -v git)" "$GITONLY/git"   # no flock on PATH: no watcher starts

P="pppppppp-1111-2222-3333-444444444444"   # the launching session
Z="zzzzzzzz-1111-2222-3333-444444444444"   # a new top-level session started in a tmux inside the child
Q="qqqqqqqq-1111-2222-3333-444444444444"   # some other id the rail minted
C0="cccccccc-9999-8888-7777-666666666666"  # a C inherited by the rail itself (a rail running inside a claude child)
mf_get() { node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const k=process.argv[2];process.stdout.write(!(k in o)?"<absent>":(o[k]===null?"<null>":String(o[k])))' "$1" "$2"; }
sha() { sha256sum < "$1" | cut -d' ' -f1; }
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"
DUMPS="$TEST_TMP/dumps"; mkdir -p "$DUMPS"
HRUNS="$TEST_TMP/hruns"; mkdir -p "$HRUNS"

# ---- stubs --------------------------------------------------------------------------------------------------------
# claude stub: records its environment and --session-id, then emulates SessionStart: the `--settings` hook when given
# (author, review), else the plugin's runs-watch-autostart hook (hetero passes no --settings; the plugin hook is what
# writes the marker there). The hook runs in the stub's own environment, as Claude Code would run it.
BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "claude 9.9.9 (test stub)"; exit 0; fi
sid=""; settings=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-id) sid="$2"; shift 2 ;;
    --settings) settings="$2"; shift 2 ;;
    *) shift ;;
  esac
done
env | LC_ALL=C sort > "${STUB_DUMP:?}"
printf 'SID:%s\n' "$sid" > "${STUB_DUMP}.sid"
if [ -n "$sid" ]; then
  payload="$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup"}' "$sid" "$PWD")"
  if [ -n "$settings" ]; then
    cmd="$(printf '%s' "$settings" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(o.hooks.SessionStart[0].hooks[0].command)')"
    printf '%s' "$payload" | bash -c "$cmd" >> "${STUB_DUMP}.hook" 2>&1 || true
  else
    printf '%s' "$payload" | env AUTOPILOT_RUNS_WATCH_AUTOSTART=1 PATH="${STUB_HOOK_PATH:?}" "${STUB_NODE:?}" "${STUB_HOOK:?}" >> "${STUB_DUMP}.hook" 2>&1 || true
  fi
fi
[ -t 0 ] || timeout 2 cat >/dev/null 2>&1 || true
echo "ok"
exit 0
EOS
chmod +x "$BINDIR/claude"
# universal runner stub: appends the environment of EVERY invocation (--version, --help, the run) to $STUB_DUMP.
USTUB="$TEST_TMP/ustub"
cat > "$USTUB" <<'EOS'
#!/usr/bin/env bash
# an unwritable dump (the agy author wraps its runner in `bwrap --ro-bind / /`) falls back to stdout, which lands in the raw log
if [ -n "${STUB_DUMP:-}" ]; then { echo "---INVOCATION $(basename "$0") $*"; env | LC_ALL=C sort; } >> "$STUB_DUMP" 2>/dev/null || { echo "---INVOCATION $(basename "$0") $*"; env | LC_ALL=C sort; }; fi
case "$*" in
  *--version*)
    # opencode picks its adaptor from --version (an unrecognised line refuses), so the opencode-named stubs report one
    case "$(basename "$0")" in opencode|ocstub) echo "1.19.2" ;; *) echo "codex-cli 9.9.9 (test stub)" ;; esac
    exit 0 ;;
  *--help*)
    printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'
    printf '%s\n' 'Usage: kimi --model=<model>, --prompt <prompt>; --output-format=text [--plan]'
    exit 0 ;;
esac
[ -t 0 ] || timeout 2 cat >/dev/null 2>&1 || true
echo "stub ran"
touch stub_edit.txt 2>/dev/null || true
exit 0
EOS
chmod +x "$USTUB"
# the agy rails send the prompt on stdin as stream-json; this copy decodes it back for the legacy stub
AGYSTUB="$TEST_TMP/agystub"; cp "$USTUB" "$AGYSTUB"; make_agy_stdin_stub "$AGYSTUB"
OCSTUB="$TEST_TMP/ocstub"; ln -sf "$USTUB" "$OCSTUB"
PROBEBIN="$TEST_TMP/probebin"; mkdir -p "$PROBEBIN"
for n in codex agy grok qoderclicn cursor-agent claude kimi opencode; do ln -sf "$USTUB" "$PROBEBIN/$n"; done

# no_c <label> <dump>: the stub really ran (non-vacuous: a RUN invocation, not only a --version/--help preflight) and
# none of the run invocations saw C. The rail's own preflights (`codex --version`, `--help`) run in the rail's environment
# and start no session; the probe is checked strictly (no_c_all) because its plan row names its --version calls.
no_c() {
  local f="$2"
  assert_file_exists "$f" "$1: the stub runner actually ran (not_run counts as bad)"
  [ -f "$f" ] || { echo "  rail output: $(tail -c 400 "$f.out" 2>/dev/null | tr '\n' ' ')"; }
  assert_contains "$(cat "$f" 2>/dev/null)" "PATH=" "$1: the dump is a real environment"
  local run_blocks bad
  run_blocks="$(awk '/^---INVOCATION/{keep=($0 !~ /--version|--help/); n+=keep} END{print n+0}' "$f" 2>/dev/null)"
  [ "${run_blocks:-0}" -ge 1 ] && eq ok ok "$1: a run invocation (not only a preflight) reached the stub" || fail "$1: only preflight invocations reached the stub (not_run)"
  bad="$(awk '/^---INVOCATION/{keep=($0 !~ /--version|--help/)} keep && /^AUTOPILOT_CHILD_SESSION_ID=/{c++} END{print c+0}' "$f" 2>/dev/null)"
  eq "0" "$bad" "$1: the run invocation sees no AUTOPILOT_CHILD_SESSION_ID"
}
no_c_all() {
  assert_file_exists "$2" "$1: the stub runner actually ran (not_run counts as bad)"
  assert_contains "$(cat "$2" 2>/dev/null)" "PATH=" "$1: the dump is a real environment"
  eq "0" "$(grep -c '^AUTOPILOT_CHILD_SESSION_ID=' "$2" 2>/dev/null)" "$1: no invocation (--version and --help included) sees AUTOPILOT_CHILD_SESSION_ID"
}
# scrub_case <label> <cmd...>   (launcher env: P and an inherited C)
scrub_case() {
  local label="$1"; shift
  local dump="$DUMPS/${label//[^A-Za-z0-9_-]/_}.env"; rm -f "$dump"
  ( cd "$SBX" && timeout 120 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$HRUNS" \
      AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers-scrub" STUB_DUMP="$dump" \
      CLAUDE_CODE_SESSION_ID="$P" AUTOPILOT_CHILD_SESSION_ID="$C0" "$@" >"$dump.out" 2>&1 ) || true
  if [ ! -f "$dump" ]; then   # a stub that could only reach stdout: recover the dump from the rail's raw log
    local raw; raw="$(grep -o '"raw_log": "[^"]*"' "$dump.out" 2>/dev/null | head -1 | cut -d'"' -f4)"
    [ -n "$raw" ] && [ -f "$raw" ] && tr -d '\r' < "$raw" > "$dump"
  fi
  no_c "$label" "$dump"
}
mkdir -p "$TEST_TMP/markers-scrub" "$HOME/.gemini/antigravity-cli/log" "$HOME/.gemini/antigravity-cli/crashes"

# ======================================================================== (e) per rail, pass
# run_claude_rail <tag> <cmd...>: sets E_MD, E_RUNS, E_DUMP; the launcher is session P
run_claude_rail() {
  local tag="$1"; shift
  E_MD="$TEST_TMP/markers-$tag"; E_RUNS="$TEST_TMP/runs-$tag"; E_DUMP="$DUMPS/$tag.env"
  mkdir -p "$E_MD" "$E_RUNS"; rm -f "$E_DUMP" "$E_DUMP".*
  ( cd "$SBX" && timeout 120 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$E_RUNS" AUTOPILOT_SESSION_MODE_DIR="$E_MD" \
      STUB_DUMP="$E_DUMP" STUB_HOOK_PATH="$GITONLY" STUB_NODE="$NODE" STUB_HOOK="$HOOK" \
      ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$P" \
      "$@" >"$E_DUMP.out" 2>&1 ) || true
}
# check_pass <label> <runs-dir> <markers-dir> <dump>
check_pass() {
  local label="$1" runs="$2" md="$3" dump="$4" mf csid
  mf="$(find "$runs" -name '*.manifest.json' | head -1)"
  if [ -z "$mf" ] || [ ! -f "$dump" ]; then fail "$label: no manifest or no stub dump (not_run)"; return; fi
  csid="$(mf_get "$mf" child_session_id)"
  case "$csid" in *-*-*-*-*) eq ok ok "$label: manifest carries a minted child_session_id" ;; *) fail "$label: manifest child_session_id '$csid' is not a uuid" ;; esac
  eq "$csid" "$(grep '^AUTOPILOT_CHILD_SESSION_ID=' "$dump" | head -1 | cut -d= -f2-)" "$label: the stub claude sees AUTOPILOT_CHILD_SESSION_ID == manifest child_session_id"
  eq "$csid" "$(cut -d: -f2- "$dump.sid" 2>/dev/null)" "$label: the stub claude's --session-id == manifest child_session_id"
  eq "$P" "$(grep '^AUTOPILOT_PARENT_SESSION_ID=' "$dump" | head -1 | cut -d= -f2-)" "$label: the stub claude sees AUTOPILOT_PARENT_SESSION_ID == P"
  if [ -f "$md/$csid.json" ]; then
    eq "$P" "$(mf_get "$md/$csid.json" parent_session_id)" "$label: the hook-written <C>.json has parent_session_id == P"
  else
    fail "$label: no marker $csid.json written by the hook ($(ls "$md" | tr '\n' ' ')); hook output: $(cat "$dump.hook" 2>/dev/null)"
  fi
}

run_claude_rail author-native "$AUTHOR" --runner claude-native --model claude-haiku --prompt-file "$PROMPT" --bin "$BINDIR/claude" --timeout 60s
check_pass "(e) author claude-native" "$E_RUNS" "$E_MD" "$E_DUMP"
run_claude_rail author-ccshim "$AUTHOR" --runner cc-shim --model MiniMax-M3 --prompt-file "$PROMPT" --bin "$BINDIR/claude" --timeout 60s
check_pass "(e) author cc-shim" "$E_RUNS" "$E_MD" "$E_DUMP"
run_claude_rail review-native "$REVIEW" --runner claude-native --model claude-haiku --diff-file "$DIFF" --bin "$BINDIR/claude"
check_pass "(e) review claude-native" "$E_RUNS" "$E_MD" "$E_DUMP"
run_claude_rail review-ccshim "$REVIEW" --runner cc-shim --model MiniMax-M3 --endpoint TESTEP --diff-file "$DIFF" --bin "$BINDIR/claude"
check_pass "(e) review cc-shim" "$E_RUNS" "$E_MD" "$E_DUMP"
# remember the four environments for (a)
for t in author-native author-ccshim review-native review-ccshim; do [ -f "$DUMPS/$t.env" ] || :; done

# hetero cc-shim, all six run_worker wrapper branches (cgroup, setsid --wait, plain+setsid, plain no-setsid, detached x2)
REAL_SETSID="$(command -v setsid)"
NOCG_BIN="$TEST_TMP/nocg-bin"; mkdir -p "$NOCG_BIN"; printf '#!/usr/bin/env bash\nexit 1\n' > "$NOCG_BIN/systemd-run"; chmod +x "$NOCG_BIN/systemd-run"
NOWAIT_BIN="$TEST_TMP/nowait-bin"; mkdir -p "$NOWAIT_BIN"; cp "$NOCG_BIN/systemd-run" "$NOWAIT_BIN/systemd-run"
cat > "$NOWAIT_BIN/setsid" <<EOF
#!/usr/bin/env bash
[ "\${1:-}" = "--help" ] && { echo "usage: setsid [options] program"; exit 0; }
exec "$REAL_SETSID" "\$@"
EOF
chmod +x "$NOWAIT_BIN/setsid"
HN=0
# hetero_ccshim <label> <PATH prefix or ""> <detached 0|1> [extra env assignment]
hetero_ccshim() {
  local label="$1" pfx="$2" detached="$3" extra="${4:-X_UNUSED=1}"
  HN=$((HN+1)); local id="cpr-h$HN" tag="hetero-$HN"
  local md="$TEST_TMP/markers-$tag" runs="$TEST_TMP/runs-$tag" dump="$DUMPS/$tag.env" led="$TEST_TMP/ledger-$HN.jsonl"
  mkdir -p "$md" "$runs"; rm -f "$dump" "$dump".*
  local -a coords=(--run-id "$id"); local flag=0
  if [ "$detached" = 1 ]; then bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$led" >/dev/null; coords=(--ledger "$led" --run-id "$id" --stage implement); flag=1; fi
  ( cd "$SBX" && timeout 120 env -u REPO_ROOT -u CONSUMING_REPO_ROOT "$extra" DISPATCH_DETACH="$flag" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" AUTOPILOT_SESSION_MODE_DIR="$md" \
      STUB_DUMP="$dump" STUB_HOOK_PATH="$GITONLY" STUB_NODE="$NODE" STUB_HOOK="$HOOK" ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=t \
      PATH="${pfx:+$pfx:}$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$P" \
      bash "$HETERO" --runner cc-shim --model MiniMax-M3 --effort high --branch "feat/$id" --prompt-file "$PROMPT" "${coords[@]}" >"$dump.out" 2>&1 ) || true
  check_pass "$label" "$runs" "$md" "$dump"
}
hetero_ccshim "(e) hetero cc-shim cgroup branch" "" 0
hetero_ccshim "(e) hetero cc-shim setsid --wait branch" "$NOCG_BIN" 0
hetero_ccshim "(e) hetero cc-shim plain+setsid branch" "$NOWAIT_BIN" 0
hetero_ccshim "(e) hetero cc-shim plain no-setsid branch" "$NOCG_BIN" 0 HETERO_TEST_NO_SETSID=1
hetero_ccshim "(e) hetero cc-shim detached+setsid branch" "" 1
hetero_ccshim "(e) hetero cc-shim detached no-setsid branch" "" 1 HETERO_TEST_NO_SETSID=1

# ======================================================================== (a)-(d) the writer
# replay <dump> <label> <marker-dir> <payload-id> <path: ensure|hook> [-u NAME ...]: run the writer in EXACTLY the
# environment the stub claude received (what a tmux started inside that child would hold), only the marker dir and PATH
# (git alone) replaced. Output: the marker dir gets <payload-id>.json or nothing.
replay() {
  local dump="$1" md="$2" id="$3" path="$4"; shift 4
  local -a envv=()
  while IFS= read -r line; do case "$line" in *=*) envv+=("$line") ;; esac; done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$dump" | grep -v '^_=' )
  local payload; payload="$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup"}' "$id" "$SBX")"
  if [ "$path" = ensure ]; then
    ( cd "$SBX" && printf '%s' "$payload" | env -i "${envv[@]}" "$@" AUTOPILOT_SESSION_MODE_DIR="$md" "$NODE" "$SM" ensure-child >/dev/null 2>"$md/.err-$id" )
  else
    ( cd "$SBX" && printf '%s' "$payload" | env -i "${envv[@]}" "$@" AUTOPILOT_SESSION_MODE_DIR="$md" AUTOPILOT_RUNS_WATCH_AUTOSTART=1 PATH="$GITONLY" "$NODE" "$HOOK" >/dev/null 2>"$md/.err-$id" )
  fi
}
for t in author-native author-ccshim review-native review-ccshim hetero-1; do
  d="$DUMPS/$t.env"
  if [ ! -f "$d" ]; then fail "(a) $t: no stub dump to replay (not_run)"; continue; fi
  C_T="$(grep '^AUTOPILOT_CHILD_SESSION_ID=' "$d" | head -1 | cut -d= -f2-)"
  eq "$P" "$(grep '^AUTOPILOT_PARENT_SESSION_ID=' "$d" | head -1 | cut -d= -f2-)" "(a) $t: the replayed environment holds P"
  [ -n "$C_T" ] && eq ok ok "(a) $t: the replayed environment holds C" || fail "(a) $t: the stub received no C, nothing to replay"
  for path in ensure hook; do
    R="$TEST_TMP/replay-$t-$path"; rm -rf "$R"; mkdir -p "$R"
    replay "$d" "$R" "$Z" "$path"
    if [ -f "$R/$Z.json" ]; then eq "<absent>" "$(mf_get "$R/$Z.json" parent_session_id)" "(a) $t via $path: a new session Z in the inherited environment records no parent"
    else fail "(a) $t via $path: no Z.json written (the writer path did not run: $(cat "$R/.err-$Z" 2>/dev/null))"; fi
    replay "$d" "$R" "$C_T" "$path"
    if [ -f "$R/$C_T.json" ]; then eq "$P" "$(mf_get "$R/$C_T.json" parent_session_id)" "(a) $t via $path: the same environment with payload = C gives parent_session_id == P"
    else fail "(a) $t via $path: no C.json written ($(cat "$R/.err-$C_T" 2>/dev/null))"; fi
  done
done

# (b) P set, C unset: no parent for any payload id.  (c) C set, P unset: no parent.  (d) payload = P: refused_parent.
for path in ensure hook; do
  for id in "$Z" "$Q" "$P"; do
    R="$TEST_TMP/b-$path-$id"; mkdir -p "$R"
    ( cd "$SBX" && printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart"}' "$id" "$SBX" | \
        env -i HOME="$HOME" AUTOPILOT_SESSION_MODE_DIR="$R" AUTOPILOT_PARENT_SESSION_ID="$P" AUTOPILOT_RUNS_WATCH_AUTOSTART=1 PATH="$GITONLY" \
        "$NODE" "$( [ "$path" = ensure ] && echo "$SM" || echo "$HOOK" )" $( [ "$path" = ensure ] && echo ensure-child ) >/dev/null 2>&1 )
    if [ "$id" = "$P" ]; then
      [ ! -e "$R/$P.json" ] && eq ok ok "(b)/(d) $path: P set, C unset, payload = P: no marker for P" || fail "(b)/(d) $path: wrote P's own marker"
    elif [ -f "$R/$id.json" ]; then eq "<absent>" "$(mf_get "$R/$id.json" parent_session_id)" "(b) $path: P set, C unset, payload $id: no parent"
    else fail "(b) $path: no marker written for $id (the writer did not run)"; fi
  done
  R="$TEST_TMP/c-$path"; mkdir -p "$R"
  ( cd "$SBX" && printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart"}' "$Q" "$SBX" | \
      env -i HOME="$HOME" AUTOPILOT_SESSION_MODE_DIR="$R" AUTOPILOT_CHILD_SESSION_ID="$Q" AUTOPILOT_RUNS_WATCH_AUTOSTART=1 PATH="$GITONLY" \
      "$NODE" "$( [ "$path" = ensure ] && echo "$SM" || echo "$HOOK" )" $( [ "$path" = ensure ] && echo ensure-child ) >/dev/null 2>&1 )
  if [ -f "$R/$Q.json" ]; then eq "<absent>" "$(mf_get "$R/$Q.json" parent_session_id)" "(c) $path: C set, P unset, payload = C: no parent"
  else fail "(c) $path: no marker written for $Q (the writer did not run)"; fi
  # (d) with C set too: payload = P stays refused, the P marker is byte-identical
  R="$TEST_TMP/d-$path"; mkdir -p "$R"
  printf '{"session_id":"%s","level":null,"repo_root":"%s","expires_at":"2020-01-01T00:00:00.000Z","note":"parent"}\n' "$P" "$SBX" > "$R/$P.json"
  before="$(sha "$R/$P.json")"
  ( cd "$SBX" && printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart"}' "$P" "$SBX" | \
      env -i HOME="$HOME" AUTOPILOT_SESSION_MODE_DIR="$R" AUTOPILOT_PARENT_SESSION_ID="$P" AUTOPILOT_CHILD_SESSION_ID="$Q" AUTOPILOT_RUNS_WATCH_AUTOSTART=1 PATH="$GITONLY" \
      "$NODE" "$( [ "$path" = ensure ] && echo "$SM" || echo "$HOOK" )" $( [ "$path" = ensure ] && echo ensure-child ) >/dev/null 2>"$R/err" )
  eq "$before" "$(sha "$R/$P.json")" "(d) $path: payload = P (C set too): P.json byte-identical"
  [ "$path" = ensure ] && assert_contains "$(cat "$R/err")" "child_is_parent" "(d) ensure-child: refused_parent is reported"
done
eq "refused_parent" "$(env -i HOME="$HOME" AUTOPILOT_PARENT_SESSION_ID="$P" AUTOPILOT_CHILD_SESSION_ID="$P" "$NODE" -e 'process.stdout.write(require(process.argv[1]).ensurePlainMarker({sessionId:process.argv[2],repoRoot:process.argv[3],scope:{},dir:process.argv[4]}))' "$SM" "$P" "$SBX" "$TEST_TMP/d-direct")" "(d) direct writer: payload = P = C is still refused_parent (the refusal stays first)"

# ======================================================================== (f) per rail, scrub
echo "create ok" > "$TEST_TMP/author-prompt.txt"
scrub_case "(f) author codex" PATH="$BINDIR:$PATH" bash "$AUTHOR" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$USTUB" --timeout 30s --run-id cpr-a-codex
# the kimi transport resolves `kimi` from PATH itself (--bin is only an existence check), so the stub is named kimi
scrub_case "(f) author kimi" PATH="$PROBEBIN:$PATH" bash "$AUTHOR" --runner kimi --model kimi-code/k3 --prompt-file "$PROMPT" --bin kimi --timeout 30s --run-id cpr-a-kimi
scrub_case "(f) author agy" PATH="$BINDIR:$PATH" bash "$AUTHOR" --runner agy --model gemini-test --prompt-file "$PROMPT" --bin "$AGYSTUB" --timeout 30s --run-id cpr-a-agy
scrub_case "(f) review codex" PATH="$BINDIR:$PATH" bash "$REVIEW" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$USTUB" --run-id cpr-r-codex
scrub_case "(f) review opencode" PATH="$BINDIR:$PATH" bash "$REVIEW" --runner opencode --model oc-test --diff-file "$DIFF" --bin "$OCSTUB" --run-id cpr-r-opencode
scrub_case "(f) review kimi" PATH="$BINDIR:$PATH" bash "$REVIEW" --runner kimi --model kimi-test --diff-file "$DIFF" --bin "$USTUB" --run-id cpr-r-kimi
scrub_case "(f) explore codex" PATH="$BINDIR:$PATH" bash "$EXPLORE" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --repo "$SBX" --bin "$USTUB" --timeout 30s --no-probe
scrub_case "(f) explore agy" PATH="$BINDIR:$PATH" bash "$EXPLORE" --runner agy --model gemini-test --prompt-file "$PROMPT" --repo "$SBX" --bin "$AGYSTUB" --timeout 30s --no-probe
HN2=0
# hetero_scrub <label> <runner> <bin-flag> [detached 0|1] [script path]
hetero_scrub() {
  local label="$1" runner="$2" binflag="$3" detached="${4:-0}" script="${5:-$HETERO}"
  local stub="$USTUB"; [ "$runner" = opencode ] && stub="$OCSTUB"; [ "$runner" = agy ] && stub="$AGYSTUB"
  HN2=$((HN2+1)); local id="cpr-hs$HN2" led="$TEST_TMP/ledger-hs-$HN2.jsonl"
  local -a coords=(--run-id "$id"); local flag=0
  if [ "$detached" = 1 ]; then bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$led" >/dev/null; coords=(--ledger "$led" --run-id "$id" --stage implement); flag=1; fi
  scrub_case "$label" DISPATCH_DETACH="$flag" PATH="$BINDIR:$PATH" bash "$script" --runner "$runner" --model m "$binflag" "$stub" --branch "feat/$id" --prompt-file "$PROMPT" "${coords[@]}"
}
hetero_scrub "(f) hetero codex" codex --codex-bin
hetero_scrub "(f) hetero kimi" kimi --kimi-bin
hetero_scrub "(f) hetero agy" agy --agy-bin
hetero_scrub "(f) hetero opencode" opencode --opencode-bin
hetero_scrub "(f) hetero codex detached" codex --codex-bin 1
# helper absent: a mirror of the tree whose scripts/lib has no repo-identity.sh, so dispatch-hetero.sh takes its :3653 fallback
MIR="$TEST_TMP/mirror"; mkdir -p "$MIR/scripts/lib"
for e in "$REPO_ROOT"/*; do b="$(basename "$e")"; [ "$b" = scripts ] || ln -s "$e" "$MIR/$b"; done
for e in "$REPO_ROOT"/scripts/*; do b="$(basename "$e")"; [ "$b" = lib ] || ln -s "$e" "$MIR/scripts/$b"; done
for e in "$REPO_ROOT"/scripts/lib/*; do b="$(basename "$e")"; [ "$b" = repo-identity.sh ] || ln -s "$e" "$MIR/scripts/lib/$b"; done
hetero_scrub "(f) hetero codex, helper absent (fallback)" codex --codex-bin 0 "$MIR/scripts/dispatch-hetero.sh"

# foreman hand: the AUTOPILOT_* allowlist route and the --env-passthrough route
FSD="$TEST_TMP/foreman-stub"; mkdir -p "$FSD" "$TEST_TMP/foreman-bin"
cat > "$TEST_TMP/foreman-bin/kimi" <<'STUB'
#!/usr/bin/env bash
env | LC_ALL=C sort >> "$KIMI_STUB_DIR/env.all"
echo '{"role":"meta","type":"system.version","version":"0.41.0"}'
printf 'done: x\nnot done: (none)\n' > "$KIMI_STUB_REPORT_DIR/REPORT.md"
printf '{"role":"assistant","content":"DONE"}\n'
STUB
chmod +x "$TEST_TMP/foreman-bin/kimi"
echo "brief" > "$TEST_TMP/brief.md"; echo "plan" > "$TEST_TMP/plan.md"
foreman_case() { # <label> <stub-dir> [extra args...]   (C inherited in the launcher env either way)
  local label="$1" sd="$2"; shift 2
  mkdir -p "$sd"; rm -f "$sd/env.all"
  ( cd "$SBX" && PATH="$TEST_TMP/foreman-bin:$PATH" KIMI_STUB_DIR="$sd" KIMI_STUB_REPORT_DIR="$TEST_TMP/foreman-run-$$-$RANDOM" \
      CLAUDE_CODE_SESSION_ID="$P" AUTOPILOT_CHILD_SESSION_ID="$C0" AUTOPILOT_KEEP_ME=kept \
      bash "$FOREMAN" --brief-file "$TEST_TMP/brief.md" --plan-file "$TEST_TMP/plan.md" --run-id "cpr-f-$RANDOM" --poll 0.2 "$@" >"$sd/out" 2>&1 ) || true
  no_c_all "$label" "$sd/env.all"
  assert_contains "$(cat "$sd/env.all" 2>/dev/null)" "AUTOPILOT_KEEP_ME=kept" "$label: other AUTOPILOT_* still pass (the exclusion is targeted)"
}
foreman_case "(f) foreman hand, C inherited (allowlist route)" "$FSD/inherited" --run-dir "$TEST_TMP/fr1"
foreman_case "(f) foreman hand, --env-passthrough AUTOPILOT_CHILD_SESSION_ID" "$FSD/passthrough" --run-dir "$TEST_TMP/fr2" --env-passthrough AUTOPILOT_CHILD_SESSION_ID

# probe-engine-capability.sh x every runner: every stub invocation (--version, the live branch, or none) sees no C
for runner in cc-shim claude-native codex agy grok qoderclicn cursor kimi opencode; do
  for mode in live noop; do
    label="(f) probe $runner ($mode)"
    dump="$DUMPS/probe-$runner-$mode.env"; rm -f "$dump"
    args=(quota --runner "$runner" --model m-test --role reviewer --store "$TEST_TMP/probe-store-$runner-$mode")
    [ "$mode" = live ] && args+=(--live-spend)
    ( cd "$SBX" && timeout 90 env STUB_DUMP="$dump" PATH="$PROBEBIN:$PATH" CLAUDE_CODE_SESSION_ID="$P" AUTOPILOT_CHILD_SESSION_ID="$C0" \
        ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=t bash "$PROBE" "${args[@]}" >"$dump.out" 2>&1 ) || true
    no_c_all "$label" "$dump"
  done
done

finalize_test
