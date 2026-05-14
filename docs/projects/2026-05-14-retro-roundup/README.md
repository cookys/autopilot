# Retro Roundup — Post-v2.7.2 Plumbing + Process Improvements

**Status**: 🟡 In progress — L-1 setup
**Plan doc**: [`docs/plans/2026-05-14-retro-roundup.md`](../../plans/2026-05-14-retro-roundup.md)
**Branch**: `feat/v2.7.3-retro-roundup`
**Scope mode**: Selective (Tier 1 ships; Tier 2-3 catalog with triggers; Tier 5 explicit skip)

---

## Project Goal

> **Final goal**: 把今天（2026-05-14）retro 抽出的 **25 條改進建議**結構化進 plan，**ship Tier 1（5 quick wins）**為單一 commit，Tier 2 / Tier 3 / Tier 5 各自標明 trigger condition 或 skip rationale。Roadmap doc 自身就是 deliverable — 未來 me 來看單 plan 就知道哪些待 trigger、哪些已 skip。
>
> **Success criteria**:
> 1. ✅ Plan doc 涵蓋 retro 全部 25 條 entries（不漏）— grep 計數
> 2. ✅ Each entry 有 status（Ship now / Plan / Defer with trigger / Skip with rationale）
> 3. ✅ Tier 1 五條 quick wins ship 在單一 atomic commit
> 4. ✅ 通過 3-reviewer plan loop（HIGH consensus 或 r3 critical 全 absorb）
> 5. ✅ Tier 2 #6（Plan C handoff schema）**重新評估**：今天 sample 升到 3，是否 promote 立即 ADOPT？由 reviewer 之一 challenge 決定
>
> **Scope boundary**: 純 hooks/scripts/docs polish。**不動** 12 skill bodies、不動 dispatch-config schema、不動 plugin core flow。Tier 2 # 8 quality-gate acceptance-criterion drift check、Tier 2 # 10 「parameter flow through layers」doc — 排進 next L-size、本 plan 不做。Tier 3 全部 defer。

## Phases

| # | Phase | Status |
|---|---|---|
| L-1 | Project setup + INDEX | 🟡 in progress |
| L-1.5 + L-1.6 | Scope audit + skill routing | — |
| L-2 | Plan doc（25 條 catalog）| — |
| L-2.5 | 3-reviewer plan loop | — |
| P1 | Tier 1 batch（5 quick wins，single commit）| — |
| L-5 | finish-flow（6 sub-tasks）| — |

## 25 條 entries 速覽（plan §3 詳列）

| Tier | 條數 | 動作 |
|---|---|---|
| **1 Quick Wins** | 5 | **本 plan ship** — single P1 commit |
| **2 Medium** | 5 | Catalog with trigger / scope, ship in future Fix-cycles |
| **3 Strategic** | 5 | Roadmap defer，monthly retro re-evaluate |
| **4 Watch** | 4 | Pure observation 7-30 天 |
| **5 Skip** | 6 | Explicit rationale，no future trigger |
| **Total** | **25** | ✓ |

## Out-of-scope（明示**不**做）

| 項 | 為何不做 |
|---|---|
| 寫 router-judge impl（T11） | 已有 plan，trigger = 下次 routing tightening 痛點 |
| Plan C handoff schema 全套（T6）| 若 reviewer 不挑戰 → Tier 2 排程；若 reviewer 挑戰升 ADOPT → 本 plan 加 P2 phase（CEO scope decision） |
| MEMORY.md audit（T14） | 個人 memory、不屬 autopilot scope |
| 裝 powerloop plugin（T24） | 概念已 absorb，無 multi-session campaign 需求 |

## Next step

L-2 plan doc → L-2.5 3-reviewer loop（含 T6 challenge query）→ P1 Tier 1 batch → finish-flow。
