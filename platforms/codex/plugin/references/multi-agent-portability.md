# Multi-Agent Portability — Verified Facts

How autopilot's skills, agents, and hooks map onto the various coding-agent platforms that share overlapping conventions. **Every claim below has a source URL, an empirical-verification note, or is explicitly marked as unverified.** Past lesson (cuts both ways): a previous version of this doc fabricated env vars and CLI subcommands; the *correction* of that version then over-corrected — it labelled `agy plugin validate` and the root-`plugin.json` requirement as "fabricated," but installing real `agy` 1.0.1 (2026-05-29) showed both are genuine. Assert only what you've run or cited.

Last verified: 2026-08-05 (Codex 0.146.0 structured `PreToolUse` denial was retained as D1 probe evidence only; the production package registers only the existing `PostCompact` manual+auto boundary and does not ship Codex-thread-bound direct-mutation enforcement; agy native response+usage JSON on 1.1.10; Grok headless JSON usage on 0.2.118; OpenCode truncation on installed 1.17.15 and isolated 1.18.11; Claude Code driver/hook baseline on 2.1.220; earlier package and portability probes retained below).

---

## 1. Platform Comparison

| Dimension | Claude Code | OpenCode | Codex (OpenAI) | Antigravity (`agy`) |
|---|---|---|---|---|
| Plugin manifest | `.claude-plugin/plugin.json` ([docs](https://code.claude.com/docs/en/plugins-reference)) | `opencode.json` ([docs](https://opencode.ai/docs/config/)) | `.codex-plugin/plugin.json` inside a plugin package; repo-local marketplaces use `.agents/plugins/marketplace.json`. Verified empirically with `codex plugin marketplace add ./platforms/codex` on codex-cli 0.142.5. `~/.codex/config.toml` remains the per-user config surface. | **root `plugin.json`** for `agy plugin validate`; `.claude-plugin/plugin.json` for `agy plugin install` (detects `source: claude-code`). Verified empirically agy 1.0.1 — agy natively imports Claude Code plugins, no `gemini-extension.json` needed. |
| Skill format | `SKILL.md` with YAML frontmatter (`name`, `description`) | same SKILL.md format ([docs](https://opencode.ai/docs/skills/)) | same SKILL.md format ([docs](https://developers.openai.com/codex/skills)) | same SKILL.md format ([docs](https://antigravity.google/docs/skills)) |
| Skill discovery paths | `<plugin>/skills/`, `.claude/skills/` | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`, `~/.config/opencode/skills/`, `~/.claude/skills/` ([docs](https://opencode.ai/docs/skills/)) | `<repo>/.agents/skills/`, `~/.agents/skills/`, `/etc/codex/skills/`, bundled ([docs](https://developers.openai.com/codex/skills)); installed Codex plugins can also declare `skills: "./skills/"` in `.codex-plugin/plugin.json` (verified 2026-07-01). | imported via `agy plugin install <repo>` (registry, not a scan path). `agy plugin validate <repo>` reads `skills/` by convention. The codelabs `~/.gemini/antigravity/skills/` path is NOT the plugin mechanism — superseded by empirical agy 1.0.1 testing. |
| Plugin code | bash/JS hooks invoked by Claude Code via `hooks.json` | in-process TypeScript module exporting hooks ([docs](https://opencode.ai/docs/plugins/)) | Autopilot's Codex package exposes generated lifecycle skill projections plus the existing production `PostCompact` (`manual|auto`) command hook. The structured `PreToolUse` denial is retained as D1 probe evidence only; no Codex-thread-bound direct-mutation enforcement is shipped. Canonical sources live under `platforms/codex/`; generated package mirrors are byte-gated. The separate `hook-probe/` and unregistered `pre-effect.js` remain non-production evidence tooling. This does not imply Claude hook parity. | imports Claude Code plugins directly (`source: claude-code`); reuses `hooks/hooks.json` + `skills/` + `agents/` |
| Plugin env vars | `CLAUDE_PLUGIN_ROOT` (in hook commands; [issue #27145](https://github.com/anthropics/claude-code/issues/27145)) | none injected; plugins receive `{ project, client, $, directory, worktree }` as context argument ([docs](https://opencode.ai/docs/plugins/)) | `CODEX_HOME` (defaults to `~/.codex/`); plugin hooks receive `PLUGIN_ROOT` / `PLUGIN_DATA` plus `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` compatibility vars per Codex docs; **no** `CODEX_PLUGIN_ROOT` | unverified — `agy plugin validate/install` don't reveal runtime hook env injection (would need to observe a hook process spawned by agy) |
| Plugin CLI | n/a (loaded at install) | n/a (auto-discovered) | `codex plugin {marketplace,add,list,remove}` — verified through codex-cli 0.146.0. `marketplace upgrade` refreshes configured **Git** snapshots and rejects a local marketplace name. Local install flow: `codex plugin marketplace add ./platforms/codex`, then `codex plugin add autopilot@autopilot-local`. | `agy plugin {validate,install,uninstall,list,enable,disable,import,link}` — verified agy 1.0.1. `validate <path>` + `install <path>` both exit `[ok]` on this repo. |
| Hook event names | `SessionStart / PreCompact / PreToolUse / PostToolUse / Stop` ([docs](https://code.claude.com/docs/en/hooks)) | `session.created / session.compacted / tool.execute.before / tool.execute.after / …` ([docs](https://opencode.ai/docs/plugins/)) | `SessionStart / PreToolUse / PermissionRequest / PostToolUse / PreCompact / PostCompact / UserPromptSubmit / SubagentStart / SubagentStop / Stop` documented; installed production package retains `PostCompact` for both `manual` and `auto`. The `PreToolUse` structured denial is probe evidence only; plugin hooks require trust review before running. | imports Claude Code `hooks.json`; runtime event-firing behavior unverified |
| **Capability tier** | **full-plugin** (skills + agents + hooks load natively) | **full-plugin** (skills via `.agents/skills/`, agent bodies via `{file:..}`, plugin hooks in-process) | **adapter-tier** for seven generated lifecycle projections plus the production `PostCompact` recovery boundary. D1 `PreToolUse` denial is an unregistered probe; no Codex-thread-bound direct-mutation enforcement is shipped. Managed Engine admission, other Claude hooks, apps, MCP servers, and general hook parity are not claimed. | **instruction-tier** (skills do NOT load in `-p`; methodology must travel inside the prompt — see § agy spike; interactive-mode untested) |

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

### Codex native child lifecycle — verified current host (codex-cli 0.146.0, 2026-08-02)

The default `collaboration.spawn_agent` schema now exposes five fields:
`task_name`, `message`, `fork_turns`, `model`, and `reasoning_effort`. A child can therefore
receive an explicit model/effort when the caller uses a bounded history fork; a full-history
fork inherits the parent and does not accept overrides. The old 0.144 “three fields unless a
two-line opt-in rewrites the namespace” guidance is retired. This is current-host evidence,
not a promise for every older Codex installation; the committed probe rechecks the schema.

Rerun the schema, observed-child-identity, and terminal-disposition probe with:
`AUTOPILOT_CODEX_NATIVE_CHILD_PROBE=1 bash hooks/tests/codex-enforcement-probe.test.sh`.

Lifecycle remains a separate boundary. Native children are visible through Codex collaboration
list/wait/interrupt operations, but they are not shell workers: they have no process-group or
cgroup identity and are not covered by autopilot's shell reapers. Before terminal status, a
Codex controller must list its native children, wait for completed results, interrupt survivors,
and record a terminal disposition for every child. Merge-back and worktree GC still use the
ordinary Git/controller rails. If the host cannot list or interrupt native children, native
spawn is unsupported for unattended `/l4`–`/l6`; route through autopilot's dispatch scripts.

### Codex installed payload and generation lifecycle — residual probe (0.146.0, 2026-08-02)

One logged-in `codex exec --ephemeral --sandbox read-only --json` run from a disposable clean Git
repo with no `.agents/skills/` proved the installed Autopilot package end to end. Transcript tool
events read both the cached `skills/audit/SKILL.md` and its linked cached
`references/routing-tiebreaks.md`; the final audit identified the planted `beta` → `BETA` case
change and target-only `delta` line. The command exited zero and the scratch tree hash and clean
status were unchanged. This is installed-path evidence, not model self-report.

Marketplace observations must stay split by source type. A uniquely named local marketplace was
installed at generation A (0.1.0), then its source manifests and skill were changed to generation B
(0.2.0). Without reinstalling, `plugin list` remained at installed 0.1.0 and a fresh loader run read
the cached generation-A skill. Exact `codex plugin marketplace upgrade <local-name> --json` exited
1 because that name was not configured as Git. The help contract says the command refreshes Git
marketplace snapshots, but no external Git fixture was published in this bounded probe; therefore
Git snapshot refresh semantics remain **unproven**, and local behavior must not be generalized.

No native pre-discovery install/upgrade generation lifecycle was proven. The disposable plugin
manifest carried `scripts.postinstall`, `scripts.postupgrade`, `lifecycle.install`, and
`lifecycle.upgrade`, all targeting an exit-17 marker script. Codex accepted and cached those fields,
but plugin add exited zero and never invoked the script; the local marketplace upgrade was
inapplicable. The four installed curated plugin manifests inspected contained neither `scripts` nor
`lifecycle`. Unknown accepted fields and ordinary runtime hooks are not an install-time lifecycle
contract. Result: **NO-GO** for retiring committed payload mirrors; keep the mirrors and sync/drift
gates until Codex exposes an automatic, fail-loud generator point on both install and applicable Git
upgrade/refetch paths (or an officially supported equivalent proven by executable evidence).

---

## 2. Key Insight: `.agents/skills/` is the cross-platform intersection

OpenCode and Codex workspace skill discovery both scan `.agents/skills/`. autopilot exploits this by making `.agents/skills/` a symlink to `../skills/` (added in Phase 4 of the v2.7.3 plan). Result: one source-of-truth directory (`skills/`) feeds both platforms without copy duplication. Codex also has a plugin package at `platforms/codex/plugin`; because Codex plugin install does not copy through a symlinked skill directory, `platforms/codex/plugin/skills` is a generated real directory refreshed from the same source-of-truth by `scripts/sync-codex-plugin-skills.sh`, along with linked support files and the byte-mirrored production `PostCompact` hook. The retained `pre-effect.js` mirror is an unregistered probe helper, not a production boundary. **Antigravity does NOT scan a loose skills dir** — it imports the whole repo as a plugin via `agy plugin install <repo>` (see §1 table and the per-platform breakdown below); it reaches the same `skills/` source-of-truth by a different mechanism, not through `.agents/skills/`.

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

Per-platform extensions exist (e.g. Claude Code accepts a `tools:` allowlist; OpenCode accepts `compatibility:` for explicit platform tagging), but unknown-field tolerance is **not established across platforms**. A 2026-08-03 installed Claude Code + Codex plugin-load probe with a disposable `tier:` field ended `inconclusive` because the isolated execution legs could not prove that the loaded skill ran. **Cross-platform skills should therefore keep frontmatter minimal**: `name` + `description` only, unless each target platform has executable acceptance evidence for the added field.

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
- **Codex production boundary (verified 2026-08-05, codex-cli 0.146.0)**: `platforms/codex/plugin` declares generated lifecycle skill projections plus the existing `PostCompact` matcher `manual|auto`. The structured `PreToolUse` denial and its exit-17 fail-open control are retained as D1 probe evidence only; `platforms/codex/hooks/pre-effect.js` is unregistered and non-production. The production package therefore ships no Codex-thread-bound direct-mutation enforcement; D4 remains `NOT_READY/NO_SHIP`. PostCompact retains its existing fail-closed reconciliation contract. The [sanitized receipt](../docs/projects/_archive/2026-08-05-codex-native-lifecycle-enforcement/evidence/codex-pre-effect-production-live-receipt.json) records the probe evidence and no-ship verdict. `platforms/codex/hook-probe/` remains warning-only/shape-only; its one-shot driver is evidence tooling, not another production authority.
- **Strict-L5 provider boundary (implemented 2026-08-04)**: the shared CLI/Engine payload compiles one frozen six-claim policy and exact `{runner,model,role,effort,endpoint,family}` roster projection. Only ordinary `AUTOPILOT_LEVEL=l5|l6 engine implement-review` receives the branded, process-local qualification and live-probe closures; they are consumed before workflow dispatch and cannot be replaced by a platform environment variable, work order, disk receipt, or serialized callback. This is an Autopilot Engine trust boundary, not a claim that every host has equivalent hook or model-routing semantics; lower levels remain explicitly non-strict.
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
| Native task persistence (`TaskCreate`/`TaskList`) | **SUPERSEDED 2026-08-20 (CC 2.1.237): the 08-18 "runtime absence" was a MODEL-GENERATION GATE, not a runtime fact.** CC ≥2.1.233 (released 2026-08-14) disables TodoWrite+TaskCreate/Get/Update/List on Opus ≥4.8 / Sonnet ≥5 / Fable ≥5 / Mythos ≥5 behind statsig `tengu_rosy_wren` (default false; binary diff: gate absent in the 2.1.231 bundle, present in 2.1.234). The 08-18 probe ran sonnet(-5) — a gated model — so it measured the gate, not the runtime. Official opt-ins ([agent-sdk/todo-tracking](https://code.claude.com/docs/en/agent-sdk/todo-tracking)): `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` env var, or naming a task tool in `allowedTools`/`tools`; `CLAUDE_CODE_ENABLE_TASKS=0` swaps back to legacy TodoWrite. Verified 2026-08-20 A/B/C (same scratch sandbox, same frozen prompt, sonnet, 2.1.237): interactive without env → ToolSearch-backed `NO_TASK_TOOL`; interactive with env → TaskCreate fires + `tasks/<sid>/1.json` residue (blocks/blockedBy schema intact); **headless `-p` with env → TaskCreate tool_use in stream-json + the same JSON residue** — forcing-function TaskCreates ARE observable in `-p` under the env pin. Caveat: [issue #80401](https://github.com/anthropics/claude-code/issues/80401) documents a second, model-matched remote kill-switch (`tengu_vellum_ash`, cached in `~/.claude.json`) that can unregister exactly these four tools mid-session — pin the env var, never trust the server default. Evidence: `docs/plans/evidence/2026-08-20-interactive-cc-drivability-spike/`. The 2026-08-18 record follows — its observations were correct; its interpretation over-generalized. **RE-VERIFIED 2026-08-18 (CC 2.1.234): NO task tool exists in headless `claude -p` at all** — probed twice, once under `--setting-sources project --strict-mcp-config` and once under default setting sources, scratch HOME + credentials-only config dir both times. Both runs: the subject's own `ToolSearch` found no match, the model answered `NO_TASK_TOOL`, and zero `tasks/*.json` residue appeared. So this is a runtime absence, not a flag artifact and not a moved path. Evidence: `docs/plans/evidence/2026-08-18-headless-task-tool-probe/`. Anything below describing headless task creation held at 2.1.175 and does NOT hold now; treat forcing-function TaskCreates as unobservable in `-p` regardless of turn count. Original 2026-06-12 record follows. **Session-scoped, not global** — empirically verified 2026-06-12 (CC 2.1.x): tasks persist as durable JSON (`~/.claude/tasks/<session-id>/<n>.json`, one file per task, `blocks`/`blockedBy` dependency fields, `.lock` sidecar) and survive session end; but a **fresh session's `TaskList` cannot see them** (headless probe: session A created `p0a-probe-tte-20260612` → file on disk → fresh session B `TaskList` = empty). Cross-session access exists ONLY by re-attaching to the lineage: `claude -p --resume <session-id>` saw the probe task. No global/project-scoped task list surface found (`claude --help` has `--session-id`/`--resume`/`--fork-session`, nothing task-scoped). | Spike 2026-06-12 (task-tree-engine P0a), `claude 2.1.175` | Tree engine (`scripts/tree.js`, files+bash) stays the cross-session source of truth; TaskCreate mirror is a within-session-lineage accelerator only (P6 adapter). Forcing-function TaskCreates (dev-flow L-1.x) are per-session by design — unaffected. | The tree itself IS the fallback — `docs/projects/<proj>/tree/events.jsonl` is plain files, readable by any agent. |

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
