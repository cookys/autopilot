---
id: 01M7DK6JHM3VWFXFSM0S99MGTP
kind: issue
created: 2026-11-14T17:55:34.068Z
---
- **Since**: 2026-11-14
- **Problem**: dispatch manifest 在用 --endpoint 跑的派工裡把 endpoint 欄位記成 null。
- **Impact**: capacity 無法把非 Claude 池的用量算到對應來源。
- **Trigger**: next touch of dispatch manifest writing, or when capacity needs non-Claude pool attribution
- **Source**: autopilot lane 2026-11-15
- **Pointer**: none
