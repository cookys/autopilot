---
id: 01M78953M2QHMB1VKA8CS4JFKJ
kind: issue
created: 2026-11-05T00:00:00.000Z
---
- **Since**: 2026-11-05
- **Report**: modsreal g3 review, 2026-11-05；2026-11-05 PM ruling
- **Reply**: none；none
- **Problem**: 守衛先驗沙箱根目錄身分再掃描清理；claude 跑完後仍活著的子孫行程可在驗身分與掃描之間換掉路徑，讓掃描只看到符號連結而誤判為綠，或讓 chmod 跟著換過的連結走。
- **Impact**: 守衛偵測意外洩漏憑證或對話紀錄的能力在極端時序下失靈；不是對付惡意行程。
- **Trigger**: modsreal 工作線合併後
- **Source**: modsreal g3 review (astra); PM ruling 2026-11-05 (not a blocker)
- **Pointer**: project/backlog/real-claude-guard-descendant-race.md
