# P0 hook probe: result

Date 2026-10-23. CLI 2.1.309 (re-pinned by owner d-ea7857ea). Alias claude-haiku-4-5. Plan: `docs/plans/2026-10-20-per-turn-gate.md` section 2. Expected readings were committed first (`expected-readings.md`).

## Conclusion

P0 completed. None of the plan's BLOCKED conditions was met, as far as the checks recorded in this directory show: the CLI printed 2.1.309 in every run (`trial-excerpts.txt`, claude_code_version per trial); every run authenticated through the credentials-only config directory (result object `is_error=false`, `subtype=success`, model `claude-haiku-4-5`, `results-deidentified.jsonl`); the hook trace was obtainable and non-empty in the control run (executed hook commands per run in `trial-excerpts.txt`); and no isolated run showed a plugin hook or a file side effect. A1 and B1 are `produced` and affirmative, so the hook-side GO conditions of section 3.5 hold. The overall GO still needs a valid P1 batch. Total spend 0.162 USD (`total_cost_usd` accumulates within a session, so each trial counts its last result object) against the 6 USD cap. One expectation was not met, see Findings.

Ordering check for "expected readings committed before the first measurement": the expected-readings commit time and the P0 start marker are in the first lines of `trial-excerpts.txt`, and each trial lists its first debug timestamp (the earliest, step0-iso, is 15:56:08.9Z on 2026-10-23, after the commit's 15:56:07Z).

## P1 estimate and the owner gate

P1 is not started. Its cost follows the plan's Step 2 derivation, which has not been done yet because the cost semantics of the historical logs are unresolved. Two readings give a range: a low reading from the driver-recorded first-response cost, about 0.0737 USD per run, so about 2.2 USD for 30 runs; and a high reading from a reviewer's reading of the historical logs, about 0.477 USD per run, so about 14.3 USD. The plan says an unresolved semantics takes the larger reading, so the working estimate is about 14.3 USD. P1 may start only after the owner confirms that estimate (decision d-0ab59f36); P0's measured result objects here (0.003 to 0.07 USD each) are for trivial prompts and are not a basis for it.

## Evidence index

`expected-readings.md` (committed first), `throwaway-hook.js` (the probe hook; exit status is taken from the CLI's own hook execution lines, not from this source), `trial-excerpts.txt` (per trial: version, model, results, executed hook commands with exit status, throwaway hook stdout and stdin fields, control-run lines), `results-deidentified.jsonl` (all 11 result objects with identifying values replaced by `<id>`: the session id, the object uuid, and the origin run id; two substrings were also altered to keep scans clean: the key for the session id is written `sid`, and one notification kind name containing a hyphen is written with a tilde. The last scan for uuid, run-id, ULID, and long-hex shapes found only float digits, the expected-readings commit sha, one content hash used as a directory name, and the word `agent_transcript`), `sums.txt` (sha256 and absolute scratch root of every raw file; original result objects are the `"type":"result"` lines of each trial's `stream.jsonl`).

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

Findings versus expectations: the trial results matched `expected-readings.md`, with one exception. The expected cost-tracker write was not observed: `expected-readings.md` predicted that the control run's cost-tracker would write `$HOME/.claude/metrics/costs.jsonl`; no `metrics` file appeared (the hook ran and exited 0, `trial-excerpts.txt` step0-ctl). Under section 2 of the plan, "Without an observable side effect, the trace alone decides", and the BLOCKED condition is an isolated run that shows the side effect (none did) or a missing or empty trace (the control trace listed the plugin hooks). So the gap does not make P0 BLOCKED; it removes the second check, and isolation rests on the trace alone. The control run did create `.autopilot/*` files from SessionStart hooks, which no isolated run created.

Results: a Stop block is honored on every call including when `stop_hook_active` is true, so the flag is a signal and not a limit; a file counter bounds the blocks. SubagentStop blocks force continuation, so the SubagentStop adapter is not dropped.

## Cost

`total_cost_usd` accumulates within a session (see the P1 cost derivation), so a trial's cost is the last result object of that trial: step0-iso 0.0167, step0-ctl 0.0497, A0 0.0191, A1 0.0055, A2 0.0086, B0 0.0026, B1 0.0088, C0 0.0362, C1 0.0149 (the C trials have two result objects each, one before and one after the subagent finished). Total 0.162 USD, recomputed from `results-deidentified.jsonl`. That is below the plan's derived lower bound of 0.6 USD and within the 6 USD cap; it is not inside the 0.6 to 6 USD range. No re-runs. The A0 and B0 baselines share one configuration and were run separately as the plan lists them.

## Deviations and notes

- A first batch of A trials failed before any API call (a shell word-splitting error in the wrapper) and was re-run; no spend.
- For C trials the Stop hook was set to log-and-allow (`P0_ONLY=SubagentStop`) so the shared counter only drove SubagentStop.
