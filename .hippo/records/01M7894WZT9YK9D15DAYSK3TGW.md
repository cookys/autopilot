---
id: 01M7894WZT9YK9D15DAYSK3TGW
kind: issue
created: 2026-11-06T00:00:00.000Z
---
- **Since**: 2026-11-06
- **Problem**: plan-review-roster-admission 與 runner-binary 在負載高時紅；foreman-eval-sandbox 在 11/6 全套平行時紅。單獨跑都是綠；review-server 另列為 BL-0425。
- **Impact**: 全套平行時出現假紅，真壞掉會被當成雜訊放過。
- **Trigger**: next full-suite run, or the next touch of these suites
- **Source**: full-suite runs 2026-11-06
- **Pointer**: project/backlog/flaky-under-load-suites.md
