# Autopilot — Installation & Development

> Part of [Autopilot](../README.md). Detail docs: [Skills](skills.md) · [Coexistence](coexistence.md) · [Configuration](configuration.md) · [Installation](installation.md) · [Architecture](architecture.md) · [Hooks](../hooks/README.md)

Install paths beyond the two-command Claude Code default (OpenCode, Codex, Antigravity, Windows), plus the contributor dev-mode workflow.

> **Claude Code users**: the 2-command install is in the [main README](../README.md#install). This page covers everything else.

---

### OpenCode (`.agents/skills/` auto-scan)

Clone the repo anywhere; OpenCode native skill scanner picks up `.agents/skills/` from cwd.

```bash
git clone https://github.com/cookys/autopilot.git
cd autopilot
./scripts/setup-symlinks.sh                          # ensure .agents/skills/ symlink resolves (no-op on Linux/macOS/WSL)
cd .opencode && npm install                          # for @opencode-ai/plugin types (optional unless editing the TS plugin)
cd ..
opencode debug skill | grep autopilot                # verify autopilot skills discovered
```

Agents (`autopilot-reviewer`, `autopilot-debugger`, `autopilot-planner`) load via `.opencode/opencode.json` automatically.

### Codex (OpenAI)

Two Codex paths are supported:

- **Per-repo skills**: same `.agents/skills/` symlink as OpenCode. Codex's skill scanner walks up from cwd to find `<repo>/.agents/skills/`. No further setup needed when you run Codex inside this repo.
- **Local Codex plugin package**: `platforms/codex/plugin/` is a Codex package whose manifest exposes only skills, with bundled support payload and a repo-local marketplace at `platforms/codex/.agents/plugins/marketplace.json`.

```bash
./scripts/setup-symlinks.sh
./scripts/sync-codex-plugin-skills.sh
codex plugin marketplace add ./platforms/codex
codex plugin list --marketplace autopilot-local --available
codex plugin add autopilot@autopilot-local
```

The Codex package intentionally does **not** load Claude Code hooks, apps, or MCP servers. Its manifest exposes only `skills: "./skills/"`, while the package payload also includes linked support files (`bin/`, `src/`, `scripts/`, `references/`, templates, selected docs, and `hooks/_shared`) so skill links and engine CLI commands resolve after install. Run engine commands from the target repository, or pass `--cwd /path/to/repo` to `engine implement-review`.

For global loose-skill availability across repos without installing the plugin package, see `platforms/codex/config.toml.example`.

### Antigravity (`agy`)

`agy` imports autopilot as a Claude Code-source plugin (verified against agy 1.0.1 — there is no loose skills-dir scan; the older `~/.gemini/antigravity/skills/` approach was superseded).

```bash
./scripts/install-antigravity.sh                     # agy plugin validate → install → list
agy plugin list | grep autopilot                     # verify it's registered
# remove with: agy plugin uninstall autopilot
```

### Windows

Repo-tracked symlinks (`.agents/skills/`) require Developer Mode + `core.symlinks=true` **before** cloning:

```powershell
git config --global core.symlinks true               # one-time, system-wide
# Enable Developer Mode: Settings -> Privacy & security -> For developers
git clone https://github.com/cookys/autopilot.git
cd autopilot
.\scripts\setup-symlinks.ps1
```

Without these, symlinks materialise as plain text files containing the target path — `setup-symlinks.ps1` will detect and try to repair, but Developer Mode is still required for the repair.

### Cross-platform pre-commit gate

```bash
./scripts/install-hooks.sh                           # one-time per clone
```

Activates `.githooks/pre-commit` which runs `sync-version.js --check` and `sync-agent-bodies.sh --check` to catch version-manifest drift and agent-body drift before they reach the remote.

---

## Updating

**First pick your path** — the right method depends on whether you keep a local clone:

| You have… | Update with | Notes |
|-----------|-------------|-------|
| **a local clone** (dev mode, [below](#development)) | `git pull --ff-only` (shell), then `/reload-plugins` (Claude Code) | **Recommended for tracking latest** — no reinstall, pulls apply instantly |
| **release / marketplace only** (no clone) | clean reinstall ([below](#release--marketplace-reinstall-no-clone)) | `/plugin update` may not detect new versions |
| **Codex local package** | `git pull --ff-only`, then `./scripts/sync-codex-plugin-skills.sh`, `codex plugin remove autopilot@autopilot-local`, and `codex plugin add autopilot@autopilot-local` | The repo-local marketplace points at your clone; reinstall refreshes Codex's plugin cache |

> **Why not just `/plugin update`?** Claude Code pins a plugin to its install-time commit, and `/plugin update` often does **not** detect new versions ([anthropics/claude-code#31462](https://github.com/anthropics/claude-code/issues/31462)). Dev mode sidesteps this entirely: your clone *is* the plugin, so `git pull --ff-only` (then `/reload-plugins` in Claude Code) is the whole update. If you want to follow autopilot closely, set up [dev mode](#development) once and updating becomes a one-liner.

### Release / marketplace reinstall (no clone)

Until #31462 is fixed, the reliable way to pull a new release without a clone is a clean reinstall:

```bash
/plugin uninstall autopilot@autopilot
/plugin marketplace remove autopilot
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

### Dev-mode update (recommended for latest)

After the one-time [dev-mode setup](#development):

```bash
cd ~/projects/autopilot && git pull --ff-only   # shell; then run /reload-plugins in Claude Code
# or: ./scripts/dev-update.sh                    # pulls + prints the /reload-plugins reminder
```

(`/reload-plugins` is a Claude Code slash command, not a shell command — run it in the Claude session after the pull.)

The `version-drift-check` hook gives a one-line nudge at session start when your clone has fallen behind its git upstream. As of v2.26.1 it is wired default-on in the plugin's `hooks.json` (silent for everyone except a dev clone behind upstream), so **dev-mode users get it automatically — no settings change needed**. (It moved out of `settings.example.json` because `${CLAUDE_PLUGIN_ROOT}` does not expand in a user's `settings.json`.)

To enable the **session-handoff** snapshot feature (write a machine handoff on `/clear`/logout and auto-inject it into the next session), set `~/.autopilot/config.json` to `{"handoff_inject": true}` (or `export AUTOPILOT_HANDOFF_INJECT=1`). Both the writer and reader are wired default-on in `hooks.json` but stay inert until this single switch is set.

### Enabling opt-in hooks

The 12 **opt-in** hooks (Tier B — branch-protection, commit-secret-scan, large-file-warner, config-protection, mcp-health, accumulator, test-runner, design-quality, cost-tracker, session-summary, check-console, batch-format) are wired in the plugin's `hooks.json` but **default-OFF**. As of v2.26.2 you enable them via `~/.autopilot/config.json` — **not** by copying anything into your `settings.json` (where `${CLAUDE_PLUGIN_ROOT}` would not expand):

```json
{ "hooks": { "branch-protection": true, "commit-secret-scan": true, "test-runner": true } }
```

A per-hook env override also works: `AUTOPILOT_HOOK_<STEM>=1` (stem upper-cased, `-`→`_`, e.g. `AUTOPILOT_HOOK_BRANCH_PROTECTION=1`). The authoritative list is [`hooks/opt-in-manifest.json`](../hooks/opt-in-manifest.json); per-hook behaviour is documented in [`hooks/README.md`](../hooks/README.md) (Tier B).

**Enable vs. configure — two separate mechanisms:**

| Concern | Where | Example |
|---------|-------|---------|
| **Enable** a hook (does it run at all) | `~/.autopilot/config.json` `hooks.<stem>` (this is the v2.26.2 gate) | `{"hooks":{"branch-protection":true}}` |
| **Configure** an enabled hook's behaviour | Claude `settings.json` `autopilot.*` (Claude Code injects these as `AUTOPILOT_*` env vars into the hook) — or set the env var directly | `autopilot.protectedBranches`, `autopilot.costTracker` |

So a hook like `branch-protection` is **enabled** in `~/.autopilot/config.json` and its protected-branch regex is **configured** via `autopilot.protectedBranches` in `settings.json` (the `autopilot.*` block is still shown in `settings.example.json`). Enabling without configuring is fine — each configurable hook has a safe default (e.g. `^(main|master)$`).

---

## Development

To contribute or customize skills locally:

```bash
# 1. Install once via the normal flow (required)
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot

# 2. Clone and switch to dev mode
git clone git@github.com:cookys/autopilot.git ~/projects/autopilot
cd ~/projects/autopilot
./scripts/dev-setup.sh
```

Dev mode symlinks the plugin cache to your local clone. Edits to `skills/` take effect immediately after `/reload-plugins` — no reinstall needed.

Push/pull works normally across machines. Each machine runs step 1 once, then `dev-setup.sh` once. To update later: `git pull --ff-only` then `/reload-plugins` (or `./scripts/dev-update.sh`) — see [Updating](#updating).

> **Note:** Dev mode sets `version: "dev"` in the plugin registry. To revert to the release version, run `/plugin update autopilot@autopilot`.

### Cache directory layout

The plugin cache lives at `~/.claude/plugins/cache/autopilot/autopilot/`. Each entry is either a versioned directory (snapshot from install/update) or a symlink to a local clone:

```
~/.claude/plugins/cache/autopilot/autopilot/
├── develop -> ~/projects/autopilot   # symlink — live edits, /reload-plugins to sync
└── 2.0.0                             # snapshot — created by install or reload
```

**Symlink naming**: The cache directory name does not need to be a semver string. You can use semantic names like `develop`, `nightly`, or `local` to distinguish dev symlinks from release snapshots. Claude Code resolves the symlink and reads `plugin.json` inside for the actual version.

**Stale cache cleanup**: After upgrading, old version directories may linger. Remove them manually:

```bash
rm -rf ~/.claude/plugins/cache/autopilot/autopilot/<old-version>
```

### Branch workflow

| Branch | Purpose | `plugin.json` version |
|--------|---------|----------------------|
| `main` | Stable releases, tagged (e.g. `v2.7.1`) | Matches latest tag |
| `develop` | Next version development | Next major/minor (e.g. `2.26.0`) |

When developing: checkout `develop`, symlink points to it, `/reload-plugins` picks up changes. Remember to bump `plugin.json` version before tagging a release.
