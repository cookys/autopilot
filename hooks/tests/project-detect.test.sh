#!/usr/bin/env bash
# project-detect fixture tests
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/project-detect.js"
FIXTURES_DIR="$REPO_ROOT/hooks/tests/fixtures/onboard"

query_json() {
  local json_input="$1"
  local path_expr="$2"
  node -e 'const fs = require("fs");
const source = process.argv[1];
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const parts = source.split(".");
let value = data;
for (const p of parts) {
  if (value == null || typeof value !== "object" || !(p in value)) process.exit(1);
  value = value[p];
}
if (value === undefined) process.exit(1);
if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
  process.stdout.write(String(value));
} else {
  process.stdout.write(JSON.stringify(value));
}' "$path_expr" <<< "$json_input"
}

HELP_TEXT="$(node "$SCRIPT" --help 2>&1)"
HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "project-detect --help exits 0"
assert_contains "$HELP_TEXT" "Usage:" "project-detect help mentions usage"
assert_contains "$HELP_TEXT" "target-dir" "project-detect help documents target"

BASE_HOME="$TEST_TMP/home"

# --- pnpm workspace fixture ---
PNPM_HOME="$BASE_HOME/pnpm"
mkdir -p "$PNPM_HOME/.claude/plugins"
PNPM_OUT="$(HOME="$PNPM_HOME" node "$SCRIPT" "$FIXTURES_DIR/pnpm-ws")"
assert_eq "$(query_json "$PNPM_OUT" target)" "$(cd "$FIXTURES_DIR/pnpm-ws" && pwd)" "pnpm target"
assert_eq "$(query_json "$PNPM_OUT" package_manager)" "pnpm" "pnpm package manager"
assert_eq "$(query_json "$PNPM_OUT" default_branch)" "null" "pnpm default branch"
assert_eq "$(query_json "$PNPM_OUT" doc_dir)" "docs" "pnpm doc_dir"
assert_eq "$(query_json "$PNPM_OUT" workspace.type)" "pnpm-workspace" "pnpm workspace type"
assert_eq "$(query_json "$PNPM_OUT" workspace.packages)" "[\"relay\",\"shared\"]" "pnpm workspace packages (sorted)"
assert_eq "$(query_json "$PNPM_OUT" workspace.package_scope)" "@demo" "pnpm package scope"
assert_eq "$(query_json "$PNPM_OUT" commands.build)" "pnpm -r build" "pnpm build"
assert_eq "$(query_json "$PNPM_OUT" commands.test)" "pnpm -r test:ci" "pnpm test"
assert_eq "$(query_json "$PNPM_OUT" commands.test_watch)" "pnpm -r test" "pnpm test watch"
assert_eq "$(query_json "$PNPM_OUT" commands.typecheck)" "pnpm -r typecheck" "pnpm typecheck"
assert_eq "$(query_json "$PNPM_OUT" commands.lint)" "pnpm -r lint" "pnpm lint"
assert_eq "$(query_json "$PNPM_OUT" commands.lint_is_noop)" "true" "pnpm lint_is_noop"
assert_eq "$(query_json "$PNPM_OUT" coverage_thresholds.shared.lines)" "95" "pnpm shared coverage lines"
assert_eq "$(query_json "$PNPM_OUT" coverage_thresholds.shared.functions)" "95" "pnpm shared coverage functions"
assert_eq "$(query_json "$PNPM_OUT" coverage_thresholds.shared.branches)" "90" "pnpm shared coverage branches"
assert_eq "$(query_json "$PNPM_OUT" coverage_thresholds.shared.statements)" "95" "pnpm shared coverage statements"
assert_eq "$(query_json "$PNPM_OUT" coverage_thresholds.relay.lines)" "85" "pnpm relay coverage lines"
assert_eq "$(query_json "$PNPM_OUT" coverage_thresholds.relay.functions)" "85" "pnpm relay coverage functions"
assert_eq "$(query_json "$PNPM_OUT" coverage_thresholds.relay.branches)" "80" "pnpm relay coverage branches"
assert_eq "$(query_json "$PNPM_OUT" coverage_thresholds.relay.statements)" "85" "pnpm relay coverage statements"
assert_eq "$(query_json "$PNPM_OUT" protected_path_candidates)" "[\"packages/relay/src/\",\"packages/shared/src/\"]" "pnpm protected paths (sorted)"
assert_eq "$(query_json "$PNPM_OUT" project_paths.projects_dir)" "docs/projects/" "pnpm projects dir path"
assert_eq "$(query_json "$PNPM_OUT" project_paths.plans_dir)" "docs/plans/" "pnpm plans dir path"
assert_eq "$(query_json "$PNPM_OUT" project_paths.backlog)" "docs/BACKLOG.md" "pnpm backlog path"
assert_eq "$(query_json "$PNPM_OUT" project_paths.index)" "docs/projects/INDEX.md" "pnpm index path"
assert_eq "$(query_json "$PNPM_OUT" project_paths.archive_dir)" "docs/projects/_archive/" "pnpm archive dir path"
assert_eq "$(query_json "$PNPM_OUT" installed_plugins.superpowers)" "false" "pnpm installed plugin flag"

# --- cargo workspace fixture ---
CARGO_HOME="$BASE_HOME/cargo"
mkdir -p "$CARGO_HOME/.claude/plugins"
cat > "$CARGO_HOME/.claude/plugins/installed_plugins.json" <<'JSON'
{
  "plugins": {
    "superpowers": { "version": "1.0.0" }
  }
}
JSON
CARGO_OUT="$(HOME="$CARGO_HOME" node "$SCRIPT" "$FIXTURES_DIR/cargo-doc")"
assert_eq "$(query_json "$CARGO_OUT" package_manager)" "cargo" "cargo package manager"
assert_eq "$(query_json "$CARGO_OUT" doc_dir)" "doc" "cargo doc_dir"
assert_eq "$(query_json "$CARGO_OUT" workspace.type)" "cargo-workspace" "cargo workspace type"
assert_eq "$(query_json "$CARGO_OUT" workspace.packages)" "[\"core\"]" "cargo workspace packages"
assert_eq "$(query_json "$CARGO_OUT" workspace.package_scope)" "null" "cargo package scope"
assert_eq "$(query_json "$CARGO_OUT" commands.build)" "cargo build" "cargo build"
assert_eq "$(query_json "$CARGO_OUT" commands.test)" "cargo test" "cargo test"
assert_eq "$(query_json "$CARGO_OUT" commands.test_watch)" "null" "cargo test_watch"
assert_eq "$(query_json "$CARGO_OUT" commands.typecheck)" "cargo check" "cargo typecheck"
assert_eq "$(query_json "$CARGO_OUT" commands.lint)" "cargo clippy" "cargo lint"
assert_eq "$(query_json "$CARGO_OUT" commands.lint_is_noop)" "false" "cargo lint_is_noop"
assert_eq "$(query_json "$CARGO_OUT" coverage_thresholds)" "{}" "cargo coverage thresholds"
assert_eq "$(query_json "$CARGO_OUT" protected_path_candidates)" "[\"crates/core/src/\"]" "cargo protected paths"
assert_eq "$(query_json "$CARGO_OUT" project_paths.projects_dir)" "doc/projects/" "cargo projects dir path"
assert_eq "$(query_json "$CARGO_OUT" project_paths.plans_dir)" "doc/plans/" "cargo plans dir path"
assert_eq "$(query_json "$CARGO_OUT" project_paths.backlog)" "doc/BACKLOG.md" "cargo backlog path"
assert_eq "$(query_json "$CARGO_OUT" project_paths.index)" "doc/projects/INDEX.md" "cargo index path"
assert_eq "$(query_json "$CARGO_OUT" project_paths.archive_dir)" "doc/projects/_archive/" "cargo archive dir path"
assert_eq "$(query_json "$CARGO_OUT" installed_plugins.superpowers)" "true" "cargo installed plugin flag"

# --- path-traversal guard: a `../*` workspace pattern must NOT escape the target ---
TRAV_HOME="$BASE_HOME/trav"; mkdir -p "$TRAV_HOME/.claude/plugins"
TRAV_OUT="$(HOME="$TRAV_HOME" node "$SCRIPT" "$FIXTURES_DIR/pnpm-traversal")"
assert_eq "$(query_json "$TRAV_OUT" workspace.packages)" "[\"safe\"]" "traversal: ../* rejected, only in-repo package returned"

# symlink escape: a workspace member that is a symlink pointing OUTSIDE the repo
# must be excluded (built at runtime so we never commit a symlink-to-/etc).
TRAV_SYM="$TEST_TMP/trav-sym"; mkdir -p "$TRAV_SYM/packages/safe/src" "$TRAV_SYM/.claude/plugins"
printf 'packages:\n  - "packages/*"\n' > "$TRAV_SYM/pnpm-workspace.yaml"
printf '{"name":"r","private":true}' > "$TRAV_SYM/package.json"
printf '{"name":"@t/safe","version":"1.0.0"}' > "$TRAV_SYM/packages/safe/package.json"
ln -s /etc "$TRAV_SYM/packages/evil"
TS_OUT="$(HOME="$TRAV_SYM" node "$SCRIPT" "$TRAV_SYM")"
assert_eq "$(query_json "$TS_OUT" workspace.packages)" "[\"safe\"]" "traversal: symlinked member escaping repo is excluded"

# the TARGET itself reached via a symlink must STILL detect its own in-repo packages
SYMT="$TEST_TMP/symtarget"; mkdir -p "$SYMT/packages/a/src"
printf 'packages:\n  - "packages/*"\n' > "$SYMT/pnpm-workspace.yaml"
printf '{"name":"r"}' > "$SYMT/package.json"; printf '{"name":"@s/a","version":"1.0.0"}' > "$SYMT/packages/a/package.json"
printf '{}' > "$SYMT/packages/a/src/i.js"
ln -s "$SYMT" "$TEST_TMP/symlink-to-target"
ST_OUT="$(HOME="$TEST_TMP" node "$SCRIPT" "$TEST_TMP/symlink-to-target")"
assert_eq "$(query_json "$ST_OUT" workspace.packages)" "[\"a\"]" "symlinked target still detects in-repo packages"

# dir/** treated as one level; `!negation` skipped
GLOB="$TEST_TMP/glob"; mkdir -p "$GLOB/packages/x/src"
printf 'packages:\n  - "packages/**"\n  - "!packages/skip"\n' > "$GLOB/pnpm-workspace.yaml"
printf '{"name":"r"}' > "$GLOB/package.json"; printf '{"name":"@g/x","version":"1.0.0"}' > "$GLOB/packages/x/package.json"
printf '{}' > "$GLOB/packages/x/src/i.js"
GL_OUT="$(HOME="$TEST_TMP" node "$SCRIPT" "$GLOB")"
assert_eq "$(query_json "$GL_OUT" workspace.packages)" "[\"x\"]" "dir/** one-level + negation skipped"

# --- npm workspaces OBJECT form ({ packages: [...] }) — must not misreport as single ---
NWO_HOME="$BASE_HOME/npm-ws-object"; mkdir -p "$NWO_HOME/.claude/plugins"
NWO_OUT="$(HOME="$NWO_HOME" node "$SCRIPT" "$FIXTURES_DIR/npm-ws-object")"
assert_eq "$(query_json "$NWO_OUT" workspace.type)" "npm-workspaces" "npm-ws-object workspace type (not single)"
assert_eq "$(query_json "$NWO_OUT" workspace.packages)" "[\"core\"]" "npm-ws-object packages"
assert_eq "$(query_json "$NWO_OUT" workspace.package_scope)" "@obj" "npm-ws-object scope"

# --- single-crate cargo fixture (no [workspace] — must still emit cargo commands) ---
CS_HOME="$BASE_HOME/cargo-single"; mkdir -p "$CS_HOME/.claude/plugins"
CS_OUT="$(HOME="$CS_HOME" node "$SCRIPT" "$FIXTURES_DIR/cargo-single")"
assert_eq "$(query_json "$CS_OUT" package_manager)" "cargo" "cargo-single package manager"
assert_eq "$(query_json "$CS_OUT" workspace.type)" "single" "cargo-single workspace type"
assert_eq "$(query_json "$CS_OUT" commands.build)" "cargo build" "cargo-single build (not null)"
assert_eq "$(query_json "$CS_OUT" commands.test)" "cargo test" "cargo-single test"
assert_eq "$(query_json "$CS_OUT" commands.typecheck)" "cargo check" "cargo-single typecheck"
assert_eq "$(query_json "$CS_OUT" commands.lint)" "cargo clippy" "cargo-single lint"
assert_eq "$(query_json "$CS_OUT" commands.lint_is_noop)" "false" "cargo-single lint_is_noop"

# --- single npm fixture (default target path) ---
SINGLE_HOME="$BASE_HOME/single"
mkdir -p "$SINGLE_HOME"
SINGLE_OUT="$(HOME="$SINGLE_HOME" sh -c 'cd "$1" && node "$2"' sh "$FIXTURES_DIR/single-npm" "$SCRIPT")"
assert_eq "$(query_json "$SINGLE_OUT" target)" "$(cd "$FIXTURES_DIR/single-npm" && pwd)" "single target defaults to cwd"
assert_eq "$(query_json "$SINGLE_OUT" package_manager)" "npm" "single package manager"
assert_eq "$(query_json "$SINGLE_OUT" doc_dir)" "null" "single doc_dir"
assert_eq "$(query_json "$SINGLE_OUT" workspace.type)" "single" "single workspace type"
assert_eq "$(query_json "$SINGLE_OUT" workspace.packages)" "[]" "single workspace packages"
assert_eq "$(query_json "$SINGLE_OUT" workspace.package_scope)" "null" "single package scope"
assert_eq "$(query_json "$SINGLE_OUT" commands.build)" "npm run build" "single build"
assert_eq "$(query_json "$SINGLE_OUT" commands.test)" "npm run test" "single test"
assert_eq "$(query_json "$SINGLE_OUT" commands.test_watch)" "null" "single test watch"
assert_eq "$(query_json "$SINGLE_OUT" commands.typecheck)" "null" "single typecheck"
assert_eq "$(query_json "$SINGLE_OUT" commands.lint)" "null" "single lint"
assert_eq "$(query_json "$SINGLE_OUT" commands.lint_is_noop)" "true" "single lint_is_noop"
assert_eq "$(query_json "$SINGLE_OUT" coverage_thresholds.single-npm.lines)" "88" "single coverage lines"
assert_eq "$(query_json "$SINGLE_OUT" coverage_thresholds.single-npm.functions)" "87" "single coverage functions"
assert_eq "$(query_json "$SINGLE_OUT" coverage_thresholds.single-npm.branches)" "85" "single coverage branches"
assert_eq "$(query_json "$SINGLE_OUT" coverage_thresholds.single-npm.statements)" "80" "single coverage statements"
assert_eq "$(query_json "$SINGLE_OUT" project_paths)" "null" "single project paths"
assert_eq "$(query_json "$SINGLE_OUT" protected_path_candidates)" "[\"src/\"]" "single protected paths"
assert_eq "$(query_json "$SINGLE_OUT" installed_plugins.superpowers)" "false" "single installed plugin flag"

finalize_test
