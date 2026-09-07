# Unknown-escalation ladder

> Plan: [`docs/plans/2026-09-07-unknown-escalation-ladder.md`](../../plans/2026-09-07-unknown-escalation-ladder.md) (frozen at g2 2026-09-07, `ledger/plan-review/`, checker exit 0)
> Branch: `feat/v2.36.15-unknown-escalation-ladder` · Target: v2.36.15 (PATCH: new script + knob + reference, no new skill/agent) · Size: L
> Owner rulings 2026-09-07: ladder is a switch, default on in every mode; budgets are climb counts per work unit (U1=2, U2=1, U3=1); knob name `unknown_escalation`; self-reported unknowns cap at U1 (recommended default, not yet ruled).

## Project Goal

> **Final goal**: when a session hits an unknown (no known approach, a bug resisting two hypotheses, a decision without consensus), it climbs a bounded, receipted ladder (local knowledge → consult seat → web research → multi-perspective → owner) driven by deterministic signals, and a resolved climb is written back so the same unknown resolves at rung 0 next time.
> **Success criteria** (plan §2): KR1 every autonomous consult/survey/think-tank climb has a ladder receipt naming its signal (`probe-unknown.js report`, 100%); KR2 two refuted `hypothesis` rows ⇒ `recommend: U1`, one ⇒ `none` (fixture test); KR3 one `/l4` dogfood shows a U2 row inside a foreman round with no depth-0 involvement before U4; KR4 `report` prints a repeat-unknown number; KR5 probe exits 0 on every classification, never a Stop decision (`--strict` opt-in only); KR6 no trust machinery (ADR-0001).
> **Scope boundary**: IN — `scripts/probe-unknown.js`, `decision-ledger.js` row kinds (`hypothesis`/`unknown`/`ladder`), knob `unknown_escalation` + budgets in `review-loop-config.md` / `resolve-review-loop.sh`, `dispatch-consult.sh --ladder-receipt`, compaction-rehydrate re-inject, wiring in debug / dev-flow / think-tank / ceo-agent front-door / finish-flow / survey (`issue-search` mode), contradiction fixes C1–C8, tests, inventory four-place wiring, CHANGELOG, codex mirror. OUT — new seats/transports/engines, PUA methodology changes beyond handoff rows, a per-tool-call hook, brainstorm seat wiring, trust machinery.

## Scope completeness audit (L-1.5)

| Dimension | Covered by |
|---|---|
| Source + tests | P1 P2 (scripts + `hooks/tests/*.test.sh`), P3–P6 (skill prose, prose is the product) |
| User-facing docs | P0 (survey/debugger/hetero-loops wording), P3–P6 SKILL.md rows, `references/hetero-dispatch.md` Hook points |
| Config templates | P2 (`project-config-template/review-loop-config.md` knob table) |
| CHANGELOG / version bump / mirror grep | closing phase (v2.36.15, `sync-version.js`, `sync-codex-plugin-skills.sh`, grep old version across all tracked files) |
| Dependent consumers | `decision-ledger.js` round-end report readers (`check-blueprint-conformance.js` audit) — additive kinds, verified in P1 tests |
| Credit | Inspired-by lines in plan §0: OpenAI GPT-6 Astra prompting guide; Anthropic "Prompting Claude Fable 5.1" — record in CHANGELOG entry |
| Dogfood | P4 `/l4` seeded-unknown run (KR3), human-read ledger |

User-stated requirements ledger: (1)「擴大解決未知問題的能力」→ whole plan; (2)「完整計畫…看哪裡有矛盾」→ plan §0.5 C1–C8, P0; (3)「做開關 預設要」→ P2 knob default on; (4)「一次會不會太少」→ P2 budgets U1=2; (5)「參考 chatgpt how to prompt astra」+ Fable 5.1 guide → plan §0 external input, P6 effort floor, P1 compaction re-inject.

## Mission graph (one deliverable)

| Node | Deliverable | Phases | Status |
|---|---|---|---|
| D1 | ladder signals + probe + knob + skill wiring + docs, single branch, plan loop at L-2.5, one pre-merge review | P0 P1 P2 P3 P4 P5 P6 | in progress |

Plan headings P0–P6 are coverage inside D1, not execution nodes.

## Progress

| Phase | Status | Evidence |
|---|---|---|
| L-2.5 plan review | done 2026-09-07 — G1 CONDITIONAL (8 blockers folded, 1 nb rejected), G2 cap CONDITIONAL→depth-0 adjudicated (7 folded), checker rc=0 | `ledger/plan-review/g2.adjudicated.json`, `g2.dispositions.checker.json`, `plan.g2-reviewed.md` |
| P0 reconcile definitions | done 2026-09-07 (c02308ab, survey wording corrected again by G1 R8 in 0c32af13) | debugger PUA handoff rows; survey Boundary + Signal table; hetero-loops pointer |
| P1 signals + probe | pending | |
| P2 knob + budgets + receipt | pending | |
| P3 inline skill wiring | pending | |
| P4 foreman integration | pending | |
| P5 close the loop (learn) | pending | |
| P6 survey issue-search | pending | |

Last updated: 2026-09-07 (plan frozen at g2; P0 done; P1 starting)
