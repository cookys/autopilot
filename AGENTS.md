# autopilot — Agent Instructions

This file follows the [agents.md](https://agents.md/) convention: a single agent-facing readme that any coding agent (Claude Code, OpenCode, Codex, Antigravity, Cursor, Aider, …) can read on entry to this repository. Sections below follow the spec's recommended four-section structure (Project Structure / Coding Conventions / Testing / PR Guidelines) plus two autopilot-added sections (Build / Contribution).

For Claude Code-specific conventions, see [`CLAUDE.md`](CLAUDE.md). For cross-agent portability detail (what each platform actually supports vs. what's unverified), see [`references/multi-agent-portability.md`](references/multi-agent-portability.md).

---

## Project Structure (spec)

```
skills/              16 lifecycle/methodology skills (SKILL.md format)
agents/              3 methodology agents (reviewer, debugger, planner) — markdown body + YAML frontmatter
hooks/               Claude Code hooks (bash + JS) and hooks.json manifest
.opencode/           OpenCode wrapper (opencode.json, in-process TS plugin)
.claude-plugin/      Claude Code plugin manifest (canonical for version + description)
plugin.json          Root mirror of .claude-plugin/plugin.json (for non-Claude tools)
references/          Cross-skill reference docs (blind-dispatch, model-routing, portability)
scripts/             Deterministic tooling — prefer these over LLM judgment for mechanical work
docs/                projects/ (active + archive), plans/, BACKLOG.md, CHANGELOG.md
.githooks/           Repo-tracked pre-commit hooks (activated via scripts/install-hooks.sh)
```

Skill body is in `skills/<name>/SKILL.md`. Methodology agent prompt body is in `agents/<role>.md`. Hooks live in `hooks/` and are registered via `hooks/hooks.json`.

## Coding Conventions (spec)

- **Severity vocabulary** (unified across skills + agents): `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion`. The dialectic skills (`think-tank*`) use a separate lowercase `critical / important / minor` tag for risk-not-severity — intentionally distinct.
- **No hardcoded dispatch metadata** in skill files. Use `scripts/resolve-dispatch.sh` to map role → `{model, mode, agent}` JSON.
- **Prefer scripts over LLM judgment** for mechanical work (regex scans, JSON parsing, diff filtering). When you write a new script, wire it into both `CLAUDE.md` scripts inventory and the relevant skill's "Available Scripts" table.

## Testing (spec)

- **Skill structure**: `scripts/validate.sh` validates every `SKILL.md` has the required YAML frontmatter (`name`, `description`) and structure.
- **Version manifest sync**: `node scripts/sync-version.js --check` (read-only) verifies all mirrors (root `plugin.json`, `README.md` badges, etc.) match the canonical `.claude-plugin/plugin.json`. Run before any commit that touches version metadata.
- **Hooks runtime smoke test**: `CLAUDE_PLUGIN_ROOT=$(pwd) node hooks/intent-capture.js < /dev/null` should write to `~/.autopilot/intent/` without throwing.
- **Pre-commit gate**: After running `scripts/install-hooks.sh` once per clone, `git commit` runs `sync-version.js --check` automatically. Drift blocks the commit.

## Build (autopilot-added)

- **No build step for production**. Skills, agents, hooks ship as source. Claude Code loads them at plugin install time.
- **OpenCode plugin** (`.opencode/plugins/autopilot.ts`) is loaded by Bun in-process — no compilation, but `@opencode-ai/plugin` types are needed at edit time (see `.opencode/package.json`).
- **Version bump**: `node scripts/sync-version.js --version X.Y.Z --hook-count N --skill-count M --opt-in-count K` propagates the new version to all mirrors atomically (two-pass; fail-loud on regex drift).
- **Dev mode for Claude Code**: `scripts/dev-setup.sh` replaces the installed plugin cache with a symlink to your local clone. Edits take effect immediately.

## PR Guidelines (spec)

- **Branch naming**: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`. For multi-phase work, use `<type>/v<version>-<short-name>` (e.g. `fix/v2.7.3-multi-agent-portability-correction`).
- **Commit messages**: Conventional Commits style (`type(scope): summary`). Co-authored-by lines are welcome for AI-assisted commits.
- **One logical change per commit**. For phased work, each phase = independent commit (bisect-friendly).
- **Severity in PR descriptions**: when listing reviewer findings, use the unified `🔴 / 🟠 / 🟡 / 🔵` vocabulary.

## Contribution (autopilot-added)

- **Plans go in `docs/plans/`** with date prefix (`YYYY-MM-DD-<name>.md`). Plans capture: background, design decisions, implementation steps, acceptance criteria, risks, out-of-scope items, open questions.
- **Reviews are dialectic**. For non-trivial changes, prefer 3-perspective review (Architect / Ops / Skeptic) — each spawned in parallel with disjoint focus. Findings get tagged with the unified severity vocabulary and consolidated in a review summary table within the plan.
- **Spike before assert**. Any cross-platform claim (env var, CLI subcommand, directory path) MUST be verified — by official-doc URL or by running the real tool — before being written into reference material. The lesson cuts both ways: three multi-platform commits were reverted for LLM-fabricated env vars and CLI subcommands; then the correction *over-corrected* (labelled `agy plugin validate` and the root-`plugin.json` requirement as fabricated), and only installing real `agy` 1.0.1 settled it — both are genuine. Second-hand survey/WebFetch can be stale; prefer running the tool when it's installable.

---

## Cross-Platform Notes (factual)

Each platform reads different config files and uses different skill discovery paths. See [`references/multi-agent-portability.md`](references/multi-agent-portability.md) for the verified facts table with source URLs.

Skill-sharing paths by platform: **OpenCode** scans `.agents/skills/` natively (verified empirically, OpenCode 1.15.10). **Codex** docs list `.agents/skills/` in its discovery walk-up (not empirically verified here — `codex` not installed). **Antigravity** does NOT scan a loose skills dir — it imports the whole repo as a plugin via `agy plugin install <repo>` (verified empirically, `agy` 1.0.1), registering skills + agents + hooks. SKILL.md format (YAML frontmatter + Markdown body) is the de facto standard across all four platforms.
