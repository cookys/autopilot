---
id: 01M7ZCNDD8PMWDADA0SBCA4SAK
kind: issue
created: 2026-11-21T15:47:40.072Z
---
- **Since**: 2026-11-21
- **Problem**: 回歸警報用同名 label 計數時沒有區分 lane，不同 lane 的計數會混在一起。
- **Impact**: 某 lane 的警報次數被其他 lane 污染，難以判斷來源。
- **Trigger**: 下次修改回歸警報計數或 lane 隔離時
- **Source**: autopilot lane 2026-11-16
- **Pointer**: none
