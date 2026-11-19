---
id: 01M7TEDBPEH4PHGTXVXD01XR59
kind: issue
created: 2026-11-19T17:42:01.166Z
---
- **Since**: 2026-11-20
- **Report**: 01M7RYFP
- **Reply**: none
- **Problem**: dispatch-hetero 產生的建置輸出留在 worktree 與 repo 裡，既沒有清掉也沒有加入忽略清單。
- **Impact**: 殘留產物會污染 worktree 狀態並干擾後續 dispatch-hetero 與檢查。
- **Trigger**: 下次修改 dispatch-hetero 清理或 worktree 衛生檢查時處理
- **Source**: PEER-REPORTED gpu-lead 2026-11-20
- **Pointer**: none
