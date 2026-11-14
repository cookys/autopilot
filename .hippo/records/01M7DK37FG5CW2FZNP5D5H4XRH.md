---
id: 01M7DK37FG5CW2FZNP5D5H4XRH
kind: issue
created: 2026-11-13T00:00:00.000Z
---
- **Since**: 2026-11-13
- **Problem**: 新的工作複本一開始就是任務強制模式，異質派工因此過不了前置條件，要先改治理檔。把那個改動暫存起來會悄悄把強制模式又打開。
- **Impact**: 新複本不能直接派工；暫存治理檔改動後，強制模式在不知情下恢復。
- **Trigger**: ready
- **Source**: autopilot lane（PM 01M78BH1）
- **Pointer**: none
- **Context**: Precondition: Mission enforce mode requires a sealed campaign strict projection. Stashing the governance-file change re-enables enforce.
