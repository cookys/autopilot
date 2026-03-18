
# Project Archive

> **Trigger**: L-size project completed (after `finishing-a-development-branch`)
> **S-size tasks do not use this flow** — S audit trail lives in `doc/projects/ongoing-maintenance/`

## Eligibility Check (before archiving)

A project is eligible for archive when:
- **100% of phases completed**, OR
- **Core phases completed** + remaining phases explicitly recorded in `doc/BACKLOG.md` with trigger conditions

**Cannot archive if**: any incomplete phase is not accounted for in BACKLOG, or deferred items lack trigger conditions.

```
Eligibility check:
├── All phases done? → eligible
├── Core phases done + rest in BACKLOG with triggers? → eligible
└── Incomplete phases not in BACKLOG? → NOT eligible — resolve first
```

## Step 1: README Status Verification (LLM judgment)

Read `doc/projects/{PROJECT}/README.md` and verify:

- [ ] All Phase statuses show completion (not in-progress or pending)
- [ ] Phases moved to Backlog are marked paused with corresponding BACKLOG.md entry
- [ ] Final results/metrics are documented

**If README is incomplete**: update it before proceeding. Do not archive with stale status.

## Step 2: Run Archive Script

```bash
# Run your project's archive script, or follow steps manually:
# node .claude/scripts/project-archive.js --project <dir-name>
```

The script performs: mv to `_archive/` -> update `projects/INDEX.md` (remove + add to archived + update count) -> archive matching plans -> update `plans/INDEX.md`.

**Expected output**:
```json
{
  "archived": true,
  "indexUpdated": true,
  "plansArchived": ["plan-name.md"],
  "errors": [],
  "nextAction": "LLM post-processing required"
}
```

**Verify each field** before proceeding to Step 3.

## Step 3: LLM Post-Processing (Script Cannot Handle)

These items require judgment and must not be skipped:

- [ ] **Proposals archive** — check `doc/proposals/` for related files. If found, move to `doc/proposals/_archive/` and update proposals INDEX if one exists.
- [ ] **`~/.claude/plans/` cleanup** — check for leftover plan files from Plan Mode. Archive to `doc/plans/_archive/`.
- [ ] **BACKLOG.md sync** — **delete** completed items (not strikethrough). Add any newly identified follow-up items with trigger conditions.
- [ ] **Documentation sync** — run `git diff --name-only develop` and verify: if game logic/architecture/proto/skill files changed, corresponding docs are updated.
- [ ] **MEMORY.md refresh** — update "In Progress" section (remove archived project, add any new state).

## Step 4: Stale Entry Sweep

During archive, scan for orphaned or inconsistent entries across project tracking files:

```bash
# Check for projects still marked Active but with all phases done:
grep -l "in progress" doc/projects/*/README.md 2>/dev/null

# Check for plan files that should have been archived:
ls doc/plans/*.md 2>/dev/null | grep -v INDEX | grep -v _archive

# Check for empty Active table entries pointing to _archive/:
grep "_archive" doc/projects/INDEX.md 2>/dev/null

# Check for "in progress" markers that should be resolved:
grep -rn "in progress\|In Progress\|IN PROGRESS" doc/projects/INDEX.md doc/plans/INDEX.md 2>/dev/null
```

**For each finding:**
- Orphaned plan file (project already archived) → move to `doc/plans/_archive/`
- Active table entry pointing to `_archive/` → remove from Active, ensure in Archived
- "In progress" marker on completed project → update to final status
- Empty Active table row → remove

## Step 5: Invoke next (project-specific)

Auto-trigger after archive completes. Scans all work sources and recommends next action.

## Error Recovery

| Script Error | Diagnosis | Recovery |
|-------------|-----------|----------|
| `Archive destination already exists` | Duplicate archive attempt or name collision | Check `doc/projects/_archive/` for existing dir. If duplicate, skip mv. If name collision, rename. |
| `indexUpdated: false` | INDEX.md format changed or project entry not found | Manually edit `doc/projects/INDEX.md`: remove from active, add to archived section, update count. |
| `plansArchived: []` (expected plans) | Plan filename does not contain project short name | Manually find plan in `doc/plans/`, move to `doc/plans/_archive/`, update `doc/plans/INDEX.md`. |
| Script crashes (non-JSON output) | Node.js error or missing dependency | Read error message. Common fix: `node --version` check (needs 18+). If script bug, perform steps manually. |
| Partial completion (archived=true but indexUpdated=false) | Script succeeded on mv but failed on INDEX update | Do NOT re-run script (would fail on "already exists"). Manually fix INDEX only. |

## Manual Archive (When Script Unavailable)

If the script fails completely, perform these steps manually:

1. `mv doc/projects/{PROJECT} doc/projects/_archive/`
2. Edit `doc/projects/INDEX.md`: remove from active section, add to archived section
3. Move matching plans: `mv doc/plans/{plan}.md doc/plans/_archive/`
4. Edit `doc/plans/INDEX.md`: update status
5. Proceed with Step 3 (LLM post-processing)

## See Also

- `dev-flow` — orchestrates archive at L-5 completion
- `next (project-specific)` — auto-invoked after archive for next work recommendation
- `project-lifecycle (structure)` — project directory conventions
