# 2026-07-04 — Quality-Floor Engine (judgment-demotion ladder)

**Mode**: CEO L (inline design + hetero panel critique + dispatched wiring)
**Branch**: `feat/quality-floor-engine`
**Target**: v2.31.11 (PATCH — references + protocol wiring, no new skill)
**Plan**: [docs/plans/2026-07-04-quality-floor-engine.md](../../plans/2026-07-04-quality-floor-engine.md)

## OKR
Make a weak orchestrating model sustain frontier-floor output quality on long tasks, by
demoting depth-0 judgment down the ladder (script / playbook / fan-out / probe / escalate+ledger).

- KR1: design doc survives a ≥2-disjoint-family adversarial critique (every claim adjudicated).
- KR2: Phase-1 assets shipped + wired per the three-places rule: probe-playbook.md,
  acceptance-patterns.md, finding-adjudication protocol, escalation-ledger convention.
- KR3: release green (suite / preflights / qc panel) at v2.31.11.

## Scope boundary
IN: P1 of the plan (docs + prose wiring; ledger rides tree.js, no new store).
IN (promoted at R1 after the 3-family critique): `scripts/adjudicate-findings.js` + tests.
OUT (triggers in plan §7): check-escalation-coverage.js, probe-mutation automation,
orchestration eval, demotion-loop automation.
