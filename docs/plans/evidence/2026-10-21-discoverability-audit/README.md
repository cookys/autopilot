# 2026-10-21 discoverability audit

# RED at 3df419901: not applicable, docs only

這是 owner 2026-10-21 要求的「功能有做、入口沒教」全面盤點，下列檔案從盤點暫存目錄原樣複製：discover-audit.md（第一輪）、discover-prep.md、audit-common.md（第二輪共同說明）、audit-hetero.md、audit-engine.md、audit-flow.md、audit-surface.md。第一輪第 5 項 pin-evidence-anchors 判定錯誤：discover-audit.md 寫成完全找不到呼叫，而且殘留清理與 reap 腳本對 evidence-anchors 零命中；audit-common.md 與 audit-flow.md 更正為 repo-residue-sweep.js 與 reap-dispatch-branches.sh 都會呼叫（記在 repo-residue-sweep.js:911、reap-dispatch-branches.sh:1263），所以沒有另開工線去「讓它們開始呼叫」。據這次盤點實際出貨的工線，merge 訊息為：dmech 6e428fd6c（待決卡開啟、回答與關閉）、dskill 9aa45ce1b（AGENTS.md 給非 Claude agent 的入口）、dwire 215d9084c（finalize 跑 dispatch-suppression，且 usage 列出 endpoints test；guidance cut gate 沒接進 preflight）、bl215 3955ea75b（patch-id 算已併入）、bl247 1912ff81e（requires adoption 寫出採納指令）、bl250 e993e0fc0（每次 SessionStart 的對齊檢查與完整提示；一道指令同時寫兩處沒做）。沒做完的留在 BACKLOG；本 README 是剩餘入口缺口那一列的 Pointer。

另一個入口缺口：`skills/harness-maintenance/SKILL.md` 的腳本表還沒有列出 `scripts/install-token-discipline.js`。那份技能檔是指引清單，改它之前要先有評測證據。這次沒有改那份檔。
