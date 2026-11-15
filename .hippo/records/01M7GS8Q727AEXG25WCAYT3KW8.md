---
id: 01M7GS8Q727AEXG25WCAYT3KW8
kind: issue
created: 2026-11-15T23:39:19.138Z
---
- **Since**: 2026-11-16
- **Problem**: 執行長技能的開卡範例少了必填的分類。從函式庫開卡的提問與權限阻擋也沒帶分類，統計會把它們算成未分類。改那個範例要重釘設定檔雜湊。
- **Impact**: 照範例開卡會直接失敗；沒分類的卡在統計裡混在一起，看不出種類。
- **Trigger**: ready
- **Source**: autopilot lane 2026-11-16
- **Pointer**: none
- **Context**: skills/ceo-agent/SKILL.md near line 91: open-decision.js open lacks required --category; edit via profiles-hash-repin. ask-decision and permission-block have no category (uncategorized). BL-0320 is the separate DOA gap.
