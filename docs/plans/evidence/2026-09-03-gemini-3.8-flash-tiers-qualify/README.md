# gemini-3.8-flash low / medium / high (agy 1.1.25) implementer qualification — all three QUALIFIED 24/24 (2026-09-03)

Three administrations in one `qualification-sweep.sh` run (roster.json), same generator / corpus /
grader pins as the 2026-08-22 sweep. Purpose (Board 2026-09-03): compare the three reasoning tiers
on speed; the rail is the same `dispatch-hetero.sh --runner agy` path as 2026-08-22, now with
v2.35.13 (a malformed native envelope is telemetry loss, not a verdict).

| Seat | Result | Event | Seat wall | Per-case wall min/median/p90/max | Total tokens (24 cases) |
|---|---|---|---|---|---|
| `gemini-3.8-flash-low` (effort low) | **24/24** | 188 | 410 s | 15 / 25 / 34 s (sum 387 s) | 1.21 M |
| `gemini-3.8-flash-medium` (effort medium) | **24/24** | 189 | 592 s | 21 / 43 / 46 s (sum 571 s) | 1.46 M |
| `gemini-3.8-flash-high` (effort high) | **24/24** | 190 | 797 s | 26 / 63 / 77 s (sum 775 s) | 1.68 M |

- **Identity**: engine/model/model_version = the exact `agy models` id (tier is IN the id, as on
  2026-08-22); runner `agy` 1.1.25, family `google`, effort label = the tier (2026-08-22 seats
  labelled every agy tier `high`; this run labels honestly). harness `dispatch-hetero:219de2a6`.
- **Envelope**: all 72 dispatches returned a VALID native envelope (usage parsed on 24/24 per seat).
  The 2026-08-22 "agy native JSON envelope invalid" signature (gemini 3.7 / 3.1 on agy 1.1.17,
  create-a-new-file tasks) did not reproduce on agy 1.1.25 + 3.8; the v2.35.13 downgrade was
  therefore not exercised here, and the BACKLOG row's reproduction sample is still owed.
- **Reading**: accuracy is identical (zero-tolerance bar, all 24/24); speed and tokens scale with
  the tier — low is ~1.9× faster and ~28 % cheaper in tokens than high on this corpus. Against the
  rest of the board (per-case median): flash-next 14 s < flash-3.8-low 15 s < sonnet-5 16 s <
  opus-5 17 s < flash-3.8-medium 21 s ≈ muse-spark-1.3 22 s < flash-3.8-high 26 s ≈ luna 26 s.
- **Construct scope**: same honesty clause as the 2026-08-22 bundles — contract-obedient commit
  production over the rail; nothing about L-size planning or review-loop convergence.
- **Files**: `roster.json`, `sweep-stdout.log`, `qualification-sweep-progress.txt`,
  `flash38-{low,medium,high}-qualify/{probe-receipts.jsonl,qualify-out.json,qualify-err.log,
  record-out.json,record-err.log,raw/}`.
