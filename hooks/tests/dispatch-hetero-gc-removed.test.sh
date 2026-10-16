#!/usr/bin/env bash
# BL-0115: dispatch-hetero.sh --gc / --reap-unmarked / --yes and the stale_reaper_age_days /
# reaper_scope teardown-config keys were removed at 3.0.0. The old spellings must be refused
# with a message that points at the replacement (repo-residue-sweep.js reap --auto --yes),
# never silently ignored; the surviving teardown seam must keep working.
. "$(dirname "$0")/lib.sh"

export TMPDIR="$TEST_TMP/tmp"
mkdir -p "$TMPDIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
mkdir -p "$ENGINE_CAPABILITY_DIR"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
RESOLVER="$REPO_ROOT/scripts/resolve-worktree-teardown.sh"

echo prompt > "$TEST_TMP/p.txt"
SCRATCH="$TEST_TMP/repo"
git init -q "$SCRATCH"
git -C "$SCRATCH" config user.email test@example.com
git -C "$SCRATCH" config user.name "Test User"
git -C "$SCRATCH" commit -q --allow-empty -m initial

# 1. Old flags are refused and point at the replacement.
for flag in --gc --reap-unmarked --yes; do
    set +e; out="$(cd "$SCRATCH" && bash "$HETERO" "$flag" 2>&1)"; rc=$?; set -e
    assert_neq "$rc" 0 "$flag is refused"
    assert_contains "$out" "$flag was removed at 3.0.0" "$flag: message names the removal"
    assert_contains "$out" "repo-residue-sweep.js reap --auto --yes" "$flag: message points at the replacement"
done

# 2. Removed config keys: resolver rejects (exit 2, names the key and the replacement).
for key in stale_reaper_age_days reaper_scope; do
    cfg="$TEST_TMP/cfg-$key.md"
    printf -- '- teardown_hook:\n- %s: 3\n' "$key" > "$cfg"
    set +e; out="$(WORKTREE_TEARDOWN_CONFIG_OVERRIDE="$cfg" bash "$RESOLVER" 2>&1)"; rc=$?; set -e
    assert_eq "$rc" 2 "resolver rejects removed key $key"
    assert_contains "$out" "'$key'" "resolver names $key"
    assert_contains "$out" "repo-residue-sweep.js reap --auto --yes" "resolver points at the replacement for $key"
    set +e; WORKTREE_TEARDOWN_CONFIG_OVERRIDE="$cfg" bash "$RESOLVER" --field teardown_hook >/dev/null 2>&1; rc=$?; set -e
    assert_eq "$rc" 2 "resolver --field also rejects $key"
done

# 3. dispatch-hetero.sh itself fails as a precondition when the project config carries a removed key.
mkdir -p "$SCRATCH/.claude"
printf -- '- stale_reaper_age_days: 14\n' > "$SCRATCH/.claude/worktree-teardown-config.md"
set +e; out="$(cd "$SCRATCH" && bash "$HETERO" --branch t/x --prompt-file "$TEST_TMP/p.txt" 2>&1)"; rc=$?; set -e
assert_neq "$rc" 0 "dispatch with a stale teardown config fails"
assert_contains "$out" "stale_reaper_age_days" "dispatch names the removed key"
assert_contains "$out" "worktree-teardown config" "dispatch reports it as a teardown-config precondition"

# 3b. Control: the same call with a clean config does NOT trip the teardown-config check.
printf -- '- teardown_hook:\n- max_leaf_worktrees_per_root: 4\n' > "$SCRATCH/.claude/worktree-teardown-config.md"
set +e; out="$(cd "$SCRATCH" && bash "$HETERO" --branch t/x --prompt-file "$TEST_TMP/p.txt" 2>&1)"; set -e
assert_not_contains "$out" "worktree-teardown config" "clean config passes the teardown-config check"

# 4. Surviving seam: clean config resolves, JSON carries no removed fields.
set +e; out="$(WORKTREE_TEARDOWN_CONFIG_OVERRIDE="$SCRATCH/.claude/worktree-teardown-config.md" bash "$RESOLVER")"; rc=$?; set -e
assert_eq "$rc" 0 "clean config resolves"
assert_not_contains "$out" "stale_reaper_age_days" "resolved JSON drops stale_reaper_age_days"
assert_not_contains "$out" "reaper_scope" "resolved JSON drops reaper_scope"
assert_contains "$out" '"max_leaf_worktrees_per_root": 4' "leaf budget still resolves"

# 5. No leftover implementation: the gc entry points are gone from the lib and the rail.
assert_not_contains "$(cat "$REPO_ROOT/scripts/lib/worktree-reap.sh")" "gc_stale_worktrees()" "gc_stale_worktrees() removed from lib"
assert_not_contains "$(cat "$HETERO")" "DO_GC" "DO_GC removed from the rail"

# 6. Orphan state dir validation (kept from the former gc suite): symlinked dir fails closed.
state_dir="$TMPDIR/autopilot-${UID:-$(id -u)}"
rm -rf "$state_dir"
victim="$TEST_TMP/state-dir-victim"; expected='0123456789abcdef'
printf '%s' "$expected" > "$victim"
ln -s "$victim" "$state_dir"
set +e; bash "$HETERO" --help >/dev/null 2>&1; rc=$?; set -e
assert_eq "$rc" 2 "symlink orphan state directory fails closed"
assert_eq "$(cat "$victim")" "$expected" "state-directory validation never modifies symlink victim"

finalize_test
