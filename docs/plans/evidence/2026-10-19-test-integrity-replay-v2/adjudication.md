# BL-0060 check-test-integrity 第二次回放裁定（規則改後）

## 方法
- 規則版本：hands/bl0060b/1（commit 29b7e7f04）。回放：`scripts/replay-test-integrity.js --count 70`（HEAD 比 a007fa65e 多 10 個 merge），過濾成與第一次完全相同的 60 個 merge（`git rev-list --first-parent --merges -60 a007fa65e`）。mode=warn，沒有 errors。
- 母體：668 筆（`deleted_line` 655、`surface_touch` 13），有 violation 的 range 11 個（舊：1101 筆，40 個）。筆數減少 433 筆（-39%），range 減少 29 個。
- 抽樣：668 筆超過 150，照第一次的 seed 20261019 做洗牌取 150（`sample-v2.js`）。樣本裡 143 筆來自同一個檔（見下），代表性很低，所以另外對全部 16 個 (merge, file) 群組逐一判定（群組口徑等於全母體普查）。
- 判定方式：逐筆對照 `git diff <merge>^1 <merge> -- <file>`。判 TP 的標準：這個變更削弱或規避了測試（斷言變少、改永真、skip、測試被刪但被測物還在而且沒有替代）。誠實的維護即 FP。

## 舊樣本 150 筆在新規則下的狀態（`carryover.txt`）
- 仍被報：同 (merge, file, kind) 的群組層 91 筆；連 detail 行文字都相同的 85 筆。
- 不再被報：59 筆（群組層）。

## 新樣本逐群組裁定
| 群組 | 樣本筆數 | 母體筆數 | 類型 | 裁定 | 理由 |
|---|---|---|---|---|---|
| 16dd391e `dispatch-hetero-gc.test.sh` | 143 | 647 | deleted_line | FP | 整支測試刪除，因為被測的 `dispatch-hetero.sh --gc` 功能被移除（BL-0115，dispatch-hetero.sh 刪了 6 行 --gc 相關）。腳本本身還在，所以規則 (a) 的「目標也被刪」不成立。 |
| 16dd391e `resolve-worktree-teardown.test.sh` | 2 | 7 | deleted_line | FP | `stale_reaper_age_days` 設定鍵被移除，相關斷言隨之移除，改為 assert_not_contains 驗證鍵不再輸出。 |
| 0be6405d `task-status-input.test.sh` | 1 | 1 | deleted_line | FP | `node ... \|\| fail` 改成 `if ! node ...; then exit 1`，更嚴格（失敗直接結束）；舊行屬判斷類、新行不是，所以淨值仍判減少。 |
| 0be6405d `lib/task-status-input-fixture.js` | 1 | 1 | surface_touch | FP | 修改既有 fixture 加一個 preEffectAdmit 與更詳細的錯誤訊息，沒有削弱任何檢查。 |
| 0be6405d `hooks/tests/lib.sh` | 1 | 1 | surface_touch | FP | 新增 `require_under_test_tmp` 防呆 helper，只加不減。 |
| 749c224f `hooks/tests/lib.sh` | 1 | 1 | surface_touch | FP | 加兩個 export，讓 hook 測試不碰網路與真實 cache，只加不減。 |
| 07238277 `hooks/tests/lib.sh` | 0 | 1 | surface_touch | FP | 加一個 export，讓測試不寫真實 foreman log，只加不減。 |
| 6ed65d18 `lib/dispatch-review-fixtures.sh` | 0 | 1 | surface_touch | FP | stub 新增 kimi 檔案分段讀取，只加不減。 |
| 9883b639 `lib/dispatch-review-fixtures.sh` | 0 | 1 | surface_touch | FP | 新增 opencode stub，只加不減。 |
| 6e92b769 `lib/review-candidate-driver.js` | 0 | 1 | surface_touch | FP | 新增讀回輪次紀錄的欄位，只加不減。 |
| 2210b470 `lib/review-candidate-driver.js` | 0 | 1 | surface_touch | FP | 新增 multi 情境與 packet 擷取；被改的三行是參數化，非削弱。 |
| 6e92b769 `lib/review-candidate-stub-review.sh` | 0 | 1 | surface_touch | FP | stub 新增 resolve 判決，只加不減。 |
| 2210b470 `lib/review-candidate-stub-review.sh` | 1 | 1 | surface_touch | FP | stub 新增 packet 目錄輸出，只加不減。 |
| f682db55 `lib/subagent-budget-fixture.js` | 0 | 1 | surface_touch | FP | fixture 新增 parent／depth 欄位，舊用法行為不變。 |
| a8dac5e6 `t7-config-rename/repo/tests/tool.test.js` | 0 | 1 | surface_touch | FP | 範例測試改寫到暫存目錄，斷言完整保留在 try 區塊（BL-0122），與第一次判定相同。 |
| 6fcfed4b `.github/workflows/test.yml` | 0 | 1 | surface_touch | TP（邊界） | 整個 CI workflow 被刪（BL-0094 owner 決定移除 GitHub CI）。刪除 CI 正是 surface 規則該請人看的變更；有明確授權，但閘門本來就要求 waiver，所以不算誤報。 |

## 統計
| 口徑 | 判定數 | TP | FP | FP 率 | Wilson 95% 區間 |
|---|---|---|---|---|---|
| 樣本 150 筆（seed 20261019） | 150 | 0 | 150 | 100% | 97.5% – 100% |
| 全部 16 個群組（普查） | 16 | 1 | 15 | 93.8% | 71.7% – 98.9% |
| 全母體 668 筆 | 668 | 1 | 667 | 99.9% | （筆數口徑被單一群組主導，不建議引用） |

舊（第一次）：150/150 FP，100%。新規則把筆數降 39%、range 降 73%（40 到 11），但 FP 率仍遠高於 5%。

## 結論：不符合 owner 門檻（FP 率需低於 5%）
**不建議翻成 block；mode 維持 warn，本輪未改。**

### 剩下的 FP 分三類
1. 測試因「被測的功能／旗標／設定鍵被移除」而整支或部分刪除，但被測腳本還在（647+7 筆，占 98%）。規則 (a) 只認「目標檔也被刪」，認不出功能層級的移除。這同時是規則 (a) 與負向對照 N4「刪測試但目標還在」必須共存的天然邊界。
2. 對共用 helper／fixture／stub 的「只加不減」修改被算成 surface_touch（12 筆，母體 13 筆中的 12 筆）。規則 (c) 只排除新增檔，不排除只加行的修改。
3. 改寫後的新行不屬斷言類（`|| fail` 換成 `if ! ...; then exit 1`），淨值判減少（1 筆）。

### 下一步建議
- surface_touch：只在該修改含「刪除或改寫既有行」時才報；純加行的 helper／stub／fixture 修改不報。刪除 surface 檔（例如 CI workflow）仍報。預期可去掉 12/13 筆。
- 類別 1：對整檔刪除的測試，改為「同 range 有新增或修改的測試檔提到被刪測試的主題（檔名 stem 相同的替代測試，例如 `dispatch-hetero-gc-removed.test.sh`），或 commit／plan 引用的 BACKLOG 編號」才豁免，並保留 N4（沒有替代也沒有目標被刪才報）。或承認這類必須走 waiver 流程，把 block 限定在 `deleted_line` 之外的類型。
- 類別 3：斷言類定義加入 `if ! cmd; then ...exit` 與 `|| exit` 形式。
- 改完後用同一個 seed 與同一組 60 merge 再回放一次，仍要全逐筆判定，再討論翻 block。
