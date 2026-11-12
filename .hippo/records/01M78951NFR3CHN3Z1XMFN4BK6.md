---
id: 01M78951NFR3CHN3Z1XMFN4BK6
kind: issue
created: 2026-10-31T00:00:00.000Z
---
- **Since**: 2026-10-31
- **Report**: 01M67HZPT918GAWJG237T0JG8N
- **Reply**: 2026-10-31 01M67J17Z9Z9A3TADXHQCSBGXC
- **Problem**: 2026-10-26 以前寫入的成績單資料，每台機器都要手動跑一次 strip-expiry，否則所有席位都被判不合格；說明文字有寫，但沒跑時的失敗方式很難看出原因。
- **Impact**: 沒跑的機器上所有席位都判不合格，使用者不知道要補跑哪個指令。
- **Trigger**: next edit to engine-scorecard store loading, or another machine reports all seats unqualified
- **Source**: PEER-REPORTED peace (<host>) 2026-10-31
- **Pointer**: project/backlog/scorecard-pre-1026-store-migration.md
- **Context**: Evaluate migrating automatically on load, or an explicit prompt from doctor or SessionStart naming the strip-expiry command.
