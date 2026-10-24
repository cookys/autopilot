# t14 long-horizon per-turn verification gate

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: A new plan for a follow-up round, decided by the owner.
- **Context**: Per-turn re-injection moved vocabulary but did not produce a statistically conclusive behavior lift. The untested lever is mechanical verification at every turn: reject constraint-violating output and force a bounded retry. Keep this distinct from re-injection and measure against the existing t14 baseline.
- **Effort**: M.
- **Source**: docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report.md (prior docs/projects/_archive/2026/07/2026-07-08-t14-reinject/report.md already corrected)


## Status 2026-10-25

First P2-3 batch (2026-10-24) judged U (credential copy expired, nobody resumed within the window): docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/RESULT.md. Instrument fixes merged 563768f30. Haiku 4.5 rerun started 2026-10-25 06:34 Taipei, PREREG docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r/. A Haiku 5.5 batch follows, PREREG docs/plans/evidence/2026-10-25-per-turn-gate-p2-3-h55/.
