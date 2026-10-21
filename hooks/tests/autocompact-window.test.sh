#!/usr/bin/env bash
# scripts/lib/autocompact-window.js — re-derives Claude Code's auto-compact window from env +
# settings files. Every case runs against a scratch HOME/config dir; the real ~/.claude is never read.
. "$(dirname "$0")/lib.sh"

LIB="$REPO_ROOT/scripts/lib/autocompact-window.js"
CFG="$TEST_TMP/cfg"
PROJ="$TEST_TMP/proj"
MANAGED="$TEST_TMP/managed-settings.json"
mkdir -p "$CFG" "$PROJ/.claude"

reset_files() {
  rm -f "$CFG/settings.json" "$PROJ/.claude/settings.json" "$PROJ/.claude/settings.local.json" \
    "$MANAGED" "$TEST_TMP/claude.json"
}

# r <field> [model] [env assignments...] — one resolve() field as JSON text.
r() {
  local field="$1" model="${2:-}"
  shift 2 2>/dev/null || shift $#
  env -u CLAUDE_CODE_AUTO_COMPACT_WINDOW -u DISABLE_AUTO_COMPACT -u DISABLE_COMPACT -u CLAUDE_CONFIG_DIR \
    -u CLAUDE_PROJECT_DIR "$@" node -e '
      const { resolve } = require(process.argv[1]);
      const out = resolve({ home: process.argv[2], configDir: process.argv[3], projectDir: process.argv[4],
        managedPath: process.argv[5], claudeJsonPath: process.argv[6], model: process.argv[7] || undefined });
      process.stdout.write(JSON.stringify(out[process.argv[8]]));
    ' "$LIB" "$TEST_TMP" "$CFG" "$PROJ" "$MANAGED" "$TEST_TMP/claude.json" "$model" "$field"
}

# --- nothing set anywhere
reset_files
assert_eq "$(r configured claude-opus-5-5)" "null" "no settings: configured null"
assert_eq "$(r enabled claude-opus-5-5)" "true" "no settings: compaction enabled"

# --- user top-level key
echo '{"autoCompactWindow": 250000}' > "$CFG/settings.json"
assert_eq "$(r configured claude-opus-5-5)" "250000" "user top-level: 250000"
assert_eq "$(r scope claude-opus-5-5)" '"default"' "user top-level: scope default"
assert_eq "$(r origin claude-opus-5-5)" "\"$CFG/settings.json\"" "user top-level: origin is the user file"

# --- env wins, raised to the floor, capped at the ceiling, ignored when not a number
assert_eq "$(r configured claude-opus-5-5 CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000)" "400000" "env beats settings"
assert_eq "$(r source claude-opus-5-5 CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000)" '"env"' "env: source env"
assert_eq "$(r configured claude-opus-5-5 CLAUDE_CODE_AUTO_COMPACT_WINDOW=50000)" "100000" "env below floor: raised to 100000"
assert_eq "$(r configured claude-opus-5-5 CLAUDE_CODE_AUTO_COMPACT_WINDOW=2000000)" "1000000" "env above ceiling: capped"
assert_eq "$(r configured claude-opus-5-5 CLAUDE_CODE_AUTO_COMPACT_WINDOW=lots)" "250000" "env not a number: falls through to settings"

# --- /autocompact writes a per-model entry; it beats the default, and only for that model
echo '{"autoCompactWindow": 250000, "modelSettings": {"claude-opus-5-5": {"autoCompactWindow": 300000}}}' > "$CFG/settings.json"
assert_eq "$(r configured claude-opus-5-5)" "300000" "per-model entry beats the default"
assert_eq "$(r scope claude-opus-5-5)" '"model"' "per-model: scope model"
assert_eq "$(r configured 'claude-opus-5-5[1m]')" "300000" "[1m] model id matches the canonical key"
assert_eq "$(r configured claude-opus-5-5-20261001)" "300000" "dated model id matches the canonical key"
assert_eq "$(r configured claude-sonnet-5-5)" "250000" "another model gets the default"
assert_eq "$(r configured '')" "250000" "unknown model gets the default"

# --- per-model only (no top-level): an unlisted model is not set
echo '{"modelSettings": {"claude-opus-5-5": {"autoCompactWindow": 250000}}}' > "$CFG/settings.json"
assert_eq "$(r configured claude-opus-5-5)" "250000" "per-model only: listed model set"
assert_eq "$(r configured claude-fable-5-1)" "null" "per-model only: unlisted model not set"
assert_eq "$(r per_model '')" '{"claude-opus-5-5":250000}' "per-model only: reported in per_model"

# --- "auto" means not set, at either level
echo '{"autoCompactWindow": "auto"}' > "$CFG/settings.json"
assert_eq "$(r configured claude-opus-5-5)" "null" "top-level auto: not set"
echo '{"autoCompactWindow": 250000, "modelSettings": {"claude-opus-5-5": {"autoCompactWindow": "auto"}}}' > "$CFG/settings.json"
assert_eq "$(r configured claude-opus-5-5)" "null" "per-model auto does not fall back to the default"

# --- out-of-range values are rejected like Claude Code's schema
echo '{"autoCompactWindow": 50000}' > "$CFG/settings.json"
assert_eq "$(r configured claude-opus-5-5)" "null" "settings value below 100000 is ignored"

# --- merge order user -> project -> local -> policy; a later top-level key drops earlier per-model entries
echo '{"modelSettings": {"claude-opus-5-5": {"autoCompactWindow": 300000}}}' > "$CFG/settings.json"
echo '{"autoCompactWindow": 200000}' > "$PROJ/.claude/settings.json"
assert_eq "$(r configured claude-opus-5-5)" "200000" "project top-level drops the user per-model entry"
assert_eq "$(r origin claude-opus-5-5)" "\"$PROJ/.claude/settings.json\"" "origin is the project file"
echo '{"modelSettings": {"claude-opus-5-5": {"autoCompactWindow": 350000}}}' > "$PROJ/.claude/settings.local.json"
assert_eq "$(r configured claude-opus-5-5)" "350000" "local per-model merges over project default"
echo '{"autoCompactWindow": 500000}' > "$MANAGED"
assert_eq "$(r configured claude-opus-5-5)" "500000" "policy top-level wins last"

# --- disabled compaction
reset_files
echo '{"autoCompactEnabled": false}' > "$CFG/settings.json"
assert_eq "$(r enabled claude-opus-5-5)" "false" "settings autoCompactEnabled false: disabled"
reset_files
echo '{"autoCompactEnabled": false}' > "$TEST_TMP/claude.json"
assert_eq "$(r enabled claude-opus-5-5)" "false" ".claude.json autoCompactEnabled false: disabled"
reset_files
assert_eq "$(r enabled claude-opus-5-5 DISABLE_AUTO_COMPACT=1)" "false" "env DISABLE_AUTO_COMPACT: disabled"
assert_eq "$(r disabled_by claude-opus-5-5 DISABLE_COMPACT=1)" '"env DISABLE_COMPACT"' "env DISABLE_COMPACT named"

# DISABLE_* use Claude Code's own predicate (2.1.296 binary `Ne`): only 1/true/yes/on, trimmed, any case.
for v in 0 false no off banana ""; do
  assert_eq "$(r enabled claude-opus-5-5 DISABLE_AUTO_COMPACT="$v")" "true" "DISABLE_AUTO_COMPACT='$v': not disabled"
  assert_eq "$(r enabled claude-opus-5-5 DISABLE_COMPACT="$v")" "true" "DISABLE_COMPACT='$v': not disabled"
done
for v in 1 true TRUE yes on " On "; do
  assert_eq "$(r enabled claude-opus-5-5 DISABLE_AUTO_COMPACT="$v")" "false" "DISABLE_AUTO_COMPACT='$v': disabled"
done

# --- managed path override via env (no managedPath option): the file is honoured, and absent means unset
echo '{"autoCompactWindow": 640000}' > "$MANAGED"
ov() {
  env -u CLAUDE_CODE_AUTO_COMPACT_WINDOW -u CLAUDE_CONFIG_DIR -u CLAUDE_PROJECT_DIR "$@" node -e '
    const { resolve } = require(process.argv[1]);
    process.stdout.write(JSON.stringify(resolve({ home: process.argv[2], configDir: process.argv[3], claudeJsonPath: process.argv[4] }).configured));
  ' "$LIB" "$TEST_TMP" "$CFG" "$TEST_TMP/claude.json"
}
assert_eq "$(ov AUTOPILOT_MANAGED_SETTINGS_FILE="$MANAGED")" "640000" "env managed path override is read"
assert_eq "$(ov AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/nope.json")" "null" "env managed path override to a missing file: not set"
reset_files

# --- corrupt settings file: treated as absent
echo '{not json' > "$CFG/settings.json"
assert_eq "$(r configured claude-opus-5-5)" "null" "corrupt settings: not set, no throw"

# --- recommendation(): only a 1M window, nothing set, compaction on
rec() {
  node -e '
    const { recommendation } = require(process.argv[1]);
    const out = recommendation(JSON.parse(process.argv[2]), Number(process.argv[3]));
    process.stdout.write(out === null ? "null" : "tip");
  ' "$LIB" "$1" "$2"
}
assert_eq "$(rec '{"configured":null,"enabled":true}' 1000000)" "tip" "recommendation: 1M, unset, enabled"
TIP="$(node -e '
  const { recommendation } = require(process.argv[1]);
  process.stdout.write(recommendation({ configured: null, enabled: true }, 1000000) || "");
' "$LIB")"
assert_contains "$TIP" "250000" "recommendation names 250000"
# RED at 56095b46c: recommendation tip had 250000 and ~/.claude/settings.json but not 33000 or ~/.autopilot/config.json
assert_contains "$TIP" "33000" "recommendation names the 33000 pairing"
assert_contains "$TIP" "~/.claude/settings.json" "recommendation names settings.json"
assert_contains "$TIP" "~/.autopilot/config.json" "recommendation names config.json"
assert_eq "$(rec '{"configured":null,"enabled":true}' 200000)" "null" "recommendation: 200K window, none"
assert_eq "$(rec '{"configured":250000,"enabled":true}' 1000000)" "null" "recommendation: set, none"
assert_eq "$(rec '{"configured":null,"enabled":false}' 1000000)" "null" "recommendation: disabled, none"
assert_eq "$(rec '{"configured":null,"enabled":true}' NaN)" "null" "recommendation: unknown window, none"

# --- CLI prints JSON
reset_files
OUT="$(env -u CLAUDE_CODE_AUTO_COMPACT_WINDOW -u CLAUDE_PROJECT_DIR HOME="$TEST_TMP" CLAUDE_CONFIG_DIR="$CFG" \
  node "$LIB" --project-dir "$PROJ" --model claude-opus-5-5)"; EXIT=$?
assert_eq "$EXIT" "0" "CLI exits 0"
assert_contains "$OUT" '"configured":' "CLI: JSON with configured"

finalize_test
