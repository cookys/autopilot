# Rubric — 2026-10-02-final-panel-kimi-agy-isolation.md

> Source plan: docs/plans/2026-10-02-final-panel-kimi-agy-isolation.md

R1: Every platform fact about kimi or agy in the plan is backed by a command-plus-output excerpt in spike-log.md or an official doc URL; anything else is labelled "Spike candidate, unverified" and is not relied on by a phase.
R2: §2.5 states, as flat quotable lines, that tier `none` is never waived, that a seat reaches packet/cleanroom only through a pre-spend probe that proves isolation on this host and fails closed, that pins/overrides cannot bypass containment, and that no trust machinery is added (ADR-0001).
R3: The plan names the achievable tier per runner (kimi, agy) with spike evidence and a rejected-alternative line, and scopes a runner OUT instead of inventing a mechanism if isolation is unprovable.
R4: The pre-spend probe is model-free and receives no repo, HOME, credential or packet; the plan states honestly which guarantees are proven pre-spend (filesystem/process boundary) and which only post-run (tools-off audit).
R5: The post-run audit fails closed: missing wire/transcript/log, unknown record type, any tool call, non-empty tool snapshot, or agent fallback voids the verdict, and exit code 0 is never treated as proof.
R6: Every phase has a dev-flow size, a "done when" acceptance, a RED test failing at base, and a negative control that would pass only if the guard were removed.
R7: Tier tables in `final-panel-qualification.js`, `dispatch-review.sh` and `resolve-review-loop.sh` are updated together with a parity test, and phase ordering prevents intake admitting a seat the dispatch rail cannot run.
R8: Non-blind dispatch behaviour for kimi/agy and codex cleanroom behaviour are stated as unchanged and tested as such.
R9: The `verification_author` pin / unreachable VA pin is explicitly out of scope and no phase touches it.
R10: Tests and live-fire never write to the real ~/.kimi-code or ~/.gemini stores or the main checkout except through the seat HOME, and the plan carries sections 0-8 plus a Review log within the 14 KB budget.
