# R1 — Skeptic / Product attack review

> Independent pass. Scope is Autopilot coding only.

## Core challenge

The reported pain is cross-host reuse and maintenance. That does not yet prove a need for a new primary harness, central process, cross-host live attach, or universal front door. The evidence currently points to a packaging and behavior-verification problem.

## Findings

### 🔴 Critical — No user-visible success definition

The plan could choose an option and still leave daily use unchanged.

**Smallest fix:** require a command that answers:

```text
What Autopilot capabilities work on this installed host package?
Which are unsupported by design?
Does this package match the canonical core?
Can a deterministic Mission resume without repeating a settled effect?
```

The output must distinguish `supported`, `degraded`, and `unsupported_by_design`.

### 🟠 Major — Supervisor and standalone-runtime ideas lack a real trigger

Continuing after a front door exits and attaching from another host are not established daily requirements. Existing durable Mission state and resumed CLI may already be enough.

**Smallest fix:** remove those designs from active execution. Re-entry requires two recorded real incidents in which resumed CLI plus durable state could not continue safely.

### 🟠 Major — A standalone primary UI may worsen the preferred workflow

The current value is working inside the coding harness the operator already uses. A new primary UI may add context switching while native packages must remain for skills and hooks.

**Smallest fix:** preserve host-native entry as the default. Consider another UI only after an executable conformance report proves a required capability cannot be delivered through existing hosts.

### 🟠 Major — Option 0 must still produce a useful deliverable

A pure architecture memo is not enough.

**Smallest fix:** even a keep-current decision must ship an **Autopilot Host Conformance** report and regression gate. This turns a no-migration result into an operational improvement.

### 🟡 Minor — Equal features across hosts is the wrong goal

Demanding universal parity will cause emulation layers or lowest-common-denominator behavior.

**Smallest fix:** publish honest capabilities and preserve native strengths.

## Proposed product

> **Autopilot Host Conformance** — a deterministic self-check proving which coding semantics are delivered by each host package, where behavior is intentionally different, and whether recovery remains fail-closed.

After it stabilizes, onboarding/status can surface the report so a user sees the supported path rather than discovering gaps mid-run.

## Required ending

VERDICT: FIX-THEN-SHIP

SMALLEST SUFFICIENT OPTION: 0

MISSING EVIDENCE:

- recurring operator incidents caused by host divergence;
- executable supported/degraded/unsupported matrix;
- proof that resume-by-CLI is insufficient;
- proof that another primary front door improves the actual workflow.

DELETION ACCOUNTING:

- Remove supervisor-service and substrate-comparison from active phases; keep only re-entry conditions.
- Replace manual option-study artifacts with a reusable conformance report.
- Add no daemon, bridge, runtime, or primary UI in the first implementation.
