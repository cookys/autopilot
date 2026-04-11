# Dev Flow — autopilot Project Config

> Self-hosting: autopilot's own `.claude/dev-flow-config.md`. Loaded when dev-flow
> runs inside the autopilot repo (CWD = autopilot root).
>
> **Historical note**: added 2026-04-12 after the v2.4.0 methodology-agents ship
> discovered that cross-repo CEO execution was injecting TWGameServer's config by
> mistake. Before this file existed, autopilot L-ships accumulated skips against
> dev-flow defaults (missing project dirs on v2.2.0 and v2.3.0). This file formalizes
> the conventions autopilot actually uses, so future sessions get correct injection
> instead of falling back to TWGameServer paths.

## Size Rules (override defaults)

- **S**: single skill edit, description tweak, markdown typo → direct commit to `develop`
- **L**: new skill / new agent / 3+ files touched / new feature / breaking change → plan + project + merge via `--no-ff`
- **Fix**: bug in an existing skill's prose (rare) → `fix/` branch, merge to `develop`
- **H**: hotfix on `main` for a published release → `hotfix/` branch, merge to `main` with `--no-ff`

**No C++ / test-suite steps exist** — autopilot is a prose-skill plugin. Forget about `cmake` / `test` / `build` injections.

## Quality Gate

autopilot has **no test suite** (prose is the product). Quality gate maps to:

- **S**: completeness scan (no TODO/stub/placeholder in modified files) + code review via reviewer agent
- **L**: completeness scan + code review per phase + final pre-merge review
- **hotfix**: completeness scan + review only

No `lint` / `tsc` / `pytest` — skip those steps when finish-flow / quality-pipeline mention them.

## Build & Deploy

- **Build**: N/A (prose)
- **Deploy**: plugin is dev-mode installed via `/plugin marketplace add <path>`; no deploy command. Restart Claude Code picks up changes.
- **Staging**: N/A

## Project Paths

- **Projects**: `docs/projects/YYYY-MM-DD-<name>/` with `README.md`
- **Project index**: `docs/projects/INDEX.md`
- **Plans**: `docs/plans/YYYY-MM-DD-<name>.md`
- **Backlog**: autopilot has no `BACKLOG.md`. Deferred items go into the originating plan's `Out of Scope` section or the next plan's `Background`. If a dedicated backlog becomes necessary, add `docs/BACKLOG.md` and update this file.

## Bootstrap (L-size)

autopilot has **no** `plan-bootstrap.js` script. Manual bootstrap steps for L-size:

```bash
# 1. Feature branch from develop
git checkout -b feat/v<X.Y.Z>-<feature-name> develop

# 2. Plan doc (if not already written)
# Write to docs/plans/YYYY-MM-DD-<feature-name>.md

# 3. Project dir (MANDATORY per dev-flow L-1)
mkdir -p docs/projects/YYYY-MM-DD-<feature-name>
# Write docs/projects/YYYY-MM-DD-<feature-name>/README.md with:
#   - Project Goal (final goal, success criteria, scope boundary)
#   - Phases (extracted from plan)
#   - Progress table
#   - Links to plan doc + commits + merge commit

# 4. Update docs/projects/INDEX.md — add row to 進行中
```

## Branch Rules

- **Default working branch**: `develop` (not `main`)
- **Release branch**: `main` — only receives `--no-ff` merges from `develop` when cutting a release
- **Branch freshness threshold**: 5 commits behind `main` (autopilot's `main` is usually far behind `develop` by design — `main` holds only tagged releases). Do not flag this as "diverged".

## Knowledge Paths

- **Knowledge files**: autopilot currently has none. If added: `.claude/knowledge/<category>.md` — `.claude/` is gitignored so this would be per-clone only. Prefer capturing autopilot-wide knowledge in the plan doc + CHANGELOG instead.
- **Memory file**: autopilot has no per-repo MEMORY.md. Cross-session learnings about autopilot development belong in the consuming user's memory system (e.g., `~/.claude/projects/<project>/memory/`).

## Pre-Work Gates

```bash
git fetch origin
git status
```

## Skip Conditions

- S-size edits to a single skill file with no behavioral change
- Documentation-only changes that do not touch skill `description:` fields (description changes can cause routing regressions — treat as L-size)

## Knowledge Extraction

Auto-record triggers for autopilot:

- A skill's behavior surprised the user 2+ times → likely the skill's description or flowchart needs adjustment
- A review loop caught an issue that passed earlier rounds → record the review-escape pattern
- A `dev-flow` / `finish-flow` / `quality-pipeline` anti-pattern was discovered → add to the relevant skill's `Anti-patterns` table

Output path: add to the originating plan doc's `Review Loop History` section + capture in CHANGELOG.

## Docs Sync (session end)

Check for staleness:

- `docs/projects/INDEX.md` — progress table reflects latest state
- `CHANGELOG.md` — unreleased changes documented
- `README.md` / `README.zh-TW.md` — skill count / agent count badges synced
- `.claude-plugin/plugin.json` + `marketplace.json` — version synced (grep old version returns empty)

## Backlog Management

No file-based backlog. Deferred items → next plan's `Background` section. If deferral is long-term (>1 month), consider whether it is actually cancelled and should be closed.

## Post-Work Commands

None. autopilot has no post-commit automation (no i18n check, no generated artifact rebuild).

## Autopilot-Specific Rules (rare)

- **Skill description changes are L-size** even if they touch one line. A description change can shift which skill Claude invokes for a given user intent — effectively a routing protocol change. Treat as L, use review loop.
- **New agent shipment requires plan + review loop**. v2.4.0 established that methodology agents need parallel-reviewer validation before shipping; do not skip this for future agents.
- **Plugin dev-mode installed plugins cache agent list at session start**. New agents added mid-session are NOT dispatchable until Claude Code restart. Plan Phase 5 (integration verification) accordingly: structural validation this session, runtime dogfood deferred to the next session.
- **Inspired By attribution is mandatory** when absorbing external OSS / prior art. L-1.5 Scope Completeness Audit already mandates this (v2.2.1 credit row).
