# Frozen review rubric — verification-author qualification suite plan

VA1: Construct validity — does the exam actually measure requirements-grounded
harness authoring? Can a candidate pass without reading the spec (template
harness, trivial assertions), or fail despite competent authoring (ambiguous
spec, undecidable defect)? Is the "authored from requirements" bar genuinely
construct-guaranteed by the authoring payload containing no implementation?

VA2: Red-green mechanics — is the clean-green/defect-red grading sound? Does
the assertion-vs-infrastructure distinction have a deterministic definition?
Are crash/timeout/oversize/empty outcomes fail-closed on every path? Can a
harness pass a case without executing the module under test?

VA3: Determinism and leakage — seed-derived corpus (same seed = byte-identical),
pinned hashes, renderer rotation adequacy, and leak-scan coverage: can any
implementation-only token, defect-family hint, or twin-distinguishing artifact
reach the visible spec?

VA4: Untrusted-code containment — the candidate harness is arbitrary code
executed host-side. Is the sandbox posture (network, filesystem, wall clock,
output size) specified tightly enough, and does it match the proven witness-
runner family rather than inventing a new containment surface?

VA5: Chassis parity — evidence kind/role wiring, store append, scorecard row,
--emit-row, --version-source, broker transport (HTTP + CLI), provider prompt
mode with honesty boundary and hash recording: consistent with the reviewer/
owner/brain precedents, no second canonical statement of an existing contract?

VA6: Scope discipline — are the v1 boundaries (single-module, no routing
changes, no diversity enforcement) the right cut? Anything in scope that
belongs out, or out that the goal cannot survive without?

VA7: Anti-gaming completeness — vacuous harness, fail-everything harness,
runtime source-reading, spec-echo assertions, renderer grammar matching,
cross-case memorization: does each named attack have a mechanical counter, and
which attacks are NOT countered (must be named as residual risk)?

VA8: Test/acceptance honesty — do the phase acceptance criteria prove the red
lines can fire (deviant mocks for every failure class), and is any acceptance
criterion satisfiable by a vacuous implementation of the suite itself?
