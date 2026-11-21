# affected-suites selector accuracy, two more rows (BL-0407, BL-0410)

Same family as BL-0391 (`affected-suites-blind-spots.md`); the three rows refer to each other.

## BL-0407: mods changes fan out too wide
rtchat (10 files under `mods/roundtable`) selected 496/789 suites, forcing a full suite each time. Find out why mods changes fan out that wide. Reported by autopilot depth-0, 2026-11-06.

## BL-0410: misses (PM fleet 01M6HB7DK2BGZEZHT69R4DQX7C)
- The selector misses the own suite of a changed review script, and misses a new plan-path test: false-green risk.
- (a) The outcome gate reads only affected-suites qc-runs and does not recognise a full-suite record: fix it.
- (b) Make the selector docs exact; use a replay of the two same-day misses as the red case.
- Schedule: before bl-ap-streamjson (BL-0372) when WIP frees up. A selection of half or more no longer escalates to a pre-merge full suite (PM ruling 2026-11-21 on task 01M7XRRV, operator 11-21, superseding d-a62f4abc): pre-merge runs only the fast tier, `node scripts/affected-suites.js --base <develop> --head <merge-sha> --fast --run`; the full affected run is `scripts/post-merge-suite.sh` after the push. The full suite before a release tag is unchanged.
