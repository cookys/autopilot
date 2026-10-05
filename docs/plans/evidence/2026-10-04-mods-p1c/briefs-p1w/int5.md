# P1W hand — INT5: PHASE-TASK + HOOKQ onto w/int4, plus small accepted follow-ups

Read `w-common.md` and `int.md` first (authorized conflict sites only, fidelity table, full suite once, reds solo + base). This brief overrides them.

Branch `w/int5`, worktree `$P/wt-int5`, created by depth-0 at `w/int4` (15966420). `git cherry-pick -x`: `52c5ce0a` (PHASE-TASK), then `699d7853` (HOOKQ). Expected conflicts: none (disjoint files) — anything else → STOP. Then ONE extra commit `fix(int): INT5 follow-ups from the per-row reviews (mods P1W INT5)` with exactly:
1. Comment drift only: `src/status/watch-inputs.js` header (assemble shape incl. `taskPhase`; source role `session_task_phase`) and `mods/live/model.ts` ~L482 phase-source comment (campaign > receipt > marker > task in progress > deliverable). (+ codex mirror for the .js)
2. `hooks/ask-decision.js` `markerRoot` reads the marker through the shared plain-inclusive reader used by the other hooks/`session-mode.js` (find it; do not copy its logic); test: a marker with an expired `expires_at` and one with a non-normalised session id behave exactly as the shared reader decides.
3. `hooks/hookq.test.js` (or the wiring test it uses): assert `audit-log.js` is in the `.*` PostToolUse group (the AskUserQuestion close leg depends on it); `hooks/README.md` audit-log row: matcher wording matches hooks.json.
Each with a mutation output under `$P/run-w/int5/`.

Verify as `int.md` (L1, `hooks/tests/run.sh` once — parallel runner allowed, long hetero suites re-run solo if red, reds solo then on a clean `w/int4` worktree), mod wrapper run (tsc, live.test.ts), checks incl. `node scripts/build-profile-payload.js catalog --check` (exit code read directly, not through a pipe), hook inventory 36 (23/13), codex sync. Isolation: real `/run/user/1000/autopilot/runs` unchanged; no `hh-`/test watcher process survives; temp-dir counts not larger after the run.
Report `$P/run-w/int5/REPORT.md`. Final message: report path, head SHA, 5-line summary.
