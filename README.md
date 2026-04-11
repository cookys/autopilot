<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Lifecycle orchestration for Claude Code — sets the rules, Superpowers executes.</strong><br>
  12 skills that add lifecycle management, strategic decisions, and quality gates<br>
  on top of built-in Superpowers. Drop a config file, get project-aware workflows.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-2.3.0-E8A838?style=flat-square" alt="v2.3.0">
  <img src="https://img.shields.io/badge/skills-12-4A90D9?style=flat-square" alt="12 Skills">
  <img src="https://img.shields.io/badge/dependencies-zero-A8B5A0?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-D4A5A5?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <b>English</b> &nbsp;|&nbsp; <a href="README.zh-TW.md">正體中文</a>
</p>

---

## The Problem

Claude Code's built-in Superpowers handles tactics well — TDD, debugging, planning, code review. But it lacks:

- **Lifecycle management** — no task sizing, no project tracking, no session start/end discipline
- **Strategic decisions** — no multi-perspective debate, no dual-agent research
- **Quality gates** — no unified pipeline enforcing test → scan → completeness → review
- **Self-improvement** — no knowledge capture, no retrospectives, no "what's next?" recommendations
- **Project-specific context** — no mechanism to inject your project's tools, conventions, and known gotchas

## The Solution

Autopilot adds **lifecycle orchestration and strategic intelligence** on top of Superpowers:

| Skill | What It Does | Superpowers Handles |
|-------|-------------|-------------------|
| **dev-flow** | Sizes tasks (S/L/H), sets session rules for config injection and quality gates, manages project tracking | Planning, TDD, debugging, code review (tactical execution) |
| **survey** | Dual-agent research (researcher + skeptic) | — (no equivalent) |
| **think-tank** | 6-role debate for strategic decisions | brainstorming (different level — requirements exploration) |
| **think-tank-dialectic** | Hegelian dialectic for irreversible / high-stakes decisions with LOW consensus. 4 职能 + 2 adversarial roles (Popper falsifier + Munger inverter). NOT a "better think-tank" — a different tool for a different situation | — (no equivalent) |
| **ceo-agent** | Autonomous execution with CEO-level judgment | — (no equivalent) |
| **quality-pipeline** | Unified quality gate: test → scan → completeness → review | verification-before-completion (partial) |
| **finish-flow** | Size-aware closing forcing function — TaskCreates discrete L-5 / H-9 / Fix / S-Lite sub-tasks so nothing gets silently compressed | — (no equivalent) |
| **project-lifecycle** | Plan → bootstrap → structure → archive | finishing-a-development-branch (partial) |
| **learn** | Auto-records knowledge from failures; knowledge health audit | — (no equivalent) |
| **retro** | Engineering retrospective from git history | — (no equivalent) |
| **next** | Scan all work sources, recommend highest-priority task | — (no equivalent) |
| **audit** | Systematic comparison between implementations | — (no equivalent) |

### The Rule-Setter Model

Autopilot doesn't compete with Superpowers — it sets the rules that Superpowers operates within:

```
autopilot:dev-flow sets session rules:
  → "When debugging, read .claude/debug-config.md for project context"
  → "Before committing, run autopilot:quality-pipeline"
  → "On session end, update project tracking"

superpowers skills execute within those rules:
  → systematic-debugging (with project config in context)
  → test-driven-development (with project test conventions)
  → writing-plans (within dev-flow's sizing framework)
```

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

That's it. All 12 skills are available immediately as `autopilot:dev-flow`, `autopilot:survey`, etc.

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

- **No config file?** Silent pass-through — the skill works normally without extra noise. Zero friction.
- **Config is natural language.** A markdown file is more expressive than YAML — you can write rules, exceptions, and rationale in prose.
- **Config is project-local.** Each repo has its own `.claude/` directory. The same autopilot plugin adapts to a C++ game server, a React app, or a Rust CLI — all through different config files.
- **Session rules inject config for ALL activities.** dev-flow sets rules like "when debugging, read `.claude/debug-config.md`" — so even Superpowers' debugging skill gets your project context.

### Available Config Files

| Config File | Customizes | Template |
|-------------|-----------|----------|
| `.claude/dev-flow-config.md` | Size rules, quality gates, build commands, special rules | [template](project-config-template/dev-flow-config.md) |
| `.claude/finish-flow-config.md` | L-5 / H-9 closing sequence overrides (merge target, archive proc, per-size quality gate) | [template](project-config-template/finish-flow-config.md) |
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

**Why 12 skills, not 14?**
v2 removed 4 skills (debug, test-strategy, team, profiling) that overlapped with built-in Superpowers. Their methodology is now handled by Superpowers; their project-specific config injection is now handled by dev-flow's Session Rules. v2.2 added `think-tank-dialectic` as a different tool (not an upgrade) for irreversible decisions. Fewer skills = less context window pressure, less routing ambiguity.

**Why `!`command`` injection, not config files?**
In the Claude Code world, "configuration" is natural language. A markdown file read at invocation time is more expressive than YAML, requires no schema, and degrades gracefully when absent.

**How does it work with Superpowers?**

Autopilot is the rule-setter; Superpowers is the executor. They coexist through a layered triggering design:

```
Layer 1 — CLAUDE.md routing table (project-level)
  "新功能規劃 → autopilot:dev-flow"
  "技術調研 → autopilot:survey"
  Maps project context to skills. Written by the user.

Layer 2 — using-superpowers skill (session-level)
  "Check skills BEFORE any response. Even 1% chance = invoke."
  This is what makes skill triggering work. Without it,
  the model answers directly and never checks skills.

Layer 3 — Skill description (skill-level)
  "Use when: 'compare X with Y', 'check X against Y'..."
  User-intent trigger phrases help the model match
  the user's words to the right skill.
```

All three layers must work together. Layer 2 (Superpowers' `using-superpowers`) creates the *habit* of checking skills; Layer 1 (CLAUDE.md) provides project-specific routing; Layer 3 (descriptions) provides the semantic match. Autopilot never dispatches to or wraps Superpowers skills — they share the session, not a call chain.

**Why do descriptions use quoted trigger phrases?**

Skill descriptions serve Layer 3 — they're the last-mile match between user intent and skill selection. We write them in user-intent language (`"what should I work on"`, `"get it done"`, `"let's debate this"`) rather than internal mechanics (`"global work recommender"`, `"autonomous execution mode"`) because the model matches user messages against descriptions. The closer the description mirrors what users actually say, the more reliable the trigger.

---

## Inspired By

- **[gstack](https://github.com/garry-t/gstack)** — Garry Tan's skill suite for Claude Code. The CEO agent's cognitive patterns (Bezos doors, Munger inversion, Jobs subtraction), Boil the Lake completeness principle, and scope mode system are adapted from gstack's `plan-ceo-review` skill.
- **[Council of High Intelligence](https://github.com/0xNyk/council-of-high-intelligence)** — 0xNyk's 18-thinker multi-persona deliberation skill. The `think-tank-dialectic` skill's enforcement mechanisms (Dissent Quota, Counterfactual Trigger at >70%, Problem Restate Gate, Minority Report as first-class verdict section, Epistemic Diversity Scorecard) are adapted from Council's 7-step protocol and agent frontmatter conventions. The key meta-insight — *every thinking style must carry its own fail-safe* — comes from observing that 100% of Council's 18 agents have a `Grounding Protocol` section with self-constraining hard rules.
- **[Agora](https://github.com/geekjourneyx/agora)** — Professor Li's 6-room, 31-thinker extension of Council. The `think-tank-dialectic` skill's Hegelian Arc structure (Thesis → Antithesis → Synthesis with forced non-compromise synthesis proposal), Adaptive Depth Gate, Tacit Knowledge Extraction protocol (Polanyi), and "different tool, not better tool" framing are adapted from Agora's 8-step deliberation protocol and the `/forge` engineering room's verdict template.
- **[my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)** — NYCU-Chung's 12-agent + 15-hook engineering team plugin for Claude Code. The `v2.4.0` methodology agents (`reviewer` / `debugger` / `planner`) absorb the Three Red Lines discipline (closure / fact-driven / exhaustiveness), six-element Task Prompt contract, evidence-first debug methodology, PUA stress-mode trigger, and physical tool-restriction pattern (read-only methodology agents) from devteam's P7/P9/P10 framework. The layered split — autopilot owns methodology, voltagent owns role specialization — is a deliberate divergence from devteam's all-in-one approach to stay orthogonal to the voltagent role-agent ecosystem.

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
| `main` | Stable releases, tagged (e.g. `v1.4.5`) | Matches latest tag |
| `develop` | Next version development | Next major/minor (e.g. `2.0.0`) |

When developing: checkout `develop`, symlink points to it, `/reload-plugins` picks up changes. Remember to bump `plugin.json` version before tagging a release.

## Update (marketplace users)

```bash
/plugin update autopilot@autopilot
```

## [Changelog](CHANGELOG.md)

## Origin

Distilled from 100+ completed projects using AI-driven development.

## License

MIT — see [LICENSE](LICENSE) for details.
