# PM 01M7DKWK Unstarted Sub-items (BL-0462..BL-0466)

Reported by `pm--claude` (`fleet 01M7DKWKB6 (PM, 2026-11-14)`), registered into `project/backlog/BACKLOG.md` per PM 01M7KG2S so the overdue AR-gate fleet sub-tasks can be closed.

1. **BL-0462 — D9 PM 專用驗證器** (`fleet task 01M7DM1C8S49GM08JYEX2MN07Q`, Effort `M`, Trigger-Type `event`)
   - S4 檢查結尾行並確認快照指令真的跑過；S9 統計抓漏數。
   - 定義在 PM 的 `SYNTHESIS.md` D9 列，需 PM 附上全文後才能動工。

2. **BL-0463 — D13 第二部分：role-kit lint 重放測資** (`fleet task 01M7DM1FHVSJGKNMSZ25F2XRP2`, Effort `S`, Trigger-Type `event`)
   - 用合成的 Stop-hook 重放測資做 role-kit lint。
   - 第一部分 A9 lint 已於 `717f85ef2` 合併（`scripts/lib/role-kit.js`）。
   - Trigger：Stop-hook v2 進 `develop`。

3. **BL-0464 — D14 lead-watch 改版** (`fleet task 01M7DM1JSMA467YV28Y5FB471W`, Effort `M`, Trigger-Type `ready`)
   - 資料來源改為快照事件，加上兩列停滯、熱池改道、`needs_queue`，並附評測。
   - 目前 `skills/lead-watch` 仍以時間判斷。

4. **BL-0465 — 5a 本地模型分流** (`fleet task 01M7DM1SER20CGEHFSNBRWKCPM`, Effort `M`, Trigger-Type `event`)
   - 已有 gateway 允許清單 `9962787d0` 與 qwen canary 文件；可改走本地的四處尚未寫成文件、尚未接上。
   - 限制：AR 對話內容不交 qwen 或任何中國模型（decision card `d-1dfcf757`）。
   - Trigger：qwen 恢復上線。

5. **BL-0466 — 5b+5c ctx-reset W2 掃描重開** (`fleet task 01M7DM1XGAHFBJSG6RBE12R382`, Effort `M`, Trigger-Type `ready`)
   - 長 session 喚醒燒額度、context 快滿時 lane 停下等新 session。
   - `ctx-reset` W1 已合併（`d32f422c3`），W2 計畫已合併於 [`project/plans/2026-11-12-ctx-reset-sweep.md`](../plans/2026-11-12-ctx-reset-sweep.md)，W2 尚未實作。
