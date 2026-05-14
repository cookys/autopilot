# Team Tactics: Dependency Analysis and Parallelization

## Data Source

Plan table's "prerequisites" column is the primary data source. If your project has a `plan-bootstrap.js` (or similar) script, it can auto-parse this column into:
- `phaseDeps` — each phase's dependency list
- `parallelGroups` — topologically sorted batch groups
- README "Parallel Execution Opportunities" section — human-readable parallel hints

autopilot itself ships **no** `plan-bootstrap.js`. Treat plan tables as hand-edited and read the "Manual Dependency Graph" section below for the no-script flow.

## Phase Completion Flow

```
Phase N completed
├── Check README "Parallel Execution" + dependency columns
├── Which Phases have ALL dependencies completed?
│   ├── 1 → solo continue
│   └── 2+ → file overlap check (below) → dispatch only if pass
└── All parallel phases done → proceed to next batch
```

## File Overlap Check (Mandatory Before Dispatch)

DAG-independent does NOT mean safely parallelizable. **Overlapping file changes cause merge conflicts, which are slower than sequential.**

List each candidate phase's expected file changes, then assess overlap:

| Overlap Level | Judgment | Action |
|---------------|----------|--------|
| None | Different directories/files | Parallel dispatch |
| Minor shared | Only headers/config (non-conflicting changes) | Parallel, but specify merge order |
| Core file overlap | Multiple phases modify same .cpp/.ts | Sequential execution, no parallel |

### Common Overlap Traps

- Multiple games each change but share `AIFactory`, `GameManager`, `CMakeLists.txt`
- Server + SDK both modify proto definitions or shared types
- Different features all need `main.cpp` initialization order changes

## Manual Dependency Graph (When No Bootstrap Data)

```
1. List all work items (plan steps / phases / sub-tasks)
2. Draw dependencies: which items MUST complete before others start?
3. Find independent blocks (items with no dependency arrows between them)
4. Count independent blocks:
   - 0-1 → Solo
   - 2+ → Build team
```

## Common Parallelization Patterns

| Pattern | How It Works |
|---------|-------------|
| Server // SDK | API endpoints done + types generated → SDK can start in parallel |
| Migration → Server → (SDK // Tests) | DB + API sequential; SDK + tests parallel after API done |
| Multi-game changes | Different games with no shared state can run in parallel |
| Research // Scaffolding | One agent investigates while another builds project structure |
| Audit // Implementation | Auditor reviews existing code while implementer builds new features |

## Parallel Phase Notes

- Commit order between parallel phases does not matter, but all in a batch must complete before next batch
- Every agent's task must include `quality-pipeline`
- **Avoid conflicts over parallelism** — better to prevent conflicts upfront than resolve them afterward
