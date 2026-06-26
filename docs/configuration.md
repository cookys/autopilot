# Autopilot — Cross-Repository Configuration

> Part of [Autopilot](../README.md). Detail docs: [Skills](skills.md) · [Coexistence](coexistence.md) · [Configuration](configuration.md) · [Installation](installation.md) · [Architecture](architecture.md) · [Hooks](../hooks/README.md)

Skills work out of the box. For project-specific behavior, drop a markdown file into your project's `.claude/` directory — this page explains the injection mechanism, the available config files, and team setup.

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
| `.claude/dev-flow-config.md` | Size rules, quality gates, build commands, special rules | [template](../project-config-template/dev-flow-config.md) |
| `.claude/finish-flow-config.md` | L-5 / H-9 closing sequence overrides (merge target, archive proc, per-size quality gate) | [template](../project-config-template/finish-flow-config.md) |
| `.claude/quality-gate-config.md` | Test, scan, and review commands | [template](../project-config-template/quality-gate-config.md) |
| `.claude/project-lifecycle-config.md` | Project paths, bootstrap/archive scripts | [template](../project-config-template/project-lifecycle-config.md) |
| `.claude/next-config.md` | Work source paths for the next skill | [template](../project-config-template/next-config.md) |
| `.claude/team-config.md` | Team role templates for your tech stack | [template](../project-config-template/team-config.md) |
| `.claude/test-strategy-config.md` | Test commands, pyramid ratios, coverage thresholds | [template](../project-config-template/test-strategy-config.md) |
| `.claude/debug-config.md` | Project-specific debug tools and log paths | [template](../project-config-template/debug-config.md) |
| `.claude/profiling-config.md` | Profiling tools and metrics collection | [template](../project-config-template/profiling-config.md) |
| `.claude/skill-routing.md` | Map keywords to your project's domain skills | [template](../project-config-template/skill-routing.md) |
| `.claude/model-routing-config.md` | Subagent model/mode per role (planner, reviewer, etc.) | [template](../project-config-template/model-routing-config.md) |
| `.claude/loop.md` | Default prompt for a bare `/loop` — unattended babysit of the current branch (CI/PR tending → `next`/`debug`/`quality-pipeline`). Claude Code only (v2.1.72+); degrades cleanly elsewhere. | [template](../project-config-template/loop.md) |

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
