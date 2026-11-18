---
id: 01M7Q4ER1Y04HHPKM26KH6FS5T
kind: issue
created: 2026-11-18T10:50:17.534Z
---
- **Since**: 2026-11-18
- **Report**: fleet 01M7Q37HXRN6C966R0RFSFQJRR (PM, 2026-11-18)
- **Reply**: unknown
- **Problem**: 要知道 grok 週池重置了沒，現在只能送一件真的請求看會不會回 402；沒有只讀的用量查詢。
- **Impact**: 每次量額度都要花一次真請求，池滿時還會多記一次失敗；capacity 的讀數只能等有人派工才更新。
- **Trigger**: ready
- **Source**: PM 01M7Q37H（capacity 工單 01M7Q34V）
- **Pointer**: none
- **Context**: Add a read-only grok usage-probe (no model request) feeding capacity's reading, same shape as the other quota adapters; until then the 11-19 11:45 Taipei reset check uses one minimal dispatch-author grok request.
