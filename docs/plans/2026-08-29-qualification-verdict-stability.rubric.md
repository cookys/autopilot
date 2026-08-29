# Frozen rubric — Qualification verdict stability (two-tier bar + pooled multi-administration)

> Content-bound source for the Mission execution graph
> `docs/mission-qualification-verdict-stability-execution-graph.json`. Each `R<n>` below is the
> checkable form of the plan's KRs, constraints and risks
> (`docs/plans/2026-08-29-qualification-verdict-stability.md`, APPROVED 2026-08-30).

R1: The verdict is a two-tier decision — Tier-1 trust is zero-tolerance and fail-fast on a single
occurrence, Tier-2 competence is a full-N pooled Wilson lower bound against the frozen case mixture.
The single-run 100%-bar `foldAdministration` / `foldDiscussAdministration` result no longer decides
`qualified`.

R2: `wilsonLower(successes, n, z)` exists in `src/engine/verification-strength.js`, uses Node
built-ins only, mirrors `wilsonUpper`'s algebra with the lower sign, returns `0` for `n <= 0`, and is
pinned by unit test to the plan's D2 expected-value table at the frozen `z = 1.6448536269514722`.
`wilsonUpper` and the calibration gate output stay byte-unchanged.

R3: The instrument is frozen. No file under `evals/` changes: no generator, grader, corpus manifest,
rubric or seal. Each consult/discuss grader file and its pinned `EXPECTED_*_GRADER_HASH` is asserted
byte-identical pre and post, and again at closeout against `origin/develop`. No `protocol_subtype`
field is added to any grader; all tier classification happens in the verdict engine, outside the seal.

R4: The error-class to tier mapping is a frozen exhaustive table. Every reason string the current
graders can emit maps explicitly to Tier-1, Tier-2 or the harness-excluded class, and a test asserts
that no current-grader reason ever reaches the STEP-3 default-deny. The `protocol_violation` split is
a mechanical predicate over the bounded raw stdout, the parsed object, extraction metadata and the
grader reason — never LLM judgment.

R5: The trust scan runs first and unconditionally over the bounded raw provider stdout, not only the
selected JSON object. Verdict tokens in an extra or nested field, in trailing prose, in a fenced tail,
in a second top-level object, or after a repaired extraction each classify Tier-1 and terminate before
pooling. Unknown future reasons fall to STEP-3 Tier-1, never laundered into Tier-2.

R6: Early stopping is fail-only or mathematically locked. Every stopping path returns exactly the
verdict the full-N bound returns, there is no partial-`n` early qualify, and a property test asserts
the OC-preservation invariant over every scripted outcome sequence. The administration cap is a
test-only shrink seam that `parseArgs` cannot set.

R7: The calibration constants `VERDICT_Z = 1.6448536269514722` and `VERDICT_TAU = 0.85` are pinned in
exactly one place. The normative operating characteristic is a separately implemented deterministic
exact-binomial oracle; the seeded simulation is a secondary cross-check with predeclared seeds,
tolerance and power, and the oracle wins on disagreement. The honest 50%-crossing boundary
`p* ~= 0.923` is claimed as measured, not rounded to 0.90.

R8: Schema and scorecard changes are additive and back-compatible. Every existing consult/discuss row
and every other-role row revalidates byte-for-byte, a frozen copy of the old validator rejects a
pooled row (the reverse pin), and the pooled `wilson_lower` is independently re-derivable from
`pooled` and the stored `z` — a row that does not recompute is rejected (ADR-0001).

R9: The supersession contract is append-only and load-bearing. The `record_kind:"supersession"`
marker has a closed required/forbidden field set validated at `record` time, a dangling or mismatched
`supersedes_event_id` is rejected and never written, markers are excluded from ordinary-row
derivation, and validated targets are filtered before every baseline-selection path
(`computeSeatProjection`, `current`, `ladder`, both `seat-status` paths). Events 157-165 stay
byte-identical on disk, and the projection change is proven both directions.

R10: Scope stays cut where the plan cut it. The change is consult/discuss only and a parity test
proves `reviewer/owner/implementer/verification_author/brain` verdicts are byte-identical to
`origin/develop`. No new skill, agent or standalone script is added; semver is PATCH; no new trust
machinery is introduced; and no real-money re-administration is performed — D7 designs the protocol
and spend remains a separate Board authorization.
