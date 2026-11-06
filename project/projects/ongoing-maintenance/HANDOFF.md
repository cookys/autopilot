## 目標
autopilot 開發 session 換帳號續做（PM 01M6QT6WVY：Z3 不推，排查回報來源 lane 後就搬）。新 session 接手：Z3 重建與推送、G14 g3、rosterp1 第二段、lead 考試三家開考、面板 O4 band 外殼。里程碑見 CLAUDE.md Goal 區塊。

## 現況
- develop = 2f0ab0f93（Z2 rtchat）＋本檔這一個 docs commit。**Z3 是紅的、沒推**：Z3 = `stack/z3` deacd769f（2f0ab0f93 ＋15 條 lane 的 `--no-ff` 合併，依序 docsq seatswap chanckpt staleconf seedclean permwatch decidefix(hands/panel/1) minimax rkrun odverify rktests ssotrail e2fix recenthint leadexam；每條 receipt rc=0）。
- Z3 全套（06:52Z 跑完，`$MOVE/scratch/z3/full-Z3.status`）：develop 上本來就紅的 3 支 dispatch-author-kill-after、dispatch-author-codex-transport、scripts/account-rails.test.js 可放行；**新紅 8 支**：advisory-relay、dispatch-author-agy-timeout、dispatch-output-quiescence、hetero-review-seat-model-preflight、resolve-review-loop-consult-discuss-switch、review-server、status-cli（皆 hooks/tests/<name>.test.sh）、scripts/check-claude-spawn-sites.test.js。FAIL 行在 `$MOVE/scratch/z3/full-Z3.out`。
- 來源 lane（排查 hand 二分結果，`$MOVE/scratch/z3/z3triage-report.md`）：
  - **seatswap**（合併 598311553）→ hetero-review-seat-model-preflight（`:26` 還要預設面板含 claude-opus-5-5）、resolve-review-loop-consult-discuss-switch（`new-value-drift:qc_panel_seats`）、status-cli（`:132-159` 凍結 receipt）。測試沒跟著換席同步，不是產品錯；預設面板在 `scripts/resolve-review-loop.sh` 約 :88。hands/rosterp1/1 也重釘了 switch 與 preflight，可參考。
  - **ssotrail**（合併 94fb70edf）→ scripts/check-claude-spawn-sites.test.js：出現新的 claude 啟動點，要判斷是登記進清單還是修程式（file:line 未查）。
  - 不是 Z3 引入：advisory-relay（develop 單跑也紅，原因未查）、dispatch-output-quiescence（兩邊都紅，時間類，load 約 40–42）、dispatch-author-agy-timeout（Z3 單跑綠）、review-server（Z3 綠、develop 紅）——判 load／flaky，要在低 load 下各重跑一次確認。
  - 建議：在 seatswap 與 ssotrail 各自的 lane 上修好（測試重釘／啟動點處理），astra 審過這段增量，再重建 Z3；或先重建不含這兩條的 Z3 推上，兩條修好後下一批。
- 本機 lane 分支推不上 origin（pre-push qc-gate 要 QC-Verdict trailer，禁用 --no-verify），改以每條一個 git bundle 放在搬遷目錄 `$MOVE`（= `/var/tmp/autopilot-move`）：`$MOVE/lanes/<lane>.bundle`，清單 `$MOVE/lanes/SHA256SUMS`、tip 對照 `$MOVE/lanes/TIPS`。取用：`(cd $MOVE/lanes && sha256sum -c SHA256SUMS)`，再對每條 `git bundle verify` 後 `git fetch $MOVE/lanes/<lane>.bundle 'refs/heads/hands/<lane>/1:refs/heads/hands/<lane>/1'`。
- 分支與交接點：

| 分支 | tip | 狀態 |
|---|---|---|
| hands/gategap/1 | 39387f89f | G14 g3 wip（上一個完整提交 43807a09a）；交接 `$MOVE/scratch/gategap-handoff.md` |
| hands/rosterp1/1 | 0f2736b6c | roster 單一來源第二段 wip；交接 `$MOVE/scratch/rosterp1-handoff.md`（檔內寫最終批「還在跑」已過時）。最終批結果 `$MOVE/scratch/rp1-final/results.txt`：50 支只出 24 支結果、13 支紅，幾乎全是 dispatch-author 族（agy-timeout、kill-after、codex-transport 在 develop 也紅；contract、strict-roster、strict-endpoint、va-pin、session-mode、result-*、panel-note-quiet、dispatch-author、dispatch-discuss 要和 develop 比），疑似同一個 roster 改動，先從 strict-roster 查 |
| hands/rosterp2/1 | 043c5edf7 | 待審（override 到期 ≤3 天警告接 patrol） |
| hands/rosterp3/1 | 88edf55a1 | 待審 |
| hands/reapscratch/1 | bb216b436 | 已收斂（g3 astra 0 條、receipt rc=0），進下一批合併 |
| hands/sidepane/1 | 28d035c95 | 預覽分支（方案 A/B 開關），PM 已核 B，正式實作進 band 外殼 lane |
| hands/rmtrash/1、hands/autoyesimpl/1 | 6df09756d、7e503e509 | PM 裁定一起進 backlog，不合併 |
| hands/leadexam/1 | 78a5b56b4 | 在 Z3 內 |
| Z3 的另 14 條 lane | 見 `$MOVE/lanes/TIPS` | 在 Z3 內；bundle 一起帶 |
| stack/z3 | deacd769f | `$MOVE/lanes/stack-z3.bundle` |

- 審查 ledger 整份搬到 `$MOVE/ledger`（hangar 裁定）：沿用原本的 review chain，不加尾碼重開，代數接著算（例 gategap 下一代是 g3）。collect／finalize／map 輔助腳本在 `$MOVE/review-tools/`，裡面寫死舊帳號的 scratch 與 ledger 路徑，先複製到自己的 scratch 再把路徑改成自己的 ledger 副本（ledger 也先複製出來，`$MOVE` 只讀）。

## 已決事項(不重議)
- 側邊窗格採方案 B（PM 核）：側邊窗格不自動開；「現況」併進 O4 右側摘要欄；其他分頁按下才開；文字進 locales；給一個按鍵或指令手動開；交件附 240／160 欄改前改後真機截圖。
- 面板 O4 contract 定稿 = codeforge aad858d `doc/specs/panel-band-contract.md`；band 依 bodyColumns 分五級（≥235／195／155／115／其餘 80 級）；autopilot 做 band 外殼＋forge-stats reader，codeforge 寫 panel state。
- roster：implementer 用 template gpt-6.1-sol/high；autopilot 自己有 grok override 到 2026-11-20（PM 裁 B）。
- rmtrash＋autoyesimpl 合成一條 backlog（PM 選 A）；下一版設計 = 去掉引號、反斜線、換行後仍有 rm/sh/bash/eval 字就擋，只放行窄文法。
- Gate rule A：已核實的 Major 以上必須修掉，或正式降級並附 unreachable／bounded 證據；「判不擋」不算。G14 就是把它變成機器檢查。
- 執行檔案（`bash f`、`sh f`、`./f`）照常放行；命令列上看不到的 stdin 或 -c 內容一律擋（PM 裁 A）。
- 不升版號；全套只在合併到 develop 前跑一次、單獨跑；不加 hosted CI。

## 下一步
1. 與 PM 雙向 nonce＋/status 對時，確認 `git log -1` 是本檔的 commit，fetch lane bundle（hangar 會先做好）。
1b. 重建 Z3：從 `$MOVE/scratch/z3/stack-Z3.sh` 複製一份，把 base 改成本檔這個 commit、lane 清單拿掉來源 lane（或先修好那條 lane 再放回）；合併衝突照舊：CHANGELOG 用 `-c core.attributesFile=<union-attrs>` 走 union、staleconf 的 template 用 `-X ours`、odverify 的 scripts-inventory 用 `resolve-rows.js`（兩支都在 `$MOVE/review-tools/`）。每條核對 parent2、trailer、receipt，再跑 leak-guard 與 codex check。全套照 `full-Z3.sh`（單獨跑，`suite-baseline.js run-all --jobs 6`），紅項要和 develop 同紅；推送照 `push-Z3.sh`（核對 HEAD~N = base、develop 沒動）。推上後交 seedclean（fleet 工單 01M6Q1QYZPJNM5MT44X6D4AKFT）與 recenthint（01M6QA3AF01BYYSDKQECPE9TSQ）的 task_result，附 develop sha。
2. leadexam 三家考試（腳本寫死舊 scratch 路徑，先複製到自己的 scratch 並改路徑）（PM 核准這 6 次放寬 haiku-only，可用 Sonnet/Opus）：`bash $MOVE/scratch/leadexam-three.sh <自己的 checkout>`（setsid nohup，約 1 小時），再 `node $MOVE/scratch/leadexam-three-summary.js <輸出目錄>`。回報每家兩次分數＋平均＋差距、各類、D1 D3 N1 N3、tokens、時間；多工核心題 A1 E1 E2 E3 R、輔助題 N1–N3。任一家兩次差 >10 或三家平均差 <10 就停下回報，不加跑。
3. G14 g3：照 gategap-handoff.md 剩下的 5 步（重跑紅燈、修 fixture 到綠、三支 receipt 套件＋hetero-review-loop、CHANGELOG 與 code-loop.md 一句、收成單一提交），然後 astra 或四席審，進下一批合併。
4. rosterp1 第二段：等最終 50 支（清單與結果在 `$MOVE/scratch/rp1-final*`）逐一和 develop 比紅；重跑 resolve-review-loop-b。PM 承諾：2026-11-07 06:00Z 前收斂、審過、合併，附 sha＋mnemos／llm-playground 遷移證據（fleet 工單 01M6Q91F24W0EK7YR5Y7DP8JGW，操作員親自追）。
5. 面板 O4 band 外殼五級＋reader＋側邊窗格 B：11-07 12:00 台北收斂（四席審）。完成通知 codeforge 新位址（team 帳號那一個）。
6. PM 用量三件：(a) 漏 model 的子代理——plugin agents/*.md 補 `model: sonnet`，查證 PreToolUse 能否回 updatedInput（能就補值，不能維持 deny），11-07 08:00Z；(b) 工單結案清 context 的做法提案，11-07 04:00Z；(c) 同批派工的喚醒合併設計，11-07 08:00Z；機械性子代理試 Haiku 一週（11-07 起），每天回報次數與失敗率。
7. 下一批合併：reapscratch、G14、rosterp1/2/3。每次推完跑 `scripts/scratch-closeout.sh --keep <在跑的 lane>`。
8. 文件 lane（task #67）：rmtrash＋autoyesimpl backlog 列（findings 在舊 ledger review-rmtrash g1–g4，已附在 `$MOVE/scratch/`）、f4claim 文件、E2 反斜線換行與 `rm>` 黏著重導向。
9. 磁碟 G10 的 ASK 16G（PM 規則）：先把 unreachable commit bundle 到 scratch 外的封存目錄並 `git bundle verify` 才刪；髒的與非 git 目錄列給 PM；乾淨 clone 只有 HEAD 在 origin 才刪；e40cc506 同規則並先 `lsof +D`。清單在 `$MOVE/scratch/g10-*.tsv`。

## 驗證方式
- `git log -1 origin/develop` 是本檔的 commit；`(cd $MOVE/lanes && sha256sum -c SHA256SUMS)` 全 OK，fetch 後 9 條 tip 與 `$MOVE/lanes/TIPS` 一致。
- `node scripts/check-phase-review-receipt.js` 對 reapscratch（bb216b436，舊 ledger 副本）rc=0，證明 ledger 搬過來還能用。
- 每條 lane 合併前：`node scripts/check-phase-review-receipt.js` 對要合併的 tip rc=0；合併批全套單獨跑、紅項要和 develop 同紅才放行。

## Read-order
1. CLAUDE.md（repo 根）— Goal 區塊與 Process rules。
2. `$MOVE/scratch/gategap-handoff.md`、`$MOVE/scratch/rosterp1-handoff.md` — 兩個 hand 的確切停點。
3. `skills/dev-flow/references/hetero-loops.md` — 審查代數上限、receipt 綁 tip。
4. `$MOVE/scratch/panel-contract-review.md`、`$MOVE/scratch/sidepane-shots/index.md` — 面板與窗格的前置結論。

## 陷阱
- zsh：`$b:refs` 會被 `:r` 修飾子吃掉、未加引號的 glob 和 `=` 開頭的字會讓整行失敗；要 bash 語意就 `bash -c`。
- 推 lane 分支到 origin 會被 qc-gate 擋（protected path 沒 QC-Verdict trailer）；別用 --no-verify，只有帶 trailer 的合併 commit 能上 develop。
- receipt 的 base 用 phase-base（chain 第一代的 base）；前一代沒 finalize，下一代 collect 會報錯；已處置的 Minor 不能在 finalize 再列。
- G14 合併前，finalize 在有已核實未處置 Major 時仍可能印 SHIP-AS-IS，要手動擋。
- 平行跑長套件會互相干擾：一次一支、`< /dev/null`、nice；測試用哨兵 PATH、mktemp 的 ENGINE_CAPABILITY_DIR／AUTOPILOT_ACCOUNTS_DIR、AUTOPILOT_STRIKE_WRITER=off，不帶 AUTOPILOT_SESSION_ID。
- rm 目標只寫字面路徑或 mv 進 scratch 的 trash，不用 `$(...)`／`$VAR`；含 rm 的腳本先寫檔再跑。
- dispatch-author-kill-after、dispatch-author-codex-transport 在 develop 上本來就紅（已在 backlog）。
- 主 checkout 的 8 個 untracked 檔留在舊帳號（PM：不要動），不屬於本交接。
