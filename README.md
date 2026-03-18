<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Development workflow skills for Claude Code — your agent's operating system.</strong><br>
  7 skills that turn Claude from a general-purpose agent into a disciplined developer.<br>
  Install once, works across all projects. Zero configuration required.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/skills-7-4A90D9?style=flat-square" alt="7 Skills">
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
| **dev-flow** | Evaluates task size, routes to commit or plan+project | Agent dives in without a plan |
| **survey** | Dual-agent research (researcher + skeptic) | Agent picks first option it finds |
| **think-tank** | 6-role debate for strategic decisions | Single-perspective analysis |
| **ceo-agent** | Autonomous execution mode | Agent asks permission for everything |
| **learn** | Auto-records knowledge from failures | Same mistakes repeated across sessions |
| **retro** | Engineering retrospective from git history | No visibility into work patterns |
| **context-reduce** | Analyzes and reduces context window usage | Context silently overflows |

---

## Install

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

That's it. All 7 skills are available immediately as `autopilot:dev-flow`, `autopilot:survey`, etc.

---

## How Skills Work Together

```
 user task
    │
    ▼
 dev-flow ──────────────────────────────────────────────┐
    │                                                    │
    ├─ S (small): implement → quality gate → commit      │
    │                                                    │
    └─ L (large): plan → per-phase implement → merge     │
         │                                               │
         ├─ needs research? ──→ survey                   │
         ├─ strategic decision? ──→ think-tank            │
         ├─ user says "handle it"? ──→ ceo-agent         │
         │                                               │
         └─ session end ──→ learn (capture knowledge)    │
                            retro (periodic review)      │
                            context-reduce (if needed)   │
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

## Design Philosophy

**Why a plugin, not copy-paste skills?**
Copy-pasted skills drift within weeks. A plugin gives you a single source of truth — update once, everyone gets it via `/plugin update`.

**Why 7 skills, not 21?**
These 7 cover the workflow layer — the decisions and processes that are universal across projects. Domain-specific skills (testing, architecture, debugging) belong in each project's `.claude/skills/`, not in a shared plugin.

**Why `!`command`` injection, not config files?**
In the Claude Code world, "configuration" is natural language. A markdown file read at invocation time is more expressive than YAML, requires no schema, and degrades gracefully when absent.

**Works alongside other skills?**
Yes. Autopilot is the workflow layer. Your project's domain skills, superpowers, and other plugins all coexist — autopilot orchestrates, they execute.

---

## Update

```bash
/plugin update autopilot@autopilot
```

## Origin

Distilled from 89+ completed projects using AI-driven development. Previously maintained as a 21-skill collection ([universal-dev-skills](https://github.com/cookys/universal-dev-skills)); consolidated to 7 workflow-essential skills and repackaged as a Claude Code plugin for easier distribution and maintenance.

## License

MIT — see [LICENSE](LICENSE) for details.
