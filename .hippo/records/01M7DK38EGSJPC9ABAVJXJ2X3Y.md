---
id: 01M7DK38EGSJPC9ABAVJXJ2X3Y
kind: issue
created: 2026-11-13T00:00:00.000Z
---
- **Since**: 2026-11-13
- **Problem**: 配速選擇缺少一個測試，證明排除參數會把對應的鍵從優先序走訪中移除。
- **Impact**: 排除與優先序的互動壞掉時，測試抓不到。
- **Trigger**: ready
- **Source**: autopilot lane 2026-11-13
- **Pointer**: none
- **Context**: Add a test that --exclude removes a key from the priority walk in scripts/pace-select.js.
