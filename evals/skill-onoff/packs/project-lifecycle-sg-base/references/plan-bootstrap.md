
# Plan Bootstrap (Plan Mode -> Project Setup)

> **Trigger**: L-size project after ExitPlanMode, or after user approves a plan
> **Input**: Plan file (from system-reminder path or `docs/plans/`)

## Step 0: Draft Plan Overlap Check

Before bootstrapping, check if any existing draft plans overlap with this plan:

```bash
# List draft plans (status: draft in frontmatter or no status field)
for f in docs/plans/*.md; do
  grep -q 'status: approved' "$f" 2>/dev/null || echo "$f"
done
```

For each draft plan, check overlap against the plan being bootstrapped:
- **Same feature**: both mention the same feature name or user story
- **Same module**: both modify the same code area
- **Same user story**: both address the same user workflow

| Situation | Action |
|-----------|--------|
| No overlap | Proceed to Step 1 |
| Full overlap | Draft plan is superseded — mark it `status: superseded-by: <this-plan>` |
| Partial overlap | Annotate draft plan with which parts are now covered |
| Uncertain | Surface to decision-maker (user or CEO) |

## Step 1: Locate Plan File

| Source | How to Find |
|--------|-------------|
| ExitPlanMode | Plan path appears in system-reminder |
| Not found | `ls -lt ~/.claude/plans/*.md | head -5` |
| User-provided plan | Write to `docs/plans/<name>.md` first, then continue |

**Validation**: open the plan file and confirm it contains an actionable goal, acceptance criteria,
scope, and source coverage. Phase/P0 headings, modules, review seats, tests, and retries are
authoring metadata, not an execution graph.

## Step 2: Freeze And Admit The Deliverable Graph

Mission-enabled projects require a caller-authored bounded deliverable graph and source manifest.
Do not generate graph nodes from plan headings. Before project TaskCreate, branch, worktree, runner,
or model effects, run:

```bash
node <autopilot-source>/scripts/mission-routing-admission.js \
  --repo-root "$(git rev-parse --show-toplevel)" --level l3
```

`READY` admits the frozen graph. `SHADOW` records whether the same graph would block but cannot
claim enforcement. `LEGACY` preserves the existing off-mode bootstrap path. In every mode, source
headings remain provenance/coverage; they are never copied directly into implementation tasks.

## Step 3: Run Bootstrap Script

```bash
# Run your project's bootstrap script, or create manually:
# node .claude/scripts/plan-bootstrap.js --plan <path> --graph <path> --name <name>
```

### What The Script Does

1. Records `Phase`/`P0..PN` headings, modules, tests, reviewer seats, and retry language as source
   coverage metadata
2. Reads the already-authored admitted Mission graph; it never invents a node
3. Verifies every source plan/rubric maps exactly once and every deliverable stays within policy
   count, critical-path, parallel, batch, gate-attempt, and aggregate reservation ceilings
4. Creates one project tracker row per deliverable, with source authoring units nested as coverage
5. Creates `docs/projects/YYYY-MM-DD-<name>/` directory
6. Generates `README.md` with: project description, historical implementation ledger, current
   deliverable table, dependency graph, and parallel execution opportunities
7. Generates `dev-info.md` with branch and base info
8. Copies plan file into project directory
9. Creates git branch `feature/<name>` (or uses `--branch`)
10. Updates `docs/projects/INDEX.md` (adds active project entry)
11. Runs `git add` on all new files

### Expected Output

```json
{
  "projectDir": "docs/projects/2026-03-18-my-feature",
  "planCopyPath": "docs/projects/2026-03-18-my-feature/plan.md",
  "branch": "feature/my-feature",
  "sourceAuthoringUnitsFound": 34,
  "deliverablesAdmitted": 3,
  "deliverableDeps": {
    "plan-review": [],
    "transcript-retro": [],
    "release-closeout": ["plan-review", "transcript-retro"]
  },
  "parallelGroups": [
    ["plan-review", "transcript-retro"],
    ["release-closeout"]
  ],
  "missionAdmissionDigest": "<sha256>",
  "indexUpdated": true,
  "nextAction": "Review README, commit, start the first ready deliverable"
}
```

Illustrative shape only: the caller-authored graph may drop already-integrated deliverables on
resume (see resume projection below). Do not copy historical four-node deps from memory.

## Resume projection (remaining deliverables only)

When bootstrapping or re-admitting after partial integration:

- Graph nodes represent **remaining** deliverables. An already integrated deliverable is omitted or
  satisfied by an authoritative receipt/commit — never redispatched.
- `campaign.output_paths` describe **required mutations for the new candidate**, not every file the
  workstream ever touched historically.
- Source manifests stay exact-coverage for the **current** graph. Narrow the active manifest when a
  deliverable leaves the executable set; keep full provenance in git history / project ledger. Never
  fabricate source hashes.
- This is methodology and tracker discipline until a deterministic resume-projection gate binds
  accepted commit/receipt evidence and rejects historical-output replay before grant (BACKLOG).

## Step 4: Verify + Commit

1. **Check `deliverablesAdmitted`** — it must equal the frozen graph node count and stay within
   policy. A plan with 34 headings and a three-node successor graph reports coverage units for the
   active source set and three deliverables, never one task per authoring heading.
2. **Check `indexUpdated`** — if false, INDEX insertion failed. Manually add the project entry to `docs/projects/INDEX.md`.
3. **Review generated README.md** — verify goals, success criteria, and scope were correctly extracted. Fix any inaccuracies.
4. **Check `deliverableDeps`** against the admitted graph. Never infer dependencies from heading order.
5. **Check admission identity** — policy, graph, and source coverage digests must match the
   pre-effect routing result.
6. **Commit**:
   ```bash
   git commit -m "feat(<name>): bootstrap project from plan"
   ```

## Error Recovery

| Error | Cause | Recovery |
|-------|-------|----------|
| `Project dir already exists` | Re-running bootstrap or name collision | Check if the existing dir is from a prior attempt. If so, reuse it (`--name` with different name, or delete and retry). |
| `Plan file not found` | Wrong path or file moved | Check `~/.claude/plans/` and `docs/plans/`. Copy the file to the expected location. |
| Source headings absent | Plan uses prose/tables instead of standard headings | Record the files as source coverage; do not invent placeholder phases. |
| Graph/source coverage mismatch | A source was omitted, duplicated, drifted, or invented | Correct the caller-authored graph/manifest and rerun Mission admission. |
| Deliverable/critical-path/reservation limit | The graph exceeds project policy | Regroup source metadata inside bounded deliverables or tighten scope; never split gates/retries into more nodes. |
| INDEX insertion failed | INDEX.md format changed or active section marker missing | Manually edit `docs/projects/INDEX.md` to add the new project entry. |
| Branch already exists | Branch name collision | Use `--branch feature/<alternate-name>` or delete the stale branch first. |
| Script crashes | Node.js version or missing module | Check `node --version` (needs 18+). If persistent, create project structure manually per `project-lifecycle (structure)`. |

## Manual Bootstrap (When Script Unavailable)

1. Freeze and admit the caller-authored deliverable graph before any TaskCreate or branch effect
2. Create dir: `mkdir -p docs/projects/YYYY-MM-DD-<name>`
3. Create README.md using template from `project-lifecycle (structure)` with source coverage nested
   under admitted deliverables
4. Create dev-info.md with branch info
5. Copy plan: `cp <plan-path> docs/projects/YYYY-MM-DD-<name>/plan.md`
6. Create branch: `git checkout -b feature/<name>`
7. Update `docs/projects/INDEX.md`
8. `git add` all new files

## See Also

- `dev-flow` — calls plan-bootstrap at L-3
- `project-lifecycle (structure)` — directory conventions and templates
- `team (project-specific)` — uses admitted `deliverableDeps`/`parallelGroups` from bootstrap output
