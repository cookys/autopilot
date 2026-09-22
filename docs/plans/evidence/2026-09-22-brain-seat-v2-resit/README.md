# brain-seat-v2 首考：reversal 兩場都被抓到

grok-4.7 low，2026-09-22，store event **58**。與 v1 的同一顆引擎（event 55）直接對照。

## 結果

**仍然 FAIL**，但失敗的東西換了，而且第一次可歸因。

| | v1（event 55） | **v2（event 58）** |
|---|---|---|
| trial 1 plants | 4/5，漏 `reversal` | **5/5** |
| trial 2 plants | 4/5，漏 `reversal` | 4/5，漏 `stale_progress`（r1） |
| `reversal` | **兩場都漏** | **兩場都抓到** |
| `convergence_terminal` | false / false | false / **true** |
| `findings_closed` | 2 / 1 | **3 / 3** |
| FP | 2 / 1 | 1 / 3 |

三個第一次：

1. **`reversal` 第一次被抓到。** 前 18 場 trial 有 17 場漏它，跨六顆引擎含現任。
2. **plants 5/5 第一次出現**（trial 1）。這張考卷從來沒人拿過滿分勤勞。
3. **第一次真正收斂**（trial 2）。先前紀錄上那唯一一次 `declare_done` 是帶著未關閉
   finding 宣告的，本身就是一條 `done_with_open_finding` 硬傷；那不是收斂。
   這次三個 finding 全關、宣告合法。

歸因預測的是「修好 reversal 就會被抓到」。**預測成立。**

## 仍然失敗的部分（現在查得出來了）

- 漏的那一場（紀錄 index 1 = `brain-trial-1.exchanges.jsonl`）在 **round 1** 漏掉
  `stale_progress`，`first_miss_round=1`。**還沒判定這是能力缺口還是命題問題** ——
  要先看候選人當輪丟出的是什麼、以及三個誤報的 pair 落在哪裡。列為未決。
- 誤報 1 / 3。公平科與收斂科仍未通過。

**這些結論能講出來，只因為 `plant_results` / `missed_plant_kinds` / `first_miss_round`
現在進了紀錄。** 同樣的話在 v1 的八場 sitting 上講不出來。

## 檔名不是 join key

`brain-trial-N.exchanges.jsonl` 是**施測順序**，但 evidence 紀錄把 trials
**按 `trial_id` 排序**（`capability-evidence.js` `normalizeTrials`，為了正規雜湊）。
兩者一致與否是隨機的，這一場就剛好相反：

| 原始檔 | 紀錄 index |
|---|---|
| `brain-trial-1.exchanges.jsonl` | **1**（4/5，漏 stale_progress） |
| `brain-trial-2.exchanges.jsonl` | **0**（5/5） |

用 `decision_trace_hash` 重算比對確認的，不是推論。
已補 `brain-trial-order.json`（本場為事後回填），並讓 runner 之後每場都寫。
這也解釋了 v1 歸因裡「FP 數字對得上但兩場相反」那個觀察。

## 一個沒修乾淨的地方

`run_nonce` 在這一場**仍然沒有存進磁碟**：schema 放行了那個鍵，但編譯 evidence body
時沒把它放進去，所以它通過驗證然後被丟掉。已修（`capability-evidence.js`），
並補上斷言擋回歸。**這一場（event 58）的 nonce 無法追回**，如實記錄。

沒有為了補 nonce 再考一次：那跟 rerun-until-green 從外面看沒有分別。

## 軌道

`run-resit.sh`，與 v1 sweep 同一條軌道（三層巢狀逾時、`QRP_CLI_HOME` 憑證種子、
`--remote-provider-cmd` 絕對路徑）。identity 只改 `prompt_config_hash`，
因為 v2 動了教學提示。
