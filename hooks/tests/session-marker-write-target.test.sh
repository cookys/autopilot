#!/usr/bin/env bash
# dispatch-tree step 3b (D7, plan section 6) -- ONE resolver for every session-marker writer, and every rail
# hands its child runners its own write target as AUTOPILOT_PARENT_SESSION_ID (rule 3).
#   resolveMarkerWriteTarget({payloadId, explicitId, env}) -> {id, source}; with P = AUTOPILOT_PARENT_SESSION_ID set,
#   only payload / explicit (unless equal to P) / CLAUDE_CODE_SESSION_ID (only when != P) may be written under.
# Cases follow plan section 4 "3b" (a)-(h). Seams: session-mode.js / stage-advance.js / the SessionStart hook run for
# real against a scratch marker dir (AUTOPILOT_SESSION_MODE_DIR); dispatch-hetero.sh runs a stub codex / stub claude
# that records its own environment and (f)-(h) runs `session-mode.js set` from inside the child's environment.
# Every refusal case seeds the marker first and compares the BYTES before and after (sha256), not mere existence.
# Downstream readers of AUTOPILOT_SESSION_ID below a rail (grep of the tree, 2026-10-15), pinned in case (i):
#   src/engine/profile-runtime.js:588-590  deletes it from the runner env itself (the rail already scrubs it);
#   src/engine/autopilot-engine.js:147-148 deletes it from the verification env;
#   scripts/check-test-outcome.js: ENV_STRIP deletes it from the child env (scrub only, no read).
#   scripts/benchmark-hook-latency.js: deletes it (with CLAUDE_CODE_SESSION_ID / AUTOPILOT_PARENT_SESSION_ID) from the
#     env of every hook child it spawns, so the measurement starts from a clean session environment (scrub only).
#   hooks (run-approval-gate, foreman-guard, cost-fuse) read payload.session_id / CLAUDE_CODE_SESSION_ID first and
#   only fall back to it; campaign intake (scripts/open-decision.js, task-card.js) reads a chain that continues to
#   CLAUDE_CODE_SESSION_ID. None needs the variable to exist; the rails already `unset`/`env -u` it (author, review,
#   explore, hetero) before 3b, so removing it from a child changes nothing for them.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-smwt-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1 AUTOPILOT_RUNS_WATCH_AUTOSTART=0
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID \
  AUTOPILOT_SESSION_MODE_DIR 2>/dev/null || true

SM="$REPO_ROOT/scripts/session-mode.js"
SA="$REPO_ROOT/scripts/stage-advance.js"
HOOK="$REPO_ROOT/hooks/runs-watch-autostart.js"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
PROBE="$REPO_ROOT/scripts/probe-engine-capability.sh"
NODE="$(command -v node)"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX/.claude"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
: > "$SBX/.claude/smwt-config.md"   # opted in: the SessionStart hook reaches ensurePlainMarker
SBX="$(cd "$SBX" && pwd -P)"
RID="$(node -e 'process.stdout.write(require(process.argv[1]).markerRepoIdentity(process.argv[2]))' "$SM" "$SBX")"

MD="$TEST_TMP/markers"; mkdir -p "$MD"
P="pppppppp-1111-2222-3333-444444444444"
C="cccccccc-1111-2222-3333-444444444444"
X="xxxxxxxx-1111-2222-3333-444444444444"
sha() { sha256sum < "$1" | cut -d' ' -f1; }
mf_get() { node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const k=process.argv[2];process.stdout.write(!(k in o)?"<absent>":(o[k]===null?"<null>":String(o[k])))' "$1" "$2"; }

# seed <id> <level|null> <expires> [size]: a marker for <id> in $MD
seed() {
  node -e '
    const [id, level, exp, size, repo, rid, dir] = process.argv.slice(1);
    const m = { session_id: id, level: level === "null" ? null : level, repo_root: repo, repo_identity: rid, project_key: null,
      started_at: "2026-01-01T00:00:00.000Z", expires_at: exp, root_run_id: "job-seed" };
    if (size) m.size = size;
    require("fs").writeFileSync(require("path").join(dir, id + ".json"), JSON.stringify(m, null, 2) + "\n");
  ' "$1" "$2" "$3" "${4:-}" "$SBX" "$RID" "$MD"
}
FUTURE="2099-01-01T00:00:00.000Z"; PAST="2020-01-01T00:00:00.000Z"

# senv <extra env...> -- <cmd...>: the writer environment (no ids unless given), marker dir = $MD
RC=0; ERR=""
senv() {
  local -a e=()
  while [ "$1" != "--" ]; do e+=("$1"); shift; done; shift
  ERR="$(cd "$SBX" && env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_SESSION_MODE_DIR="$MD" ${e[@]+"${e[@]}"} "$@" 2>&1 >/dev/null)"; RC=$?
}
# refused <name> <file> <extra env...> -- <cmd...>: exit 3, one stderr line naming a source, file bytes unchanged
refused() {
  local name="$1" file="$2"; shift 2
  local before after; before="$(sha "$file")"
  senv "$@"
  after="$(sha "$file")"
  eq "3" "$RC" "$name: exit 3"
  eq "$before" "$after" "$name: marker bytes unchanged"
  eq "1" "$(printf '%s\n' "$ERR" | grep -c .)" "$name: exactly one stderr line"
  case "$ERR" in *source*) eq ok ok "$name: the line names the source" ;; *) fail "$name: stderr does not name a source: $ERR" ;; esac
}

# ---- (a) SessionStart payload == P, P exported: the parent's marker is never touched -----------------------------
seed "$P" null "$PAST"
BEFORE="$(sha "$MD/$P.json")"
printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup"}' "$P" "$SBX" > "$TEST_TMP/payload-p.json"
BIN="$TEST_TMP/gitonly"; mkdir -p "$BIN"; ln -sf "$(command -v git)" "$BIN/git"   # no flock on PATH: no watcher is started
( cd "$SBX" && env -u AUTOPILOT_RUNS_WATCH_AUTOSTART AUTOPILOT_RUNS_WATCH_AUTOSTART=1 PATH="$BIN" AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_PARENT_SESSION_ID="$P" \
    "$NODE" "$HOOK" < "$TEST_TMP/payload-p.json" >/dev/null 2>&1 )
eq "$BEFORE" "$(sha "$MD/$P.json")" "(a) hook, payload==P, expired P.json: bytes unchanged"
# control: the same hook path with no parent replaces the expired marker (the case reaches ensurePlainMarker)
( cd "$SBX" && env -u AUTOPILOT_RUNS_WATCH_AUTOSTART AUTOPILOT_RUNS_WATCH_AUTOSTART=1 PATH="$BIN" AUTOPILOT_SESSION_MODE_DIR="$MD" \
    "$NODE" "$HOOK" < "$TEST_TMP/payload-p.json" >/dev/null 2>&1 )
[ "$BEFORE" != "$(sha "$MD/$P.json")" ] && eq ok ok "(a) control: with P unset the hook replaces the expired marker (the path is live)" || fail "(a) control: hook never reached ensurePlainMarker"
# same through ensure-child
seed "$P" null "$PAST"; BEFORE="$(sha "$MD/$P.json")"
( cd "$SBX" && printf '{"session_id":"%s","cwd":"%s"}' "$P" "$SBX" | env AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_PARENT_SESSION_ID="$P" "$NODE" "$SM" ensure-child >/dev/null 2>&1 )
eq "$BEFORE" "$(sha "$MD/$P.json")" "(a) ensure-child, payload==P, expired P.json: bytes unchanged"
( cd "$SBX" && printf '{"session_id":"%s","cwd":"%s"}' "$C" "$SBX" | env AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_PARENT_SESSION_ID="$P" AUTOPILOT_CHILD_SESSION_ID="$C" "$NODE" "$SM" ensure-child >/dev/null 2>&1 )
eq "$P" "$(mf_get "$MD/$C.json" parent_session_id)" "(a) control: ensure-child with another payload id writes that marker, parent P (payload = C, 3d)"
rm -f "$MD/$C.json"

# ---- (b) CLAUDE_CODE_SESSION_ID == P and P exported: every writer refuses, P.json untouched ----------------------
# P.json is a live l5 marker (size S, repo identity set) and OLD.json a walked marker, so each writer WOULD change P.json.
OLD="oooooooo-1111-2222-3333-444444444444"
seed "$P" l5 "$FUTURE" S
node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));m.stage="implement";m.session_id=process.argv[2];fs.writeFileSync(process.argv[3],JSON.stringify(m,null,2)+"\n")' "$MD/$P.json" "$OLD" "$MD/$OLD.json"
BE="CLAUDE_CODE_SESSION_ID=$P AUTOPILOT_PARENT_SESSION_ID=$P"
refused "(b) set (plain)"            "$MD/$P.json" $BE -- "$NODE" "$SM" set
refused "(b) set --size S"           "$MD/$P.json" $BE -- "$NODE" "$SM" set --size S
refused "(b) set --level l3"         "$MD/$P.json" $BE -- "$NODE" "$SM" set --level l3
refused "(b) clear"                  "$MD/$P.json" $BE -- "$NODE" "$SM" clear
refused "(b) bind-campaign-root"     "$MD/$P.json" $BE -- "$NODE" "$SM" bind-campaign-root --root camp-1 --repo-root "$SBX"
refused "(b) stage-advance --resume-from" "$MD/$P.json" $BE -- "$NODE" "$SA" --resume-from "$OLD"
refused "(b) stage-advance --to"     "$MD/$P.json" $BE -- "$NODE" "$SA" --to implement
refused "(b) retire --session P"     "$MD/$P.json" $BE -- "$NODE" "$SM" retire --session "$P" --integration-receipt /nonexistent
seed "$P" null "$FUTURE"   # a plain P.json: a plain `set` that wrote under P would overwrite it (not just be refused by the l5 rule)
refused "(b) set (plain) over a plain P.json" "$MD/$P.json" $BE -- "$NODE" "$SM" set
rm -f "$MD/$P.json" "$MD/$OLD.json"   # no live l5 marker may remain: the rails below would demand a strict campaign
# the same writers are NOT refused with P unset (the refusal is the resolver, not a blanket failure)
senv CLAUDE_CODE_SESSION_ID="$C" -- "$NODE" "$SM" set --size S
eq "0" "$RC" "(b) control: set --size S with P unset and a plain id succeeds"
eq "S" "$(mf_get "$MD/$C.json" size)" "(b) control: it wrote that id's marker"
rm -f "$MD/$C.json"

# ---- (c) AUTOPILOT_SESSION_ID=X, CLAUDE_CODE_SESSION_ID=C, parent P: C.json written, X.json unchanged -------------
seed "$X" null "$FUTURE"; XB="$(sha "$MD/$X.json")"
senv AUTOPILOT_SESSION_ID="$X" CLAUDE_CODE_SESSION_ID="$C" AUTOPILOT_PARENT_SESSION_ID="$P" -- "$NODE" "$SM" set --size S
eq "0" "$RC" "(c) set --size S exits 0"
eq "S" "$(mf_get "$MD/$C.json" size)" "(c) C.json written"
eq "$XB" "$(sha "$MD/$X.json")" "(c) X.json byte-identical"
rm -f "$MD/$C.json"
# ---- (d) C with parent P -----------------------------------------------------------------------------------------
senv CLAUDE_CODE_SESSION_ID="$C" AUTOPILOT_PARENT_SESSION_ID="$P" -- "$NODE" "$SM" set --level none
eq "0" "$RC" "(d) plain set exits 0"
eq "$C" "$(mf_get "$MD/$C.json" session_id)" "(d) C.json written"
rm -f "$MD/$C.json"

# ---- rails: stub runners that record their environment, and (f)-(h) run `set` from inside it ---------------------
BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
cat > "$BINDIR/codex" <<'EOS'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
. "${STUB_BODY:?}"
EOS
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "claude 9.9.9 (test stub)"; exit 0; fi
. "${STUB_BODY:?}"
EOS
chmod +x "$BINDIR/codex" "$BINDIR/claude"
# The body every stub runs: record the ids it can see; optionally try a marker write from the launcher's cwd.
cat > "$TEST_TMP/stub-body.sh" <<'EOS'
cat >/dev/null 2>&1 || true
{
  for v in AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_SESSION_ID CLAUDE_SESSION_ID CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID; do
    if [ -n "${!v+x}" ]; then printf '%s=%s\n' "$v" "${!v}"; else printf '%s=<unset>\n' "$v"; fi
  done
} > "${STUB_LOG:?}"
if [ -n "${STUB_SET_CWD:-}" ]; then
  ( cd "$STUB_SET_CWD" && node "$STUB_SM" set --size S >/dev/null 2> "${STUB_LOG}.set-err"; echo "$?" > "${STUB_LOG}.set-rc" )
fi
touch stub_edit.txt
exit 0
EOS
PROMPT="$TEST_TMP/prompt.txt"; echo "do it" > "$PROMPT"
HRUNS="$TEST_TMP/hruns"; mkdir -p "$HRUNS"
HN=0
# hetero_run <runner: codex|ccshim> <log> <launcher env...>   (cwd = $SBX; the launcher env is exactly what is given)
hetero_run() {
  local runner="$1" log="$2"; shift 2
  HN=$((HN + 1)); : > "$log"
  local -a rargs=()
  if [ "$runner" = codex ]; then rargs=(--runner codex --model gpt-5.5 --codex-bin "$BINDIR/codex"); else rargs=(--runner cc-shim --model MiniMax-M3 --effort high); fi
  ( cd "$SBX" && timeout 120 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$HRUNS" AUTOPILOT_SESSION_MODE_DIR="$MD" \
      STUB_BODY="$TEST_TMP/stub-body.sh" STUB_LOG="$log" STUB_SM="$SM" ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=t \
      PATH="$BINDIR:$PATH" "$@" "$HETERO" "${rargs[@]}" --branch "feat/smwt-$HN" --prompt-file "$PROMPT" >"$log.out" 2>&1 ) || true
}
seen() { grep "^$2=" "$1" | head -1 | cut -d= -f2-; }   # seen <log> <VAR>

# ---- (e) stub codex under dispatch-hetero.sh sees P and no AUTOPILOT_SESSION_ID (D0 d2 row: codex got no parent) ----
hetero_run codex "$TEST_TMP/e-codex.log" CLAUDE_CODE_SESSION_ID="$C"
eq "$C" "$(seen "$TEST_TMP/e-codex.log" AUTOPILOT_PARENT_SESSION_ID)" "(e) hetero codex child sees AUTOPILOT_PARENT_SESSION_ID == the launcher's id"
hetero_run codex "$TEST_TMP/e-codex2.log" CLAUDE_CODE_SESSION_ID="$C" AUTOPILOT_SESSION_ID="$X"
eq "$X" "$(seen "$TEST_TMP/e-codex2.log" AUTOPILOT_PARENT_SESSION_ID)" "(e) hetero codex child: parent == the launcher's write target (AUTOPILOT_SESSION_ID binding wins, rule 1)"
eq "<unset>" "$(seen "$TEST_TMP/e-codex2.log" AUTOPILOT_SESSION_ID)" "(e) hetero codex child sees no AUTOPILOT_SESSION_ID"
eq "<unset>" "$(seen "$TEST_TMP/e-codex2.log" CLAUDE_CODE_SESSION_ID)" "(e) hetero codex child: CLAUDE_CODE_SESSION_ID (!= parent) is removed"
# stub claude under probe-engine-capability.sh
for runner in claude-native cc-shim; do
  : > "$TEST_TMP/e-probe-$runner.log"
  ( cd "$SBX" && env STUB_BODY="$TEST_TMP/stub-body.sh" STUB_LOG="$TEST_TMP/e-probe-$runner.log" STUB_SM="$SM" PATH="$BINDIR:$PATH" \
      CLAUDE_CODE_SESSION_ID="$C" AUTOPILOT_SESSION_ID="$X" ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=t \
      bash "$PROBE" quota --runner "$runner" --model claude-test --role reviewer --live-spend --store "$TEST_TMP/probe-store-$runner" >/dev/null 2>&1 ) || true
  eq "$X" "$(seen "$TEST_TMP/e-probe-$runner.log" AUTOPILOT_PARENT_SESSION_ID)" "(e) probe $runner: stub claude sees the parent id"
  eq "<unset>" "$(seen "$TEST_TMP/e-probe-$runner.log" AUTOPILOT_SESSION_ID)" "(e) probe $runner: stub claude sees no AUTOPILOT_SESSION_ID"
done
# author / review / explore, non-claude runner: the in-process runner branches get P and a scrubbed env too (rule 3).
# The launcher binds AUTOPILOT_SESSION_ID=X AND CLAUDE_CODE_SESSION_ID=C: the write target is X, and these rails scrub
# AUTOPILOT_SESSION_ID at startup, so P must be resolved BEFORE that scrub or the child is told C instead of X.
DIFFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFFF"
rail_codex() { # <name> <script> <args...>
  local name="$1" script="$2"; shift 2
  local log="$TEST_TMP/rail-$name.log"; : > "$log"
  ( cd "$SBX" && timeout 120 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$HRUNS" AUTOPILOT_SESSION_MODE_DIR="$MD" \
      STUB_BODY="$TEST_TMP/stub-body.sh" STUB_LOG="$log" PATH="$BINDIR:$PATH" AUTOPILOT_SETTLE_MS=0 \
      CLAUDE_CODE_SESSION_ID="$C" CLAUDE_SESSION_ID="cs-launch" AUTOPILOT_SESSION_ID="$X" CODEX_THREAD_ID="t-launch" \
      bash "$REPO_ROOT/scripts/$script" "$@" >"$log.out" 2>&1 ) || true
  eq "$X" "$(seen "$log" AUTOPILOT_PARENT_SESSION_ID)" "$name: the codex child sees AUTOPILOT_PARENT_SESSION_ID == the launcher's write target"
  eq "<unset>" "$(seen "$log" AUTOPILOT_SESSION_ID)" "$name: the codex child sees no AUTOPILOT_SESSION_ID"
  eq "<unset>" "$(seen "$log" CLAUDE_SESSION_ID)" "$name: the codex child sees no CLAUDE_SESSION_ID"
  eq "<unset>" "$(seen "$log" CLAUDE_CODE_SESSION_ID)" "$name: the codex child sees no CLAUDE_CODE_SESSION_ID (differs from the parent)"
  eq "t-launch" "$(seen "$log" CODEX_THREAD_ID)" "$name: the codex child keeps CODEX_THREAD_ID"
}
rail_codex "(e) author codex" dispatch-author.sh --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$BINDIR/codex" --timeout 30s --run-id smwt-a1
rail_codex "(e) review codex" dispatch-review.sh --runner codex --model gpt-5.5 --diff-file "$DIFFF" --bin "$BINDIR/codex" --run-id smwt-r1
# The manifest's session_id is the launching Claude Code session (C), not null: the rail scrubs C from the CHILD's env
# only, and its own manifest write must still see it. (Native runners share the same manifest writer and the same
# apply_env/pin calls, so the codex cells cover the shared path.)
eq "$C" "$(mf_get "$HRUNS/smwt-a1.manifest.json" session_id)" "(e) author codex: manifest session_id == the launcher's CLAUDE_CODE_SESSION_ID"
eq "$C" "$(mf_get "$HRUNS/smwt-r1.manifest.json" session_id)" "(e) review codex: manifest session_id == the launcher's CLAUDE_CODE_SESSION_ID"
rail_codex "(e) explore codex" dispatch-explore.sh --runner codex --model gpt-5.5 --bin "$BINDIR/codex" --prompt-file "$PROMPT"

# ---- (f)-(h): the child's own `session-mode set` -> exit 3, the launcher's marker byte-identical -------------------
WCWD="$(cd "$SBX" && node -e 'process.stdout.write(process.cwd().replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,64))')"
L="llllllll-1111-2222-3333-444444444444"; T="tttttttt-1111-2222-3333-444444444444"
child_set() { # <name> <marker-id> <expected-parent> <launcher env...>
  local name="$1" mid="$2" parent="$3"; shift 3
  seed "$mid" null "$FUTURE"; local before; before="$(sha "$MD/$mid.json")"
  local log="$TEST_TMP/$name.log"
  hetero_run ccshim "$log" STUB_SET_CWD="$SBX" "$@"
  eq "$parent" "$(seen "$log" AUTOPILOT_PARENT_SESSION_ID)" "$name: stub child sees parent == the launcher's id"
  eq "3" "$(cat "$log.set-rc" 2>/dev/null)" "$name: the child's set exits 3"
  eq "1" "$(grep -c . "$log.set-err" 2>/dev/null)" "$name: one stderr line"
  eq "$before" "$(sha "$MD/$mid.json")" "$name: $mid.json byte-identical"
}
child_set "(f) launcher CLAUDE_SESSION_ID only" "$L" "$L" CLAUDE_SESSION_ID="$L"
eq "<unset>" "$(seen "$TEST_TMP/(f) launcher CLAUDE_SESSION_ID only.log" CLAUDE_SESSION_ID)" "(f) the child no longer sees CLAUDE_SESSION_ID"
child_set "(g) launcher with no id (cwd)" "$WCWD" "$WCWD"
child_set "(h) launcher CODEX_THREAD_ID only" "$T" "$T" CODEX_THREAD_ID="$T"
eq "$T" "$(seen "$TEST_TMP/(h) launcher CODEX_THREAD_ID only.log" CODEX_THREAD_ID)" "(h) the child keeps CODEX_THREAD_ID"

# ---- (i) the downstream readers of AUTOPILOT_SESSION_ID are the ones listed in the header --------------------------
readers="$(cd "$REPO_ROOT" && grep -rlE 'AUTOPILOT_SESSION_ID' --include='*.js' --include='*.sh' src scripts hooks bin 2>/dev/null | grep -v '\.test\.' | sort | tr '\n' ' ')"
for f in src/engine/profile-runtime.js src/engine/autopilot-engine.js; do
  case " $readers" in *" $f "*) eq ok ok "(i) $f is a known AUTOPILOT_SESSION_ID site" ;; *) fail "(i) expected $f to name AUTOPILOT_SESSION_ID" ;; esac
done
eq "1" "$(grep -c 'delete runnerEnv.AUTOPILOT_SESSION_ID' "$REPO_ROOT/src/engine/profile-runtime.js")" "(i) profile-runtime.js deletes AUTOPILOT_SESSION_ID from the runner env (the rail's scrub is not new to it)"
eq "1" "$(grep -c 'delete verificationEnvironment.AUTOPILOT_SESSION_ID' "$REPO_ROOT/src/engine/autopilot-engine.js")" "(i) autopilot-engine.js deletes it from the verification env"
# RED at eeab54067b81ef0ceb813acfc5c72f61ef026a06: (i) no unreviewed reader ... got 'scripts/check-test-outcome.js '
eq "1" "$(grep -c 'AUTOPILOT_SESSION_ID' "$REPO_ROOT/scripts/check-test-outcome.js")" "(i) check-test-outcome.js names AUTOPILOT_SESSION_ID exactly once"
eq "1" "$(sed -n '/const ENV_STRIP = \[/,/^];$/p' "$REPO_ROOT/scripts/check-test-outcome.js" | grep -c 'AUTOPILOT_SESSION_ID')" "(i) that single AUTOPILOT_SESSION_ID site sits inside ENV_STRIP (a later real read turns this red)"
eq "1" "$(grep -c 'AUTOPILOT_SESSION_ID' "$REPO_ROOT/scripts/benchmark-hook-latency.js")" "(i) benchmark-hook-latency.js names AUTOPILOT_SESSION_ID exactly once"
eq "1" "$(grep 'AUTOPILOT_SESSION_ID' "$REPO_ROOT/scripts/benchmark-hook-latency.js" | grep -cE "for \\(const k of \\[.*\\]\\) delete env\\[k\\]")" "(i) that single AUTOPILOT_SESSION_ID line is the env scrub loop line itself (a read elsewhere or a key dropped from the loop turns this red)"
# every other reader must treat it as an optional fallback after payload / CLAUDE_CODE_SESSION_ID (or be a scrub)
unknown="$(cd "$REPO_ROOT" && for f in $readers; do
  case "$f" in
    src/engine/profile-runtime.js|src/engine/autopilot-engine.js) ;;
    scripts/session-mode.js|scripts/stage-advance.js) ;;                       # the resolver and its CLI
    scripts/dispatch-*.sh|scripts/run-grok-implementer-ab.sh|scripts/lib/*) ;;  # rails: they scrub it
    scripts/check-test-outcome.js) ;;  # scrub: ENV_STRIP deletes it from the child env
    scripts/benchmark-hook-latency.js) ;;  # scrub: deletes it from the spawned hook env (pinned scrub-only above)
    scripts/scaffold-mission.js) ;;                                             # prose: "never AUTOPILOT_SESSION_ID"
    scripts/open-decision.js|scripts/task-card.js) ;;                           # campaign intake: chain continues to CLAUDE_CODE_SESSION_ID
    hooks/run-approval-gate.js|hooks/foreman-guard.js|hooks/cost-fuse.js) ;;    # payload.session_id first, fallback only
    src/status/runs-watch.js) ;;                                                # prefers CLAUDE_CODE_SESSION_ID
    *) printf '%s ' "$f" ;;
  esac; done)"
eq "" "$unknown" "(i) no unreviewed reader of AUTOPILOT_SESSION_ID appeared (a new one must be classified in this test)"

finalize_test
