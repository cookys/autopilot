---
id: 01M7894XYD992NJZYYMXFJ282Z
kind: issue
created: 2026-11-01T00:00:00.000Z
---
- **Since**: 2026-11-01
- **Report**: 01M6BK2FVVCH6BHAJJPE095XEQ
- **Reply**: 2026-11-01 01M6BK34N1Z70RKBGGVJRX9X2J
- **Problem**: 即時面板在沒有新變化時，也會跳出資料過舊、發佈者沒在發佈的提示，連 watcher 已正常結束的情形都算在內。使用者打字到一半也會被這則提示打斷。
- **Impact**: 沒有新變化被誤報成過期，打字時畫面還跳動，使用者不知該不該處理。
- **Trigger**: planpath and sealbase (migration plan P1 prerequisite lanes) merged; owner must approve before/after real-terminal screenshots before merge
- **Source**: PEER-REPORTED openclaw 2026-11-01 (fleet msg; operator quote in sidecar; reply sha owed to the fleet session after merge)
- **Pointer**: project/backlog/live-pane-stale-text-when-nothing-changed.md
