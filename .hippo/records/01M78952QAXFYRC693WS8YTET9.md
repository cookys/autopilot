---
id: 01M78952QAXFYRC693WS8YTET9
kind: issue
created: 2026-11-01T00:00:00.000Z
---
- **Since**: 2026-11-01
- **Problem**: 還原放行有兩處沒有測到：同一檔超過 500 行 finding 時改走整檔 blame 的路徑沒有單元測試；blame 標頭的比對寫死 40 位 SHA-1，SHA-256 的 repo 會解析不到，所有放行都失效。
- **Impact**: 只影響放行，掃描本身不受影響；兩者出錯時都是不放行、不會漏放；目前 repo 是 SHA-1。
- **Trigger**: next edit to scripts/leak-guard.js
- **Source**: leakfu review g5 (CUT/FOLLOW-UP suggestions), 2026-11-01
- **Pointer**: project/backlog/leak-guard-restore-hardening.md
