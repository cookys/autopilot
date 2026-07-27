# Seq 20 review — LSM P5 docs/package integration

## Result

`READY`

Implementation commit: `27d43a8`

## Frozen R1–R8 acceptance

- **R1 — merge direction:** the integration documentation names ordered source and target refs,
  binds the second edge to its predecessor result, declares `no-ff` / `ff-only`, and explicitly
  forbids the reverse consumer-to-product edge.
- **R2 — mutation boundary:** merge-intent preflight is documented and implemented as read-only;
  mutation has a separate sealed execution entry point that revalidates the accepted preflight.
- **R3 — close authority:** L5/L6 marker clear requires a fresh, digest-valid, repository- and
  root-bound task-status receipt with `can_close=true`, including when explicit evidence is supplied
  after the marker is absent or expired. L4 and S/Fix/H compatibility remains unchanged.
- **R4 — fresh merge gate:** L5/L6 instructions capture fresh task-status JSON and mechanically
  assert `can_merge === true`; command exit zero alone is not merge authority.
- **R5 — follow-up admission:** canonical portfolio and campaign artifacts are validated before
  admission. Exact nested shapes, reviewer/evidence/source binding, score arithmetic, terminal
  proofs, campaign schema, receipt digest, stable fingerprint dedupe, conflict detection, and
  `current_ticket_reopened=false` all fail closed.
- **R6 — profile compatibility:** generated profile inventory, rule hashes, segments, and migration
  mappings match the canonical skills and preserve the existing profile contract.
- **R7 — Codex package parity:** the generated Codex payload matches the final canonical tree.
- **R8 — runnable documentation:** examples use shipped entry points and current arguments for task
  status, merge execution, session close, and backlog admission.

## Deterministic evidence

- `bash hooks/tests/merge-intent.test.sh` — PASS, 24 assertions.
- `bash hooks/tests/merge-execute.test.sh` — PASS, 38 assertions.
- `bash hooks/tests/status-task.test.sh` — PASS, including safe/blocked merge status, digest drift,
  execution binding, and honest closeout cases.
- `bash hooks/tests/status-finish-followup.test.sh` — PASS, 33 assertions, including absent/expired
  marker evidence checks and malformed portfolio/campaign rejection without backlog mutation.
- `bash hooks/tests/review-mvp-portfolio.test.sh` — PASS.
- `bash hooks/tests/profile-context-isolation.test.sh` — PASS, 122 assertions; catalog check reports
  755 canonical rules and zero obsolete rules.
- `bash hooks/tests/codex-plugin-package.test.sh` — PASS, 90 assertions.
- `bash scripts/sync-codex-plugin-skills.sh --check` — PASS, generated payload in sync.
- Full pre-commit, cached-diff, and 28-skill validation gates — PASS.

## Bounded local review trajectory

The frozen rubric allowed at most three local generations and admitted only concrete R1–R8
failures with impact and a smallest repair:

1. **Generation 1 — `FIX-THEN-SHIP`:** R5 found that a campaign could have a valid outer shape and
   self-digest while carrying a noncanonical nested finding. The repair validates the full
   implementation-campaign receipt schema and adds a digest-valid malformed-campaign negative
   fixture proving rejection and zero backlog mutation.
2. **Generation 2 — `FIX-THEN-SHIP`:** R5 found that portfolio admission still trusted shallow
   outer/candidate shapes. The repair adds canonical output validation for nested score accounting,
   complete roster evidence, sources, cut linkage, fingerprints, and true bounded terminal proofs,
   plus a malformed-but-fingerprint-valid negative fixture.
3. **Generation 3 — `SHIP-AS-IS`:** fresh R1–R8 proof and the deterministic gates above found no
   remaining in-scope blocker.

The trajectory stopped at the bounded terminal verdict; it did not reopen general hardening or
style review.

## Heterogeneous panel and depth-0 adjudication

- **Gemini 3.6:** returned parser-valid `SHIP-AS-IS` with a structured R1–R8 no-finding proof tied
  to the merge, closeout, admission, profile, package, and runnable-documentation evidence.
- **Codex gpt-5.5:** returned `FIX-THEN-SHIP` for a claimed subset-roster portfolio admission path.
  Depth-0 **REFUTED** the claim against the canonical producer: every reviewer must assess the exact
  candidate matrix, all reviewers must provide identical `follow_up` metadata, evidence eligibility
  requires every reviewer, and emitted backlog evidence and sources contain the full roster. The
  final validator independently enforces that same full-roster binding.
- **Depth-0 union verdict:** `SHIP-AS-IS`. The union contains no verified R1–R8 `MUST-FIX`.

Neither an empty response, parser failure, timeout, nor generic approval counted as a verdict.

## Cut / follow-up

Portfolio output is structurally canonical, but this phase does not add an authenticated receipt
binding the portfolio input to its output or identify a trusted producer cryptographically. That is
nonblocking under the current local depth-0 producer trust boundary. Revisit it only if a hostile
portfolio-producer threat model is adopted.

No backlog item is added: the panel produced no canonical evidence-backed candidate carrying the
required context, trigger, title, sources, and fingerprint for this provenance hardening.

ICC P4 may begin.
