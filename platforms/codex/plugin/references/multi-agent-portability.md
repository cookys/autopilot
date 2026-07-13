# Multi-Agent Portability — Verified Facts

How autopilot's skills, agents, and hooks map onto the various coding-agent platforms that share overlapping conventions. **Every claim below has a source URL, an empirical-verification note, or is explicitly marked as unverified.** Past lesson (cuts both ways): a previous version of this doc fabricated env vars and CLI subcommands; the *correction* of that version then over-corrected — it labelled `agy plugin validate` and the root-`plugin.json` requirement as "fabricated," but installing real `agy` 1.0.1 (2026-05-29) showed both are genuine. Assert only what you've run or cited.

Last verified: 2026-07-02 (Codex local plugin packaging against `codex-cli 0.142.5`; Codex plugin-bundled hook docs checked 2026-07-02; P0 spikes: CC task persistence on `claude` 2.1.175 + agy judge mode on `agy` 1.0.7; agy headless dispatch empirical against `agy` 1.0.5; agy `run_command` duration + bg-job reaping against `agy` 1.0.14 (2026-07-02, see § Update below); earlier Antigravity facts against 1.0.1; OpenCode against 1.15.10).

---

## 1. Platform Comparison

| Dimension | Claude Code | OpenCode | Codex (OpenAI) | Antigravity (`agy`) |
|---|---|---|---|---|
| Plugin manifest | `.claude-plugin/plugin.json` ([docs](https://code.claude.com/docs/en/plugins-reference)) | `opencode.json` ([docs](https://opencode.ai/docs/config/)) | `.codex-plugin/plugin.json` inside a plugin package; repo-local marketplaces use `.agents/plugins/marketplace.json`. Verified empirically with `codex plugin marketplace add ./platforms/codex` on codex-cli 0.142.5. `~/.codex/config.toml` remains the per-user config surface. | **root `plugin.json`** for `agy plugin validate`; `.claude-plugin/plugin.json` for `agy plugin install` (detects `source: claude-code`). Verified empirically agy 1.0.1 — agy natively imports Claude Code plugins, no `gemini-extension.json` needed. |
| Skill format | `SKILL.md` with YAML frontmatter (`name`, `description`) | same SKILL.md format ([docs](https://opencode.ai/docs/skills/)) | same SKILL.md format ([docs](https://developers.openai.com/codex/skills)) | same SKILL.md format ([docs](https://antigravity.google/docs/skills)) |
| Skill discovery paths | `<plugin>/skills/`, `.claude/skills/` | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`, `~/.config/opencode/skills/`, `~/.claude/skills/` ([docs](https://opencode.ai/docs/skills/)) | `<repo>/.agents/skills/`, `~/.agents/skills/`, `/etc/codex/skills/`, bundled ([docs](https://developers.openai.com/codex/skills)); installed Codex plugins can also declare `skills: "./skills/"` in `.codex-plugin/plugin.json` (verified 2026-07-01). | imported via `agy plugin install <repo>` (registry, not a scan path). `agy plugin validate <repo>` reads `skills/` by convention. The codelabs `~/.gemini/antigravity/skills/` path is NOT the plugin mechanism — superseded by empirical agy 1.0.1 testing. |
| Plugin code | bash/JS hooks invoked by Claude Code via `hooks.json` | in-process TypeScript module exporting hooks ([docs](https://opencode.ai/docs/plugins/)) | Codex plugins can bundle lifecycle hooks, but Autopilot's default Codex package remains skills-only. A separate `platforms/codex/hook-probe/` package is warning-only telemetry for probing payload/cwd/env/failure semantics before any blocking hook ships. | imports Claude Code plugins directly (`source: claude-code`); reuses `hooks/hooks.json` + `skills/` + `agents/` |
| Plugin env vars | `CLAUDE_PLUGIN_ROOT` (in hook commands; [issue #27145](https://github.com/anthropics/claude-code/issues/27145)) | none injected; plugins receive `{ project, client, $, directory, worktree }` as context argument ([docs](https://opencode.ai/docs/plugins/)) | `CODEX_HOME` (defaults to `~/.codex/`); plugin hooks receive `PLUGIN_ROOT` / `PLUGIN_DATA` plus `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` compatibility vars per Codex docs; **no** `CODEX_PLUGIN_ROOT` | unverified — `agy plugin validate/install` don't reveal runtime hook env injection (would need to observe a hook process spawned by agy) |
| Plugin CLI | n/a (loaded at install) | n/a (auto-discovered) | `codex plugin {marketplace,add,list,remove}` — verified codex-cli 0.142.5. Local install flow: `codex plugin marketplace add ./platforms/codex`, then `codex plugin add autopilot@autopilot-local`. | `agy plugin {validate,install,uninstall,list,enable,disable,import,link}` — verified agy 1.0.1. `validate <path>` + `install <path>` both exit `[ok]` on this repo. |
| Hook event names | `SessionStart / PreCompact / PreToolUse / PostToolUse / Stop` ([docs](https://code.claude.com/docs/en/hooks)) | `session.created / session.compacted / tool.execute.before / tool.execute.after / …` ([docs](https://opencode.ai/docs/plugins/)) | `SessionStart / PreToolUse / PermissionRequest / PostToolUse / PreCompact / PostCompact / UserPromptSubmit / SubagentStart / SubagentStop / Stop` documented; plugin hooks require trust review before running. | imports Claude Code `hooks.json`; runtime event-firing behavior unverified |
| **Capability tier** | **full-plugin** (skills + agents + hooks load natively) | **full-plugin** (skills via `.agents/skills/`, agent bodies via `{file:..}`, plugin hooks in-process) | **adapter-tier** for skills + warning-only hook probes; no Autopilot blocking hook/gate until probe artifacts verify payload/cwd/env/failure semantics. | **instruction-tier** (skills do NOT load in `-p`; methodology must travel inside the prompt — see § agy spike; interactive-mode untested) |

### Things explicitly NOT verified

These remain **unverified** (searched + not confirmed, OR only partially probed):

- `CODEX_PLUGIN_ROOT`, `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT`, `AGENT_PLUGIN_ROOT`, `OPENCODE_PLUGIN_ROOT` environment variables — none documented; `agy plugin validate/install` testing does not exercise runtime hook env injection, so the `agy`/`gemini` ones remain genuinely unconfirmed. **Do not use in code.**
- Whether `agy` actually fires the imported `hooks.json` hooks at runtime, and what env it injects — `agy plugin install` registers them (`components: [..., hooks]`) but firing behavior was not observed.

### Corrected — previously mislabelled as NOT verified

Empirical `agy` 1.0.1 testing (2026-05-29) overturned earlier claims in this doc:

- **`agy plugin validate <path>` EXISTS** and exits `[ok]` on this repo (16 skills / 5 agents / 25 hooks processed). The earlier "not in the subcommand list" claim came from a possibly-stale [deepwiki](https://deepwiki.com/google-antigravity/antigravity-cli/2-getting-started) source. The original PM commit's `agy plugin validate .` instruction was correct.
- **Root `plugin.json` is required by `agy plugin validate`** — removing it yields `Error: missing plugin.json`. So root `plugin.json` is NOT merely npm/GitHub metadata (as a later edit claimed) — it has a real consumer.
- `agy plugin` full subcommand set (verified): `validate, install, uninstall, list, enable, disable, import, link`.

### Headless auto-approve flags — corrections (2026-06-17 survey)

The capability tier above hinges on whether a platform can run a worker non-interactively; that requires a real auto-approve flag. Two corrections from the survey, each tagged with its verification state per `[[feedback_spike-before-assert]]` — assert only what's cited or run:

- **Gemini `--yolo` / `--approval-mode=yolo` — REAL.** Present in the Gemini CLI source (`config.ts` approval-mode handling) but **omitted from the headless-mode docs**, so prior autopilot notes that only listed `--dangerously-skip-permissions` (Claude) and agy's flag were incomplete. This is the Gemini-CLI analogue of CC's `--dangerously-skip-permissions`. *Caveat (P1): like every auto-approve flag, it suppresses tool-authorization prompts only — NOT the model's own clarifying question (see [`blind-dispatch.md`](blind-dispatch.md) § "Clarifying questions survive auto-approve").*
- **`kiro-cli chat --classic` subcommand form — UNVERIFIED.** Seen referenced but not confirmed against a real `kiro-cli` run or an official doc URL. **Do not encode in code or rely on the `--classic` form** until a spike or a doc citation confirms it. Spike candidate, not a fact.

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
- ⚠ **DATA-LOSS HAZARD (mechanism CONFIRMED by sandboxed repro, 2026-06-11): `agy plugin install` does not check whether the destination `~/.gemini/config/plugins/<name>` is a symlink.** If it is a symlink pointing back at the source repo (legacy state — e.g. left by an older agy-era install or a manual link), the install becomes a **self-copy: each file is opened+truncated at "dest" (= the source itself, through the symlink), then read back empty → zero-truncated, file after file**. Repro: clone + `ln -s <clone> $HOME/.gemini/config/plugins/autopilot` + `agy plugin install <clone>` → 1497 files zeroed, `.git/HEAD` destroyed. **Re-verified on agy 1.0.7 (latest as of 2026-06-11): 1503 files zeroed — unfixed upstream.** `scripts/install-antigravity.sh` now hard-guards this (symlink check never bypassable; dirty/unpushed checks behind `--skip-git-checks`) **and installs export-then-install** (agy only ever sees a sacrificial `git archive HEAD` copy — the live repo is structurally out of reach). Raw `agy plugin install/uninstall` outside the script can be wrapped by sourcing [`scripts/agy-shell-guard.zsh`](../scripts/agy-shell-guard.zsh) in your shell rc (blocks while any symlink sits in `~/.gemini/config/plugins/`). The 2026-06-11 incident was this: a symlinked dest from the 5/29 agy-1.0.1 era; the first (failed) install truncated 55 files before dying on a read-only `.git` object (`008efd…` — same object in sandbox, walk order is deterministic); the subsequent uninstall/reinstall were innocent (all sandbox phases clean: clean install ✓, repeat install ✓, failed install over read-only dest ✓, uninstall after failure ✓). **Guards: (1) before ANY `agy plugin` operation, check `ls -la ~/.gemini/config/plugins/` for symlinks (or source `scripts/agy-shell-guard.zsh` in your shell rc to enforce this automatically on raw `agy` calls); (2) run install only via `scripts/install-antigravity.sh` (preflight + export-then-install) or from a sacrificial clone; (3) push first.**

  **Recovery recipe** (worked with zero loss on 2026-06-11 — only because everything was pushed):
  1. `echo 'ref: refs/heads/<branch>' > .git/HEAD` (restore the truncated HEAD).
  2. Rebuild `.git/config` by hand: `[remote "origin"]` url + fetch, `[branch "<branch>"]` tracking, `core.hooksPath` if the repo uses one.
  3. `rm .git/index .git/ORIG_HEAD .git/FETCH_HEAD && git reset` (rebuilds the index from HEAD; working tree untouched).
  4. Restore only the zero-byte tracked files, preserving any surviving uncommitted edits: `for f in $(git diff --name-only); do [ ! -s "$f" ] && git restore -- "$f"; done`
  5. `git fsck --no-progress` to confirm (dangling objects are normal); `git fetch` to validate the rebuilt remote config.

### Update — Verified by Spike (agy 1.0.14, 2026-07-02): the "run_command 10s cap" is REFUTED

A three-probe spike (`agy -p --dangerously-skip-permissions`, Gemini 3.5 Flash (High)) corrects a claim that had propagated into [`hetero-dispatch.md`](hetero-dispatch.md)'s engine table ("run_command 10s cap") and downstream project memory:

- **Synchronous foreground commands run to completion well past 10s.** `sleep 20` and `sleep 75` both returned full stdout (epoch deltas 20s / 75s; session wall-clock ~82s). agy auto-transitions a long command to an internal managed task and waits for it (self-narrated: "it has been transitioned to a background task (task-6). I will now wait for it to complete"). The real outer bound is **`--print-timeout`** (default 5m — raise it), **not** a per-command 10s wall.
- **What actually fails: user-managed `&`/`nohup` background jobs across *separate* `run_command` calls.** Each `run_command` is an isolated subshell whose children are reaped on exit, so "launch in bg, poll a marker file in later calls" never sees the marker (8/8 polls `NOT_YET`). You don't need that pattern — run the long task as ONE synchronous foreground command.
- **Recipe to make agy run+verify build/test/E2E**: one synchronous foreground command (no `&` / `nohup` / cross-call poll) + `--print-timeout` above the expected duration + still verify-by-artifact (self-report remains untrustworthy — Invariant 2 / the 1.0.5 "claimed success without printing the commit hash" observation stands).
- **Honest bound (not yet proven)**: only `sleep` (IO-idle) was tested, not a real CPU-bound `cargo test` with heavy stdout. The mechanism (auto-managed-task + wait) should generalise but the multi-minute real-build case is unverified. The earlier "agy only made cosmetic edits on multi-minute tasks" was most likely an older-version cap (the 1.0.5 spike era) or the model electing to background-and-abandon — not a hard 10s limit on 1.0.14.

### Verified by Spike (codex-cli 0.144.0 + gpt-5.6-sol, 2026-07-13): `spawn_agent` subagent MODEL routing

Matters to any user running autopilot **on a Codex host**: skills that say "dispatch a
subagent with model X" (role routing per `resolve-dispatch.sh`) cannot express the model
through codex's native `spawn_agent` under default config. autopilot's own dispatch scripts
(`codex exec -m <model>`) are UNAFFECTED — this is about codex-as-host interactive sessions.
Four facts, all artifact-verified (child rollout JSONL under `~/.codex/sessions/…`, matched
via `thread_spawn.parent_thread_id` — never the parent's self-report):

1. **Default schema is 3 fields** (`task_name`/`message`/`fork_turns`) — no `model`. On
   MultiAgentV2 models (gpt-5.6-sol) the trimmed schema is **server-reserved**: flipping only
   `hide_spawn_agent_metadata=false` gets every turn rejected with
   `Function 'collaboration.spawn_agent' is reserved for use by this model and must match the
   configured schema` (HTTP 400). Client side, `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
   `hide_spawn_agent_metadata_options()` removes `agent_type`/`model`/`reasoning_effort`/`service_tier`.
2. **The official custom-agent TOML path routes but does NOT switch the model** (0.144.0):
   `~/.codex/agents/<name>.toml` with `model = "gpt-5.4-mini"`, spawned via
   `task_name=<name>` → spawn accepted, profile matched, but the child rollout shows
   `"model":"gpt-5.6-sol"` — **it inherited the parent's model; the TOML `model` was ignored**
   (the openai/codex#26868 defect class is still live). Also: agent names must match
   `[a-z0-9_]` — hyphens are rejected by the tool router.
3. **Working opt-in escape (two lines, BOTH required)** in the user's `~/.codex/config.toml`:
   ```toml
   [features.multi_agent_v2]
   hide_spawn_agent_metadata = false
   tool_namespace = "agents"
   ```
   Renaming the namespace off the reserved `collaboration.*` restores the full 7-field schema,
   and a `model="gpt-5.4-mini"` child verifiably runs as gpt-5.4-mini (rollout artifact).
   Caveats: undocumented upstream, may be closed by a future codex release; failure mode is
   loud (spawn → 400). This is a **user-owned opt-in** — autopilot must never auto-edit
   `~/.codex/config.toml`. Recipe + guidance: `platforms/codex/README.md` § Subagent model routing.
4. **Re-verification probe** (one short `codex exec`): ask the model to print the exact JSON
   parameter schema of its spawn_agent tool; 3 fields = still locked, 7 fields = open.
   Upstream watch: openai/codex #31814 / #31097 / #26868 (BACKLOG'd).

---

## 2. Key Insight: `.agents/skills/` is the cross-platform intersection

OpenCode and Codex workspace skill discovery both scan `.agents/skills/`. autopilot exploits this by making `.agents/skills/` a symlink to `../skills/` (added in Phase 4 of the v2.7.3 plan). Result: one source-of-truth directory (`skills/`) feeds both platforms without copy duplication. Codex also has a skills-only plugin package at `platforms/codex/plugin`; because Codex plugin install does not copy through a symlinked skill directory, `platforms/codex/plugin/skills` is a generated real directory refreshed from the same source-of-truth by `scripts/sync-codex-plugin-skills.sh`, along with the support files that the skill text links to. **Antigravity does NOT scan a loose skills dir** — it imports the whole repo as a plugin via `agy plugin install <repo>` (see §1 table and the per-platform breakdown below); it reaches the same `skills/` source-of-truth by a different mechanism, not through `.agents/skills/`.

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
- **Codex thin-shell behavior (verified 2026-07-05, codex-cli 0.142.2, gpt-5.5)**: after `codex plugin marketplace add ./platforms/codex` + `codex plugin add autopilot@autopilot-local`, all five thin-shelled entries (l3/l4/l5/l6/think-tank-dialectic, v2.31.16 payload) surface as `autopilot:<name>` skills loaded from the plugin cache, and a wiring probe on `autopilot:l5` showed codex following the shell's MUST-READ links — artifact evidence: `cat` exec events on `skills/l5/references/hetero-impl-loop.md` + `skills/ceo-agent/references/level-front-door.md` in the transcript (relative links resolve inside the cache copy). Caveat observed: with many plugins enabled codex warns it shortens skill descriptions to fit a "2% skills context budget" — description-based routing may degrade on crowded installs. CC-side natural-behavior evidence (no-hint goals → spontaneous Reads) lives in `hooks/tests/slash-entry-natural-probe.test.sh`.
- **Codex**: skills-only package implemented under `platforms/codex/plugin`; hooks are intentionally not declared there. `platforms/codex/hook-probe/` is a separate warning-only package for collecting shape-only payload/cwd/env/failure evidence before any hook behavior is mapped; it omits raw payloads, path values, identifiers, payload key names, and tool input/output values. The skill-sharing benefit comes from either `.agents/skills/` or the Codex plugin manifest's `skills: "./skills/"`.
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
| Native task persistence (`TaskCreate`/`TaskList`) | **Session-scoped, not global** — empirically verified 2026-06-12 (CC 2.1.x): tasks persist as durable JSON (`~/.claude/tasks/<session-id>/<n>.json`, one file per task, `blocks`/`blockedBy` dependency fields, `.lock` sidecar) and survive session end; but a **fresh session's `TaskList` cannot see them** (headless probe: session A created `p0a-probe-tte-20260612` → file on disk → fresh session B `TaskList` = empty). Cross-session access exists ONLY by re-attaching to the lineage: `claude -p --resume <session-id>` saw the probe task. No global/project-scoped task list surface found (`claude --help` has `--session-id`/`--resume`/`--fork-session`, nothing task-scoped). | Spike 2026-06-12 (task-tree-engine P0a), `claude 2.1.175` | Tree engine (`scripts/tree.js`, files+bash) stays the cross-session source of truth; TaskCreate mirror is a within-session-lineage accelerator only (P6 adapter). Forcing-function TaskCreates (dev-flow L-1.x) are per-session by design — unaffected. | The tree itself IS the fallback — `docs/projects/<proj>/tree/events.jsonl` is plain files, readable by any agent. |

**Task-tree engine is platform-universal.** The tree substrate (`scripts/tree.js`,
`docs/projects/<proj>/tree/events.jsonl`) is plain files + bash + jq — readable and writable
by ANY agent. CC-specific pieces are optional accelerators only: TaskCreate mirroring
(session-lineage-scoped, see the task-persistence row above) and the `Agent`-tool dispatch
patterns. A non-CC agent participates fully via the CLI surface; the contracts live in
`references/tree-contracts.md`.

**`agy -p` judge mode — VIABLE (spike 2026-06-12, task-tree-engine P0b, agy 1.0.7).** Role prompt
(`.opencode/agent-bodies/reviewer.body.md`) + a real 112-line diff → Gemini 3.5 Flash (Medium)
produced a schema-conformant verdict JSON (`{verdict, confidence, findings[], achieved[], missed[]}`)
with sane findings, twice. Operational caveats for P4's `qc-panel.js`: (1) **stdout mode is
narration-polluted** — agentic "I will…" lines precede the JSON; extract the last JSON object or use
file-write mode; (2) **file-write mode** ("WRITE verdict to ./verdict.json, final stdout = DONE") is
the clean plumbing — but needs `--print-timeout 8m` (4m timed out once); (3) `--dangerously-skip-permissions`
is required even for read-only judging (without it, `-p` hangs silently waiting on permission) — so
judge runs go in a **throwaway dir containing ONLY the intended inputs**; the judge empirically wanders
(listed dir, read its own output file, tried git); (4) it's a full agentic loop, not a pure LLM call —
same lesson as the implementer spike. Amendment-3 fallback (two Claude sessions from independent
conversation roots) NOT needed.

<details><summary>Spike raw evidence (2026-06-12)</summary>

P0a — probe task on disk after session A exited, fresh session B sees nothing, resume sees it:

```
$ grep -rl "p0a-probe-tte-20260612" ~/.claude/tasks/
/home/cookys/.claude/tasks/6995afc6-2f09-4598-88df-61c54782c97d/1.json
$ claude -p --model haiku 'Use the TaskList tool and output its raw result verbatim...'
NO_TASKS_VISIBLE
$ claude -p --model haiku --resume 6995afc6-2f09-4598-88df-61c54782c97d '...TaskList...'
#1 [pending] p0a-probe-tte-20260612
```

P0b — file-write-mode verdict head (full JSON was jq-valid; run dir `/tmp/p0b-judge2/`, ephemeral):

```
{"verdict": "pass", "confidence": 1.0, "findings": [{"severity": "suggestion",
 "file": "scripts/install-antigravity.sh:88", ...}], "achieved": [5 items], "missed": [2 items]}
```

</details>

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
