# Pane batch 2 / UX gate round 3 — W1, W3, V3, V5, U2

Fleet-Task: `01M7PC93PGG8FQ28EMT6ZDP7NY`。基底 `cc9bde3dbcd35e64215bf0befc572036d4430f42`，分支 `fix/pane-r3A`。只修改 `mods/live/`。

## 1. 任務與驗收

修正 pane 配給與分頁列、待決頁操作密度與答題區、收合控制、錯誤 Escape 提示，以及不可答卡重複的補充目的地。每項先寫同 finding id 的紅測試，再修正及重跑；不刪除或略過既有測試。

- W1：分頁列在最後一個 mod 正文列；使用 host 完整配給。host 外框的證據與量測界線另見 `../../docs/w1-host-row.md`。
- W3：操作列合一；送出前沒有撤回；短版保留背景→卡住→可點選項→建議的摘要；長卡可展開／分段／返回；缺資料時畫「卡住 —」，合成 fixture 也有卡住。
- V3：本席卡 z 與 f 共存；兩種卡都能用同一個 z reducer 收合／展開其他卡。
- V5：分頁列沒有「Esc 收起」，沿用 host ✕／band [-]。
- U2：不可答卡沒有補充時畫「補充 —」；回答目的地僅操作列一次。
- 最終 UI lint exit 0；新測試零失敗；完整 suite 的 `(fail) ` 不超過既有 15 個且名稱集合相同。

## 2. 定位與原始行

以下均為基底原始碼的精確行；正文列來自 host `scroll.bodyRows`，經 `register.ts` → `frameHeight` → `Pane` → `frameRows`。host 實作擷取另存 `w1-host.log`。

W1 — `mods/live/pages/frame.ts:32`

```ts
export const frameHeight = (available: number, placement: 'dock' | 'inline' = 'inline'): number => Math.max(0, placement === 'dock' ? available : Math.min(available, FRAME_MAX_ROWS))
```

W3 — `mods/live/pages/decide.ts:357`

```ts
    return [R(picked + ' ' + t('page.decide.act_note_c')), R(t('page.decide.act_send_c') + '  ' + t('page.decide.act_undo_c')), R(navKeys + ' ' + (nav.folded ? fold : t('page.decide.act_fill_c')))]
```

W3 — `mods/live/pages/decide.ts:215`

```ts
  if (d.blocks !== null) out.push(wide ? labelled(t('page.decide.k_blocks'), d.blocks) : [dimSeg(t('page.decide.k_blocks')), seg(' ' + d.blocks)])
```

V3 — `mods/live/pages/decide.ts:350`

```ts
  const fold = nav.folded ? (wide ? t('page.decide.act_fold_open') : t('page.decide.act_fold_open_c')) : wide ? t('page.decide.act_fold_close') : ''
```

V5 — `mods/live/pages/frame.ts:96`

```ts
  const esc = '  Esc ' + ctx.t('frame.close')
```

U2 — `mods/live/pages/decide.ts:225`

```ts
  if (readOnly) out.push(wide ? labelled(t('page.decide.k_note'), t('page.decide.act_readonly', { seat: d.source ?? '-' })) : [dimSeg(t('page.decide.k_note')), seg(' ' + t('page.decide.act_readonly', { seat: d.source ?? '-' }))])
```

## 3–4. 逐項紅→綠

每列的 log 最末行保留 runner exit code；測試名稱均以 finding id 開頭。

| Finding | 紅測試 | 最小修正及即時驗證 |
|---|---|---|
| W1 | `w1-red.log`：exit 1，host 25 列收到 24 | `w1-green.log`：exit 0；`w1-regression.log`：26 pass / 0 fail，exit 0；移除第二次 inline 上限，更新既有配給斷言 |
| W3 | `w3-red.log`：3 個 assertion failures，exit 1 | `w3-green.log`：3 pass，exit 0；`w3-regression.log`：41 pass，exit 0；操作合一、卡住、可展開的答題區；`w3-fixture.log`：14 pass，exit 0；`w3-mounted.log`：20 pass，exit 0，正式 register handler 確認全文末尾可達且能返回 |
| V3 | `v3-red.log`：本席卡缺 f，exit 1 | `v3-green.log`：35 pass，exit 0；z 與 f 同時保留，實際按 z 驗 reducer |
| V5 | `v5-red.log`：分頁列仍有 Esc，exit 1 | `v5-green.log`：288 pass，exit 0；移除 Esc，保留全部十頁與說明 |
| U2 | `u2-red.log`：回答目的地出現兩次，exit 1 | `u2-green.log`：43 pass，exit 0；補充改為 —，目的地保留一次 |

W3 的單列操作改變既有 golden；只更新受 W3／V3 指令取代的斷言，保留原測試與 reducer 檢查。`w3-regression-initial.log` 保留舊 golden 衝突。完整首輪 `suite-initial.log` 的 17 個失敗中，新增的兩個是 gate2 已退役 locale id 與 M3 舊寬版操作文案；前者改驗三種狀態的實際 h/l Buttons，後者改驗同一列的 compact 文案。`affected-final.log` 保留這兩個修正後的 33 pass / 0 fail（exit 0）。

## 5. 最終驗證

完整命令（下列 `$HOME` 為證據去識別後的路徑表示；執行時使用使用者指定的 2.1.327 絕對路徑）：

```sh
AUTOPILOT_MODS_REAL_CLAUDE=$HOME/.local/share/claude/versions/2.1.327 bash mods/live/run-tests.sh < /dev/null
node --test mods/live/ui-lint.test.js
node mods/live/gen-locales.js --check
git diff --check
```

最後受影響集合由 `targeted.sh` 建立相同 production wrapper，明確放入十一個測試檔：`pages/ux-gate3-frame.test.ts`、`pages/ux-gate3-decide.test.ts`、`pages/decide.test.ts`、`pages/ux-gate2.test.ts`、`frame.test.ts`、`gate2.test.ts`、`chrome.test.ts`、`pages/frame.golden.test.ts`、`pages/spend.test.ts`、`pages/batch2-mn.test.ts`、`ux-gate2.test.ts`（皆在 `mods/live/`）。

| 命令／驗證 | 結果 | 證據 |
|---|---|---|
| 完整 named live suite | exit **1**；plugin runner **1575 pass / 15 fail**，44 files；15 個皆為已接受的既有失敗 | `suite.log` |
| `(fail) ` 行數、既有失敗名稱 exact set、新 finding 無失敗 | exit **0**；15；集合相同；新 finding 0 fail | `acceptance.log`（對照基底已追蹤的 `../pane-g2b2/receipt.md`） |
| 最終十一檔受影響集合 | exit **0**；335 pass / 0 fail | `affected.log` |
| UI lint | exit **0**；56 pass / 0 fail | `ui-lint.log` |
| Locale generated sources | exit **0**；863 ids | `final-checks.log` |
| `git diff --check` | exit **0** | `final-checks.log` |

完整 suite 因接受的既有失敗仍回傳 1；本任務的「不得超過 15、不得新增失敗」門檻為綠，並未宣稱整套測試零失敗。測試 log 的 home path 使用 repo 的 `redact-personal.js` 去識別，並移除 runner 輸出行尾空白以通過 diff 檢查；assertion、測試名稱、exit code 與統計保留。

## 未做／交付界線

未修其他分支負責的 finding 或 15 個基準失敗；未改 `mods/live/` 外檔案，未增加 dependency、升版、修改真實 bus 資料、合併、推送或部署。未在真終端重拍評審截圖；W1 的注入配給案例與 host 外框界線明載於 `docs/w1-host-row.md`。跨模型家族獨立 review 由 caller 接續；本 receipt 不聲稱已完成獨立 review。

## 全部改動檔案（每檔一行）
- `mods/live/chrome.test.ts` — W1：更新既有 pure／mounted 測試為完整 host 配給。
- `mods/live/docs/w1-host-row.md` — W1：記錄實際 host 配給／裁切／外框證據與截圖量測界線。
- `mods/live/evidence/pane-r3a/acceptance.log` — 保存 15 個基準失敗 exact-set 比對與新增測試零失敗的 exit 0。
- `mods/live/evidence/pane-r3a/affected-final.log` — 保存 affected-final 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/affected.log` — 保存 affected 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/final-checks.log` — 保存 locale 生成一致性與 diff 空白檢查的 exit codes。
- `mods/live/evidence/pane-r3a/receipt.md` — 保存依序執行、驗證 exit codes、逐檔清單與未做事項。
- `mods/live/evidence/pane-r3a/suite-initial.log` — 保存 suite-initial 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/suite.log` — 保存 suite 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/targeted.sh` — 重現 production wrapper 的受影響測試命令。
- `mods/live/evidence/pane-r3a/u2-green.log` — 保存 u2-green 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/u2-red.log` — 保存 u2-red 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/ui-lint.log` — 保存 ui-lint 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/v3-green.log` — 保存 v3-green 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/v3-red.log` — 保存 v3-red 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/v5-green.log` — 保存 v5-green 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/v5-red.log` — 保存 v5-red 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w1-green.log` — 保存 w1-green 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w1-host.log` — 保存真實 2.1.327 host 程式片段、位元組位置與 binary 摘要。
- `mods/live/evidence/pane-r3a/w1-red.log` — 保存 w1-red 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w1-regression.log` — 保存 w1-regression 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w3-fixture.log` — 保存 w3-fixture 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w3-green.log` — 保存 w3-green 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w3-mounted.log` — 保存 w3-mounted 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w3-red.log` — 保存 w3-red 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w3-regression-initial.log` — 保存 w3-regression-initial 驗證的 runner 輸出及 exit code。
- `mods/live/evidence/pane-r3a/w3-regression.log` — 保存 w3-regression 驗證的 runner 輸出及 exit code。
- `mods/live/fixtures/console/c0/console-full.json` — W3：canonical 合成不可答卡資料補上卡住。
- `mods/live/fixtures/console/console-full.fixture.ts` — W3：同步可匯入的 canonical fixture，保持資料相等。
- `mods/live/frame.test.ts` — V5：更新分頁列舊 Escape 文案斷言。
- `mods/live/gate2.test.ts` — W1／W3：更新配給斷言，導覽改驗三種狀態的實際 h／l 按鈕。
- `mods/live/locales.ts` — W3／V5：由 generator 重新產生同步字串表。
- `mods/live/locales/en.json` — W3／V5：新增長卡詳細內容文案、移除已退役操作字串。
- `mods/live/locales/zh-TW.json` — W3／V5：新增繁中長卡詳細內容文案、移除已退役操作字串。
- `mods/live/pages/batch2-mn.test.ts` — W3／V3：更新既有不可答卡單列導覽與收合斷言。
- `mods/live/pages/decide.test.ts` — W3／V3：更新 golden 與對應狀態斷言，補齊窄版卡住 fixture。
- `mods/live/pages/decide.ts` — W3／V3／U2：單列操作、答題摘要與全文分段、卡住、並存控制、補充 —。
- `mods/live/pages/frame.ts` — W1／V5：使用 host 完整正文配給，移除分頁列 Escape 提示。
- `mods/live/pages/spend.test.ts` — V5：只更新共用分頁列舊 Escape 文案斷言，未改花費頁實作。
- `mods/live/pages/ux-gate3-decide.test.ts` — W3／V3／U2：新增紅測試、答題區順序與可點選項、詳細內容與收合控制回歸。
- `mods/live/pages/ux-gate3-frame.test.ts` — W1／V5：新增最後正文列與所有寬度／頁面的無 Escape 回歸。
- `mods/live/pane.tsx` — V5：移除已不存在的 Escape 尾段拆分。
- `mods/live/register.ts` — W3：保存及路由答題區詳細內容分段位置。
- `mods/live/ux-gate2.test.ts` — W3：加入正式 host mount 的詳細內容分段／返回測試，fixture 可注入。
- `mods/live/evidence/pane-r3a/redaction.log` — 保存證據 home path 去識別處理紀錄；不改 assertion、exit code 或計數。
- `mods/live/evidence/pane-r3a/commit-gates.log` — 保存 project pre-commit 與 staged leak guard 的 exit codes。
