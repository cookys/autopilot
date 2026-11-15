---
id: 01M7GS84093EVZEQ2P5TNQPMGF
kind: issue
created: 2026-11-15T23:38:59.465Z
---
- **Since**: 2026-11-16
- **Problem**: 2026-11-16 第二批全套對照主線基準，又有一批測試在基準點就失敗，不是這次改動新引入的。其中一支早已列在基準紅名單，其餘是新點名的。
- **Impact**: 全套紅燈分不出新壞掉與本來就紅，驗收會把舊紅當成這次的退步。
- **Trigger**: ready
- **Source**: autopilot lane 2026-11-16
- **Pointer**: project/backlog/base-red-second-batch-2026-11-16.md
- **Context**: 第二批名單與基準 761162e91 在旁檔。test-pipefail-grep-q 仍歸 BL-0313。runner-binary 另見 BL-0414（單獨跑綠）。
