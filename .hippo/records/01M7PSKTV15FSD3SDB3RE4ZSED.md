---
id: 01M7PSKTV15FSD3SDB3RE4ZSED
kind: issue
created: 2026-11-18T07:40:49.889Z
---
- **Since**: 2026-11-14
- **Report**: fleet 01M7DKWKB6 (PM, 2026-11-14)
- **Reply**: unknown
- **Problem**: role-kit 檢查的第一部分（A9 靜態規則）已經合併，但第二部分尚未實作：需要用合成的停止掛鉤重放測資來驗證角色套件行為，目前還在等新版停止掛鉤合入主線。
- **Impact**: 角色套件在真實停止掛鉤流程下的退步無法靠重放測資自動攔截。
- **Trigger**: Stop-hook v2 進 develop
- **Source**: PM 01M7DKWK sub-item 2 (D13), fleet task 01M7DM1FHVSJGKNMSZ25F2XRP2
- **Pointer**: project/backlog/pm-01m7dkwk-subitems.md
- **Context**: Part 1 (A9 lint) merged at 717f85ef2 (scripts/lib/role-kit.js). Part 2 adds synthetic Stop-hook replay fixtures.
