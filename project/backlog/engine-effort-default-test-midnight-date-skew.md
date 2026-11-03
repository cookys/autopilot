# engine-effort-default.test.sh goes falsely red 4 cases from 00:00 to 01:00 UTC (BL-0345)

The fixture uses `now - 1h` as the issued time but the date of `now` as qualified_at. Across UTC midnight the two dates differ and the check reports "scorecard qualification date does not match capability evidence". Reproduced 2026-10-31 Taipei 08:40 on develop 7a5bd925d; green after 09:00.

Fix: derive both from the same instant.
