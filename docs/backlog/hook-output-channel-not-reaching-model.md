# failure-escalation hook output never reaches the model

BL-0304. `hooks/failure-escalation.js` is registered on PostToolUse (hooks/hooks.json) and prints plain-text stdout with exit 0. Per https://code.claude.com/docs/en/hooks, PostToolUse exit-0 plain stdout goes to the debug log only; the model sees nothing. To reach the model use JSON `hookSpecificOutput.additionalContext`, or exit 2 with stderr.

Plan: inventory every registered hook's output channel; convert those that need the model to see their output to JSON additionalContext; ship each with a negative control (a plain-stdout variant must be shown not delivered, red before green). Mechanism fix, not a guidance change (CLAUDE.md mechanism-vs-guidance). Depends on BL-0241 guard-port Phase 1 merging first (same file).
