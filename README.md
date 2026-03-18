<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Development workflow skills for Claude Code — your agent's operating system.</strong><br>
  14 skills that turn Claude from a general-purpose agent into a disciplined developer.<br>
  Install once, works across all projects. Zero configuration required.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-1.4.3-E8A838?style=flat-square" alt="v1.4.3">
  <img src="https://img.shields.io/badge/skills-14-4A90D9?style=flat-square" alt="14 Skills">
  <img src="https://img.shields.io/badge/dependencies-zero-A8B5A0?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-D4A5A5?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <b>English</b> &nbsp;|&nbsp; <a href="README.zh-TW.md">正體中文</a>
</p>

---

## The Problem

AI coding agents start from zero every session:

- A task needs 5 modules changed — the agent dives in without a plan and forgets half
- You ask "should we use X or Y?" — the agent picks one without researching trade-offs
- The agent fixes a tricky bug — next session, hits the **exact same issue** and doesn't remember
- Session context compresses — hard-won solutions and architectural decisions disappear

## The Solution

Autopilot gives your agent **standard operating procedures** that enforce discipline:

| Skill | What It Does | Without It |
|-------|-------------|------------|
| **dev-flow** | Evaluates task size, routes to commit or plan+project; includes session lifecycle (start/end) and goal alignment | Agent dives in without a plan |
| **survey** | Dual-agent research (researcher + skeptic) | Agent picks first option it finds |
| **think-tank** | 6-role debate for strategic decisions | Single-perspective analysis |
| **ceo-agent** | Autonomous execution mode | Agent asks permission for everything |
| **quality-pipeline** | Unified quality gate: test → scan → review | Inconsistent quality checks |
| **project-lifecycle** | Plan → bootstrap → structure → archive | Projects left unfinished or unarchived |
| **learn** | Auto-records knowledge from failures; includes knowledge health audit | Same mistakes repeated across sessions |
| **retro** | Engineering retrospective from git history | No visibility into work patterns |
| **next** | Scan all work sources, recommend highest-priority task; includes improvement processing | No visibility into what to do next |
| **team** | Multi-agent parallelization with dependency analysis | Solo execution when parallelism would help |
| **profiling** | Evidence-first performance profiling methodology | Agent guesses from code instead of measuring |
| **test-strategy** | Test pyramid, baseline management, feature flag levels | Inconsistent test coverage, no strategy |
| **audit** | Systematic comparison between implementations | Differences missed in manual review |
| **debug** | Evidence-first debugging: logs, tools, then code | Agent guesses instead of investigating |

---

## Install

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

That's it. All 14 skills are available immediately as `autopilot:dev-flow`, `autopilot:survey`, etc.

---

## How Skills Work Together

```
 user task
    │
    ▼
 dev-flow ──────────────────────────────────────────────┐
    │                                                    │
    ├─ S (small): implement → quality-pipeline → commit   │
    │                                                    │
    └─ L (large): project-lifecycle (bootstrap)          │
         │         → per-phase implement                 │
         │         → quality-pipeline per phase           │
         │         → project-lifecycle (archive)          │
         │                                               │
         ├─ needs research? ──→ survey                   │
         ├─ strategic decision? ──→ think-tank            │
         ├─ user says "handle it"? ──→ ceo-agent         │
         ├─ parallelizable? ──→ team                     │
         │                                               │
         └─ session end ──→ learn (capture knowledge)    │
                            retro (periodic review)      │
                                                         │
 what's next? ──→ next (scan → rank → recommend)         │
                                                         │
 ◄───────────────────────────────────────────────────────┘
```

### Skill Boundaries

| Decision Type | Use This |
|--------------|----------|
| Technical choice (X library vs Y) | `survey` — external research with dual perspective |
| Strategic choice (should we? how big? what first?) | `think-tank` — internal multi-role debate |
| User wants outcome, not involvement | `ceo-agent` — autonomous execution |
| User wants to participate | `dev-flow` — guided workflow with checkpoints |

---

## Project Configuration (Optional)

Skills work out of the box with sensible defaults. For project-specific behavior, add config files:

### `.claude/dev-flow-config.md`

Customizes dev-flow's size rules, quality gates, build commands, and special rules.

```markdown
# Dev Flow — Project Config

## Size Rules
- **S**: single module, no interface change → direct commit
- **L**: 3+ modules, public interface → plan + project + PR

## Quality Gate
- S: `npm test && npm run lint`
- L: full test suite + code review per phase

## Build & Deploy
- Build: `docker compose build`
- Staging: `docker compose up -d`
```

### `.claude/quality-gate-config.md`

Customizes quality-pipeline's test, scan, and review commands.

### `.claude/project-lifecycle-config.md`

Customizes project paths, bootstrap/archive scripts.

### `.claude/next-config.md`

Customizes work source paths for the next skill.

### `.claude/team-config.md`

Customizes team role templates for your project's tech stack.

### `.claude/test-strategy-config.md`

Customizes test-strategy's test commands, pyramid ratios, and coverage thresholds.

### `.claude/skill-routing.md`

Maps keywords to your project's domain-specific skills.

```markdown
# Skill Routing

| Keyword | Invoke |
|---------|--------|
| database | `your-db-skill` |
| deploy   | `your-deploy-skill` |
| crash    | `your-debug-skill` |
```

### How Injection Works

`dev-flow` uses Claude Code's `!`command`` preprocessor to read config at invocation time:

```markdown
## Project Config (auto-injected)
!`cat .claude/dev-flow-config.md 2>/dev/null || echo "No config — using defaults."`
```

No config file? Defaults kick in automatically. Zero friction for new projects.

> Templates available in [`project-config-template/`](project-config-template/).

---

## Team Setup

Add to your project's `.claude/settings.json` so team members get prompted to install:

```jsonc
{
  "extraKnownMarketplaces": {
    "autopilot": {
      "source": { "source": "github", "repo": "cookys/autopilot" }
    }
  }
}
```

---

## Known Limitation

Claude Code plugins are **pinned to a specific commit** at install time. `/plugin update` may not detect new versions. To get the latest:

```bash
/plugin uninstall autopilot@autopilot
/plugin marketplace remove autopilot
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

See [anthropics/claude-code#31462](https://github.com/anthropics/claude-code/issues/31462) for details.

---

## Design Philosophy

**Why a plugin, not copy-paste skills?**
Copy-pasted skills drift within weeks. A plugin gives you a single source of truth — update once, everyone gets it via `/plugin update`.

**Why 14 skills, not more?**
Lean by design. Internal orchestration (session start/end, goal alignment, context reduction, improvement processing, memory health) is absorbed into the skills that use them — primarily dev-flow, learn, and next. The 14 exposed skills cover the workflow layer: decisions, processes, quality gates, and debugging that are universal across projects. Domain-specific skills belong in each project's `.claude/skills/`, not in a shared plugin.

**Why `!`command`` injection, not config files?**
In the Claude Code world, "configuration" is natural language. A markdown file read at invocation time is more expressive than YAML, requires no schema, and degrades gracefully when absent.

**Works alongside other skills?**
Yes. Autopilot is the workflow layer. Your project's domain skills, superpowers, and other plugins all coexist — autopilot orchestrates, they execute.

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

Push/pull works normally across machines. Each machine runs step 1 once, then `dev-setup.sh` once.

> **Note:** Dev mode sets `version: "dev"` in the plugin registry. To revert to the release version, run `/plugin update autopilot@autopilot`.

## Update (marketplace users)

```bash
/plugin update autopilot@autopilot
```

## [Changelog](CHANGELOG.md)

## Origin

Distilled from 100+ completed projects using AI-driven development.

## License

MIT — see [LICENSE](LICENSE) for details.
