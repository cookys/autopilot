# platforms/ - directory rules (Claude Code)

Loaded when a session reads or edits a file under `platforms/`. Root `AGENTS.md` keeps the one-line "generated, never hand-edit" rule and the pointer to `references/multi-agent-portability.md`.

## Build (autopilot-added)

- **No build step for production**. Skills, agents, hooks ship as source. Claude Code loads them at plugin install time.
- **Codex package** (`platforms/codex/plugin`) declares skills plus the production Codex-native `PostCompact` (`manual|auto`) hook. Its marketplace entry lives at `platforms/codex/.agents/plugins/marketplace.json`; skills, linked support files, and canonical hook sources under `platforms/codex/hooks/` are generated into the package by `scripts/sync-codex-plugin-skills.sh`. The retained `PreToolUse` adapter is unregistered D1 probe evidence only, so no Codex-thread-bound direct-mutation enforcement is shipped (`D4=NOT_READY/NO_SHIP`). This exact adapter boundary does not imply Claude hook parity; never hand-edit generated package hooks or add another hook without a probed Codex adapter phase.
- **OpenCode plugin** entry is `.opencode/plugin-package/server.ts`. `@opencode-ai/plugin` types are needed at edit time (see `.opencode/package.json`).
- **Version bump**: `node scripts/sync-version.js --version X.Y.Z --hook-count N --skill-count M --opt-in-count K --disabled-count X` propagates the new version + description fragments to all mirrors atomically, including the Codex package manifest version (two-pass; fail-loud on regex drift). `--opt-in-count`/`--disabled-count` are **preserved from the canonical manifest when omitted** (NOT defaulted to 0 — omitting them while passing `--hook-count` would otherwise corrupt the 3-tier description); default-on = hook-count − opt-in − disabled. Hook-count correctness itself is gated separately by `check-hook-inventory.js --check`.
- **Dev mode for Claude Code**: `scripts/dev-setup.sh` replaces the installed plugin cache with a symlink to your local clone. It also registers the clone as a directory marketplace (`claude plugin marketplace add <clone>`) so `/reload-plugins` reads the repo in place instead of a stale versioned cache copy. Edits take effect immediately.

## Cross-Platform Notes (factual)

Each platform reads different config files and uses different skill discovery paths. See [`references/multi-agent-portability.md`](../references/multi-agent-portability.md) for the verified facts table with source URLs.

Skill-sharing paths by platform: **OpenCode** scans `.agents/skills/` natively (verified empirically, OpenCode 1.15.10). **Codex** can use `.agents/skills/` from the repo and can also install the package under `platforms/codex/plugin` through the repo-local marketplace; that package includes the live-proven production `PostCompact` boundary in addition to skills (verified on codex-cli 0.146.0). **Antigravity** does NOT scan a loose skills dir — it imports the whole repo as a plugin via `agy plugin install <repo>` (verified empirically, `agy` 1.0.1), registering skills + agents + hooks. SKILL.md format (YAML frontmatter + Markdown body) is the de facto standard across all four platforms.
