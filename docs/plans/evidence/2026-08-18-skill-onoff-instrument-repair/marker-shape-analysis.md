# Per-marker breakdown of the predecessor block, and the three dead shapes

Source: `../2026-08-18-dev-flow-contract-card/primary-sonnet-results.jsonl` (63 runs, sonnet,
zero infra failures). Denominators differ because some markers appear in two tasks.

| marker | FULL | CARD | OFF | shape |
|---|---|---|---|---|
| `f3_fix_branch_flow` (d3,d7) | **6/6** | 6/6 | **0/6** | discriminates, totally |
| `f3_hotfix_compound` (d4) | **3/3** | 3/3 | **0/3** | discriminates, totally |
| `f1_s_no_tracking` (d1) | 3/3 | 3/3 | **3/3** | ABSENCE — OFF scores free |
| `f1_stays_fix_no_tracking` (d7) | 3/3 | 1/3 | **3/3** | ABSENCE — CARD scores *below* OFF |
| `f1_session_sha` (d2) | 1/3 | 0/3 | 0/3 | CEREMONY |
| `f1_plan_file` (d2) | 1/3 | 1/3 | 0/3 | CEREMONY |
| `f1_project_readme` (d2) | 0/3 | 0/3 | 0/3 | CEREMONY — zero everywhere |
| `f5_red_before_edit` (d3,d5) | 5/6 | 6/6 | **5/6** | BASE RATE |
| `f5_green_after_edit` (d5) | 3/3 | 3/3 | **3/3** | BASE RATE — ceiling |
| `f4_maintenance_ledger` (d3) | 0/3 | 1/3 | 0/3 | fixture defect (no `docs/` tree existed) |
| `f6_gate_before_commit` (d1,d3,d6) | 0/9 | 2/9 | 0/9 | measured a self-contradicting rule |

**Absence markers** ("no project dir was created") are won by doing nothing, so the arm that
does nothing scores full marks. No task difficulty changes that.
**Ceremony markers** are ~0 in *every* arm: single-turn headless does the work and skips setup.
That is a harness scope fact, not a skill deficiency to measure harder.
**Base-rate markers** are innate competence — OFF already scores 5/6.

The one working family, F3, has four properties its markers share: **positive** (an artifact
must appear, not be absent), **specific** (an exact branch name/topology), **cheap** (one
command inside the turn), **non-default** (a model without the skill has no reason to do it).

## Admissible-behaviour ceiling (depth-0 enumeration, 2026-08-18)

Every dev-flow behaviour scored against those four properties AND single-turn observability
(channels: git/FS residue + stream-json tool_use only):

- **Admissible**: branch topology + merge direction (proven); ongoing-maintenance ledger row
  (needs a seeded fixture); commit-message contract (needs clause predicates, not line count);
  config-injection Read (needs `transcript-query.js` to emit `file_path` for `Read`, and a
  `.claude/` config seeded into the fixture).
- **Marginal**: invoke `learn` after a non-obvious fix — the rule is conditional, so a
  compliant model may legitimately skip.
- **Not admissible**: L ceremony (~0 in every arm, measured); "don't over-track" (absence);
  test-before-edit (base rate); 驗證合約 answered / hotfix scope re-route / risk escalation
  (live only in prose output — adding a text channel reintroduces LLM judging); "creates no PR"
  (absence).

**Ceiling: four admissible families, one marginal.** That is the whole population, enumerated
before any spend.


---

**Addendum 2026-08-20**: the ceremony hypothesis this taxonomy left untested was answered by
production-transcript archaeology under the reviewed successor plan
(`docs/plans/2026-08-20-multiturn-event-harness.md`, R2' frozen): in 3 eligible opus-5
multi-turn dev-flow sessions the frozen predicates detected plan-doc / project-README /
forcing-function-TaskCreate ceremony in 2/3 sessions each (session-sha 1/3, insufficient).
The single-turn ~0 was harness scope, not skill inertness, for those three families.
