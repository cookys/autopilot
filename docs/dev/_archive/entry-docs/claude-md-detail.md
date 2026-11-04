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
