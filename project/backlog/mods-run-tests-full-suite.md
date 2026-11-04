# mods run-tests.sh never run in the full suite (BL-0393)

Source: PM, 2026-11-05 (approved).

## Problem
- `mods/live/run-tests.sh`, `mods/viewer/run-tests.sh` and `mods/roundtable/run-tests.sh` call `claude plugin test`, and the sentinel PATH of a full-suite run stops `claude` (rc 97), so these three never run there.
- Run once without the sentinel on 2026-11-05 at 35b97423c: 852 tests pass, 0 model calls, no credentials (empty temp HOME and CLAUDE_CONFIG_DIR; only `.claude.json` was written).

## Fix (PM approved)
- In full-suite runs, these three use the real `claude` with an empty temp HOME and CLAUDE_CONFIG_DIR and no sentinel; every other suite stays sentinel-guarded.
- Red if `.credentials.json` or any `*.jsonl` appears in that dir.
- A red for the guard itself: plant a `.credentials.json` and see it fail.

## Notes
- Trigger: PM dispatch. Effort M. Implementation is a separate lane.
