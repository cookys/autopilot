---
id: 01M7894YZYMNGW73HNZZ5QHVXQ
kind: issue
created: 2026-09-12T00:00:00.000Z
---
- **Since**: 2026-09-12
- **Report**: 2026-09-12 fleet
- **Reply**: none
- **Problem**: 主訴求已出貨。還剩兩件：拒絕時回報已釋放，持久狀態卻仍留有效租約，下次啟動會撞上未關租約；驗證指令繼承的搜尋路徑缺工具，找不到命令應算前置條件失敗。
- **Impact**: 下次啟動被未關租約擋住；缺工具被當成驗證失敗，分不清是環境還是產品。
- **Trigger**: a refusal reports released while durable state keeps a live lease, or verify_cmd inherits a PATH missing the operator tool
- **Source**: openclaw fleet relay 2026-09-12; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: project/backlog/peer-reported-openclaw-an-active-l5-marker-deadlocks-the-bounded-campaign-l5-its.md
- **Context**: Main claim shipped in v2.36.28. Original effort label was Fix. (a) may be partly covered by v2.36.71, unconfirmed.
