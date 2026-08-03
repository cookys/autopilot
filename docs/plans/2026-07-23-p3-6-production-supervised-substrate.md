# Plan - P3.6 Production Supervised P2 Substrate A0
> Status: Complete — consumed by the installed P3.7 activation | Owner: CEO autonomous run | Branch: `develop` | Frame: P3 production substrate before live authority

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
7. **P2b peer proof keeps `/proc` readable by the five service UIDs.** Exact
   peer cgroup verification requires reading `/proc/<pid>/cgroup` after
   `SO_PEERCRED`; `ProtectProc=invisible` would hide that evidence across the
   independent UIDs. P2b therefore retains all other namespace/capability and
   filesystem protections but omits that one property. Its bootstrap release
   token never appears in a command line, each role root remains private, and
   every peer message is still bound to the fixed UID/GID/PID/cgroup tuple.
8. **Durable state is a new ABI and transport, not a P2b extension.** P2b's
   8 KiB, one-probe frames remain an identity/self-test only. Phase 3 adds a
   separately versioned durable envelope with bounded larger frames, exact
   route operation sets, and response/receipt schemas for witness and
   coordinator state. It must not reinterpret a P2b probe socket or result.
9. **Durable data survives; a service cohort never does.** A service crash,
   lost peer, or host interruption invalidates the complete PID/cgroup-bound
   cohort. The next attempt must be root-created with a new generation; no
   `Restart=` policy may reuse old peer claims. Durable records can be
   recovered only into named `unknown`, `unavailable`, or `quarantined`
   states, never inferred into success or acceptance.
10. **State leaf ownership preserves role independence.** Root owns the
    durable control tree, generation manifest, and root-created parents.
    Receipt verifier, witness, and coordinator receive distinct private leaves
    only; worker and broker receive no durable-state write path. The receipt
    verifier anchor commits fixed witness mutation responses but exposes no caller route
    or effect operation. A journal is authoritative after its record and
    directory are fsynced; derived HEAD files are cache only and are rebuilt or
    quarantined on recovery.
11. **Coordinator state is deliberately non-accepting.** The existing P2b
    `COORDINATOR_ACCEPTANCE_DISABLED` result remains a probe-compatible
    refusal. The durable coordinator instead records fenced `prepared`,
    `cancelled`, `unavailable`, `unknown`, or `quarantined` state under a new
    schema. `commit` and `accept` do not exist; `resolve` can only produce
    `unavailable` or `unknown`.

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

**Increment status:**

- **P2a complete:** a root-only installer snapshots the exact transitive P3.6
  contract closure, pins five independently attested private identities, and
  runs a no-effect lifecycle probe with bounded transient units, exact
  MainPID/UID/GID/group/cgroup revalidation, atomic release/ack publication,
  and interruption-safe teardown. Its only writable unit exception is that
  role's root-pinned acknowledgement directory. P2a has no service IPC,
  socket, witness, coordinator, broker, Engine, effect, or acceptance path.
- **P2b complete:** four ABI-aligned,
  root-pinned local Unix endpoints now use a socket-specific path layout below
  Linux's `sun_path` limit. The recipient binds in its own `02710` staging
  root; root validates the listener then seals that root to `root:sender_gid
  0710`, verifies that the now-sealed directory contains exactly its pinned
  listener socket, and removes any pre-seeded entries during root cleanup. This
  leaves the sender only traversal/connect access and the recipient no
  directory rewrite capability. Each endpoint validates exact
  `SO_PEERCRED` PID/UID/GID and cgroup-v2 before it reads one bounded canonical
  frame. The response binds the request, frozen install/run/ABI hashes, and a
  fixed representative operation for the corresponding contract route. The
  role acknowledgement carries only paired request/response hashes and public
  peer claims, never socket or cgroup paths. P2a's lifecycle acknowledgement
  is not treated as a substitute for this peer proof. Before it seals any
  socket root or releases a sender, the host requires each role's atomic
  `fixed_listeners_ready` record, bound to that role's exact PID, install/run/
  ABI hashes, and complete recipient endpoint list; it then revalidates all
  five service bindings again immediately before writing peer configs and
  release files. The release window is 210 seconds, deliberately covering the
  host's explicit 190-second five-unit launch/PID/ready/socket/recheck bound
  plus a 10-second setup margin. A shared 30-second collector validates each
  released role as its acknowledgement appears, rather than serially giving
  each role a separate deadline; its 3-second safety margin fits inside the
  35-second service hold. The 300-second unit lifetime covers the 210-second
  release window plus hold. Tests lock these nested budgets so a later timeout
  reduction cannot reintroduce a healthy-startup expiry race.

### Phase 3 - Durable receipt anchor, witness, coordinator, and disabled broker

**Phase 3 sequencing:** first freeze the standalone durable ABI and its
filesystem recovery core, then bind it to a fresh root-created service cohort.
The first subphase is intentionally not an A0 ingress claim: P3.5d's
root-held v2 verified-intake handoff must be connected before a caller can
create an A0 session. P2b stays an independent credential self-test throughout.
P3a's recovery core has one deliberately conservative cohort rule: root
precreates the complete role leaf (`generation.json`, immutable journal header,
lock, journal, cohort marker, and quarantine file), then a service may only
write those known files. The first persisted request claims the cohort marker
before the journal append; any new process, missing marker with non-header
records, journal capacity exhaustion, or uncertain write blocks the leaf for a
fresh root-created generation. This avoids treating a partial durable write as
a recoverable success.

**Increment status:**

- **P3a complete:** the separately pinned durable ABI now defines the five
  service routes and a 512 KiB frame bound without extending P2b. Root-created
  witness/coordinator leaves persist exact request/result snapshots under a
  cohort marker, journal chain, bounded lock, and quarantine rule. Witness
  supports hash-only CAS/batch/readback; coordinator supports fenced
  prepare/cancel/resolve plus durable `unknown` reservations; broker and
  revocation results remain explicitly disabled/unavailable. This is recovery
  core only: it creates no root-installed long-lived service, v2 handoff,
  Engine/effect path, or acceptance claim.

- **P3b complete:** P3.5d reserves a bounded root-only P3.6 mailbox slot
  before it consumes a v2 submit session, then publishes only a hash-only,
  one-shot verified-intake handoff after verifier, workspace, session, and
  shadow-witness cleanup converge. The public submit result never carries the
  handoff identifier. If the mailbox is full, the open P3.5 session is left
  untouched; a verified result is never cleaned up and then dropped. P3.5
  masks termination signals as soon as root reads the private gateway result,
  through validation, cleanup, and final publication.
  A separate durable host consumes the record with an exclusive claim bound to
  a freshly allocated generation/cohort, provisions root-owned role leaves,
  creates a distinct five-route 512 KiB transport, verifies PID/UID/GID and
  cgroup-v2 placement before any frame parse, seals each listener for its
  sender, and releases services whose broker/revocation paths remain refusal
  only. Fixed-schema integers reject Python booleans, root/service JSON rejects
  non-finite values and lone surrogates, and stateless peer configs disclose
  real runtime identity only for direct peers. Any claimed-handoff launch or
  teardown uncertainty leaves a root-only abandoned-cohort tombstone and never
  reopens the record. Both normal completion and TERM interruption block
  further termination signals until units, runtime, and durable attempt state
  have reached a terminal outcome. This still creates no Engine/effect/
  acceptance path.

  The 128-record mailbox is an intentional A0 safety/backpressure bound, not
  an archival policy. It preserves an open session before consumption instead
  of dropping work; a compaction/retention protocol is required before this
  transit mailbox is used for unbounded-volume unattended progression.

- **P3.6c complete:** the receipt verifier now owns a third durable leaf that
  commits only the fixed witness-mutation response hashes before it
  acknowledges its probes. Root's read-only audit cross-checks this
  independently owned anchor against the retained witness mutation/head ledger.
  A rewritten mutation ledger recomputed from its header still fails that audit;
  fixed `getHead`/`readback` query records remain outside the independent anchor
  scope. The separately labelled P0-A0 corpus preserves
  all eight original attack IDs and all fifteen baseline categories, but can
  emit only `bounded_a0_report` with `qualification_prohibited: true`; it never
  promotes A0 to an Owner-Kernel P0 pass.

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
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-durable-contract.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-p35-durable-handoff.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-durable-transport.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-durable-host.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-contract.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-host.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-peer.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-peer-service.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-recovery.test.sh
AUTOPILOT_P36_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-live.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-p0-replay.test.sh
AUTOPILOT_P0_A0_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-p0-live.test.sh
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

P3b evidence on 2026-07-23: six focused deterministic gates passed; the P3.5
privileged installed-snapshot gate passed; and the P3.6 privileged
installed-snapshot gate passed 38 assertions covering normal five-role
teardown, replay rejection, direct SIGTERM tombstone/teardown, and SIGKILL
recovery on the next admission.

P3.6c evidence on 2026-07-23: the deterministic bounded P0-A0 corpus and its
negative taxonomy mutations passed. The installed P0-A0 gate passed 59
assertions using a real P3.5d v2 handoff, same-UID/wrong-cgroup outsider peer,
a canonical forged root-ACK attempt, terminal tombstone plus fresh-handoff
recovery, exact secret-class checks, snapshot tamper rejection, and independent
receipt-anchor rewrite detection. Root retains probe evidence and availability
only after every service returns a fresh quiesced snapshot; a terminal failed
cohort retains no verified probe-evidence record. This is substrate evidence
only, not a full or partial P0 qualification.

## 6. Risks and Inversion

| Failure to prevent | Inversion / mitigation |
| --- | --- |
| Shadow boundary quietly becomes production authority. | Separate namespace and explicit source scans forbid P3.5 witness reuse, Engine, P2 calls, effects, and acceptance. |
| A worker impersonates a service through filesystem/socket access. | Exact PID/UID/GID plus cgroup verification before bytes; private roots, independently attested identities, and hostile substitution tests. |
| A Unix socket path exceeds the kernel limit or a receiver rewrites/pre-seeds a published endpoint. | The frozen endpoint layout has a `107`-byte ASCII path guard; root validates the server-created listener, seals its parent to the fixed sender group, requires exactly that one socket entry, and root-cleans rejected staging contents before release. |
| Process hiding makes a cgroup check silently unavailable. | P2b omits `ProtectProc=invisible` only for this substrate, pins release material in private role roots, and requires exact credentials plus `/proc/<pid>/cgroup` before parsing. |
| A healthy early service expires while the root host completes five bounded launches or peer exchange. | The 210-second release window covers the explicit 190-second pre-release bound plus margin; one shared 30-second probe ACK plus 10-second quiescence ACK fit inside the 45-second hold and 300-second unit maximum. |
| Root silently collapses receipt-anchor/witness/coordinator independence. | Installer rejects root for those roles, gives each role a distinct private leaf, and binding validation rejects identity or attestation reuse. |
| A lost response leads to automatic effect replay. | No effects exist in A0; persistent ambiguous state is quarantine/unknown and blocks new work. |
| CAS/batch shape exists but is not durable/atomic. | Readback, chain verification, conflicting concurrent requests, crash-tail, and restart tests are mandatory. |
| A full P3.6 mailbox consumes a verified P3.5 intake without an ingress record. | P3.5 takes the root-only mailbox admission lock and proves bounded capacity before it creates its one-shot submit claim; it holds that reservation through post-cleanup publication. Full capacity leaves the session open. |
| TERM lands between a completed lifecycle and terminal cleanup. | P3.6 blocks INT/TERM inside both normal and error lifecycle paths before leaving the body, and restores the original mask only after units, runtime, tombstone/attempt, and locks are finalized; the live gate injects TERM after the durable claim. |
| Installer creates a root before ownership setup fails. | The mkdir callback marks this invocation as owner immediately after mkdir, while signals are blocked; any later chown/chmod/snapshot failure rolls back that partial root. |
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
| R4 | Architect | NO-SHIP: the installed P2a snapshot omitted the bridge contract's `actions.js`/`policy.js` transitive dependencies, so Node could not load the copied ABI. Fixed by freezing the exact closure and testing an isolated real ABI load. |
| R4 | QA | NO-SHIP: install interruption could leave a partial snapshot; ack publication could expose a partial file; and ack receipt did not revalidate current MainPID/cgroup/identity. Fixed with interruption rollback, pending-plus-link publication, and receipt-time process revalidation. |
| R4 | Ops/SRE | NO-SHIP: `ProtectSystem=strict` made the runner's acknowledgement path read-only. Fixed by binding one per-role `ReadWritePaths=<ack_root>` exception into the run material and launch command. |
| R5 | Architect | SHIP: P2a source/runtime scope now has a loadable immutable closure and a deterministic second-interrupt teardown proof. |
| R5 | QA | SHIP: no remaining Critical/Major; second SIGINT between cleanup callbacks is deferred until all unit and runtime cleanup finishes. |
| R5 | Ops/SRE | SHIP: the writable exception is limited to each role's pinned ack directory; no role or release/runtime-parent write capability was added. |
| R6 | Architect | SHIP: fixed-topology no-effect IPC preserves credential-before-frame checks, listener-ready ordering, root socket sealing, and root-pinned runtime claims; pre-seeded socket entries now fail closed and clean up. |
| R6 | QA / Skeptic | SHIP: exact schema, canonical/hash-bound frames, 107-byte socket boundary, rehashed cross-route rejection, shared ack deadline, and no-effect receipt pairing all have deterministic negative coverage. |
| R6 | Ops/SRE | SHIP: a fresh installed `install -> run-probe` completed all five role peer proofs and teardown with no runtime, transient-unit, process, account, or snapshot residue; bounded lifecycle values are consistent. |
| R7 | Architect | NO-SHIP before an ABI split: P2b's frame ceiling and probe-only result cannot carry actual batch/readback or state semantics; durable transport also needs an explicit broker-to-verifier handshake route. |
| R7 | QA / Skeptic | NO-SHIP before response schemas: coordinator's old blanket disabled result conflicts with required fenced recovery state, and no exact witness/coordinator success, unknown, or quarantine receipt exists yet. |
| R7 | Ops/SRE | NO-SHIP before cohort/lifecycle separation: a service restart cannot reuse PID/cgroup claims, and shared durable write roots would collapse the service ownership boundary. |
| R8 | Architect | SHIP: recovery now enforces the same coordinator operation/status semantics as the live handler; hash-self-consistent invalid terminal records quarantine, and the Python `unknown` reservation cross-validates in the Node ABI normalizer. |
| R8 | QA / Skeptic | SHIP: hostile lone-surrogate journal records quarantine instead of crashing; receipt/readback/head invariants, exact replay, unknown reservations, and Python broker/revocation results have focused deterministic coverage. |
| R8 | Ops/SRE | SHIP: root-owned leaf, lock, fsync, capacity, cohort-reuse, and quarantine behavior remains fail-closed after the final reservation and revocation changes. |
| R9 | Architect | SHIP: P3.5 masks from root-private result read through cleanup/publication, the pre-claim mailbox reservation holds through publication, and P3.6 normal/TERM finalization plus installer mkdir rollback are closed. |
| R9 | Ops/SRE | SHIP: P3.5/P3.6 privileged gates pass; P3.6 covers direct TERM teardown and SIGKILL recovery. The 128-record mailbox is accepted as A0 backpressure, with compaction/retention explicitly deferred. |
| R9 | QA / Skeptic | SHIP: focused hostile-schema, redaction, transport, handoff, recovery, and installed-snapshot lifecycle gates pass with no remaining Critical/Major finding. |
| R10 | Architect / Ops / QA | SHIP for the bounded A0 follow-on only: require an independently owned receipt anchor, a real P3.5-to-P3.6 live handoff, a same-UID/wrong-cgroup pre-frame probe, and explicit non-qualification taxonomy. The original P0 semantic replay remains pending. |
| R11 | Architect / Ops / QA | SHIP for P3.6c's bounded A0 evidence hardening: the root ACK path now has credential-checked two-phase quiescence before evidence persistence, mutation receipts have an independent anchor, and the frozen P0-A0 corpus passed its 59-assertion privileged live gate without fixture residue. This does not upgrade the pending full P0 semantic replay. |
