# `hooks.json` `"//"` comment keys log an ERROR line on every Claude Code start

- **Context**: `hooks/hooks.json` carries 15 `"//"` comment keys inside hook entries. Claude Code 2.1.288 logs
  `[ERROR] autopilot: hooks.json: unknown keys "//" in hooks.SessionEnd[0], … and 6 more ignored` at every session start
  (debug log; seen in both mods P0 S1 runs, `docs/plans/evidence/2026-10-03-mods-spikes/artifacts/S1/debug-pos.extract.txt`).
  The keys are ignored, so behaviour is unchanged, but the ERROR line is noise next to real module-load errors once
  `modules` ships (P1d).
- **Fix**: move the comments to `hooks/README.md` or the top-level `description`, or confirm a top-level-only comment key
  is accepted; keep `check-hook-inventory.js` and the mirror sync scripts green.
- **Test**: a `--debug` start of the plugin shows no `unknown keys` line; the hook inventory gate stays green.
- **Not verified**: whether the line also appears without the `modules` key (S1 only ran with it).
- **Source**: mods plan P0 spike S1, 2026-10-03.
