# mods plan P0 spikes — 2026-10-03

Plan: `docs/plans/2026-10-03-mods-visible-dispatch.md` §4 P0 (results written back as R4.2). Host: aimax395, Claude Code
2.1.288, Linux; desktop (Code tab) not reachable from this host. Two sonnet hands ran in parallel from scratchpad briefs
(Hand A: S1, S2, S5(b) — real `claude -p` sessions against a local clone of the plugin at `3e0ae789`; Hand B: S5(a), S6,
S3, S4). Every child `claude` ran with a dedicated `CLAUDE_CONFIG_DIR` + fake `HOME`, no `AUTOPILOT_SESSION_ID`.

| Spike | Verdict | Key raw fact | File |
|---|---|---|---|
| S1 modules + classic co-load | **yes** | same sid `…5556` in the mod line (`artifacts/S1/s1-mod-line.jsonl`) and the classic cost-tracker row (`artifacts/S1/costs.jsonl`); broken `register.ts` → `hooks module did not load: … does not parse`, classic row still written (`artifacts/S1/neg/`) | `S1.md` |
| S2 mod data-supply paths | **partial** | `claude -p` only: every P1c path readable (interactive terminal not exercised for fs/env); `$.fs` relative = `$.session.cwd()`, no project-root confinement; `~` not expanded; errors carry no `code`. Desktop unverified | `S2.md` |
| S5(a) mod lifecycle | **partial** | 3 timer generations, handover gaps 533/718 ms (no overlap), ~1 tick/s each, 0 ticks after `session.end` (`artifacts/S5/analysis.out`). Desktop and `/clear` unverified | `S5a.md` |
| S5(b) detached watcher launch | **yes** | envelope lands; 2nd launch no 2nd writer; kill → lock free; relaunch new writer (`artifacts/S5/s5b-direct.txt`); watcher launched from a child claude's Bash tool still writing 24 s after claude exit (`artifacts/S5/s5b-child-envelope-final.json` at 15:21:09 vs exit 15:20:45) | `S5b.md` |
| S6 benchmark selector coverage | **no** | selector covers 4 of 24 `hooks.json` commands (opt-in multiplexer only); `tool_name` hard-coded | `S6.md` |
| S3 desktop `Svg` cap | **yes** | 40-row gantt SVG = 11,182 chars (8.5% of 131,072) | `S3.md` |
| S4 terminal `Image` | **needs-owner** | mod validates + `plugin test` passes; owner runs `claude --plugin-dir docs/plans/evidence/2026-10-03-mods-spikes/artifacts/S4` then `/spike-image` | `S4.md` |

## depth-0 re-derivation (ADR-0001)

S1, S5(a) and S5(b) were re-derived by depth-0 from the raw artifact files above, not from the hands' reports. One
plan claim was **refuted**: `flock(1)` with a command forks and waits, it does not exec — `/proc/locks` names the `flock`
pid, the node writer holds the lock through the inherited open file description. Plan P1a corrected in R4.2.

## Findings beyond the spike questions

- `cost-tracker` writes no row under `--no-session-persistence` (needs the transcript) — a witness harness must keep persistence on.
- `claude plugin validate <repo>` only validates `marketplace.json`; point it at `.claude-plugin/plugin.json` to walk hooks + modules.
- `hooks/hooks.json`'s existing `"//"` comment keys log an `[ERROR] … unknown keys "//" … ignored` line on every start → BACKLOG.
- `claude plugin test` refused to run against the real `~/.claude` ("rollout switch saved off"); it ran under the isolated config.
- An isolated config dir needs `.claude.json` seeded (onboarding, trust) for an interactive session; Hand B's `artifacts/S5/seed.py` copies `oauthAccount` from the real file into the isolated dir only (scratch dirs deleted after the run).
- Hand A's `S5.md` overwrote Hand B's; renamed to `S5b.md`, Hand B rewrote `S5a.md`. Future parallel spike briefs must give each hand disjoint file names.

## Not proved here

S2's fs/env paths in an interactive terminal session (only `-p` ran them; Hand B's interactive runs proved module loading and timers, not these reads); any desktop / vscode / mobile surface; CC sandbox enabled; interactive `/exit` or desktop close for the detached watcher;
`/clear` behaviour of a `session.start` timer (P1c's first commit tests it); the real `session-mode.js set` / runs-watch
(they do not exist yet — a stub with the same launch shape was used).
