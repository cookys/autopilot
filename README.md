<h1 align="center">Autopilot</h1>

<p align="center">
  <strong>Standalone-capable lifecycle orchestration for Claude Code that coexists with Superpowers.</strong><br>
  23 skills covering lifecycle management, strategic decisions, methodology, and quality gates.<br>
  Works standalone; gracefully delegates tactical execution to Superpowers when installed.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-2.25.12-E8A838?style=flat-square" alt="v2.25.12">
  <img src="https://img.shields.io/badge/skills-23-4A90D9?style=flat-square" alt="23 Skills">
  <img src="https://img.shields.io/badge/agents-3-7C9E8C?style=flat-square" alt="3 Methodology Agents">
  <img src="https://img.shields.io/badge/hooks-20-6B8E6B?style=flat-square" alt="20 Hooks">
  <img src="https://img.shields.io/badge/dependencies-zero-A8B5A0?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-D4A5A5?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <b>English</b> &nbsp;|&nbsp; <a href="README.zh-TW.md">正體中文</a>
</p>

---

## What Is Autopilot?

Claude Code is great at writing code. Autopilot makes it great at **running the whole job** — so you describe what you want and it handles the discipline around the code:

- **Sizes the task and plans it** — a one-line fix and a multi-module feature get different treatment, automatically.
- **Runs quality gates** — tests, completeness scan (no stubs/TODOs), and code review before anything merges.
- **Closes the loop** — finishes cleanly, archives the project, and captures the lessons for next time.
- **Adapts to your repo** — drop a markdown file in `.claude/` and the same skills speak your project's build commands, conventions, and gotchas.

It's a single Claude Code plugin — **23 skills, 3 methodology agents, 20 hooks, zero dependencies**. It works on its own, and plays nicely with the [`superpowers`](docs/coexistence.md) plugin if you have it.

> New here? This page is the 5-minute tour. Everything deeper lives in **[Learn More](#learn-more)**.

## Quick Start

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

That's it. Now **just talk to Claude** — Autopilot's skills trigger on what you say:

```
You: "I'm starting on WebSocket compression"   → sizes it, sets up a plan + branch + quality gates
You: "quick fix for the null check in auth"    → fast path, still gated before commit
You: "what should I work on next?"             → scans your projects and ranks them
You: "搞定這個重構，你決定"                       → full autonomous CEO mode
```

No commands to memorize — say it in your own words and the right skill steps in.

## What It Does

23 skills, grouped by what you're trying to do. Each one triggers from natural language — the **Try saying** lines are real triggers.

### ✍️ Build code

`dev-flow` (start here — sizes & routes the task) · `quality-pipeline` (test → scan → review) · `finish-flow` (clean closing sequence, nothing skipped).

> **Try saying:** *"let's implement X"* · *"quick fix for Y"* · *"is this ready to commit?"*

### 🧭 Make decisions

`survey` (dual-agent industry research) · `think-tank` (6-role debate) · `brainstorm` (pre-code design exploration) · `think-tank-dialectic` (irreversible, high-stakes calls).

> **Try saying:** *"what do others use for X?"* · *"should we rewrite or patch?"* · *"要辯論一下"*

### 🤖 Full autopilot

`ceo-agent` (you set the goal, it executes) · `/l3` `/l4` `/l5` (terse front-doors: inline → background foreman → heterogeneous engine).

> **Try saying:** *"CEO mode, handle it"* · *"全權處理"* · *"/l4 ship the reconnect system"*

### 📈 Improve over time

`learn` (capture lessons) · `retro` (git-history retrospective) · `next` (what to do next) · `distill` (turn your repeated workflows into personal skills) · plus `debug` · `profiling` · `test-strategy` · `audit` · `doc-sync`.

> **Try saying:** *"record this for next time"* · *"回顧這週"* · *"what's the highest priority?"*

**→ Full catalog of all 23 skills, the three cognitive modes, and how they compose: [docs/skills.md](docs/skills.md).**

## A Day With Autopilot

`dev-flow` is the front door. It sizes the task and routes it — small things go straight through the gate, large things become a tracked project:

```
 You: "Add WebSocket compression"
    │
    ▼
 dev-flow  ── sizes the task ──┐
    │                          │
    ├─ S (small) ─→ implement ─→ quality-pipeline ─→ commit
    │                          │
    └─ L (large) ─→ plan + project + branch
            │        ├─ implement phase ─→ quality-pipeline (per phase)
            │        ├─ needs research? ──→ survey
            │        ├─ strategic call?  ──→ think-tank
            │        └─ archive project + learn (capture lessons)
            ▼
        finish-flow  ── clean close, nothing skipped
```

Without Autopilot, Claude starts grep-ing the codebase immediately — no plan, no phases, no quality gates. With it, the discipline is automatic.

## Install

**Claude Code** (primary) — the two commands above. All 23 skills are available immediately as `autopilot:dev-flow`, `autopilot:survey`, etc.

### Other platforms

Autopilot is portable: **OpenCode**, **Codex**, and **Antigravity (`agy`)** discover the skills via `.agents/skills/`, and there's a Windows + pre-commit-gate setup. Full per-platform instructions, plus the contributor **dev-mode** workflow, are in **[docs/installation.md](docs/installation.md)**.

## Learn More

The deep material, moved out of this page so it stays an onboarding tour:

| Topic | Doc |
|-------|-----|
| **All 23 skills** + three modes + how they compose | [docs/skills.md](docs/skills.md) |
| **Superpowers coexistence** — three scenarios, migration | [docs/coexistence.md](docs/coexistence.md) |
| **Per-project configuration** — the `.claude/` injection model | [docs/configuration.md](docs/configuration.md) |
| **Installation & development** — every platform, dev mode | [docs/installation.md](docs/installation.md) |
| **Architecture & design** — philosophy, methodology agents, credits | [docs/architecture.md](docs/architecture.md) |
| **Hooks** — 20 runtime-enforcement hooks (8 default-on, 12 opt-in) | [hooks/README.md](hooks/README.md) |
| **Changelog** | [CHANGELOG.md](CHANGELOG.md) |

Distilled from 100+ completed projects using AI-driven development.

## License

MIT — see [LICENSE](LICENSE) for details.
