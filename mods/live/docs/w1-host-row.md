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
