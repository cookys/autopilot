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
assert_contains "$OUT" "opencode" "help documents OpenCode harness"

OUT="$(bash "$SCRIPT" --install 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "--install without harness/all exits 1"
assert_contains "$OUT" "--install requires --harness" "--install without target explains required selector"

# Stub claude CLI: records the marketplace registration, never touches a real ~/.claude.
CLAUDE_STUB="$TEST_TMP/claude-stub"
cat > "$CLAUDE_STUB" <<'SH'
#!/usr/bin/env bash
echo "claude $*" >> "$CLAUDE_STUB_MARKER"
exit 0
SH
chmod +x "$CLAUDE_STUB"

LEGACY_HOME="$TEST_TMP/legacy-home"
make_claude_registry "$LEGACY_HOME"
LEGACY_MARKER="$TEST_TMP/claude-legacy-marker"
OUT="$(HOME="$LEGACY_HOME" DEV_SETUP_CLAUDE_BIN="$CLAUDE_STUB" CLAUDE_STUB_MARKER="$LEGACY_MARKER" bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "no-arg legacy Claude setup exits 0"
assert_contains "$(cat "$LEGACY_MARKER")" "claude plugin marketplace add $REPO_ROOT" "setup registers the repo as a directory marketplace"
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
NODE_RUNTIME_BIN="$TEST_TMP/node-runtime-bin"
mkdir -p "$NODE_RUNTIME_BIN"
ln -s "$(command -v node)" "$NODE_RUNTIME_BIN/node"
CHECK_PATH="$TEST_TMP/no-cli-bin:$NODE_RUNTIME_BIN:/usr/bin:/bin"
BEFORE_COUNT="$(count_home_entries "$CHECK_HOME")"
OUT="$(HOME="$CHECK_HOME" PATH="$CHECK_PATH" bash "$SCRIPT" --check --harness claude 2>&1)"; EXIT=$?
AFTER_COUNT="$(count_home_entries "$CHECK_HOME")"
assert_eq "$EXIT" "0" "claude check without install exits 0 on missing user config"
assert_contains "$OUT" "WARN claude" "claude check reports missing user config as warning"
assert_eq "$AFTER_COUNT" "$BEFORE_COUNT" "claude check does not write HOME"

OUT="$(HOME="$CHECK_HOME" PATH="$CHECK_PATH" bash "$SCRIPT" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "--check without harness exits 0"
assert_contains "$OUT" "WARN claude" "--check without harness includes Claude"
assert_contains "$OUT" "codex" "--check without harness includes Codex"
assert_contains "$OUT" "opencode" "--check without harness includes OpenCode"
assert_contains "$OUT" "agy" "--check without harness includes agy"

AGY_HOME="$TEST_TMP/agy-home"
mkdir -p "$AGY_HOME/.gemini/config/plugins"
ln -s "$REPO_ROOT" "$AGY_HOME/.gemini/config/plugins/autopilot"
OUT="$(HOME="$AGY_HOME" PATH="$CHECK_PATH" bash "$SCRIPT" --check --harness agy 2>&1)"; EXIT=$?
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
CODEX_STUB_MARKER="$TEST_TMP/codex-stub-marker" OUT="$(HOME="$CHECK_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" CODEX_STUB_MARKER="$TEST_TMP/codex-stub-marker" bash "$SCRIPT" --harness codex 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "codex harness without --install is check-only"
assert_contains "$OUT" "strict read-only mode" "codex check skips active CLI probes"
assert_file_absent "$TEST_TMP/codex-stub-marker" "codex check does not call codex plugin subcommands"
assert_not_contains "$OUT" "Sync and install" "codex check does not run install path"

# --- Codex update under live sessions (2026-09-07, peer report: PostCompact MODULE_NOT_FOUND
# after every plugin update). Both `plugin add` (in-place upgrade) and `plugin remove` replace
# the versioned cache dir a running session's PLUGIN_ROOT points at. dev-setup must refuse
# BEFORE any mutation unless --force, and must never call `plugin remove` any more.
cat > "$STUB_BIN/codex" <<'SH'
#!/usr/bin/env bash
case "$1" in
  --version) echo "codex-cli test"; exit 0 ;;
  plugin)
    echo "codex $*" >> "$CODEX_STUB_MARKER"
    if [[ "$2" == "marketplace" && "$3" == "list" ]]; then echo "autopilot-local  /x"; fi
    exit 0
    ;;
  *) exit 42 ;;
esac
SH
chmod +x "$STUB_BIN/codex"
LIVE_MARKER="$TEST_TMP/codex-live-marker"
OUT="$(HOME="$CHECK_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" CODEX_STUB_MARKER="$LIVE_MARKER" DEV_SETUP_CODEX_PIDS="4242 4243" bash "$SCRIPT" --harness codex --install 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "codex --install refuses while Codex sessions are running"
assert_contains "$OUT" "pid: 4242 4243" "refusal names the live Codex pids"
assert_contains "$OUT" "MODULE_NOT_FOUND" "refusal explains the PostCompact breakage it prevents"
assert_contains "$OUT" "--force" "refusal names the override"
assert_file_absent "$LIVE_MARKER" "refusal happens before any codex plugin mutation"

FORCE_MARKER="$TEST_TMP/codex-force-marker"
OUT="$(HOME="$CHECK_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" CODEX_STUB_MARKER="$FORCE_MARKER" DEV_SETUP_CODEX_PIDS="4242" bash "$SCRIPT" --harness codex --install --force 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "codex --install --force proceeds under live sessions"
assert_contains "$(cat "$FORCE_MARKER")" "codex plugin add autopilot@autopilot-local" "forced update installs via plugin add"
assert_not_contains "$(cat "$FORCE_MARKER")" "plugin remove" "update never runs plugin remove (add upgrades in place; remove only deletes the cache twice)"
assert_contains "$OUT" "still reference the previous plugin cache" "forced update tells the operator to restart live sessions"

QUIET_MARKER="$TEST_TMP/codex-quiet-marker"
OUT="$(HOME="$CHECK_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" CODEX_STUB_MARKER="$QUIET_MARKER" DEV_SETUP_CODEX_PIDS="" bash "$SCRIPT" --harness codex --install 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "codex --install proceeds when no Codex session is running"
assert_not_contains "$(cat "$QUIET_MARKER")" "plugin remove" "quiet update never runs plugin remove"
assert_not_contains "$OUT" "still reference" "quiet update prints no restart note"

cat > "$STUB_BIN/opencode2" <<'SH'
#!/usr/bin/env bash
echo "opencode2 v0.0.0-next-mismatch"
SH
chmod +x "$STUB_BIN/opencode2"
# Keep REAL node+npm reachable: the installer preflights npm and reads the pin
# via `node -p` BEFORE the version check. On hosts whose node lives outside
# /usr/bin (nvm), the stripped PATH would fail those gates and never reach the
# mismatch branch under test — prepend the real node bin dir (node and npm
# share it) while still shadowing opencode2 with the stub.
NODE_BIN_DIR="$(dirname "$(command -v node)")"
OUT="$(HOME="$CHECK_HOME" PATH="$STUB_BIN:$NODE_BIN_DIR:/usr/bin:/bin" bash "$REPO_ROOT/scripts/install-opencode.sh" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "OpenCode installer fails closed on version mismatch"
assert_contains "$OUT" "version mismatch" "OpenCode installer explains pinned nightly mismatch"

OUT="$(bash "$REPO_ROOT/platforms/codex/plugin/scripts/dev-setup.sh" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "Codex package dev-setup refuses to run from generated payload"
assert_contains "$OUT" "source repository" "Codex package dev-setup explains source repo requirement"
assert_file_absent "$REPO_ROOT/platforms/codex/plugin/scripts/install-opencode.sh" "Codex payload excludes source-repo OpenCode installer"
assert_file_absent "$REPO_ROOT/platforms/codex/plugin/scripts/sync-opencode-plugin.sh" "Codex payload excludes OpenCode sync script"

# --- Marketplace-source doctor (2026-10-06): the full plugin loader copies a non-directory
# marketplace clone into cache/<mkt>/<plugin>/<version>/ and loads it instead of the dev symlink.
doctor_home() {
  local home="$1" kind="$2"
  make_claude_registry "$home"
  mkdir -p "$home/.claude/plugins/cache/autopilot/autopilot"
  ln -s "$REPO_ROOT" "$home/.claude/plugins/cache/autopilot/autopilot/dev"
  case "$kind" in
    directory) printf '{"autopilot":{"source":{"source":"directory","path":"%s"}}}\n' "$REPO_ROOT" ;;
    github) printf '{"autopilot":{"source":{"source":"github","repo":"cookys/autopilot"}}}\n' ;;
  esac > "$home/.claude/plugins/known_marketplaces.json"
}

DIR_HOME="$TEST_TMP/doctor-dir"
doctor_home "$DIR_HOME" directory
OUT="$(HOME="$DIR_HOME" PATH="$CHECK_PATH" bash "$SCRIPT" --check --harness claude 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "doctor: directory marketplace exits 0"
assert_contains "$OUT" "OK   claude     autopilot marketplace is directory-sourced at $REPO_ROOT" "doctor: directory-sourced marketplace is OK"
assert_not_contains "$OUT" "versioned plugin cache dir" "doctor: no semver dir, no cache warning"

GH_HOME="$TEST_TMP/doctor-gh"
doctor_home "$GH_HOME" github
OUT="$(HOME="$GH_HOME" PATH="$CHECK_PATH" bash "$SCRIPT" --check --harness claude 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "doctor: github marketplace is a warning, not a failure"
assert_contains "$OUT" "WARN claude     autopilot marketplace source is \"github\"" "doctor: github-sourced marketplace warns"
assert_contains "$OUT" "fix: claude plugin marketplace add $REPO_ROOT" "doctor: warning names the fix command"

MISSING_HOME="$TEST_TMP/doctor-missing"
doctor_home "$MISSING_HOME" none
OUT="$(HOME="$MISSING_HOME" PATH="$CHECK_PATH" bash "$SCRIPT" --check --harness claude 2>&1)"
assert_contains "$OUT" 'source is "missing"' "doctor: absent marketplace entry warns"

# A semver cache dir warns (never deleted); .in_use pids are reported.
SEMVER_HOME="$TEST_TMP/doctor-semver"
doctor_home "$SEMVER_HOME" directory
SEMVER_DIR="$SEMVER_HOME/.claude/plugins/cache/autopilot/autopilot/2.36.36"
mkdir -p "$SEMVER_DIR/.in_use"
: > "$SEMVER_DIR/.in_use/999999999"
OUT="$(HOME="$SEMVER_HOME" PATH="$CHECK_PATH" bash "$SCRIPT" --check --harness claude 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "doctor: semver cache dir is a warning, not a failure"
assert_contains "$OUT" "versioned plugin cache dir $SEMVER_DIR/" "doctor: semver cache dir warns"
assert_contains "$OUT" "pid(s): 999999999 (alive: none)" "doctor: .in_use pids listed with liveness"
assert_contains "$OUT" "Safe to remove once no listed pid is alive" "doctor: removal guidance given"
assert_file_exists "$SEMVER_DIR" "doctor never deletes the semver dir"

finalize_test
