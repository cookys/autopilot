# A rejected AUTOPILOT_LIVE_DIR override silently falls through to the real live dir

Source: mods P1a R1/R4/R6 (2026-10-04); evidence `docs/plans/evidence/2026-10-04-mods-p1a/`.

`scripts/lib/live-state-dir.js` `resolveLiveDir` accepts an override only when it is RAM-backed (tmpfs/ramfs), owned, a non-symlink, and mode 0700. Otherwise it skips the override and continues to `$XDG_RUNTIME_DIR/autopilot`, which is the operator's real live store.

Observed twice in P1a:
- The R1 manifest suite pointed the override at a `/tmp` path (ext4 on this host): rejected, so `status runs` wrote `runs-enrich-cursor.json` into `/run/user/1000/autopilot/`.
- An R4 debug run used `mkdir -p` (mode 755): rejected for the same reason.

Suites that set the override without a `/dev/shm` path (grep-confirmed 2026-10-04): `hooks/tests/dirty-protected-paths.test.sh`, `live-pointer.test.sh`, `project-key.test.sh`, `repo-identity-parity.test.sh`. The R6 hand counted 11 in total; re-grep `AUTOPILOT_LIVE_DIR` in `hooks/tests/` for suites whose value derives from `$TEST_TMP` or another non-shm mktemp.

Fix direction: an override that is explicitly set but rejected must not resolve to the real XDG dir. Fail loudly, or use the override's own (SSD) path with the existing one-line warning. Then move the listed suites to `mktemp -d -p /dev/shm` plus `chmod 700` (as `lib.sh` now does by default), and add a landing assertion that a suite's live writes stay under its own dir.
