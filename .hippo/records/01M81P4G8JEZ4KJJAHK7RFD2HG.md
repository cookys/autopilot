---
id: 01M81P4G8JEZ4KJJAHK7RFD2HG
kind: issue
created: 2026-11-22T13:11:40.562Z
---
- **Since**: 2026-11-22
- **Problem**: land.sh 落地失敗時不清 land-<label> worktree，殘留要手動 remove --force。反映：本席 11-22。
- **Impact**: 失敗後殘留 worktree 佔用磁碟並干擾後續 land 與 worktree 衛生檢查。
- **Trigger**: 修 land.sh 失敗清理
- **Source**: self 2026-11-22
- **Pointer**: none
