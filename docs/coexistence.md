# Autopilot — Superpowers Coexistence

> Part of [Autopilot](../README.md). Detail docs: [Skills](skills.md) · [Coexistence](coexistence.md) · [Configuration](configuration.md) · [Installation](installation.md) · [Architecture](architecture.md) · [Hooks](../hooks/README.md)

Autopilot is standalone-capable. This page covers how it coexists with the optional `superpowers` plugin: the layered model, the three deployment scenarios, and the migration note.

---

### Coexistence Model — autopilot is standalone-capable, Superpowers is optional

Autopilot works fully without `superpowers`. If you also have `superpowers` installed, autopilot's orchestrator skills (`ceo-agent`, `finish-flow`, `quality-pipeline`, `think-tank{,-dialectic}`, `dev-flow`) consult `.claude/dispatch-config.md` to decide which methodology / reviewer / parallel dispatcher to delegate to.

```
autopilot:dev-flow sets session rules:
  → "When debugging, read .claude/debug-config.md for project context"
  → "Before committing, run autopilot:quality-pipeline"
  → "On session end, update project tracking"

Methodology dispatch (per .claude/dispatch-config.md):
  → Debugging:  superpowers:systematic-debugging (if installed) → autopilot:debug
  → Testing:    superpowers:test-driven-development + autopilot:test-strategy (complementary)
  → Profiling:  autopilot:profiling (no superpowers equivalent)
  → Team:       autopilot:team (allocation) + superpowers:dispatching-parallel-agents (dispatch)
  → Review:     autopilot:reviewer → superpowers:requesting-code-review (fallback)
```

This was historically positioned as「sets the rules; Superpowers executes」(v2.0-v2.6); v2.7.0 preserves that model when superpowers is installed while making autopilot also work as a standalone plugin. See [Superpowers Coexistence](#superpowers-coexistence) for per-scenario UX.

---

## Superpowers Coexistence

Autopilot supports three deployment scenarios:

### A. You have `superpowers` installed (user-level or marketplace)

Recommended default. autopilot's orchestrators delegate tactical execution to superpowers via `.claude/dispatch-config.md` chains.

`.claude/dispatch-config.md` example (paste into your project):

```markdown
## Code Review
- autopilot:reviewer
- superpowers:requesting-code-review

## Parallel Dispatch
- superpowers:dispatching-parallel-agents
- native

## Methodology Preferences

### Debugging
- superpowers:systematic-debugging
- autopilot:debug

### Testing methodology
- autopilot:test-strategy
- superpowers:test-driven-development
```

> **superpowers ≥ v5.1.0 note**: the standalone `superpowers:code-reviewer` agent was removed and folded into the **`requesting-code-review`** / **`receiving-code-review`** skills (verified against `obra/superpowers` v6.0.3, 2026-06). Chains above use the current name; `autopilot:reviewer` remains the methodology-disciplined primary, so this fallback is optional.

### B. You do NOT have `superpowers` installed

Autopilot runs fully standalone. Orchestrators fall through to autopilot's own fallback skills (`autopilot:debug`, `autopilot:test-strategy`, `autopilot:team`, `autopilot:profiling`) and `native` parallel dispatch (multiple `Task` tool calls in one response).

> **One standalone gap to know**: the red-green-refactor **TDD coding loop** has no native autopilot skill — `autopilot:test-strategy` is *orthogonal* (test pyramid / baseline / failure funnel), not a TDD substitute. For TDD specifically, install `superpowers` (`test-driven-development`) or run the red-green cycle by hand.

No `.claude/dispatch-config.md` needed — the defaults documented at the top of [`project-config-template/dispatch-config.md`](../project-config-template/dispatch-config.md) match this scenario.

### C. You have `superpowers` user-level but want pure-autopilot in a specific project

Use `.claude/settings.json`'s `disabledSkills` to hard-cut superpowers skills per-project:

```jsonc
{
  "disabledSkills": [
    "superpowers:systematic-debugging",
    "superpowers:test-driven-development",
    "superpowers:dispatching-parallel-agents",
    "superpowers:requesting-code-review"
  ]
}
```

This is a Claude Code native mechanism; autopilot doesn't need a config flag for it.

### Migration note (v2.6.0 → v2.7.0)

If you upgrade from v2.6.0 and previously **removed** `debug`, `test-strategy`, `team`, or `profiling` entries from your `CLAUDE.md` skill routing tables (expecting these skills to remain absent), be aware they're back as fallback skills in v2.7.0 and may now trigger on the corresponding keywords. To suppress: add them to `.claude/settings.json`'s `disabledSkills`.

