# Plan — Owner Kernel promotion: from observer to authority

## 0. Context / thesis

On 2026-08-10 a six-seat independent panel (gpt-5.6-sol, claude-fable-5, grok-4.5, GLM-5.2,
MiniMax-M3, kimi-k3) ruled on the Owner Kernel release gates under delegated Board authority. Three
findings landed as commits:

- `64d25182` — alias retirement gates deletion, not the release that starts its clock
- `857cd510` — KR10 retired as a release gate (unsatisfiable as authored, gameable, actively harmful)
- `aac4a748` — gate strictness binds to what the release claims (`shadow` vs `production`)

Those cleared the false blockers. **They did not advance the Board's goal**, and one seat said so
explicitly. sol dissented from shipping shadow-mode at all:

> a system that decides nothing contributes nothing to autonomous correct completion; shipping shadow
> is acceptable only as an explicitly incomplete milestone, not as fulfilment of the Board's goal.

That dissent is correct on the merits and was recorded rather than outvoted. This plan is its
charter. The Board asked for one thing — *a framework that lets AIs autonomously drive tasks to
correct completion* — and the kernel currently drives nothing.

The panel also converged on **why** the project drifted into a shadow that could not end: its own
2026-07-20 Decision Log records that "the plan's deletions are prose, its additions are executed
modules". Additions carried executable evidence; removals carried only intent. This plan fixes that
asymmetry as a mechanism, not as a promise.

## 1. Problem

The Owner Kernel observes and records. `legacy_execution_authority` is `unchanged`,
`owner_kernel_authority` is `shadow`, and all four `/l3`-`/l6` entry points route to legacy
execution. ~31,000 lines of governance machinery decide nothing.

Promotion has previously been framed as "delete the old entry points", which made it a scope
explosion and coupled it to an alias-retirement clock that could never start. sol reframed it:
**keep all four entry points as thin adapters and move the authority underneath them.** No capability
is deleted, no alias needs retiring, and the surface count that KR10 used to punish becomes
irrelevant.

## 2. OKR / KRs

**Objective**: the kernel is the sole completion authority on every supported path, and its
correctness is demonstrated by evidence a reader can re-execute.

| KR | Statement | Verified by |
|---|---|---|
| **KR-P1** | Every `/l3`-`/l6` invocation reaches a terminal state issued by the kernel. Legacy execution remains reachable only through an explicit operator rollback flag, never as a fallback. | `hooks/tests/owner-kernel-promotion.test.sh`: each entry point drives a task to terminal; a planted kernel failure must NOT produce a legacy completion. |
| **KR-P2** | No `COMPLETE` is emitted unless every bound check passed. Any unsatisfied check terminates `BLOCKED`. Zero fall-through paths. | Planted-control matrix: for each of {veto non-empty, evidence unbound, challenge absent, approval unconsumed}, the run terminates `BLOCKED` and no artifact is accepted. |
| **KR-P3** | Every retirement (of an entry point, a module, or an authority) emits an executable receipt naming what was removed, what replaced it, and the evidence the replacement passed. A retirement without a receipt fails closed. | `scripts/check-retirement-receipts.js --check` exits non-zero when a tracked removal has no receipt. |
| **KR-P4** | Shadow and legacy decisions are compared on live traffic; divergence is measured, not asserted. Promotion of a path requires a recorded divergence window on that path with zero unexplained divergences. | `scripts/divergence-monitor.js report --path <entry>` emits per-path counts; promotion refuses a path with `unexplained > 0` or `samples == 0`. |
| **KR-P5** | A production witness adapter exists, is deployed outside the repo, and is bound by sha256 to root-owned trust roots created by a documented procedure. No release evidence is ever accepted from a `trustTier: 'test'` witness. | `bash hooks/tests/trust-root-provisioning.test.sh` — six negative cases (symlink, non-root uid, group-writable, `adapter_module` present in authority file, mismatched `authority_id`, repo-resident adapter) each rejected; plus a control asserting `MemoryWitness` is refused as release evidence. |

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10; built-ins only for anything that may run under a dep-minimal sandbox.
- **No `/l3`-`/l6` entry point may be deleted.** They remain as thin adapters. Promotion moves
  authority, never capability.
- `--release-claim shadow` must continue to fail closed the moment a production-authority
  constructor is called from outside `src/engine/supervised-owner-kernel-*`. Do not weaken or
  special-case `evaluateShadowBoundary`.
- Fixture evidence never establishes production behaviour, in any gate, at any phase.
- Never fabricate elapsed time, telemetry, provenance, or signer identity.
- Every new gate ships with a planted negative control proving it fires. A gate whose test suite
  passes when the gate is removed has not been tested.
- Production trust roots are the fixed `/etc/autopilot` paths only — never env, HOME, project dir,
  or a CLI flag.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`. All four `/l3`-`/l6` entry points keep their
  current invocation surface and continue to work; only the authority underneath them changes.
  Operator rollback (`--legacy-authority`) is added, not removed. No consumer migration required.
- **Dependency decision**: `none`. Every component uses Node built-ins and existing repo primitives
  (owner-kernel modules, the dispatch-unit contract, `lib/jsonl-store.js`). No new dependency is
  introduced or needed.

## 3. File-structure map

| File | Responsibility | Phase |
|---|---|---|
| `src/host-adapters/witness-adapter.js` | **DONE 2026-08-10.** The host-resident production witness, and the deepest gap in the project: adapter-owned anchored `getAppendTimestamp()`, durable append-only head, non-writable `trustTier: 'external'`, self-contained (the deployed copy must not `require()` repo code). Never existed before; every P0-P4 suite ran against the test-only `MemoryWitness` the release gate forbids. Source lives here; the **deployed copy** goes to a host path outside the repo, pinned by sha256. | P1 |
| `hooks/tests/host-witness-adapter.test.sh` | **DONE 2026-08-10.** 10 assertions incl. canonical-JSON byte-parity with the repo, and the non-vacuity control asserting `MemoryWitness` is still refused as production authority. | P1 |
| `docs/runbooks/trust-root-provisioning.md` | **DONE 2026-08-10.** Root-operator procedure: deploy adapter outside repo, pin by sha256, create both `/etc/autopilot` files, lock ownership/mode, verify. States why the step is human-gated and why passwordless sudo does not change that. | P1 |
| `hooks/tests/trust-root-provisioning.test.sh` | **New.** Acceptance check: one correct provisioning passes the loader; six insecure/self-supplied variants fail. | P1 |
| `src/engine/owner-kernel/terminal.js` | **New.** Single terminal-state issuer. Emits `COMPLETE` only with every bound check satisfied; otherwise `BLOCKED`. No other module may issue a terminal state. | P2 |
| `src/engine/owner-kernel/kernel.js` | Route terminal issuance through `terminal.js`; remove any direct completion emission. | P2 |
| `scripts/check-retirement-receipts.js` | **New.** Scans tracked removals against `docs/retirement-receipts/`; fails closed on an unreceipted removal. | P3 |
| `docs/retirement-receipts/` | **New.** One JSON receipt per retirement: what was removed, replacement, evidence ref, commit. | P3 |
| `scripts/divergence-monitor.js` | **New.** Records shadow-vs-legacy decision pairs per entry point; reports counts and unexplained divergences. | P4 |
| `src/engine/owner-kernel/shadow-translation.js` | Emit a decision pair to the monitor on every shadow translation. Additive; existing telemetry unchanged. | P4 |
| `src/engine/owner-kernel/compatibility.js` | Add per-path promotion state (`shadow` / `promoted`) resolved from policy, consumed by the adapters. | P5 |
| `skills/l3/SKILL.md` … `skills/l6/SKILL.md` | Become thin adapters: resolve promotion state, route to kernel when promoted, legacy only under explicit operator rollback. | P5 |
| `scripts/check-owner-kernel-release-gates.js` | Add `--release-claim promoted`: requires KR-P1..P4 evidence plus production trust roots. | P5 |

## 4. Phases

### P1 — The production witness adapter, then provisioning (size: L) — no dependencies; blocks everything

**Corrected 2026-08-10 after reading the code rather than the phase reports.** This phase was first
sized S — "write a runbook for two JSON files". That was wrong, and the reason matters more than the
correction: the two trust-root files are not the deepest gap. They bind an `adapter_module` by
sha256, and **that adapter has never been written**.

Evidence, not inference:

- `src/engine/owner-kernel/witness.js:81` — `MemoryWitness` is annotated "permanently test-only" and
  hard-sets `trustTier: 'test'` as a non-writable, non-configurable property. Its own comment says
  "Production callers must inject a separate host-resident witness adapter."
- `scripts/check-owner-kernel-release-gates.js:776` — release evidence requires the authority to
  expose `getAppendTimestamp()` over adapter-owned anchored timestamps.
- A repo-wide search for `getAppendTimestamp` returns exactly one file: the checker that demands it.
  **No implementation exists anywhere.**

So every green suite in P0-P4 ran against a witness the release gate explicitly forbids, and the
project could never have left shadow — not because a clock had not started, but because the
component that would make production evidence possible was never built. This is the single reason
the work sat complete-but-inert for three weeks.

1. ~~Implement the host-resident witness adapter.~~ **DONE 2026-08-10** —
   `src/host-adapters/witness-adapter.js`, proven by `hooks/tests/host-witness-adapter.test.sh`
   (10 assertions). `trustTier` is a non-writable `'external'`, so the kernel gate accepts it with
   no `allowTestWitness` escape; `getAppendTimestamp()` resolves from the adapter's own durable
   journal over a receipt the checker has already stripped of every time-shaped field; the journal
   is append-only, fsync'd, lock-guarded, and its head survives adapter reconstruction. Caller-
   supplied time is **rejected**, not ignored. Two properties are enforced beyond the written
   contract, both because the tests demanded them: a tampered journal line cannot map a forged
   receipt onto a genuine timestamp (the stored line is re-hashed on every lookup *and* on every
   `verify`), and canonical-JSON byte-parity with `src/engine/owner-kernel/canonical.js` is asserted
   rather than assumed — the deployed copy cannot `require()` repo code, so a silent hash divergence
   would corrupt every receipt chain without failing loudly.
2. Deploy it to a host path outside the repo and outside the project dir (the binding loader refuses
   an adapter resolving inside either), and record its sha256.
3. ~~Write `docs/runbooks/trust-root-provisioning.md`.~~ **DONE 2026-08-10** — seven steps, each command verified runnable, plus an explicit rollback and a "never do these" list mirroring the loader's own refusals. Derived from
   `loadTrustedInstalledWitnessAuthority` and `loadTrustedWitnessAdapterBinding`:
   - authority file: `kind` ∈ {`trusted_installed_witness_authority`,
     `p37_installed_witness_authority`}; non-empty `stream_id`; `receipts` or `receipt_journal`
     array; `authority_id` matching `/^[A-Za-z0-9._:-]{1,128}$/`; **no** `adapter_module` /
     `adapter_sha256` (adapter identity comes only from the binding).
   - binding file: `kind` ∈ {`trusted_installed_witness_adapter_binding`,
     `p37_installed_witness_adapter_binding`}; `adapter_module` resolving outside repo and project;
     `adapter_sha256` matching the deployed file; `authority_id` equal to the authority file's; **no**
     `anchored_append_timestamps` (the adapter owns those, not the config).
4. State the placement rules from `assertSecureInstallationPath`: regular file (not symlink), uid 0,
   `mode & 0o022 == 0`, and the same for every ancestor directory.
5. State the prohibitions: never source content from the repo, project dir, or environment; never set
   `skipInstallationOwnershipChecks`. The loader already refuses these — the runbook must not teach a
   reader to work around them.
6. Write `hooks/tests/trust-root-provisioning.test.sh`: a correct pair passes the loader; six
   insecure variants each fail with the loader's own reason.

**Acceptance**: the adapter exists and is deployed outside the repo; `--release-claim production`
progresses past the trust-root reasons (KR8 may still hold on telemetry volume, which is P4's job);
the acceptance test rejects all six negative cases. An in-repo installer stays out of scope.

**Human-gated step**: the root operator performs the provisioning. This is deliberate and must not
be automated by the kernel or by an agent — the operator establishes which evidence source is
trusted, and the kernel then decides qualification from it. An agent minting its own trust anchor is
the one genuine circularity both review panels identified.

1. Write `docs/runbooks/trust-root-provisioning.md`. Derive the required shape from
   `loadTrustedInstalledWitnessAuthority` and `loadTrustedWitnessAdapterBinding`, not from memory:
   `kind` ∈ {`trusted_installed_witness_authority`, `p37_installed_witness_authority`}; non-empty
   `stream_id`; `receipts` or `receipt_journal` array; `authority_id` matching
   `/^[A-Za-z0-9._:-]{1,128}$/` and equal to the binding's `authority_id`; **no** `adapter_module` /
   `adapter_sha256` in the authority file.
2. State the placement rules from `assertSecureInstallationPath`: regular file (not symlink), uid 0,
   `mode & 0o022 == 0`, and the same for every ancestor directory.
3. State the prohibitions explicitly: never source content from the repo, the project dir, or the
   environment; never set `skipInstallationOwnershipChecks`. The loader already refuses these — the
   runbook must not teach a reader to work around them.
4. Write `hooks/tests/trust-root-provisioning.test.sh`: provision a correct pair in a disposable
   root-owned fixture and assert the loader returns `ok: true`; then assert each of the six insecure
   variants returns `ok: false` with the loader's own reason.

**Acceptance**: the runbook exists, and the acceptance test passes with all six negative cases
rejected. An installer remains explicitly out of scope (an in-repo installer blurs the workspace /
deployment boundary the loader exists to enforce).

### P2 — Closed-loop terminal discipline (size: L) — no dependencies; blocks P5

sol's Critical finding: the existing primitives verify artifacts, but nothing prevents a failed run
from falling through to legacy.

1. ~~Create `src/engine/owner-kernel/terminal.js`~~ **DONE 2026-08-10.** `freezeChecks()` +
   `issueTerminal()`, proven by `hooks/tests/owner-kernel-terminal.test.sh` (11 assertions). The
   decisive one is `no_third_outcome`: an exhaustive sweep of all 32 combinations of the four
   obligations crossed with bound/unbound artifacts yields exactly ONE `COMPLETE` — the all-satisfied,
   artifact-bound case — and every other combination returns `BLOCKED` with `accepted_artifact: null`.
   Also enforced: silence is not consent (a missing result is unsatisfied), only `satisfied === true`
   passes (`'false'`, `0`, `undefined`, truthy-non-true all block), an empty obligation set cannot
   complete vacuously, and a check set altered after freezing cannot fund a completion.
2. Freeze the check set before execution: acceptance predicates and authority boundaries are bound
   at dispatch time and hashed, so the set cannot grow or shrink mid-run.
3. Permit bounded repair: a `BLOCKED` result may be re-verified up to the policy's
   `max_recover_cycles`, and each attempt re-runs the frozen checks. Exhausting the budget stays
   `BLOCKED`.
4. **Deferred to P5, deliberately.** Routing `kernel.js` (4357 lines, with its own mature terminal
   discipline — `OwnerKernelBlockedError`, `terminal_reason`, post-terminal rejection) through the new
   issuer is a change whose real behaviour cannot be observed while nothing in production calls the
   kernel. Rewiring it now would mean editing the most intricate module in the project against tests
   only, then discovering at promotion whether it was right. The issuer exists and is proven; P5 wires
   it as part of making the kernel authoritative, when the wiring can be verified against actual
   traffic. Recorded here rather than silently dropped.

**Acceptance**: the planted-control matrix in KR-P2 — four planted failures, four `BLOCKED`
terminations, zero accepted artifacts, and a fifth control where all checks pass yielding exactly one
`COMPLETE`.

### P3 — Retirement receipts (size: L) — no dependencies

fable's finding: additions carry executable evidence, removals carry prose. This closes the asymmetry
that produced the KR10 failure in the first place.

1. ~~Define the receipt shape~~ **DONE 2026-08-10** — `docs/retirement-receipts/README.md`.
   `evidence` may never be null even when `replaced_by` is: something must still show nothing broke.
2. ~~Write `scripts/check-retirement-receipts.js`~~ **DONE 2026-08-10**, proven by
   `hooks/tests/check-retirement-receipts.test.sh` (15 assertions). Renames are resolved with
   `git diff -M` — a move is not a retirement, and demanding a receipt for one produces the noise
   that gets gates switched off. Generated Codex mirrors are exempt for the same reason. A regime
   start commit bounds it: history is not backfilled, because retroactive paperwork carries no
   evidentiary value and invites disabling the check.
3. Backfill receipts for retirements this charter's own work performs; history stays unbackfilled.
   Nothing to backfill yet — the regime range is currently clean.

**Acceptance**: a planted deletion without a receipt exits non-zero and names the file; the same
deletion with a valid receipt exits zero.

### P4 — Divergence monitor (size: L) — depends on P1 for production evidence; blocks P5

kimi's proposal, and the evidence source promotion needs. Promotion currently has no data behind it.

1. ~~Write `scripts/divergence-monitor.js`~~ **DONE 2026-08-11**, proven by
   `hooks/tests/divergence-monitor.test.sh` (17 assertions). Observations are of two kinds and are
   never conflated: `paired` (both decisions present, counts toward `samples`) and `shadow_only`
   (legacy side absent, funds nothing). Only `samples` can support a promotion, so an unexercised
   path reports `samples: 0` and `NOT READY` rather than vacuous agreement. A corrupt row counts
   against EVERY path query — it has no readable `entry_path`, and filtering it out would shrink the
   denominator and make agreement look better than it is. That was a real bug the suite caught.
2. **Deferred to P5, deliberately.** Emitting from `shadow-translation.js` would install a hook with
   no consumer: nothing holds the legacy decision today, so every emission would be `shadow_only` and
   fund nothing. The pair becomes real when P5 puts both sides in one place. Recorded rather than
   silently dropped — same judgement as P2 step 4.
3. ~~`report --path <entry>`~~ **DONE** — emits `{samples, agreements, divergences, unexplained,
   shadow_only, corrupt_rows}`. A divergence is "explained" only when a recorded reason is present,
   and an empty-string reason is not one; the monitor never infers an explanation, because an
   inferred explanation is how a real disagreement becomes a footnote.

**Acceptance**: `report` on a seeded store returns exact counts; a divergence with no reason is
counted `unexplained`; a path with zero samples reports `samples: 0` rather than an empty pass.

### P5 — Promotion (size: H) — depends on P1, P2, P4

1. Add per-path promotion state to `compatibility.js`, resolved from policy and frozen into the
   policy hash.
2. Convert the four skills to thin adapters: resolve state, route to the kernel when promoted, and
   to legacy **only** under an explicit operator rollback flag — never as an automatic fallback.
3. ~~Add `--release-claim promoted`~~ **DONE 2026-08-11.** Strictly harder than `production`: it
   requires production KR8 evidence, per-path divergence evidence read from the monitor rather than
   asserted, and the shadow boundary **inverted** — an intact boundary means no production-authority
   constructor is reached, so the kernel decides nothing and a promoted claim is false on its face.
   Currently HOLDs with seven reasons (2 KR8, 1 boundary-still-intact, 4 zero-sample paths), each
   naming a real gap rather than a missing formality.
4. Promote one path first (`/l5`, the most exercised), gather a divergence window, then the rest.

**Acceptance**: for each promoted path, a task drives to a kernel-issued terminal; a planted kernel
failure yields `BLOCKED` and never a legacy completion; `--release-claim promoted` holds until that
path's divergence window shows zero unexplained divergences.

## 5. Test / validation

Script-gated (must pass unattended):

```bash
bash hooks/tests/trust-root-provisioning.test.sh      # P1
bash hooks/tests/owner-kernel-terminal.test.sh        # P2
node scripts/check-retirement-receipts.js --check     # P3
bash hooks/tests/divergence-monitor.test.sh           # P4
bash hooks/tests/owner-kernel-promotion.test.sh       # P5
bash hooks/tests/owner-kernel-release-gates.test.sh   # regression: claim gating intact
bash hooks/tests/run.sh                               # full suite
```

Human-gated: the P1 runbook must be executed once on a real host by a root operator. That execution
is the only thing in this plan that a script cannot self-certify, and it is deliberately human —
minting a trust root is the provisioning act the whole authority chain bottoms out on.

Every phase ships its planted control. A phase whose suite still passes after its gate is deleted is
not done.

## 6. Risks + inversion

**What would guarantee this fails?**

| Risk | Mitigation |
|---|---|
| The pattern that produced this situation repeats: interfaces get built, suites go green against test doubles, and nobody notices the production component was never written. This project ran three weeks complete-but-inert for exactly that reason. | Every phase's acceptance names the *production* artifact, not the interface. KR-P5 additionally requires a control asserting a `trustTier: 'test'` witness is REFUSED — a green suite must be impossible to obtain from a double. |
| Promotion becomes "delete the old thing", re-triggering scope explosion and the alias clock. | §2.5 forbids deleting any entry point. Adapters stay. |
| A failed kernel run silently falls back to legacy, so promotion is cosmetic and nobody notices. | KR-P2's planted controls assert the *absence* of a legacy completion, not just the presence of `BLOCKED`. |
| The divergence monitor reports agreement because it never sampled anything. | `report` distinguishes `samples: 0` from agreement; promotion refuses a path with zero samples. |
| `--release-claim promoted` becomes a rubber stamp the way KR10's threshold nearly did. | It requires evidence from four independent KRs plus an inverted boundary scan; no single number can satisfy it. |
| Receipts become prose again — a JSON file asserting a removal was fine. | The receipt's `evidence` field must name a test or gate; `check-retirement-receipts.js` verifies the named evidence exists and passes. |
| We promote everything at once and cannot attribute a regression. | P5 step 4: one path first, divergence window, then the rest. |

## 7. Out of scope

- Deleting `/l3`-`/l6`, or any alias retirement. The adapters are permanent as far as this plan is
  concerned; retirement remains a separate future decision with its own gate (already correctly wired
  to fire only on an attempted removal).
- An in-repo installer for the trust roots. The runbook is the deliverable; an installer would blur
  the deployment boundary the loader enforces.
- Reviving KR10 or any load-bearing-surface threshold. Retired 2026-08-10; the reversal condition is
  recorded in the project Decision Log and is a successor question, not this plan's.
- Remote/quorum witness infrastructure, or defence against compromise of the trusted host. Host root
  is inside the trusted computing base by design.
- Cross-platform promotion. The supervised host path is Linux-only; other harnesses stay shadow.

## 8. Open questions

None blocking. The Board has delegated the arithmetic and the ruling; every decision this plan needs
has been made and recorded. Two items are *operator* actions rather than open questions: who runs the
P1 provisioning on a real host, and when the first `/l5` divergence window opens.

## Review log

- **R0** — authored 2026-08-10 at depth 0, synthesising a six-seat panel: gpt-5.6-sol,
  claude-fable-5 (both across three rounds including one cross-examination), grok-4.5, GLM-5.2,
  MiniMax-M3, kimi-k3 (independent, unanchored). Unanimous on KR10 retirement; 5-1 on shipping
  shadow-mode, with sol's dissent forming §0 of this charter rather than being outvoted.
