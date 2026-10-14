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
if [ "\$1" = "--version" ]; then echo "git version 2.30.2"; exit 0; fi
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

# 6. new git (2.53) whose rev-parse fails for a real reason (dubious ownership): the stderr must
# carry git's actual message, never the "upgrade git" version hint.
FAKEBIN2="$TEST_TMP/fakebin-new"; mkdir -p "$FAKEBIN2"
cat > "$FAKEBIN2/git" <<EOS
#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then echo "git version 2.53.0"; exit 0; fi
for a in "\$@"; do
  if [ "\$a" = "rev-parse" ]; then
    echo "fatal: detected dubious ownership in repository at '/x/y'" >&2
    exit 128
  fi
done
exec "$REAL_GIT" "\$@"
EOS
chmod +x "$FAKEBIN2/git"
OLD_PATH="$PATH"
export PATH="$FAKEBIN2:$PATH"
N_OUT2="$(repo_identity_of "$MAIN" 2>"$TEST_TMP/new.err")"; N_RC2=$?
export PATH="$OLD_PATH"
eq "" "$N_OUT2" "new git query failure: empty stdout"
assert_neq "0" "$N_RC2" "new git query failure: non-zero return"
assert_contains "$(cat "$TEST_TMP/new.err")" "detected dubious ownership" "new git query failure: real git reason printed"
assert_not_contains "$(cat "$TEST_TMP/new.err")" "need >= 2.31" "new git query failure: no version hint"
assert_not_contains "$(cat "$TEST_TMP/new.err")" "git 2.53" "new git query failure: git version not blamed"

# a non-repo dir also fails named, not silently
S2="$(repo_identity_of "$TEST_TMP/home" 2>/dev/null)"; eq "" "$S2" "non-repo dir: empty output"
eq "<null>" "$(node_identity "$TEST_TMP/home")" "non-repo dir: node null"

# 7. caller under set -euo pipefail, direct call, new git with a real rev-parse failure: the function
# must still print its diagnostic and return 1 (not abort the caller with git's 128).
( set -euo pipefail; PATH="$FAKEBIN2:$PATH"; repo_identity_of "$MAIN" >/dev/null ) 2>"$TEST_TMP/eu.err"; EU_RC=$?
eq "1" "$EU_RC" "set -euo pipefail: direct call returns 1"
assert_contains "$(cat "$TEST_TMP/eu.err")" "detected dubious ownership" "set -euo pipefail: diagnostic printed"

# 8. rev-parse succeeds (rc=0) but the common dir cannot be entered: named as such, not a git failure.
FAKEBIN3="$TEST_TMP/fakebin-nodir"; mkdir -p "$FAKEBIN3"
cat > "$FAKEBIN3/git" <<'EOS'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "git version 2.53.0"; exit 0; fi
for a in "$@"; do
  if [ "$a" = "rev-parse" ]; then echo "/nonexistent/common"; exit 0; fi
done
exit 1
EOS
chmod +x "$FAKEBIN3/git"
OLD_PATH="$PATH"
export PATH="$FAKEBIN3:$PATH"
ND_OUT="$(repo_identity_of "$MAIN" 2>"$TEST_TMP/nd.err")"; ND_RC=$?
export PATH="$OLD_PATH"
eq "" "$ND_OUT" "unresolvable common dir: empty stdout"
assert_neq "0" "$ND_RC" "unresolvable common dir: non-zero return"
eq "1" "$ND_RC" "unresolvable common dir: returns 1"
assert_contains "$(cat "$TEST_TMP/nd.err")" "cannot resolve common dir /nonexistent/common" "unresolvable common dir: named"
assert_not_contains "$(cat "$TEST_TMP/nd.err")" "git rev-parse failed" "unresolvable common dir: not blamed on git"

# 9. version boundary table: the hint appears only for git < 2.31. A version with no minor part
# ("2") must not be read as 2.2. Non-hint rows must show git's real stderr instead.
FAKEBIN4="$TEST_TMP/fakebin-ver"; mkdir -p "$FAKEBIN4"
cat > "$FAKEBIN4/git" <<'EOS'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then printf 'git version %s\n' "$FAKE_GIT_VERSION"; exit 0; fi
for a in "$@"; do
  if [ "$a" = "rev-parse" ]; then echo "fatal: boundary probe" >&2; exit 128; fi
done
exit 1
EOS
chmod +x "$FAKEBIN4/git"
OLD_PATH="$PATH"
export PATH="$FAKEBIN4:$PATH"
for row in "2.31.0|nohint" "2.30.9|hint" "2.4.1|hint" "2.100.0|nohint" "2.39.3 (Apple Git-146)|nohint" "2|nohint"; do
  ver="${row%%|*}"; want="${row##*|}"
  export FAKE_GIT_VERSION="$ver"
  BR_OUT="$(repo_identity_of "$MAIN" 2>"$TEST_TMP/bv.err")"; BR_RC=$?
  BR_ERR="$(cat "$TEST_TMP/bv.err")"
  eq "" "$BR_OUT" "boundary[$ver]: empty stdout"
  eq "1" "$BR_RC" "boundary[$ver]: returns 1"
  if [ "$want" = "hint" ]; then
    assert_contains "$BR_ERR" "need >= 2.31" "boundary[$ver]: version hint printed"
  else
    assert_contains "$BR_ERR" "fatal: boundary probe" "boundary[$ver]: real git stderr printed"
    assert_not_contains "$BR_ERR" "need >= 2.31" "boundary[$ver]: no version hint"
  fi
done
unset FAKE_GIT_VERSION
export PATH="$OLD_PATH"

# 10. failure matrix: every git situation x caller set options x call form must return 1, print
# nothing on stdout, and print exactly one stderr line that names the real cause (no version hint).
# PATH with every /bin and /usr/bin entry except git, so "git missing" is a real absence.
NOGIT_BIN="$TEST_TMP/nogit-bin"; mkdir -p "$NOGIT_BIN"
for d in /usr/bin /bin; do
  for f in "$d"/*; do b="${f##*/}"; [ "$b" = git ] && continue; [ -e "$NOGIT_BIN/$b" ] || ln -s "$f" "$NOGIT_BIN/$b"; done
done
NOGIT_PATH="$NOGIT_BIN"
PATH="$NOGIT_PATH" command -v git >/dev/null 2>&1 && fail "matrix: NOGIT_PATH still exposes git"
mx_fake() { # <name> <body> -> writes an executable git into a fresh dir, prints the dir
  local d="$TEST_TMP/mx-$1"; mkdir -p "$d"
  printf '#!/usr/bin/env bash\n%s\n' "$2" > "$d/git"; chmod +x "$d/git"; printf '%s' "$d"
}
V253='if [ "$1" = "--version" ]; then echo "git version 2.53.0"; exit 0; fi'
MX_VERSION_FAIL="$(mx_fake version-fail 'if [ "$1" = "--version" ]; then exit 1; fi; echo "fatal: version probe failed" >&2; exit 128')"
MX_DUBIOUS="$(mx_fake dubious "$V253"$'\n'"echo \"fatal: detected dubious ownership in repository at /x\" >&2; exit 128")"
MX_127="$(mx_fake exit127 'echo "fake: exec not found" >&2; exit 127')"
MX_NODIR="$(mx_fake nodir "$V253"$'\n'"echo /nonexistent/common; exit 0")"
MX_EMPTY="$(mx_fake empty "$V253"$'\n'"exit 0")"
# scenario | PATH prefix | expected stderr fragment
MX_ROWS=(
  "missing|$NOGIT_PATH|not found"
  "version-fail|$MX_VERSION_FAIL:$PATH|version probe failed"
  "dubious|$MX_DUBIOUS:$PATH|detected dubious ownership"
  "exit127|$MX_127:$PATH|fake: exec not found"
  "nodir|$MX_NODIR:$PATH|cannot resolve common dir /nonexistent/common"
  "empty|$MX_EMPTY:$PATH|returned no common dir"
)
MX_SETS=("set -uo pipefail" "set -euo pipefail")
MX_FORMS=(direct or-form if-form)
MX_OUT="$TEST_TMP/mx.out"; MX_ERR="$TEST_TMP/mx.err"; MX_RC="$TEST_TMP/mx.rc"
for row in "${MX_ROWS[@]}"; do
  IFS='|' read -r name mxpath frag <<<"$row"
  for set_opts in "${MX_SETS[@]}"; do
    for form in "${MX_FORMS[@]}"; do
      cell="$name / $set_opts / $form"
      rm -f "$MX_OUT" "$MX_ERR" "$MX_RC"
      case "$form" in
        direct)  ( PATH="$mxpath"; $set_opts; repo_identity_of "$MAIN" >"$MX_OUT" 2>"$MX_ERR" ); CELL_RC=$? ;;
        or-form) ( PATH="$mxpath"; $set_opts; r=0; repo_identity_of "$MAIN" >"$MX_OUT" 2>"$MX_ERR" || r=$?; echo "$r" > "$MX_RC" ); CELL_RC=$? ;;
        if-form) ( PATH="$mxpath"; $set_opts; if repo_identity_of "$MAIN" >"$MX_OUT" 2>"$MX_ERR"; then echo 0 > "$MX_RC"; else echo "$?" > "$MX_RC"; fi ); CELL_RC=$? ;;
      esac
      # direct: the caller's set -e exits with the function's return code; or/if forms: the caller
      # survives and writes the code it saw.
      if [ "$form" = direct ]; then got="$CELL_RC"; else got="$(cat "$MX_RC" 2>/dev/null)"; fi
      eq "1" "$got" "matrix[$cell]: returns 1"
      eq "" "$(cat "$MX_OUT")" "matrix[$cell]: stdout empty"
      eq "1" "$(wc -l < "$MX_ERR" | tr -d ' ')" "matrix[$cell]: stderr exactly one line"
      assert_contains "$(cat "$MX_ERR")" "$frag" "matrix[$cell]: names the real cause"
      assert_not_contains "$(cat "$MX_ERR")" "need >= 2.31" "matrix[$cell]: no version hint"
    done
  done
done

finalize_test
