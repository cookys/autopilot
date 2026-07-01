# Autopilot Codex Package

This directory contains the Codex packaging surface for Autopilot.

- `plugin/` is the Codex plugin root.
- `plugin/skills` is a generated copy of the repository's canonical `skills/`.
- `plugin/references`, `plugin/scripts`, `plugin/project-config-template`, and
  selected `plugin/docs` files are generated support payload for skill links.
- `.agents/plugins/marketplace.json` is a repo-local marketplace for development.

The package is intentionally skills-only. It does not declare Claude Code hooks,
apps, or MCP servers.

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
support files; the package test fails if the generated payload drifts.
