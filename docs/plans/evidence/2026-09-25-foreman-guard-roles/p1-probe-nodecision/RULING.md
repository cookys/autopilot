ADDITIONAL-CONTEXT-IN-SUBAGENT: VISIBLE

The PreToolUse hook fired for the subagent's `echo probe` Bash call with agent_id `add6a9beb696c291a` and returned only `additionalContext` (no `permissionDecision` field) containing `HOOK-NONCE: add6a9beb696c291a-7Q4Z`. The subagent relayed that exact nonce line verbatim as its final reply, and the main agent passed it through unchanged as `out.txt`. This confirms a hook that supplies `additionalContext` with no `permissionDecision` does reach and get surfaced by a foreground subagent's model context.
