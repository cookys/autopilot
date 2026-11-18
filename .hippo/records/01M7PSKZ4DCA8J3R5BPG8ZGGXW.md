---
id: 01M7PSKZ4DCA8J3R5BPG8ZGGXW
kind: issue
created: 2026-11-18T07:40:54.285Z
---
- **Since**: 2026-11-17
- **Report**: 01M7MP7R
- **Reply**: unknown
- **Problem**: pace 選擇只看剩餘額度，沒讀 pace.v1.json 的 ahead/behind；cursor 等額度充足的引擎不在候選裡。
- **Impact**: 已超前的引擎繼續被選，落後的額度到重置時浪費掉。
- **Trigger**: ready；由非 codex 引擎實作
- **Source**: PEER-REPORTED PM 2026-11-17
- **Pointer**: none
