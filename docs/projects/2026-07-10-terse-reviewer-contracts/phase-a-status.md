# Phase A — live status ledger

> Foreman depth-1. Updated as units progress. If the foreman stops, this file states the next step.

## Deviation recorded (Unit 0 design)

Brief's Unit-0 test spec says the assembled `dispatch-review.sh` prompt contains the severity legend
(🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion) and a code-review.md Invocation-§ reference line.
**It does not** — verified by capturing the real assembled prompt via the `--bin` stub seam (see
`evals/reviewer-bench/prompt-skeleton.golden`). The current template is a minimal
"You are a code reviewer … VERDICT/FINDINGS + nonce wrapped-block markers + diff payload". A test asserting
the severity legend / Invocation-§ line would be RED on current contracts, contradicting the brief's
"must be GREEN before slimming" requirement, and adding those to the dispatch-review prompt would violate
plan §6 (no severity-vocab change; no new canonical statement of what reviewers read).
**Resolution**: the skeleton test asserts the elements ACTUALLY present (nonce wrapped-block BEGIN/END
markers, reviewer instruction, VERDICT/FINDINGS contract, diff payload) AND byte-diffs the normalized
captured prompt against the committed golden skeleton — the golden diff is the load-bearing drift
protection for the Unit-1 byte-compatible-parser requirement. Recorded for depth-0.

## Ledger

| Unit | Runner | Model | Verdict | Branch@sha | Rounds |
|------|--------|-------|---------|-----------|--------|
| project-tracking | (foreman) | — | committed | — | — |
| Unit 0 (harness) | agy + codex(review) | gemini-3.5-flash + gpt-5.5 | pending | — | — |
| Unit 1 (dispatch-review.sh) | grok + codex | grok-4.5 + gpt-5.5 | pending | — | — |
| Unit 2 (reviewer.md) | grok + codex | grok-4.5 + gpt-5.5 | pending | — | — |
| Unit 3 (code-review.md) | grok + codex | grok-4.5 + gpt-5.5 | pending | — | — |

## Next step

Unit 0 authoring dispatch (gemini-3.5-flash via dispatch-author) for the skeleton test + expected-sections.
Golden skeleton already generated mechanically.
