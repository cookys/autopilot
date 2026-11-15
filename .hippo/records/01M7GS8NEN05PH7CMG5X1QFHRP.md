---
id: 01M7GS8NEN05PH7CMG5X1QFHRP
kind: issue
created: 2026-11-15T23:39:17.333Z
---
- **Since**: 2026-11-16
- **Problem**: 只改變更紀錄裡的設定段、多了一個設定開關時，單件挑選沒有選到會檢查該段的套件。整包全跑才抓到。
- **Impact**: 只跑挑到的套件會假綠，設定段的檢查壞了也能合併。
- **Trigger**: ready
- **Source**: autopilot lane 2026-11-16
- **Pointer**: none
- **Context**: scripts/affected-suites.js single select misses preflight-slash-probe-optin after a CHANGELOG Settings-section switch is added. Full suite caught it. Same family as BL-0391 and BL-0410.
