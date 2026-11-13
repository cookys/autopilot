---
id: 01M78952GZS0R5GW5Y8NPGQVRS
kind: issue
created: 2026-11-01T00:00:00.000Z
---
- **Since**: 2026-11-01
- **Report**: 01M6A95050YK4D480QJXK54QDW
- **Reply**: 2026-11-01 01M6A95N5HQ26507XPERC9JFVJ
- **Problem**: owner 在 codeforge 的卡片 d-7b0f7a4a 選 A：速度整包改由 autopilot 量測並繪製，含分頁列的 ϟ 標籤、速度欄（平均、最佳、最新、首字、走勢）與最近請求表。forge-stats 之後只畫 Ferris、寵物、記憶與大腦。
- **Impact**: 移交前 live mod 仍讀 codeforge 的 keyed Box；我們上線並把 sha 告訴 codeforge 後，他們才移除自己的速度程式，中間沒有空窗。
- **Trigger**: 3.0.0 之後；after 3.0.0-alpha.7 ships (the mods path moves during the relayout, same reason as BL-0358)
- **Source**: PEER-REPORTED codeforge 2026-11-01 (fleet message), owner card d-7b0f7a4a
- **Pointer**: project/backlog/live-speed-handover-from-forge-stats.md
- **Context**: Algorithm, handover order and the pet-label question are in the sidecar. Show the owner a screenshot before any UI change; reply to codeforge with the sha once live.
