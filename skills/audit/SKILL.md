---
name: audit
description: >
  Compare two implementations and find every difference. Use when: "compare X with Y", "check X
  against Y", "verify X matches Y", "flag anything missing", "比對 X 和 Y", "檢查有沒有漏掉",
  "驗證是否一致", feature parity review between old and new systems, spec vs implementation
  verification, cross-system completeness check. Not for debugging a single discrepancy or writing
  comparison tests.
---

# Systematic Comparison Audit

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

### Phase 4: Prioritized Fix

Fix order: Critical -> Major -> Minor (backlog).

Per fix: update target -> verify against source -> update comparison matrix -> re-run tests.

**Re-audit dispatch is blind** — when re-running an audit segment after a fix (verification pass), the re-dispatch prompt MUST NOT carry the prior round's finding line numbers, "the fix at X to verify" cues, or specific aspect labels the prior pass surfaced. The Phase 2 segment agent must re-derive findings from a clean read of source-vs-target; the dispatcher pattern-matches the new findings against the prior ones in its own memory to determine whether the fix held.

Follow the dispatcher pre-flight checklist in [`../../references/blind-dispatch.md`](../../references/blind-dispatch.md). Fixers acting on the prior finding remain non-blind (they need the specifics to act on); only re-audit verification passes are blinded. First-pass Phase 2 exploration is full-context by design — only round 2+ on the same segment applies.
