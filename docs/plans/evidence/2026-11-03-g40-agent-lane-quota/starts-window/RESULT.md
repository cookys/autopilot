# starts_window experiment: minimax and glm (2026-11-03)

One tiny probe per provider (`max_tokens 8`, prompt `ok`), window read before and at +5 s and +60 s. Raw (redacted) responses: `glm.txt`, `glm-retry-aborted.txt`, `glm-retry.txt`, `minimax.txt`. Times are UTC.

| Provider | T0 idle? | Probe sent | T0 resets_at / utilization | T1 (+5 s) | T2 (+60 s) | Conclusion | Evidence |
|----------|----------|------------|----------------------------|-----------|------------|------------|----------|
| glm | first attempt 16:16:12: no (5h entry used 2 %, resets 16:24:50). Retry 16:27: yes (5h entry has `percentage` 0 and NO `nextResetTime`) | 16:27:20.059, glm-5.2, usage in 13 / out 8 | none (field absent) / 0 % | `nextResetTime` 21:27:20.874 / 1 % | same 21:27:20.874 / 1 % | STARTS the window: reset = probe time + 5 h + 0.8 s | `glm-retry.txt` lines 2-9; `glm.txt` lines 2-4 |
| minimax | no: general window 15:00-20:00 grid, 87 % remaining, `usage_count` 0 | not sent | end_time 20:00 / remaining 87 % | n/a | n/a | PENDING: retry scheduled 20:03Z (first read after the grid boundary) | `minimax.txt` lines 2-4 |

## glm: which limits entry is the 5 h window
`TOKENS_LIMIT` with `unit` 3 / `number` 5. Evidence: it is the only entry that reset on its own at 16:24:50 (first attempt T0 shows that reset time, the retry read shows the entry with no `nextResetTime` and 0 %), it then reappeared with a reset exactly 5 h after the probe, and the other `TOKENS_LIMIT` (`unit` 6 / `number` 1, 12 %, reset 2026-11-06) and `TIME_LIMIT` (reset 2026-12) did not move.

## Calls actually sent
glm: 1 probe; window reads 5 (first attempt T0; retry T0 aborted by a script bug on a missing `nextResetTime` before any probe; retry T0 rerun, T1, T2). One extra read over the budget, caused by that bug, no extra probe. minimax: 0 probes, 1 read so far.

## Notes
- minimax `start_time`/`end_time` look like a fixed 5 h grid (15:00-20:00Z, aligned to the hour), not a rolling window from first use; `usage_count`/`total_count` stay 0 while `remaining_percent` moves (87 %), so the usage-count idle test cannot be trusted; remaining percent is the usable signal.
