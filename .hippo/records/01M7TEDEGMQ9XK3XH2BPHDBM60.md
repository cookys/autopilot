---
id: 01M7TEDEGMQ9XK3XH2BPHDBM60
kind: issue
created: 2026-11-19T17:42:04.052Z
---
- **Since**: 2026-11-20
- **Report**: n/a
- **Reply**: none
- **Problem**: dispatch-hetero 的測試缺少哨兵 PATH，失誤時可能會叫起真的 CLI。
- **Impact**: dispatch-hetero 測試失敗時可能因 PATH 未隔離而產生真實外部呼叫與額外費用。
- **Trigger**: 下次修改 dispatch-hetero 測試套件並補上哨兵 PATH 時處理
- **Source**: PEER-REPORTED autopilot 2026-11-20
- **Pointer**: none
