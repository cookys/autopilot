#!/usr/bin/env bash
# dev-setup.sh - Set up or check autopilot development-mode harnesses.
#
# Backward-compatible default:
#   ./scripts/dev-setup.sh
#     Sets up Claude Code dev mode exactly as before.
#
# Multi-harness entry point:
#   ./scripts/dev-setup.sh --check
#   ./scripts/dev-setup.sh --check --harness codex
#   ./scripts/dev-setup.sh --harness codex --install
#
# Non-Claude harnesses are check-only unless --install is explicit.

set -euo pipefail

MARKETPLACE_NAME="autopilot"
PLUGIN_NAME="autopilot"
PLUGIN_KEY="${PLUGIN_NAME}@${MARKETPLACE_NAME}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
INSTALLED_JSON="$CLAUDE_DIR/plugins/installed_plugins.json"
CACHE_BASE="$CLAUDE_DIR/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME"
DEV_LINK="$CACHE_BASE/dev"

MODE="setup"
HARNESS=""
ALL=0
INSTALL=0
CHECK=0
FAILURES=0
WARNINGS=0
TEMP_FILES=()

if [[ -f "$REPO_DIR/.codex-plugin/plugin.json" && ! -f "$REPO_DIR/.claude-plugin/plugin.json" ]]; then
  echo "Error: scripts/dev-setup.sh must be run from the autopilot source repository, not the generated Codex plugin payload." >&2
  echo "Run it from the clone that contains .claude-plugin/plugin.json and platforms/codex/." >&2
  exit 1
fi

cleanup_temp_files() {
  if [[ "${#TEMP_FILES[@]}" -gt 0 ]]; then
    rm -f "${TEMP_FILES[@]}"
  fi
}
trap cleanup_temp_files EXIT

usage() {
  cat <<'EOF'
Usage:
  scripts/dev-setup.sh
      Set up Claude Code dev mode (backward-compatible default).

  scripts/dev-setup.sh --check [--harness claude|codex|opencode|agy|grok|--all]
      Read-only readiness dashboard. Missing optional CLIs warn; repo drift or
      known hazardous state fails.

  scripts/dev-setup.sh --harness claude
      Set up Claude Code dev mode.

  scripts/dev-setup.sh --harness codex --install
      Sync and install the local Codex plugin package.

  scripts/dev-setup.sh --harness opencode --install
      Ensure repo symlinks and install optional OpenCode TypeScript deps.

  scripts/dev-setup.sh --harness agy --install
      Install through scripts/install-antigravity.sh only.

  scripts/dev-setup.sh --harness grok --install
      Install this clone as a Grok Build plugin (grok plugin install --trust).

  scripts/dev-setup.sh --all --install
      Run all setup paths. This can mutate user-level harness state.

Options:
  --check       Read-only status checks.
  --install     Permit mutating setup for non-Claude harnesses.
  --harness H   Select claude, codex, opencode, agy, or grok.
  --all         Select all harnesses.
  -h, --help    Show this help.
EOF
}

status() {
  local level="$1"
  local harness="$2"
  local message="$3"
  printf '%-4s %-10s %s\n' "$level" "$harness" "$message"
  case "$level" in
    FAIL) FAILURES=$((FAILURES + 1)) ;;
    WARN) WARNINGS=$((WARNINGS + 1)) ;;
  esac
}

die() {
  echo "Error: $*" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

make_temp_file() {
  local path
  path="$(mktemp "${TMPDIR:-/tmp}/autopilot-dev-setup.XXXXXX")" || die "mktemp failed"
  TEMP_FILES+=("$path")
  printf '%s\n' "$path"
}

require_repo_manifest() {
  if [[ ! -f "$REPO_DIR/.claude-plugin/plugin.json" ]]; then
    die ".claude-plugin/plugin.json not found in $REPO_DIR"
  fi
}

plugin_entry_exists() {
  PY_INSTALLED_JSON="$INSTALLED_JSON" PY_PLUGIN_KEY="$PLUGIN_KEY" python3 - <<'PY'
import json
import os
import sys

path = os.environ["PY_INSTALLED_JSON"]
key = os.environ["PY_PLUGIN_KEY"]
try:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    sys.exit(2)
if key not in data.get("plugins", {}):
    sys.exit(1)
sys.exit(0)
PY
}

registry_points_to_dev_link() {
  PY_INSTALLED_JSON="$INSTALLED_JSON" PY_PLUGIN_KEY="$PLUGIN_KEY" PY_DEV_LINK="$DEV_LINK" python3 - <<'PY'
import json
import os
import sys

path = os.environ["PY_INSTALLED_JSON"]
key = os.environ["PY_PLUGIN_KEY"]
dev_link = os.environ["PY_DEV_LINK"]
try:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    sys.exit(2)
for entry in data.get("plugins", {}).get(key, []):
    if entry.get("installPath") == dev_link:
        sys.exit(0)
sys.exit(1)
PY
}

update_claude_registry() {
  PY_INSTALLED_JSON="$INSTALLED_JSON" PY_PLUGIN_KEY="$PLUGIN_KEY" PY_DEV_LINK="$DEV_LINK" python3 - <<'PY'
import datetime
import json
import os
import shutil

path = os.environ["PY_INSTALLED_JSON"]
key = os.environ["PY_PLUGIN_KEY"]
dev_link = os.environ["PY_DEV_LINK"]
backup = f"{path}.bak-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

with open(path, encoding="utf-8") as f:
    data = json.load(f)
shutil.copy2(path, backup)

now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
entry = {
    "scope": "user",
    "installPath": dev_link,
    "version": "dev",
    "installedAt": now,
    "lastUpdated": now,
    "gitCommitSha": "dev",
}
data.setdefault("plugins", {})[key] = [entry]

tmp_path = f"{path}.tmp"
with open(tmp_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
with open(tmp_path, encoding="utf-8") as f:
    json.load(f)
os.replace(tmp_path, path)
print(backup)
PY
}

check_agents_symlink() {
  local harness="$1"
  local link="$REPO_DIR/.agents/skills"
  if [[ ! -L "$link" ]]; then
    status FAIL "$harness" ".agents/skills is not a symlink; run scripts/setup-symlinks.sh"
    return 1
  fi
  if [[ "$(readlink "$link")" != "../skills" ]]; then
    status FAIL "$harness" ".agents/skills points to $(readlink "$link"), expected ../skills"
    return 1
  fi
  if [[ ! -d "$link" ]]; then
    status FAIL "$harness" ".agents/skills target is not readable"
    return 1
  fi
  status OK "$harness" ".agents/skills -> ../skills"
  return 0
}

check_claude() {
  require_repo_manifest

  if [[ ! -f "$INSTALLED_JSON" ]]; then
    status WARN "claude" "$INSTALLED_JSON missing; install autopilot in Claude Code first"
    return 0
  fi

  if plugin_entry_exists; then
    status OK "claude" "$PLUGIN_KEY is registered"
  else
    local rc=$?
    if [[ "$rc" = "2" ]]; then
      status WARN "claude" "installed_plugins.json is not readable JSON"
    else
      status WARN "claude" "$PLUGIN_KEY is not registered"
    fi
  fi

  if [[ -L "$DEV_LINK" && "$(readlink -f "$DEV_LINK")" = "$(readlink -f "$REPO_DIR")" ]]; then
    status OK "claude" "dev cache symlink points at this repo"
  else
    status WARN "claude" "dev cache symlink missing or stale: $DEV_LINK"
  fi

  if [[ -f "$INSTALLED_JSON" ]] && registry_points_to_dev_link; then
    status OK "claude" "registry installPath points at dev symlink"
  else
    status WARN "claude" "registry installPath does not point at dev symlink"
  fi

  # Third layer (2026-07-17 lesson): Claude Code resolves the plugin VERSION from
  # the marketplace clone's catalog at session start. A stale clone silently fed
  # a 5-week-old 2.17.2 skill set to a session even though the dev symlink and
  # registry were both correct — dogfood broke with zero errors. The symlink and
  # registry checks above cannot see this layer.
  local mkt_manifest="$CLAUDE_DIR/plugins/marketplaces/$MARKETPLACE_NAME/.claude-plugin/marketplace.json"
  if [[ -f "$mkt_manifest" ]]; then
    local repo_ver mkt_ver
    repo_ver="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$REPO_DIR/.claude-plugin/plugin.json" | head -1 | grep -o '"[^"]*"$' | tr -d '"')"
    mkt_ver="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$mkt_manifest" | head -1 | grep -o '"[^"]*"$' | tr -d '"')"
    if [[ -n "$mkt_ver" && "$mkt_ver" == "$repo_ver" ]]; then
      status OK "claude" "marketplace clone version matches repo ($mkt_ver)"
    else
      status WARN "claude" "marketplace clone is STALE (${mkt_ver:-unreadable} vs repo ${repo_ver:-unreadable}) — session start can resolve the old version; run scripts/dev-update.sh"
    fi
  fi
}

setup_claude() {
  require_repo_manifest

  if [[ ! -f "$INSTALLED_JSON" ]]; then
    echo "Error: $INSTALLED_JSON not found -- is Claude Code installed?" >&2
    exit 1
  fi

  if ! plugin_entry_exists 2>/dev/null; then
    echo "Error: $PLUGIN_KEY not found in installed_plugins.json." >&2
    echo "" >&2
    echo "First install the plugin via the normal flow:" >&2
    echo "  /plugin marketplace add cookys/autopilot" >&2
    echo "  /plugin install autopilot@autopilot" >&2
    echo "" >&2
    echo "Then re-run this script to switch to dev mode." >&2
    exit 1
  fi

  "$REPO_DIR/scripts/setup-symlinks.sh"

  if [[ -L "$DEV_LINK" && "$(readlink -f "$DEV_LINK")" == "$(readlink -f "$REPO_DIR")" ]]; then
    if registry_points_to_dev_link 2>/dev/null; then
      echo "Already in dev mode: $PLUGIN_KEY -> $REPO_DIR"
      return 0
    fi
  fi

  mkdir -p "$CACHE_BASE"
  rm -rf "$DEV_LINK"
  ln -s "$REPO_DIR" "$DEV_LINK"
  echo "Symlink: $DEV_LINK -> $REPO_DIR"

  backup_path="$(update_claude_registry)"

  echo ""
  echo "Done: $PLUGIN_KEY -> $REPO_DIR (version: dev)"
  echo "Backup: $backup_path"
  echo "Restart Claude Code or run /reload-plugins to activate."
  echo ""
  echo "For future updates: cd $REPO_DIR && git pull --ff-only   (then /reload-plugins in Claude Code)"
  echo "  (or run ./scripts/dev-update.sh -- pulls + prints the reload reminder)"
  echo "  Optional: enable the version-drift-check hook to be nudged when behind."
  echo ""
  echo "To revert to release version:"
  echo "  /plugin update autopilot@autopilot"
}

check_codex_cli_state() {
  local marketplace_out list_out version

  if ! have_cmd codex; then
    status WARN "codex" "codex CLI not found on PATH"
    return 0
  fi
  version="$(codex --version 2>/dev/null | head -1 || true)"
  [[ -n "$version" ]] || version="version unavailable"
  status OK "codex" "codex CLI found: $version"

  if [[ "${AUTOPILOT_DEV_SETUP_ACTIVE_CLI_CHECKS:-0}" != "1" ]]; then
    status WARN "codex" "plugin marketplace/install state not probed in strict read-only mode"
    return 0
  fi

  marketplace_out="$(codex plugin marketplace list 2>/dev/null || true)"
  if printf '%s\n' "$marketplace_out" | grep -q '^autopilot-local[[:space:]]'; then
    status OK "codex" "autopilot-local marketplace is configured"
  else
    status WARN "codex" "autopilot-local marketplace is not configured"
  fi

  list_out="$(codex plugin list 2>/dev/null || true)"
  if printf '%s\n' "$list_out" | grep -q 'autopilot@autopilot-local'; then
    status OK "codex" "autopilot@autopilot-local is installed"
  else
    status WARN "codex" "autopilot@autopilot-local is not installed"
  fi
}

check_codex() {
  local sync_out

  check_agents_symlink "codex" || true

  sync_out="$(make_temp_file)"
  if "$REPO_DIR/scripts/sync-codex-plugin-skills.sh" --check >"$sync_out" 2>&1; then
    status OK "codex" "Codex plugin payload mirror is in sync"
  else
    status FAIL "codex" "Codex plugin payload drift detected; run scripts/sync-codex-plugin-skills.sh"
    sed 's/^/      /' "$sync_out"
  fi
  rm -f "$sync_out"

  check_codex_cli_state
}

setup_codex() {
  have_cmd codex || die "codex CLI not found on PATH"
  "$REPO_DIR/scripts/setup-symlinks.sh"
  "$REPO_DIR/scripts/sync-codex-plugin-skills.sh"

  if ! codex plugin marketplace list 2>/dev/null | grep -q '^autopilot-local[[:space:]]'; then
    codex plugin marketplace add "$REPO_DIR/platforms/codex"
  fi
  codex plugin remove autopilot@autopilot-local >/dev/null 2>&1 || true
  codex plugin add autopilot@autopilot-local
}

check_opencode() {
  check_agents_symlink "opencode" || true

  if [[ -f "$REPO_DIR/.opencode/opencode.json" ]]; then
    status OK "opencode" ".opencode/opencode.json exists"
  else
    status FAIL "opencode" ".opencode/opencode.json missing"
  fi

  if have_cmd opencode2; then
    status OK "opencode" "opencode2 CLI found: $(opencode2 --version 2>/dev/null | head -1)"
  else
    status WARN "opencode" "opencode2 CLI not found on PATH"
  fi

  if "$REPO_DIR/scripts/sync-opencode-plugin.sh" --check >/dev/null 2>&1; then
    status OK "opencode" "OpenCode V2 extension payload is in sync"
  else
    status FAIL "opencode" "OpenCode V2 extension payload drift detected; run scripts/sync-opencode-plugin.sh"
  fi

  if [[ -d "$REPO_DIR/platforms/opencode/plugin/node_modules" ]]; then
    status OK "opencode" "OpenCode V2 extension dependencies installed"
  else
    status WARN "opencode" "OpenCode V2 extension dependencies missing; run --harness opencode --install"
  fi
}

setup_opencode() {
  "$REPO_DIR/scripts/install-opencode.sh"
}

check_agy() {
  local dest="$HOME/.gemini/config/plugins/$PLUGIN_NAME"

  if [[ -L "$dest" ]]; then
    status FAIL "agy" "$dest is a symlink; remove it before any agy plugin operation"
  else
    status OK "agy" "no symlink hazard at $dest"
  fi

  if ! have_cmd agy; then
    status WARN "agy" "agy CLI not found on PATH"
    return 0
  fi
  local version
  version="$(agy --version 2>/dev/null | head -1 || true)"
  [[ -n "$version" ]] || version="version unavailable"
  status OK "agy" "agy CLI found: $version"

  if [[ "${AUTOPILOT_DEV_SETUP_ACTIVE_CLI_CHECKS:-0}" != "1" ]]; then
    status WARN "agy" "plugin registry state not probed in strict read-only mode"
    return 0
  fi

  if agy plugin list 2>/dev/null | grep -qi 'autopilot'; then
    status OK "agy" "autopilot appears in agy plugin list"
  else
    status WARN "agy" "autopilot not found in agy plugin list"
  fi
}

setup_agy() {
  "$REPO_DIR/scripts/install-antigravity.sh"
}

check_grok() {
  require_repo_manifest

  if ! have_cmd grok; then
    status WARN "grok" "grok CLI not found on PATH"
    return 0
  fi

  local version
  version="$(grok --version 2>/dev/null | head -n 1 || true)"
  if [[ -n "$version" ]]; then
    status OK "grok" "grok CLI found: $version"
  else
    status WARN "grok" "grok CLI present but --version failed"
  fi

  if [[ ! -f "$REPO_DIR/plugin.json" ]]; then
    status FAIL "grok" "repo root plugin.json missing (required for grok plugin install)"
    return 1
  fi
  if [[ ! -d "$REPO_DIR/skills" ]]; then
    status FAIL "grok" "repo root skills/ missing"
    return 1
  fi
  status OK "grok" "repo root is a Grok-installable plugin payload"

  if [[ "${AUTOPILOT_DEV_SETUP_ACTIVE_CLI_CHECKS:-0}" != "1" ]]; then
    status WARN "grok" "plugin registry state not probed in strict read-only mode (set AUTOPILOT_DEV_SETUP_ACTIVE_CLI_CHECKS=1)"
    return 0
  fi

  if grok plugin list 2>/dev/null | grep -qi 'autopilot'; then
    status OK "grok" "autopilot appears in grok plugin list"
  else
    status WARN "grok" "autopilot not found in grok plugin list"
  fi
}

setup_grok() {
  require_repo_manifest

  if ! have_cmd grok; then
    die "grok CLI not found on PATH — install Grok Build first (https://x.ai/cli)"
  fi

  if [[ ! -f "$REPO_DIR/plugin.json" || ! -d "$REPO_DIR/skills" ]]; then
    die "repo root is not a Grok plugin payload (need plugin.json + skills/)"
  fi

  echo "Installing local clone into Grok Build:"
  echo "  grok plugin install $REPO_DIR --trust"
  grok plugin install "$REPO_DIR" --trust

  echo ""
  echo "Installed. Verify with:"
  echo "  grok plugin list"
  echo "  grok plugin details autopilot"
  echo "  grok inspect   # expect 28 skills under plugin: autopilot"
  echo ""
  echo "Note: Grok host ≠ Grok runner. Hooks runtime parity with Claude is partial;"
  echo "see docs/installation.md § Grok Build and src/harness/capabilities/grok.json."
}

run_check_for() {
  case "$1" in
    claude) check_claude ;;
    codex) check_codex ;;
    opencode) check_opencode ;;
    agy) check_agy ;;
    grok) check_grok ;;
    *) die "unknown harness: $1" ;;
  esac
}

run_setup_for() {
  case "$1" in
    claude) setup_claude ;;
    codex) setup_codex ;;
    opencode) setup_opencode ;;
    agy) setup_agy ;;
    grok) setup_grok ;;
    *) die "unknown harness: $1" ;;
  esac
}

parse_args() {
  if [[ "$#" -eq 0 ]]; then
    HARNESS="claude"
    MODE="setup"
    return 0
  fi

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --check)
        CHECK=1
        MODE="check"
        shift
        ;;
      --install)
        INSTALL=1
        shift
        ;;
      --all)
        ALL=1
        shift
        ;;
      --harness)
        [[ $# -ge 2 ]] || die "--harness requires a value"
        HARNESS="$2"
        case "$HARNESS" in claude|codex|opencode|agy|grok) ;; *) die "--harness must be claude|codex|opencode|agy|grok" ;; esac
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done

  if [[ "$ALL" = "1" && -n "$HARNESS" ]]; then
    die "--all and --harness are mutually exclusive"
  fi

  if [[ "$CHECK" = "1" && "$INSTALL" = "1" ]]; then
    die "--check and --install are mutually exclusive"
  fi

  if [[ "$INSTALL" = "1" && -z "$HARNESS" && "$ALL" = "0" ]]; then
    die "--install requires --harness <name> or --all"
  fi

  if [[ "$INSTALL" = "1" ]]; then
    MODE="setup"
  elif [[ "$CHECK" = "1" ]]; then
    MODE="check"
    if [[ -z "$HARNESS" && "$ALL" = "0" ]]; then
      ALL=1
    fi
  elif [[ -z "$HARNESS" && "$ALL" = "0" ]]; then
    MODE="check"
    ALL=1
  elif [[ "$HARNESS" = "claude" ]]; then
    MODE="setup"
  else
    MODE="check"
  fi

  if [[ -z "$HARNESS" && "$ALL" = "0" ]]; then
    HARNESS="claude"
  fi
}

main() {
  parse_args "$@"

  if [[ "$MODE" = "check" ]]; then
    if [[ "$ALL" = "1" ]]; then
      for harness in claude codex opencode agy grok; do
        run_check_for "$harness"
      done
    else
      run_check_for "$HARNESS"
    fi

    echo ""
    echo "Summary: $FAILURES failure(s), $WARNINGS warning(s)"
    if [[ "$FAILURES" -gt 0 ]]; then
      exit 1
    fi
    exit 0
  fi

  if [[ "$ALL" = "1" ]]; then
    for harness in claude codex opencode agy grok; do
      run_setup_for "$harness"
    done
  else
    run_setup_for "$HARNESS"
  fi
}

main "$@"
