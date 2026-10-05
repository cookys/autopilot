# P1W hand — INT4: PLAINROOT + LIVEDIR onto w/int3, plus the hook-hosting residue fix

Read `w-common.md` and `int.md` first (authorized conflict sites only, fidelity table, full suite once, reds solo + base). This brief overrides them where they differ.

Branch `w/int4`, worktree `$P/wt-int4`, created by depth-0 at `w/int3` (297ab2e0). `git cherry-pick -x` in order: `28a54b5d` (LIVEDIR), then the PLAINROOT head named by depth-0 in the dispatch message. Then ONE extra commit `test(hooks): hook-hosting stops the watchers and temp dirs it creates (mods P1W INT4)`.

## Authorized conflict sites
- `src/status/runs-watch.js` (+ codex mirror): LIVEDIR adds a 2-line refusal guard in `runWatchCli`; PLAINROOT changes `tick()` retention. Keep both if each is a pure addition in its own function; otherwise STOP and report both hunks.
- `hooks/README.md`, `references/*.md`, `docs/scripts-inventory.md`: union.
- Codex: `rm -f scripts/dispatch-contract.pre.js`, sync, `--check`.

## The extra commit (REQUIRED; evidence in `accepted-heads-p1w.txt` FOLLOW-UP + CLEANUP lines)
`hooks/hook-hosting.test.js` leaves one detached `status runs --watch --render --idle-exit 3600` process per run plus `/dev/shm/hh-live-*`, `/tmp/hh-home-*`, `/tmp/hh-repo-*` dirs (≈1,000 runs accumulated in one day). Fix in the test only:
1. Set `AUTOPILOT_RUNS_WATCH_AUTOSTART=0` for every case that does not itself assert autostart behaviour.
2. For cases that do drive autostart: record the spawned watcher (its `writer.pid` in the case's live dir), stop it in teardown (`process.kill(pid)` after verifying the pid's environ points at that case's live dir), and remove the case's temp dirs.
3. Add a self-check at the end of the file: no process whose environ `AUTOPILOT_LIVE_DIR` starts with this run's temp prefix survives, and none of this run's temp dirs remain. Mutation: drop the teardown → the self-check goes red.
4. The two `ups:` cases that fail under load and pass alone: find why (shared state, timing) and fix or widen the timing with a stated reason.
Do not change production code in this commit.

## Verify
As `int.md`: checks, L1, L2 via `hooks/tests/run.sh` once, long hetero suites one at a time, reds solo then on a clean `w/int3` worktree; plus the mod wrapper run (tsc, `live.test.ts`). After the full run: `ps` shows no `runs --watch` process with an `hh-` live dir, and `ls -d /dev/shm/hh-live-* /tmp/hh-home-* /tmp/hh-repo-*` is not larger than before the run. Real store: `/run/user/1000/autopilot/runs` listing identical before and after.
Report `$P/run-w/int4/REPORT.md`. Final message: report path, head SHA, 5-line summary.
