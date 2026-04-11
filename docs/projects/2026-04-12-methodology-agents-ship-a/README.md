# Methodology Agents — Ship A (v2.4.0)

**Status**: ✅ Shipped — merged to `develop` as `14276bb` on 2026-04-12
**Plan doc**: [`docs/plans/2026-04-12-methodology-agents-and-hooks.md`](../../plans/2026-04-12-methodology-agents-and-hooks.md)
**CHANGELOG**: [v2.4.0 entry](../../../CHANGELOG.md)

---

## ⚠️ Retroactive Record

**This project directory was created after the fact** (at L-5 compliance closure, not L-1 execution start).

The v2.4.0 Ship A L-size work was initially executed via plan-only flow — the plan doc existed in `docs/plans/` but no project README was created at L-1. This violated the dev-flow L-1 MANDATORY "create project dir" gate.

The retrospective was added at 2026-04-12 to:
1. Close the compliance gap for Ship A specifically
2. Establish `docs/projects/` as the formal convention going forward (enforced via `.claude/dev-flow-config.md`)
3. Document the historical debt (pre-2026-04-12 L-ships did not have project dirs — see `docs/projects/INDEX.md` § 歷史債)

The content below is a **historical record**, not a live tracking document. The phases ran, the merge happened, evidence links to already-landed commits. The tracking value of a project README lives during execution; this one exists for compliance documentation.

---

## Project Goal

> **Final goal**: autopilot v2.4.0 ships 3 read-only methodology agents (reviewer / debugger / planner) that carry Three Red Lines discipline into the agent layer, plus a `Recommended Companions` section positioning voltagent as the role-specialized partner.
>
> **Success criteria**:
> 1. 3 methodology agents exist under `agents/` with correct frontmatter and unified Output Contract
> 2. `autopilot:quality-pipeline` dispatches `autopilot:reviewer` as primary reviewer
> 3. README (EN + zh-TW) has Methodology Agents + Recommended Companions sections with dispatch boundary explanation
> 4. Zero breaking changes to existing 12 skills
> 5. Version bump 2.3.0 → 2.4.0 synced across plugin.json / marketplace.json / both READMEs / CHANGELOG (`grep -rn "2.3.0" . | grep -v CHANGELOG | grep -v docs/plans/` returns empty)
> 6. Full dogfood via `ceo-agent` level 3 → review loop → `dev-flow` L → `finish-flow`
>
> **Scope boundary**: 3 methodology agents + skill integration + README only. 14 universal hooks explicitly deferred to Ship B (v2.5.0).

## Success Criteria Evidence

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| 1 | 3 agents under `agents/` | `ls agents/*.md` → `debugger.md`, `planner.md`, `reviewer.md` + `README.md` | ✅ |
| 2 | quality-pipeline dispatches `autopilot:reviewer` | `grep -c "autopilot:reviewer" skills/quality-pipeline/references/code-review.md` → 4 | ✅ |
| 3 | README Methodology Agents + Companions sections | `grep -c "Methodology Agents\|Recommended Companions" README.md` → 2; zh-TW parity verified | ✅ |
| 4 | Zero breaking changes | `git diff develop..feat/v2.4.0-methodology-agents --stat skills/` → only `quality-pipeline/SKILL.md` (+1/-1) and `code-review.md` (+26/-5) prose edits, no API changes | ✅ |
| 5 | Version sync | `grep -rn "2.3.0" . \| grep -v CHANGELOG \| grep -v docs/plans/2026-04-12` → empty; `2.4.0` present in plugin.json, marketplace.json, both READMEs, CHANGELOG | ✅ |
| 6 | Full dogfood | Session trace: `autopilot:ceo-agent` level 3 → plan draft → `autopilot:survey`-style parallel review (r0→r1→r2) → `autopilot:dev-flow` L-1 → phases → `autopilot:quality-pipeline` → `autopilot:finish-flow` L-5 → `autopilot:learn` | ✅ |

## Phases (Retrospective Log)

| Phase | Subject | Outcome | Commits |
|-------|---------|---------|---------|
| **Phase 0** | Plan draft + parallel review loop | 3 reviewers r0, 2 reviewers r1, 1 reviewer r2 — all 25+ findings addressed | `d3dce26` (includes plan) |
| **Phase 1** | Write 3 methodology agents + agents/README | Sequential writing for Output Contract consistency (not parallel dispatch) | `d3dce26` |
| **Phase 2** | quality-pipeline integration | Static dispatch target change: `superpowers:code-reviewer` → `autopilot:reviewer` in `code-review.md`, plus Handoff Consumption table | `c96326e` |
| **Phase 3** | Namespace verification | 30-min time-box. Canonical `autopilot:reviewer` format confirmed via empirical dispatch failure (error message listed all available agents, no collisions) | (no code change) |
| **Phase 4a** | Early README / version bump | Inspired By devteam credit, 2.3.0 → 2.4.0 bump, CHANGELOG body | `d3dce26` (4a batched with Phase 1) |
| **Phase 4b** | README prose finalization | Methodology Agents + Recommended Companions sections, agent count badge | `c96326e` (4b batched with Phase 2) |
| **Phase 5** | Integration verification | Structural validation passed (all agents read-only, enum subsets per spec); runtime dogfood deferred to next session (agent list snapshot at session start — environmental) | (no code change) |
| **L-5.1** | Final Goal Review | All 6 OKR criteria verified | (no code change) |
| **L-5.2** | Pre-Merge Review | `superpowers:code-reviewer` (autopilot:reviewer not yet loaded): 0 Critical / 0 Major / 2 Minor / 2 Suggestion. All 4 fixed inline per S-size decision tree. 1 fix round. | `e497522` |
| **L-5.3** | Merge to develop | `git merge --no-ff` | `14276bb` (merge commit) |
| **L-5.4** | Post-Merge Review | Critical files verified on develop | (no code change) |
| **L-5.5** | Archive plan | Plan doc status → "✅ Shipped in v2.4.0" | `fa3009e` |
| **L-5.6** | L Session End | autopilot:learn captured 2 memory lessons to TWGameProject auto-memory; feature branch deleted | (no code change) |

## Review Loop History

**Total: 3 rounds, ~25 findings, 3 parallel reviewers r0 + 2 verification reviewers r1+r2**

### r0 → r1 (initial parallel review)
- **Reviewers**: `voltagent-qa-sec:architect-reviewer` + `feature-dev:code-reviewer` + `voltagent-meta:agent-organizer`
- **3 Critical**: branch-protection regex substring match (moved to Ship B) / "graceful degradation" wording not runtime-implementable / debugger Edit/Write contradicts methodology role
- **5 Major**: orthogonality disclaimer / reviewer→fixer handoff gap / bug-hunt orchestration protocol / Phase 1 is 2 L-ships / Phase 4 parallelization wrong
- **All addressed** via Ship Split decision (A: agents only, B: hooks only), enum-based Handoff contract, scope reduction

### r1 → r2 (verification)
- **Reviewers**: same architect-reviewer + agent-organizer
- **1 Critical**: Phase 2 integration contradiction on "prose vs runtime fallback"
- **4 Major**: Handoff contract drift across agents / namespace rabbit hole / Phase 4 split missing / missing risks
- **3 Minor / 3 Suggestion**: planner model overspec / WebSearch hallucination / reviewer description self-demoting / enum orphans
- **All addressed** via unified enum schema, time-boxed namespace verification, Phase 4a/4b split

### r2 → r3 (final verification)
- **Reviewer**: architect-reviewer
- **0 Critical**: all 8 r2 fixes confirmed landed
- **Shipped**

### L-5.2 Pre-Merge Review
- **Reviewer**: `superpowers:code-reviewer`
- **0 Critical / 0 Major / 2 Minor / 2 Suggestion**: orphan `AUTOPILOT_PLANNER` enum / missing scope note on Handoff table / overstated "physically read-only" claim / nested triple-backtick in debugger diff example
- **All fixed inline** as S-size per quality-pipeline decision tree

## Rollback Plan

If rollback needed:

```bash
git revert 14276bb    # Removes merge + all Ship A changes
git revert fa3009e    # Removes plan status update
# Optionally revert plugin.json / marketplace.json version manually if needed
```

Clean rollback — zero data migration, zero schema changes, pure additive ship.

## Credits

Design source: [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam) v1.1.0 (MIT). Absorbed: Three Red Lines discipline, P7 `[P7-COMPLETION]` output contract pattern (adapted to autopilot's unified `### Handoff`), P9 six-element Task Prompt, evidence-first debug methodology, PUA stress trigger, physical tool-restriction for methodology agents. Full attribution in `README.md` § Inspired By, `README.zh-TW.md` § 靈感來源, `CHANGELOG.md` v2.4.0 § Source.
