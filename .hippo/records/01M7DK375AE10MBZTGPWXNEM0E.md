---
id: 01M7DK375AE10MBZTGPWXNEM0E
kind: issue
created: 2026-11-13T00:00:00.000Z
---
- **Since**: 2026-11-13
- **Problem**: 異質派工用 agy 當執行器時，預設列印逾時是九分鐘，會把還在進行的實作回合切斷。今晚有兩回合因此失敗，被記成網路失敗或疑似在提問。
- **Impact**: 實作回合做不完，而且失敗種類記錯，會被當成網路問題。
- **Trigger**: ready
- **Source**: autopilot lane（PM 01M78BH1）
- **Pointer**: none
- **Context**: dispatch-hetero --runner agy. Message: print timeout after 9m0s, labelled network_failed or question_suspected. Proposal: larger default for implementer rounds; classify print_timeout as timeout.
