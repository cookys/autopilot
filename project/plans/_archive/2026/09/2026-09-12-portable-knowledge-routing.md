# Portable knowledge routing — make the durable-content sinks resolve per project

**Status**: planned, 2026-09-12
**Prior art**: `d428a4a7` (handoff step 2.5 + knowledge-routing §3.1) — correct, and autopilot-only.

## The problem

`references/knowledge-routing.md` §3 and `skills/learn/SKILL.md` name **autopilot's own layout**
as literal paths: `.claude/knowledge/`, `references/`, `docs/BACKLOG.md`,
`~/.claude/projects/<slug>/memory/`. Two of those do not exist in a consuming project, and one
carries a write contract (`git add -f`) that is a fact about *this* repo's `.gitignore`, not a
general one:

| Path named in the docs | In a consuming project |
|---|---|
| `.claude/knowledge/` | Plausible — the plugin creates `.claude/`. But whether it is gitignored is that repo's choice, and the `git add -f` step is wrong where it is not. |
| `references/` | **Does not exist.** It is autopilot's own skill-reference directory. A consuming project has no "other skills" of its own to bind. |
| `docs/BACKLOG.md` | May be `doc/`, may be elsewhere, may not exist. `project-detect.js` already answers this. |
| `~/.claude/projects/<slug>/memory/` | Correct and portable — it is the harness's, not the repo's. |

So an agent in a consuming project, told by `handoff` step 2.5 to "route per §3", is being handed
this repo's furniture. It will either invent a path or write nothing.

## The shape

Every other per-project policy in this plugin is a `project-config-template/*-config.md` plus a
`scripts/resolve-*.sh` on the 4-tier ladder (`scripts/lib/resolve-config.sh`). Knowledge routing
is the one policy that is prose with paths baked in. Make it conform.

The sinks become **roles**; the paths come from the resolver:

| Role | Default in a consuming project | Why |
|---|---|---|
| `memory_dir` | `~/.claude/projects/<slug>/memory/` | Harness-owned; already portable. |
| `knowledge_dir` | `.claude/knowledge/` | Promotion step is conditional on `git check-ignore`, not assumed. |
| `discipline_target` | **`CLAUDE.md`** | A rule future sessions must follow is exactly what that file is for. `references/` is autopilot's analogue, not the general one. |
| `backlog_path` | `project-detect.js` → `project_paths.backlog` | The script already owns it. |
| `plans_dir` | `project-detect.js` → `project_paths.plans_dir` | Same. |

## Deliverables

1. `project-config-template/knowledge-routing-config.md` — the five roles, fail-closed defaults.
2. `scripts/resolve-knowledge-routing.sh` — mirrors `resolve-qc-gate.sh`: 4-tier ladder, JSON out,
   `--field`. Delegates `backlog_path` / `plans_dir` to `project-detect.js` rather than re-deriving,
   and emits `knowledge_gitignored` from a real `git check-ignore` rather than assuming.
3. `references/knowledge-routing.md` §3 — sinks stated as roles; the `references/` row and the
   `git add -f` promotion move under an explicit "when this repo is autopilot itself" note.
4. `skills/handoff/SKILL.md` (2.5, 3.5) and `skills/learn/SKILL.md` — call the resolver; no literal
   paths. Drop `[[slug]]` from 2.5 (that is autopilot memory syntax, not general).
5. `hooks/tests/resolve-knowledge-routing.test.sh`.

## The test that matters

Ladder tier 3 is `$REPO_ROOT/.claude/<basename>`, and `REPO_ROOT` is the **plugin's** root. From a
source checkout that is autopilot's own dogfood config, which would leak this repo's layout into a
consuming project — the exact defect this plan exists to remove. Required red-first case:

> a consuming-project cwd with no config of its own resolves to **template** defaults, not to
> autopilot's `.claude/`, and `discipline_target` comes back `CLAUDE.md`, not `references/`.

Verify against the cache-installed plugin (`~/.claude/plugins/cache/autopilot/`), not only the
source checkout, since the two have different `REPO_ROOT` contents.

## Not in scope

`onboard` scaffolding the config from `project-detect.js`. Tier 4 already works without it; doing
it here would mix a new policy surface with an onboarding change. Follow-up.

## Bump

PATCH — new script, new reference config, no new skill or agent.
