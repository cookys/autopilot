---
id: 01M80CQ7C58ZD80ZNCX0HX09HS
kind: issue
created: 2026-11-22T01:07:53.861Z
---
- **Since**: 2026-11-22
- **Report**: 01M8064F
- **Reply**: none
- **Problem**: 為了共享記憶，glm 席位的工作目錄要指到主複本，這樣席位就可能誤在正式複本上切分支。建議加一道鉤子，對 glm 席位拒絕在主複本上切分支與清庫動作。
- **Impact**: 一旦誤切，host 所 pin 的正式版本會被動到，影響所有讀主複本的流程。
- **Trigger**: 下次修改 glm 席位目錄政策或主複本保護時
- **Source**: PEER-REPORTED hangar 2026-11-22
- **Pointer**: none
