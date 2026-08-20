# Plan - P3.6c Independent Receipt Anchor and P0-A0 Corpus
> Status: Complete — receipt anchor and P0-A0 corpus consumed by P3.7 | Owner: CEO autonomous run | Branch: `develop` | Frame: preserve A0 no-effect boundary before Engine integration

## 0. Context

P3.6 A0 now has a root-installed five-role cohort, authenticated local peer
checks, durable witness/coordinator state, and explicit broker refusal. It does
not have an Engine, effect, permit, or acceptance path. The frozen P0 attack
suite, however, includes a self-consistent rewrite of the authoritative ledger
and requires an independent receipt chain to detect it.

The current P3.6 witness journal hashes itself but has no independently owned
receipt-head store. A green lifecycle test therefore cannot be reported as a
full replay of the eight P0 Owner-Kernel semantic attacks. This phase adds the
smallest no-effect receipt anchor needed to test the A0 substrate honestly,
then adds a separately labelled P0-A0 boundary corpus.

## 1. Objective

Provide a receipt-verifier-owned, root-provisioned durable receipt anchor for
witness mutation responses and use it to prove that a self-consistent rewrite
of the witness mutation/head ledger is detected after a cohort terminates. Add deterministic and
installed-snapshot hostile corpus gates that distinguish:

- the A0 analogue actually tested;
- the original P0 Owner-Kernel semantic attack, when that semantic surface does
  not yet exist; and
- any remaining unknown boundary.

This phase must not promote A0 to `full` or `partial`, enable P2 authority, or
claim P0 acceptance metrics are production verified.

## 2. Success Criteria

1. Receipt verifier has an independently attested identity and a distinct,
   root-created durable leaf. Witness cannot write that leaf; worker cannot
   read or write either leaf.
2. Every fixed witness mutation response used by the receipt-verifier A0 probe
   is committed into the receipt-anchor chain before the receipt verifier
   reports its probe success. `getHead` and `readback` are query records: they
   do not advance a stream head and are outside this independent-anchor claim.
   The anchor stores canonical hashes and witnessed heads only; it stores no
   ticket body, workspace path, permit, raw request, action descriptor, or
   acceptance material.
3. A root-only post-teardown audit reads both durable leaves and rejects a
   witness mutation/head ledger rewritten from genesis even when its internal
   hashes are recomputed consistently. The audit never converts a mismatch
   into success.
4. The P0-A0 corpus reports all eight frozen attack IDs with one of
   `held_a0`, `not_applicable_a0`, `unknown_unproven`, or `harness_error`.
   Only `held_a0` is green for its named A0 analogue; no aggregation may turn
   `not_applicable_a0` or `unknown_unproven` into a full P0 pass.
5. A privileged installed-snapshot gate launches a fresh real P3.5 handoff and
   P3.6 cohort, proves an outsider process using the worker UID but not the
   worker cgroup is rejected before a valid frame is parsed, proves that the
   same outsider cannot forge a root ACK socket, and records terminal
   teardown/abandonment before the next handoff is admitted.
6. All A0 outcomes remain exact:
   `owner_kernel_authority: none`, `effect_authority: none`,
   `broker_authority: disabled`, and `acceptance: not_available`.
   Every corpus report additionally carries `qualification_prohibited: true`.

## 2.5 Global Constraints

- Do not add an Engine, OwnerKernel construction, P2 permit, action executor, dispatcher, Git/worktree operation, or acceptance transaction.
- Do not make root the runtime receipt writer; root may provision and audit only.
- Do not treat a P0-A0 corpus result as full/partial host qualification or as a replacement for the later P1/P2 authority replay.
- Do not expose a P3.5 ticket body, root-held workspace path/descriptor, permit, action descriptor, or service secret to the worker.
- Preserve the existing P3.6 ABI route set. The receipt anchor is local receipt-verifier state, not a caller-selectable IPC route.
- Every newly claimed negative control needs a deterministic mutation that makes its oracle fail.

## 3. File Structure Map

| Path | Responsibility |
| --- | --- |
| `src/engine/supervised_production_substrate_durable.py` | Receipt-anchor journal schema, append/idempotency, and root-only cross-leaf audit. |
| `src/engine/supervised-production-substrate-durable-service.py` | Receipt-verifier writes an anchor record after each fixed witness mutation response; every role then emits a root-socket ACK for probe completion and clean quiescence. |
| `src/engine/supervised-production-substrate-durable-host.py` | Provision receipt-verifier leaf, authenticate ACK socket peers by PID/UID/GID/cgroup, run the post-teardown audit, and retain only hash-safe disclosure. |
| `hooks/tests/supervised-production-substrate-p0-replay.test.sh` | Deterministic P0-A0 mapping, hostile/mutation tests, and taxonomy validation. |
| `hooks/tests/supervised-production-substrate-p0-live.test.sh` | Opt-in installed-snapshot outsider-peer and rewrite/audit evidence. |
| `docs/projects/_archive/2026-07-20-owner-kernel-governance/p0/fixtures/p36-a0-corpus.json` | Frozen eight-attack and fifteen-category map; records unavailable original semantics. |
| `docs/projects/_archive/2026-07-20-owner-kernel-governance/p0/fixtures/p36-a0-corpus.js` | Canonical evidence-report verifier; cannot emit a full P0 pass. |
| `docs/projects/_archive/2026-07-20-owner-kernel-governance/p0/P0-FINDINGS.md` | Separate P0-A0 boundary evidence from the original future authority replay. |
| `docs/projects/_archive/2026-07-20-owner-kernel-governance/p3/README.md` | Document P3.6c scope and retained activation blockers. |
| `docs/plans/2026-07-23-p3-6-production-supervised-substrate.md` | Link the closed P3b phase to this required follow-on. |

## 4. Phases

### Phase 1 - Receipt Anchor (L)

1. Extend the durable leaf role allowlist to include `receipt_verifier`, with a
   distinct journal kind and generation manifest. Root provisions the leaf with
   the same strict ownership, mode, fsync, lock, cohort marker, and quarantine
   rules as the witness/coordinator leaves.
2. Define an exact receipt record containing the fixed route ID, canonical
   request hash, envelope hash, response hash, response code/status, witness
   stream/head/sequence commitments where applicable, and prior receipt head.
   Require exact-id replay idempotency and reject a conflicting reuse.
3. Add a root-only audit that validates the receipt chain and cross-checks each
   anchored witness mutation response against the current witness mutation/head
   ledger. A missing,
   malformed, conflicting, stale, or rewritten witness record yields a named
   unavailable/quarantined audit result, never a success.

Done when: a witness mutation/head rewrite with freshly recomputed internal
journal hashes is detected through the separately owned receipt anchor, and a receipt-anchor
mutation makes the deterministic oracle fail.

### Phase 2 - Cohort Integration (L)

1. Provision the receipt-verifier leaf in the host, add it to the exact
   bootstrap/write-path allowlist, and keep it unavailable to worker, broker,
   witness, and coordinator.
2. Change only the fixed receipt-verifier self-probe path: after a verified
   witness mutation response, append its hash-safe anchor before exposing probe
   success.
   No new remote/caller route is added.
3. Require anchor availability alongside witness/coordinator availability. Root
   accepts probe and quiescence ACKs only from an authenticated Unix peer in the
   expected service cgroup. The first ACK proves only fixed-probe completion;
   after listener shutdown each stateful role recomputes its availability
   snapshot for the quiesced ACK. Root uses only those second-phase snapshots,
   and persists probe evidence only after every quiesced ACK succeeds. It then
   stops the cohort and runs the root-only audit before it emits its
   teardown-verified result. Any ACK/anchor/audit failure becomes terminal
   abandoned/unknown evidence and retains no verified probe-evidence record.

Done when: a normal A0 cohort retains three independent durable leaves and
still exposes no effect or acceptance authority.

### Phase 3 - P0-A0 Corpus (L)

1. Freeze a map for every original P0 attack ID. The map must name its A0
   analogue, expected result taxonomy, exact deterministic/live gate, and the
   original semantic status. Direct user-event, owner-decision, policy,
   approval-use, and complete capability-set semantics remain explicitly
   `not_applicable_a0` until their P1/P2 authority surfaces exist.
   The same map records all fifteen P0 baseline categories as
   `not_evaluable_at_a0`; it must not silently omit them.
2. Add deterministic hostile checks and local mutations for handoff/envelope
   substitution, direct witness access, unknown artifact-shaped fields,
   worker-visible capability material, snapshot/ABI drift, disabled execute
   requests, endpoint/binding drift, and witness rewrite detection.
3. Add a report verifier that pins the canonical corpus digest, binds every
   held result to its immutable deterministic gate plus raw gate output marker,
   rejects missing/extra attack IDs and forbidden full-authority claims, and
   rejects any attempt to aggregate non-applicable/unknown results as success.

Done when: every claimed `held_a0` result has a live mutation oracle and all
unavailable original semantics remain explicit in the report.

### Phase 4 - Installed Snapshot Hostile Gate and Review (L)

1. Add an opt-in live gate using a fresh disposable root install and handoff.
   It installs P3.5 and P3.6 snapshots, creates a real descriptor-bound P3.5
   v2 session, submits a signed envelope, and has root discover the resulting
   private handoff only from the configured root mailbox. It must not seed a
   synthetic handoff. The gate then runs an outsider process with the worker
   UID but outside its systemd cgroup against the worker-to-broker socket with
   a syntactically valid frame. It also sends a syntactically valid forged ACK
   to the worker root ACK socket while the real worker is frozen. Both attempts
   must be rejected before frame parsing, leave durable terminal evidence, no
   effect sentinel change, unit/runtime cleanup, and recovery through a new
   real handoff.
2. Add a root-only witness mutation/head rewrite after a completed cohort and prove
   the post-cohort receipt audit rejects it. The live report must distinguish
   the root-adversary test from the worker boundary claim.
3. Run focused tests, both P3.5/P3.6 live gates, the full suite, mirrors, and
   a three-perspective Architect/Ops/Skeptic review. Resolve every Critical or
   Major finding before committing.

Done when: independent review ships the bounded A0 corpus without changing its
no-effect/no-acceptance claim.

## 5. Verification Contract

```bash
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-p0-replay.test.sh
AUTOPILOT_P0_A0_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-p0-live.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-durable-host.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-durable-transport.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-recovery.test.sh
AUTOPILOT_P35_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-intake-live-host.sh
AUTOPILOT_P36_LIVE=1 PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-live.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/run.sh --parallel 16
bash scripts/sync-codex-plugin-skills.sh --check
bash scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/check-canonical-invariants.sh
git diff --check
```

## 6. Risks and Inversion

| Failure | Prevention |
| --- | --- |
| A0 green result is represented as an Owner-Kernel P0 pass. | Frozen taxonomy has no aggregate full-pass state; docs retain P1/P2 authority replay as pending. |
| Witness rewrites its mutation/head ledger and its only evidence. | Receipt verifier owns a distinct durable leaf; audit compares both chains after teardown. |
| Receipt anchor becomes a new authority/effect path. | It accepts only fixed self-probe response commitments and has no public route, permit, descriptor, or accept operation. |
| Same-UID outsider forges a service completion file or races traffic after an early ACK. | Root owns the ACK socket, authenticates its Linux peer before parsing, and requires a second clean-quiescence ACK after listeners close. |
| A report changes its expected gate or replaces execution evidence with arbitrary hashes. | The verifier pins the canonical corpus digest and recomputes each evidence hash from its immutable gate and bounded raw output. |
| Hostile peer test kills a cohort but leaves ambiguous resources. | Assert abandoned attempt/tombstone, unit and runtime teardown, then prove fresh-handoff recovery. |
| `/proc` metadata leaks are mislabeled as secrets. | Test and document the exact prohibited data classes; do not make a blanket process-memory confidentiality claim while cgroup verification requires `/proc`. |
| A mutation test tests only a copy or mock. | Each claimed live result uses an installed snapshot, fresh handoff, real systemd service cohort, and retains a bound output hash. |

## 7. Out of Scope

- Engine wiring, action dispatch, permits, effects, acceptance, or alias retirement.
- A remote/quorum witness or protection against root/host compromise.
- Full P0 Owner-Kernel semantic completion, KR8/KR10 measurement, dogfood, or P4 model gating.
- Broad process-memory secrecy claims beyond the exact worker-visible data classes tested here.

## Review Log

| Round | Perspective | Result |
| --- | --- | --- |
| R0 | Architect | A0 needs a separate receipt anchor to make the original full-chain rewrite attack meaningful; original owner/policy/approval semantics remain absent. |
| R0 | Ops/SRE | Existing live gate proves lifecycle only; add actual outsider worker-UID/cgroup attack, conservative cleanup deadline, and distinct adversary columns. |
| R0 | QA/Skeptic | No P0 full pass is honest until an independent receipt-chain oracle exists; require taxonomy and mutation proof before reporting any A0 result. |
| R1 | QA/Skeptic | NO-SHIP: the corpus evidence map was mutable, the receipt claim overreached unanchored queries, the same-UID actor was mislabeled, and active attempts could be audited as terminal. Fixed with a frozen corpus digest and gate binding, mutation/head-only wording and audit, corrected taxonomy, and a terminal-attempt guard with a deterministic negative. |
| R2 | Architect / Ops/SRE | NO-SHIP during live hardening: a forged root ACK and an outsider terminal abort could race evidence publication, while broad cleanup and PID-only ownership could affect resources not created by this fixture. Fixed with root-owned credential-checked ACK sockets, two-phase quiescence before evidence persistence, scoped unit tracking, PID start-token tracking, and lock/provenance-bound fixture identities. |
| R3 | Architect / Ops/SRE / QA-Skeptic | SHIP: no remaining Critical/Major in the bounded A0 claim. P0-A0 live passed 59 assertions and left no lock, fixture identity, transient unit, runtime parent, or host residue; deterministic contract, host, recovery, and replay gates also pass. |
