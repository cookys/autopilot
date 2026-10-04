#!/usr/bin/env bash
# hooks/tests/project-key.test.sh — mods plan P1a R2: project_key derivation + session-mode marker scope fields.
# RED at 532930ed: FAIL [project-key] 5 passed, 11 failed (src/status/project-key.js absent; marker has no scope fields)
#   - main worktree key is 16 lowercase hex: expected '1', got '0'
#   - marker.project_key / marker.repo_identity: got 'undef'
#   - marker.root_run_id from AUTOPILOT_ROOT_RUN_ID: expected 'root-xyz', got 'undef'
. "$(dirname "$0")/lib.sh"

export HOME="$TEST_TMP/home"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"
export AUTOPILOT_COSTS_FILE="$TEST_TMP/costs.jsonl"
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$AUTOPILOT_LIVE_DIR"
unset AUTOPILOT_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_ROOT_RUN_ID

GIT_ID=(-c user.name=t -c user.email=t@example.invalid)
mkrepo() { git init -q "$1" && git "${GIT_ID[@]}" -C "$1" commit -q --allow-empty -m init; }

MAIN="$TEST_TMP/repoA"; mkrepo "$MAIN"
mkdir -p "$MAIN/sub/deep"
ln -s "$MAIN" "$TEST_TMP/link-to-A"
git -C "$MAIN" worktree add -q "$TEST_TMP/wtA" -b wt-branch
OTHER="$TEST_TMP/repoB"; mkrepo "$OTHER"

KEYJS="$REPO_ROOT/src/status/project-key.js"
keyof() {
  node -e 'const {scopeFromCwd}=require(process.argv[1]);const s=scopeFromCwd(process.argv[2]);process.stdout.write(String(s.project_key))' "$KEYJS" "$1" 2>/dev/null
}

K_MAIN="$(keyof "$MAIN")"
assert_eq "$(printf '%s' "$K_MAIN" | grep -cE '^[0-9a-f]{16}$')" "1" "main worktree key is 16 lowercase hex (got '$K_MAIN')"
assert_eq "$(keyof "$TEST_TMP/link-to-A")" "$K_MAIN" "symlink path -> same key"
assert_eq "$(keyof "$TEST_TMP/wtA")" "$K_MAIN" "linked worktree -> same key"
assert_eq "$(keyof "$MAIN/sub/deep")" "$K_MAIN" "subdirectory -> same key"
K_OTHER="$(keyof "$OTHER")"
assert_neq "$K_OTHER" "$K_MAIN" "two repos -> different keys"
assert_eq "$(keyof "$TEST_TMP")" "null" "non-repo cwd -> null key"

# projectKey is sha256 prefix of the identity string
EXPECT="$(node -e 'const {repoIdentity}=require(process.argv[1]);process.stdout.write(repoIdentity(process.argv[2]))' "$REPO_ROOT/src/status/task-runtime.js" "$MAIN" 2>/dev/null)"
EXPECT_KEY="$(printf '%s' "$EXPECT" | sha256sum | cut -c1-16)"
assert_eq "$K_MAIN" "$EXPECT_KEY" "key == sha256(repo_identity)[0:16]"

# marker written by `set` has the three fields
CLI="$REPO_ROOT/scripts/session-mode.js"
export CLAUDE_CODE_SESSION_ID="pk-session-1"
AUTOPILOT_ROOT_RUN_ID="root-xyz" node "$CLI" set --level l3 --repo-root "$MAIN" >/dev/null 2>&1 < /dev/null
M="$AUTOPILOT_SESSION_MODE_DIR/pk-session-1.json"
mf() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=m[process.argv[2]];process.stdout.write(v===null?"null":v===undefined?"undef":String(v))' "$M" "$1" 2>/dev/null; }
assert_eq "$(mf project_key)" "$K_MAIN" "marker.project_key"
assert_eq "$(mf repo_identity)" "$EXPECT" "marker.repo_identity"
assert_eq "$(mf root_run_id)" "root-xyz" "marker.root_run_id from AUTOPILOT_ROOT_RUN_ID"
node "$CLI" set --level l3 --repo-root "$MAIN" >/dev/null 2>&1 < /dev/null
# mods P1W W1f: unset env now mints a job root (job-<ts>-<rand>) instead of null.
MINTED="no"; case "$(mf root_run_id)" in job-[0-9]*-[0-9a-f]*) MINTED="yes" ;; esac
assert_eq "$MINTED" "yes" "marker.root_run_id minted job-<ts>-<rand> when env unset"

# note: `set` on a non-repo dir is rejected earlier by Mission routing (pre-existing), so the null-field
# fail-open path is covered at the scopeFromCwd level above (non-repo cwd -> null key).

# old marker (no scope fields) is still read by existing readers
cat > "$M" <<JSON
{"session_id":"pk-session-1","level":"l5","repo_root":"$MAIN","started_at":"2026-01-01T00:00:00Z","expires_at":"2999-01-01T00:00:00Z"}
JSON
OUT="$(node "$CLI" status 2>/dev/null)"
assert_contains "$OUT" '"active": true' "old marker: status active"
assert_contains "$OUT" '"level": "l5"' "old marker: status level"

finalize_test
