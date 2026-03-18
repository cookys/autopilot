# Autopilot — Development Workflow Skills for Claude Code

A Claude Code plugin that provides 7 development workflow skills. These skills automate common development patterns: flow evaluation, tech research, multi-perspective decisions, autonomous execution, knowledge capture, engineering retrospectives, and context management.

## Install

```bash
# Add marketplace
/plugin marketplace add cookys/autopilot

# Install
/plugin install autopilot@autopilot
```

## Skills

| Skill | Description |
|-------|-------------|
| `autopilot:dev-flow` | Evaluate task size (S/L), route to direct-commit or plan+project flow |
| `autopilot:survey` | Dual-agent tech research (researcher + skeptic in parallel) |
| `autopilot:think-tank` | 6-role debate for product/strategy decisions |
| `autopilot:ceo-agent` | Autonomous mode — set goal, agent owns all execution |
| `autopilot:learn` | Auto-record knowledge after retries or non-obvious fixes |
| `autopilot:retro` | Engineering retrospective from git history |
| `autopilot:context-reduce` | Analyze and reduce context window token usage |

## Project Configuration (Optional)

`dev-flow` supports per-project customization via injection files. Without these files, sensible defaults are used.

### `.claude/dev-flow-config.md`

Defines your project's size rules, quality gate commands, build/deploy commands, and special rules. See [`project-config-template/dev-flow-config.md`](project-config-template/dev-flow-config.md) for the template.

### `.claude/skill-routing.md`

Maps keywords to project-specific skills. See [`project-config-template/skill-routing.md`](project-config-template/skill-routing.md) for the template.

### How injection works

`dev-flow` uses Claude Code's `!`command`` syntax to read these files at invocation time:

```markdown
## Project Config (auto-injected)
!`cat .claude/dev-flow-config.md 2>/dev/null || echo "No config found, using defaults."`
```

If the file doesn't exist, defaults are used automatically.

## Team Setup

To auto-prompt team members to install:

```jsonc
// .claude/settings.json (in your project repo)
{
  "extraKnownMarketplaces": {
    "autopilot": {
      "source": { "source": "github", "repo": "cookys/autopilot" }
    }
  }
}
```

## Update

```bash
/plugin update autopilot@autopilot
```

## License

MIT
