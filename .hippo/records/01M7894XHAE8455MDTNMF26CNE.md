---
id: 01M7894XHAE8455MDTNMF26CNE
kind: issue
created: 2026-11-04T00:00:00.000Z
---
- **Since**: 2026-11-04
- **Problem**: 還不知道真實 dispatch 下 json 與 stream-json 兩種輸出格式的 result 位元組是否一致；這是 G40 agent lane 被動觀測的前提。要用真實 dispatch 量測，PM 目前停車中。
- **Impact**: 前提沒確認就做被動觀測，兩種格式若不一致，觀測到的結果會對不上。
- **Trigger**: 3.0.0 之後；Tasks 0-3 已於 05a70bf82 合併；Tasks 4-5（約 70 次 haiku 呼叫）等已註冊的 alias（d-74c79fc4（已完成，2026-11-11；接手 d-2a19fdb5））；兩層都 PASS 才切 G40 P2 旗標；PM 追蹤 bl-ap-sj45
- **Source**: PM 2026-11-04 ordering message
- **Pointer**: project/backlog/bl-ap-streamjson-result-bytes.md
