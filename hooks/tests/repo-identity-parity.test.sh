#!/usr/bin/env bash
# mods plan P1a R1 — shell repo_identity_of must be bit-identical to Node
# src/status/task-runtime.js repoIdentity(), including the named failure on a git
# that refuses --path-format (both sides null; shell prints one stderr line).
# RED at 532930ed (scripts/lib/repo-identity.sh absent on the base):
#   FAIL [repo-identity-parity] scripts/lib/repo-identity.sh exists: .../scripts/lib/repo-identity.sh does not exist
#   FAIL [repo-identity-parity] 0 passed, 1 failed
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

# Isolation: nothing here may touch the real HOME / config.
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

LIB="$REPO_ROOT/scripts/lib/repo-identity.sh"
assert_file_exists "$LIB" "scripts/lib/repo-identity.sh exists"
[ -f "$LIB" ] || finalize_test
# shellcheck disable=SC1090
. "$LIB"

node_identity() {
  node -e '
    const id = require(process.argv[1]).repoIdentity(process.argv[2]);
    process.stdout.write(id === null ? "<null>" : id);
  ' "$REPO_ROOT/src/status/task-runtime.js" "$1"
}
shell_identity() {
  local out; out="$(repo_identity_of "$1" 2>/dev/null)" || out="<null>"
  [ -n "$out" ] || out="<null>"
  printf '%s' "$out"
}
parity() { # <label> <dir>
  local s n
  s="$(shell_identity "$2")"; n="$(node_identity "$2")"
  eq "$n" "$s" "parity[$1]: shell == node"
  case "$s" in git-common-dir:/*) : ;; *) fail "parity[$1]: not a git-common-dir:<abs> value: $s" ;; esac
}

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=main -c commit.gpgsign=false"
MAIN="$TEST_TMP/main"; mkdir -p "$MAIN/sub/deep"
$GIT -C "$MAIN" init -q
$GIT -C "$MAIN" commit -q --allow-empty -m base

# 1. main worktree
parity "main-worktree" "$MAIN"
# 2. symlinked path
ln -s "$MAIN" "$TEST_TMP/link-to-main"
parity "symlinked-path" "$TEST_TMP/link-to-main"
eq "$(shell_identity "$MAIN")" "$(shell_identity "$TEST_TMP/link-to-main")" "symlink resolves to the same identity"
# 3. linked worktree: same common dir => same identity as the main checkout
$GIT -C "$MAIN" worktree add -q -b wt-branch "$TEST_TMP/linked-wt"
parity "linked-worktree" "$TEST_TMP/linked-wt"
eq "$(shell_identity "$MAIN")" "$(shell_identity "$TEST_TMP/linked-wt")" "linked worktree shares the main identity"
# 4. subdirectory cwd
parity "subdirectory" "$MAIN/sub/deep"

# 5. fake git refusing --path-format: both sides null, shell one-line stderr diagnostic
FAKEBIN="$TEST_TMP/fakebin"; mkdir -p "$FAKEBIN"
REAL_GIT="$(command -v git)"
cat > "$FAKEBIN/git" <<EOS
#!/usr/bin/env bash
for a in "\$@"; do
  if [ "\$a" = "--path-format=absolute" ]; then
    echo "error: unknown option \`path-format=absolute'" >&2
    exit 129
  fi
done
exec "$REAL_GIT" "\$@"
EOS
chmod +x "$FAKEBIN/git"
OLD_PATH="$PATH"
export PATH="$FAKEBIN:$PATH"
S_OUT="$(repo_identity_of "$MAIN" 2>"$TEST_TMP/fake.err")"; S_RC=$?
N_OUT="$(node_identity "$MAIN")"
export PATH="$OLD_PATH"
eq "" "$S_OUT" "fake old git: shell prints empty"
assert_neq "0" "$S_RC" "fake old git: shell returns non-zero"
eq "<null>" "$N_OUT" "fake old git: node returns null"
assert_contains "$(cat "$TEST_TMP/fake.err")" "repo-identity: git rev-parse --path-format failed" "fake old git: named stderr diagnostic"
assert_contains "$(cat "$TEST_TMP/fake.err")" "need >= 2.31" "fake old git: diagnostic names the minimum version"
eq "1" "$(wc -l < "$TEST_TMP/fake.err" | tr -d ' ')" "fake old git: diagnostic is exactly one line"

# a non-repo dir also fails named, not silently
S2="$(repo_identity_of "$TEST_TMP/home" 2>/dev/null)"; eq "" "$S2" "non-repo dir: empty output"
eq "<null>" "$(node_identity "$TEST_TMP/home")" "non-repo dir: node null"

finalize_test
