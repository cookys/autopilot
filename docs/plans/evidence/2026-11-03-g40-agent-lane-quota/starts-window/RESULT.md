# starts_window experiment: minimax and glm (2026-11-03)

One tiny probe per provider (`max_tokens 8`, prompt `ok`), window read before and at +5 s and +60 s. Raw (redacted) responses: `glm.txt`, `glm-retry-aborted.txt`, `glm-retry.txt`, `minimax.txt`, `minimax-retry.txt`. Times are UTC.

| Provider | T0 idle? | Probe sent | T0 resets_at / utilization | T1 (+5 s) | T2 (+60 s) | Conclusion | Evidence |
|----------|----------|------------|----------------------------|-----------|------------|------------|----------|
| glm | first attempt 16:16:12: no (5h entry used 2 %, resets 16:24:50). Retry 16:27: yes (5h entry has `percentage` 0 and NO `nextResetTime`) | 16:27:20.059, glm-5.2, usage in 13 / out 8 | none (field absent) / 0 % | `nextResetTime` 21:27:20.874 / 1 % | same 21:27:20.874 / 1 % | STARTS the window: reset = probe time + 5 h + 0.8 s | `glm-retry.txt` lines 2-9; `glm.txt` lines 2-4 |
| minimax | no, twice. 15:00-20:00Z window (87 % remaining); retry 20:03:27Z: general window 20:00-00:00Z (99 % remaining, `usage_count` and `total_count` 0) | not sent | end_time 20:00 / 87 % ; retry end_time 00:00 / 99 % | n/a | n/a | NO PROBE SENT. Fixed-grid evidence, `starts_window` leans false (confidence medium); still needs one read in an unused window | `minimax.txt` lines 2-4; `minimax-retry.txt` lines 2-4 |

## glm: which limits entry is the 5 h window
`TOKENS_LIMIT` with `unit` 3 / `number` 5. Evidence: it is the only entry that reset on its own at 16:24:50 (first attempt T0 shows that reset time, the retry read shows the entry with no `nextResetTime` and 0 %), it then reappeared with a reset exactly 5 h after the probe, and the other `TOKENS_LIMIT` (`unit` 6 / `number` 1, 12 %, reset 2026-11-06) and `TIME_LIMIT` (reset 2026-12) did not move.

## Calls actually sent
glm: 1 probe; window reads 5 (first attempt T0; retry T0 aborted by a script bug on a missing `nextResetTime` before any probe; retry T0 rerun, T1, T2). One extra read over the budget, caused by that bug, no extra probe. minimax: 0 probes, 2 reads (first attempt, retry).

## Notes
## minimax: retry at 20:03Z (fixed-grid evidence)
- Facts (read 2026-11-03T20:03:27Z): the `general` window has `start_time` 1793736000 s, exactly 20:00:00Z, and end 00:00Z, so it is 4 h long. `current_interval_usage_count` and `current_interval_total_count` are 0, `current_interval_remaining_percent` is 99. The earlier read (before the retry) showed a 15:00-20:00Z window, 5 h. The `video` row has a window from 1793664000 s (2026-11-03 00:00Z) to 00:00Z the next day.
- Inference: the only basis is that both windows have a `start_time` exactly on a whole hour (15:00:00Z and 20:00:00Z). If a window were started by the first request, its start would fall at the request time and would very unlikely be exactly on the hour. So minimax `starts_window` leans false (a probe does not start the window). Confidence: medium (only two windows observed; the counters give no support, see the method correction).
- To verify: observe the `start_time` of a few more windows, for example one read just after 00:00Z, read only, no probe. If every start is on the hour, confidence can rise to high. To prove it directly, send one probe inside a slot with certainly no usage and see whether `start_time` changes; that waits for the probe policy to be settled.
- Method correction: `remaining_pct` and `usage_count`/`total_count` are both unreliable as idle indicators. The two count fields were 0 in every read, including windows at 87 % and 99 % remaining, so they cannot separate an idle window from a used one.
- This retry sent no probe: the cumulative minimax probe count is still 0.
