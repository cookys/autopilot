#!/usr/bin/env bash
# Tests for dispatch-hetero.sh --gc (stale worktree reaper)
. "$(dirname "$0")/lib.sh"

private_orphan_state_dir() {
    printf '%s/autopilot-%s' "$TMPDIR" "${UID:-$(id -u)}"
}

prepare_private_orphan_state_dir() {
    local dir
    dir="$(private_orphan_state_dir)"
    mkdir -m 700 -p "$dir"
    chmod 700 "$dir"
    printf '%s' "$dir"
}

# Test 1: Default behavior - reaper disabled (no config or age 0)
test_reaper_disabled() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-disabled"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    # Age 0 disables the reaper. State it in the scratch repo the way every
    # other case here does, rather than leaning on the ambient repo having no
    # config: since 5c53201f this one dogfoods the reaper at 14, and the
    # resolver walks $PWD then $REPO_ROOT, so an unstated age resolves to 14.
    # That the DEFAULT is 0 is the resolver's own claim, proved against a
    # plugin-shaped root in resolve-worktree-teardown.test.sh.
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 0\n' > "$scratch/.claude/worktree-teardown-config.md"

    cd "$scratch"
    local output
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    assert_eq 0 $? "reaper disabled exit code"
    cd - > /dev/null
    assert_contains "$output" "reaper disabled (stale_reaper_age_days=0)" "disabled message"
}

test_reaper_disabled

# Test 2: Marked + aged + lock-free - should be reaped
test_reap_aged_marked() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-reap"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    # Enable reaper (1 day threshold)
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 1\n' > "$scratch/.claude/worktree-teardown-config.md"
    
    # Create worktree
    local wt_path="$scratch/wt-aged"
    local wt_branch="branch-aged"
    git -C "$scratch" worktree add -q "$wt_path" -b "$wt_branch"
    
    # Mark as aged (200000 seconds ago)
    local now=$(date +%s)
    local aged_ts=$((now - 200000))
    cat > "$wt_path/.autopilot-worktree" <<EOF
created_at=$aged_ts
branch=$wt_branch
schema=1
EOF
    
    cd "$scratch"
    local output
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    cd - > /dev/null
    
    # Should be reaped
    assert_contains "$output" "\"reaped\"" "reaped key present"
    assert_contains "$output" "$wt_path" "worktree path in output"
    
    # Directory should be gone
    if [ -d "$wt_path" ]; then
        fail "worktree directory should be removed"
    fi
    
    # Branch should still resolve (detached HEAD kept)
    if ! git -C "$scratch" rev-parse -q --verify "$wt_branch" > /dev/null 2>&1; then
        fail "branch should still exist after reaping"
    fi
}

test_reap_aged_marked

# Test 3: Marked + aged + lock HELD - should skip as live
test_skip_live_locked() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-skip-live"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 1\n' > "$scratch/.claude/worktree-teardown-config.md"
    
    local wt_path="$scratch/wt-locked"
    local wt_branch="branch-locked"
    git -C "$scratch" worktree add -q "$wt_path" -b "$wt_branch"
    
    local now=$(date +%s)
    local aged_ts=$((now - 200000))
    cat > "$wt_path/.autopilot-worktree" <<EOF
created_at=$aged_ts
branch=$wt_branch
schema=1
EOF
    
    # Hold lock in background
    (
        exec 200>"$wt_path/.autopilot-worktree.lock"
        flock -x 200
        sleep 30
    ) &
    local lock_pid=$!
    # wait (bounded) until the holder actually owns the per-worktree lock
    for _ in $(seq 1 50); do
        flock -n "$wt_path/.autopilot-worktree.lock" true 2>/dev/null || break
        sleep 0.1
    done
    
    cd "$scratch"
    local output
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    cd - > /dev/null
    
    kill $lock_pid 2>/dev/null || true
    wait $lock_pid 2>/dev/null || true
    
    # Should skip as live
    assert_contains "$output" '"skipped_live"' "skipped_live key present"
    
    # Directory should still exist
    if [ ! -d "$wt_path" ]; then
        fail "locked worktree should not be removed"
    fi
}

test_skip_live_locked

# Test 4: Unmarked worktree - should be untouched
test_skip_unmarked() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-unmarked"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 1\n' > "$scratch/.claude/worktree-teardown-config.md"
    
    local wt_path="$scratch/wt-unmarked"
    local wt_branch="branch-unmarked"
    git -C "$scratch" worktree add -q "$wt_path" -b "$wt_branch"
    # NO marker file written
    
    cd "$scratch"
    local output
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    cd - > /dev/null
    
    # Should not be in reaped
    if echo "$output" | grep -q "\"reaped\":" && echo "$output" | grep -v "\"reaped\": \[\]"; then
        # Non-empty reaped array - check if this worktree is in it
        if echo "$output" | grep -q "$wt_path"; then
            fail "unmarked worktree should not be reaped"
        fi
    fi
    
    # Directory should still exist
    if [ ! -d "$wt_path" ]; then
        fail "unmarked worktree should still exist"
    fi
}

test_skip_unmarked

# Test 5: Marked + fresh - should skip as fresh
test_skip_fresh() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-fresh"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 1\n' > "$scratch/.claude/worktree-teardown-config.md"
    
    local wt_path="$scratch/wt-fresh"
    local wt_branch="branch-fresh"
    git -C "$scratch" worktree add -q "$wt_path" -b "$wt_branch"
    
    # Mark as fresh (current timestamp)
    local now=$(date +%s)
    cat > "$wt_path/.autopilot-worktree" <<EOF
created_at=$now
branch=$wt_branch
schema=1
EOF
    
    cd "$scratch"
    local output
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    cd - > /dev/null
    
    assert_contains "$output" '"skipped_fresh"' "skipped_fresh key present"
    
    # Directory should still exist
    if [ ! -d "$wt_path" ]; then
        fail "fresh worktree should not be removed"
    fi
}

test_skip_fresh

# Test 6: Concurrent GC - second should no-op
test_concurrent_gc() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-concurrent"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 1\n' > "$scratch/.claude/worktree-teardown-config.md"
    
    local wt_path="$scratch/wt-concurrent"
    local wt_branch="branch-concurrent"
    git -C "$scratch" worktree add -q "$wt_path" -b "$wt_branch"
    
    local now=$(date +%s)
    local aged_ts=$((now - 200000))
    cat > "$wt_path/.autopilot-worktree" <<EOF
created_at=$aged_ts
branch=$wt_branch
schema=1
EOF
    
    # Hold global GC lock
    (
        exec 200>"$TMPDIR/.autopilot-gc.lock"
        flock -x 200
        sleep 30
    ) &
    local lock_pid=$!
    # wait (bounded) until the holder owns the global gc lock
    for _ in $(seq 1 50); do
        flock -n "$TMPDIR/.autopilot-gc.lock" true 2>/dev/null || break
        sleep 0.1
    done
    
    cd "$scratch"
    local output
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    local exit_code=$?
    cd - > /dev/null
    
    kill $lock_pid 2>/dev/null || true
    wait $lock_pid 2>/dev/null || true
    
    assert_eq 0 $exit_code "concurrent gc exit code"
    assert_contains "$output" "another --gc is running; no-op" "concurrent gc message"
    
    # Worktree should still exist since GC was blocked
    if [ ! -d "$wt_path" ]; then
        fail "worktree should exist when GC is blocked by concurrent run"
    fi
}

test_concurrent_gc

# Test 7: Clock backward (future created_at) - should still reap
test_clock_backward_reap() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-clock-back"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 1\n' > "$scratch/.claude/worktree-teardown-config.md"
    
    local wt_path="$scratch/wt-future"
    local wt_branch="branch-future"
    git -C "$scratch" worktree add -q "$wt_path" -b "$wt_branch"
    
    # Future timestamp (10 days from now)
    local now=$(date +%s)
    local future_ts=$((now + 864000))
    cat > "$wt_path/.autopilot-worktree" <<EOF
created_at=$future_ts
branch=$wt_branch
schema=1
EOF
    
    cd "$scratch"
    local output
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    cd - > /dev/null
    
    # Negative age = eligible, should be reaped
    assert_contains "$output" "\"reaped\"" "reaped key present for future timestamp"
    
    if [ -d "$wt_path" ]; then
        fail "worktree with future timestamp should be reaped (negative age)"
    fi
}

test_clock_backward_reap

# Test 8: --reap-unmarked without --yes - should exit 2
test_reap_unmarked_requires_yes() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-reap-unmarked"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 1\n' > "$scratch/.claude/worktree-teardown-config.md"
    
    cd "$scratch"
    local output
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc --reap-unmarked 2>&1)
    local exit_code=$?
    cd - > /dev/null
    
    assert_eq 2 $exit_code "reap-unmarked without --yes exit code"
    assert_contains "$output" "--yes" "stderr mentions --yes flag"
}

test_reap_unmarked_requires_yes

# Test 9: Marker files should be excluded from git status (regression test)
test_marker_exclusion() {
    export TMPDIR="$TEST_TMP/tmp"
    mkdir -p "$TMPDIR"
    
    local scratch="$TEST_TMP/repo-exclusion"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"
    
    local wt_path="$scratch/wt-exclude"
    local wt_branch="branch-exclude"
    git -C "$scratch" worktree add -q "$wt_path" -b "$wt_branch"
    
    # Write marker files
    cat > "$wt_path/.autopilot-worktree" <<EOF
created_at=$(date +%s)
branch=$wt_branch
schema=1
EOF
    touch "$wt_path/.autopilot-worktree.lock"
    
    # Add to info/exclude
    local git_dir
    # COMMON git dir — git reads info/exclude from the common dir for linked
    # worktrees; the per-worktree gitdir info/exclude is ignored (verified live).
    git_dir=$(git -C "$wt_path" rev-parse --path-format=absolute --git-common-dir)
    mkdir -p "$git_dir/info"
    cat >> "$git_dir/info/exclude" <<EOF
.autopilot-worktree
.autopilot-worktree.lock
EOF
    
    # Check status - should be empty
    local status
    status=$(git -C "$wt_path" status --porcelain)
    
    assert_eq "" "$status" "git status should be empty (marker files excluded)"
}

test_marker_exclusion

# Test 10: --gc rewrites the signal-handler orphan log before stale enumeration.
test_orphan_log_hygiene_retries_registered_worktree() {
    export TMPDIR="$TEST_TMP/tmp-orphan-hygiene"
    mkdir -p "$TMPDIR"

    local scratch="$TEST_TMP/repo-orphan-hygiene"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"

    local wt_path="$scratch/wt-orphan-retry"
    git -C "$scratch" worktree add -q "$wt_path" -b orphan-retry

    local orphan_dir orphan_log
    orphan_dir="$(prepare_private_orphan_state_dir)"
    orphan_log="$orphan_dir/autopilot-orphan-worktrees.log"
    printf '%s\n' \
        'fatal: quoted "remove" failure' \
        "$TMPDIR/does-not-exist" \
        "$wt_path" > "$orphan_log"

    local output exit_code
    cd "$scratch"
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    exit_code=$?
    cd - >/dev/null

    assert_eq 0 "$exit_code" "orphan hygiene exit code"
    if [ -d "$wt_path" ]; then
        fail "registered own-user orphan worktree should be retried and removed"
    else
        __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
    fi
    assert_file_absent "$orphan_log" "pruned empty orphan log should be removed"
    assert_not_contains "${output:-}" 'fatal: quoted' "retry diagnostics must not be replayed"
}

test_orphan_log_hygiene_retries_registered_worktree

# Test 11: absent logs are a no-op; failed registered-worktree retries remain
# actionable without appending another copy of git's diagnostic text.
test_orphan_log_hygiene_absent_and_retry_failure() {
    export TMPDIR="$TEST_TMP/tmp-orphan-failure"
    mkdir -p "$TMPDIR"

    local scratch="$TEST_TMP/repo-orphan-failure"
    git init -q "$scratch"
    git -C "$scratch" config user.email "test@example.com"
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m "initial"

    local orphan_dir orphan_log
    orphan_dir="$(prepare_private_orphan_state_dir)"
    orphan_log="$orphan_dir/autopilot-orphan-worktrees.log"
    local output exit_code
    cd "$scratch"
    output=$(bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    exit_code=$?
    cd - >/dev/null
    assert_eq 0 "$exit_code" "absent orphan log leaves gc behavior unchanged"
    assert_file_absent "$orphan_log" "absent orphan log stays absent"

    local wt_path="$scratch/wt-orphan-keep"
    git -C "$scratch" worktree add -q "$wt_path" -b orphan-keep
    printf '%s\n' "$wt_path" > "$orphan_log"

    local real_git fake_bin
    real_git=$(command -v git)
    fake_bin="$TEST_TMP/fake-git"
    mkdir -p "$fake_bin"
    cat > "$fake_bin/git" <<EOF
#!/usr/bin/env bash
if [[ " \$* " == *" worktree remove --force $wt_path "* ]]; then
  printf '%s\n' 'fatal: injected "remove" failure' >&2
  exit 1
fi
exec "$real_git" "\$@"
EOF
    chmod +x "$fake_bin/git"

    cd "$scratch"
    output=$(PATH="$fake_bin:$PATH" bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1)
    exit_code=$?
    cd - >/dev/null
    assert_eq 0 "$exit_code" "failed orphan retry does not break gc"
    if [ -d "$wt_path" ]; then
        __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
    else
        fail "failed registered-worktree retry must keep the worktree"
    fi
    assert_contains "$(cat "$orphan_log")" "$wt_path" "failed retry remains in orphan log"
    assert_not_contains "$(cat "$orphan_log")" 'injected "remove" failure' "retry stderr is never appended to orphan log"
    assert_not_contains "${output:-}" 'injected "remove" failure' "retry stderr remains suppressed"

    git -C "$scratch" worktree remove --force "$wt_path"
}

test_orphan_log_hygiene_absent_and_retry_failure

test_orphan_log_retry_preserves_lifetime_locked_worktree() {
    export TMPDIR="$TEST_TMP/tmp-orphan-live"; mkdir -p "$TMPDIR"
    local scratch="$TEST_TMP/repo-orphan-live" wt_path orphan_dir orphan_log output rc lock_pid
    git init -q "$scratch"
    git -C "$scratch" config user.email test@example.com
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m initial
    wt_path="$scratch/wt-orphan-live"
    git -C "$scratch" worktree add -q "$wt_path" -b orphan-live
    orphan_dir="$(prepare_private_orphan_state_dir)"
    orphan_log="$orphan_dir/autopilot-orphan-worktrees.log"
    printf '%s\n' "$wt_path" > "$orphan_log"

    (exec 200>"$wt_path/.autopilot-worktree.lock"; flock -x 200; sleep 30) &
    lock_pid=$!
    for _ in $(seq 1 50); do
        flock -n "$wt_path/.autopilot-worktree.lock" true 2>/dev/null || break
        sleep 0.1
    done
    output=$(cd "$scratch" && bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc 2>&1); rc=$?
    kill "$lock_pid" 2>/dev/null || true; wait "$lock_pid" 2>/dev/null || true

    assert_eq "$rc" 0 "lifetime-locked orphan retry exits cleanly"
    [ -d "$wt_path" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "orphan retry must preserve a lifetime-locked registered worktree"
    assert_contains "$(cat "$orphan_log")" "$wt_path" "live orphan remains actionable in the retry log"
    assert_not_contains "$output" "$wt_path\"" "live orphan is not reported as reaped by normal GC"
    (cd "$scratch" && bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc >/dev/null 2>&1)
    [ ! -d "$wt_path" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "released orphan lock permits the next retry"
    assert_file_absent "$orphan_log" "successful retry prunes released orphan entry"
}

test_orphan_log_retry_preserves_lifetime_locked_worktree

test_orphan_log_rewrite_failures_and_concurrent_append() {
    export TMPDIR="$TEST_TMP/tmp-orphan-atomic"; mkdir -p "$TMPDIR"
    local orphan_dir log rc before fake hook done appended i
    orphan_dir="$(prepare_private_orphan_state_dir)"
    log="$orphan_dir/autopilot-orphan-worktrees.log"

    mkdir "$log"
    set +e; bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc >/dev/null 2>&1; rc=$?; set -e
    assert_eq "$rc" 2 "non-regular orphan log fails closed"
    [ -d "$log" ] || fail "failed rewrite must preserve original orphan log"
    rmdir "$log"

    mkdir "$TMPDIR/keep-path"; printf '%s\n' "$TMPDIR/keep-path" > "$log"; before=$(cat "$log")
    fake="$TEST_TMP/fail-mv-bin"; mkdir -p "$fake"
    printf '#!/bin/sh\nprintf '\''injected mv failure\n'\'' >&2\nexit 1\n' > "$fake/mv"; chmod +x "$fake/mv"
    set +e; PATH="$fake:$PATH" bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc >/dev/null 2>&1; rc=$?; set -e
    assert_eq "$rc" 2 "orphan-log atomic replacement failure is nonzero"
    assert_eq "$before" "$(cat "$log")" "replacement failure preserves original bytes"

    rm -rf "$TMPDIR/keep-path"; printf '%s\n' "$TMPDIR/gone" > "$log"
    appended="$TMPDIR/concurrent-entry"; done="$TEST_TMP/append-done"; hook="$TEST_TMP/orphan-append-hook.sh"
    cat > "$hook" <<EOF
#!/usr/bin/env bash
eval "exec \${AUTOPILOT_ORPHAN_REWRITE_LOCK_FD}>&-"
(. "$REPO_ROOT/scripts/lib/worktree-reap.sh"; ORPHAN_LOG="\$1"; _wt_append_orphan_path "$appended"; : > "$done") >/dev/null 2>&1 &
EOF
    chmod +x "$hook"
    AUTOPILOT_ORPHAN_REWRITE_TEST_HOOK="$hook" bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc >/dev/null 2>&1
    for i in {1..100}; do [ -e "$done" ] && break; sleep 0.02; done
    assert_file_exists "$done" "coordinated concurrent append completes"
    assert_contains "$(cat "$log")" "$appended" "rewrite never loses concurrent writer append"
}

test_orphan_log_rewrite_failures_and_concurrent_append

test_lock_symlink_victims_are_never_modified() {
    export TMPDIR="$TEST_TMP/tmp-lock-symlink"; mkdir -p "$TMPDIR"
    local victim="$TEST_TMP/lock-victim" expected='0123456789abcdef'
    local orphan_dir log scratch="$TEST_TMP/repo-lock-symlink"
    local wt_path rc now aged_ts
    orphan_dir="$(prepare_private_orphan_state_dir)"
    log="$orphan_dir/autopilot-orphan-worktrees.log"
    printf '%s' "$expected" > "$victim"

    printf '%s\n' "$TMPDIR/gone" > "$log"
    ln -s "$victim" "${log}.lock"
    set +e; bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc >/dev/null 2>&1; rc=$?; set -e
    assert_eq "$rc" 2 "orphan-log symlink lock fails closed"
    assert_eq "$(cat "$victim")" "$expected" "orphan-log lock open never truncates symlink victim"
    rm -f "${log}.lock" "$log"

    git init -q "$scratch"
    git -C "$scratch" config user.email test@example.com
    git -C "$scratch" config user.name "Test User"
    git -C "$scratch" commit -q --allow-empty -m initial
    mkdir -p "$scratch/.claude"
    printf -- '- stale_reaper_age_days: 1\n' > "$scratch/.claude/worktree-teardown-config.md"
    wt_path="$scratch/wt-lock-symlink"
    git -C "$scratch" worktree add -q "$wt_path" -b branch-lock-symlink
    now=$(date +%s); aged_ts=$((now - 200000))
    printf 'created_at=%s\nbranch=branch-lock-symlink\nschema=1\n' "$aged_ts" > "$wt_path/.autopilot-worktree"
    ln -s "$victim" "$TMPDIR/.autopilot-gc.lock"
    set +e; (cd "$scratch" && bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc >/dev/null 2>&1); rc=$?; set -e
    assert_eq "$rc" 1 "global GC symlink lock fails closed"
    [ -d "$wt_path" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) || fail "GC lock failure must preserve worktree"
    assert_eq "$(cat "$victim")" "$expected" "global GC lock open never truncates symlink victim"
}

test_lock_symlink_victims_are_never_modified

test_orphan_state_dir_is_private_and_rejects_symlink() {
    export TMPDIR="$TEST_TMP/tmp-private-state"; mkdir -p "$TMPDIR"
    local state_dir victim expected='0123456789abcdef' rc mode
    state_dir="$(private_orphan_state_dir)"

    bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc >/dev/null 2>&1
    mode="$(stat -c '%a' "$state_dir")"
    assert_eq "$mode" 700 "orphan state directory is owner-only"

    rm -rf "$state_dir"
    victim="$TEST_TMP/state-dir-victim"
    printf '%s' "$expected" > "$victim"
    ln -s "$victim" "$state_dir"
    set +e; bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --gc >/dev/null 2>&1; rc=$?; set -e
    assert_eq "$rc" 2 "symlink orphan state directory fails closed"
    assert_eq "$(cat "$victim")" "$expected" "state-directory validation never modifies symlink victim"
}

test_orphan_state_dir_is_private_and_rejects_symlink

finalize_test
