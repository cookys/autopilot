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
| **KR-P5** | The two `/etc/autopilot` trust roots have a documented provisioning procedure, and that procedure is proven by an acceptance check that a correct file passes and an insecure one fails. | `bash hooks/tests/trust-root-provisioning.test.sh` — six negative cases (symlink, non-root uid, group-writable, `adapter_module` present in authority file, mismatched `authority_id`, repo-supplied path) each rejected. |

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
| `docs/runbooks/trust-root-provisioning.md` | **New.** Root-operator procedure for the two `/etc/autopilot` files: required fields, ownership, mode, what must never source them. | P1 |
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

### P1 — Trust-root provisioning (size: S) — no dependencies

The two `/etc/autopilot` files gate every production claim, and nothing in the repo produces or
documents them. All six seats called this an in-scope gap.

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

1. Create `src/engine/owner-kernel/terminal.js` exporting `issueTerminal({ checks, artifact })`.
   It emits `COMPLETE` only when every entry in `checks` reports satisfied; otherwise `BLOCKED` with
   the unsatisfied set. It has no third outcome and no fall-through branch.
2. Freeze the check set before execution: acceptance predicates and authority boundaries are bound
   at dispatch time and hashed, so the set cannot grow or shrink mid-run.
3. Permit bounded repair: a `BLOCKED` result may be re-verified up to the policy's
   `max_recover_cycles`, and each attempt re-runs the frozen checks. Exhausting the budget stays
   `BLOCKED`.
4. Route `kernel.js` through it and remove every other completion emission.

**Acceptance**: the planted-control matrix in KR-P2 — four planted failures, four `BLOCKED`
terminations, zero accepted artifacts, and a fifth control where all checks pass yielding exactly one
`COMPLETE`.

### P3 — Retirement receipts (size: L) — no dependencies

fable's finding: additions carry executable evidence, removals carry prose. This closes the asymmetry
that produced the KR10 failure in the first place.

1. Define the receipt shape in `docs/retirement-receipts/README.md`: `removed` (path or authority
   id), `replaced_by`, `evidence` (test or gate that proves the replacement works), `commit`.
2. Write `scripts/check-retirement-receipts.js`. It diffs tracked deletions over a commit range and
   fails closed when a removal under a governed path (`src/engine/`, `skills/`, `scripts/`) has no
   matching receipt.
3. Backfill receipts for the retirements this charter's own work performs; do not backfill history.

**Acceptance**: a planted deletion without a receipt exits non-zero and names the file; the same
deletion with a valid receipt exits zero.

### P4 — Divergence monitor (size: L) — depends on P1 for production evidence; blocks P5

kimi's proposal, and the evidence source promotion needs. Promotion currently has no data behind it.

1. Write `scripts/divergence-monitor.js` with `record` and `report` subcommands over a JSONL store
   (`lib/jsonl-store.js`). A record is one decision pair: entry point, shadow decision, legacy
   decision, agreement, and a reason when they differ.
2. Emit a pair from `shadow-translation.js` on every translation. Additive only — existing telemetry
   fields and hashes are unchanged.
3. `report --path <entry>` emits `{samples, agreements, divergences, unexplained}`. A divergence is
   "explained" only when a recorded reason is present; the monitor never infers one.

**Acceptance**: `report` on a seeded store returns exact counts; a divergence with no reason is
counted `unexplained`; a path with zero samples reports `samples: 0` rather than an empty pass.

### P5 — Promotion (size: H) — depends on P1, P2, P4

1. Add per-path promotion state to `compatibility.js`, resolved from policy and frozen into the
   policy hash.
2. Convert the four skills to thin adapters: resolve state, route to the kernel when promoted, and
   to legacy **only** under an explicit operator rollback flag — never as an automatic fallback.
3. Add `--release-claim promoted` to the release-gate checker, requiring: KR-P1..P4 evidence,
   production trust roots present, and the shadow-boundary scan **inverted** for promoted paths (the
   authority constructors are now expected to be reachable there, and their absence is the failure).
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
