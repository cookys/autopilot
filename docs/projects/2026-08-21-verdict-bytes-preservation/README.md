# verdict-bytes-preservation

## Project Goal

> **Final goal**: 當 review transport 失敗但模型已產出內容完整、通過完整 content-integrity battery 的 verdict 時,機器紀錄以明確非權威欄位(`unratified_verdict` / `unratified`)保存該事實——process truth(失敗分類、fail-closed 決策面)一律不變;no-verdict 永不得被讀成 review pass。
> **Success criteria**:
> 1. Fixture A(8/8 chrome-prepend 形)與 C(8/20 timeout-with-payload 形)產出 unratified 欄位,且 `status`/`transport_status`/exit code 與 base 逐字節相同(測試斷言)。
> 2. Fixture B/D/E/F(partial / tamper-suspect / echo / ambiguous)unratified 一律 null(負控制)。
> 3. Dead-gate 突變:revert salvage call → A/C 斷言轉紅(記錄於 evidence)。
> 4. Authority pinning:resolve-review-loop cascade、qc-panel skip、plan-review exit-4 各一條斷言,餵 no_verdict-with-unratified artifact 仍 fail-closed。
> 5. 全套件綠 + preflight 8/8(v2.34.33)。
> **Scope boundary**: 含 — dispatch-review.sh 失敗漏斗、plan-review-normalize.js、dispatch-plan-review.js 席位紀錄、dispatch-status --panel 顯示、fixtures/tests、CHANGELOG/version/mirrors、BACKLOG row 收束。不含 — 權威路徑 parser 放鬆(禁止)、unratified 自動升級為權威(policy change,需獨立 review)、歷史 artifact 回溯重分類、新 script。

## Scope Completeness Audit (L-1.5, 2026-08-21)

| Dimension | 判定 | 覆蓋 |
|---|---|---|
| Source code + tests | yes | KR1-3(plan §3);tests 進既有三檔 |
| User-facing docs | no | script 行為欄位,無 skill/README 面 |
| API / interface reference | yes | dispatch-review.sh header JSON 契約註解、normalize 回傳形註解隨改 |
| Config templates | no | 無新 config |
| CHANGELOG | yes | v2.34.33 節 |
| Version bump | yes | PATCH;sync-version.js + grep 舊版本字串全樹 |
| Migration notes | no | 純 additive 欄位,消費端寬鬆 parse 已驗證 |
| Dependent repos / consumers | yes | codex/opencode mirrors 由 sync-all 帶;消費端 authority pinning 測試 |
| Credit | no | 無外部吸收 |
| Dogfood | yes | 本 plan 的 G1 review 本身走 dispatch-plan-review(改動的就是這條 rail;先 review 後改碼,不衝突) |

User-stated requirements ledger:CEO 授權下無逐字需求;來源為 BACKLOG entry 三要求 — (1) exact residual fixtures for still-supported runners → KR3;(2) 保留 process truth、verdict bytes 與 transport failure 分欄 → KR1/KR2;(3) 禁止 no-verdict 誤報成 review pass → KR3 authority pinning。全部映射,無孤兒。

## Progress

| Date | Item | Status |
|---|---|---|
| 2026-08-21 | Mission admission READY(l3 inline,1 deliverable)| done |
| 2026-08-21 | Plan drafted(docs/plans/2026-08-21-verdict-bytes-preservation.md)| done |
| 2026-08-21 | G1 plan review(sol+grok 雙 STOP,15 findings 全裁決,2 子修法拒絕附理由)| done |
| 2026-08-21 | G2 plan review(terminal,9 findings 全 accept;plan R3 FROZEN)| done(`5fa224da`)|
| 2026-08-21 | Fixture 前置:notice bytes live 重現凍結(CC 2.1.238,stderr 流向誠實揭露)+ C-complete-timeout 走真 author 路徑凍結(exit_failure 真相)| done |
| 2026-08-21 | KR2 envelope rail salvage(normalize 矩陣 + seat carry + aggregation 保存 + panel/status 標記;266 assertions 綠)| done(`345d40ec`)|
| 2026-08-21 | KR1 shell rail salvage(red 10 → battery 抽取 + 六站點 funnel 收斂 + schema/validator 原子更新 → green 316,既有 306 全保留)| done |
| 2026-08-21 | KR3:reader-allowlist guard(canonical-invariants 新模式 + synthetic-consumer 紅證常駐)+ 兩軌 dead-gate 突變記錄(shell 3 紅/normalize 6 紅,負控制全綠)| done |
| 2026-08-21 | docs:CHANGELOG v2.34.33 + version sync(grep 殘留零)+ BACKLOG row 收束(附新 residual trigger)| done |
| | 全套件 + preflight + finish-flow(L-5)| in progress |

## Links

- Plan: [docs/plans/2026-08-21-verdict-bytes-preservation.md](../../plans/2026-08-21-verdict-bytes-preservation.md)
- BACKLOG source row:「Reviewer transport exits can erase an otherwise valid fail-closed verdict」
- Incidents: 2026-08-08(cc-shim/MiniMax,BACKLOG row 附記)、2026-08-20(minimax plan-review seat,v2.34.28 exit-first 註解 + multiturn-event-harness G1)
