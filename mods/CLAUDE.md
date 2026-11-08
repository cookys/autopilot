# mods/ - directory rules (Claude Code)

Loaded when a session reads or edits a file under `mods/`.

| Topic | File |
|-------|------|
| Mod surface colour and emphasis (pane, band, any new mod) | [`project/plans/2026-10-13-live-pane-design-system.md`](../project/plans/2026-10-13-live-pane-design-system.md) §12: one colour one meaning, bold whitelist; colours only through `PALETTE` in `mods/live/ui.ts` (`ui-lint.test.js` L8 enforces) |

## Env reads

`$.env.get` takes a string literal as its first argument at every call site; the mod loader refuses a variable name and the whole mod then fails to load (no helper such as `get(k)`). `ui-lint.test.js` L11 scans every source under `mods/` and goes red on a non-literal first argument.

## Running the mod suites

`bash mods/{live,viewer,roundtable}/run-tests.sh` run `claude plugin test` on a throwaway wrapper. Under the suite env (a sentinel `claude` first on PATH that exits 97) they end rc 97 and never run. To run them for real, pass the real binary explicitly: `AUTOPILOT_MODS_REAL_CLAUDE=<absolute path of the real claude> bash mods/<m>/run-tests.sh < /dev/null`. The helper `mods/lib/real-claude-env.sh` uses only that path (no PATH search, no default; unset = unchanged behaviour), runs it with `HOME`, `CLAUDE_CONFIG_DIR` and `XDG_*` in one fresh empty temp dir and the auth env vars removed, then goes red (rc 98) if that dir gained a `.credentials.json` or any `*.jsonl` (a session or model call happened), and removes the dir. No credentials are copied in. Guard test (fake binaries only): `hooks/tests/mods-real-claude-guard.test.sh`.

