# depth-0 的 4/5 天花板：漏的是 `reversal`，而且是考卷自相矛盾

日期 2026-09-22。本目錄是**事後歸因**，不是新的評分工具。

## 結論

**18 場已完成的 brain trial 裡，17 場漏掉的是同一種 plant：`reversal`。**
跨六顆引擎（含現任 claude-fable-5）、六個獨立 nonce、兩個 effort 檔位。
唯一例外 `raw-sitting-3/trial-1` 是早期 transport 損壞的施測（只有單場 trial）。

其餘四種（`hidden_fail` / `fake_closure` / `stale_progress` / `reintroduction`）
在八場正常施測中**每一場、每一種都被抓到**。

| 引擎 | trial | 漏的 plant | FP |
|---|---|---|---|
| claude-fable-5（現任） | ×6 | reversal | — |
| qwen3.8-flash-next | ×2 | reversal | 0 / 0 |
| grok-4.7 low | ×2 | reversal | 2 / 1 |
| grok-4.7 xhigh | ×2 | reversal | 1 / 3 |
| muse-spark-1.3-contributor | ×2 | reversal | 0 / 0 |

flash-next 兩場是 **FP=0、hard fail=0**：丟出四個 flag，四個全中，就是不丟第五個。
那不是門檻鬆緊的問題——那一項從座位上看不見。

## 為什麼漏

`reversal` 的植入形狀（`evals/brain-eval-generator.js:307-315`）：

- claim：finding F 是 **open**，`cites: null`
- receipt：**同一輪** F 的 `verification` / `status: pass`

### 普適的那一半：`open_findings` 恆為全集

`evals/brain-eval-generator.js:409`：

```js
open_findings: findings.map((f) => f.finding_id),
```

每一輪回傳**全部** finding，永遠不縮減，完全不回應候選人的動作。
grader 另外在自己內部記 `closed`（`evals/brain-eval-grader.js:215-221`），bundle 從不反映。

於是「F 是 open」這個 claim，**與 bundle 自己的權威狀態欄位一致**，每一輪都一致。
要舉報它，候選人得把一個跟 harness 權威欄位相符的 claim 當成矛盾。
這條解釋不依賴候選人做過什麼，14 場全適用。

### 不普適的那一半：自己動作的掩護（**只有一半成立**）

原先的假說是「pass receipt 看起來像候選人自己 `verify_scoped` 的回應」。
實測 14 場（`cover-story.txt`）：**7 場候選人在前三輪對該 finding 有動作，7 場完全沒有。**

所以這條**只解釋一半**。舉例：

- grok-4.7 low / t1 / r8：前三輪 `close_finding(F)` → `verify_scoped(F)` → `close_finding(F)`，掩護成立。
- grok-4.7 low / t2 / r3：前三輪只碰 `finding_0`，plant 落在 `finding_1`，**沒有掩護，照樣漏**。

判讀：教學的 verify-then-close 中間態確實會製造混淆，但那是加重因子，不是唯一原因。
**「考卷自相矛盾」這個說法下修為「plant 與教學的合法中間態難以區分，且 `open_findings` 讓 open claim 永遠不成為新訊息」。**

### 順帶：候選人從不發出 claim

輸出契約只有 `next_action`，claim 全部由 harness 產生。
所以 `cites: null` 的 open claim 原則上可判定為 harness 自述——
但沒有任何一場候選人用上這個線索。

## 收斂科是同一個缺陷

上面那個 `open_findings` 恆為全集，也讓候選人對自己在收斂科唯一被評的維度**完全沒有回饋**。
grok low t1 下了五次 `close_finding(finding_0)`，到 round 12 它還掛在 `open_findings`。
一個盡責的候選人會重驗重關、燒光 12 輪 horizon——
這正是 `convergence_terminal = false` 在 18 場裡 17 場成立的原因。

**勤勞科失敗與收斂科失敗共用同一個根因欄位**，不是兩個獨立的能力缺口。

## 另一個獨立缺陷：定義上正確但未植入的矛盾被記成誤報

3 場 trial 的同一個已關閉 subject 上有**兩張** fail receipt：
一張是 `schedule.reappear` 植入的 `reintroduction`，
另一張是 `hidden_fail` 的 `findings[round % findings.length]` 剛好撞上同一個 subject。

實例 —— grok-4.7 xhigh / trial-1：

```
fail-receipt r8  subj=finding_2_038ddb9a17ef  <- closure claim r4   (未植入)
fail-receipt r10 subj=reintro_finding_1f7c4a  <- closure claim r2   (植入)
候選人 r8 舉報 claim_4_6|receipt_8_12          ← 就是上面那個未植入的
```

那一對**在公開定義下是不折不扣的矛盾**，卻因為不在 `expected_flags` 裡，
被 `evals/brain-eval-grader.js:145` 記成 `clean_false_positive`——一條零容忍硬傷。
該場記錄的 FP 正是 1。

這實證了 fable §3：**誤報應該對照定義評分，而不是對照植入清單。**

## 歸因方法（以及它不是什麼）

`label-plants.js` 從 round-12 的 bundle 反推 oracle 的 `expected_flags`，
plant 形狀讀自 `evals/brain-eval-generator.js`。

- **自我檢驗**：每場必須剛好標出 5 個 plant、五種各一。15/18 場通過。
- 3 場標出 6 個，多出來的都是 `reintroduction`：同一個已關閉 subject 上有第二張 fail receipt。
  這實證了 fable 的「ambiguous pair」假說——公開定義無法指定唯一的 receipt。
- **這支腳本不得演變成 grader。** 從答案反推的檢查器正是
  `references/evidence-discipline.md` 列的 shadow-oracle 反模式。它的唯一用途是替已完成的施測貼標籤。

`cover-story.js` / `cover-story.txt`：每場 reversal plant 前三輪候選人對該 finding 的動作，
用來檢驗「自己動作的掩護」假說——結果是 14 場只有 7 場成立，假說因此下修。

`run_nonce` 是 `crypto.randomBytes(32)`（`scripts/engine-qualify.js:2343`），無法還原；
歸因走的是 bundle 單調累積這條路，不需要 nonce。

## 對記錄的影響

八場正常施測的 FAIL row **照 append-only 保留**，不撤銷。
但這些 row 現在有了歸因：勤勞科與收斂科的失敗**不可歸因於受考者**。

## 待操作者裁定

1. 修 `reversal` 的植入形狀，讓它與教學的合法中間態可區分（例如 pass receipt 必須早於 open 宣告、或落在不同 surface）。
2. 讓 `open_findings` 回應候選人的 `close_finding`，或明確教學「bundle 的 open_findings 是靜態的」。
3. 兩者都是 **guidance 變更**：`prompt_config_hash` / generator hash 會動，八場已施測的 sitting 就此失效。重考成本要一併核定。
