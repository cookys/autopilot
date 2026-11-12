---
id: 01M7894XPGE5PC7TCH9GJVQ8SE
kind: issue
created: 2026-11-01T00:00:00.000Z
---
- **Since**: 2026-11-01
- **Problem**: 五支測試套件在主線的基準點就失敗，不在已知紅名單裡，也不知道從哪個提交開始紅；驗收時在基準與修改後各跑一次，失敗相同。
- **Impact**: 完整套件跑出紅燈，真正的新壞掉會被這五支蓋住。
- **Trigger**: next touch of runs-watch, the status CLI or the review rail, or the full-suite run before the 3.0.0 release
- **Source**: sealbase acceptance runs cv1 and cv2, 2026-11-01
- **Pointer**: project/backlog/four-suites-red-on-develop-base.md
