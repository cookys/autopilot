---
name: audit
description: >
  Compare two existing implementations and find every difference. Use when: "compare X with Y",
  "check X against Y", "verify X matches Y", "flag anything missing", "比對 X 和 Y",
  "檢查有沒有漏掉", "驗證是否一致", feature parity review between old and new systems,
  an existing spec against an implemented target, or cross-system completeness checks. Not for
  future/unimplemented plan readiness, architecture-plan critique, debugging a single discrepancy,
  or writing comparison tests.
---

# Systematic Comparison Audit

> Routing overlap? If this intent better matches a sibling skill, redirect per [references/routing-tiebreaks.md](../../references/routing-tiebreaks.md) (prefer implementation parity over prose doc alignment).

## Project Audit Config
!`cat .claude/audit-config.md 2>/dev/null || true`

## Key Concepts

| Term | Definition |
|------|-----------|
| **Source** | The spec, old system, or canonical implementation -- the "source of truth" |
| **Target** | The new system or implementation being audited |
| **Parity** | Target covers all source capabilities correctly |
| **By-Design** | Intentional divergence between source and target |

## Methodology

### Phase 1: Define Scope

Establish before exploring code:
1. What is the Source (reference)?
2. What is the Target (audited)?
3. What constitutes parity? (functional equivalence | field completeness | behavioral match)
4. What differences are known By-Design?

#### Target-exists precondition (hard routing gate)

Resolve both Source and Target to concrete artifacts before comparing them. The Target must be an
**already-existing implementation/system/code path**, not a feature described only in a future
plan. The current repository as a whole is not a substitute for a missing future target.

If the Target does not exist, stop before Phase 2 and return:

```text
status: routing_precondition_failed
reason: parity audit requires an existing target implementation
route: plan-readiness reviewer
```

Repository code may verify factual premises in a plan, but its absence of the planned future
feature is not a parity finding.

### Phase 2: Parallel Exploration

Split into segments (Entry/Init, Core Ops, Edge Cases, Post-Op, Field Completeness). For each, compare **presence**, **correctness**, **completeness**. Spawn one agent per segment for large audits.

> **Re-dispatch on the same segment after a fix follows the blind discipline — see Phase 4 below and [references/blind-dispatch.md](../../references/blind-dispatch.md).** First-pass exploration is full-context by design; only verification passes are blinded.

#### No silent caps — disclose every bound (output contract)

**Any bounded coverage — which segments were actually audited, a top-N cap, a sampled subset, or work skipped because an agent timed out — MUST be DISCLOSED in the audit verdict. An undisclosed bound is a defect.** When a large audit is partitioned into per-segment agents, the report MUST state **which segments were covered and which were NOT** (e.g. "audited Entry/Init + Core Ops; Edge Cases NOT covered this pass"). A reader who believes a partitioned audit was exhaustive when only some segments ran is misled.

This **generalizes the `skills/doc-sync` ethos** to the audit output contract: doc-sync already holds that its non-deterministic LLM sweep is bounded — *"a 'clean' sweep only means this sample found nothing, never that nothing exists"* — and never lets a clean sample pose as proof of absence. The same honesty applies here: name the partition / sample / timeout bound, don't let it pass silently.

### Phase 3: Classify Findings

| Severity | Definition |
|----------|-----------|
| **Critical** | Feature broken or missing entirely |
| **Major** | Functionality degraded, display affected |
| **Minor** | Cosmetic, no functional impact |
| **By-Design** | Intentional difference, documented reason |

### Phase 4: Prioritized Handoff

Report fix order: Critical -> Major -> Minor (backlog).

One audit invocation performs one comparison pass and then terminates. Do not edit the target,
dispatch fixes, request another pass, or schedule a re-audit. A caller may later start a separate
blind verification invocation after fixes exist; that decision is outside this skill.

**Caller-initiated re-audit is blind** — if a later invocation verifies a fix, its prompt MUST NOT
carry the prior round's finding line numbers, "the fix at X to verify" cues, or specific aspect
labels the prior pass surfaced. The new pass re-derives findings from a clean source-vs-target read;
the depth-0 caller adjudicates whether prior findings closed.

Follow the dispatcher pre-flight checklist in [`../../references/blind-dispatch.md`](../../references/blind-dispatch.md). Fixers acting on the prior finding remain non-blind (they need the specifics to act on); only re-audit verification passes are blinded. First-pass Phase 2 exploration is full-context by design — only round 2+ on the same segment applies.
