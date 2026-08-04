# Autopilot Codex Package

This directory contains the Codex packaging surface for Autopilot.

- `plugin/` is the Codex plugin root.
- `plugin/skills` is a generated projection of the repository's canonical `skills/`.
  Seven lifecycle/front-door skills receive the normative Codex adapter from
  `skill-adapters/lifecycle.md`; every other file remains byte-identical.
- `plugin/bin`, `plugin/src`, `plugin/references`, `plugin/scripts`,
  `plugin/project-config-template`, selected `plugin/docs` files, and
  `plugin/hooks/_shared` are generated support payload for skill links and
  engine CLI commands. `plugin/hooks/hooks.json`, `plugin/hooks/pre-effect.js`,
  `plugin/hooks/post-compact.js`, and the shared edit-gate core are generated
  byte-for-byte from their canonical sources. The retained `pre-effect.js` is
  an unregistered, non-production probe helper.
- `.agents/plugins/marketplace.json` is a repo-local marketplace for development.

The package manifest exposes skills plus one Codex-native production boundary:
`PostCompact` with matcher `manual|auto`. It does not ship Codex-thread-bound
direct-mutation enforcement; the retained `pre-effect.js` is unregistered and
non-production. It does not declare the Claude Code hook bundle, apps, or MCP
servers. Each wrapper translates the official Codex payload into an existing
Autopilot decision core; this is not a claim of Claude hook parity.

The generated `dev-flow`, `ceo-agent`, `l3`, `l4`, `l5`, `l6`, and `finish-flow`
copies place a Codex-native override immediately after YAML frontmatter. It maps
entry to the packaged `session-mode.js` and managed execution to the sealed
Mission/Engine path before the unchanged canonical body. It also states that
`TaskCreate`, `TaskUpdate`, `TaskStop`, native `Agent`, and `subagent_type` are
unavailable and must not be imitated with ad-hoc tickets, inline managed work,
or replacement lineages.

## Pre-effect probe status

Codex 0.146.0 proved that a structured `PreToolUse` stdout decision can block a
request-bound shell mutation in a probe. That result is retained as D1
capability evidence only: the production package does not register `PreToolUse`
and does not ship Codex-thread-bound direct-mutation enforcement. The retained
adapter returns `DEV_FLOW_ENTRY_REQUIRED` without a valid marker, preserves
`/l3` inline work, and recognizes the fixed managed Engine route in its probe
path; these are not production hook guarantees.

The same evidence also proves a separate host limitation: when the probe adapter
process exited 17 before emitting structured stdout, Codex executed the mutation
and exited 0. No production direct-mutation claim is made, including fail-closed
adapter crash/nonzero behavior. Shell/exec is classified as effect-capable as a
whole; the probe adapter does not guess arbitrary command mutation semantics. The sanitized
[receipt](../../docs/projects/2026-08-05-codex-native-lifecycle-enforcement/evidence/codex-pre-effect-production-live-receipt.json)
records the installed adapter hash, no-admission denial, attempted L3/L5/managed-entry sequence,
and fail-open broken control. D4 remains `NOT_READY/NO_SHIP`: the two lifecycle entry commands ran, but no
payload-session marker was visible to their following effect calls, so the L3 allow, L5 direct-deny
classification, and managed Engine entry did not qualify. The sole existing campaign is also sealed
to the pre-amendment Mission graph; creating replacement authority was outside the repair.

Markers are keyed to the Codex hook payload's session identity and also store that identity in the
marker body. Renaming or copying a marker cannot admit a different host session. The final probe
did not observe a qualified payload-session bridge across the shell boundary, so no
Codex-thread-bound production direct-mutation claim is made.

Managed Engine entry is independently fail-closed. Before provider readiness,
roster probing, resource creation, or dispatch, it requires the existing
session marker to match TTL, effective level, Git common-dir, and the sealed
Mission policy/graph/source admission. This does not broaden the package's hook
capability claim.

When that managed path selects a Codex implementer, the dispatcher creates a mode-0700 temporary
`CODEX_HOME`, copies only `auth.json` at mode 0600, unsets the controller's `CODEX_THREAD_ID`, and
invokes `codex exec --ignore-user-config`. Controller config, plugins, and session state therefore
cannot cause the production hook to intercept its own managed child.

## Subagent model routing (`spawn_agent`) — opt-in

On codex-cli 0.144.0–0.144.3 (re-verified 2026-07-13) with a MultiAgentV2 model (e.g. gpt-5.6-sol), the native
`spawn_agent` tool exposes only `task_name`/`message`/`fork_turns` — **no `model`
field** — so autopilot's role→model routing (`scripts/resolve-dispatch.sh`) cannot
be expressed on subagent spawns: every subagent silently inherits the parent's
(expensive) model. The official `~/.codex/agents/<name>.toml` profile path routes
the spawn but its `model` field is IGNORED on 0.144.0–0.144.3 (child inherits the parent
model — verified by rollout artifact; openai/codex#26868 class). Full spike
evidence: `references/multi-agent-portability.md` § "spawn_agent subagent MODEL
routing".

Working **opt-in** (add to YOUR `~/.codex/config.toml`; autopilot never edits it):

```toml
[features.multi_agent_v2]
hide_spawn_agent_metadata = false
tool_namespace = "agents"
```

Both lines are required — the first alone trips the server-reserved
`collaboration.spawn_agent` schema (400 on every turn); renaming the tool
namespace restores the full 7-field schema (`model`/`agent_type`/
`reasoning_effort`/`service_tier`) and per-call model overrides verifiably take
effect. Caveats: undocumented upstream and may be closed by a future codex
release; the failure mode is loud (spawn returns 400), so "use until it breaks"
is safe. Without the opt-in, treat subagent spawns as same-model-as-parent and
budget accordingly.

## Production `PostCompact` recovery

The installed `autopilot@autopilot-local` package registers
`./hooks/hooks.json`. On manual `/compact` and threshold-driven automatic
compaction, its adapter resolves the exact Git root/common-dir and active work
order, then invokes the existing `postcompact-adapter` authority. Continuation
is blocked when payload identity or reconciliation fails.

The committed [production live receipt](../../docs/projects/_archive/2026-08-04-platform-capability-trigger-activation/evidence/codex-postcompact-production-live-receipt.json)
was captured on codex-cli 0.146.0. It proves manual and threshold-12000 automatic
reconciliation before effect, plus a broken-adapter control with hook failure,
no reconciliation receipt, and no effect sentinel. This is the package's sole
production Codex hook. The retained `pre-effect.js` source is a non-production
probe helper and is not registered by the installed manifest.

Codex requires non-managed plugin hooks to be reviewed and trusted before they
run. Review the package hook declaration during installation.

## Hook probe package

`hook-probe/` is a separate Codex plugin marketplace used only for adapter
development. It is not part of the default `autopilot-local` skills package.

The probe package declares warning-only command hooks for `SessionStart`,
`PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, and `Stop`. The hook script writes
normalized shape-only telemetry to Codex `PLUGIN_DATA` and always exits 0. It
records value types, key counts, and fixed field-presence booleans, but omits
raw payloads, path values, payload key names, identifiers, and tool input/output
values. It never returns `continue: false` and must not be used as a blocking
gate.
Probe telemetry is size-capped: `events.jsonl` rotates at 1 MiB and keeps one
`.1` backup.

Install it only when actively probing Codex hook payload/cwd/env/failure
semantics:

```bash
tmp_home="$(mktemp -d)"
trap 'rm -rf "$tmp_home"' EXIT
mkdir -p "$tmp_home/.codex"
HOME="$tmp_home" CODEX_HOME="$tmp_home/.codex" codex plugin marketplace add ./platforms/codex/hook-probe
HOME="$tmp_home" CODEX_HOME="$tmp_home/.codex" codex plugin add autopilot-hook-probe@autopilot-hook-probe-local
```

Use the probe only for shape/cwd/env/failure maintenance evidence. It remains
warning-only and does not replace or configure either production adapter.

## Local install smoke

```bash
./scripts/sync-codex-plugin-skills.sh
codex plugin marketplace add ./platforms/codex
codex plugin list --marketplace autopilot-local --available
codex plugin add autopilot@autopilot-local
```

For a throwaway verification that does not touch your normal Codex config:

```bash
tmp_home="$(mktemp -d)"
trap 'rm -rf "$tmp_home"' EXIT
mkdir -p "$tmp_home/.codex"
./scripts/sync-codex-plugin-skills.sh
HOME="$tmp_home" CODEX_HOME="$tmp_home/.codex" codex plugin marketplace add ./platforms/codex
HOME="$tmp_home" CODEX_HOME="$tmp_home/.codex" codex plugin add autopilot@autopilot-local
```

Run `./scripts/setup-symlinks.sh` after cloning on a machine that did not
preserve symlinks.

Run `./scripts/sync-codex-plugin-skills.sh` after changing `skills/` or linked
support files; `./scripts/sync-codex-plugin-skills.sh --check` is the read-only
drift gate used by pre-commit and `preflight-portability.sh`.

Run packaged engine commands from the target repository, or pass
`--cwd /path/to/repo` to `engine implement-review` so implementation worktrees
and review diffs use the intended project.

When `AUTOPILOT_LEVEL=l5` selects the ordinary managed Engine path, the installed payload uses the
same canonical strict-L5 bootstrap as the source tree. It freezes the exact six-claim provider
policy, matches the target repository's complete invocation roster, and consumes fresh process-local
qualification/live-readiness closures before workflow dispatch. No Codex setting or serialized
receipt replaces that host-owned authority, and this Engine behavior does not broaden the package's
single-hook portability claim.
