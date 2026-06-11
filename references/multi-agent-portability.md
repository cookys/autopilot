# Multi-Agent Portability — Verified Facts

How autopilot's skills, agents, and hooks map onto the various coding-agent platforms that share overlapping conventions. **Every claim below has a source URL, an empirical-verification note, or is explicitly marked as unverified.** Past lesson (cuts both ways): a previous version of this doc fabricated env vars and CLI subcommands; the *correction* of that version then over-corrected — it labelled `agy plugin validate` and the root-`plugin.json` requirement as "fabricated," but installing real `agy` 1.0.1 (2026-05-29) showed both are genuine. Assert only what you've run or cited.

Last verified: 2026-06-11 (agy headless dispatch empirical against `agy` 1.0.5; earlier Antigravity facts against 1.0.1; OpenCode against 1.15.10).

---

## 1. Platform Comparison

| Dimension | Claude Code | OpenCode | Codex (OpenAI) | Antigravity (`agy`) |
|---|---|---|---|---|
| Plugin manifest | `.claude-plugin/plugin.json` ([docs](https://code.claude.com/docs/en/plugins-reference)) | `opencode.json` ([docs](https://opencode.ai/docs/config/)) | `~/.codex/config.toml` ([docs](https://developers.openai.com/codex/config-reference)) | **root `plugin.json`** for `agy plugin validate`; `.claude-plugin/plugin.json` for `agy plugin install` (detects `source: claude-code`). Verified empirically agy 1.0.1 — agy natively imports Claude Code plugins, no `gemini-extension.json` needed. |
| Skill format | `SKILL.md` with YAML frontmatter (`name`, `description`) | same SKILL.md format ([docs](https://opencode.ai/docs/skills/)) | same SKILL.md format ([docs](https://developers.openai.com/codex/skills)) | same SKILL.md format ([docs](https://antigravity.google/docs/skills)) |
| Skill discovery paths | `<plugin>/skills/`, `.claude/skills/` | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`, `~/.config/opencode/skills/`, `~/.claude/skills/` ([docs](https://opencode.ai/docs/skills/)) | `<repo>/.agents/skills/`, `~/.agents/skills/`, `/etc/codex/skills/`, bundled ([docs](https://developers.openai.com/codex/skills)) | imported via `agy plugin install <repo>` (registry, not a scan path). `agy plugin validate <repo>` reads `skills/` by convention. The codelabs `~/.gemini/antigravity/skills/` path is NOT the plugin mechanism — superseded by empirical agy 1.0.1 testing. |
| Plugin code | bash/JS hooks invoked by Claude Code via `hooks.json` | in-process TypeScript module exporting hooks ([docs](https://opencode.ai/docs/plugins/)) | MCP servers via `[plugins.<n>.mcp_servers.<s>]` in config.toml | imports Claude Code plugins directly (`source: claude-code`); reuses `hooks/hooks.json` + `skills/` + `agents/` |
| Plugin env vars | `CLAUDE_PLUGIN_ROOT` (in hook commands; [issue #27145](https://github.com/anthropics/claude-code/issues/27145)) | none injected; plugins receive `{ project, client, $, directory, worktree }` as context argument ([docs](https://opencode.ai/docs/plugins/)) | `CODEX_HOME` (defaults to `~/.codex/`); **no** `CODEX_PLUGIN_ROOT` | unverified — `agy plugin validate/install` don't reveal runtime hook env injection (would need to observe a hook process spawned by agy) |
| Plugin CLI | n/a (loaded at install) | n/a (auto-discovered) | n/a | `agy plugin {validate,install,uninstall,list,enable,disable,import,link}` — verified agy 1.0.1. `validate <path>` + `install <path>` both exit `[ok]` on this repo. |
| Hook event names | `SessionStart / PreCompact / PreToolUse / PostToolUse / Stop` ([docs](https://code.claude.com/docs/en/hooks)) | `session.created / session.compacted / tool.execute.before / tool.execute.after / …` ([docs](https://opencode.ai/docs/plugins/)) | n/a (no per-event hook surface beyond MCP server lifecycle) | imports Claude Code `hooks.json`; runtime event-firing behavior unverified |

### Things explicitly NOT verified

These remain **unverified** (searched + not confirmed, OR only partially probed):

- `CODEX_PLUGIN_ROOT`, `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT`, `AGENT_PLUGIN_ROOT`, `OPENCODE_PLUGIN_ROOT` environment variables — none documented; `agy plugin validate/install` testing does not exercise runtime hook env injection, so the `agy`/`gemini` ones remain genuinely unconfirmed. **Do not use in code.**
- Whether `agy` actually fires the imported `hooks.json` hooks at runtime, and what env it injects — `agy plugin install` registers them (`components: [..., hooks]`) but firing behavior was not observed.

### Corrected — previously mislabelled as NOT verified

Empirical `agy` 1.0.1 testing (2026-05-29) overturned earlier claims in this doc:

- **`agy plugin validate <path>` EXISTS** and exits `[ok]` on this repo (16 skills / 5 agents / 25 hooks processed). The earlier "not in the subcommand list" claim came from a possibly-stale [deepwiki](https://deepwiki.com/google-antigravity/antigravity-cli/2-getting-started) source. The original PM commit's `agy plugin validate .` instruction was correct.
- **Root `plugin.json` is required by `agy plugin validate`** — removing it yields `Error: missing plugin.json`. So root `plugin.json` is NOT merely npm/GitHub metadata (as a later edit claimed) — it has a real consumer.
- `agy plugin` full subcommand set (verified): `validate, install, uninstall, list, enable, disable, import, link`.

### Verified by Spike (Phase 3, OpenCode 1.15.10)

- `__dirname` is **`undefined`** in OpenCode's Bun ESM plugin context — use `import.meta.url + fileURLToPath`.
- OpenCode `{file:../...}` cross-layer resolution **works** (caveat: a literal `{file:..}` inside a description field triggers spurious parse attempts).
- "OpenCode auto-substitutes `${CLAUDE_PLUGIN_ROOT}` in hooks" — still no evidence; OpenCode doesn't use Claude's hooks.json at all.

### Verified by Spike (agy 1.0.5 headless dispatch, 2026-06-11)

Heterogeneous outbound dispatch — Claude Code shelling out to agy via Bash — is empirically proven:

- **`agy -p` / `--print` is a full agentic loop**, not single-shot completion: one invocation created two files then ran `ls` to confirm (multi-turn tool chain, artifacts verified on disk). Functional equivalent of `claude -p`.
- **Real-phase execution verified**: Gemini 3.5 Flash (High) executed a 3-task autopilot plan (the `_bodies` relocation, merged as `a83c04a`) in a git worktree from a **six-element Task Prompt alone — no autopilot plugin installed in agy**. Pure-rename fidelity (R100), zero boundary violations, review gate found no Critical/Major.
- Flags verified: `--model "Gemini 3.5 Flash (Low|Medium|High)"` (names from `agy models`), `--dangerously-skip-permissions`, `--sandbox`, `--continue`/`--conversation`, `--print-timeout` (**default 5m** — raise for real phases).
- **Differences vs `claude -p`**: no `--allowedTools`-grade granular allowlist (all-or-nothing) ⇒ **worktree isolation is mandatory** for mutation work; no `--max-turns` / `--output-format json` equivalent observed ⇒ verify by artifacts (files / `git diff`), never by the agent's self-report (observed failure: it skipped printing the requested commit hash while claiming success).
- **Verdict stays at depth 0**: the shelled-out agent implements; the dispatching Claude Code session reviews the diff (quality-pipeline) before merge — same invariant as `references/blind-dispatch.md` § Nested dispatch.
- **Skills do NOT load in `-p` mode** (verified negative, 2026-06-11): with autopilot installed via `agy plugin install` (19 skills + 4 agents copied to `~/.gemini/config/plugins/autopilot/`), a `-p` probe from two different cwds reports "NO SKILLS LOADED", and the `-p` tool inventory contains no skill mechanism. Methodology must travel inside the prompt (see `references/hetero-dispatch.md` — "the contract is the prompt" is a necessity, not a preference). Interactive-mode skill loading remains untested.
- Bonus finding: `-p` tool inventory includes `define_subagent` / `invoke_subagent` / `manage_subagents` — agy headless has its own subagent dispatch surface (semantics unprobed).
- Install gotcha: re-installing over a previous install fails with `permission denied` on read-only `.git` objects in `~/.gemini/config/plugins/autopilot/` (the installer copies the whole repo including `.git`). Fix: `agy plugin uninstall autopilot && rm -rf ~/.gemini/config/plugins/autopilot`, then install.

---

## 2. Key Insight: `.agents/skills/` is the cross-platform intersection

OpenCode, Codex, and Antigravity workspace skill discovery all scan `.agents/skills/`. autopilot exploits this by making `.agents/skills/` a symlink to `../skills/` (added in Phase 4 of the v2.7.3 plan). Result: one source-of-truth directory (`skills/`) feeds three platforms without copy duplication.

Note plural: `.agents/` (not `.agent/`). Earlier docs got this wrong.

Claude Code uses `<plugin>/skills/` directly (no `.agents/skills/` indirection needed).

---

## 3. SKILL.md as the de facto standard

All four platforms read the same SKILL.md frontmatter shape:

```yaml
---
name: skill-name                  # lowercase-kebab; matches enclosing directory
description: |
  One-sentence trigger guide. Use when: "phrase A", "phrase B".
  Not for: adjacent use cases.
---

# Skill Name

Body markdown — instructions consumed as agent context.
```

Per-platform extensions exist (e.g. Claude Code accepts a `tools:` allowlist; OpenCode accepts `compatibility:` for explicit platform tagging) but unknown fields are tolerated by each parser. **Cross-platform skills should keep frontmatter minimal**: `name` + `description` only.

> **`distill` is Claude-Code-function-specific** (v2.9.0). Its SKILL.md text is portable, but its function depends on Claude-Code-only mechanisms — reading `~/.claude/projects/*/*.jsonl` transcripts and writing the `autopilot-distill-skills@skills-dir` plugin pack + personal `~/.claude/skills/`. On other agents it has no transcript source / pack mechanism and is a no-op. This is intentional: autopilot stays multi-agent-portable, but `distill` deepens Claude Code specifically. Keep its `allowed-tools` (a CC extension) — it's a CC-only skill by design.

---

## 4. Manifest divergence (hard to harmonize)

Plugin manifests are partly shared, partly divergent:

- **Claude Code** reads `.claude-plugin/plugin.json` (canonical for version + description in this repo).
- **OpenCode** reads `opencode.json` (different keys: `agent`, `instructions`, `plugin`, `model`, `tools`, `permission`, …). It does not read `plugin.json`.
- **Codex** reads `~/.codex/config.toml` (TOML; per-user, not per-repo).
- **Antigravity** (`agy` 1.0.1, empirical): imports Claude Code plugins directly. `agy plugin validate <repo>` requires the **root `plugin.json`**; `agy plugin install <repo>` reads `.claude-plugin/plugin.json` and registers `source: claude-code`. No `gemini-extension.json` is needed for autopilot — that format is for native Gemini-CLI extensions, a separate path.

autopilot maintains a root `plugin.json` as a mirror of `.claude-plugin/plugin.json`. It has **two real consumers**: (1) `agy plugin validate`, which fails without it; (2) npm registry / GitHub UI metadata. `scripts/sync-version.js --check` enforces the two manifests stay aligned (pre-commit gate). Earlier versions of this doc wrongly called the root manifest "metadata only" — `agy` is a hard dependency on it.

---

## 5. Hooks are non-portable

Per-platform hook systems use different event names, different invocation models (subprocess vs in-process), and different APIs. Attempts to write "universal hook code" with env-var fallback chains create bugs (see git history of `hooks/intent-capture.js` — three rounds of fabricated env var fallback that broke runtime on every non-Claude platform).

The pragmatic split:

- **Claude Code hooks**: `hooks/*.{sh,js}` + `hooks/hooks.json` manifest. Use only `CLAUDE_PLUGIN_ROOT`; if absent, fail-quiet (return `unknown`, exit 0).
- **OpenCode hook surface**: `.opencode/plugins/autopilot.ts` (in-process TS). Use the context argument's `project` / `directory` / `worktree` for paths; do not read env vars.
- **Codex**: not implemented. The skill-sharing benefit alone (via `.agents/skills/` symlink) covers most autopilot value without a hook layer.
- **Antigravity**: `agy plugin install <repo>` registers `skills` + `agents` + `hooks` components from the Claude Code plugin. Whether agy *fires* the imported hooks at runtime (and with what env) is unverified — install only confirms registration, not execution. Install via `scripts/install-antigravity.sh` (validate → install → list).

---

## 6. Migration checklist for cross-agent changes

When touching anything that crosses platform boundaries:

- [ ] Every env var / path / CLI command referenced has an official-doc URL cited inline.
- [ ] No platform-specific code paths use env vars that haven't been verified.
- [ ] Skill changes happen only in `skills/<name>/SKILL.md` (one source of truth).
- [ ] Agent body changes happen in `agents/<role>.md` (Claude Code) and propagate via `scripts/sync-agent-bodies.sh` (Phase 3+; output: `.opencode/agent-bodies/`).
- [ ] `scripts/sync-version.js --check` passes (pre-commit gate enforces).
- [ ] If introducing a new claim about a platform, either (a) cite source, or (b) write a Spike script in `docs/plans/` that produces a yes/no answer empirically.

---

## 7. Harness primitives are Claude-Code-only (capability-gated)

Claude Code ships session-control primitives that other agents do not have: `/goal`,
`/loop`, the `Monitor` tool, and nested subagent dispatch (the `Agent` tool inside
subagent sessions). autopilot **deepens** CC by referencing these where they
add leverage, but gates each behind a "if your agent supports it" framing so non-CC agents
degrade to the manual equivalent. This mirrors the `dispatch-config.md` chain pattern: the
enhancement is optional, the fallback is always documented.

The gating is **documentation prose, not a runtime capability probe** — autopilot does not
ship a "does this agent support /goal?" detector (that would be its own project). A skill
that mentions `/goal` always states the non-CC fallback inline.

| Primitive | What it is (verified) | Source | autopilot integration | Non-CC fallback |
|---|---|---|---|---|
| `/goal` | Session-scoped completion condition; after each turn a small fast model (Haiku default) judges the condition and continues or stops. Wrapper around a **prompt-based Stop hook**. Evaluator reads the transcript only — **does not call tools**. Requires **CC v2.1.139+**. Unavailable (visibly, not silently) under `disableAllHooks` / `allowManagedHooksOnly`. | [goal docs](https://code.claude.com/docs/en/goal) | `ceo-agent` convergence primitive — drive autonomous work until OKR met (see ceo-agent SKILL.md "Harness primitives"). | Manual: re-prompt at each Stop / dev-flow decision point. |
| `/loop` | Re-runs a prompt or slash command on a time interval (or self-paced); stops when you stop it or the work is judged done. | [scheduled-tasks docs](https://code.claude.com/docs/en/scheduled-tasks#run-a-prompt-repeatedly-with-%2Floop) | `project-config-template/loop.md` — unattended babysit of `next` / `debug` / `quality-pipeline`. | Manual: re-invoke the skill each cycle. |
| `Monitor` | Tool that watches a condition / long-running process and re-invokes the agent on change. | CC tool (present in this build, `claude 2.1.161`) | `finish-flow` / `quality-pipeline` CI-polling — wait on a CI run without busy-looping. | Manual: poll `gh run watch` / re-check by hand. |
| Nested dispatch | Subagents can spawn their own subagents, max depth 5. Requires **CC v2.1.172+** ("Sub-agents can now spawn their own sub-agents (up to 5 levels deep)"). Empirically verified 2026-06-11 on 2.1.172: a subagent gets `Agent` by default (no frontmatter needed) AND an explicit `tools:` allowlist containing `Agent` is honored; children get `Agent` but not `Task`; `subagent_type: Explore` works at depth 2 and its child has no Edit/Write (but does carry `Agent` — depth caps are contract-level). Negative on v2.1.170 (grants stripped — server-side rollout). OpenCode / Codex / Antigravity: ❌ no documented equivalent (unverified-by-absence; spike before asserting otherwise). | [CC changelog v2.1.172](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) + nest-probe spikes 2026-06-11 | Handoff ENUMs stay canonical; an agent whose `tools:` includes `Agent` MAY self-consume a `PARALLEL_DISPATCH` / `SEQUENTIAL_DISPATCH` handoff. Policy (canonical statement in `agents/README.md` § Orchestration): autopilot self-caps at **depth ≤ 2**. Review-integrity rules at any depth: `references/blind-dispatch.md` § Nested dispatch. | Hand the Handoff ENUM back to the calling skill — the skill-layer round-trip in `agents/README.md` § Orchestration works on every platform. |

**`/goal` × autopilot Stop hooks — coexist, no conflict.** The official docs state "`/goal` and a
Stop hook both fire after every turn." autopilot's own Stop hooks (`cost-tracker`,
`session-summary`) are side-effect-only and never return `decision: block`, so they do not
interfere with `/goal`'s continue/stop decision. The only gate is the `disableAllHooks` /
`allowManagedHooksOnly` case above, which errors visibly. (Coexistence verified firsthand via
tool schemas + goal docs, 2026-06-02 — see the harness-integration direction memo.)

---

## 8. Related docs

- [`AGENTS.md`](../AGENTS.md) — agents.md-spec readme for any agent
- [`CLAUDE.md`](../CLAUDE.md) — Claude Code-specific conventions
- [`docs/plans/2026-05-22-multi-agent-portability-correction.md`](../docs/plans/2026-05-22-multi-agent-portability-correction.md) — the plan that produced this fact version
