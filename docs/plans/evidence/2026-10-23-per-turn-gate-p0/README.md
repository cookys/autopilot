# P0 hook probe: result

Date 2026-10-23. CLI 2.1.309 (re-pinned by owner d-ea7857ea). Alias claude-haiku-4-5. Plan: `docs/plans/2026-10-20-per-turn-gate.md` section 2. Expected readings were committed first (`expected-readings.md`).

## Conclusion

P0: complete, nothing BLOCKED. Hook-side GO conditions of section 3.5 are met: A1 and B1 are `produced` and affirmative, and P0 ran on the pinned 2.1.309. The overall GO still needs P1's valid batch. Total spend 0.21 USD of the 6 USD cap; wall time about 2 minutes of runs.

## Method (per plan)

Every claude process ran with a dedicated config directory seeded only with a copy of `.credentials.json` (never the real `~/.claude`), HOME set to a per-trial scratch directory (the cost-tracker hook writes under `os.homedir()`), cwd a scratch project whose settings define only the throwaway hook for Stop and SubagentStop (`throwaway-hook.js`, decision from a counter file `remaining`). Trace: `--output-format stream-json --verbose --include-hook-events` plus `--debug hooks --debug-file`. The control run (Step 0) used a second credentials-only config directory and `--plugin-dir <this plugin's checkout>`, the plan's only exception. Raw files stay in scratch; `sums.txt` lists their sha256; `trial-excerpts.txt` has redacted per-trial summaries. Tool availability: `--plugin-dir`, `--debug hooks`, `--debug-file`, `--include-hook-events` all worked on 2.1.309.

## Step 0 isolation

- Control (plugin hooks loaded): the trace lists 6 Stop hooks started and finished (the 5 plugin Stop hooks plus the throwaway one), 4 SessionStart and 1 UserPromptSubmit hooks. The trace can see plugin hooks.
- Isolated: the trace lists exactly 1 hook, the throwaway Stop hook, equal to the throwaway log's call count; no SessionStart or UserPromptSubmit hook. The same holds in every isolated trial (hook_started count equals throwaway log calls).
- Side effect check: no Stop hook produced a file under the scratch HOME even in the control run (cost-tracker wrote no `metrics/` file), so no Stop-hook side effect could be observed and the trace alone decides, as the plan allows. Supplementary: the control run created `.autopilot/last-seen-version`, `.autopilot/.session-handoff.log` and `.autopilot/qualification-prices/*` (SessionStart hooks) which no isolated run created. No isolated run showed a side effect.

## Trials

| Trial | Label | Result |
|---|---|---|
| A0 | produced | Stop hook called once, session stopped; reply OK. |
| A1 | produced | Block on call 1: the hook was called again (call 2) with `stop_hook_active` true; the model continued (reply ALPHA); call 2 allowed the stop. |
| A2 | produced | Blocks on calls 1 and 2 with distinct reasons: the second block was honored (the model replied ALPHA then BETA); call 3 (`stop_hook_active` true) allowed the stop. |
| B0 | produced | Counter at zero, never blocks (same configuration as A0). |
| B1 | produced | Counter N=2: exactly two blocks, the third call allowed the stop. |
| C0 | produced | SubagentStop hook called once and allowed; the subagent replied DONE. |
| C1 | produced | A SubagentStop block made the subagent continue (it replied ALPHA to the block reason); the second call (`stop_hook_active` true) allowed the stop. |

Findings versus expectations: all as expected. A Stop block is honored on every call including when `stop_hook_active` is true, so the flag is a signal and not a limit; a file counter bounds the blocks. SubagentStop blocks force continuation, so the SubagentStop adapter is not dropped.

## Cost

Per-trial `total_cost_usd` (sum of result objects): step0-iso 0.0167, step0-ctl 0.0497, A0 0.0191, A1 0.0055, A2 0.0086, B0 0.0026, B1 0.0088, C0 0.0683, C1 0.0298. Total 0.2091 USD, inside the plan's 0.6 to 6 USD bound and the 6 USD cap. No re-runs. The A0 and B0 baselines share one configuration and were run separately as the plan lists them.

## Deviations and notes

- A first batch of A trials failed before any API call (a shell word-splitting error in the wrapper) and was re-run; no spend.
- For C trials the Stop hook was set to log-and-allow (`P0_ONLY=SubagentStop`) so the shared counter only drove SubagentStop.
