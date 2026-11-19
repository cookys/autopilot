---
id: 01M7TEDHCGMGEKEDE9DCXE3VMM
kind: issue
created: 2026-11-19T17:42:06.992Z
---
- **Since**: 2026-11-20
- **Report**: 01M7T72M
- **Reply**: none
- **Problem**: gitconfig 圍堵把 ops 合法修改的 core.sshCommand 還原掉，建議告警並列出 restored_keys 且加上鎖檔。
- **Impact**: ops 在 gitconfig 合法設定的 core.sshCommand 會被靜默還原，導致遠端操作失敗。
- **Trigger**: 下次修改 gitconfig 圍堵並為 core.sshCommand 加上 restored_keys 告警時處理
- **Source**: PEER-REPORTED twgameproject 2026-11-20
- **Pointer**: none
