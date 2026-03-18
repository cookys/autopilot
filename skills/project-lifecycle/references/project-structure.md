
# Project Structure (L size)

```
doc/projects/YYYY-MM-DD-xxx/
├── README.md                        # Project description + progress (< 300 lines)
├── ADR.md                           # Architecture decision records (optional)
├── phase-0-design.md                # Initial design (optional)
├── phase-1-core-infrastructure.md
├── phase-2-data-isolation.md
├── phase-2.1-queue-migration.md     # Sub-phase example
└── dev-info.md                      # Branch, PR link
```

## Directory Naming

**Format**: `YYYY-MM-DD-<short-english-name>`

| Example | Description |
|---------|-------------|
| `2026-01-31-multitenancy` | Multi-tenant architecture |
| `2026-02-01-ai-system` | AI system improvement |

**Rules**:
- Date = project **start date**
- Name in **lowercase + hyphens** (kebab-case)
- Short and descriptive (2-4 words)

## File Responsibilities

| File | Role | Content |
|------|------|---------|
| **README.md** | What + Status | Project description, progress tracking, results |
| **ADR.md** | Why | Architecture decision records |
| **phase-N.md** | How | Detailed design and implementation for that Phase |

**Key rules**:
- No separate `plan.md` — initial design goes in `phase-0-design.md`, decisions in `ADR.md`
- Simple projects may skip ADR.md and phase-0, starting directly from phase-1
- ADR.md is optional for small projects with few decisions

**Common mistakes**:
- README.md with Phase implementation details -> belongs in phase-N.md
- README.md with detailed decision rationale -> belongs in ADR.md
- Multiple design files (plan.md, design.md) -> use phase-0-design.md or ADR.md
- Directory with year only (2026-xxx) -> must include full date

## Phase Rules

### Numbering

Phases start at 0, increment sequentially per project.

| Phase | Purpose |
|-------|---------|
| Phase 0 | Initial design (architecture, tech selection, prototyping) — optional |
| Phase 1 | First stage (core functionality or infrastructure) |
| Phase 2+ | Subsequent stages |

**Forbidden**:
- Inheriting Phase numbers from other projects (e.g., starting at Phase 7)
- Skipping numbers (e.g., Phase 1 then Phase 5)
- If splitting from another project: renumber from Phase 0, note origin in README

### File Naming

**Format**: `phase-N-title.md` or `phase-N.X-title.md`

| Level | Format | Example |
|-------|--------|---------|
| Phase | `phase-N-title.md` | `phase-1-core-infrastructure.md` |
| Sub-phase | `phase-N.X-title.md` | `phase-1.1-player-binding.md` |
| Sub-sub | `phase-N.X.Y-title.md` | `phase-1.1.2-tcp-accept.md` |
| Merged | `phase-N-M-title.md` | `phase-1-3-setup.md` |

Titles: English lowercase + hyphens (kebab-case), 2-4 words describing content.

### Phase Merging

Merge rules and naming conventions: [references/templates.md](references/templates.md)

## Size Limits

| File Type | Limit |
|-----------|-------|
| `README.md` | < 300 lines |
| `phase-N.md` | < 500 lines |
| `phase-N.X.md` (sub-phase) | < 300 lines |

**When to split**: single Phase > 500 lines -> split into sub-phases (`phase-N.1-title.md`, `phase-N.2-title.md`).

## Examples

### Minimal Project (3 phases, no ADR)

```
doc/projects/2026-03-18-fix-reconnect/
├── README.md
├── dev-info.md
├── phase-1-detect-stale-connections.md
├── phase-2-reconnect-handshake.md
└── phase-3-state-restore.md
```

### Complex Project (with design phase and sub-phases)

```
doc/projects/2026-02-15-async-db-pool/
├── README.md
├── ADR.md
├── dev-info.md
├── phase-0-design.md
├── phase-1-pool-infrastructure.md
├── phase-1.1-connection-lifecycle.md
├── phase-1.2-query-routing.md
├── phase-2-migration.md
└── phase-3-monitoring.md
```

## Templates

README.md, ADR.md, dev-info.md, and Phase merging templates: [references/templates.md](references/templates.md)

## See Also

- `project-lifecycle (bootstrap)` — auto-generates project structure from plan
- `dev-flow` — invokes project-structure at L-4
- `project-lifecycle (archive)` — archiving conventions
