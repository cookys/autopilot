#!/usr/bin/env bash
# scaffold-config mechanical scaffolder tests (P3)
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/scaffold-config.js"
TARGET="$TEST_TMP/target"
DETECT_JSON="$TEST_TMP/detect.json"
mkdir -p "$TARGET"

cat > "$DETECT_JSON" <<'JSON'
{
  "target": "/tmp/example",
  "default_branch": null,
  "project_paths": {
    "projects_dir": "docs/projects/",
    "plans_dir": "docs/plans/",
    "backlog": "docs/BACKLOG.md",
    "index": "docs/projects/INDEX.md",
    "archive_dir": "docs/projects/_archive/"
  },
  "workspace": {
    "type": "pnpm-workspace",
    "packages": [
      "relay",
      "shared"
    ]
  },
  "commands": {
    "build": "pnpm -r build",
    "test": "pnpm -r test:ci",
    "test_watch": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "lint_is_noop": true
  },
  "coverage_thresholds": {
    "shared": {
      "lines": 95,
      "functions": 95,
      "branches": 90,
      "statements": 95
    },
    "relay": {
      "lines": 85,
      "functions": 85,
      "branches": 80,
      "statements": 85
    }
  },
  "protected_path_candidates": [
    "packages/relay/src/",
    "packages/shared/src/"
  ],
  "installed_plugins": {
    "superpowers": false
  }
}
JSON

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

# --- first scaffold run ---
OUT1="$(node "$SCRIPT" "$TARGET" --detect "$DETECT_JSON")"
SUMMARY1="$(printf '%s\n' "$OUT1" | tail -n 1)"
assert_eq "0" "$?" "scaffold-config first run exit code"
assert_eq "11" "$(query_json "$SUMMARY1" "written.length")" "first run writes 11 files (10 configs + settings env pin)"
assert_eq "0" "$(query_json "$SUMMARY1" "skipped.length")" "first run has no skipped files"

for file in next-config.md project-lifecycle-config.md dispatch-config.md quality-gate-config.md dev-flow-config.md test-strategy-config.md qc-gate-config.md skill-routing.md doc-drift-config.md; do
  assert_file_exists "$TARGET/.claude/$file"
  assert_neq "" "$(cat "$TARGET/.claude/$file")" "$file has content"
done

assert_contains "$(cat "$TARGET/.claude/quality-gate-config.md")" "pnpm -r typecheck && pnpm -r test:ci" "quality gate includes typecheck+test"
assert_contains "$(cat "$TARGET/.claude/quality-gate-config.md")" "packages/relay/src/" "scan uses real detected source paths (not bare package names)"
assert_not_contains "$(cat "$TARGET/.claude/quality-gate-config.md")" "node scripts/completeness-scan.sh" "scan does not invoke the shell script with node"
assert_contains "$(cat "$TARGET/.claude/test-strategy-config.md")" "95" "coverage table contains threshold values"
assert_contains "$(cat "$TARGET/.claude/qc-gate-config.md")" "mode: warn" "qc gate mode is warn"
assert_contains "$(cat "$TARGET/.claude/qc-gate-config.md")" "protected_paths: packages/relay/src/,packages/shared/src/" "qc gate uses protected paths"
assert_contains "$(cat "$TARGET/.claude/dispatch-config.md")" "autopilot:reviewer" "dispatch includes autopilot reviewer"
assert_not_contains "$(cat "$TARGET/.claude/dispatch-config.md")" "superpowers:" "dispatch does not prioritize superpowers"
assert_contains "$(cat "$TARGET/.claude/next-config.md")" "docs/projects/" "next-config uses detected projects path"
assert_file_exists "$TARGET/.gitignore"
assert_contains "$(cat "$TARGET/.gitignore")" "# autopilot runtime state (keep .claude/*-config.md tracked)" "gitignore runtime block present"
assert_contains "$(cat "$TARGET/.gitignore")" ".claude/tasks/" "gitignore excludes runtime tasks"

# --- second scaffold run: idempotent ---
OUT2="$(node "$SCRIPT" "$TARGET" --detect "$DETECT_JSON")"
SUMMARY2="$(printf '%s\n' "$OUT2" | tail -n 1)"
assert_eq "0" "$?" "second run exit code"
assert_eq "0" "$(query_json "$SUMMARY2" "written.length")" "second run writes none"
assert_eq "0" "$(query_json "$SUMMARY2" "skipped.length")" "second run skips none"
assert_eq "1" "$(grep -F -c "# autopilot runtime state (keep .claude/*-config.md tracked)" "$TARGET/.gitignore")" "gitignore marker not duplicated"
assert_eq "1" "$(grep -F -c ".claude/tasks/" "$TARGET/.gitignore")" "gitignore runtime task entry unique"

# --- hand edit skip vs --force overwrite ---
cp "$TARGET/.claude/quality-gate-config.md" "$TEST_TMP/quality-gate.before.md"
printf '\n# hand edit\n' >> "$TARGET/.claude/quality-gate-config.md"

OUT3="$(node "$SCRIPT" "$TARGET" --detect "$DETECT_JSON")"
SUMMARY3="$(printf '%s\n' "$OUT3" | tail -n 1)"
assert_contains "$(query_json "$SUMMARY3" "skipped")" "quality-gate-config.md" "hand-edited config is skipped"
assert_contains "$(cat "$TARGET/.claude/quality-gate-config.md")" "# hand edit" "hand edit preserved without --force"

OUT4="$(node "$SCRIPT" "$TARGET" --detect "$DETECT_JSON" --force)"
SUMMARY4="$(printf '%s\n' "$OUT4" | tail -n 1)"
assert_contains "$(query_json "$SUMMARY4" "written")" "quality-gate-config.md" "forced run should rewrite hand-edited file"
assert_not_contains "$(cat "$TARGET/.claude/quality-gate-config.md")" "# hand edit" "forced run overwrites hand edit"

# --- pre-existing wholesale `.claude/` ignore → WARNING (configs would be untracked) ---
WS_TARGET="$TEST_TMP/wholesale-ignore"; mkdir -p "$WS_TARGET"
printf '.claude/\nnode_modules/\n' > "$WS_TARGET/.gitignore"
WS_ERR="$(node "$SCRIPT" "$WS_TARGET" --detect "$DETECT_JSON" 2>&1 >/dev/null)"
assert_contains "$WS_ERR" "wholesale" "warns when target already ignores .claude/ wholesale"
# control: a target WITHOUT a wholesale ignore emits no such warning
# --- task-class-config (autonomous-brain P8): scaffolded verbatim from the canonical template ---
assert_file_exists "$TARGET/.claude/task-class-config.md" "task-class config scaffolded"
TC="$(cat "$TARGET/.claude/task-class-config.md")"
assert_contains "$TC" "hard-problem" "hard-problem class present"
assert_contains "$TC" "pinned to depth-0, NEVER dispatched" "depth-0 pin stated"
assert_contains "$TC" "ABSENT FILE = unchanged behavior" "absent-config semantics stated"
assert_contains "$TC" "STOP AND ASK" "ambiguity→ask rule stated"
assert_eq "$(sha256sum "$REPO_ROOT/project-config-template/task-class-config.md" | cut -d' ' -f1)" \
  "$(sha256sum "$TARGET/.claude/task-class-config.md" | cut -d' ' -f1)" \
  "scaffold copies the canonical template byte-identically (no second statement)"

NOWS_TARGET="$TEST_TMP/no-wholesale"; mkdir -p "$NOWS_TARGET"
printf 'node_modules/\n' > "$NOWS_TARGET/.gitignore"
NOWS_ERR="$(node "$SCRIPT" "$NOWS_TARGET" --detect "$DETECT_JSON" 2>&1 >/dev/null)"
assert_not_contains "$NOWS_ERR" "wholesale" "no false warning when .claude/ not pre-ignored"

# --- settings.json env pin (task tools gated off on 5-era models since CC 2.1.233) ---
assert_file_exists "$TARGET/.claude/settings.json" "settings.json scaffolded"
assert_eq "1" "$(query_json "$(cat "$TARGET/.claude/settings.json")" "env.CLAUDE_CODE_ENABLE_TODO_TOOLS")" \
  "fresh scaffold pins CLAUDE_CODE_ENABLE_TODO_TOOLS=1"
assert_contains "$(query_json "$SUMMARY1" "written")" "settings.json" "first run reports settings.json written"
assert_eq "true" "$(query_json "$SUMMARY1" "settings_env_pinned")" "summary reports settings_env_pinned"
assert_eq "false" "$(query_json "$SUMMARY2" "settings_env_pinned")" "second run does not re-pin"

# merge preserves existing keys, without --force (merge is additive, not an overwrite)
MERGE_TARGET="$TEST_TMP/settings-merge"; mkdir -p "$MERGE_TARGET/.claude"
printf '{\n  "model": "claude-sonnet-5",\n  "env": {\n    "FOO": "bar"\n  }\n}\n' > "$MERGE_TARGET/.claude/settings.json"
OUT_M="$(node "$SCRIPT" "$MERGE_TARGET" --detect "$DETECT_JSON")"
SUMMARY_M="$(printf '%s\n' "$OUT_M" | tail -n 1)"
MERGED="$(cat "$MERGE_TARGET/.claude/settings.json")"
assert_eq "claude-sonnet-5" "$(query_json "$MERGED" "model")" "merge preserves unrelated top-level keys"
assert_eq "bar" "$(query_json "$MERGED" "env.FOO")" "merge preserves unrelated env keys"
assert_eq "1" "$(query_json "$MERGED" "env.CLAUDE_CODE_ENABLE_TODO_TOOLS")" "merge adds the pin"
assert_eq "true" "$(query_json "$SUMMARY_M" "settings_env_pinned")" "merge run reports pinned"

# an EXPLICIT existing value — even an opt-out — is the user's choice and stays untouched
OPTOUT_TARGET="$TEST_TMP/settings-optout"; mkdir -p "$OPTOUT_TARGET/.claude"
printf '{\n  "env": {\n    "CLAUDE_CODE_ENABLE_TODO_TOOLS": "0"\n  }\n}\n' > "$OPTOUT_TARGET/.claude/settings.json"
OUT_O="$(node "$SCRIPT" "$OPTOUT_TARGET" --detect "$DETECT_JSON")"
SUMMARY_O="$(printf '%s\n' "$OUT_O" | tail -n 1)"
assert_eq "0" "$(query_json "$(cat "$OPTOUT_TARGET/.claude/settings.json")" "env.CLAUDE_CODE_ENABLE_TODO_TOOLS")" \
  "explicit opt-out value is respected"
assert_eq "false" "$(query_json "$SUMMARY_O" "settings_env_pinned")" "opt-out run reports not pinned"

# invalid JSON → warn + skip, byte-identical file (never clobber what we cannot parse)
BADJSON_TARGET="$TEST_TMP/settings-badjson"; mkdir -p "$BADJSON_TARGET/.claude"
printf '{not json' > "$BADJSON_TARGET/.claude/settings.json"
BAD_ERR="$(node "$SCRIPT" "$BADJSON_TARGET" --detect "$DETECT_JSON" 2>&1 >/dev/null)"
assert_contains "$BAD_ERR" "not valid JSON" "invalid settings.json warns"
assert_eq "{not json" "$(cat "$BADJSON_TARGET/.claude/settings.json")" "invalid settings.json left untouched"

# pin file itself gitignored → loud warning (foremen worktrees never see ignored files)
IGNPIN_TARGET="$TEST_TMP/settings-ignored"; mkdir -p "$IGNPIN_TARGET"
printf '.claude/settings.json\n' > "$IGNPIN_TARGET/.gitignore"
IGN_ERR="$(node "$SCRIPT" "$IGNPIN_TARGET" --detect "$DETECT_JSON" 2>&1 >/dev/null)"
assert_contains "$IGN_ERR" "env pin will not reach" "warns when settings.json is gitignored"

# --- --dry-run does not write ---
DRY_TARGET="$TEST_TMP/dry-run-target"
mkdir -p "$DRY_TARGET"
OUT5="$(node "$SCRIPT" "$DRY_TARGET" --detect "$DETECT_JSON" --dry-run)"
SUMMARY5="$(printf '%s\n' "$OUT5" | tail -n 1)"
assert_eq "11" "$(query_json "$SUMMARY5" "written.length")" "dry-run reports prospective writes"
assert_file_absent "$DRY_TARGET/.claude"
assert_file_absent "$DRY_TARGET/.gitignore"

finalize_test
