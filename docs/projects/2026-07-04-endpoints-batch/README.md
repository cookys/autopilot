# 2026-07-04 — endpoints S-batch + CEO-discretion sweep (v2.31.13)

**Mode**: CEO L6. **Branch**: `feat/v2.31.13-endpoints-batch`. **Target**: v2.31.13 (PATCH).

## OKR
- KR1: `autopilot endpoints test <name>` — opt-in live auth roundtrip (never prints token; no-network-by-default posture).
- KR2: overlay repo-keying UX — `which` notes path-fallback keys; `set --repo` warns when no remote.
- KR3: `dispatch-author.sh --endpoint <name>` parity with siblings (closes the manual ANTHROPIC_* export gap hit twice).
- KR4: cc-shim late-flush — probe `claude -p` flush behavior; per-runner settle bound; genuinely-empty still fail-closed.
- KR5: preflight-portability meta-smoke test (sandbox + seeded violation ⇒ nonzero).
- KR6: legacy `docs/projects/` dirs (16) moved to `_archive/` + INDEX links repaired (depth-0, docs-only).
- KR7: P3 sonnet-class smoke — does a sonnet-tier orchestrator pass ≥1 orchestration-eval oracle? (informs the campaign gate; depth-0).
- KR8: release green, merged, pushed.

## Scope boundary
OUT: schema SSOT / multiplexer / domain routing (triggers not fired); distill line (sibling machine's active thread); the full P3 campaign.

## BACKLOG trigger accounting
endpoints-test + author-endpoint + late-flush triggers FIRED this session; overlay refinement + meta-smoke batched by Board discretion (2026-07-04 "CEO 判斷能處理的就派掉").
