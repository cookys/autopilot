# Reviewer seats at max effort can spend the whole 4096-token output budget on thinking and return no text

Source: PEER-REPORTED by cuda/chatgpt-tunnel via fleet, 2026-10-03 (message 01M3Z081JVCKEEWJW2SSG5V4CT): GLM seat HTTP 200, `stop_reason: max_tokens`, all output was thinking, no text → transport failure. Not yet verified locally (where the 4096 is set was not found by a quick grep of `scripts/dispatch-review.sh` / `src/runners`).

- **Trigger**: FIRED — queued; first locate where the output-token cap for anthropic-compatible / cc-shim reviewer seats is set and reproduce with a stub that returns thinking-only + `stop_reason: max_tokens`.
- **Context**: a max-effort reviewer needs a larger output budget (peer suggests 16384) while keeping max effort; the parser must NOT be relaxed. Also classify `stop_reason: max_tokens` with no text as a distinct, named failure (budget exhausted) rather than a generic transport failure, so the operator can tell it apart.
- **Effort**: S
