# Autopilot — Cross-Repository Configuration

> Part of [Autopilot](../README.md). Detail docs: [Skills](skills.md) · [Coexistence](coexistence.md) · [Configuration](configuration.md) · [Installation](installation.md) · [Architecture](architecture.md) · [Hooks](../hooks/README.md)

Skills work out of the box. For project-specific behavior, drop a markdown file into your project's `.claude/` directory — this page explains the injection mechanism, the available config files, and team setup. Machine-level settings (`~/.autopilot/config.json`, `AUTOPILOT_*` environment variables, the Claude Code compaction settings) are in the [settings reference](settings-reference.md).

---

## Cross-Repository Configuration (Injection)

Skills work out of the box with sensible defaults. For project-specific behavior, drop a markdown file into your project's `.claude/` directory — the skill reads it at invocation time via Claude Code's `!`command`` preprocessor.

### How Injection Works

```
┌─────────────────────────────────┐
│  Plugin (shared, read-only)     │   Autopilot skills live here.
│  ~/.claude/plugins/cache/       │   Same for all projects.
│  autopilot/skills/dev-flow/     │
│           └── SKILL.md ─────────┼──┐
└─────────────────────────────────┘  │
                                     │  At invocation, SKILL.md runs:
                                     │  !`cat .claude/dev-flow-config.md`
                                     │
┌─────────────────────────────────┐  │
│  Your Project (per-repo)        │  │
│  my-project/.claude/            │◄─┘  Reads from YOUR project's
│    ├── dev-flow-config.md       │     .claude/ directory
│    ├── quality-gate-config.md   │
│    ├── skill-routing.md         │     These files are plain markdown.
│    └── team-config.md           │     No schema. No YAML. Natural language.
└─────────────────────────────────┘
```

The `!`command`` syntax is a Claude Code preprocessor — it runs a shell command and inlines the output into the skill body *before* the LLM sees it. This means:

- **No config file?** Silent pass-through — the skill works normally without extra noise. Zero friction.
- **Config is natural language.** A markdown file is more expressive than YAML — you can write rules, exceptions, and rationale in prose.
- **Config is project-local.** Each repo has its own `.claude/` directory. The same autopilot plugin adapts to a C++ game server, a React app, or a Rust CLI — all through different config files.
- **Session rules inject config for ALL activities.** dev-flow sets rules like "when debugging, read `.claude/debug-config.md`" — so even Superpowers' debugging skill gets your project context.

### Available Config Files

| Config File | Customizes | Template |
|-------------|-----------|----------|
| `.claude/dev-flow-config.md` | Size rules, quality gates, build commands, special rules | [template](../project-config-template/dev-flow-config.md) |
| `.claude/finish-flow-config.md` | `finish` node closing-sequence overrides (merge target, archive proc, per-size quality gate) | [template](../project-config-template/finish-flow-config.md) |
| `.claude/quality-gate-config.md` | Test, scan, and review commands | [template](../project-config-template/quality-gate-config.md) |
| `.claude/project-lifecycle-config.md` | Project paths, bootstrap/archive scripts | [template](../project-config-template/project-lifecycle-config.md) |
| `.claude/next-config.md` | Work source paths for the next skill | [template](../project-config-template/next-config.md) |
| `.claude/team-config.md` | Team role templates for your tech stack | [template](../project-config-template/team-config.md) |
| `.claude/test-strategy-config.md` | Test commands, pyramid ratios, coverage thresholds | [template](../project-config-template/test-strategy-config.md) |
| `.claude/debug-config.md` | Project-specific debug tools and log paths | [template](../project-config-template/debug-config.md) |
| `.claude/profiling-config.md` | Profiling tools and metrics collection | [template](../project-config-template/profiling-config.md) |
| `.claude/skill-routing.md` | Map keywords to your project's domain skills | [template](../project-config-template/skill-routing.md) |
| `.claude/model-routing-config.md` | Subagent model/mode per role (planner, reviewer, etc.) | [template](../project-config-template/model-routing-config.md) |
| `.claude/owner-kernel-governance.json` | Project governance: mission-convergence enforcement + budgets, guidance defaults, red lines, rosters (filename is historical; the file is a live mission/campaign input) | [template](../project-config-template/governance-config.md) · [dogfood example](../.claude/owner-kernel-governance.json) |
| `.claude/loop.md` | Default prompt for a bare `/loop` — unattended babysit of the current branch (CI/PR tending → `next`/`debug`/`quality-pipeline`). Claude Code only (v2.1.72+); degrades cleanly elsewhere. | [template](../project-config-template/loop.md) |

### Live TUI language (`ui.locale`)

The `live` mod (the band above the prompt and its panel, Claude Code only) speaks English or Traditional Chinese (zh-TW). The language is chosen on every tick, so a change takes effect without a reload:

1. `~/.autopilot/config.json` → `{"ui": {"locale": "en" | "zh-TW" | "auto"}}` (default `auto`), the highest priority.
2. The `AUTOPILOT_LOCALE` environment variable (`en` | `zh-TW`), for one-offs and tests.
3. `auto` follows Claude Code's own language setting (the `language` row of `/config`, else `language` in `~/.claude/settings.json`): a value naming a Traditional-Chinese / 台灣 / zh-TW variant is zh-TW, anything else is English.
4. Last, `LC_ALL` / `LANG` (`zh_TW*` is zh-TW), then English.

The string tables are `mods/live/locales/en.json` (source of truth) and `zh-TW.json`; `node mods/live/gen-locales.js` compiles them into `locales.ts` and `--check` verifies both tables carry the same ids and placeholders.

### File and diff viewer (`show` tool, `/show`)

The `viewer` mod (Claude Code only, the second module of the same plugin; code in `mods/viewer/`, composed with `live` by `mods/register.ts`) shows a file or a git diff to the owner in a window without the text passing through the model.

* **The `show` tool** (`mcp__autopilot__show`, schema in the prompt): `path` (optional `start` / `end`, 1-based) or `diff` (the arguments after `git diff`, one string each, run by argument vector with `--no-ext-diff --no-textconv`; options that write a file or run a program are refused). The model gets one line back (`Shown to the user: <path> lines a-b of N ...`); the text goes only to the window. A binary file, a file over 4 MiB, a directory or a missing file answers with the reason and no text.
* **The window**: the path on its first line, line numbers, syntax colour by file extension, a unified diff drawn as a diff. Arrow keys, PgUp, PgDn, Home and End scroll; Esc closes it and hands the keyboard back (and the live panel shows again). A file over 2000 lines or 80000 characters is shown in parts with next / previous buttons.
* **`/show <path>[:line]`, `/show diff <git diff arguments>`, `/show`** (the last window again): the owner's own open. It answers no text, so nothing reaches the model; a failure is a toast. This is also the way in when the model asked for a window and the terminal was too narrow for the engine to place it unasked (under 144 columns, 110 once you have opened it by hand): the tool tells the model and a toast tells you to type `/show`.
* **In the live panel**: a file path written in a decision card's text (`docs/plans/x.md`, `mods/live/ui.ts:120`) and the last line of a background command's output are pressable and open the same window (a `path:line` from two lines above that line, the output file from its last 40 lines).
* **Three buttons**, drawn as `[ 摘要 ]  [ 問一句 ]  [ 送進對話 ]  [ 只看原文 ]` (`[ label ]` in the `action` colour, one fixed row under the line counts; the part buttons `[ 上一段 ]  [ 下一段 ]` sit on the counts line; a button that cannot be pressed now is dim with no press id; keyboard: Tab moves the focus ring through the pressable buttons, Enter presses, and the arrow keys, PgUp, PgDn, Home and End keep scrolling the text): summary, ask, send into the conversation, and hide or show the answer. The mod calls haiku itself (`$.model.complete`, model alias `haiku`, no tools, no history), so the file or diff text never passes through the main model, and the `show` tool's answer stays the one line above. The summary and the answer are drawn at the top of the window with the token count of that call. **Summary** reads the whole file (or the whole diff), not only the part on screen; a text over 150000 characters is cut at a line end and the window says "only the first N of M lines were read" (one cut call, not a split-and-merge, so a long file costs one bounded call). **Ask** (the button moves the keyboard to the field, Enter sends; the keyboard returns to the buttons) sends your question with the content. The prompt tells the small model that the content between the markers is data, never instructions, to use only that content and to say it does not know otherwise; the markers carry a nonce taken from the content's own hash so the content cannot close its own fence. Answers are saved in memory by a hash of (model, language, kind, question, subject, content): the same content asked the same way is not asked again (the window says it reused the saved answer); nothing is written to disk. The summary button becomes `[ 取消 ]` while a call runs; pressing it cancels (`Cancelled`); a failure shows its reason and is never retried by itself. **Send into the conversation** puts the shown text in the prompt box, headed by where it came from (`[檢視摘要] src/hello.ts 第 1–163 行：`), with `prompt.fill`; it never submits, so only what you press Enter on reaches the main model. Before there is a summary or answer, `[ 送進對話 ]` is dim and cannot be pressed. No setting keys: the model and the limit are constants in `mods/viewer/model.ts`.
* Words follow the live mod's language rule (`ui.locale`, above). Tests: `bash mods/viewer/run-tests.sh` (and `bash mods/live/run-tests.sh`, which also covers the pressable paths). Spike evidence: `docs/plans/evidence/2026-10-17-viewer/README.md`.

### Project governance (`owner-kernel-governance.json`)

The decision/acceptance state machine that once consumed this file was retired on 2026-08-16
(`docs/plans/_archive/2026/08/2026-08-16-owner-kernel-retirement.md`); the file itself stays **live** — its
consumers, field semantics, and a worked example are documented in
[the governance-config template](../project-config-template/governance-config.md). The
operationally decisive section is `mission_convergence` (enforcement mode + budgets, read by
`mission-routing-admission.js`; a missing file silently resolves enforcement to `off`).

`governance.guidance_profile` accepts `guided`, `adaptive`, or `autonomous`; omitting it is the
compatibility-safe `guided` default. A task intake may override guidance for that run without
modifying the project JSON; every effective profile preserves the same red lines, effects,
egress, assurance, and acceptance floor. Project red lines remain active for every `/l3`-`/l6`
level; `-x` can add a run-specific red line but cannot remove a project rule.

### Example: C++ Game Server Config

```markdown
# Dev Flow — TWGameServer Config

## Size Rules
- **S**: single module, no interface change → direct commit
- **L**: 3+ modules, public interface, Feature Flag → plan + project + PR

## Quality Gate
- S: `node .claude/scripts/quality-pipeline.js --size S`
- L: `node .claude/scripts/quality-pipeline.js --size L` per phase

## Build & Deploy
- Build: `../deploy/scripts/dev.sh build`
- Build+Restart: `../deploy/scripts/dev.sh br`

## Special Rules
- Commit 前必須跑 E2E if 改了遊戲邏輯
- Proto 改動要重編譯 SDK
```

### Example: Skill Routing

```markdown
# Skill Routing

| Keyword | Invoke |
|---------|--------|
| MJ / mahjong | `twgs-game-dev` → references/mj.md |
| crash / core dump | `twgs-debug` |
| proto / protobuf | `twgs-protobuf` |
| stress / 10K | `twgs-stress-test` |
```

This lets autopilot's `dev-flow` automatically invoke your project's domain-specific skills when it encounters relevant keywords — bridging the generic workflow layer with project-specific knowledge.

---

## Team Setup

Add to your project's `.claude/settings.json` so team members get prompted to install:

```jsonc
{
  "extraKnownMarketplaces": {
    "autopilot": {
      "source": { "source": "github", "repo": "cookys/autopilot" }
    }
  }
}
```
