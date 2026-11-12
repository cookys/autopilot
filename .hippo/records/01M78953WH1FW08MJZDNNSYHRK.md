---
id: 01M78953WH1FW08MJZDNNSYHRK
kind: issue
created: 2026-11-05T00:00:00.000Z
---
- **Since**: 2026-11-05
- **Report**: 2026-11-05 fleet
- **Reply**: none
- **Problem**: 收尾輸出的未解決發現數，把已驗證但還沒被後一代明確解決的發現也算進去。這是設計如此，但輸出沒說明，解決的寫法也沒寫清楚。
- **Impact**: 使用端看到數字不為零，不知道是真的沒修，還是只差一筆解決記錄。
- **Trigger**: next touch of the hetero-review-loop finalize summary
- **Source**: PEER-REPORTED codeforge 2026-11-05
- **Pointer**: project/backlog/review-loop-open-vs-pending-split.md
