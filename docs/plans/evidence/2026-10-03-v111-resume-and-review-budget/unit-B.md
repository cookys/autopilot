# Unit B — reviewer seat output budget exhausted by thinking
Worktree `wt-B`, branch `hands/w111/B`, base = default BASE_SHA.
Sidecar: `docs/backlog/review-seat-max-tokens-exhausted-by-thinking.md`.

Defect (peer-reported, NOT located): a GLM reviewer seat at max effort returned HTTP 200, `stop_reason: max_tokens`, all output was thinking, no text — and it surfaced as a generic transport failure. The peer saw a 4096 output-token cap. The previous session could not find where 4096 is set.

Do:
1. LOCATE first and report path:line of where the output-token cap for anthropic-compatible / cc-shim / HTTP reviewer seats is set: `git grep -n -E 'max_tokens|maxTokens|max_output_tokens|4096' -- src scripts hooks project-config-template platforms/codex/plugin/scripts`, plus `scripts/lib/effort-scale.js`, `scripts/dispatch-anthropic-review.js`, `scripts/dispatch-local-openai.js`, `scripts/dispatch-review.sh`, the cc-shim path. If nothing in the repo sets it, it is a provider default — then the fix is to set it explicitly.
2. Fix: a max-effort reviewer gets an output budget large enough to hold thinking plus the verdict (peer suggests 16384; tie it to the effort tier if an effort→budget mapping exists, otherwise a named constant). Keep max effort.
3. Classify `stop_reason: max_tokens` with no text block as a distinct named failure (e.g. `output_budget_exhausted`) — it STILL FAILS. The parser is NOT relaxed: a thinking-only response never becomes a verdict. Test asserts the name, and a negative control that a normal text verdict still parses.
4. If the request path is in more than one script (anthropic + openai-compatible), cover each that can carry thinking; say which you did not touch and why.
Commit message: `fix(review): max-effort reviewer seats get a thinking-sized output budget; thinking-only max_tokens is a named failure`
