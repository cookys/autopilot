---
id: 01M78952X7MFNKAC2RQQAB5NMY
kind: issue
created: 2026-11-04T00:00:00.000Z
---
- **Since**: 2026-11-04
- **Report**: BL-0383 入口文件拆分的 Q6 裁示, 2026-11-04
- **Reply**: none
- **Problem**: Codex、agy、OpenCode 這類工具不會自己往子目錄走，從根目錄開工就看不到各子目錄的規則檔。入口文件拆分只在派工說明裡加了一句文字，要求 brief 寫明「先讀該子目錄的 AGENTS.md」，沒有任何機制檢查。
- **Impact**: 派去 Codex 或 agy 的工作若漏寫這句，工人看不到該目錄的規則，可能做出違反子目錄規定的改動。
- **Trigger**: BL-0383 合併之後，下次動 dispatch 軌道的 brief 組裝時
- **Source**: pm:knowledge/harness-entry-docs.md 規則 4（pm repo 無 remote，無網址）
- **Pointer**: project/backlog/brief-reads-subdir-agents-md.md
