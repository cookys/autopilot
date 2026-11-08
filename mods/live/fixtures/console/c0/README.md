# `fleet.console/1` fixture（C0）

契約：`plans/2026-11-08-operator-console-tux.md` §4.1。全部是虛構資料：主機、seat、帳號別名都是假名（`fx-*`、`pool-*`）。時間固定在 `NOW = 1794200000000`（ms）。測試要用這個時鐘，不要用真時間。產生器在 PM 的 scratchpad（`console/genfx.py`），它會自檢：title ≤ 20 字、規則句裡的每個整數都在 `facts` 裡、`id` 不重複、`severity` 已排序。

| 檔案 | 測什麼 |
|---|---|
| `console-full.json` | 一般情況。`items` 涵蓋四種 kind（card、exception、hint、quota）與四種 state（need_you、failed、stalled、findings）；`needs_operator` 和 `to_console` 各有 true／false；卡片有四種狀態（open、awaiting_operator_action、waiting_step → `answerable_by: ["report"]`、relayed_unconfirmed）；T1–T7 都有一則，T7 是別台 session 自己開的卡（`needs_operator = false`，不進決策佇列）；有「未歸線」；額度有池層 ✗（`run_out`）、5h △、會浪費、暖機（`projected = null`）、stale、expired、no_source |
| `console-empty.json` | 沒有資料但來源都正常：計數為 0，`brief` 是「沒有待決，沒有例外。」 |
| `console-stale.json` | 來源的舊、過期與無來源：`tasks`／`stuck`／`goals`／`quota_now` 舊，`peers`／`hosts`／`card_mirror` 過期，`quota_forecast`／`slots`／`metrics` 無來源；`hosts` 是空陣列，但前端要畫「過期」，不能畫成「沒有主機」 |
| `console-since.json` | `--since` 的 `changes`：opened、answered、closed、raised、cleared、state |
| `console-filtered-line-gpu.json` | `--line gpu`：`items`／`lines`／`hosts`／`cards` 縮小，`counts` 和 `brief` 維持全程式的值 |
| `codeforge-fleet-quota-source.json` | `codeforge.fleet-quota/1` 的來源檔；`console-full.json` 的 `quota.accounts` 和它的 `accounts` 逐欄相同（不重算） |
| `stream.sse` | `/console/stream` 的兩筆 `changed` 事件 |

**洩漏紅燈**：`console-full.json` 的 `lines[0].lead` 是原始 member address（`fx-ns/fx-courier-a/leak-probe--claude`），`hosts[0].host_key` 是一個 IP 形狀的字串。任何前端的畫面輸出都不得出現這兩個值；畫 lead 要用 `lead_display`，畫主機要用 `label`。這個 IP 是 RFC 5737 的文件用位址；檔案裡刻意寫成 `\u` 跳脫，因為 pm 的 commit 規則禁止原文出現 IPv4 樣式，JSON 解析後就是 IP 字串。
