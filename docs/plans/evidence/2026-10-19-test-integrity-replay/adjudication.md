# BL-0060 check-test-integrity 回放裁定

## 方法
- 回放：`scripts/replay-test-integrity.js --count 60`（hand commit 0feda69d8 的版本），範圍為 develop 最近 60 個 first-parent merge（最新為 a007fa65e），使用該版本的 `check-test-integrity.sh`（mode=warn）。原始輸出：`replay.json`。
- 母體：60 個 range 中 40 個有 violation；1101 筆紀錄（`deleted_line` 1078、`surface_touch` 23）；無 errors。
- 母體超過 150 筆，故抽樣：以固定 seed 20261019 的線性同餘亂數（`s = s*1664525+1013904223 mod 2^32`）對紀錄索引做 Fisher-Yates 洗牌，取前 150 筆（腳本 `sample.js`，清單 `sample.txt`、`sample.idx.json`）。樣本含 147 筆 `deleted_line`、3 筆 `surface_touch`。
- 裁定方式：逐筆對照 `git diff <merge>^1 <merge> -- <file>`。樣本聚成少數 (merge, file) 群組，同一群組的理由相同，故以群組列出，列出涵蓋的樣本編號（#n，見 sample.txt）。
- 另做母體輔助檢查（`net.js`）：把 65 個 (merge, file) 群組算「斷言類行」淨增減。

## 逐筆裁定（150 筆，全部 FP）
| 樣本 # | merge | 檔案 | 類型 | 裁定 | 理由 |
|---|---|---|---|---|---|
| 0 | 16a406dc | affected-suites.test.js | deleted_line | FP | 改 require 行為多取 spawnSync，另加新測試 |
| 1 | 36abe7bd | engine-qualify-impl.test.js | deleted_line | FP | 刻意行為變更（failed→no_verdict），新斷言帶 BL-0160 說明 |
| 2,3 | 6c592943 | review-increment.test.sh | deleted_line | FP | 改名 reason（finding_unmapped→prior_path_removed）；a14 改為新行為「搬檔退回 full」並有對應斷言 |
| 4 | 6c592943 | fixtures/review-increment-real-seat/missing-prior-prefix.txt | surface_touch | FP | 新增 fixture（狀態 A），不是修改既有 fixture |
| 5 | b3693669 | mods/live/live.test.ts | deleted_line | FP | 型別欄位擴充，新增含 RED 註解的新測試 |
| 6 | a8dac5e6 | evals/.../t7-config-rename/repo/tests/tool.test.js | surface_touch | FP | 範例測試改寫到暫存目錄，斷言移進 try 區塊，目的是不再寫入已提交的 fixture（BL-0122） |
| 7-10 | 6fcfed4b | check-l1-cache-key-parity.test.sh | deleted_line | FP | 整支測試隨被測的 parity gate 一起移除（BL-0094，14 檔移除含腳本本身） |
| 11,12 | 6ed65d18 | dispatch-review-c.test.sh | deleted_line | FP | kimi 超長 prompt 由「拒絕」改為「檔案分段送達」；舊斷言換成更強的新斷言（nonce、分段順序） |
| 13-15 | 48a66b5b | opencode-discovery-probe.test.sh | deleted_line | FP | canary 由 size/mtime 改成 byte offset 讀新增內容，更準確 |
| 16 | 1456a232 | mods/live/live.test.ts | deleted_line | FP | 按鈕包住 Text，斷言改經 glyphOf，另加 pressable 斷言 |
| 17 | 62d54529 | mods/live/scroll.test.ts | deleted_line | FP | bug 修復，offset 語意改為目標值，新增多個斷言 |
| 18,19 | 375a1601 | opencode-v2-plugin.test.sh | deleted_line | FP | 載入方式改走 opencode-discovery-probe.js，舊註解與 scratch 手法移除 |
| 20 | a593878c | implementation-campaign-state.test.sh | deleted_line | FP | 註解措辭 |
| 21 | a593878c | mission-retire-on-integration.test.sh | deleted_line | FP | `exit $?` 換成明確的 rc 斷言加 finalize_test，更嚴 |
| 22-26 | 48965f54 | mods/live/ui-lint.test.js | deleted_line | FP | 規則範圍由 live 擴大為所有 mods（modSources()），viewer 專用測試併入 all-mods 規則（BL-0207） |
| 27 | b6e11294 | skill-frontmatter-portability.test.sh | deleted_line | FP | 探針欄位改成中性欄位，另加斷言保證 |
| 28 | 9883b639 | child-parent-record.test.sh | deleted_line | FP | 變數改名（USTUB→stub） |
| 29-49 | 9883b639 | scripts/lib/opencode-containment.test.js 與 codex 鏡像 | deleted_line | FP | v1/v2 adaptor 拆分：argvFile→st 改名；env 斷言改為 `.envx` 檢查 `C=UNSET\|D=UNSET`（保留且加 P= 檢查）；tampered()→tamperedReview() 並加 teeth 對照 |
| 50 | 35f07d83 | mods/live/live.test.ts | deleted_line | FP | helper 改經 flat(tree) |
| 51 | 2f8d1da3 | affected-suites.test.js | deleted_line | FP | 斷言加強為最後兩行 deepStrictEqual（多一個 runner） |
| 52 | 48985afc | final-panel-kimi-agy-intake.test.sh | deleted_line | FP | 迴圈清單新增一項 |
| 53 | 2f5ba118 | fixtures/dispatch-discuss-single-turn-empty-taken.golden.txt | surface_touch | FP | 新增 golden（狀態 A） |
| 54 | 6e92b769 | review-resolution-closure.test.sh | deleted_line | FP | addendum 由「預設關閉且啟用丟錯」改為正式生成器，附新斷言（owner 裁定） |
| 55-138 | 16dd391e | dispatch-hetero-gc.test.sh | deleted_line | FP | 整支測試隨 `dispatch-hetero.sh --gc` 功能一起移除（BL-0115），並新增 dispatch-hetero-gc-removed.test.sh |
| 139-144 | 16dd391e | resolve-worktree-teardown.test.sh | deleted_line | FP | `stale_reaper_age_days` 欄位移除，測試跟著移除，改驗證別的欄位 |
| 145 | 2210b470 | review-resolution-closure.test.sh | deleted_line | FP | 變異表擴充，同行保留原變異並多加一個 |
| 146 | a9a508c6 | profile-context-isolation.test.sh | deleted_line | FP | 釘值 693→645 隨規則總數的真實變動調整（邊界案例：數字下調，但與資料變更同步） |
| 147-149 | 09c5eeb6 | qualification-*transport/provider.test.js 與鏡像 | deleted_line | FP | 欄位值改名 unified_diff→case_content（BL-0053），斷言對象一致 |

## 統計
| 類型 | 樣本數 | TP | FP | FP 率 |
|---|---|---|---|---|
| deleted_line | 147 | 0 | 147 | 100% |
| surface_touch | 3 | 0 | 3 | 100% |
| 合計 | 150 | 0 | 150 | 100% |

- 以 (merge, file) 群組計（樣本涵蓋 33 組）也是 0 TP。樣本集中度高：1101 筆中 679 筆（62%）來自兩次整檔測試刪除（BL-0115、BL-0094）。因此逐筆 FP 率只是下限的描述，群組口徑同樣為 100%。
- 輔助檢查（母體 65 組）：斷言類行淨減的非整檔刪除只有 3 組（resolve-worktree-teardown、engine-qualify-verdict-stability、review-resolution-closure），逐一看 diff 都是正當維護（欄位移除、變異表改寫、取代式改寫）。母體中沒有找到任何一個真陽性。
- 沒有看到 skip/only 類 violation：回放資料裡只有 `deleted_line` 與 `surface_touch` 兩種類型。

## FP 來源
1. 整檔測試隨功能一起刪除（2 組，679 筆，62%）：被測功能已刪，測試當然跟著刪。
2. 改寫式維護（改名、變數更名、斷言改成更強的新寫法、註解修改）：`deleted_line` 對每個被替換的舊行都計一筆，不看新增行。
3. 新增 fixture/golden 被算成 surface_touch（狀態 A 也算 touch）。

## 結論
- 整體 FP 率 100%（0/150），遠高於 5%。依「<5% 才改 block」的裁定，**不建議現在改 block**。若改了，60 個 range 中 40 個（67%）會擋住誠實的 merge。
- 只靠「不再把某類升成 violation」無法達標：`deleted_line` 與 `surface_touch` 兩類在樣本中都是 100% FP，母體也找不到 TP，拿掉任何一類都不會讓剩下的 FP 率降到 5% 以下（TP 為 0 時，唯一讓 FP 率低於 5% 的辦法是旗標集合幾乎為空）。
- 要往 block 走，需要先改規則（另開工作）：(a) 整檔刪除且同 merge 也刪了被測目標時不算；(b) `deleted_line` 改為「同檔、同 merge 內斷言類行淨減才算」，只剩 3 組/60 range（5%），且這 3 組樣本都是 FP，仍不是準確率證據；(c) `surface_touch` 排除新增檔（狀態 A）。
- 重要限制：已合併的 range 都通過審查，天然缺少真陽性，回放只能量「誤擋誠實 commit」的一面，量不到召回。改 block 前還需要一組植入已知違規（刪斷言、加 skip、改 fixture 變寬鬆）的 range 作負對照，證明新規則真的擋得住。
