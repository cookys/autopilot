---
id: 01M80CPV8W2RA5RKC6V3K6N0V1
kind: issue
created: 2026-11-22T01:07:41.468Z
---
- **Since**: 2026-11-22
- **Problem**: 開工提示會登上一行式欄位頭（Engine、Role、Lane 併成一行），但子代理預算守衛只認分行寫法，遇到單行頭就讀不到 lane，該 lane 的預算上限悄悄不生效。
- **Impact**: 用單行頭開工子代理時沒有 lane 上限保護，超額不會被擋。
- **Trigger**: 下次修改子代理預算守衛或開工提示的欄位頭寫法時
- **Source**: autopilot seat, 2026-11-22
- **Pointer**: none
- **Context**: 與 BL-0338（單行提示模板被守衛擋）同一家族，本列是 lane 上限靜默失靈的一面。
