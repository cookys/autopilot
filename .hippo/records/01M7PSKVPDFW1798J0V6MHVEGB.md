---
id: 01M7PSKVPDFW1798J0V6MHVEGB
kind: issue
created: 2026-11-18T07:40:50.765Z
---
- **Since**: 2026-11-14
- **Report**: fleet 01M7DKWKB6 (PM, 2026-11-14)
- **Reply**: unknown
- **Problem**: 目前的 lead-watch 技能仍以時間作為判斷依據，尚未改用快照事件作為資料來源，也缺少兩列停滯偵測、熱池改道與佇列需求標記，且指引改動需附評測。
- **Impact**: 主管無法從快照即時掌握兩列停滯、熱池改道與排隊需求，仍依賴粗略的時間閾值誤判進度。
- **Trigger**: ready
- **Source**: PM 01M7DKWK sub-item 3 (D14), fleet task 01M7DM1JSMA467YV28Y5FB471W
- **Pointer**: project/backlog/pm-01m7dkwk-subitems.md
- **Context**: skills/lead-watch currently uses elapsed time; migrate data source to snapshot events, add two-row stall, hot-pool reroute, and needs_queue with eval.
