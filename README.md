<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Development workflow skills for Claude Code — your agent's operating system.</strong><br>
  14 skills that turn Claude from a general-purpose agent into a disciplined developer.<br>
  Install once, works across all projects. Zero configuration required.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-1.4.4-E8A838?style=flat-square" alt="v1.4.4">
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
| **ceo-agent** | Autonomous execution with CEO-level judgment | Agent asks permission for everything |
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

## Key Features

### Three Modes of Operation

Autopilot provides three distinct cognitive modes for different situations:

**`dev-flow` — Guided Development (default)**

The entry point for all development tasks. Evaluates task size and routes accordingly:

```
You: "Add WebSocket compression"

Claude (with dev-flow):
  1. Size assessment: L (crosses network + protocol + client modules)
  2. → Creates plan, project directory, feature branch
  3. → Implements phase by phase, quality gate each phase
  4. → Archives project on completion

Claude (without dev-flow):
  → Starts grep-ing the codebase immediately
  → No plan, no phases, no quality gates
```

dev-flow also handles the session lifecycle — health checks on startup, knowledge review, goal alignment on context continuation. You don't invoke these separately; dev-flow absorbs them.

**`ceo-agent` — Autonomous Execution**

When you want outcomes, not involvement. The agent becomes CEO; you become the Board.

```
You: "CEO mode. Handle the reconnect system. Level 3, you decide everything."

CEO startup:
  1. OKR — concrete success criteria (not vague "make it work")
  2. Involvement level — how often to report (every step / phase / just results)
  3. Scope mode — Expand / Selective / Hold / Reduce
  4. No-go zones — what's absolutely off-limits

Then: autonomous execution within DOA (Delegation of Authority)
```

The CEO agent applies 10 cognitive patterns from great CEOs (Bezos's two-way doors, Munger's inversion reflex, Jobs's focus as subtraction) and follows the Boil the Lake principle — AI makes completeness nearly free, so always choose the complete implementation over shortcuts.

CEO cannot self-audit. Like corporate governance, quality-pipeline and code-review run independently.

**`think-tank` — Multi-Perspective Debate**

For strategic decisions where a single perspective isn't enough. 6 roles debate in parallel:

```
You: "Should we rewrite the auth system or patch it?"

Think Tank assembles:
  - CTO (technical feasibility)
  - Product Director (user impact)
  - QA Lead (risk assessment)
  - Security Architect (threat model)
  - Customer Advocate (user experience)
  - Operations (deployment/maintenance)

Output: Decision Brief with consensus, dissenting views, and recommendation
```

### How They Work Together

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

## Install

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

That's it. All 14 skills are available immediately as `autopilot:dev-flow`, `autopilot:survey`, etc.

---

## Cross-Repository Configuration (Injection)

Skills work out of the box with sensible defaults. For project-specific behavior, drop a markdown file into your project's `.claude/` directory — the skill reads it at invocation time via Claude Code's `!`command`` preprocessor.

### How Injection Works

```
┌─────────────────────────────────┐
│  Plugin (shared, read-only)     │   Autopilot skills live here.
│  ~/.claude/plugins/cache/       │   Same for all projects.
│  autopilot/skills/dev-flow/     │
│           └── SKILL.md ─────────┼──┐
└─────────────────────────────────┘  │
                                     │  At invocation, SKILL.md runs:
                                     │  !`cat .claude/dev-flow-config.md`
                                     │
┌─────────────────────────────────┐  │
│  Your Project (per-repo)        │  │
│  my-project/.claude/            │◄─┘  Reads from YOUR project's
│    ├── dev-flow-config.md       │     .claude/ directory
│    ├── quality-gate-config.md   │
│    ├── skill-routing.md         │     These files are plain markdown.
│    └── team-config.md           │     No schema. No YAML. Natural language.
└─────────────────────────────────┘
```

The `!`command`` syntax is a Claude Code preprocessor — it runs a shell command and inlines the output into the skill body *before* the LLM sees it. This means:

- **No config file?** The `|| echo "defaults"` fallback kicks in. Zero friction for new projects.
- **Config is natural language.** A markdown file is more expressive than YAML — you can write rules, exceptions, and rationale in prose.
- **Config is project-local.** Each repo has its own `.claude/` directory. The same autopilot plugin adapts to a C++ game server, a React app, or a Rust CLI — all through different config files.

### Available Config Files

| Config File | Customizes | Template |
|-------------|-----------|----------|
| `.claude/dev-flow-config.md` | Size rules, quality gates, build commands, special rules | [template](project-config-template/dev-flow-config.md) |
| `.claude/quality-gate-config.md` | Test, scan, and review commands | [template](project-config-template/quality-gate-config.md) |
| `.claude/project-lifecycle-config.md` | Project paths, bootstrap/archive scripts | [template](project-config-template/project-lifecycle-config.md) |
| `.claude/next-config.md` | Work source paths for the next skill | [template](project-config-template/next-config.md) |
| `.claude/team-config.md` | Team role templates for your tech stack | [template](project-config-template/team-config.md) |
| `.claude/test-strategy-config.md` | Test commands, pyramid ratios, coverage thresholds | [template](project-config-template/test-strategy-config.md) |
| `.claude/debug-config.md` | Project-specific debug tools and log paths | [template](project-config-template/debug-config.md) |
| `.claude/profiling-config.md` | Profiling tools and metrics collection | [template](project-config-template/profiling-config.md) |
| `.claude/skill-routing.md` | Map keywords to your project's domain skills | [template](project-config-template/skill-routing.md) |

### Example: C++ Game Server Config

```markdown
# Dev Flow — TWGameServer Config

## Size Rules
- **S**: single module, no interface change → direct commit
- **L**: 3+ modules, public interface, Feature Flag → plan + project + PR

## Quality Gate
- S: `node .claude/scripts/quality-pipeline.js --size S`
- L: `node .claude/scripts/quality-pipeline.js --size L` per phase

## Build & Deploy
- Build: `../deploy/scripts/dev.sh build`
- Build+Restart: `../deploy/scripts/dev.sh br`

## Special Rules
- Commit 前必須跑 E2E if 改了遊戲邏輯
- Proto 改動要重編譯 SDK
```

### Example: Skill Routing

```markdown
# Skill Routing

| Keyword | Invoke |
|---------|--------|
| MJ / mahjong | `twgs-game-dev` → references/mj.md |
| crash / core dump | `twgs-debug` |
| proto / protobuf | `twgs-protobuf` |
| stress / 10K | `twgs-stress-test` |
```

This lets autopilot's `dev-flow` automatically invoke your project's domain-specific skills when it encounters relevant keywords — bridging the generic workflow layer with project-specific knowledge.

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

## Inspired By

- **[gstack](https://github.com/garry-t/gstack)** — Garry Tan's skill suite for Claude Code. The CEO agent's cognitive patterns (Bezos doors, Munger inversion, Jobs subtraction), Boil the Lake completeness principle, and scope mode system are adapted from gstack's `plan-ceo-review` skill.

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
