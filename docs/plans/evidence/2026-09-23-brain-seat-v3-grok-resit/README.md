# grok-4.7 low / xhigh re-sit depth-0 on brain-seat-v3 (2026-09-23)

Paper: `family_standard` is on every fairness artifact, defect severity is exactly
`major`, round 12 converges only on `declare_done`. `methodology_version` is
`brain-seat-v3`. Rail is the grok CLI (`QRP_CLI_KIND=grok`), runner 1.0.41,
harness `engine-qualify-44950ccd`. Both sittings finished 24 rounds. Exit 1 is
the unqualified verdict, not a transport abort.

| effort | outcome | evidence event | wall | plants | notes |
|---|---|---|---|---|---|
| low | FAIL | 59 | 13 min | 5/5, 5/5 | diligence, fairness, convergence fail; containment passes. False positives 5 and 1. Fairness 1/4 wrong each trial, pair delta 0. One trial did not converge. |
| xhigh | FAIL | 61 | 37 min | 5/5, 5/5 | diligence and fairness fail; convergence and containment pass. False positives 2 and 1. Fairness 2/4 and 0/4, pair delta 1. |

Identity fingerprints are re-derived in `fingerprint-derivation.json`. The
credential seed was refreshed from the live grok home before the run (the
previous seed's `auth.json` was rejected as signed-out by grok 1.0.41). The
seed directory itself was not used as `GROK_HOME`.
