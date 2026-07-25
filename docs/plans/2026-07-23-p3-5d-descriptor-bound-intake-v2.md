# Plan - P3.5d Descriptor-Bound Authenticated Intake v2
> Status: complete | Owner: CEO autonomous run | Branch: `feat/owner-kernel-governance` | Frame: P3.5d shadow-only prerequisite

## 0. Context / thesis

P3.5c proves that a root-owned registry can reserve one workspace descriptor and
that a separate-UID shadow witness can record the resulting diagnostic. Its
P3.3 / owner-intake v1 request still carries a raw `workspaceRoot` to let the
worker recompute the signed workspace hash. That lane is intentionally not
path-confidential and cannot be used by a future effect-capable broker.

The next safe step is a parallel v2 ABI. The owner signs the exact root-issued
descriptor ticket, descriptor binding, workspace hash, and immutable base
returned by `begin`; the worker, verifier request, receipt, shadow record,
witness, and public result never receive a root-derived or structured
workspace-path field. Free-form task inputs remain opaque and are not
path-classified by this shadow boundary. This removes the ambiguous
path-to-descriptor translation before any authority-bearing host is built.

## 1. Problem

An unattended project controller needs an owner-selected and cryptographically
bound workspace identity, not an unsigned host-side path choice. Building a
broker, connecting `AutopilotEngine`, or re-running the P0 production corpus
against the current v1 lane would freeze or validate the wrong boundary.

## 2. OKR / KRs

- **O:** Add a descriptor-bound, path-free signed intake lane without granting
  execution, Kernel, P2, broker, or acceptance authority.
- **KR1:** v1 request, signature domain, plan bytes, receipt shape, and tests
  remain compatible; no v1 request is silently upgraded.
- **KR2:** v2 binds the root-issued `ticket_hash`, `descriptor_binding_hash`,
  `registration_id`, `workspace_root_hash`, and immutable base into both the
  signed bridge binding and the exact verifier ticket comparison.
- **KR3:** v2 rejects raw workspace path fields, absent/mismatched ticket
  commitments, mixed version fields, replay/expiry, descriptor/base/session
  substitution, and v1/v2 signature-domain crossover before shadow admission.
- **KR4:** A privileged Linux live test completes one v2 descriptor-bound
  shadow intake and proves the root-derived path is absent from the valid
  worker handoff, verifier-visible request, receipt, shadow/witness journal,
  and public output; deterministic host coverage proves a structured raw
  workspace field is rejected before a worker starts.
- **KR5:** All v2 output continues to state `owner_kernel_authority: "none"`,
  `effect_authority: "none"`, and `acceptance: "not_available"`.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Preserve P3.3 / authenticated-intake v1 ABI and behavior exactly; v1 is never implicitly upgraded or accepted through a v2 parser.
- The P3.3 bridge version, signed-envelope version/domain separator, replay-fingerprint version, and host-request protocol version are separate explicit v2 discriminators.
- A v2 bridge input has no raw workspace path field; its signed `workspace_binding` exact-matches `registration_id`, `workspace_root_hash`, `immutable_base`, `descriptor_binding_hash`, and `ticket_hash` from the root-owned session ticket.
- Only root configuration registration accepts a raw path. The root-held descriptor, FD, inode, mount ID, and Git data never enter worker handoff, verifier request, receipt, shadow state, witness journal, or public output; its registration path never enters as a structured workspace-path field. P3.5d does not inspect or classify caller-supplied free-form prompt, branch, or verification-command content.
- Any missing, mixed-version, extra, substituted, expired, replayed, or non-exact ticket/binding/session/base claim fails before shadow admission.
- This is shadow-only: do not construct an Owner Kernel, call AutopilotEngine, mint or execute a P2 action, introduce broker/coordinator authority, or claim acceptance or alias-retirement eligibility.
- Keep source and `platforms/codex/plugin` mirrors synchronized through `bash scripts/sync-codex-plugin-skills.sh`; do not touch unrelated dirty worktree files.

## 3. File-structure map

| File | Responsibility |
| --- | --- |
| `src/engine/supervised-engine-bridge-contract.js` | Parallel v2 input/binding/plan compiler and exact trusted-binding verifier while retaining v1 bytes. |
| `src/engine/supervised-authenticated-intake.js` | Explicit v2 envelope/claims/domain/replay handling and strict bridge-context matching. |
| `src/engine/supervised-intake-verifier.js` | Request protocol dispatch, v2 ticket-to-plan comparison, and path-free admission guard. |
| `src/engine/supervised-intake-host.py` | Expose a v2-specific `begin` binding disclosure and preserve its root-only ticket lifecycle. |
| `src/engine/supervised-intake-gateway.py` | Validate the v2 verifier output without widening worker-visible data. |
| `hooks/tests/supervised-engine-bridge-contract.test.sh` | Deterministic v1 compatibility and v2 binding/mixed-field/substitution tests. |
| `hooks/tests/supervised-authenticated-intake.test.sh` | Signature-domain, claims, replay, expiry, and v1/v2 crossover tests. |
| `hooks/tests/supervised-intake-host.test.sh` | Root host/ticket/output schema and no-authority checks. |
| `hooks/tests/supervised-intake-live-host.sh` | Privileged descriptor-bound v2 end-to-end proof and raw-path exclusion checks. |
| `docs/projects/2026-07-20-owner-kernel-governance/{README.md,p3/README.md}` | Ship-state boundaries and next prerequisite, updated only after implementation verifies. |

## 4. Phases

### Phase 1 - Freeze parallel v2 contract (L)

1. Add explicit v2 constants and a `workspaceBinding` schema to the bridge
   compiler. Retain legacy no-version v1 input parsing and make a v2 input
   require `schema_version: 2` with an exact field set.
2. Put all five descriptor commitments in the v2 trusted binding and compiled
   plan. Give the v2 ABI its own hash, so it cannot share a v1 trusted
   signature or plan hash.
3. Extend focused tests to prove v1 canonical output has not changed and v2
   rejects raw paths, incomplete binding fields, and substitutions.

**Done when:** The compiler deterministically emits hash-only v2 plans and a
v1 envelope cannot verify a v2 plan, or vice versa.

### Phase 2 - Authenticate explicit v2 envelopes (L)

1. Dispatch envelope, protected claims, bridge context, signing purpose, and
   replay fingerprint by their exact protocol version.
2. Use a v2 signing domain separator and include the v2 bridge schema in
   authenticated verification output. Keep keyring format stable unless a
   versioned keyring change is required by existing parsers.
3. Test v2 expiry, replay, raw path injection, signature-domain crossover,
   claim/binding/plan mismatch, and v1 compatibility.

**Done when:** Only matching v2 claim, envelope, bridge context, and signature
domain validate; all cross-version combinations fail closed.

### Phase 3 - Bind the root ticket at host/verifier boundary (L)

1. Add an explicit v2 host request discriminator; root preflight rejects v2
   requests that contain structured legacy raw path fields before a worker
   starts, and the verifier repeats the guard before bridge compilation.
2. Require the verifier to exact-match the session's root ticket commitment
   against every signed v2 workspace-binding field, not merely path hash/base.
3. Carry protocol version through the gateway/host validation as hash-only
   disclosure. Keep descriptor files root/verifier-readable only and worker
   handoff opaque.

**Done when:** A v2 submission only succeeds with the ticket returned from its
own `begin`, and every ticket/session/descriptor/base substitution fails before
shadow admission.

### Phase 4 - Prove it and ship (L)

1. Add a privileged live v2 bound-workspace test that signs the `begin`
   ticket/binding values, submits it, checks the returned result and witness
   chain, and scans all exposed artifacts for the root-derived workspace path.
   Add deterministic root-preflight coverage that proves structured raw
   workspace fields start no worker and produce zero handoff bytes.
2. Run focused deterministic tests, the privileged live host gate, the full
   parallel suite, manifest/mirror/structure/invariant gates, and diff checks.
3. Run Architect, Ops, and Skeptic review focused respectively on ABI,
   deployment/lifecycle, and hostile cross-version or ticket mutation paths.
   Resolve every Critical/Major finding before commit.

**Done when:** Tests and all repository gates pass, the review synthesis is
recorded, mirrors are synchronized, and P3.5d is committed as one logical
change.

## 5. Test / validation

Script-gated:

- `PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-engine-bridge-contract.test.sh`
- `PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-authenticated-intake.test.sh`
- `PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-intake-host.test.sh`
- `AUTOPILOT_P35_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-intake-live-host.sh`
- `PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/run.sh --parallel 16`
- `bash scripts/sync-codex-plugin-skills.sh --check`
- `bash scripts/validate.sh`
- `node scripts/sync-version.js --check`
- `node scripts/check-hook-inventory.js --check`
- `bash scripts/check-canonical-invariants.sh`
- `git diff --check`

Human-gated: the three-perspective review must distinguish shadow-only
evidence from a production P2 witness or effect-capable broker.

## 6. Risks + inversion

| Failure guarantee | Mitigation |
| --- | --- |
| A v2 parser falls back to v1 when a field is missing. | Exact version-specific schemas and cross-version negative tests. |
| A signed registration ID is treated as a sufficient workspace authority. | Require ticket hash, descriptor binding, workspace hash, and base exact match in the verifier. |
| A structured raw workspace path slips through an auxiliary object or receipt. | Root preflight recursively rejects the reserved raw workspace field names in bridge input and signed claims before worker launch; exact schemas plus live artifact scans cover the valid path. Free-form task text is explicitly outside path classification. |
| A live test claims production authority because it succeeds. | Fixed no-authority disclosure assertions and source scans for Engine/P2/broker paths. |
| v2 changes legacy v1 output. | Existing v1 fixture assertions run unchanged before and after v2 cases. |
| Mirrored Codex files drift. | Generate mirrors and run the sync check before commit. |

## 7. Out of scope

- `AutopilotEngine` invocation, Owner Kernel construction, P2 permits,
  action execution, broker/coordinator implementation, acceptance, project
  aliases/multimapping, Git content proof, P0 production corpus rerun,
  dogfood telemetry, alias retirement, and release metadata.
- Replacing P3.5c's local separate-UID diagnostic witness with the independent
  P2 production witness.

## 8. Open questions

None. CEO decision freezes `workspaceBinding` with the five exact commitments
listed in the global constraints; future project namespaces or aliases require
a separate Board decision.

## Review log

| Round | Perspective | Result |
| --- | --- | --- |
| R0 | Architect | Recommended P3.5d before broker/Engine activation; bind ticket hash and descriptor binding in a separate v2 domain. |
| R0 | QA | Recommended v2 as the first prerequisite; require strict raw-path/mixed-version/substitution negatives and a privileged live proof. |
| R0 | Ops (CEO synthesis from current deployment docs) | Production broker first would consume the intentionally inadequate v1 raw-path lane; P0 corpus first would validate a non-production shadow boundary. |
| R1 | Architect | **SHIP.** v1 persisted shadow-record replay retains its legacy evidence bytes; v2 `begin` and result retain explicit `effect_authority: "none"`; focused compatibility checks and the Codex mirror are green. |
| R1 | Ops | **SHIP.** Verified v2 expiry reaping, root preflight before worker launch/handoff, ticket-to-plan binding, lifecycle documentation, focused tests, privileged live proof, and diff hygiene. |
| R1 | Skeptic / QA | **SHIP.** Re-verified that canonical v2 request/envelope/protected-payload preflight rejects structured `workspaceRoot` / `workspace_root` before launch or handoff; no v1/v2 crossover or ticket/claim substitution admission remains. |

Resolved before commit:

- **Expired v2 session reaping:** the persistent-session normalizer accepts the
  exact v2 shape, so an expired v2 submission cannot wedge subsequent `begin`.
- **Legacy v1 persisted replay:** schema discrimination is kept out of the
  legacy evidence-hash preimage, so old durable records replay idempotently.
- **Structured raw-path admission:** root performs bounded, non-authenticating
  canonical structural preflight before creating a worker; the Node verifier
  remains the semantic/authentication authority.
