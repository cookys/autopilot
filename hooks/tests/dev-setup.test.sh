#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dev-setup.sh"

make_claude_registry() {
  local home="$1"
  mkdir -p "$home/.claude/plugins"
  cat > "$home/.claude/plugins/installed_plugins.json" <<'JSON'
{
  "version": 2,
  "plugins": {
    "autopilot@autopilot": [
      {
        "scope": "user",
        "installPath": "/old/path",
        "version": "1.0.0",
        "installedAt": "2026-01-01T00:00:00.000Z",
        "lastUpdated": "2026-01-01T00:00:00.000Z",
        "gitCommitSha": "old"
      }
    ]
  }
}
JSON
}

count_home_entries() {
  find "$1" -mindepth 1 -print | wc -l | tr -d ' '
}

OUT="$(bash "$SCRIPT" --help 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "help exits 0"
assert_contains "$OUT" "--check" "help documents --check"
assert_contains "$OUT" "--install" "help documents --install"
assert_contains "$OUT" "--harness" "help documents --harness"

LEGACY_HOME="$TEST_TMP/legacy-home"
make_claude_registry "$LEGACY_HOME"
OUT="$(HOME="$LEGACY_HOME" bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "no-arg legacy Claude setup exits 0"
assert_file_exists "$LEGACY_HOME/.claude/plugins/cache/autopilot/autopilot/dev" "legacy creates dev symlink"
assert_eq "$(readlink -f "$LEGACY_HOME/.claude/plugins/cache/autopilot/autopilot/dev")" "$REPO_ROOT" "legacy symlink points at repo"
REG_PATH="$(HOME="$LEGACY_HOME" node - <<'NODE'
const fs = require('fs');
const p = `${process.env.HOME}/.claude/plugins/installed_plugins.json`;
const entry = JSON.parse(fs.readFileSync(p, 'utf8')).plugins['autopilot@autopilot'][0];
console.log(entry.installPath);
NODE
)"
assert_eq "$REG_PATH" "$LEGACY_HOME/.claude/plugins/cache/autopilot/autopilot/dev" "legacy registry points at dev symlink"
BACKUPS="$(find "$LEGACY_HOME/.claude/plugins" -maxdepth 1 -name 'installed_plugins.json.bak-*' -print | wc -l | tr -d ' ')"
assert_eq "$BACKUPS" "1" "legacy setup creates registry backup before write"

CHECK_HOME="$TEST_TMP/check-home"
mkdir -p "$CHECK_HOME"
mkdir -p "$TEST_TMP/no-cli-bin"
BEFORE_COUNT="$(count_home_entries "$CHECK_HOME")"
OUT="$(HOME="$CHECK_HOME" PATH="$TEST_TMP/no-cli-bin:/usr/bin:/bin" bash "$SCRIPT" --check --harness claude 2>&1)"; EXIT=$?
AFTER_COUNT="$(count_home_entries "$CHECK_HOME")"
assert_eq "$EXIT" "0" "claude check without install exits 0 on missing user config"
assert_contains "$OUT" "WARN claude" "claude check reports missing user config as warning"
assert_eq "$AFTER_COUNT" "$BEFORE_COUNT" "claude check does not write HOME"

OUT="$(HOME="$CHECK_HOME" PATH="$TEST_TMP/no-cli-bin:/usr/bin:/bin" bash "$SCRIPT" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "--check without harness exits 0"
assert_contains "$OUT" "WARN claude" "--check without harness includes Claude"
assert_contains "$OUT" "codex" "--check without harness includes Codex"
assert_contains "$OUT" "opencode" "--check without harness includes OpenCode"
assert_contains "$OUT" "agy" "--check without harness includes agy"

AGY_HOME="$TEST_TMP/agy-home"
mkdir -p "$AGY_HOME/.gemini/config/plugins"
ln -s "$REPO_ROOT" "$AGY_HOME/.gemini/config/plugins/autopilot"
OUT="$(HOME="$AGY_HOME" PATH="$TEST_TMP/no-cli-bin:/usr/bin:/bin" bash "$SCRIPT" --check --harness agy 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "agy check fails on symlink hazard"
assert_contains "$OUT" "FAIL agy" "agy check marks symlink hazard as fail"

STUB_BIN="$TEST_TMP/stub-bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/codex" <<'SH'
#!/usr/bin/env bash
case "$1" in
  --version)
    echo "codex-cli test"
    exit 0
    ;;
  plugin)
    echo "codex plugin should not be probed without active CLI checks" >> "$CODEX_STUB_MARKER"
    exit 42
    ;;
  *)
    exit 42
    ;;
esac
SH
chmod +x "$STUB_BIN/codex"
CODEX_STUB_MARKER="$TEST_TMP/codex-stub-marker" OUT="$(HOME="$CHECK_HOME" PATH="$STUB_BIN:/usr/bin:/bin" CODEX_STUB_MARKER="$TEST_TMP/codex-stub-marker" bash "$SCRIPT" --harness codex 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "codex harness without --install is check-only"
assert_contains "$OUT" "strict read-only mode" "codex check skips active CLI probes"
assert_file_absent "$TEST_TMP/codex-stub-marker" "codex check does not call codex plugin subcommands"
assert_not_contains "$OUT" "Sync and install" "codex check does not run install path"

OUT="$(bash "$REPO_ROOT/platforms/codex/plugin/scripts/dev-setup.sh" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "Codex package dev-setup refuses to run from generated payload"
assert_contains "$OUT" "source repository" "Codex package dev-setup explains source repo requirement"

finalize_test
