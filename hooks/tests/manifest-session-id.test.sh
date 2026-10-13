#!/usr/bin/env bash
# Live-pane plan 7.1 identity hand-off 2 -- every dispatch rail that writes a run manifest records
# session_id = $CLAUDE_CODE_SESSION_ID (null when unset, never a failure). Seam: run each rail end to end
# with a stub runner under its own AUTOPILOT_DISPATCH_RUNS_DIR; an old manifest without the field is read
# fine by dispatch-status.js --list and `autopilot status runs --json`.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

# Isolation: fake HOME/config/live dirs; manifests only under TEST_TMP.
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
# Live dir must be tmpfs and mode 0700 (see manifest-repo-identity.test.sh).
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-msid-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_GROK_EFFORT_PROBE=0
export DISPATCH_QUIET=1
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID 2>/dev/null || true

HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"

mk_repo() { mkdir -p "$1"; $GIT -C "$1" init -q; $GIT -C "$1" commit -q --allow-empty -m base; }
SBX="$TEST_TMP/repo-a"; mk_repo "$SBX"

mf_get() { # <file> <field> -> value, "<null>" for JSON null, "<absent>" when key missing
  node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const k = process.argv[2];
    if (!(k in o)) process.stdout.write("<absent>");
    else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));
  ' "$1" "$2"
}
one_manifest() { find "$1" -name '*.manifest.json' | head -1; }

GROK_STUB="$TEST_TMP/grok-stub"
cat > "$GROK_STUB" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "--list-models" ]; then
  printf 'Available models\n\ngrok-4.5 - Grok 4.5\n'
  exit 0
fi
case " $* " in *" __autopilot_probe__ "*)
  echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: high, medium, low" >&2
  exit 1 ;;
esac
exit 0
EOS
chmod +x "$GROK_STUB"
PROMPT="$TEST_TMP/prompt.txt"; echo "create ok.txt" > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"

run_hetero() { # <runs> <cwd> [extra env...]
  local runs="$1" cwd="$2"; shift 2
  mkdir -p "$runs"
  ( cd "$cwd" && timeout 60 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$runs" "$@" \
      "$HETERO" --runner grok --model grok-4.5 --effort high --grok-bin "$GROK_STUB" \
      --branch "feat/sid-$RANDOM" --prompt-file "$PROMPT" >/dev/null 2>&1 ) || true
}
run_review() { # <runs> <cwd> [extra env...]
  local runs="$1" cwd="$2"; shift 2
  mkdir -p "$runs"
  ( cd "$cwd" && timeout 60 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$runs" "$@" \
      "$REVIEW" --runner grok --model grok-4.5 --diff-file "$DIFF" --bin "$GROK_STUB" >/dev/null 2>&1 ) || true
}
run_author() { # <runs> <cwd> [extra env...]
  local runs="$1" cwd="$2"; shift 2
  mkdir -p "$runs"
  ( cd "$cwd" && timeout 60 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$runs" "$@" \
      "$AUTHOR" --runner grok --model grok-4.5 --prompt-file "$PROMPT" --bin "$GROK_STUB" >/dev/null 2>&1 ) || true
}

SID="11111111-2222-3333-4444-555555555555"

# --- 1. set: the manifest carries CLAUDE_CODE_SESSION_ID, never AUTOPILOT_SESSION_ID ---
for rail in hetero review author; do
  runs="$TEST_TMP/runs-$rail"; "run_$rail" "$runs" "$SBX" CLAUDE_CODE_SESSION_ID="$SID" AUTOPILOT_SESSION_ID=parent-x
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$rail: no manifest written under $runs"; continue; }
  eq "$SID" "$(mf_get "$mf" session_id)" "$rail: manifest session_id == CLAUDE_CODE_SESSION_ID"
done

# --- 2. unset: null, and the rail still wrote its manifest ---
for rail in hetero review author; do
  runs="$TEST_TMP/runs-$rail-unset"; "run_$rail" "$runs" "$SBX"
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$rail (unset): no manifest"; continue; }
  eq "<null>" "$(mf_get "$mf" session_id)" "$rail: session_id null when CLAUDE_CODE_SESSION_ID unset"
done

# --- 3. quote/backslash in the id still yields valid JSON ---
runs="$TEST_TMP/runs-review-odd"; run_review "$runs" "$SBX" CLAUDE_CODE_SESSION_ID='we"ird\id'
mf="$(one_manifest "$runs")"
[ -n "$mf" ] || fail "review (odd id): no manifest"
eq 'we"ird\id' "$(mf_get "$mf" session_id)" "review: quote/backslash in the id round-trips"

# --- 4. old manifest (no session_id) and a new one are both read ---
OLDRUNS="$TEST_TMP/runs-old"; mkdir -p "$OLDRUNS"
cat > "$OLDRUNS/old-run-1.manifest.json" <<EOM
{ "schema": 1, "run_id": "old-run-1", "role": "reviewer", "runner": "grok", "model": "m", "branch": null, "base": null, "base_sha": null, "worktree": null, "lock_path": null, "log_path": "$TEST_TMP/none.log", "log_format": "plain", "aux_log": null, "pid": 1, "scope_unit": null, "containment_planned": "scratch", "started_at": "2026-01-01T00:00:00Z", "started_epoch": 1767225600, "prompt_file": "p", "diff_file": "d", "ledger": null, "stage": null, "ended_at": "2026-01-01T00:01:00Z", "ended_epoch": 1767225660, "final_status": "reviewed", "parent_run_id": null, "root_run_id": null, "depth": 0 }
EOM
cp "$(one_manifest "$TEST_TMP/runs-review")" "$OLDRUNS/new-run-1.manifest.json"
NEWID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).run_id)' "$OLDRUNS/new-run-1.manifest.json")"
CHECK='
  const rows = JSON.parse(process.argv[1]);
  const old = rows.find((r) => r.run_id === "old-run-1"), nw = rows.find((r) => r.run_id === process.argv[2]);
  if (!old || !nw || old.session_id !== null || nw.session_id !== process.argv[3]) { console.error(process.argv[1]); process.exit(1); }
'
OUT="$(cd "$REPO_ROOT" && env AUTOPILOT_DISPATCH_RUNS_DIR="$OLDRUNS" node bin/autopilot.js status runs --json < /dev/null 2>/dev/null)"; RC=$?
eq "0" "$RC" "status runs --json exits 0 with an old + a new manifest"
node -e "$CHECK" "$OUT" "$NEWID" "$SID"
eq "0" "$?" "status runs --json: old row session_id null, new row carries it"
LIST="$(AUTOPILOT_DISPATCH_RUNS_DIR="$OLDRUNS" node "$REPO_ROOT/scripts/dispatch-status.js" --list 2>/dev/null)"
node -e "$CHECK" "$LIST" "$NEWID" "$SID"
eq "0" "$?" "dispatch-status.js --list: old null, new carries session_id"

finalize_test
