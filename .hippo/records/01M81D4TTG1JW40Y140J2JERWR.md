---
id: 01M81D4TTG1JW40Y140J2JERWR
kind: issue
created: 2026-11-22T10:34:34.192Z
---
- **Since**: 2026-11-22
- **Problem**: dispatch-hetero 對乾淨結束卻無提交的派工誤標 error_category 為 auth_failed 或 rate_limited，巡查與人會被誤導去看錯誤類別；應標 agent_declined 並附 agent 最後一段話。autopilot 席 2026-11-22 五次。
- **Impact**: 誤導判讀派工失敾原因，重派錯引擎
- **Trigger**: 下次派工乾淨結束卻無提交時
- **Source**: self 2026-11-22
- **Pointer**: none
