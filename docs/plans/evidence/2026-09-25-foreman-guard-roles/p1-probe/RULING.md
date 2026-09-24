ADDITIONAL-CONTEXT-IN-SUBAGENT: VISIBLE

The subagent's Bash call (`echo probe`) triggered the PreToolUse hook, which
saw a payload with agent_id `a760facfbc47f92c6` (tool_name Bash) and returned
`permissionDecision: allow` plus `additionalContext: "HOOK-NONCE: a760facfbc47f92c6-7Q4Z"`.
The main agent's final relayed answer (`out.txt`) is exactly
`HOOK-NONCE: a760facfbc47f92c6-7Q4Z` — matching the subagent's own agent_id from
the payload log, confirming the subagent itself saw and reported the nonce
rather than the main agent fabricating or echoing it independently.
A PreToolUse hook's `additionalContext` on an ALLOWED call for a subagent-issued
tool call IS delivered into that subagent's own model context.
