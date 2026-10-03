#!/usr/bin/env bash
# mods plan P1a R1 — every dispatch rail that writes a run manifest records
# repo_identity + repo_identity_source (dispatch-hetero / dispatch-review /
# dispatch-author each write one; seam = run the rail end to end with a stub runner and
# AUTOPILOT_DISPATCH_RUNS_DIR). REPO_ROOT beats CONSUMING_REPO_ROOT; a git that refuses
# --path-format records null + git_rev_parse_failed; an old manifest lacking the fields
# is read fine by `autopilot status runs --json`.
# RED at 532930ed (the three rails wrote manifests without the fields; 2 passed, 21 failed):
#   FAIL [manifest-repo-identity] hetero: manifest repo_identity == Node repoIdentity(cwd repo): expected 'git-common-dir:...repo-a/.git', got '<absent>'
#   FAIL [manifest-repo-identity] review: source is consuming_repo_root when no --repo-root: expected 'consuming_repo_root', got '<absent>'
#   FAIL [manifest-repo-identity] author --repo-root: identity comes from REPO_ROOT, not cwd: expected 'git-common-dir:...repo-b/.git', got '<absent>'
#   FAIL [manifest-repo-identity] hetero old git: source git_rev_parse_failed: expected 'git_rev_parse_failed', got '<absent>'
#   FAIL [manifest-repo-identity] resolver: REPO_ROOT beats CONSUMING_REPO_ROOT: expected '0', got '1'
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

# Isolation: fake HOME/config/live dirs; manifests only under TEST_TMP.
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_GROK_EFFORT_PROBE=0
export DISPATCH_QUIET=1
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
LIB="$REPO_ROOT/scripts/lib/repo-identity.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"

mk_repo() { mkdir -p "$1"; $GIT -C "$1" init -q; $GIT -C "$1" commit -q --allow-empty -m base; }
SBX="$TEST_TMP/repo-a";  mk_repo "$SBX"
OTHER="$TEST_TMP/repo-b"; mk_repo "$OTHER"
NOGIT="$TEST_TMP/not-a-repo"; mkdir -p "$NOGIT"

node_identity() {
  node -e '
    const id = require(process.argv[1]).repoIdentity(process.argv[2]);
    process.stdout.write(id === null ? "<null>" : id);
  ' "$REPO_ROOT/src/status/task-runtime.js" "$1"
}
mf_get() { # <file> <field> -> value, "<null>" for JSON null, "<absent>" when key missing
  node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const k = process.argv[2];
    if (!(k in o)) process.stdout.write("<absent>");
    else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));
  ' "$1" "$2"
}
one_manifest() { find "$1" -name '*.manifest.json' | head -1; }

# --- stubs ---------------------------------------------------------------------
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
      --branch "feat/ri-$RANDOM" --prompt-file "$PROMPT" >/dev/null 2>&1 ) || true
}
run_review() { # <runs> <cwd> [extra env...]
  local runs="$1" cwd="$2"; shift 2
  mkdir -p "$runs"
  ( cd "$cwd" && timeout 60 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$runs" "$@" \
      "$REVIEW" --runner grok --model grok-4.5 --diff-file "$DIFF" --bin "$GROK_STUB" >/dev/null 2>&1 ) || true
}
run_author() { # <runs> <cwd> <extra args...>   (env via ENV_EXTRA array not supported; use PATH override outside)
  local runs="$1" cwd="$2"; shift 2
  mkdir -p "$runs"
  ( cd "$cwd" && timeout 60 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      "$AUTHOR" --runner grok --model grok-4.5 --prompt-file "$PROMPT" --bin "$GROK_STUB" "$@" >/dev/null 2>&1 ) || true
}

EXPECT_A="$(node_identity "$SBX")"; EXPECT_B="$(node_identity "$OTHER")"
case "$EXPECT_A" in git-common-dir:/*) : ;; *) fail "fixture identity bad: $EXPECT_A" ;; esac

# --- 1. every manifest-writing rail writes the fields (cwd = consuming repo) ----
for rail in hetero review author; do
  runs="$TEST_TMP/runs-$rail"; "run_$rail" "$runs" "$SBX"
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$rail: no manifest written under $runs"; continue; }
  eq "$EXPECT_A" "$(mf_get "$mf" repo_identity)" "$rail: manifest repo_identity == Node repoIdentity(cwd repo)"
  eq "consuming_repo_root" "$(mf_get "$mf" repo_identity_source)" "$rail: source is consuming_repo_root when no --repo-root"
done

# --- 2. REPO_ROOT (--repo-root) beats CONSUMING_REPO_ROOT (cwd) -----------------
runs="$TEST_TMP/runs-author-explicit"; run_author "$runs" "$SBX" --repo-root "$OTHER"
mf="$(one_manifest "$runs")"
[ -n "$mf" ] || fail "author --repo-root: no manifest"
eq "$EXPECT_B" "$(mf_get "$mf" repo_identity)" "author --repo-root: identity comes from REPO_ROOT, not cwd"
eq "repo_root" "$(mf_get "$mf" repo_identity_source)" "author --repo-root: source repo_root"
# the shared resolver itself: precedence REPO_ROOT -> CONSUMING_REPO_ROOT -> cwd toplevel -> null
# shellcheck disable=SC1090
( . "$LIB"
  repo_identity_resolve_fields "$OTHER" "$SBX"
  case "$REPO_IDENTITY_FIELDS" in *"$EXPECT_B"*'"repo_identity_source": "repo_root"'*) exit 0 ;; *) echo "bad: $REPO_IDENTITY_FIELDS" >&2; exit 1 ;; esac )
eq "0" "$?" "resolver: REPO_ROOT beats CONSUMING_REPO_ROOT"
( . "$LIB"
  repo_identity_resolve_fields "" "$SBX"
  case "$REPO_IDENTITY_FIELDS" in *"$EXPECT_A"*'"repo_identity_source": "consuming_repo_root"'*) exit 0 ;; *) echo "bad: $REPO_IDENTITY_FIELDS" >&2; exit 1 ;; esac )
eq "0" "$?" "resolver: CONSUMING_REPO_ROOT used when REPO_ROOT empty"
( . "$LIB"
  cd "$NOGIT" && repo_identity_resolve_fields "" ""
  [ "$REPO_IDENTITY_FIELDS" = '"repo_identity": null, "repo_identity_source": null' ] )
eq "0" "$?" "resolver: no repo anywhere -> null/null (not a failure)"

# --- 3. outside any git repo: review/author record null, no crash ---------------
for rail in review author; do
  runs="$TEST_TMP/runs-$rail-nogit"; "run_$rail" "$runs" "$NOGIT"
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$rail (no git): no manifest"; continue; }
  eq "<null>" "$(mf_get "$mf" repo_identity)" "$rail outside git: repo_identity null"
  eq "<null>" "$(mf_get "$mf" repo_identity_source)" "$rail outside git: source null"
done

# --- 4. git refusing --path-format: null + git_rev_parse_failed -----------------
FAKEBIN="$TEST_TMP/fakebin"; mkdir -p "$FAKEBIN"
REAL_GIT="$(command -v git)"
cat > "$FAKEBIN/git" <<EOS
#!/usr/bin/env bash
for a in "\$@"; do
  if [ "\$a" = "--path-format=absolute" ]; then echo "error: unknown option" >&2; exit 129; fi
done
exec "$REAL_GIT" "\$@"
EOS
chmod +x "$FAKEBIN/git"
for rail in hetero review author; do
  runs="$TEST_TMP/runs-$rail-oldgit"
  case "$rail" in
    hetero) run_hetero "$runs" "$SBX" PATH="$FAKEBIN:$PATH" ;;
    review) run_review "$runs" "$SBX" PATH="$FAKEBIN:$PATH" ;;
    author) mkdir -p "$runs"; ( cd "$SBX" && PATH="$FAKEBIN:$PATH" timeout 60 env -u REPO_ROOT -u CONSUMING_REPO_ROOT AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
              "$AUTHOR" --runner grok --model grok-4.5 --prompt-file "$PROMPT" --bin "$GROK_STUB" >/dev/null 2>&1 ) || true ;;
  esac
  mf="$(one_manifest "$runs")"
  [ -n "$mf" ] || { fail "$rail (old git): no manifest"; continue; }
  eq "<null>" "$(mf_get "$mf" repo_identity)" "$rail old git: repo_identity null"
  eq "git_rev_parse_failed" "$(mf_get "$mf" repo_identity_source)" "$rail old git: source git_rev_parse_failed"
done

# --- 5. old manifest (no fields) is read fine by `autopilot status runs --json` --
OLDRUNS="$TEST_TMP/runs-old"; mkdir -p "$OLDRUNS"
cat > "$OLDRUNS/old-run-1.manifest.json" <<EOS
{ "schema": 1, "run_id": "old-run-1", "role": "reviewer", "runner": "grok", "model": "m", "branch": null, "base": null, "base_sha": null, "worktree": null, "lock_path": null, "log_path": "$TEST_TMP/none.log", "log_format": "plain", "aux_log": null, "pid": 1, "scope_unit": null, "containment_planned": "scratch", "started_at": "2026-01-01T00:00:00Z", "started_epoch": 1767225600, "prompt_file": "p", "diff_file": "d", "ledger": null, "stage": null, "ended_at": "2026-01-01T00:01:00Z", "ended_epoch": 1767225660, "final_status": "reviewed", "parent_run_id": null, "root_run_id": null, "depth": 0 }
EOS
cp "$(one_manifest "$TEST_TMP/runs-review")" "$OLDRUNS/new-run-1.manifest.json"
OUT="$(cd "$REPO_ROOT" && env AUTOPILOT_DISPATCH_RUNS_DIR="$OLDRUNS" node bin/autopilot.js status runs --json < /dev/null 2>/dev/null)"; RC=$?
eq "0" "$RC" "status runs --json exits 0 with an old + a new manifest"
node -e '
  const rows = JSON.parse(process.argv[1]);
  const ids = rows.map((r) => r.run_id);
  if (!ids.includes("old-run-1")) { console.error("old manifest row missing: " + ids); process.exit(1); }
  if (rows.length < 2) { console.error("new manifest row missing: " + ids); process.exit(1); }
' "$OUT"
eq "0" "$?" "old manifest without repo_identity still listed (reader tolerant) alongside the new one"

finalize_test
