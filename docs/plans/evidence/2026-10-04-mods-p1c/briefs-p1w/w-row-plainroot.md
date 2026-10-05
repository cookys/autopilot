# P1W row PLAINROOT — plain sessions get a job root too (owner 2026-10-05, plan R5.7)

Read `w-common.md`, `w-row-marker.md` (the contract this extends) and `$P/run-w/marker/REPORT.md`. Base: `w/int3` (297ab2e0). Worktree `$P/wt-plainroot`, branch `w/plainroot`.

## Ruling
Owner reversed the MARKER exclusion: a plain session (`level: null`) is also one job with its own `root_run_id`. Reason: W1b's task-status input (and everything keyed by root — band scope, decision files, ad-hoc dispatch lineage via W1f) must work for dev-flow sessions without inventing a root from a branch name (rails/skills never mint roots; only `session-mode.js` does, §2.7).

## Deliverables (RED-first, mutation outputs under `$P/run-w/plainroot/`)
1. **Mint**: `ensurePlainMarker` and plain `set` assign `root_run_id` with the SAME rule as `set --level` (`scripts/session-mode.js` ~L687–693: explicit `--root-run-id` > `AUTOPILOT_ROOT_RUN_ID` > minted `job-<ts>-<rand>`); one shared helper, not a copy. Ensure never overwrites, so compact/resume keep the same root (test). Expired marker replaced → a NEW root (test, and say so in the header). Update the header comments that say plain sessions get no root.
2. **Read back**: `session-mode.js root` prints the plain marker's root (test). `scripts/open-decision.js open` without `--root-run-id` defaults to this session's marker root (read the marker through the plain-inclusive reader; no marker → null as today) (test).
3. **Watcher scopes**: a plain session's root becomes a scope like any other. `state.roots` today only grows (`src/status/runs-watch.js` ~L537–552) — add retention: a root with no unexpired marker, no live run, no open decision file and no tasks/attention update within the idle window (reuse the watcher's existing idle-exit window constant; name it) is dropped from `state.roots` and ITS live files (envelope, `.decisions.json`, `.foreman.json`, `sources/<scope>.json`) are removed. Review pages under `<autopilot_home>/review/` are durable and NOT touched (90-day reap stays). Tests: dropped after the window; kept while any one of the four signals is live; never drops a root that still has a live run; negative control for another project's root.
4. **Scope assignment of session inputs**: with a root on every plain marker, tasks/attention/phase of that session belong to its root scope, not the unbound project scope (WATCH-A `planned-input.js`/`phase-input.js` filters by marker root — verify and pin with a tick-level test). The unbound scope still serves non-opted sessions with no marker.
5. **Mod**: `mods/live/model.ts` resolves scope via marker `project_key` + `root_run_id` (§2.8 (a)); with roots on plain markers, a dev-flow session's band reads its root scope. Add one mod test (fixture plain marker with root + scope envelope) — touch the mod only if it fails.
6. **Volume check**: start 5 plain sessions in one fixture repo (temp live dir under /dev/shm, autostart off except where the test drives it) → exactly 5 root scopes; after the window with all markers expired → 0 root live files left.

## Verify
Consumers: session-mode*, plain-session-marker, runs-watch*, runs-watch-inputs, runs-watch-sidecars, open-decision tests, dispatch-job-root (W1f), project-key, live-pointer, mod suite (`claude plugin test` on a wrapper under `$P/run-w/plainroot/`, tsc), L1, checks, codex sync. Long hetero suites only if dispatch-hetero.sh changes. Every manual probe: XDG_RUNTIME_DIR and AUTOPILOT_LIVE_DIR under /dev/shm, AUTOPILOT_RUNS_WATCH_AUTOSTART=0, and confirm `/run/user/1000/autopilot/runs` unchanged.

One commit `feat(session-mode): plain sessions get a job root; watcher drops idle root scopes (mods P1W PLAINROOT)`. Report `$P/run-w/plainroot/REPORT.md`.
