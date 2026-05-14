# Superpowers Coexistence — v2.7.0

**Status**: 🟡 In progress — review loop in flight
**Plan doc**: [`docs/plans/2026-05-14-superpowers-coexistence.md`](../../plans/2026-05-14-superpowers-coexistence.md)
**Branch**: `feat/v2.7.0-superpowers-coexistence`
**CHANGELOG**: (pending v2.7.0 entry)

---

## Project Goal

> **Final goal**: autopilot v2.7.0 supports both「裝了 superpowers」與「未裝 superpowers」兩種使用情境，並提供 per-project escape hatch（user-level 裝了 superpowers 但個別專案想 pure autopilot）。
>
> **Success criteria** （詳細列表見 plan §7）:
> 1. 情境 B（無 superpowers）— 4 個 fallback skill 存在且 description 措辭正確
> 2. 情境 A（有 superpowers）— 無殘餘 hardcoded `superpowers:*` ref 在 step 指示中
> 3. dispatch-config.md schema 完整（mode + 6 chains + fallback semantics）
> 4. 版本 sync 乾淨（2.5.0 / 2.6.0 → 2.7.0）
> 5. CHANGELOG v2.7.0 entry 完整
>
> **Scope boundary**: 純 skill + config 層。不動 12 hooks、不動 3 個 methodology agents（已是 plugin-agnostic）、不寫 dispatch-config 解析器程式。

## Phases

| # | Phase | Status | Commit |
|---|-------|--------|--------|
| 1 | Restore 4 fallback skills (`debug`, `test-strategy`, `team`, `profiling`) + 改寫 description | ⏳ pending | — |
| 2 | 擴充 `dispatch-config.md`（mode + 6 chains + semantics） | ⏳ pending | — |
| 3 | orchestrator skills 接 dispatch-config（dev-flow / ceo-agent / quality-pipeline / finish-flow） | ⏳ pending | — |
| 4 | Docs + CHANGELOG + 版本 bump 至 2.7.0 | ⏳ pending | — |
| 5 | Smoke test + 整合驗證 | ⏳ pending | — |

## Review Loop

- **r0** (pre-plan): partial implementation 已 cherry-pick 進 working tree（dispatch-config.md 雙鏈 + 6 檔 hardcode 拆除）。視為 Phase 2/3 的 baseline，不另起 commit，由 Phase 2/3 commit 一起涵蓋。
- **r1** (plan review, 2026-05-14, 3 reviewers): ✅ 三 reviewer 一致 **approve-with-revisions**；高度收斂於 (a) description 措辭路線錯誤、(b) `mode` 欄位多餘該砍、(c) plugin.json/README 既存 drift 也要在此 ship 順手修。詳見 plan §9 r1 摘要。Revisions 已整合進 plan。
- **r2** (revised-plan spot-check, 2026-05-14, 1 reviewer): ✅ **approve-with-minor-revisions**。15 條 r1 findings 逐條通過驗證；新發現 6 條 tightening items 已全部 inline 修完（含 dev-flow preprocessor 對稱化 → 目標檔 5 → 6 支）。
- **r3+** (phase reviews): 每 Phase finish 時觸發。

## Risks（pointer to plan §5）

詳細風險表見 plan doc。主要 3 項：
1. fallback skill 與 superpowers skill 同存時 routing 衝突 — 緩解：description 措辭 + settings.json escape hatch
2. orchestrator prose 改完 Claude 不真去讀 config — 緩解：FIRST read 句型 + reviewer 驗證
3. 從 `f08812c^` 拉回的 4 支 SKILL.md 內文 stale — 緩解：Phase 1 內逐支讀過 + 更新 See Also

## Links

- Plan doc: [`docs/plans/2026-05-14-superpowers-coexistence.md`](../../plans/2026-05-14-superpowers-coexistence.md)
- Previous v2.0 删除 commit: `f08812c`（reference 4 個被砍 skill 的源檔）
- Inspired by: 使用者在 hangar session 中發現「superpowers 可以不安裝」的情境
