---
id: 01M789544R4P4MRJN5PC3SXRWD
kind: issue
created: 2026-11-05T00:00:00.000Z
---
- **Since**: 2026-11-05
- **Problem**: d0gate 測試現在拿凍結樣本跟釘住提交上的程式比對，因為那一輪已結案。開新一輪時沒有重釘，測試就會比對過期的版本。
- **Impact**: 新一輪 d0gate 若沒重釘，測試照樣綠但沒驗到現行程式。
- **Trigger**: next d0gate round
- **Source**: wfix merge 8c0d36273
- **Pointer**: project/backlog/d0gate-stub-repin-on-new-round.md
