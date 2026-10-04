# P1W hand — INT3: MARKER + W3a

Read `w-common.md` and `int.md` first (authorized conflict sites only, fidelity table, full suite once, reds solo + base). This brief overrides them where they differ.

Branch `w/int3`, worktree `$P/wt-int3`, created by depth-0 at `w/marker` (9a94ffbf = w/int2 + MARKER). `git cherry-pick -x` in order: `8ff94af4` (C1), `01316e3b` (C2), `45c48df5` (C3), `89580cbf` (C3b-M), `18db7c55` (W3a). At most one extra commit `fix(int): reconcile MARKER and W3a (mods P1W INT3)` for derived files only.

Authorized conflict sites: `references/mods.md` (+ codex mirror) — union; `src/status/foreman-activity.js`, `scripts/runs-watch-sidecars.test.js` (+ mirrors) and `src/status/runs-watch.js` — W3a's foreign-project_key re-check vs MARKER's plain-marker filter: keep both only if each side is a pure addition; otherwise STOP and report both hunks. Codex: `rm -f scripts/dispatch-contract.pre.js`, sync, `--check`.

Semantic check (record in the report): the mod (`mods/live/model.ts`) resolves project/root from the session marker (plan §2.8 (a)); with MARKER a dev-flow session now HAS a marker with `level: null`. Confirm with a mod test (fixture plain marker with project_key, root_run_id null, phase) that the band shows the project and phase and does not treat `level: null` as an orchestrator level anywhere (grep the mod for `level`). If the mod mis-handles it, STOP and report (no fix in INT3).

Verify as `int.md` + the mod suite (tsc, `live.test.ts`, `claude plugin validate` on a throwaway wrapper under `$P/run-w/int3/`), long hetero suites one at a time. Report `$P/run-w/int3/REPORT.md`. Final message: report path, head SHA, 5-line summary.
