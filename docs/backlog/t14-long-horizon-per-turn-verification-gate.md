# t14 long-horizon per-turn verification gate

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the Haiku 5.5 batch (p2-3-h55) finishes and is judged (was, until 2026-10-24: a new follow-up plan decided by the owner).
- **Context**: Per-turn re-injection moved vocabulary but did not produce a statistically conclusive behavior lift. As of 2026-09-14 the untested lever was mechanical verification at every turn: reject constraint-violating output and force a bounded retry. Keep this distinct from re-injection and measure against the existing t14 baseline. Since 2026-10-25 the per-turn gate hook exists, is opt-in (default off), and passed the Haiku 4.5 evaluation (P2-3r2, see Status below); the Haiku 5.5 batch is pending.
- **Effort**: M.
- **Source**: docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report.md (prior docs/projects/_archive/2026/07/2026-07-08-t14-reinject/report.md already corrected)


## Status 2026-10-25

First P2-3 batch (2026-10-24) judged U (credential copy expired, nobody resumed within the window): docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/RESULT.md. Instrument fixes merged 563768f30. Haiku 4.5 rerun started 2026-10-25 06:34 Taipei, PREREG docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r/. As of then, a Haiku 5.5 batch was to follow, PREREG docs/plans/evidence/2026-10-25-per-turn-gate-p2-3-h55/.

P2-3r (Haiku 4.5 rerun, started 2026-10-25 06:34 Taipei) hit STOP_COST before C-06 (predicted 18.6463 > cap 18) and is judged U: docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r/RESULT.md. New preregistration p2-3r2 (caps C 26, ON 40) merged 1c5935da6; started 2026-10-25 13:44 Taipei. As of 13:44 the planned order after it was the BL-0295 eval, then the Haiku 5.5 batch (p2-3-h55).

P2-3r2 (Haiku 4.5 second rerun) judged PASS (merge 670b3ffaf): docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r2/RESULT.md. M3 ON 28/30 vs C 1/30, one-sided Fisher p=1.14e-13; M1 ON 29/30; the M2 trade check was not triggered. Per the preregistration, PASS permits documenting the hook as an evaluated opt-in; it does not decide a default. The Haiku 5.5 batch (p2-3-h55) started 2026-10-25 19:52 Taipei; the BL-0295 eval design is in progress.
