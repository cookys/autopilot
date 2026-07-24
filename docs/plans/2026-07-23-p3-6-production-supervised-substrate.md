# Plan - P3.6 Production Supervised P2 Substrate A0
> Status: in progress | Owner: CEO autonomous run | Branch: `feat/owner-kernel-governance` | Frame: P3 production substrate before live authority

## 0. CEO Decision Brief

**Decision:** build A0, a Linux-local, fail-closed production supervised P2
substrate, before re-running P0, wiring `AutopilotEngine`, or making P4 role
qualification gating.

The current P2 implementation proves protocol contracts between injected
adapters. P3.5d proves a v2 root-held descriptor/ticket intake can reach a
shadow diagnostic without exposing a structured workspace path. Neither proves
that a worker cannot impersonate a broker, write a production witness, race an
acceptance coordinator, or replay an ambiguous effect. Direct Engine wiring
would make those unproven callback assumptions authority-bearing.

### R0 Think-Tank Synthesis

| Perspective | Recommendation | Decisive reason |
| --- | --- | --- |
| Architect | A first | The P2 callback contracts need a real independently identified broker, witness, and coordinator before any Engine sink can use them. |
| Ops/SRE | A0 then P0 corpus | Durable install, restart, recovery, and rollback behavior are a trust ABI; defer Engine/effects until they have hostile lifecycle evidence. |
| QA/Skeptic | A then C then B then P4 | Re-running P0 now would certify a shadow fixture, and direct Engine wiring would collapse required role independence. |

**Decision sequence:** `A0 fail-closed substrate -> complete P0 corpus against
A0 -> Engine/P2 integration -> low-risk dogfood -> P4 gating`. Consensus is
high; no dialectic escalation is warranted.

## 1. Objective and Acceptance Criteria

Build the smallest root-installed Linux substrate that can later host P2
authority, while deliberately exposing **no effect and no acceptance path**.

- **AC1 - v2-only ingress:** every A0 session is bound to a P3.5d v2 ticket;
  v1, mixed-version, replayed, substituted, expired, or raw structured-path
  inputs fail before any service receives an authority request.
- **AC2 - independent identities:** root bootstrap, worker, broker, receipt
  verifier, production witness, and acceptance coordinator have immutable,
  independently attested identities. The worker cannot satisfy any broker,
  witness, verifier, or coordinator peer check by UID/GID/PID/cgroup
  substitution. Root is not the witness or coordinator.
- **AC3 - durable P2 primitives:** the production witness provides authenticated
  `appendIfHead`, `appendBatchIfHead`, `getHead`, and exact readback over
  hash-only records; the coordinator exposes fenced prepare/cancel/resolve
  recovery state. Invalid, stale, concurrent, interrupted, or partially
  written requests make the run unavailable/unknown, never successful.
- **AC4 - effects disabled:** the broker validates its fixed identity and
  protocol but rejects every execute/permit/authorization request with a
  named `BROKER_EFFECTS_DISABLED` outcome. No `OwnerKernel`, P2 permit,
  `AutopilotEngine`, dispatcher, Git mutation, or acceptance transaction is
  invoked in A0.
- **AC5 - production-shaped evidence:** deterministic hostile tests and a
  privileged disposable Linux live gate prove peer/cgroup authentication,
  snapshot pinning, CAS/batch/readback, lease/restart cleanup, pending-state
  quarantine, and absence of worker-readable secret/path/effect capability.
- **AC6 - repository health:** focused tests, full suite, review, mirrors,
  structure, manifest, invariants, and diff checks pass. P0 is not marked
  production-verified until its complete corpus is actually run against A0.

## 2. Scope Boundary

### Included

- A versioned P3.6 A0 contract for v2 ticket binding, fixed service identities,
  authenticated IPC claims, hash-only witness records, coordinator fences, and
  explicit disabled-effect results.
- Root-owned installation snapshot/configuration and Linux-only transient
  service lifecycle for worker, broker, receipt verifier, witness, and
  coordinator, using exact peer credential and cgroup checks.
- A production witness/coordinator/broker substrate with bounded request sizes,
  durable CAS/batch/readback, recovery/quarantine records, and teardown.
- Deterministic and optional privileged-live negative-control tests.
- Source/mirror/documentation updates that accurately keep A0 below P2/Engine
  authority.

### Excluded / No-Go

- `AutopilotEngine` construction or action-sink wiring.
- Any P2 `mintActionDecision`, permit, postclaim authorization, action effect,
  dispatcher, command, Git/worktree operation, acceptance commit, or
  `converged -> accepted` mapping.
- Reuse of P3.5c's shadow witness as a production witness, or use of the v1
  intake lane by A0.
- Re-running P0, dogfood, changing governance modes, P4 gating, alias
  retirement, remote/quorum support, release metadata, or real-project effects.

## 3. Architecture Decisions

1. **Separate A0 service namespace.** New P3.6 files and installed snapshot
   names must not extend the P3.5 shadow daemon into authority by accident.
   P3.5 remains diagnostic only and its public result stays non-authoritative.
2. **Root is bootstrap, not a production role.** Root writes/install-verifies
   immutable snapshot material and creates protected runtime directories. It
   does not handle a production witness/coordinator request after service
   release, and cannot be configured as either identity.
3. **Every peer check is compound.** A trusted service accepts a request only
   after exact `SO_PEERCRED` PID/UID/GID and unified cgroup-v2 match its
   root-launched transient unit and pinned service identity. Socket location or
   caller-supplied role label is never sufficient.
4. **No bearer secret crosses to worker.** Tickets, permit-like values,
   coordinator fences, attestation material, and receipt-root descriptors stay
   in the service-specific roots. The worker sees only a hash-only A0
   availability disclosure.
5. **A0's only terminal authority is refusal.** A valid substrate request can
   create a bounded, witnessed `unavailable`/`unknown` record but cannot create
   an effect, accepted result, or reusable P2 authorization.
6. **Recovery is quarantine-first.** Lost response, interrupted write, stale
   head, expired lease, or service restart blocks new work and records an
   explicit pending/unknown state. It never replays a request or infers that a
   side effect did not occur.

## 4. Phases

### Phase 1 - Freeze the A0 contract and fail-closed probes

1. Add a standalone P3.6 contract module with exact schemas for v2 intake
   binding, service attestation/binding, authenticated IPC envelope, witness
   CAS/batch/readback request, coordinator fence, and disabled broker result.
   This phase freezes the host-owned verifier and frame contracts only; it does
   not claim that a root-installed service or a cryptographic/peer-credential
   verifier exists yet. Those runtime checks belong to Phase 2.
   The ABI hash commits the exact required fields, routes, temporal limits,
   fence/batch bounds, and disabled-result request/envelope binding rules, so a
   Phase 2 implementation cannot silently reinterpret this wire contract. Each
   operation has one ABI-pinned sender/recipient route; the generic frame parser
   derives and enforces it rather than accepting caller-selected routing. The
   same manifest pins disabled-response correlation to the original canonical
   request, envelope, clock, and result material hash.
2. Reject v1/mixed schema, duplicate/aliased identities or attestations,
   omitted commitments, raw structured workspace paths, arbitrary roots,
   future/expired/impossible activation windows, service frames that exceed the
   verified intake window, and caller-selected executable fields.
3. Add deterministic contract tests including null/empty/upstream-error shadow
   paths, replay and cross-role substitution.

**Done when:** A valid request compiles only to a hash-only, effect-disabled
substrate plan; every other input fails before service launch.

**Status:** complete; committed as the standalone contract before the
root-installed lifecycle work starts.

### Phase 2 - Root-installed independent service substrate

1. Add a root-only installer that snapshots fixed files/configuration and
   provisions/verifies distinct non-root identities with private groups. The
   installed `run` surface accepts no caller-supplied paths, config, command,
   identity, or root override.
2. Launch bounded broker, receipt verifier, witness, coordinator, and worker
   units with separate runtime roots, exact PID/cgroup release, and tracked
   cleanup ownership before every potentially ambiguous create/launch step.
3. Bind all IPC to the exact snapshot/material hash; publish sockets/tokens only
   after complete writes and validate credentials before reading request bytes.

**Done when:** deterministic tests prove no source/runtime override, no UID/GID
or cgroup alias acceptance, no supplementary-group drift, and cleanup after
ambiguous launch/restart.

### Phase 3 - Durable witness, coordinator, and disabled broker

1. Implement the production witness as a separate service with authenticated
   hash-only `appendIfHead`, atomic `appendBatchIfHead`, `getHead`, and
   readback. Ensure all requests are bounded, idempotent only for exact bytes,
   and chained under a root-owned durable journal layout.
2. Implement an independently identified coordinator with fenced
   prepare/cancel/resolve state. A0 can only resolve to unavailable/unknown;
   commit/accept operations must be absent or named disabled errors.
3. Implement the broker/receipt-verifier handshake as an identity and
   revocation substrate whose execute surface unconditionally returns
   `BROKER_EFFECTS_DISABLED` before any action descriptor is interpreted.
4. Provide a non-authoritative A0 availability disclosure which contains only
   binding hashes and named state; it must not expose paths, raw tickets,
   service secrets, permits, or receipt-root contents.

**Done when:** CAS/batch races, malformed frames, replay, partial write, lost
response, cancel race, restart, and all execute attempts fail closed with
durable evidence and no effect.

### Phase 4 - Hostile proof and ship gate

1. Add deterministic tests for worker/broker bypass, peer/cgroup/identity
   substitution, witness/coordinator aliasing, stale head, conflicting batch,
   crash/restart, timeout, revocation, and canonical-path/secret exclusion.
2. Add a disposable privileged `AUTOPILOT_P36_LIVE=1` gate using the installed
   snapshot and service units. It must exercise only probe/disabled operations,
   verify all teardown, and refuse a pre-existing runtime root.
3. Run focused and full tests; run three-perspective Architect/Ops/Skeptic
   review. Resolve every Critical/Major finding before commit and synchronize
   the Codex package.

**Done when:** all objective checks are green, review synthesis is recorded,
and the phase is committed. The next phase is the P0 corpus re-run, not Engine
activation.

## 5. Verification Contract

New focused commands (created by this phase):

```bash
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-contract.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-host.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-recovery.test.sh
AUTOPILOT_P36_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-live.test.sh
```

Regression and repository gates:

```bash
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-intake-host.test.sh
AUTOPILOT_P35_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-intake-live-host.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/run.sh --parallel 16
bash scripts/sync-codex-plugin-skills.sh --check
bash scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/check-canonical-invariants.sh
git diff --check
```

The red-green anchor is each A0 negative-control: the test must fail when the
corresponding identity/CAS/disabled-effect guard is locally mutated, and pass
on the committed guard. A service startup alone is not a proof of authority
separation.

## 6. Risks and Inversion

| Failure to prevent | Inversion / mitigation |
| --- | --- |
| Shadow boundary quietly becomes production authority. | Separate namespace and explicit source scans forbid P3.5 witness reuse, Engine, P2 calls, effects, and acceptance. |
| A worker impersonates a service through filesystem/socket access. | Exact PID/UID/GID plus cgroup verification before bytes; private roots, independently attested identities, and hostile substitution tests. |
| Root silently collapses witness/coordinator independence. | Installer rejects root for those roles and binding validator rejects identity or attestation reuse. |
| A lost response leads to automatic effect replay. | No effects exist in A0; persistent ambiguous state is quarantine/unknown and blocks new work. |
| CAS/batch shape exists but is not durable/atomic. | Readback, chain verification, conflicting concurrent requests, crash-tail, and restart tests are mandatory. |
| P0 is prematurely claimed as production evidence. | Project status remains P0 funding-only until the complete corpus explicitly targets this committed substrate. |

## 7. Review Log

| Round | Perspective | Result |
| --- | --- | --- |
| R0 | Architect | A first; P2 callback protocol needs real broker/witness/coordinator identity before Engine integration. |
| R0 | Ops/SRE | A0 first; make install/restart/recovery a bounded trust ABI and run P0 only after it exists. |
| R0 | Skeptic/QA | A -> P0 corpus -> Engine -> P4; retain v2-only intake and test identity/CAS/restart/revocation attacks. |
| R1 | Architect / QA / Skeptic | NO-SHIP: P3.5d provenance was shape-only; IPC/CAS/fence schemas and identity-axis tests were incomplete. Fixed with root-pinned verifier contract, exact schemas, and hostile negatives. |
| R2 | Architect / QA / Skeptic | NO-SHIP: invalid/expired intake plans, ABI wire-rule drift, detached disabled results, and generic IPC route bypass remained possible. Fixed with active-window checks, ABI-pinned schema/route/correlation manifest, exact response binding, and direct bypass tests. |
| R3 | Architect | SHIP: every operation now has one ABI-pinned route; generic parser rejects cross-route and unknown frames. |
| R3 | QA | SHIP: ABI commits disabled-result correlation and normalizer verifies it against original request/envelope/clock. |
| R3 | Skeptic | SHIP: no remaining Critical/Major in the claimed Phase 1 scope; temporal and no-effect boundaries hold. |
