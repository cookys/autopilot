# ux-v7.4 實作拆單（PM 01M7N307）

設計稿：`docs/v74/S1.txt`…`S10.txt`（209x49 終端畫面的 band 以下部分）、`diff-notes.txt`（每頁和舊版差在哪）、`fixture.md`（共用示意資料）。
型別與按鍵：`v74/contract.ts`。假資料：`fixtures/v74/{pm-status,pm-status-selector,decide,todo}.json`。
每張子單只改自己的檔案；locales 只改 `locales/en.json` 與 `locales/zh-TW.json`，鍵一律用 `v74.<子單字母>.` 開頭，不要提交重新產生的 `locales.ts`（整合時統一用 `node gen-locales.js` 產生）。

| 子單 | 畫面 | 只改這些檔 |
|---|---|---|
| A | S1 一行 band、收合開關 ▴/▾ 貼在 [-] 左邊 | band.tsx 與 band-*.ts、對應測試 |
| B | 分頁列（下框線下方 `1 現況 … 9 說明`、0 寵物）、下框線提示、按鍵表、說明頁 S10、資料來源接線（PageCtx.v74） | pages/keys.ts、pages/layout.ts、pages/index.ts、pages/frame.ts、新檔 pages/help.ts、register.ts、pane.tsx、v74/feeds.ts |
| C | S2 現況（全艦隊在前、本席在後，推送前檢查與我替你決定的事折進來） | pages/now.ts 與測試 |
| D | S3 待決（三張卡同頁、▸ 選中卡、a/b/c、m 附註、s 送出全部）、S9 待辦 | pages/decide.ts、新檔 pages/todo.ts、decidebatch.ts 與測試 |
| E | S4 派工、S5 審查 | pages/dispatch.ts、pages/review.ts 與測試 |
| F | S6 花費（額度依池併入）、S7 殘留、S8 艦隊（執行中／失敗／已完成三塊） | pages/spend.ts、pages/quota.ts、pages/hygiene.ts、pages/fleet.ts 與測試 |

共同規則：
- 頁面只讀 `ctx.v74`（以及原本就有的 ctx.live / ctx.console）；欄位是 null 代表來源缺，畫既有的 brokenRow，不要捏造列。
- 不顯示金額；用 token 數。
- CJK 寬度用 model.ts 的 displayWidth / truncateToWidth，不要自己算。
- 可點元件：控制區與選中那張卡以外 = 0（設計稿每頁的 regex 自查值見 diff-notes.txt）。
- 測試：`bash mods/live/run-tests.sh` 全綠才交件；新行為要有測試，至少一個反例。
