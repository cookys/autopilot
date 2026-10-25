# P2-3r (Haiku 4.5 rerun): label U (unusable)

Wrapper `run-p2-batch.js` (sha256 `773ecd3c3449d17e4d4cd2194b3934e66cd3f7e7e8e65f174a930d63debfd859`), manifest `docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r/manifest.json`, run directory `/home/cookys/.autopilot/bl0055-p2-3r/run`, started 2026-10-24T22:34:45Z (2026-10-25 06:34 Taipei time).

- Label: **U**. The batch is not counted in any verdict. Owner decision d-3acc8c4e: repeat the Haiku 4.5 batch with a new preregistration (`docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r2/`).
- Stop: `STOP_COST before C-06 arm=C projected=18.6463 cap=18` (exit 5), after 11 runs had started and finished (C 5, ON 6; the next id was the 12th position, C-06). `COMPLETE ON=6/30 C=5/30`.
- Spend: C 2.9004 USD, ON 4.9882 USD (runs plus probes).
- Cost per run and per probe, from the `COST` rows of `invocation.log`:

| id | run | probe |
|---|---|---|
| ON-01 | 0.665087 | 0.021927 |
| C-01 | 0.729735 | 0.021242 |
| ON-02 | 0.955344 | 0.021122 |
| C-02 | 0.636597 | 0.020622 |
| C-03 | 0.450231 | 0.020902 |
| ON-03 | 0.634277 | 0.021077 |
| ON-04 | 1.026896 | 0.020787 |
| C-04 | 0.581119 | 0.022122 |
| C-05 | 0.396866 | 0.020982 |
| ON-05 | 0.598233 | 0.021647 |
| ON-06 | 0.980221 | 0.021552 |

- Root cause: the caps were taken over from the 2026-10-24 design (C 18, ON 30), where the expected C cost (17.57) left only 2.4 percent below the cap, and the ON projection at the time of the stop (26.76) left 12 percent. Once five C runs had finished, the projection of the C arm (18.6463) exceeded 18 although nothing had gone wrong: the cost of a run varies from 0.40 to 0.73 for C and from 0.60 to 1.03 for ON, and the cap had no room for that. The wrapper behaved as preregistered.
- Not recorded here: no score and no comparison between the arms was looked at or is written down.
- Next: the preregistration `2026-10-25-per-turn-gate-p2-3r2` sets the caps at about 1.5 times the expected arm cost (C 26, ON 40) derived from the cost figures above; wrapper, launcher and harness are unchanged.

## Audit output

Command, run in `/home/cookys/.autopilot/bl0055-p2-3r/clone` (the run directory was not modified):

```
node evals/orchestration/run-p2-batch.js --audit --manifest docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r/manifest.json --run-dir /home/cookys/.autopilot/bl0055-p2-3r/run --clone .
```

Output (exit 1):

```
AUDIT FAIL: terminal row present: STOP_COST
AUDIT FAILED (1)
```
