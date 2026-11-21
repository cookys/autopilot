---
id: 01M7ZCMX10TMV67NMHQMJ3XD17
kind: issue
created: 2026-11-21T15:47:23.296Z
---
- **Since**: 2026-11-21
- **Report**: 01M7YXD5
- **Reply**: none
- **Problem**: 審查與派工產生的 manifest 寫在一般磁碟臨時目錄而非 tmpfs，重開機前不會清，跨工作階段會殘留。
- **Impact**: 舊 manifest 可能被誤讀，多輪派工狀態容易混淆。
- **Trigger**: 下次整理審查或派工 manifest 寫入位置時
- **Source**: PM 01M7YXD5 2026-11-16
- **Pointer**: none
