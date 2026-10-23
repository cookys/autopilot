# P1 rerun preregistration (replaces the first batch)

This note **replaces the first P1 batch**, which was INVALID (label U: authentication expiry at C-27/C-28, 26 of 30 runs complete, C-29 and C-30 unlaunched; evidence in `docs/plans/evidence/2026-10-24-per-turn-gate-p1/`, branch hands/p1base/1, not modified here). Owner decision d-695f28d5: rerun the whole batch of 30, new cap 18 USD counted separately from the first batch, never raised. Committed before the first call of the rerun, on branch hands/p1rerun/1 from efe6113c3.

## Unchanged from the first preregistration

Everything in `docs/plans/evidence/2026-10-24-per-turn-gate-p1/preregistration.md` applies unchanged: the exact harness command per id (task t14-constraint-horizon, arm off, runner cc, model claude-haiku-4-5, gate observe, via run-orchestration-eval.sh, no batch driver), ids C-01 to C-30 each launched once in order, sequentially, in one window of at most 8 hours; metrics M1, M2, M3 from the first JSON object of oracle.log; validity checklist and labels A to D and U (plan section 3.3); candidate table rules (3.4); GO rule (3.5); the dedicated credentials-only HOME, env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID, no dispatch scripts. Task hashes: `taskhash.pre.txt` is byte-identical to the first batch listing and to the experiment-2 frozen map. CLI 2.1.309.

## Changes in the wrapper (both written here, before any call)

(a) Before every id the wrapper deletes the id private home and copies a fresh `~/.claude/.credentials.json` into it; that home is used for the probe and the run; no copy is reused across ids.
(b) Before every id a minimal authentication probe runs (the same call as the first batch probe: haiku, input "Reply with exactly AUTH_OK", about 0.0166 USD). If the probe fails (exit code, is_error, or no AUTH_OK) the id is **not launched**, the wrapper exits 7 and the batch is paused; the owner re-logs in and the same id is then resumed, so each id is still launched once. Probe spend, failed ones included, counts against the cap. Pause time counts inside the 8 hour window (started at the wrapper first start, window.start); an id would not start after 28800 s (STOP_WINDOW, exit 8), which makes the batch U under section 3.3.
(c) The wrapper takes the run directory and clone from environment variables and holds no scratch path. A run that itself ends with an authentication error (the probe passed but the session expired inside the run) stops the batch (STOP_AUTH, exit 6): that run is an infra failure counted per section 3.3 and no further id is launched.
Wrapper: `p1-wrapper.sh` sha256 3654620b37e9d3d687bcbdf2b398df1b2681779710cd02c11b325aa47fe65380.

## Cap and stop rule

Per id cost estimate 0.5453 (larger historical mean, see the first batch cost-derivation.md) plus 0.0166 probe. Before every id: spent runs + spent probes + remaining ids (this one included) x (0.5453 + 0.0166) must not exceed 18 USD, else STOP_COST and the remaining ids stay unlaunched (U). Full estimate 30 x 0.5619 = 16.86 USD, headroom 1.14 USD (about 1.7 standard deviations of a 30-run total, 0.68). A run cost is the last result object total_cost_usd.

## Scoring discipline (added after review of the first batch)

M1, M2, M3 are recomputed per run from the raw oracle.log by two independent methods (a JSON parse of the first object, and a text match on the features_pass and constraints_pass lines), and compared with the table and with the README numbers before the conclusion is written; M3 must equal M1 and M2 per run; any mismatch is resolved from the raw logs first. invocation.log is only transformed by replacing scratch paths with the token <scratch>.

## No outcome seen

No call of the rerun precedes this commit.
