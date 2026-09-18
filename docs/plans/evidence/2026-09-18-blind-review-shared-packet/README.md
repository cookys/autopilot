# Evidence — mission `blind-review-shared-packet-2026-09-18` (blind review redesign cut 2-C, deliverable 2: one packet per candidate)

- Plan: `../../2026-09-18-blind-review-panel-station.md` §1.2 (frozen after G2; the plan hetero loop and the G1/G2
  receipts live in `../2026-09-18-blind-review-panel-station/`). Second lineage from the same plan bytes:
  `NODE=packet` of the station's `scratch/freeze-c2c.js` — the objective now names the deliverable, because the
  adoption key derives from `{repo, intent, acceptance hashes}` and an unchanged objective would have found the
  station's registry entry (`MISSION_BINDING_MISMATCH` on a different graph digest). Graph digest `4e4a8299…`,
  lineage `lineage-v1-b33ff20c…`, node `shared-packet` (13 output paths, pocket 900, verify-once).
- Base `fd4ea3a6` (the freeze commit on v2.36.68 + docs). `base-suites-fd4ea3a6.txt`: the thirteen §4.1 commands
  at base, detached checkout, `env -u AUTOPILOT_SESSION_ID`.
