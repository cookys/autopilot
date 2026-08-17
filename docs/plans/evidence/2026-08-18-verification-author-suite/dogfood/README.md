# VA declared-plan exam — first real administration: GLM-5.3 QUALIFIED (2026-08-18)

Frozen plan P5 dogfood: the incumbent /l6 verification-author seat (GLM @ HTTP;
z.ai resolves to glm-5.3, probe-confirmed same session) sat the brand-new
`engine-qualify.sh verification_author` exam.

## Result — QUALIFIED, 24/24

- **Both trials perfect**: 24/24 cases pass; subjects declared_accuracy ✓
  sensitivity ✓ robustness ✓; zero declared mismatches, zero missed defects,
  zero robustness violations. Wall 187 s. capability_score 1.0.
- Evidence event 7 (state `qualified`, methodology `va_declared_plan`, expires
  +60 d per the role TTL); scorecard event 142.
- Raw per-case exchanges: `raw/va-exchanges.jsonl` (24 envelopes + submitted
  plans, both trials).

**Role-fit datum**: the SAME engine failed the reviewer diff exam one day
earlier (4 clean false positives + 1 sensitivity miss, scorecard event 140)
and aces declared test design here — per-role qualification measuring real,
divergent capabilities is exactly why the role suites exist.

## Identity + derivations (recorded)

- glm-5.3 @ anthropic-compatible/node-direct-http-fetch, family zhipu, effort
  high, model_version glm-5.3-20260818 (`--version-source runtime` — the HTTP
  response echoes the resolved model id; probe recorded this session).
- harness_version = `engine-qualify-56535d6b` (first-8 sha256 of
  engine-qualify.js at administration time).
- prompt_config_hash = sha256 of the RENDERED va system prompt (vaSystemPrompt
  output incl. the imported PLAN_CONTRACT) = `99d8c838…` — derivation verified
  two ways (template substitution vs live capture, byte-equal).
- semantic_fingerprint = sha256(canonicalJson({kind:'va-semantic-surface-v1',
  model:'glm-5.3', transport:'anthropic-compatible-http', endpoint:'glm'}))
  = `caedf1a2…`.
- containment_fingerprint = sha256(canonicalJson({kind:
  'va-containment-surface-v1',
  exam_transport:'qualification-case-broker-networkless-bwrap',
  twin_execution:'host-va-runner-bwrap',
  credential_isolation:'broker-env-allowlist-http-token'})) = `6e814524…`.

## Honesty clause (frozen plan P5)

- **Construct scope**: this exam measures DECLARED TEST DESIGN — deriving
  revealing inputs and exact expected outcomes from a rendered specification
  within a constant budget. It does NOT measure authoring executable test
  code, multi-file verification harnesses, or repo-scale strategy; those
  remain uncovered claims for this seat.
- **Named residuals** (frozen plan §2/§3/§5): cross-administration corpus
  STRUCTURE memorization is countered by seed-derived values, not eliminated;
  renderer-template familiarity grows with public exposure of the three
  clause surfaces; CPU/fd limits in the twin runner are enforced indirectly
  via wall/output caps (witness-runner family residual).
- The candidate prompt teaches the imported PLAN_CONTRACT and task framing
  only (suite-scanned against the generator's oracle vocabulary); selection
  strategy was not taught — the 24/24 selection quality is the seat's own.
