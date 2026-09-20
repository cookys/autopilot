# Context-Budget Hook (A2) + Orchestrator-Edit Gate (A1)

## Project Goal

> **Final goal**: Ship two opt-in hooks that mechanically enforce the depth-0 economics /l4-/l6 promise in prose — A2 forces session splits at measured context thresholds; A1 denies depth-0 inline edits in orchestrator mode.
> **Success criteria**:
> 1. `node --test hooks/context-budget.test.js hooks/orchestrator-edit-gate.test.js` green, red-green provable (tests fail against absent libs — verified during TDD).
> 2. `bash hooks/tests/all-hooks-fail-open.test.sh` green including both new hooks.
> 3. `node scripts/check-hook-inventory.js --check` and `scripts/preflight-release.sh` pass at v2.32.27.
> 4. Live probe: marker set to l5 + block mode ⇒ depth-0 Edit denied, subagent Edit passes (SPIKE-1 replay).
> **Scope boundary**:
> - IN: session-mode.js marker CLI; two hooks (lib/wrapper/tests); hooks.json + opt-in manifest + hooks/README wiring; l4/l5/l6/level-front-door/finish-flow prose write-points; CHANGELOG + version 2.32.26 + inventory/parity gates; BACKLOG entries for deferred items.
> - OUT (BACKLOG'd): T3 deny tier (needs warn-mode calibration from ≥3 real /l5 runs), E1 dispatch-manifest merge gate, B1/B2 review-path fixes, per-repo config resolver ladder for these hooks.

Plan: [`docs/plans/2026-07-14-context-budget-orchestrator-gate.md`](../../../plans/2026-07-14-context-budget-orchestrator-gate.md)
Panel: 3-family hetero review (Gemini 3.5 Flash High / GPT-OSS 120B / MiniMax-M3), all FIX-THEN-SHIP, findings folded. SPIKE-1 resolved (CC 2.1.208: subagent hook payload carries `agent_id`/`agent_type`; session_id + transcript_path shared with parent).

## L-1.5 Scope Completeness Audit

| Dimension | Verdict |
|---|---|
| Source + tests | P0-P2 (session-mode.js, two hook lib/wrapper pairs, node --test suites) |
| User-facing docs | hooks/README tier tables (P3); CLAUDE.md scripts-inventory row for session-mode.js (P4) |
| API/interface | New hook stems + marker CLI — covered by hooks/README + CHANGELOG |
| Config templates | OUT: v1 is user-global `~/.autopilot/config.json` + env only (documented in plan) |
| CHANGELOG | P4, opt-in paragraph mandatory (check-optin-changelog) |
| Version bump | PATCH 2.32.25→2.32.26 (new hooks = PATCH per semver policy); sync-version --hook-count +2 |
| Version sync grep | P4 (grep old version across all tracked files) |
| Migration | N/A (additive, default-off) |
| Downstream consumers | Codex payload mirror NOT synced for hooks (hooks are CC-only surface; sync-codex-plugin-skills --check will confirm no drift claim) |
| Credit | N/A (internal design; panel engines credited in plan) |
| Dogfood | YES — enable warn-mode on autopilot's own /l5 runs post-ship (calibration data feeds T3 BACKLOG trigger) |

## Phases

| Phase | Deliverable | Status |
|---|---|---|
| P0 | scripts/session-mode.js + tests | ✅ aaf25c2 (19/19, red-green) |
| P1 | A2 context-budget lib/wrapper/tests | ✅ 96d91b2 (16/16, red-green) |
| P2 | A1 orchestrator-edit-gate lib/wrapper/tests | ✅ a61de8b (20/20, red-green) |
| P3 | Wiring (hooks.json, manifest, README, prose write-points) | ✅ 1e404a2 (fail-open 22/22, validate 28/28) |
| P4 | Docs/release (CHANGELOG, 2.32.26, gates, BACKLOG) | ✅ (this commit) |

## Decision Log

- 2026-07-14: T3 deny tier DEFERRED — warn-first rollout; deny semantics need non-adversarial-floor calibration + synthetic-adversary session (MiniMax finding).
- 2026-07-14: identity check = payload `agent_id` absence (SPIKE-1), not env contract; worktree position demoted to tertiary.

Last updated: 2026-07-14
