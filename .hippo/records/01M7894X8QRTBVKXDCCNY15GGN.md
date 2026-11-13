---
id: 01M7894X8QRTBVKXDCCNY15GGN
kind: issue
created: 2026-11-06T00:00:00.000Z
---
- **Since**: 2026-11-06
- **Problem**: 這支套件有個 subtest 會在它的 cwd repo 裡提交；GIT_DIR 外洩那一類已修，但是否還有剩下的情況沒有記錄。
- **Impact**: 漏掉的情況會改到外層 repo 的檔案。
- **Trigger**: ready；next touch of dispatch-hetero-account.test.js
- **Source**: gitenv follow-up 2026-11-06
- **Pointer**: project/backlog/flaky-under-load-suites.md
