---
id: 01M7GS6QZT52HESWGJ7PFAYCQM
kind: issue
created: 2026-11-15T23:38:14.394Z
---
- **Since**: 2026-11-16
- **Report**: 01M7GQEK
- **Reply**: none
- **Problem**: band 發布工作階段編號時，只替換點與兩種斜線；codeforge 則把英數、底線與連字號以外的每個字元都替換。同一編號會得到兩個不同結果。
- **Impact**: 兩邊記不成同一個工作階段，跨專案對帳與共用測試會對不上。
- **Trigger**: ready
- **Source**: autopilot lane 2026-11-16 (fleet 01M7GQEK)
- **Pointer**: none
- **Context**: mods/live/register.ts replaces only . / \ in band-facts. codeforge live::sanitize_session_id replaces chars outside [A-Za-z0-9_-]. Vectors: codeforge tests/fixtures/session-id-vectors.json. Report the codeforge sha after aligning.
