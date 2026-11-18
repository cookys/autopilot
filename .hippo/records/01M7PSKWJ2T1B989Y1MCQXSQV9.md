---
id: 01M7PSKWJ2T1B989Y1MCQXSQV9
kind: issue
created: 2026-11-18T07:40:51.650Z
---
- **Since**: 2026-11-14
- **Report**: fleet 01M7DKWKB6 (PM, 2026-11-14)
- **Reply**: unknown
- **Problem**: 閘道允許清單與 qwen 金絲雀文件已經合併，但另外四處可改走本地模型的呼叫點尚未寫成文件也還沒接上；且依既有決策，AR 對話內容不可交給 qwen 或任何中國模型。
- **Impact**: 非敏感工作仍繼續消耗雲端模型額度，無法在符合隔離限制下切流至本地端點。
- **Trigger**: qwen 恢復上線
- **Source**: PM 01M7DKWK sub-item 4 (5a), fleet task 01M7DM1SER20CGEHFSNBRWKCPM
- **Pointer**: project/backlog/pm-01m7dkwk-subitems.md
- **Context**: Gateway allowlist 9962787d0 and qwen canary docs merged. Four remaining local-offload sites undocumented and unwired. Constraint: AR dialog must never go to qwen or any Chinese model (d-1dfcf757).
