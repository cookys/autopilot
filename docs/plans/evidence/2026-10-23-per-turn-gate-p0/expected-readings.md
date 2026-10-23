# P0 expected readings (written and committed before any run)

CLI 2.1.309 (owner d-ea7857ea re-pin), alias claude-haiku-4-5, cost cap 6 USD, per trial 30 min, whole P0 4 h.

- Step 0 control (plugin hooks loaded with --plugin-dir in a credentials-only config dir): the hook trace lists the five plugin Stop hooks executing, and cost-tracker writes `$HOME/.claude/metrics/costs.jsonl` (HOME is a scratch directory per run, because cost-tracker uses os.homedir()).
- Step 0 isolated: the trace lists only the throwaway hook; no file appears under `$HOME/.claude/metrics`.
- A0: Stop hook called once, session stops.
- A1: the hook is called a second time; call 2 carries stop_hook_active true; the model continues after the block (replies ALPHA).
- A2: the second block is honored (the model replies BETA after ALPHA); a third call is allowed.
- B0: never blocks (same configuration as A0). B1: counter N=2, exactly two blocks, the third call allows the stop.
- C0: subagent stops normally. C1: a SubagentStop block makes the subagent continue.
- Throwaway hook: scratch node script, decision from a counter file `remaining`, logs stdin, stdout and decision per call.
