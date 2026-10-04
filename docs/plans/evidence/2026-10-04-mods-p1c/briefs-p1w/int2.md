# P1W hand — INT2: integrate the accepted wave-2 rows onto `w/int`

Read `w-common.md` and `int.md` first (same rules: authorized conflict sites only, fidelity table, full suite once, reds solo + base). This brief overrides them where they differ.

## Goal
Branch `w/int2`, worktree `$P/wt-int2`, based on `w/int` (8666aba4), carrying in this order (`git cherry-pick -x`):
1. `441243e2` PHASE+PICK
2. `291cfa96` PERF+STAMP
3. `c13270aa` WATCH-B
4. `23148e78` WATCH-A
then at most ONE extra commit `fix(status): reconcile wave-2 integration (mods P1W INT2)` holding only the items below.

## Authorized conflict sites
- `src/status/runs-watch.js` (+ codex mirror): WATCH-B and WATCH-A each add hookup lines in the same functions. Keep both sides' lines; order does not matter semantically (WATCH-B writes sidecars, WATCH-A feeds `assemble` and the signature). Any non-hookup overlap → STOP.
- `hooks/README.md`, `docs/scripts-inventory.md`, `CLAUDE.md` inventory: union.
- Codex mirrors: `rm -f scripts/dispatch-contract.pre.js`, `bash scripts/sync-codex-plugin-skills.sh`, then `--check`.

## Reconcile commit (exactly these, each with a test and a mutation output under `$P/run-w/int2/`)
1. 🟠 from review-1791143892-901204-f3e7: `src/status/sources-manifest.js` derives `attention.installed` from `hooks/hooks.json` naming `/hooks/awaiting-owner.js`; PERF moved that work into `audit-log.js` (PostToolUse) and `advisory-relay.js` (UserPromptSubmit), and it still has its own entries on other events (check). Re-derive `attention.installed/enabled` from the real wiring after PERF: installed when hooks.json wires a process that runs awaiting-owner's handlers (the host hooks plus any remaining own entries — derive the host list from code, e.g. an exported list in `hooks/live-session-lib.js` or the host files' `require`, not a hard-coded string list in the manifest), enabled per awaiting-owner's own knob. Run `hooks/tests/runs-watch-inputs.test.sh` — its `s_attention` case must assert installed:true on the integrated tree, and a mutation that removes the host wiring from a temp copy of hooks.json must flip it.
2. Same check for `tasks` (session-tasks.js) and `context` (W2f context-budget) in the manifest: confirm on the integrated tree each reports the truth; fix only if wrong.
3. `writers_wired` in `src/status/decisions-sidecar.js` detects next-pick by grepping `AUTOPILOT_ROOT_RUN_ID` in `scripts/next-pick.js` (review-1791139700 🔵). With PICK now present, confirm it reads true; if the grep matches only a comment, switch to an exported capability flag from `next-pick.js` (`module.exports.AUTO_LEDGER = true` or similar) — only if `next-pick.js` is require-safe (no side effects on require); otherwise leave it and report.

## Verify
As `int.md` (checks, L1, L2 via `hooks/tests/run.sh`, long suites `dispatch-hetero*`, `resolve-review-loop*`, `hetero-review-loop*` strictly one at a time — run them sequentially after the parallel part if the runner allows; reds solo then on a clean `w/int` worktree). Plus:
- Latency (PERF owed): run the committed `hooks/tests/hook-latency.js` A/B (w/int tree vs w/int2 tree, interleaved) for PostToolUse depth-0, PostToolUse subagent (agent_id), UserPromptSubmit watcher-alive, UserPromptSubmit not-opted-in. Record `/proc/loadavg` before each table. If the 1-min load is above 8, wait (check every 5 minutes, up to 60 minutes) before measuring; if it never drops, measure anyway and say so.
- `node scripts/check-hook-inventory.js --check`, `node scripts/check-claude-md-inventory.js`, `node scripts/check-readme-parity.js` (if present), `node scripts/check-js-syntax.js`.

## Report
`$P/run-w/int2/REPORT.md` as in `int.md`, plus the latency tables and the reconcile items 1–3 with evidence. Final message: report path, head SHA, 5-line summary.
