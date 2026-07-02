# Autopilot Codex Package

This directory contains the Codex packaging surface for Autopilot.

- `plugin/` is the Codex plugin root.
- `plugin/skills` is a generated copy of the repository's canonical `skills/`.
- `plugin/bin`, `plugin/src`, `plugin/references`, `plugin/scripts`,
  `plugin/project-config-template`, selected `plugin/docs` files, and
  `plugin/hooks/_shared` are generated support payload for skill links and
  engine CLI commands.
- `.agents/plugins/marketplace.json` is a repo-local marketplace for development.

The package manifest intentionally exposes only skills. It does not declare
Claude Code hooks, apps, or MCP servers; the extra payload exists so referenced
support files resolve after installation.

Some canonical skill bodies still describe Claude Code-only orchestration
surfaces such as `TaskCreate`, native `Agent` dispatch, `TaskStop`, and
`subagent_type`. Codex can read those bodies as methodology guidance, and the
packaged support CLI/scripts work where they are host-neutral, but those
Claude-only tool calls are not provided by the Codex package. Treat them as
platform-specific instructions until a future harness-neutral skill-body split
lands.

## Hook probe package

`hook-probe/` is a separate Codex plugin marketplace used only for adapter
development. It is not part of the default `autopilot-local` skills package.

The probe package declares warning-only command hooks for `SessionStart`,
`PreToolUse`, `PostToolUse`, `PreCompact`, and `Stop`. The hook script writes
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

Codex requires non-managed plugin hooks to be reviewed and trusted before they
run. Use the probe output as evidence before moving any Autopilot hook from
warning-only telemetry to behavior that influences a tool call or ship decision.

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
