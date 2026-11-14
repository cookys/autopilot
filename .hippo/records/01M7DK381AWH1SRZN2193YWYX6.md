---
id: 01M7DK381AWH1SRZN2193YWYX6
kind: issue
created: 2026-11-13T00:00:00.000Z
---
- **Since**: 2026-11-13
- **Problem**: 手動指定繞路器的審查派工沒有事前探測，也沒有備援；端點故障時要等約三分鐘才以無結論收場。
- **Impact**: 端點壞掉時每次手動審查都白等三分鐘，結果仍是無結論。
- **Trigger**: ready
- **Source**: autopilot lane（PM 01M79W9B）
- **Pointer**: none
- **Context**: dispatch-review --runner cc-shim --endpoint <X>: no pre-probe, no cloud fallback; qwen down -> ~3 min to no_verdict. Add the roster reviewer's probe + one fallback.
