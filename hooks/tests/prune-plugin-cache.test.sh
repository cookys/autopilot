#!/usr/bin/env bash
# scripts/prune-plugin-cache.js — deletes one stale plugin cache copy only when it is re-checked safe NOW. Temp CLAUDE_DIR throughout; no real ~/.claude.
. "$(dirname "$0")/lib.sh"

P="$REPO_ROOT/scripts/prune-plugin-cache.js"
C="$TEST_TMP/claude"
BASE="$C/plugins/cache/autopilot/autopilot"
mkdir -p "$BASE/1.0.0" "$BASE/2.0.0/.in_use" "$BASE/3.0.0" "$TEST_TMP/devrepo"
ln -s "$TEST_TMP/devrepo" "$BASE/dev"
printf '{"autopilot":{"source":{"source":"directory","path":"%s"}}}\n' "$TEST_TMP/devrepo" > "$C/plugins/known_marketplaces.json"
sleep 600 &
LIVE_PID=$!
trap 'kill $LIVE_PID 2>/dev/null' EXIT
: > "$BASE/2.0.0/.in_use/$LIVE_PID"
run() { node "$P" --claude-dir "$C" "$@"; }

# unused copy: dry-run keeps it, the real run removes it
OUT="$(run --version 1.0.0 --dry-run)"; assert_exit_code 0 $? "dry-run on an unused copy" 2>/dev/null || true
assert_file_exists "$BASE/1.0.0" "dry-run deletes nothing"
run --version 1.0.0 >/dev/null; RC=$?
assert_eq "$RC" "0" "unused copy: exit 0"
assert_file_absent "$BASE/1.0.0" "unused copy is removed"

# negative controls: a copy a live process uses, a path trick, the dev link, a missing copy: refused, exit 1, still there
for v in 2.0.0 ../autopilot/2.0.0 dev 9.9.9; do
  OUT="$(run --version "$v")"; RC=$?
  assert_eq "$RC" "1" "refused: $v"
  assert_contains "$OUT" '"ok":false' "refused with a reason: $v"
done
assert_file_exists "$BASE/2.0.0" "a copy in use by a live pid is kept"
assert_file_exists "$BASE/dev" "the dev link is kept"
assert_contains "$(run --version 2.0.0)" "in use by pid $LIVE_PID" "the reason names the pid"

# the loaded copy is refused even with no live pid listed (the loaded-source judgement)
rm -rf "$BASE/dev"; kill $LIVE_PID 2>/dev/null; rm -f "$BASE/2.0.0/.in_use/"*
mkdir -p "$BASE/3.0.0/.in_use"; : > "$BASE/3.0.0/.in_use/$$"
OUT="$(run --version 3.0.0)"; assert_eq "$?" "1" "a copy the current shell holds is kept"
assert_file_exists "$BASE/3.0.0" "kept"

# a usage error is exit 2
node "$P" >/dev/null 2>&1; assert_eq "$?" "2" "no --version is a usage error"

finalize_test
