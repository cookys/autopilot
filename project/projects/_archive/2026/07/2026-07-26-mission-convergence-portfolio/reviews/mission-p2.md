# Mission Phase 2 - ICC Binding and Enforce Identity

> Trust-boundary implementation: `6569345..255de74`
>
> Constructible identity oracle and repair: `ca72806..bd9bc25`
>
> Status: READY

## Frozen Boundary

P2 connects Mission authorization to the real ICC seal and intake paths. Raw
`contract_sha256` remains final-byte provenance, while the domain-separated
`mission_subject_digest` excludes only `mission_grant_ref` so a claim can be
created before its binding digest is inserted into the final contract.
`campaign-v2` identity binds repository, ticket, and subject without replacing
the raw drift seal.

The v2 grant is explicit-only and binds exact lineage, task authority, campaign,
subject, base SHA, and acceptance IDs. Enforce sealing resolves one trusted live
claim from Mission state; canonical intake requires the same claim and campaign
and releases its reservation exactly once after downstream rejection. Legacy,
v1, shadow, and off behavior remain compatible and fail-closed.

## Deterministic Evidence

- `mission-enforce-roundtrip.test.sh`: PASS, 16 assertions.
- `mission-enforce-failclosed.test.sh`: PASS, 8 assertions.
- `mission-enforcement-runtime.test.sh`: PASS, 75 assertions.
- `mission-convergence.test.sh`: PASS, 160 assertions.
- `mission-convergence-integration.test.sh`: PASS, 25 assertions.
- `mission-icc-runtime.test.sh`: PASS, 81 assertions.
- `implementation-campaign.test.sh`: PASS, 73 assertions.
- `autopilot-engine.test.sh`: PASS, 439 assertions.
- `autopilot-cli.test.sh`: PASS, 54 assertions.
- `check-canonical-invariants.sh`: PASS.
- `validate.sh`: PASS, 28/28 skills.
- `git diff --check`: PASS.

The first real round-trip reproduced the structural defect: using the final raw
contract digest inside a claim whose binding digest is then written back to the
contract makes the identity self-referential and unconstructible. The repaired
oracle proves draft subject/id creation, real claim, ref insertion, real enforce
seal, canonical intake, exact release, governed-field mutation rejection, and
raw-whitespace drift rejection.

## Heterogeneous Trail

Grok 4.5 High implemented the v2 identity and the subsequent product repair.
Qwen 3.8 Max Preview independently authored the fail-closed oracle. Gemini 3.6
Flash High and Qwen reviewed the raw aggregate diff without receiving the
implementer's self-report.

| Severity | Finding | Repair |
|---|---|---|
| 🔴 Critical | The raw contract digest and grant reference formed an identity cycle, so enforce mode rejected every constructible final artifact. | Separate semantic `mission_subject_digest` and `campaign-v2` identity from the unchanged raw byte seal. |
| 🟠 Major | The first v2 binding omitted `task_authority_id`. | Bind and durably retain exact authority and lineage fields. |
| 🟠 Major | Field-shape inference could silently promote a legacy claim to v2. | Require explicit `identity_scheme: mission-subject-v2` on every v2 path. |
| 🟠 Major | Intake allowed a claimed adapter result with a missing campaign ID. | Require exact nonempty campaign and claim IDs before downstream readiness. |
| 🟠 Major | Seal lineage/authority comparisons skipped missing claim fields. | Treat missing or mismatched stored lineage/authority as enforce rejection. |

The independent fail-closed oracle reproduced all seven review gaps on the
pre-repair candidate. Six passed immediately on the repair candidate; the final
case was already correctly rejected through the legacy raw-digest path, so the
test's semantic regex was narrowed to accept that exact proof rather than a
generic nonzero exit.

## Terminal Panel

| Seat | Verdict | Findings |
|---|---|---|
| Gemini 3.6 Flash High | `SHIP-AS-IS` | none |
| Qwen 3.8 Max Preview | `SHIP-AS-IS` | none |

Qwen's first terminal response contained the correct wrapped verdict but
prefixed it with prose, so the dispatcher classified it `no_verdict`; it was
not counted. One bounded retry returned a parser-valid `SHIP-AS-IS`.

## Owner Decisions

- The active L6 canonical controller depended on the enforce identity being
  repaired and failed its precondition. External implementation/test dispatch
  therefore used the recorded L3 fallback in isolated worktrees, restoring L6
  after each dispatch. Depth 0 retained all test, review, and merge authority.
- Generated Codex plugin mirrors remain deferred to portfolio Phase 33.
- A test-only expectation was corrected when real output proved the product
  rejected a forged no-scheme claim through the intended legacy path. Product
  behavior was not weakened to satisfy an overly narrow regex.

## Final Decision

`READY`. Mission enforce identity is constructible, raw drift provenance is
preserved, the reviewed trust-boundary gaps have exact regressions, and the
terminal heterogeneous panel admitted no further finding. LSM P1 may begin.
