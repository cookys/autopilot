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

# --- Auto-compact window (2026-10-12): with none set, a 1M session compacts only near 1M.
# Run from the scratch HOME so $PWD has no project settings; the real config dir is never read.
AC_HOME="$TEST_TMP/doctor-autocompact"
doctor_home "$AC_HOME" directory
run_ac_check() {
  (cd "$AC_HOME" && env -u CLAUDE_CONFIG_DIR -u CLAUDE_PROJECT_DIR -u CLAUDE_CODE_AUTO_COMPACT_WINDOW \
    -u DISABLE_AUTO_COMPACT -u DISABLE_COMPACT "$@" HOME="$AC_HOME" PATH="$CHECK_PATH" \
    bash "$SCRIPT" --check --harness claude 2>&1)
}
OUT="$(run_ac_check)"; EXIT=$?
assert_eq "$EXIT" "0" "doctor: no auto-compact window is a warning, not a failure"
assert_contains "$OUT" 'WARN claude     no autoCompactWindow set' "doctor: unset auto-compact window warns"
assert_contains "$OUT" '"autoCompactWindow": 250000' "doctor: warning names the setting"
printf '{"autoCompactWindow": 250000}\n' > "$AC_HOME/.claude/settings.json"
OUT="$(run_ac_check)"
assert_contains "$OUT" "OK   claude     auto-compact window 250000 (settings: $AC_HOME/.claude/settings.json)" "doctor: set window reported with its file"
OUT="$(run_ac_check CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000)"
assert_contains "$OUT" "auto-compact window 400000 (env: CLAUDE_CODE_AUTO_COMPACT_WINDOW)" "doctor: env window wins"
OUT="$(run_ac_check DISABLE_AUTO_COMPACT=1)"
assert_contains "$OUT" "auto-compact is off (env DISABLE_AUTO_COMPACT)" "doctor: disabled compaction reported"

# --- Codex dev hooks survive plugin-cache replacement (user hooks.json + hookless marketplace).
# RED at cdb03a173: 13 failed — no hooks.json, commands/cache/once-checks ENOENT, marketplace add still not the derived dir, no hooks.json.bak, --uninstall exit 1 and no plugin-remove hint, malformed hooks.json accepted (exit 0), help lacks --uninstall.
cat > "$STUB_BIN/codex" <<'SH'
#!/usr/bin/env bash
case "$1" in
  --version) echo "codex-cli test"; exit 0 ;;
  plugin)
    echo "codex $*" >> "$CODEX_STUB_MARKER"
    exit 0
    ;;
  *) exit 42 ;;
esac
SH
chmod +x "$STUB_BIN/codex"

codex_dev_install() {
  local home="$1" marker="$2"
  HOME="$home" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" \
    CODEX_STUB_MARKER="$marker" DEV_SETUP_CODEX_PIDS="" \
    bash "$SCRIPT" --harness codex --install
}

HOOKS_REPO_DIR="$REPO_ROOT/platforms/codex/plugin/hooks"
STABLE_PREFIX="node \"$HOOKS_REPO_DIR/"

# (a) install writes three stable events
A_HOME="$TEST_TMP/codex-hooks-a"
A_MARKER="$TEST_TMP/codex-hooks-a-marker"
mkdir -p "$A_HOME"
OUT="$(codex_dev_install "$A_HOME" "$A_MARKER" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "codex dev install writes user hooks"
A_HOOKS="$A_HOME/.codex/hooks.json"
assert_file_exists "$A_HOOKS" "codex dev install creates hooks.json"
node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const prefix = process.argv[2];
const events = ["PostCompact", "Stop", "SessionEnd"];
const hooks = doc.hooks || {};
if (events.some((e) => !Array.isArray(hooks[e]) || hooks[e].length === 0)) process.exit(2);
const cmds = [];
for (const event of events) {
  for (const group of hooks[event]) {
    for (const hook of group.hooks || []) cmds.push(hook.command || "");
  }
}
if (cmds.length !== 3) process.exit(3);
if (cmds.some((c) => !c.startsWith(prefix) || c.includes("||"))) process.exit(4);
for (const cmd of cmds) {
  const m = cmd.match(/^node "([^"]+)"$/);
  if (!m || !fs.existsSync(m[1])) process.exit(5);
}
' "$A_HOOKS" "$STABLE_PREFIX"
assert_eq "$?" "0" "three hook commands use node plus the repo plugin hooks path"
assert_contains "$(cat "$A_MARKER")" "codex plugin marketplace add $A_HOME/.codex/autopilot-dev-marketplace" "marketplace add uses the derived dev marketplace"
assert_not_contains "$(cat "$A_MARKER")" "plugin remove" "dev install never runs plugin remove"

# (b) foreign entry is backed up and kept
B_HOME="$TEST_TMP/codex-hooks-b"
B_MARKER="$TEST_TMP/codex-hooks-b-marker"
mkdir -p "$B_HOME/.codex"
cat > "$B_HOME/.codex/hooks.json" <<'JSON'
{
  "foreignTop": true,
  "hooks": {
    "Stop": [
      {
        "matcher": "foreign",
        "hooks": [
          {
            "type": "command",
            "command": "echo foreign-hook"
          }
        ]
      }
    ]
  }
}
JSON
OUT="$(codex_dev_install "$B_HOME" "$B_MARKER" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "install merges into an existing hooks.json"
B_BAK_COUNT="$(find "$B_HOME/.codex" -maxdepth 1 -name 'hooks.json.bak-*' | wc -l | tr -d ' ')"
assert_eq "$B_BAK_COUNT" "1" "install backs up hooks.json once when it changes"
assert_file_exists "$(find "$B_HOME/.codex" -maxdepth 1 -name 'hooks.json.bak-*' | head -1)" "backup file exists"
node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (doc.foreignTop !== true) process.exit(2);
const foreign = JSON.stringify(doc).includes("echo foreign-hook");
if (!foreign) process.exit(3);
const cmds = [];
for (const groups of Object.values(doc.hooks || {})) {
  for (const group of groups) for (const hook of group.hooks || []) cmds.push(hook.command);
}
if (cmds.filter((c) => c === "echo foreign-hook").length !== 1) process.exit(4);
' "$B_HOME/.codex/hooks.json"
assert_eq "$?" "0" "foreign hooks.json entry survives the merge"

# (c) second install is byte-identical and adds no backup
B_BYTES="$(cat "$B_HOME/.codex/hooks.json")"
OUT="$(codex_dev_install "$B_HOME" "$B_MARKER" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "second codex dev install succeeds"
assert_eq "$(cat "$B_HOME/.codex/hooks.json")" "$B_BYTES" "second install leaves hooks.json byte-identical"
B_BAK2="$(find "$B_HOME/.codex" -maxdepth 1 -name 'hooks.json.bak-*' | wc -l | tr -d ' ')"
assert_eq "$B_BAK2" "1" "second install creates no extra backup"

# (d) deleting a fake plugin cache does not break the command paths
mkdir -p "$A_HOME/.codex/plugins/cache/autopilot-local/autopilot/9.9.9/hooks"
rm -rf "$A_HOME/.codex/plugins"
node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const groups of Object.values(doc.hooks || {})) {
  for (const group of groups) for (const hook of group.hooks || []) {
    const m = String(hook.command).match(/^node "([^"]+)"$/);
    if (!m || !fs.existsSync(m[1])) process.exit(2);
  }
}
' "$A_HOOKS"
assert_eq "$?" "0" "hook paths still exist after the plugin cache directory is gone"

# (e) derived plugin manifest is empty, so each event command exists once
node -e '
const fs = require("fs");
const user = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const plugin = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (JSON.stringify(plugin.hooks || {}) !== "{}") process.exit(2);
const seen = new Map();
function take(doc) {
  for (const [event, groups] of Object.entries(doc.hooks || {})) {
    for (const group of groups) for (const hook of group.hooks || []) {
      const key = event + "\n" + hook.command;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
}
take(user); take(plugin);
const keys = [...seen.keys()];
if (keys.length !== 3) process.exit(3);
if (keys.some((k) => seen.get(k) !== 1)) process.exit(4);
' "$A_HOOKS" "$A_HOME/.codex/autopilot-dev-marketplace/plugin/hooks/hooks.json"
assert_eq "$?" "0" "each dev hook command is registered once across user hooks and the plugin manifest"

# (f) uninstall removes only autopilot entries; nothing-installed is a no-op
OUT="$(HOME="$B_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" DEV_SETUP_CODEX_PIDS="" bash "$SCRIPT" --harness codex --uninstall 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "uninstall exits 0"
node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const text = JSON.stringify(doc);
if (!text.includes("echo foreign-hook") || doc.foreignTop !== true) process.exit(2);
if (text.includes("platforms/codex/plugin/hooks")) process.exit(3);
' "$B_HOME/.codex/hooks.json"
assert_eq "$?" "0" "uninstall keeps the foreign entry and drops autopilot commands"
assert_file_absent "$B_HOME/.codex/autopilot-dev-marketplace" "uninstall removes the derived dev marketplace"
assert_not_contains "$OUT" "plugin remove autopilot" "uninstall does not run codex plugin remove"
assert_contains "$OUT" "codex plugin remove" "uninstall prints a hint about codex plugin remove"
B_AFTER="$(cat "$B_HOME/.codex/hooks.json")"
B_BAK3="$(find "$B_HOME/.codex" -maxdepth 1 -name 'hooks.json.bak-*' | wc -l | tr -d ' ')"
OUT="$(HOME="$B_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" bash "$SCRIPT" --harness codex --uninstall 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "second uninstall is a no-op"
assert_eq "$(cat "$B_HOME/.codex/hooks.json")" "$B_AFTER" "second uninstall leaves the foreign file unchanged"
B_BAK4="$(find "$B_HOME/.codex" -maxdepth 1 -name 'hooks.json.bak-*' | wc -l | tr -d ' ')"
assert_eq "$B_BAK4" "$B_BAK3" "second uninstall creates no backup"
EMPTY_HOME="$TEST_TMP/codex-hooks-empty"
mkdir -p "$EMPTY_HOME"
OUT="$(HOME="$EMPTY_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" bash "$SCRIPT" --harness codex --uninstall 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "uninstall with nothing installed exits 0"
assert_file_absent "$EMPTY_HOME/.codex/hooks.json" "uninstall does not create hooks.json"
assert_file_absent "$EMPTY_HOME/.codex/autopilot-dev-marketplace" "uninstall does not create a marketplace dir"

# only-ours file is deleted once empty
ONLY_HOME="$TEST_TMP/codex-hooks-only"
ONLY_MARKER="$TEST_TMP/codex-hooks-only-marker"
mkdir -p "$ONLY_HOME"
codex_dev_install "$ONLY_HOME" "$ONLY_MARKER" >/dev/null
OUT="$(HOME="$ONLY_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" bash "$SCRIPT" --harness codex --uninstall 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "uninstall of an autopilot-only hooks.json exits 0"
assert_file_absent "$ONLY_HOME/.codex/hooks.json" "uninstall deletes hooks.json when only autopilot entries were in it"

# (g) negative control and malformed refusal
G_HOME="$TEST_TMP/codex-hooks-check"
mkdir -p "$G_HOME"
OUT="$(HOME="$G_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" bash "$SCRIPT" --check --harness codex 2>&1)"; EXIT=$?
assert_file_absent "$G_HOME/.codex/hooks.json" "--check --harness codex does not create hooks.json"
OUT="$(HOME="$G_HOME" PATH="$STUB_BIN:$NODE_RUNTIME_BIN:/usr/bin:/bin" bash "$SCRIPT" --harness claude --check 2>&1)" || true
assert_file_absent "$G_HOME/.codex/hooks.json" "--harness claude --check does not create hooks.json"
BAD_HOME="$TEST_TMP/codex-hooks-bad"
BAD_MARKER="$TEST_TMP/codex-hooks-bad-marker"
mkdir -p "$BAD_HOME/.codex"
printf '{\n' > "$BAD_HOME/.codex/hooks.json"
OUT="$(codex_dev_install "$BAD_HOME" "$BAD_MARKER" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "malformed hooks.json is refused"
assert_eq "$(cat "$BAD_HOME/.codex/hooks.json")" "{" "malformed hooks.json is left untouched"
assert_eq "$(find "$BAD_HOME/.codex" -maxdepth 1 -name 'hooks.json.bak-*' | wc -l | tr -d ' ')" "0" "malformed hooks.json is not backed up"

OUT="$(bash "$SCRIPT" --uninstall 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "--uninstall without --harness codex fails"
OUT="$(bash "$SCRIPT" --harness claude --uninstall 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "--uninstall with a non-codex harness fails"
OUT="$(bash "$SCRIPT" --harness codex --uninstall --install 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "--uninstall and --install are mutually exclusive"
OUT="$(bash "$SCRIPT" --help 2>&1)"
assert_contains "$OUT" "--uninstall" "help documents --uninstall"

finalize_test
