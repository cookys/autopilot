# Original wording of rules summarised in the root CLAUDE.md

This is the historical original text, kept for provenance; where it differs from the root or a subdirectory CLAUDE.md or AGENTS.md, the latter wins.

這是供溯源用的歷史原文；與根目錄或子目錄的 CLAUDE.md／AGENTS.md 有出入時，以後者為準。

BL-0383 shortened the root `CLAUDE.md` to under 10 KB. Each line in the code block is the original, unshortened text of a rule the root file now states in fewer words, byte for byte as in commit f8180c376 (including relative link targets, which were written for the repo root and do not resolve from this directory). This directory is `_archive`, so the doc-drift link check does not follow them.

```text
For Claude Code sessions working **on** the autopilot plugin itself. Skill-runtime conventions live in each skill's `SKILL.md`; this file covers cross-cutting things a session needs at entry.

For **non-Claude-Code** agents (OpenCode, Codex, Antigravity, …), see [`AGENTS.md`](AGENTS.md) for the agents.md-spec readme that applies to any agent. For cross-platform portability details (what each platform actually supports vs. what's unverified), see [`references/multi-agent-portability.md`](references/multi-agent-portability.md).

## Coexistence with superpowers

Autopilot is standalone-capable. When `superpowers` is installed, orchestrators (`ceo-agent`, `finish-flow`, `quality-pipeline`, `think-tank*`, `dev-flow`) consult `.claude/dispatch-config.md` to decide which methodology / reviewer / parallel dispatcher to delegate to. Defaults in [`project-config-template/dispatch-config.md`](project-config-template/dispatch-config.md). Per-scenario UX in [`docs/guide/coexistence.md`](docs/guide/coexistence.md).

## Mission graph verification (campaign convention)

In a Mission graph, each node's `verification_commands` hold only fast, fixed checks — never `bash hooks/tests/run.sh`. `scaffold-mission` appends `node scripts/affected-suites.js --run --files` for the node's `--required-change-path` entries by default, and `--no-affected-suites` turns that default off. The whole suite runs once, alone, on this host before a campaign merges into `develop`; red means no merge. The suite blocks neither a node nor campaign close, only the merge. Sealed graphs keep their existing chain (editing one breaks its pinned digest); history: git log -- docs/backlog/hooks-tests-run-sh-is-red-on-develop-sealed-campaign-verify-cmd-is-unsatisfiable.md.
```

## Group index

- **Dispatch rails**: `dispatch-hetero.sh` `dispatch-review.sh` `dispatch-author.sh` `dispatch-foreman.sh` `dispatch-consult.sh`
- **Routing & config resolution**: `resolve-dispatch.sh` `resolve-endpoint.sh` `resolve-qc-gate.sh` `resolve-execution-profile.js`
- **Worktree, mission & session state**: `reap-dispatch-worktrees.sh` `scaffold-mission.js` `next-pick.js` `stage-advance.js`
- **Engine capability & qualification**: `engine-scorecard.js` `engine-qualify.sh` `probe-engine-capability.sh`
- **Diff scanning, verification & review**: `completeness-scan.sh` `secret-scan-diff.js` `check-test-integrity.sh` `verify-red-green.sh` `adjudicate-findings.js`
- **Sync, drift & release gates**: `sync-all.sh` `sync-version.js` `validate.sh` `preflight-release.sh` `check-hook-inventory.js`
- **Setup & install**: `dev-setup.sh` `install-hooks.sh` `project-detect.js` `scaffold-config.js`
- **Skills tooling & shared primitives**: `cost-digest.js` `lib/json-emit.sh` `lib/jsonl-store.js` `lib/config-path.js`

## Where context lives

| Topic | File |
|-------|------|
| Skill execution rules | `skills/<name>/SKILL.md` |
| Methodology agent prompts | `agents/{reviewer,debugger,planner}.md` |
| Engine CLI / orchestration layer | `bin/autopilot.js`, `src/engine/`, `src/runners/` |
| Cross-skill references | `references/{blind-dispatch,model-routing}.md` |
| Project tracking | `docs/projects/` (active + `_archive/`) |
| Backlog | `project/backlog/BACKLOG.md` |
| Plans | `docs/plans/` (`project/projects/INDEX.md`, `references/plan-template.md`) |
| Architecture decisions | `docs/dev/adr/` |
| Release notes | `CHANGELOG.md` |
| Per-session gotchas | `~/.claude/projects/-home-cookys-projects-autopilot/memory/` |
| Dogfood / coexistence knowledge | `.claude/knowledge/` — read `INDEX.md` first (`references/knowledge-routing.md`) |
| Directory rules | `{scripts,skills,references,platforms,mods}/CLAUDE.md` |

## What this repo is

Standalone lifecycle orchestration plugin: 31 skills, 3 methodology agents, 55 hooks (36 default-on,
19 opt-in). Optional integrations and coexistence rules: [`docs/guide/coexistence.md`](docs/guide/coexistence.md).


## Skill evolution rules (full text: `skills/CLAUDE.md`)

- Boy-scout: any touch of a skill trims it toward contract-card shape ([`references/skill-contract-card.md`](references/skill-contract-card.md)).
- Scorecard-first: rewriting or deleting a skill needs prior eval ON/OFF evidence.
- Mechanism vs guidance: making a stated gate block needs no eval; changing its demands does (ship as two commits, never mixed).

## Severity vocabulary

Unified across all skills and agents:

```
🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion
```

If you see "Important" anywhere in a severity context, that's a leftover from the old vocabulary — fix it. The dialectic skills (`think-tank`, `think-tank-dialectic`) use a separate **risk** tagging vocabulary (`critical / important / minor`, lowercase) which is intentionally distinct.


## Reply preference

Inherit from `~/.claude/CLAUDE.md` (Traditional Chinese, terse decisions like `go`/`A`/`1` accepted). For docs and code, English unless content is user-facing localization.

## Script guidance

- Some scripts do not parse argv at all, and a few of those are installers that act immediately, so `--help` runs them: read the header comment of an unfamiliar script first.
- A new script is dead code until wired into the reference doc, the SKILL.md table, `docs/scripts-inventory.md` and the name list in `scripts/CLAUDE.md`.
- A script that parses JSON or could run under agy is Node built-ins only; bash only for pure git glue (table in `scripts/CLAUDE.md`).
- A script existing is not evidence it is running: when one is meant to protect something, check that it actually fires; read [`references/evidence-discipline.md`](references/evidence-discipline.md) before recording anything as verified.

## Additional process guidance

- With `superpowers` installed, orchestrators consult `.claude/dispatch-config.md` (defaults: [`project-config-template/dispatch-config.md`](project-config-template/dispatch-config.md)).
- A dispatch brief that relies on rules in a subdirectory must say "read <subdir>/AGENTS.md first".
