# Model Routing — Subagent Dispatch

> Override autopilot's default model/mode selection for subagent dispatch.
> Delete rows you don't want to override — defaults from the plugin will apply.

## Dispatch Table

| Role | Model | Mode | Notes |
|------|-------|------|-------|
| planner | sonnet | plan | Analysis only, no implementation |
| reviewer | sonnet | plan | Code review, read-only |
| debugger | sonnet | plan | Root cause analysis |
| implementer | opus | default | Needs full tool access |
| test-runner | haiku | default | Execution-focused, speed priority |
| researcher | sonnet | default | Web search + synthesis |
| think-tank-role | sonnet | plan | Multi-perspective analysis |

## Tree roles (task-tree engine)

Override tree-role routing (`scripts/resolve-dispatch.sh --tree`) with `tree:<role>`
rows in the same table — the prefix keeps them from colliding with the legacy rows
above (a bare `implementer` row never matches `--tree` lookups, and vice versa):

| Role | Model | Mode | Notes |
|------|-------|------|-------|
| tree:implementer | sonnet | default | Tree-table default shown; edit to override |
| tree:judge | haiku | plan | QC panel judge |

`manager` is not overridable — it is never dispatched (Amendment 11; the script
refuses with exit 3).

## Mode Reference

- `plan` — read-only, cannot Edit/Write/Bash (best for analysis tasks)
- `default` — full tool access (needed for implementation and execution)

## Customization Examples

```markdown
<!-- Use opus for everything (money is no object) -->
| planner | opus | plan | |

<!-- Use haiku for reviews (budget-conscious) -->
| reviewer | haiku | plan | 82% accuracy, saves 68% vs opus |

<!-- Let reviewer write fixes directly -->
| reviewer | sonnet | default | Auto-fix enabled |
```
