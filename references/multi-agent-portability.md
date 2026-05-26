# Multi-Agent Portability — Verified Facts

How autopilot's skills, agents, and hooks map onto the various coding-agent platforms that share overlapping conventions. **Every claim below has a source URL or is explicitly marked as unverified.** Past lesson: a previous version of this doc fabricated env vars and CLI subcommands which only got caught after three reviews.

Last verified: 2026-05-26.

---

## 1. Platform Comparison

| Dimension | Claude Code | OpenCode | Codex (OpenAI) | Antigravity (`agy`) |
|---|---|---|---|---|
| Plugin manifest | `.claude-plugin/plugin.json` ([docs](https://code.claude.com/docs/en/plugins-reference)) | `opencode.json` ([docs](https://opencode.ai/docs/config/)) | `~/.codex/config.toml` ([docs](https://developers.openai.com/codex/config-reference)) | `gemini-extension.json` (sharing the Gemini-CLI extension format — [docs](https://geminicli.com/docs/extensions/reference/)) |
| Skill format | `SKILL.md` with YAML frontmatter (`name`, `description`) | same SKILL.md format ([docs](https://opencode.ai/docs/skills/)) | same SKILL.md format ([docs](https://developers.openai.com/codex/skills)) | same SKILL.md format ([docs](https://antigravity.google/docs/skills)) |
| Skill discovery paths | `<plugin>/skills/`, `.claude/skills/` | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`, `~/.config/opencode/skills/`, `~/.claude/skills/` ([docs](https://opencode.ai/docs/skills/)) | `<repo>/.agents/skills/`, `~/.agents/skills/`, `/etc/codex/skills/`, bundled ([docs](https://developers.openai.com/codex/skills)) | `<workspace>/.agents/skills/`, `~/.gemini/antigravity/skills/` (codelabs walkthrough; not stable spec — verify with `agy --version`) |
| Plugin code | bash/JS hooks invoked by Claude Code via `hooks.json` | in-process TypeScript module exporting hooks ([docs](https://opencode.ai/docs/plugins/)) | MCP servers via `[plugins.<n>.mcp_servers.<s>]` in config.toml | Gemini-CLI extension format |
| Plugin env vars | `CLAUDE_PLUGIN_ROOT` (in hook commands; [issue #27145](https://github.com/anthropics/claude-code/issues/27145)) | none injected; plugins receive `{ project, client, $, directory, worktree }` as context argument ([docs](https://opencode.ai/docs/plugins/)) | `CODEX_HOME` (defaults to `~/.codex/`); **no** `CODEX_PLUGIN_ROOT` | none documented |
| Hook event names | `SessionStart / PreCompact / PreToolUse / PostToolUse / Stop` ([docs](https://code.claude.com/docs/en/hooks)) | `session.created / session.compacted / tool.execute.before / tool.execute.after / …` ([docs](https://opencode.ai/docs/plugins/)) | n/a (no per-event hook surface beyond MCP server lifecycle) | n/a documented |

### Things explicitly NOT verified

These have been **searched** but **no authoritative source found**:

- `CODEX_PLUGIN_ROOT`, `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT`, `AGENT_PLUGIN_ROOT`, `OPENCODE_PLUGIN_ROOT` environment variables — none of these are documented anywhere. **Do not use in code.**
- `agy plugin validate` subcommand — documented `agy plugin` subcommands are: `install`, `uninstall`, `list`, `enable`, `disable`, `import gemini` ([deepwiki](https://deepwiki.com/google-antigravity/antigravity-cli/2-getting-started)). `validate` is not in this list.
- "OpenCode auto-substitutes `${CLAUDE_PLUGIN_ROOT}` in hooks" — no documentation supports this claim.
- Bun-loaded ESM TypeScript `__dirname` semantics in OpenCode plugin context — undocumented (Phase 3 Spike 0 will verify empirically).
- OpenCode `{file:..}` cross-layer resolution (`../` parent traversal) — docs only confirm "relative to the config file directory" but don't address `../` (Phase 3 Spike 1 will verify).

---

## 2. Key Insight: `.agents/skills/` is the cross-platform intersection

OpenCode, Codex, and Antigravity workspace skill discovery all scan `.agents/skills/`. autopilot exploits this by making `.agents/skills/` a symlink to `../skills/` (added in Phase 4 of the v2.7.3 plan). Result: one source-of-truth directory (`skills/`) feeds three platforms without copy duplication.

Note plural: `.agents/` (not `.agent/`). Earlier docs got this wrong.

Claude Code uses `<plugin>/skills/` directly (no `.agents/skills/` indirection needed).

---

## 3. SKILL.md as the de facto standard

All four platforms read the same SKILL.md frontmatter shape:

```yaml
---
name: skill-name                  # lowercase-kebab; matches enclosing directory
description: |
  One-sentence trigger guide. Use when: "phrase A", "phrase B".
  Not for: adjacent use cases.
---

# Skill Name

Body markdown — instructions consumed as agent context.
```

Per-platform extensions exist (e.g. Claude Code accepts a `tools:` allowlist; OpenCode accepts `compatibility:` for explicit platform tagging) but unknown fields are tolerated by each parser. **Cross-platform skills should keep frontmatter minimal**: `name` + `description` only.

---

## 4. Manifest divergence (hard to harmonize)

Plugin manifests are NOT a shared format:

- **Claude Code** reads `.claude-plugin/plugin.json` (canonical for version + description in this repo).
- **OpenCode** reads `opencode.json` (different keys: `agent`, `instructions`, `plugin`, `model`, `tools`, `permission`, …). It does not read `plugin.json`.
- **Codex** reads `~/.codex/config.toml` (TOML; per-user, not per-repo).
- **Antigravity** reads `gemini-extension.json` (Gemini-CLI extension format).

autopilot maintains a root `plugin.json` as a mirror of `.claude-plugin/plugin.json` for npm registry / GitHub UI metadata consumption only. `scripts/sync-version.js --check` enforces they stay aligned (pre-commit gate).

---

## 5. Hooks are non-portable

Per-platform hook systems use different event names, different invocation models (subprocess vs in-process), and different APIs. Attempts to write "universal hook code" with env-var fallback chains create bugs (see git history of `hooks/intent-capture.js` — three rounds of fabricated env var fallback that broke runtime on every non-Claude platform).

The pragmatic split:

- **Claude Code hooks**: `hooks/*.{sh,js}` + `hooks/hooks.json` manifest. Use only `CLAUDE_PLUGIN_ROOT`; if absent, fail-quiet (return `unknown`, exit 0).
- **OpenCode hook surface**: `.opencode/plugins/autopilot.ts` (in-process TS). Use the context argument's `project` / `directory` / `worktree` for paths; do not read env vars.
- **Codex/Antigravity**: not currently implemented. The skill-sharing benefit alone (via `.agents/skills/` symlink) covers most autopilot value without needing hooks on those platforms.

---

## 6. Migration checklist for cross-agent changes

When touching anything that crosses platform boundaries:

- [ ] Every env var / path / CLI command referenced has an official-doc URL cited inline.
- [ ] No platform-specific code paths use env vars that haven't been verified.
- [ ] Skill changes happen only in `skills/<name>/SKILL.md` (one source of truth).
- [ ] Agent body changes happen in `agents/<role>.md` (Claude Code) and propagate via `scripts/sync-agent-bodies.sh` (Phase 3+).
- [ ] `scripts/sync-version.js --check` passes (pre-commit gate enforces).
- [ ] If introducing a new claim about a platform, either (a) cite source, or (b) write a Spike script in `docs/plans/` that produces a yes/no answer empirically.

---

## 7. Related docs

- [`AGENTS.md`](../AGENTS.md) — agents.md-spec readme for any agent
- [`CLAUDE.md`](../CLAUDE.md) — Claude Code-specific conventions
- [`docs/plans/2026-05-22-multi-agent-portability-correction.md`](../docs/plans/2026-05-22-multi-agent-portability-correction.md) — the plan that produced this fact version
