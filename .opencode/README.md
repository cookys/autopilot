# Autopilot for OpenCode

Development autopilot — lifecycle orchestration for OpenCode.

## Skills

28 skills covering the full development lifecycle:

- `dev-flow` — Start here before writing code (sizing, branch setup)
- `brainstorm` — Pre-code Socratic design exploration (discovers options)
- `l3` / `l4` / `l5` / `l6` — Terse CEO front-doors (inline / background foreman / hetero impl / hetero verification authoring)
- `ceo-agent` — Full delegation with constraints
- `quality-pipeline` — Test → scan → completeness → review workflow
- `finish-flow` — L-size closing sequence (6 discrete sub-tasks)
- `think-tank` / `think-tank-dialectic` — Multi-perspective deliberation
- `debug` — Systematic debugging methodology
- `profiling` — Performance investigation
- `test-strategy` — Test planning
- `audit` — Old vs new comparison
- `doc-sync` — Doc-vs-code drift audit
- `survey` — Research-only exploration
- `research-to-ship` — Research → plan → dialectic → project → execute pipeline
- `team` — Parallel task dispatch with dependency analysis
- `project-lifecycle` — Project creation and archival
- `next` — "What's next" session kickoff
- `retro` — Session retrospective
- `learn` — Capture learnings from failures
- `distill` — Distill recurring procedures into personal skills

## Agents

- `autopilot-reviewer` — Three Red Lines code reviewer
- `autopilot-debugger` — Root cause analysis
- `autopilot-planner` — Task decomposition

## Harness boundary

OpenCode shares Autopilot skills and methodology agent bodies through `.agents/skills/`
and `.opencode/opencode.json`. Claude Code hooks and slash-command behavior are not
assumed to have OpenCode parity; platform-specific behavior lives in the OpenCode
plugin wrapper and must be probed before being documented as equivalent.

## Philosophy

Autopilot enforces **Three Red Lines** discipline:

1. **Closure** — Every finding includes impact + fix direction
2. **Fact-driven** — Every finding cites actual code with `file:line`
3. **Exhaustiveness** — Full checklist; no silent omissions

See full documentation at: https://github.com/cookys/autopilot
