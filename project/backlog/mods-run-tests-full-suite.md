# mods run-tests.sh never run in the full suite (BL-0393)

Source: PM, 2026-11-05 (approved).

## Problem
- `mods/live/run-tests.sh`, `mods/viewer/run-tests.sh` and `mods/roundtable/run-tests.sh` call `claude plugin test`, and the sentinel PATH of a full-suite run stops `claude` (rc 97), so these three never run there.
- Run once without the sentinel on 2026-11-05 at 35b97423c: 852 tests pass, 0 model calls, no credentials (empty temp HOME and CLAUDE_CONFIG_DIR; only `.claude.json` was written).

## Shipped (merge 1309cca5b, modsreal)
- `AUTOPILOT_MODS_REAL_CLAUDE=<absolute path of the real claude>` makes the three runners use that binary (no PATH search, no default) in an empty temp HOME / CLAUDE_CONFIG_DIR / XDG_* with the auth env vars removed; red (rc 98) if `.credentials.json` or any `*.jsonl` appears. Helper `mods/lib/real-claude-env.sh`, docs in `mods/CLAUDE.md`, guard test `hooks/tests/mods-real-claude-guard.test.sh` (fake binaries, includes the planted-credentials red case). Hand run: live 813, viewer 32, roundtable 7 pass.
- Unset, behaviour is unchanged: still rc 97 under the sentinel.

## Remaining
- A full-suite run (`suite-baseline run-all` as test-policy prescribes) does not set `AUTOPILOT_MODS_REAL_CLAUDE`, so the three suites still end rc 97 there. Wire the real claude path into the full-suite run for these three only; every other suite stays sentinel-guarded.
- Follow-up hardening of the guard itself is BL-0396.

## Notes
- Trigger: PM dispatch. Effort M.
