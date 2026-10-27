# findings-batch Haiku pilot (2026-10-26)

Not scored. Not used for V2 or V3. The pilot checks wiring only (plan section 4); Haiku results say nothing about Sonnet.

- Run: `run-fbatch-campaign.js --runner cc --pilot`, model Haiku, CLI `2.1.309 (Claude Code)`, 2026-10-26 about 02:50 Taipei (UTC+8), ONOFF_MAX_USD 3.
- Raw rows: `evals/skill-onoff/results/fbatch-pilot.jsonl` (+ `.runner-pin`). The rows keep the cost the old runner computed (`cost_usd`, every result added); the table below recomputes it. Per-cell transcripts: `/home/cookys/.autopilot/fbatch-pilot/run/pilot.jsonl.cells/` (outside the repo).

## Cells

| task | arm | markers true | skill_invoked | row | cost, old algorithm (USD) | cost, new algorithm (USD) |
|------|-----|--------------|---------------|-----|---------------------------|---------------------------|
| fb-mid-batch | base | m_early_repair | true | scored | 0.021332 | 0.012205 |
| fb-mid-batch | change | m_waited, m_clean_proceeds | true | scored | 0.043323 | 0.016189 |
| fb-pool | base | m_serial_repairs | true | scored | 0.020781 | 0.011334 |
| fb-pool | change | none | true | scored | 0.013886 | 0.007703 |
| fb-deadman | base | m_rejected_draft | true | infra_fail / runner_timeout (601 s) | 0.003998 | 0.003998 |
| fb-deadman | change | none | true | infra_fail / runner_timeout (600 s) | 0.004164 | 0.004164 |
| total | | | 6/6 true | | 0.107484 | 0.055593 |

New algorithm = the last `total_cost_usd` of each `session_id`, summed over sessions (`node evals/skill-onoff/fbatch/cell.js cost --transcript <file>`).

Correction to the hand-off note: the two `fb-deadman` cells are NOT clean. Both ended as `infra_fail` / `runner_timeout` after the 10-minute limit (their transcripts end with 8 turns and a `success` result costing about 0.004 USD, so the agent stopped early and the cell then waited out the timeout). They are not counted here. Cause (found by depth-0 from the transcript): the agent polled `wait-dispatch-results.js` once, a `sleep 240` was blocked by a hook, then it waited for `runs/run.impl.exit` with a Monitor (`until [ -e ... ]`) and ended its turn. `claude -p` waits for the Monitor, but the fixture landed the exit file only on the 3rd poll, which the agent never made, so the cell ran into the 600 s timeout. Waiting for the file is a legitimate way to wait; the fixture was unrealistic. Fixed by prereg amendment 2 (events also land by a timer, `cc.land_after_s` 90).

## Findings

F1. `total_cost_usd` is the cumulative spend of the session. fb-mid-batch/change holds three results of ONE session (`5bfd42b3-93b9-4994-9552-593716dd57b4`): 0.012941 (19 turns), 0.014193 (2 turns), 0.016189 (3 turns). Each later figure exceeds the previous one by about what that call used. Adding all three gives 0.043323, the last one alone 0.016189 (the real spend). The same pattern holds for the other two-turn cells (base 0.009127 then 0.012205, and so on).

F2. The budget stop is a result with `subtype: "error_max_budget_usd"`, `is_error: true`, `errors: ["Reached maximum budget ($0.0001)"]`, exit 1 (depth-0 probe, same CLI). The check runs after a call: a 0.0001 USD cap spent 0.0016 USD, one model call over.

## Estimate

The prereg `cost_per_cell_usd` (Sonnet) is unchanged. The pilot ran Haiku, so its spend (0.056 USD for 6 cells, about 0.009 per cell) cannot be turned into a Sonnet price.
