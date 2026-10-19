# BL-0254 — t14 batch driver infra re-run and mid-run OAuth

File: `evals/orchestration/run-t14-gate-batch.js`.

Defect 1: runs that ended in infra failure were not re-run per the plan. The driver ran attempt 1 only and printed DONE.

- G-15 attempt 1: `runner_timeout`, 641 s, 1 turn done.
- C-16 attempt 1: `runner_error`, 335 s, 4 turns.

Defect 2: auth is probed only before each run starts, so an OAuth expiry in the middle of a run is classified `runner_error` and does not stop the driver. C-16 text: "Failed to authenticate: OAuth session expired and could not be refreshed".

Evidence: `docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report-r2.md`.

Source: t14 second experiment batch, 2026-10-20. Depth-0 did not supplement that batch (closed decision rule; 29 valid runs per arm already meet 27; infra rate 3.3% is under 10%).
