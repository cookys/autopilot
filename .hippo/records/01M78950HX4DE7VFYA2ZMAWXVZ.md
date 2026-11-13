---
id: 01M78950HX4DE7VFYA2ZMAWXVZ
kind: issue
created: 2026-10-26T00:00:00.000Z
---
- **Since**: 2026-10-26
- **Problem**: 已蓋章的評測列可能漏凍結檔案（bpack、gdorm、dcard-v3、qs-v3）。要查蓋章後這些檔有沒有被改過；改過的話，該列結果無法從原檔重新推導。
- **Impact**: 檔案蓋章後若被改，舊評測列的結果就無法重新驗證。
- **Trigger**: a spare lane is free for the audit, or an old stamped row is re-derived
- **Source**: fbstamp closure-scan observation 2026-10-26
- **Pointer**: project/backlog/stamped-rows-missing-frozen-files.md
- **Context**: Past batch evidence must not be edited; this is a read-only check. transcript-query.js unchanged since 10/4.
