# Strike fixture residue, 2026-10-19

Raw evidence for two false strikes (event 81 at 03:36, event 82 at 03:38 local, 2026-10-19).

- `strikes-81-82.jsonl`: the two strike rows as written to the real store.
- `tmp.*.out`, `hetero-*-log-*`: rail output and agent logs from the repro runs.
- Cause: a manual repro of `dispatch-hetero.sh` outside the test suite, with a stub runner
  and no `ENGINE_CAPABILITY_DIR`, so the rail wrote into `~/.autopilot`.
- Both rows were voided by events 83 and 84. The mechanism fix is merge 64d26312a.
