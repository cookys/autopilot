# ADR-0001 — Governance is verification, not attestation

- **Status**: Accepted (Board, 2026-08-16) · shipped as v2.34.10 (removal) + v2.34.11 (replacement)
- **Deciders**: cookys (Board) · two-generation heterogeneous plan reviews (GLM / MiniMax / Grok / GPT families, author family excluded)

## Context

Between 2026-07-20 and 2026-08-16 this repo grew a ~27,000-line "Owner Kernel" trust framework:
a hash-chained event ledger, per-event witness receipts, a root-owned notary adapter outside the
repo, OKR release gates, a shadow second-opinion observer, and a cross-UID supervised isolation
substrate. Every stage was human-approved; the escalation from inert shadow to production trust
roots was chartered on a gpt-5.6-sol panel dissent ("a system that decides nothing contributes
nothing"). Attribution matters and is recorded honestly: **the vocabulary was in the
owner-approved founding plan from day one; sol drove the shadow→production promotion; a human
signed every gate.** The failure mode was Goodhart drift of process machinery, not a rogue engine.
History: [`../plans/2026-07-20-owner-kernel-evolution.md`](../plans/2026-07-20-owner-kernel-evolution.md),
[`../plans/2026-08-10-owner-kernel-promotion.md`](../plans/2026-08-10-owner-kernel-promotion.md).

Architecture review (2026-08-16) found the decisive defect: every acceptance check was
format/hash/policy evaluation **over submitted claims**; independent re-derivation existed
nowhere (the kernel could not even run a test), and truth entered only through caller-injected
verifier adapters that were never implemented. The machinery guaranteed *record integrity* and
*emitter authentication* — while the only real threat in a single-user deployment is *claim
veracity*. Its answer to "did the agent lie?" was "the lie is now immutably recorded, with
correct provenance." Full chain: [`../plans/2026-08-16-owner-kernel-retirement.md`](../plans/2026-08-16-owner-kernel-retirement.md).

An industry survey (dual-agent, adversarial) then bounded the replacement:
[`../plans/2026-08-16-four-layer-redesign-survey.md`](../plans/2026-08-16-four-layer-redesign-survey.md).

## Decision

1. **Remove the trust chain and its substrate entirely** (v2.34.10). Keepers: five shared
   primitives (`canonical/errors/actions/policy/task-authority`) + the live governance config.
2. **Govern by verification contracts, not attestation**: what "done" must prove lives in
   [`../../references/evidence-contract.md`](../../references/evidence-contract.md); enforcement
   is small gates on existing rails, each shipped with a planted red case (v2.34.11): the
   blind-evidence lint, the exec-boundary deny hook, the holdout gate, the cascade
   `--prior-status`.
3. **Scaffolding is capability-indexed, never flat** — T0/T1/T2 fail-closed from measured
   qualification ([`../../references/scaffold-tiers.md`](../../references/scaffold-tiers.md)).
4. **Verification is decorrelated, single-round, cascade-escalated** — one verdict per seat per
   generation, depth-0 adjudicates, never rebuttal rounds; escalation seats a fresh
   disjoint-family reviewer.
5. **Standing constraint: NO trust machinery.** No hash chains, event ledgers, witness receipts,
   attestation issuers, or trust roots. Tamper-evidence of a claim is not verification of the
   claim; only independent re-derivation (re-run, re-scan, decorrelated review) verifies.
   A deliverable that starts to need trust machinery is a stop-and-review, not a design choice.

Rule→enforcer table: [`../../references/four-layer-design.md`](../../references/four-layer-design.md).
Epistemics (why green is not proof; why same-author verification inherits the author's blind
spots): [`../../references/evidence-discipline.md`](../../references/evidence-discipline.md) §8.

## Consequences and direction

- The strong-model thesis, as survey-corrected: constrain **outcomes and evidence**, size process
  by **measured capability**, spend heterogeneity on **decorrelated verification** — not on
  parallel implementation, not on orchestration frameworks, not on cryptographic ceremony.
- Open sequence (BACKLOG-tracked): roster qualification (unlocks /l5 and makes tiering
  non-degenerate) → eval ON/OFF evidence → skill contract-card rewrites under 成績單前置.
  The wider "harness graph" ambition stays narrowed until evidence says otherwise.
- Rebuilding any part of the removed machinery requires overturning this ADR at Board level
  first — with the survey's counter-evidence addressed, not re-argued from first principles.
