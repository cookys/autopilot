# Project Doc Templates + Phase Merging

> Copy-paste skeletons for the L-size project structure described in
> [project-structure.md](project-structure.md). Keep skeletons minimal —
> delete optional sections that don't apply.

## README.md (< 300 lines)

```markdown
# <Project Name>

> **Status**: In progress | ✅ Completed · **Size**: L · **Branch**: `feat/<name>`
> **Started**: YYYY-MM-DD · **Plan**: [plan](../../plans/YYYY-MM-DD-<name>.md)

## OKR
**Objective**: <one sentence>
**Key Results**:
- KR1 — <verifiable condition>

## Phases
| Phase | Status |
|-------|--------|
| P1 — <name> | pending |

## Success criteria
- <observable condition>
```

## ADR.md (optional — skip for small projects)

```markdown
# Architecture Decision Records

## ADR-001: <decision title>
- **Date**: YYYY-MM-DD
- **Status**: accepted | superseded by ADR-NNN
- **Context**: <forces at play>
- **Decision**: <what was chosen>
- **Consequences**: <trade-offs accepted>
```

## phase-N.md (How — detailed design + implementation per phase)

```markdown
# Phase N — <name>

## Goal
<what this phase delivers>

## Design
<approach, key decisions (link ADR-NNN if recorded)>

## Tasks
- [ ] <task>

## Verification
<how we know the phase is done>
```

## dev-info.md

```markdown
# Dev Info
- **Branch**: `feat/<name>`
- **PR**: <link>
- **Base**: develop @ <sha>
```

## Phase Merging — rules + naming

When two phases collapse into one (scope shrank, or they share an implementation):

- **When to merge**: phases with the same blast radius, or a sub-phase fully absorbed by its parent. Don't merge phases with different rollback units.
- **Naming**: keep the lower number; note the absorbed phase in the title — e.g. `phase-2-data-isolation.md` absorbing the queue work becomes `phase-2-data-isolation-and-queue.md`, with a one-line "merged from former Phase 2.1" note at the top.
- **Sub-phases**: use a decimal (`phase-2.1-queue-migration.md`) only for work discovered mid-phase that warrants its own file; otherwise fold it into the parent phase's Tasks list.
- **Traceability**: never silently delete a phase file — if a phase is dropped, record it as "out of scope" in README rather than removing the record.
