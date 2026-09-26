# Rubric — 2026-09-26-hook-advisories-reach-model.md

> Source plan: docs/plans/2026-09-26-hook-advisories-reach-model.md

R1: Node ≥ 20.10, built-ins only. Every hook stays fail-open (an internal error ⇒ exit 0, no stdout).
R2: Advisory text is BYTE-IDENTICAL to today's stderr text. Never add or remove wording.
R3: An advisory path never emits `permissionDecision` (an `"allow"` auto-approves the tool call, which was the v2.36.97 lesson). Deny/ask/exit-2 paths are untouched.
R4: Each hook gets its own small inline emitter (no shared runtime module between hooks; this keeps single-crash isolation, per the foreman-guard/context-budget header notes).
R5: New cases go in NEW suites. Existing suites change only on the §5 list.
R6: Do not edit CHANGELOG, the version, or `.claude-plugin/plugin.json` in implementation commits; depth-0 lands the release.
R7: 🟠 **Advisory spam in context**: a hook that nudges every call now costs tokens every call. Every group-T hook already rate-limits (cost-fuse per multiple, context-budget per tier/interval,
R8: 🟠 **Multiplexer merging**: several opt-in children emitting JSON could clobber each other. P1 verifies and merges.
R9: 🟡 **The relay is new default-on surface**: it is inert with an empty queue, and fail-open on corruption.
R10: Inversion: what guarantees failure? Emitting `permissionDecision:"allow"` to carry text, using Stop `additionalContext`, or changing advisory wording. All three are forbidden in §2.5.
