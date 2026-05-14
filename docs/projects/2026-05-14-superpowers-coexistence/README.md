# Superpowers Coexistence — v2.7.0

**Status**: 🟢 Phases complete — pending merge to `develop`
**Plan doc**: [`docs/plans/2026-05-14-superpowers-coexistence.md`](../../plans/2026-05-14-superpowers-coexistence.md)
**Branch**: `feat/v2.7.0-superpowers-coexistence`
**CHANGELOG**: [v2.7.0 entry shipped](../../../CHANGELOG.md)

---

## Project Goal

> **Final goal**: autopilot v2.7.0 supports both「裝了 superpowers」與「未裝 superpowers」兩種使用情境，並提供 per-project escape hatch（user-level 裝了 superpowers 但個別專案想 pure autopilot）。
>
> **Success criteria** （詳細列表見 plan §7）:
> 1. ✅ 情境 B（無 superpowers）— 4 個 fallback skill 存在且 body 有 `## Coexistence with Superpowers` 段
> 2. ✅ 情境 A（有 superpowers）— 無殘餘 hardcoded `superpowers:*` ref 在 step 指示中
> 3. ✅ dispatch-config.md schema 完整（6 條 chains + Fallback semantics；**無 `mode` 欄位**，per r1 review 收斂結果）
> 4. ✅ 版本 sync 乾淨（2.5.0 / 2.6.0 → 2.7.0）
> 5. ✅ CHANGELOG v2.7.0 entry 完整
> 6. ✅（plan v1 新增）6 個 orchestrator skill 接上 `!cat .claude/dispatch-config.md` preprocessor
> 7. ✅（plan v1 新增）`code-review.md` 「runtime-detect」段改寫成 chain-based dispatch 措辭
>
> **Scope boundary**: 純 skill + config 層。不動 12 hooks（只動 `hooks/hooks.json` description 字串以同步版本）、不動 3 個 methodology agents（已是 plugin-agnostic）、不寫 dispatch-config 解析器程式。

## Phases

| # | Phase | Status | Commit |
|---|-------|--------|--------|
| 1.1 | Phase 1.1 — restore 4 fallback skills verbatim from `f08812c^` | ✅ | `8a4cfac` |
| 1.2 | Phase 1.2 — Coexistence subsections (per-skill 差異說明) | ✅ | `9e4ad7d` |
| 1.3 | Phase 1.3 — drop stale `plan-bootstrap.js` ref + tighten See Also | ✅ | `92e5690` |
| 2 | Phase 2 — 擴充 `dispatch-config.md`（6 chains + Fallback semantics；無 mode） | ✅ | `60a261b` |
| 3 | Phase 3 — orchestrator `!cat` preprocessor + `code-review.md` 改寫 | ✅ | `79561b1` |
| 4.1+4.3 | Phase 4.1+4.3 — version bump + manifest sync + hooks.json | ✅ | `31c3a49` |
| 4.2 | Phase 4.2 — README EN + zh-TW Superpowers Coexistence section + brand revision | ✅ | `3d2b9e4` |
| 4.4 | Phase 4.4 — CHANGELOG v2.7.0 entry | ✅ | `fa8cd24` |
| 5 | Phase 5 — Smoke test (caught 3 missed "12 skills" strings in Install/Companions) | ✅ | `ef202c8` |
| Final | Final pre-merge review patch（3 個 r0 partial 改動補 commit） | ✅ | `d82cc6b` |

11 commits total（含 plan + project doc commit `14d0141`）。

## Review Loop

- **r0** (pre-plan): partial implementation 已 cherry-pick 進 working tree（dispatch-config.md 雙鏈 + 6 檔 hardcode 拆除）。後由 Phase 2/3 commit 涵蓋；殘餘 3 個 `.claude/` config 改動由 final review 抓出補 `d82cc6b`。
- **r1** (plan review, 2026-05-14, 3 parallel reviewers): ✅ **approve-with-revisions**。三 reviewer 高度收斂於 (a) description 措辭路線錯誤、(b) `mode` 欄位多餘該砍、(c) plugin.json/README 既存 drift 也要在此 ship 順手修。15 個 finding 全部整合進 plan。
- **r2** (revised-plan spot-check, 2026-05-14, 1 reviewer): ✅ **approve-with-minor-revisions**。15 條 r1 findings 逐條通過；新發現 6 條 tightening items 全部 inline 修完（含 dev-flow preprocessor 對稱化 → 目標檔從 5 → 6 支）。
- **Phase 1 quality gate** (2026-05-14): ✅ **complete**。逐 commit 驗證：1.1 byte-identity 與 `f08812c^`、1.2 per-skill 差異說明落實、1.3 stale ref 清乾淨。
- **Phase 3 quality gate** (2026-05-14): ✅ **complete**。6 SKILL.md preprocessor placement、code-review.md rewrite 質量、不破壞鄰近 prose flow 三點驗收。
- **Final pre-merge review** (2026-05-14): ⚠️ **re-review-after-patch** → 抓出 1 個 blocker（3 個 `.claude/` config 改動沒 commit 但 CHANGELOG 已宣稱），patch `d82cc6b` 後 implicitly **approve-for-merge**。

## Files touched (25 total, +1400 / -68)

**新增（5）**：
- `docs/plans/2026-05-14-superpowers-coexistence.md` — plan doc
- `docs/projects/2026-05-14-superpowers-coexistence/README.md` — 本檔
- `project-config-template/dispatch-config.md` — 6 chains schema
- `skills/{debug,test-strategy,team,profiling}/SKILL.md` — 從 `f08812c^` restore
- `skills/team/references/team-tactics.md` — 同上

**修改（20）**：
- 6 個 orchestrator SKILL.md — 加 `!cat dispatch-config.md` preprocessor（+ dev-flow Session Rules row）
- `skills/quality-pipeline/references/code-review.md` — 改寫「runtime-detect」段為 chain-based
- 2 個 `.claude/` config — superpowers fallback 標記為 plugin-conditional
- `project-config-template/quality-gate-config.md` — Code Review 指向 dispatch-config
- 2 個 README — Superpowers Coexistence section + brand tagline + badges + 雙語同步
- `CHANGELOG.md` — v2.7.0 entry（newest-first，含 migration callout）
- `.claude-plugin/{plugin,marketplace}.json` — 2.5→2.7 + tagline + 16 skills
- `hooks/hooks.json` — description (v2.7.0)
- `docs/projects/INDEX.md` — 進行中 row

## Risks（pointer to plan §5）

詳細風險表見 plan doc §5。主要 3 項：
1. fallback skill 與 superpowers skill 同存時 routing 衝突 — 緩解：dispatch-config chain（L2 disambiguation surface）+ settings.json `disabledSkills`（L3 hard cut）
2. orchestrator 改完 Claude 不真去讀 config — 緩解：用 `!cat` preprocessor 而非 prose pointer（per r1 Arch C1）
3. 4 個 restore SKILL.md 內文 stale — 緩解：Phase 1.3 處理 `team-tactics.md` 的 `plan-bootstrap.js` ref；其他內文 r1 Impl reviewer 已逐支讀過確認

## Next step

待 user review + decide merge timing。merge 流程（per autopilot `.claude/finish-flow-config.md` L-5）：

```bash
git checkout develop
git merge --no-ff feat/v2.7.0-superpowers-coexistence
# L-5.4 post-merge 重讀 1-3 highest-risk 檔驗證 merge 沒漏
# L-5.5 archive：mv 本專案到 _archive/ + INDEX 移到已完成
# L-5.6 learn：記錄本 ship 的 review loop 教訓
```

## Links

- Plan doc: [`docs/plans/2026-05-14-superpowers-coexistence.md`](../../plans/2026-05-14-superpowers-coexistence.md)
- CHANGELOG: [v2.7.0 entry](../../../CHANGELOG.md)
- Previous v2.0 刪除 commit: `f08812c`（4 個被砍 skill 的源檔）
- r1 + r2 + final review 完整紀錄: plan §9
- Inspired by: 使用者在 hangar session 中發現「superpowers 可以不安裝」的情境
