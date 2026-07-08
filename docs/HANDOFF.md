# HANDOFF — /l6 skills-audit 系列結案快照(2026-07-08)

> 取代 2026-07-02 版(該 campaign 已結案;快照非日誌)。由 session 31d0d311 於 clear 前寫入。
> 機械快照另有 `handoff_inject` hook(已啟用)會在 /clear 時自動寫入 ~/.autopilot 並於下個 session 注入。

## 目標
/l6 skills-audit 系列(2026-07-05 起)已全部完成:v2.32.0 → **v2.32.8** 八個版本 shipped + pushed。本 handoff 僅供下個 session 認路,無 in-flight 工作。

## 現況
- develop = origin(`41a4219` + 本 handoff commit),工作樹乾淨,**零**工作分支、零 worktree 殘留
- 孤兒測試檔(R5 時代)停放於 `~/.claude/jobs/31d0d311/tmp/parked/`,要救隨時在
- reviewer roster(scorecard):**六家族** — gpt-5.5 / sonnet-5 / opus-4.8 / MiniMax-M3 / grok-build / GLM-5.2 全 qualified;**Gemini Flash 落榜**(漏放 1 critical,implementer-only)
- endpoints:minimax + glm 都在 `~/.autopilot/endpoints.env`;grok 已裝已登入;codex quota limited 未耗盡

## 已決事項(不重議)
1. **Observation-first 憲法**(plan `docs/plans/2026-07-08-observation-first-skills.md`,五家族三輪收斂):強制只放觀測層;審查否決權移除需「紅綠 ∧ scorecard-qualified ∧ risk=low」連言;「沒有客觀驗證」合法但審查 gating 常駐
2. **管線匯率定律**(實測):管線價值 = 模型與任務落差 — 救援不及格者(+100pp)、稅/傷害超標者(4-12×);verify-first 三預測全中
3. **finish-flow「max 3 rounds」保留字面值**(它是 quality-pipeline 同質迴圈,非 engine 迴圈 — opus 裁定,勿再「修正」)
4. **成本紀律**(user 逐字):Fable 只做決策與權限簽核;報告/分析→sonnet、qc lens→opus、勞務全委派
5. 散文不改變行為(全系列 n>100 一致)— 任何「加提醒文字」的提案預設無效,要操作程序或機械合約

## 下一步(候選,無承諾順序)
1. `grep -n "verify_strength\|min_panel_size" docs/BACKLOG.md` — 兩個已立案的 resolver 軸(驗證強度評分、家族無關 panel 下限),都是 S-M 工作量
2. t14 每輪機械重注入儀器(長程漂移 4/35,散文救不了 — 唯一未測的機械解)
3. 給 M3/flash 頻帶造更難的 eval 任務(現有全天花板,測不出 lift)

## 驗證方式
- `git log origin/develop --oneline -3` — 應見本 handoff commit 與 41a4219
- `AUTOPILOT_SKIP_SLASH_PROBE=1 AUTOPILOT_SLASH_PROBE=1 ./scripts/preflight-release.sh` — v2.32.8 應 8/8
- `node scripts/engine-scorecard.js current --role reviewer` — 應見 8 列(6 qualified + eng-review + Gemini failed)

## Read-order
1. `~/.claude/projects/-home-cookys-projects-autopilot/memory/MEMORY.md` — 自動注入,batch 1-7 全史與教訓都在 l6-skills-audit 條目
2. `docs/plans/2026-07-08-observation-first-skills.md` — 憲法本文(含五家審查修訂軌跡)
3. `docs/projects/_archive/2026-07-06-eval-instruments/report.md` — 全部量測數字(匯率、逃逸懸崖、t14)
4. `docs/BACKLOG.md` 尾部 — 兩個新軸的立案條目

## 陷阱
- **共用 checkout**:review diff 必須 path-scoped(`git diff base..HEAD -- <file>`);判分支歸屬先 `git log develop..<branch>`,空 = 死 ref
- **被殺的 wrapper ≠ 工作丟失**:先查分支有沒有 commit(artifact 軌)
- **verify-cmd 一律寫成 script 檔**傳路徑(嵌套引號會碎 argv)
- **MiniMax 同 endpoint 並發會 rate-limit** → 序列;跨家族分流(A→MiniMax B→GLM C→grok)可平行
- **長程 campaign 每 run 加 auth 存活檢查**(/login 切換會靜默殺光背景呼叫,已發生兩次)
- 版本號先 `git fetch` 查撞車(本系列撞過兩次,先推先贏改號)
