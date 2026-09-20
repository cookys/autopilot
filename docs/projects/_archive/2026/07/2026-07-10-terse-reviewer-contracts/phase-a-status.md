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

## Ledger (Phase A COMPLETE)

| Unit | Runner | Model | Verdict | Artifact @sha | Rounds |
|------|--------|-------|---------|---------------|--------|
| project-tracking | (foreman) | — | committed | 5b8a9f6 | — |
| Unit 0 (harness) | agy author + codex review | gemini-3.5-flash + gpt-5.5 | SHIP-AS-IS | 4cf60d3 | — |
| Unit 1 (dispatch-review.sh) | grok + codex | grok-4.5 + gpt-5.5 xhigh | SHIP-AS-IS | bbcf192 (grok 38a2fff) | 1 |
| Unit 2 (reviewer.md) | grok + codex | grok-4.5 + gpt-5.5 xhigh | SHIP-AS-IS | 3637646 (grok d484635) | 1 |
| Unit 3 (code-review.md) | grok + codex | grok-4.5 + gpt-5.5 xhigh | SHIP-AS-IS | 29f1bc4 (grok 77e3425) | 1 |

## Token/line reductions (contract surface)

| Contract | Lines b→a | Tokens b→a (~char/4) | Δ% |
|----------|-----------|----------------------|----|
| dispatch-review.sh prompt heredoc (per-dispatch reviewer prompt) | — | ~353 → ~296 | −16% |
| dispatch-review.sh (whole file) | 640 → 637 | ~8966 → ~8921 | −0.5% |
| agents/reviewer.md | 242 → 222 | ~4926 → ~4095 | −17% |
| code-review.md | 331 → 322 | ~6571 → ~5631 | −14% |

Reviewer-read contract surface (reviewer.md + code-review.md) total: ~11497 → ~9726 tokens (−1771, −15%).

## Gates (all green)

prompt-skeleton test 11/11 · dispatch-review.test.sh 129/129 · check-canonical-invariants 22/22 (OK) ·
validate.sh OK · codex-plugin-package 67/67 · codex mirror in-sync · agent-body parity OK.
Pre-existing unrelated failure: contract-parity.test.sh anthropic-compatible (fails identically at
pre-foreman base bb2518c, 0 reviewer.md refs — NOT introduced by Phase A).

## Next step

Phase A complete. Depth-0 phase checkpoint → Phase B (M3 measurement legs): paired baseline/slimmed
known-bad + clean legs (gemini-3.5-flash via agy), injection breakout, weak-tier claude-haiku probe.
NOT run by this foreman.
