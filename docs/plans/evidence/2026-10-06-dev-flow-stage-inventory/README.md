# dev-flow stage inventory (2026-10-06)

Why: the owner judged dev-flow's stage design poor ("L1–L5 … 設計得不好，應該重新盤點") while deciding what the TUI band's position slot should show. This is the as-is inventory, from the files as written (Explore pass, file:line cited in the session; key lines repeated here). No redesign yet.

## Workflows and their steps

| Size | Ids as written | Steps | Closing |
|---|---|---|---|
| S | none (steps 0–5) + task `S-scope-gate` | 0 verification contract · 1 implement · 2 quality gate · 3 scope-gate check (NO → escalate to L) · 4 commit · 5 drop backlog item | finish-flow optional: S.1–S.3; "S Session End (lite)" defined twice in dev-flow (273-285, 552-557) |
| Fix | none (steps 0–8) | 0 contract · 1 branch · 2 root cause · 3 fix · 4 quality gate · 5 commit · 6 maintenance log · 7 merge · 8 delete branch | finish-flow optional: F.1–F.5, which do NOT map to steps 4–8 |
| L | `L-1` Intent Confirmation · `L-1.5` Scope Completeness Audit · `L-1.6` Skill routing (no heading; preamble only) · `L-2` Plan · `L-2.5` Plan hetero review · `L-3` Project Setup · `L-4` Per Phase (P0..PN, each: goal check → execute → 5-item phase-advance gate) · `L-5` Completion | (see left) | finish-flow L-5.1 Final Goal Review · L-5.2 Pre-Merge Review · L-5.3 Merge · L-5.4 Post-Merge Review · L-5.5 Archive · L-5.6 Session End (huge inline gate list) · L-5.7 Delete branch |
| H | only parent task `H-9` (steps 1–4) | 1 hotfix branch · 2 scope check (migration → L) · 3 smallest fix · 4 invoke finish-flow | finish-flow H-9.1–H-9.6; "H-1", "step 9" referenced but undefined |

Phase 1 "Session Start" (dev-flow 29-114) has its own unnumbered gate lists per size, and dev-flow calls that list "the L-1 gates" too.

## Colliding names

- "L" means three things: size L, stages `L-1…L-5`, execution levels `/l3–/l6` (`--level l3…l6`, "Level N"). finish-flow trigger 「L-5 開始」 sits next to "Level 5".
- "phase" means at least six things: Phase 1 Session Start, plan phases P0..PN, hetero review `--phase <p>`, session-mode marker `--phase` (free text), campaign states (PREPARED … TERMINAL_*), Mission graph nodes (READY mode redefines every "phase" as a node, dev-flow:725). The orchestrator state machine also uses "stage" for its own pending/leased/…/merged states.
- Other schemes: unknown ladder U0–U3, R0–R5 handlers, reviewer rounds R0/R2, plan-template sections §0–§8.

## What is mechanically recorded about "where a session is"

- Marker `phase` (`session-mode.js set --phase`, read by `src/status/phase-input.js` → review page / band): exists, but NO skill or hook writes dev-flow stages into it (only a test does).
- Tasks (TaskCreate: L-1.5, L-1.6, L-5, H-9, S-scope-gate, P0..PN, finish-flow sub-tasks): prose-driven, only when task tools are enabled (`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` on Claude 5-era models); the band reads the in-progress task.
- Campaign state: mechanical, /l5–/l6 engine runs only.
- Hetero review receipts per plan phase (L-2.5, L-4 phase advance): mechanical.
- Everything else — which L-N / S / Fix / H step the session is in — is prose only.

## Observed problems (13 in the pass; the main ones)

1. H: "H-1", "step 9" referenced, only 4 steps exist; H-2..H-8 undefined.
2. L-1.6 has no heading; L-1.5/L-1.6 are really sub-steps of L-1; the skill-routing gate is stated three times.
3. Execution order ≠ numeric order (L-1.6 defined before L-1.5 runs; phase tasks created at L-1, run at L-4).
4. "L-1" names both the Intent stage and the Session-Start gate list.
5. Closing steps live in two files (dev-flow L-Full list vs finish-flow L-5.6), each with different content.
6. Fix / S closing numbering does not map to their own steps.
7. L-4 packs goal check, execution, backlog safety, a 5-item gate and drift signals into one stage; L-3 is two bullets.
8. Definitions are copied into ceo-agent (`level-front-door.md:70-72`, `SKILL.md:316-336`).
9. Mission READY mode silently changes what "phase" means in the same prose.
