# Result: M plan-review ON vs OFF (P0)

Verdict: `P0: ON 21 vs OFF 8, bar ON-OFF >= 5 and quality within 2, PASS` (defects caught, max 30 per arm; quality ON 30 vs OFF 29 of 30).

Conclusion limits: 10 paired cells, each run once, regex scoring, one cheap reviewer seat. This is a go/no-go screen, not an effect size. The task-specific trap D1 was 7/10 in both arms, so P5 acceptance must measure the D1-class catch rate on real M tasks after it ships (PM ruling 01M7RW00).

Pack and bar frozen in commit `349b07e6a` before any scored cell ran. 10 paired cells, run once. Seats: author/reviser codex `gpt-6.2-sol` low; reviewer agy `gemini-4-hydrogen-high` (no fallback was used; every attempt was the reviewer seat, success).

| task | defects OFF | defects ON | quality OFF | quality ON |
|---|---|---|---|---|
| T1 wrong file | 2/6 | 5/6 | 6/6 | 6/6 |
| T2 dangling dependency | 2/6 | 5/6 | 6/6 | 6/6 |
| T3 wrong command | 0/6 | 2/6 | 5/6 | 6/6 |
| T4 generated file | 2/6 | 3/6 | 6/6 | 6/6 |
| T5 irreversible step | 2/6 | 6/6 | 6/6 | 6/6 |
| total | 8/30 | 21/30 | 29/30 | 30/30 |

Run ids (review session ids, one per cell; per-cell plans, review JSON and scores under `results/<task>-r<rep>/`): T1 `onoff-T1-r1-2524419`, `onoff-T1-r2-2944181`; T2 `onoff-T2-r1-2524420`, `onoff-T2-r2-2944182`; T3 `onoff-T3-r1-2524421`, `onoff-T3-r2-2944183`; T4 `onoff-T4-r1-2524422`, `onoff-T4-r2-2944184`; T5 `onoff-T5-r1-3355467`, `onoff-T5-r2-3355468`.

## Read this before relying on the PASS

- The gain is almost entirely the shared defects D2 (negative control) and D3 (scope), which the generic rubric names: D2+D3 caught 1 (OFF) vs 14 (ON) of 20. The task-specific trap D1 was caught 7/10 in both arms: the review did not change it. So ON shows the review makes the author add negative controls and scope sections; it does not show it finds hidden task-specific defects (the author already read the fixture). The bar was met on the rubric-driven classes, as the README stated it would be.
- T3 D1 missed in both arms by the scorer: in r2 the revised plan satisfied `npm test`/`npm run lint` by adding those scripts to package.json (a valid-looking fix the regex counts as a miss; conservative toward ON). T4 r2 got READY (0 findings); no change.
- Instrument defect and rerun: the first T5 cells never ran the review (`db/schema.sql` is not an allowed `--context-file` extension, exit 2, ON plan was a redraft with no findings). They are discarded (not in results); run.js now skips `.sql` context files and T5 was rerun (the ids above). No scorer, bar or other task changed.
- n = 10 cells, one rep each pair, text-regex scoring, single low-cost reviewer seat, one generation: a go/no-go screen, not an effect size. Cost: codex low and agy cheap seats only; no on-demand spend.
