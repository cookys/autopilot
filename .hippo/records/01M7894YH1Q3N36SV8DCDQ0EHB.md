---
id: 01M7894YH1Q3N36SV8DCDQ0EHB
kind: issue
created: 2026-10-04T00:00:00.000Z
---
- **Since**: 2026-10-04
- **Problem**: 擁有者要求 mods 介面能顯示「代理替你做的決定」提醒。目前沒有任何地方記錄這類決定，所以介面無從顯示；要先做記錄寫入，再做監看，最後才是顯示。 (draft)
- **Impact**: 擁有者想看到代理的決定卻看不到；屬新功能，排在 mods 隨 3.0.0 發布之後。 (draft)
- **Trigger**: 3.0.0 之後；after mods ship with 3.0.0
- **Source**: owner request and C4 research, 2026-10-04
- **Pointer**: project/backlog/mods-p5-proxy-decision-reminders.md
- **Context**: no live decision ledger exists and nothing writes proxy-decision rows, so the live band cannot show them yet; writer, then watcher sidecar, then display.
