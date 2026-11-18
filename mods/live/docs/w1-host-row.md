# W1：正文列與 host 外框的歸屬

使用指定的 Claude Code 2.1.327 真實執行檔檢查 host Pane 實作；擷取的位元組位置、SHA-256 與原始片段在 [`w1-host.log`](../evidence/pane-r3a/w1-host.log)。這是已安裝 host 程式的靜態實作證據，並非終端截圖。

Host 的 `Ofe` 以 `wo=Math.max(0,je-Hj(po,co))` 算正文預算，再傳入 `scroll:{offset:0,bodyRows:wo}`；`placement:Ze?"dock":"inline"`。正文容器有 `maxHeight:wo,overflowY:"hidden"`；inline 外層另畫 `borderStyle:co?"round":void 0`，其中 `co=!Ze`。因此 host 的 inline 底邊框在 mod 的正文視窗之外；mod 無法把自己的分頁列畫到那條邊框上。

Mod 路徑：[`register.ts`](../register.ts) 的 Pane render 使用 `frameHeight(e.props.scroll?.bodyRows ?? 24, e.props.placement)` 傳給 `Pane`；[`pages/frame.ts`](../pages/frame.ts) 的 `frameRows` 回傳正文預算列數，分頁列在最後；[`pane.tsx`](../pane.tsx) 的 `framedView` 用相同高度，焦點 anchor 與最後一列共列。

本次確實找到 mod 可控制的多餘空白：舊 `frameHeight` 將 inline 再截成 24 列。W1 紅測試在 host 配給 25 列時收到 24；修正為完整使用 host 正文預算後變綠。測試涵蓋 160×40 dock 的 34 列與 120×30 inline 的 25 列，直接檢查正式 Pane 的列數與最後一列分頁按鈕；這些是注入的 host 配給案例，沒有宣稱已量到評審截圖的 host props。舊有 mounted dock／inline 測試也改驗完整配給。

驗證命令：

```sh
AUTOPILOT_MODS_REAL_CLAUDE=$HOME/.local/share/claude/versions/2.1.327 \
  bash mods/live/evidence/pane-r3a/targeted.sh \
  mods/live/pages/ux-gate3-frame.test.ts mods/live/chrome.test.ts mods/live/gate2.test.ts
```

`w1-red.log`：exit 1；`w1-green.log`、`w1-regression.log`：exit 0。結論限於 mod 分頁列已用滿 host 正文配給；host 的外框列保留。未在這個工作樹重現原評審的終端截圖，因此不能僅憑絕對第 35／25 列斷言該列就是正文或底邊框。

## R4-5：真機 host props opt-in 探針

在啟動實際 Claude Code session 前，先建立可寫入的目錄，並將探針路徑與啟動命令放在同一次 shell invocation：

```sh
mkdir -p /tmp/pane-r4
AUTOPILOT_MODS_PANE_PROBE=/tmp/pane-r4/host-pane.jsonl \
  "$HOME/.local/share/claude/versions/2.1.327"
```

此 session 必須載入包含 R4-5 的 live mod。開啟 Pane，調整到要核對的終端尺寸與分頁，再擷取畫面。每次 Pane render 都會在該檔案追加一筆 JSON；`tail -n 1 /tmp/pane-r4/host-pane.jsonl` 可讀取最近一次。未設定環境變數或設成空字串時，探針不會讀取、建立或寫入任何檔案。目錄須事先存在；探針寫入失敗不會中斷 Pane。

欄位：`ts` 是 render 時的毫秒時間戳；`placement` 與 `bodyRows` 直接讀取 `e.props.placement`、`e.props.scroll?.bodyRows`；`termCols`、`termRows` 來自同一事件的 viewport。缺少的 host 欄位記為 `null`，不以預設正文預算冒充。`renderedRows` 計算 mod 回傳的正文列；`lastRowHasTabs` 檢查回傳最後一列是否含分頁按鈕。探針以 host 提供的 read/write API 在同一 mod instance 內依序追加；各 session 應使用不同路徑，避免跨程序覆寫。

核對截圖時，先找同一時間、同一終端尺寸與 placement 的紀錄；從 Pane 正文第一列開始數 `bodyRows` 列，最後一列應與分頁列對齊。若 `renderedRows < bodyRows` 或 `lastRowHasTabs` 為 false，應追查 mod 回傳內容；若兩者符合，仍須標出截圖的正文起訖與 host 外框，才能判定可見空列屬於正文還是外框。`placement: dock` 不適用上方 inline 底框的解釋。

以上是量測操作方式與注入 host props 的測試契約。本輪尚未取得真實 session 與評審截圖配對的紀錄，不能據此宣稱第 35／25 列空白已獲解釋或豁免。
