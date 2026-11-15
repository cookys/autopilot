---
id: 01M7DK38BXBC2S1WER4435AYP1
kind: issue
created: 2026-11-13T00:00:00.000Z
---
- **Since**: 2026-11-13
- **Problem**: 配速選擇對每一個角色都發出審查排除條件，而不是只對實作角色發。
- **Impact**: 非實作角色被多餘的排除條件綁住，選出的配置不符預期。
- **Trigger**: ready
- **Source**: autopilot lane 2026-11-13
- **Pointer**: none
- **Context**: scripts/pace-select.js emits reviewer_exclude for every role; restrict to implementer.
