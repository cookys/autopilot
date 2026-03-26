---
name: audit
description: Systematic comparison audit between two implementations. Invoke when comparing old vs new, spec vs implementation, or verifying feature parity between systems.
---

# Systematic Comparison Audit

## Project Audit Config
!`cat .claude/audit-config.md 2>/dev/null`

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

### Phase 3: Classify Findings

| Severity | Definition |
|----------|-----------|
| **Critical** | Feature broken or missing entirely |
| **Important** | Functionality degraded, display affected |
| **Minor** | Cosmetic, no functional impact |
| **By-Design** | Intentional difference, documented reason |

### Phase 4: Prioritized Fix

Fix order: Critical -> Important -> Minor (backlog).

Per fix: update target -> verify against source -> update comparison matrix -> re-run tests.
