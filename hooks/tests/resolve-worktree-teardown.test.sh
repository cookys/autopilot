#!/usr/bin/env bash
# Test seam for scripts/resolve-worktree-teardown.sh
. "$(dirname "$0")/lib.sh"

# Note: 120-second hook-timeout branch untestable without timeout seam

# The template tier is unreachable from inside this repo. The ladder walks $PWD
# then $REPO_ROOT before the template, $REPO_ROOT is derived from the script's
# own location, and this repo ships its own .claude/ override — so
# in-repo calls resolve to that instead. A shipped plugin carries no
# .claude/ (checked: the Codex payload has none), so what a consuming project
# actually sees is a root holding only what the payload ships. Build that.
plugin_shaped_root() {
    local sandbox="$TEST_TMP/plugin-shaped"
    if [ ! -d "$sandbox" ]; then
        mkdir -p "$sandbox/scripts/lib" "$sandbox/project-config-template" "$sandbox/cwd"
        cp "$REPO_ROOT/scripts/resolve-worktree-teardown.sh" "$sandbox/scripts/"
        cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$REPO_ROOT/scripts/lib/resolve-config.sh" \
           "$sandbox/scripts/lib/"
        cp "$REPO_ROOT/project-config-template/worktree-teardown-config.md" \
           "$sandbox/project-config-template/"
    fi
    printf '%s' "$sandbox"
}

# Run the resolver as a consuming project would: no config anywhere on the ladder.
resolve_unconfigured() {
    local sandbox
    sandbox="$(plugin_shaped_root)"
    (cd "$sandbox/cwd" && bash "$sandbox/scripts/resolve-worktree-teardown.sh" "$@")
}

# Test 1: Default config output
test_default_config() {
    local output
    output=$(resolve_unconfigured)

    assert_contains "$output" '"teardown_hook": ""' "default hook should be empty"
    assert_not_contains "$output" 'stale_reaper_age_days' "removed key is not emitted"
    assert_not_contains "$output" 'reaper_scope' "removed key is not emitted"
    assert_contains "$output" '"max_leaf_worktrees_per_root": 4' "default leaf budget should be 4"
    assert_contains "$output" '"source": "template"' "source should be template"
    
    echo "$output" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' 2>/dev/null
    assert_eq 0 $? "JSON should be valid"
}

# Test 3: Field query for hook
test_field_hook() {
    local hook
    hook=$(resolve_unconfigured --field teardown_hook)
    assert_eq "$hook" "" "default hook should be empty"
}

# Test 4: Config override
test_config_override() {
    local config="$TEST_TMP/config.md"
    cat > "$config" << 'EOF'
- teardown_hook: .claude/hooks/x.sh
EOF
    
    local output
    output=$(WORKTREE_TEARDOWN_CONFIG_OVERRIDE="$config" bash "$REPO_ROOT/scripts/resolve-worktree-teardown.sh")
    
    assert_contains "$output" '"teardown_hook": ".claude/hooks/x.sh"' "should override hook"
}

# Test 7: JSON parses with node
test_json_node_parse() {
    local output
    output=$(resolve_unconfigured)

    local parsed
    parsed=$(echo "$output" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).max_leaf_worktrees_per_root)' 2>/dev/null)
    assert_eq "$parsed" "4" "node should parse JSON and extract leaf budget"
}

test_leaf_budget_bounds() {
    local config="$TEST_TMP/budget-config.md" output
    echo '- max_leaf_worktrees_per_root: 12' > "$config"
    output=$(WORKTREE_TEARDOWN_CONFIG_OVERRIDE="$config" bash "$REPO_ROOT/scripts/resolve-worktree-teardown.sh")
    assert_contains "$output" '"max_leaf_worktrees_per_root": 12' "valid leaf budget should resolve"

    for value in 0 33 banana; do
        echo "- max_leaf_worktrees_per_root: $value" > "$config"
        output=$(WORKTREE_TEARDOWN_CONFIG_OVERRIDE="$config" bash "$REPO_ROOT/scripts/resolve-worktree-teardown.sh" --field max_leaf_worktrees_per_root)
        assert_eq "4" "$output" "invalid leaf budget $value should fail closed"
    done
}

# invoke all cases (depth-0 recorded deviation: author omitted invocations)
test_default_config
test_field_hook
test_config_override
test_json_node_parse
test_leaf_budget_bounds
finalize_test
