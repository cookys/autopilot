# X2b：現況短頁面的嚴重度列分配

任務：`01M7PC93PGG8FQ28EMT6ZDP7NY`。比較基準：`6528a8a86ebef36862e6100d553038ed534db70b`。

## 1. 任務與驗收條件

修正現況頁在可用內容僅有一、兩列時，嚴重異常被一般待決或殘留資訊擠出的順序。驗收條件：

- 80×20 的兩列內容：最嚴重類別在前，其後為包含類別及嚴重度計數的溢出摘要。
- 80×16 的單列內容：以嚴重狀態開頭，保留艦隊、額度的嚴重度計數、最嚴重額度池名稱及「另有 N 項」。
- 其他失敗異常也參與排序；失敗優先於卡住，卡住優先於未知；其他異常不可誤算為艦隊。
- 殘留資訊不佔用上述受限內容列；既有導覽列仍提供殘留分頁。
- 新增的三個 `X2b:` 測試全數通過；完整指定檢查的 `(fail) ` 列不超過 15；UI lint 通過。既有測試不刪除、不弱化。

幾何範圍：正式 `register.ts` 使用主機提供的 `scroll.bodyRows`，經 `frameHeight` 傳入 `Pane`。測試採用回報量測所對應的主機配置：80×20 為 4 列 frame、80×16 為 3 列 frame，扣除標頭及導覽列後為 2／1 內容列。測試直接呼叫正式 `Pane`；未重算或驗證外部主機的 terminal → bodyRows 配置演算法。

## 2. 定位與原始修改點

`pages/now.ts` 原先先放待決，再放艦隊、額度；溢出時直接保留陣列前段。原始關鍵行：

```ts
if (pRow !== null) entries.push({ rows: pNoTruncate ? wrapRow(pRow, size.cols, WRAP_HANG) : [truncateSegs(pRow, size.cols)], count: 1 })
if (fleet.entry !== null) fleet.entry.summary = severitySummary(t('tab.fleet'), exceptionRows(ctx, con, wide))
for (const r of extraRows) entries.push({ rows: [r], count: 1 })
const budget = room - 1
```

單列分支原本使用下行作為整列，導致「另有 N 項」而非嚴重狀態在前：

```ts
const summary = moreItems(ctx, entries.reduce((n, e) => n + e.count, 0) + extraCount, summaries)
```

只更新兩個既有精確斷言以符合新順序，均保留精確比對並註記 `X2b`：`pages/now.test.ts` 原值 `另有 6 項（額度 ✗2 F 池 · 待決 1 · 艦隊 ✗2 ⊘1）`；`gate3.test.ts` 原值 `另有 4 項（額度 ✗1 ?1 trinity · 艦隊 ✗1）`。

## 3–4. 逐項 RED → 修正 → 驗證

所有完整驗證使用同一命令；`REAL_CLAUDE` 表示呼叫端指定的真實 Claude 絕對路徑：

```sh
AUTOPILOT_MODS_REAL_CLAUDE="$REAL_CLAUDE" bash mods/live/run-tests.sh < /dev/null
```

| 證據檔案 | exit | pass / fail | 結果 |
|---|---:|---:|---|
| `red.log`、`red.exit` | 1 | 1538 / 17 | 先新增兩個指定尺寸的 `X2b:` 測試，兩者皆 RED |
| `two-rows.log`、`two-rows.exit` | 1 | 1539 / 16 | 僅修正受限多列排序；80×20 GREEN，80×16 仍 RED |
| `single-row.log`、`single-row.exit` | 1 | 1539 / 16 | 單列修正後兩個 `X2b:` 都 GREEN；額外失敗是 gate3 舊順序斷言 |
| `single-row-repaired.log`、`single-row-repaired.exit` | 1 | 1540 / 15 | 僅更新 gate3 舊順序精確斷言後，回到原有 15 個失敗 |
| `extras-red.log`、`extras-red.exit` | 1 | 1540 / 16 | 新增其他失敗異常的嚴重度測試，該測試 RED |
| `extras-green.log`、`extras-green.exit` | 1 | 1541 / 15 | 修正其他異常參與排序及類別歸屬；三個 `X2b:` 全 GREEN |

原始 RED 原因均為實際文字斷言失敗，而非載入或測試環境錯誤：

- 80×20 預期首列 `/^✗ (艦隊|額度)/`，實際 `→ 待決 3 張（最舊 1 分）：繼續嗎`。
- 80×16 預期首列 `/^✗ (艦隊|額度)/`，實際 `另有 14 項（額度 ✗2 ?3 urgent · 待決 1 · 艦隊 ✗2 ⊘4）`。
- 其他異常預期 `✗ 發布失敗`，實際 `? 額度 未知 1（unknown-only）`。

## 5. 最終重跑與證據

| 最終檢查 | 證據檔案 | exit | 結果 |
|---|---|---:|---|
| 上述完整指定命令重跑 | `final.log`、`final.exit` | 1 | 1556 tests / 40 files：1541 pass / 15 fail；三個 `X2b:` 全 PASS；`(fail) ` 列數為 15 |
| `node --test mods/live/ui-lint.test.js` | `lint-final.log`、`lint-final.exit` | 0 | 56 pass / 0 fail |

完整命令本身仍回傳 1；本任務指定的門檻為不超過 15 個失敗且新測試無失敗，最終結果符合此門檻。已移除執行時間後逐一比對首次 RED 排除 `X2b:` 的失敗名稱，最終 15 個失敗與之完全一致。

真實執行檔的版本輸出為 `2.1.327 (Claude Code)`。機械比對收據為同一證據目錄下的 `acceptance.json`，其 `failure_sets_equal` 與 `threshold_pass` 均為 `true`。為保留基準，以下列出完整的 15 個失敗名稱（移除耗時、排序後）：

```text
(fail) C1 U7 control: without the console config the same fetch draws the counts on the band line and still never asks for a second row (terminal)
(fail) C1 U7: console mode: an alive forge-stats with summary_row is never asked for the second row (next(e) 0 calls) and the band row carries the console tab names (terminal)
(fail) G33a: a stale, foreign, unreadable or oversized heartbeat does not stop the fetch, and the band stays one row (terminal)
(fail) G33a: the feed runs with no summary_row heartbeat, and before any run the band has no fleet counts; the reader is never asked (terminal)
(fail) G33a: the tick publishes `autopilot.fleet` and the band draws those counts on its own line; the reader beneath is never asked for a second row (terminal)
(fail) speed tab: a maxRows that is NaN or missing draws no label and asks nothing; the survey is passed down untouched (desktop)
(fail) speed tab: a maxRows that is NaN or missing draws no label and asks nothing; the survey is passed down untouched (terminal)
(fail) speed tab: a timed request draws the label on the left after the ⓘ (ours, ϟ N tok/s and a trend from two requests) and the strip gets one short last tab, a Button keyed forge (desktop)
(fail) speed tab: a timed request draws the label on the left after the ⓘ (ours, ϟ N tok/s and a trend from two requests) and the strip gets one short last tab, a Button keyed forge (terminal)
(fail) speed tab: opened, the ━ stands under the forge tab and the speed view is drawn under the rule: the speed column, the recent-requests table and the mod below beside them (desktop)
(fail) speed tab: opened, the ━ stands under the forge tab and the speed view is drawn under the rule: the speed column, the recent-requests table and the mod below beside them (terminal)
(fail) speed tab: pressing it again closes it, and the speed view is gone (desktop)
(fail) speed tab: pressing it again closes it, and the speed view is gone (terminal)
(fail) speed tab: scroll.bodyRows follows maxRows and never goes below 0; a scroll that was not there stays absent (desktop)
(fail) speed tab: scroll.bodyRows follows maxRows and never goes below 0; a scroll that was not there stays absent (terminal)
```

原始 log 與 exit 檔位於本工作樹的 `mods/live/node_modules/x2b-evidence/`，屬忽略的本機證據，未加入提交。下列 SHA-256 綁定已完成的原始 log：

| log | SHA-256 |
|---|---|
| `red.log` | `7313cdad1083a1a3388e3bf5a3b386e28796f6cb229e4ffd86edca920cb5f809` |
| `two-rows.log` | `a359b9ad4f6c877bbdb3319db1efa2ab281a8cda1fa7e3bc0409e660905c4039` |
| `single-row.log` | `11ee8b3a476175407205523434ce4cc8a8add217c5aa7e8279fa95d8e01a6230` |
| `single-row-repaired.log` | `1f2610d13f014fa5ac78db7788cadc983c3ac0fc41ebe035f7b13cb1ce6390bb` |
| `extras-red.log` | `f022f883cf609774b18537f21bc60143ff1bb12a4256a10ee68831ff8da3fbf9` |
| `extras-green.log` | `e8ec1e8ead3d5b2d29f01588df292c297d29736e39ee764fb2d2a7f42efa16fa` |
| `final.log` | `c2045fd1a740dd3a465a09ab0262a1d34ee35d000277a32a114282c337113788` |
| `lint-final.log` | `855de7a0b754e934fdd189a350a583397cdc4da878f5c19f7a14c47a0051c245` |

修改檔案及理由，每檔一行：

- `mods/live/pages/now.ts`：依嚴重度分配受限列，保留單列溢出計數與額度池，並正確歸屬其他異常。
- `mods/live/pages/ux-gate2-share.test.ts`：新增正式 Pane 路徑的兩個尺寸 RED 測試與其他失敗異常優先順序測試。
- `mods/live/pages/now.test.ts`：僅更新單列摘要的舊順序精確斷言，註記 `X2b`。
- `mods/live/gate3.test.ts`：僅更新另一處單列摘要的舊順序精確斷言，註記 `X2b`。
- `mods/live/x2b-evidence.md`：記錄驗收條件、逐項紅綠驗證、退出碼與原始證據雜湊。

未做／範圍外：未修正原有 15 個失敗（G33a 3 個、C1 U7 2 個、speed tab 10 個）；它們在首次 RED、`extras-green` 與最終重跑的名稱集合相同。未修改 `mods/live/` 以外檔案，未 push 或 merge。跨模型家族的獨立審查由呼叫端另行執行，本收據不聲稱已通過該審查。
