# finish-flow — autopilot Project Config

> Self-hosting: autopilot's own `.claude/finish-flow-config.md`. Loaded when
> finish-flow runs inside the autopilot repo.

## Project-specific reinforcement

autopilot is a prose-skill + methodology-agent plugin. The finish-flow L-5 / H-9 /
Fix / S sequences apply, with autopilot-specific path overrides and command
substitutions documented below.

## Size-specific tooling

- **Quality gate during L-5.2 / H-9.2**: invoke `autopilot:quality-pipeline` skill. No CLI script.
- **Quality gate during Fix F.1 / S S.1**: same — invoke `autopilot:quality-pipeline --size S`
- **Archive during L-5.5**: move `docs/projects/YYYY-MM-DD-<name>/` → `docs/projects/_archive/YYYY-MM-DD-<name>/` + update `docs/projects/INDEX.md` (move row from 進行中 to 已完成 with merge commit hash)
- **Merge during L-5.3**: target branch is `develop`
- **Merge during H-9.3**: target branch is `main`, use `--no-ff`

## L-5 sub-task adaptations

### L-5.1 Final Goal Review

Open `docs/projects/<project>/README.md`. For each success criterion, show:
- (a) the criterion text from the plan doc
- (b) concrete evidence (command output, file contents, or diff) proving it's met

autopilot-specific criteria usually fall into: file existence, grep hit count, version sync grep empty, CHANGELOG entry content.

### L-5.2 Pre-Merge Review

Invoke `autopilot:quality-pipeline`. Up to 3 fix-review rounds allowed. Dispatch to `autopilot:reviewer` (primary) or `superpowers:code-reviewer` (fallback if reviewer not yet loaded in session).

### L-5.3 Merge to develop

```bash
git checkout develop
git merge --no-ff feat/v<X.Y.Z>-<feature-name>
```

Output evidence: `git log -1 --format="%H %s"` showing the merge commit.

### L-5.4 Post-Merge Review

Re-read critical files on develop (pick 1-3 highest-risk files that were changed) to verify merge didn't silently drop changes. Output: grep confirming each expected change lands on develop.

### L-5.5 Archive project

**autopilot convention** (2026-04-12 onwards):

1. `mv docs/projects/YYYY-MM-DD-<name>/ docs/projects/_archive/YYYY-MM-DD-<name>/`
2. Update `docs/projects/INDEX.md`: remove row from 進行中 table, add to 已完成 table with merge commit hash and date
3. Commit with message `docs(archive): <project-name> — shipped in v<X.Y.Z>`
4. Plan doc stays in `docs/plans/` (not moved) — update its `狀態` field to `✅ Shipped in v<X.Y.Z> — merged as <commit>`

**Pre-2026-04-12 ships** (`think-tank-dialectic` v2.2.0, `skill-description-optimization`, v2.3.0 L-1.6 routing) did NOT follow this convention because `docs/projects/` did not exist yet. Those are historical debt, intentionally not retrofitted. See `docs/projects/INDEX.md` § 歷史債.

### L-5.6 L Session End

Run dev-flow Session End L-Full checklist. autopilot-specific adaptations:
- Staging verify → N/A (plugin, no staging)
- Knowledge extraction → record to the user's cross-session memory (not autopilot's own `.claude/`, which is gitignored)
- Deferred items → into the next plan's `Background` section (autopilot has no BACKLOG.md)
- Docs sync check → `docs/projects/INDEX.md` + CHANGELOG + README skill/agent count badges

## Per-phase quality pipeline (preserved)

Like TWGameServer, autopilot's per-phase quality pipeline at each Phase advance gate is NOT optional. `autopilot:quality-pipeline` must run at every phase, not only at L-5.2. L-5.2 is the FINAL review, not the only one.

## Known pitfalls (from the v2.4.0 methodology-agents ship, 2026-04-12)

- **Cross-repo CWD injection**: when the session CWD is TWGameServer but work targets autopilot, dev-flow / quality-pipeline / finish-flow will inject TWGameServer's config by default. This file exists precisely to prevent that — but if the session is started BEFORE this file existed, restart the session inside autopilot repo.
- **Do not create project dir only at L-5**: L-1 is where project dir creation belongs. Creating it retroactively at L-5.5 is theatrical — the tracking value of a project README lives during execution.
- **Historical L-ships missing project dirs**: v2.2.0 and v2.3.0 do not have project dirs under `docs/projects/`. Do NOT retrofit — documented in INDEX.md 歷史債 section.
- **Plugin agent list snapshot at session start**: new agents added mid-session (dev-mode install) are not dispatchable in the same session. Plan Phase 5 runtime dogfood is always deferred to the next session.

## CEO mode

All finish-flow sub-tasks are within CEO DOA (tactical, reversible, local git ops). CEO executes autonomously without user approval between sub-tasks, and reports at the end.
