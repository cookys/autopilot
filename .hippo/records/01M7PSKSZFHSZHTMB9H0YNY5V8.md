---
id: 01M7PSKSZFHSZHTMB9H0YNY5V8
kind: issue
created: 2026-11-18T07:40:49.007Z
---
- **Since**: 2026-11-14
- **Report**: fleet 01M7DKWKB6 (PM, 2026-11-14)
- **Reply**: unknown
- **Problem**: PM 專用驗證器目前缺這兩項檢查：S4 應檢查結尾行並確認快照指令真的執行過，S9 應統計抓漏數。完整規格在 PM 的合成文件 D9 列，目前這份文件還沒附上全文。
- **Impact**: 沒有 S4 與 S9 驗證，PM 收尾漏跑快照或驗證抓漏率時無從自動把關。
- **Trigger**: PM 附上 SYNTHESIS.md D9 全文
- **Source**: PM 01M7DKWK sub-item 1 (D9), fleet task 01M7DM1C8S49GM08JYEX2MN07Q
- **Pointer**: project/backlog/pm-01m7dkwk-subitems.md
- **Context**: Spec defined in PM SYNTHESIS.md row D9; awaiting full text from PM before implementation.
