# dev-flow contract-card rewrite — evidence-gated (成績單前置)

> Started: 2026-08-18 · Branch: `feat/v2.34.18-dev-flow-contract-card` · Target version: v2.34.18 (PATCH)
> Plan: [docs/plans/2026-08-18-dev-flow-contract-card.md](../../plans/2026-08-18-dev-flow-contract-card.md)
> Evidence: `docs/plans/evidence/2026-08-18-dev-flow-contract-card/`
> Consumes BACKLOG row: "Skill contract-card rewrites under 成績單前置（G2 MiniMax R8）"

## Project Goal

> **Final goal**: Ship (a) a depth-0 skill ON/OFF instrument (`evals/skill-onoff/`), (b) the
> contract-card shape spec (`references/skill-contract-card.md`), (c) the profiles
> guided-compatibility baseline re-establishment, and (d) — **iff the pre-registered 3-arm
> experiment returns SHIP-GATE-MET** — the dev-flow SKILL.md card rewrite (713 → ~440-470 lines).
> **Success criteria** (quantified, from plan §11):
> 1. 3 new `hooks/tests/skill-onoff-*.test.sh` green, with planted-red demonstrations recorded.
> 2. Phase-0 smoke proves plugin load + dev-flow Skill invocation observable (≤6 live runs) before rules freeze.
> 3. 63 primary-block rows, 0 unresolved infra_fail; verdict computed mechanically by `score-onoff.js`.
> 4. Card ship conditional on V1∧V2∧V3 (plan §4); all §9 surface checks pass; `preflight-release.sh` 8/8.
> 5. Spec doc + P4 baseline (with red-case proof) merge regardless of card verdict.
> **Scope boundary**: dev-flow only (quality-pipeline = follow-up); frontmatter `description:`
> frozen byte-identical; no hooks in synthetic plugin; multi-turn / Mission-mode NOT measured
> (static KEEP-verbatim checklist covers those sections); no contract-density scripted counter
> (BACKLOG). Board-approved decisions (2026-08-18): 證據閘控出貨 / dev-flow 單點 / 60-90 runs /
> P4 = 擴大來源宇宙 / plan review G1+G2 bounded.

## Forcing functions (harness has no TaskCreate this session — tracked here, honesty fallback)

- [ ] **L-1.5 Scope completeness audit** — plan §9 surface table is the output; recorded below.
- [ ] **L-1.6 Skill routing** — no `.claude/skill-routing.md` entries for touched areas; invoked:
      dev-flow (sizing/gates), handoff (resume). quality-pipeline to be invoked at every commit
      gate; finish-flow at P8. N/A-justification: repo has no per-area skill routing config.
- [ ] **L-5 finish-flow** — MUST invoke `autopilot:finish-flow` at P8; do not close inline.

## Phases (admitted Mission deliverable: this bounded DAG; source headings ≠ tasks)

| Phase | Deliverable | Status |
|---|---|---|
| G1/G2 | Bounded hetero plan review (rubric-frozen, max 2 generations) | G1 done (CONDITIONAL; 10/10 adjudicated, folded `8fc1ce1f`, 1.198×); G2 dispatched |
| P0 | Prologue: tier-A/B BACKLOG row repair + contract-card row annotation (no-bump) | done `142508ee` |
| P1 | `references/skill-contract-card.md` + preflight check-8 per-skill map | done `435cdc27` (red/green proven; review SHIP-AS-IS from raw log) |
| P2 | Card draft fixture (branch-only; digest-frozen; frontmatter byte-identical) | done `7bb7349e` (713→499 lines; all pins verbatim) |
| P3 | `evals/skill-onoff/` harness + d1-d7 + 3 tests + Phase-0 smoke → rules freeze | done `a6795ea1` (3 suites green; smoke: dev-flow naturally routed, 19s; RULES LOCKED) |
| P4 | Profiles baseline re-establishment (擴大來源宇宙; 3-class dispositions; red-cases) | done `bb3ee9cf` (7-case red/green; existing suites green; 798 literals ride P7) |
| P5 | Primary block 63 runs (sonnet) + advisory 21 (haiku), resume-by-cell | primary DONE 63/63 (0 infra, 0 excluded); advisory running |
| P6 | Adjudication: mechanical verdict + Board read + evidence report | verdict **INSTRUMENT-INVALID (V2 vacuous, 1/5 load-bearing)** — `p6-adjudication.md`; V1 pass; F3 total discrimination (9/9/0) with card non-inferior on it; F6/F4 zero compliance even in FULL |
| P7 | Conditional ship: single swap commit (SKILL.md + profiles regen + mirror resync) | **NOT TAKEN** (pre-registered non-SHIP branch): card stays frozen fixture; 2 BACKLOG rows filed (re-attempt + zero-compliance finding) |
| P8 | Closeout: finish-flow L-5, preflight-release, --update-baseline, INDEX/archive | pending |

## Scope completeness audit (L-1.5 record)

Per plan §9: source+tests ✓ (harness+3 tests) · user-facing docs ✓ (evals/README, scripts-inventory
evals row) · API/interface ✗ (none) · config templates ✗ · CHANGELOG ✓ (PATCH v2.34.18) · version
sync ✓ (grep old version at release) · migration notes ✓ (P4 baseline migration map) · downstream
consumers ✓ (codex mirror projected skill; opencode/agent-bodies verified no-impact) · credit ✗
(no external absorption) · dogfood ✓ (this repo's own entry skill — the experiment IS dogfood).
User-stated requirements ledger: 證據閘控出貨→P2-P7; dev-flow 單點→scope boundary; 60-90 runs→P5
matrix; P4 擴大來源宇宙→P4; G1+G2 review→G1/G2 row. All mapped.

## Decision log

- 2026-08-18: Board picked 證據閘控出貨 / dev-flow-only / 標準 60-90 runs (AskUserQuestion).
- 2026-08-18: P4 approach = successor baseline with extended source universe {ceo-agent, dev-flow,
  dev-flow/references/*}; deleted duplicates get explicit `removed` dispositions; old snapshot kept.
- 2026-08-18: Plan review depth = G1+G2 bounded; plan approved to start.
- 2026-08-18: brain 席第四場不排程,維持 advisory(Board)。

## Progress

| Date | Item |
|---|---|
| 2026-08-18 | Plan authored; admission READY (l3 inline, 1 deliverable); branch + project dirs created. |
| 2026-08-18 | Phase-0 probe (1 live call): `--plugin-dir` channel CONFIRMED headless; TaskCreate/task-store channel REFUTED → F2 family dropped, V2 4-of-5. Evidence `phase0-probe.md`. |
| 2026-08-18 | G1 CONDITIONAL (3 seats semantic; sol transport-void ×2). 10 findings (3 blocking) all accepted + folded; R1 at 1.198× growth. G2 dispatched on `8fc1ce1f`. |
