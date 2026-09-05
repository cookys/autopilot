# Rubric — 2026-09-05-statusline-live-context-feed.md

> Source plan: docs/plans/2026-09-05-statusline-live-context-feed.md
> Frozen at generation 1. Each item is a pass/fail question about the plan text; cite the plan section you judged.

R1: [deps] The plan adds no npm dependency in autopilot and no new crate in codeforge; `findmnt` (util-linux) with a `/proc/mounts` fallback is the only platform dependency (§2.5, §2.6).
R2: [live-dir] The live-dir resolution order and acceptance rule are stated once, verbatim-propagable, and never accept a path as RAM without a mount-type probe; the SSD fallback warns exactly once (§2.5, KR4, P1.1, P2.1).
R3: [identity] Both writers (codeforge) and readers (autopilot hooks) derive the same `session_id` file name from the same sanitiser rule, so the file can actually be found (§2.5, §3).
R4: [schema] The live-file schema v1 is complete for every consumer named in the plan: window + usage for context-budget, `model.id` for the delegate gate, `tasks[]` rows for foreman-guard; unknown fields ignored; `tasks` optional (§2.5, P2, P3).
R5: [freshness] A stale or absent live file always falls back to today's behaviour and is never treated as a gate pass (§2.5 freshness, §6).
R6: [compat] Existing knobs keep their semantics; absent live file ⇒ byte-identical old behaviour; the change is honestly `internal-only` (§2.5, §2.6).
R7: [ruling] The plan correctly distinguishes itself from the 2026-07-14 "no window-relative thresholds" ruling: absolute-token tiers stay the cost signal; the real window only removes inference and states the proportion (§0).
R8: [id-mapping] The `tasks[].id` ↔ hook `agent_id` correspondence is treated as unknown until the P0 spike settles it, with a written fallback match if they differ (P0, §6).
R9: [foreman-deny] Subagent T2 deny lives in the PreToolUse hook that can actually deny (`foreman-guard.js`), scoped to l4–l6 marker + `agent_id`, never gates on a missing row, and depth-0 deny stays out of scope (P2.3, §7).
R10: [delegate-gate] The depth-0 delegate gate is default-on, not marker-bound, warns before it blocks, blocks only on a guarded model known from the live file in explicit `block` mode, and resets on delegation (P3, §6 noise risk).
R11: [tests] Every KR has a named script-gated test, the fake-`findmnt` ext4 fallback test is mandatory, and P2.2 has a red-before-green requirement on `develop` (KR1–KR5, §5).
R12: [two-repo] The ordering P0 → P1 (codeforge) → P2/P3 (autopilot) → P4 is explicit, version skew in either direction degrades to old behaviour, and the schema version field guards future changes (§4 dependencies, §6).
R13: [inventory] New hook and script are wired everywhere the repo's gates check: `hooks.json`, `hook-classes.json` + both catalog `hook_classes_sha256`, `CLAUDE.md` script list, `docs/scripts-inventory.md`, hook README, CHANGELOG, PATCH version bump (P3.2, P4).
R14: [scope] Out-of-scope items are real subtractions (depth-0 deny, rendering changes, fleet rollout, Windows, non-codeforge hosts) and none of them is load-bearing for KR1–KR5 (§7).
