# No route for external field experience contributed INTO autopilot itself

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: A second instance of a lesson learned while *using* autopilot on another project that
  belongs in autopilot's own skills/references and has nowhere to go. n=1 today (2026-08-24: the
  knowledge-routing fix set), so this is recorded, not built.
- **Context**: `learn` records facts/gotchas into `.claude/knowledge/`; `distill` produces reusable
  procedures and **explicitly never targets autopilot** (its description says so). Neither routes a
  field-experience finding into autopilot's own `skills/` or `references/`. Today that path exists
  only as a human noticing and hand-authoring it — the same "habit, not policy" gap
  `references/knowledge-routing.md` was written to close for the disclosure line.
- **Effort**: S (a `references/` row in `learn` may already be enough; a new skill is not justified at n=1)
- **Source**: knowledge-routing fix set, foreman first-pass review (2026-08-24)

