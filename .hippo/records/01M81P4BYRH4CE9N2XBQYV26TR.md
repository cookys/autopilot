---
id: 01M81P4BYRH4CE9N2XBQYV26TR
kind: issue
created: 2026-11-22T13:11:36.152Z
---
- **Since**: 2026-11-22
- **Problem**: dispatch 派工乾淨結束但無提交時，error_category 誤標為 auth_failed／rate_limited；應標 agent_declined 並在結果帶 agent 最後一段話。反映：本席 11-22 多次實測。
- **Impact**: 誤導除錯與重試策略，e2e 實測難以辨識 agent 主動拒絕與基礎設施失敗。
- **Trigger**: 修 dispatch 結果分類
- **Source**: self 2026-11-22
- **Pointer**: none
