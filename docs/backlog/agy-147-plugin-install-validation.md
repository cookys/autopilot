# dev-setup --harness agy --install fails validation on agy 1.4.7

BL-0308. Peer report from twgs-revival (peace--claude-2), 2026-10-26, on 3.0.0-alpha.6: 3 errors, 4 warnings, agents loaded 0.

Errors: the `tools:` frontmatter of `agents/planner.md`, `agents/reviewer.md` and `agents/debugger.md` is a comma-separated string; agy wants a `[]string`.

Warnings: `AGENTS.md` is not loaded (agy reads only `rules/`); `hooks/hooks.json` is not loaded (agy reads only a root-level `hooks.json`); `skills/ceo-agent` (32 KB) and `skills/dev-flow` (31 KB) exceed 24000 bytes and are truncated.

Replied to the peer: agy reviewers run through the cleanroom and do not need this plugin. Before fixing, confirm whether Claude Code and Codex can read an array-form `tools` field: either change the source files, or convert at agy install time.
