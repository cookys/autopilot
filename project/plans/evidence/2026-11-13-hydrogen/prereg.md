# Pre-registration: gemini-4-hydrogen as implementer (PM dispatch 01M79J89, 2026-11-13)

Frozen before any run. Results never change these bars.

Candidate: agy CLI 1.5.7 (already installed; `agy models` lists `gemini-4-hydrogen-{low,medium,high,xhigh}`), model id `gemini-4-hydrogen-high`, the same effort tier as the incumbent `gemini-4-carbon-high`. No CLI upgrade was needed on this host.
Incumbents: agy `gemini-4-carbon-high`; agyclaude.

Switch only if all four hold:

1. Qualification: the reviewer AND implementer cells both pass (engine-scorecard, the same exam agyclaude took: reviewer 42 cases, implementer 24 cases).
2. SWE34 resolved count >= the best incumbent's.
3. Median wall time per task <= 1.1 x the best incumbent's median.
4. Integrity violations = 0.

All three engines run the same SWE34 task set, harness and seed. Recorded per engine: resolved, median seconds per task, integrity violations, quota used.

If all four pass: pace-select puts hydrogen first for implementer, others only when it is behind pace; the fleet-wide CLI rollout goes to hangar (backup, sha16, rollback). Otherwise hydrogen stays a candidate.

Review of the result: agyclaude (PM; not grok, not codex), glm as fallback.

## Addendum (2026-11-13 14:51 Taipei, before the carbon receipt landed)

PM ruling (fleet 01M79TS38TBVA45E0GMH8P6PTD, reply to 01M79TRGEEPHSKDSS77PGGW96W): "the best incumbent" in bars 2 and 3 is the same engine, the incumbent with the most SWE34 resolved. This reading was fixed after the hydrogen and opus results (table sha16 dad034d7) and before carbon's; the verdict waits for carbon's full run.

Fleet-Task: 01M79J89A09KAGP4HCM8KC3G0J
