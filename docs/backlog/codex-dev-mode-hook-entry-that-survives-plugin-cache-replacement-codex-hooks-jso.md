# Codex dev-mode hook entry that survives plugin cache replacement (`~/.codex/hooks.json` → repo path)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a second report of `PostCompact MODULE_NOT_FOUND` on a host that ran `dev-setup.sh --harness codex --install` with `--force`, or a Codex release that documents whether hook `command` strings run through a shell (then a self-contained fallback in the command string becomes possible).
- **Context**: v2.36.10 guards the update (refuse under live sessions) but cannot make a live session survive it: Codex pins `PLUGIN_ROOT` to `~/.codex/plugins/cache/…/<version>/`, and both `plugin add` (in-place upgrade) and `plugin remove` delete that directory. The peer proposal is a user-level `~/.codex/hooks.json` PostCompact entry pointing at the repo checkout (stable path), which would duplicate the plugin hook (double fire) unless the plugin-side entry is dropped from the dev install, and would need its own trust review (official hooks doc supports `~/.codex/hooks.json`; nothing says a hook command is shell-interpreted, so no `[ -f … ] || fallback` in the command string). Spike: measure double-fire, decide dev-only vs shipped, verify with the hook-probe package.
- **Effort**: S (spike) + Fix
- **Source**: local Codex session hand-off via agent-call 2026-09-07; `hooks/tests/codex-plugin-package.test.sh` upgrade case.

