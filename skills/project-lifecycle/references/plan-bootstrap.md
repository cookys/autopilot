
# Plan Bootstrap (Plan Mode -> Project Setup)

> **Trigger**: L-size project after ExitPlanMode, or after user approves a plan
> **Input**: Plan file (from system-reminder path or `doc/plans/`)

## Step 1: Locate Plan File

| Source | How to Find |
|--------|-------------|
| ExitPlanMode | Plan path appears in system-reminder |
| Not found | `ls -lt ~/.claude/plans/*.md | head -5` |
| User-provided plan | Write to `doc/plans/<name>.md` first, then continue |

**Validation**: open the plan file and confirm it contains actionable phases (headings, tables, or numbered steps).

## Step 2: Run Bootstrap Script

```bash
# Run your project's bootstrap script, or create manually:
# node .claude/scripts/plan-bootstrap.js --plan <path> --name <name>
```

### What the Script Does

1. Parses plan file for `## Phase N:` headings and prerequisite tables
2. Creates `doc/projects/YYYY-MM-DD-<name>/` directory
3. Generates `README.md` with: project description, phase table, dependency graph, parallel execution opportunities
4. Generates `dev-info.md` with branch and base info
5. Copies plan file into project directory
6. Creates git branch `feature/<name>` (or uses `--branch`)
7. Updates `doc/projects/INDEX.md` (adds active project entry)
8. Runs `git add` on all new files

### Expected Output

```json
{
  "projectDir": "doc/projects/2026-03-18-my-feature",
  "planCopyPath": "doc/projects/2026-03-18-my-feature/plan.md",
  "branch": "feature/my-feature",
  "phasesFound": 4,
  "phaseDeps": { "p1": [], "p2": ["p1"], "p3": ["p1"], "p4": ["p2", "p3"] },
  "parallelGroups": [["p1"], ["p2", "p3"], ["p4"]],
  "indexUpdated": true,
  "nextAction": "Review README, commit, start Phase 1"
}
```

## Step 3: Verify + Commit

1. **Check `phasesFound`** — if 0, the plan lacks standard `## Phase N:` headings. Manually edit the generated README to add a phase table.
2. **Check `indexUpdated`** — if false, INDEX insertion failed. Manually add the project entry to `doc/projects/INDEX.md`.
3. **Review generated README.md** — verify goals, success criteria, and scope were correctly extracted. Fix any inaccuracies.
4. **Check `phaseDeps`** — if all empty arrays, the plan table may lack a "prerequisites" column. Manually add dependency info to README if needed.
5. **Commit**:
   ```bash
   git commit -m "feat(<name>): bootstrap project from plan"
   ```

## Error Recovery

| Error | Cause | Recovery |
|-------|-------|----------|
| `Project dir already exists` | Re-running bootstrap or name collision | Check if the existing dir is from a prior attempt. If so, reuse it (`--name` with different name, or delete and retry). |
| `Plan file not found` | Wrong path or file moved | Check `~/.claude/plans/` and `doc/plans/`. Copy the file to the expected location. |
| `phasesFound: 0` | Plan uses non-standard headings (e.g., "### Step 1" instead of "## Phase 1") | Manually edit README phase table. The project structure is still valid. |
| INDEX insertion failed | INDEX.md format changed or active section marker missing | Manually edit `doc/projects/INDEX.md` to add the new project entry. |
| Branch already exists | Branch name collision | Use `--branch feature/<alternate-name>` or delete the stale branch first. |
| Script crashes | Node.js version or missing module | Check `node --version` (needs 18+). If persistent, create project structure manually per `project-lifecycle (structure)`. |

## Manual Bootstrap (When Script Unavailable)

1. Create dir: `mkdir -p doc/projects/YYYY-MM-DD-<name>`
2. Create README.md using template from `project-lifecycle (structure)`
3. Create dev-info.md with branch info
4. Copy plan: `cp <plan-path> doc/projects/YYYY-MM-DD-<name>/plan.md`
5. Create branch: `git checkout -b feature/<name>`
6. Update `doc/projects/INDEX.md`
7. `git add` all new files

## See Also

- `dev-flow` — calls plan-bootstrap at L-3
- `project-lifecycle (structure)` — directory conventions and templates
- `team (project-specific)` — uses `phaseDeps`/`parallelGroups` from bootstrap output
