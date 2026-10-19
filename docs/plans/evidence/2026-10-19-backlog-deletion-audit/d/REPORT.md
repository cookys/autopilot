# BACKLOG 大量刪除稽核（d 組）

稽核對象：17 個刪 3 列以上的 commit（唯讀；沒改 repo、沒跑套件）。逐列明細見 `rows.tsv`。
類別：A 已完成／B 已轉移／C 誤刪／D 有意放棄／未確認。本組沒有 B 類。

## 總覽

| commit | 日期 | 刪列 | A | D | C | 未確認 | 有無 receipt／對照表 |
|---|---|---|---|---|---|---|---|
| f2955b99e | 10-13 | 17 | 14 | 1 | 0 | 2（外加 sidecar 夾帶 2 條） | 無。訊息稱「2026-10-13 audit 16 shipped、1 obsolete」，repo 內找不到該 audit 的清單或 receipt |
| 1ca2a808b | 10-13 | 4 | 4 | 0 | 0 | 0 | 無；訊息稱 lanes K、B1，對得上 merge c000cd913、0595c3249 |
| 05cfafb33 | 10-13 | 3 | 3 | 0 | 0 | 0 | 無；訊息稱 lane D，對得上 f776a36ac（其中兩列是同一缺陷的重複列） |
| 1fa088210 | 10-14 | 4（BL-0122 只是縮小） | 4 | 0 | 0 | 0 | 訊息逐項列 BL-id，CHANGELOG 同 commit 有條目 |
| 549528c8d | 10-14 | 5 | 5 | 0 | 0 | 0 | 訊息只有 BL-id；CHANGELOG 有 BL-0119 條目 |
| af7519af3 | 10-15 | 10 | 9 | 1 | 0 | 0 | 訊息列 BL-id、CHANGELOG 有 6 條對應條目，BL-0152 訊息明寫理由 |
| 195f9a4f7 | 10-15 | 5 | 5 | 0 | 0 | 0 | CHANGELOG 3 條對應 |
| 2f2c1a128 | 10-15 | 5 | 5 | 0 | 0 | 0 | CHANGELOG 4 條對應 |
| 506c0b0e8 | 10-15 | 3（BL-0161 縮小） | 3 | 0 | 0 | 0 | CHANGELOG 2 條對應 |
| 5a30fb704 | 10-15 | 5 | 5 | 0 | 0 | 0 | CHANGELOG 對應；新增 BL-0190、BL-0191 承接殘留 |
| e43d8c2b3 | 10-15 | 3 | 2 | 1 | 0 | 0 | CHANGELOG 2 條；BL-0114 改文件說明 |
| 8d27d66e7 | 10-15 | 2（BL-0099、BL-0002 縮小） | 2 | 0 | 0 | 0 | CHANGELOG 對應 |
| 5245f0111 | 10-15 | 3 | 3 | 0 | 0 | 0 | CHANGELOG 3 條對應 |
| 7c82382a6 | 10-16 | 3 | 0 | 2 | 1 | 0 | 訊息每列一句理由；無 receipt |
| e05a1edc3 | 10-16 | 3 | 3 | 0 | 0（外加 sidecar 殘留 1 條 C） | 0 | 程式與列同一 commit，訊息逐項對應 |
| 061cc11c7 | 10-16 | 3 | 2 | 0 | 1 | 0 | 訊息逐項對應；但 BL-0026 只做一半 |
| 4e86b6658 | 10-17 | 9 | 1 | 0 | 8（全部已還原） | 0 | 無；訊息只提 BL-0205，其餘 8 列是誤切 |

合計約 90 列：A 76、D 5、C 3 條仍未還原（BL-0020、BL-0026、BL-0039 旁註 (7)(8)）、C 已還原 8、未確認 2 列（外加 sidecar 夾帶 2 條）。

## 各 commit 補充

### f2955b99e（17 列）
- 依據：訊息稱 backlog audit 逐列對照程式，16 已出貨、1 過時。沒有 receipt，本稽核自行對每列找出貨 commit，14 列找到。
- 過時列（D）：`peer-addressing.md` 永久儲存措辭。該文件經 1899c6dab（09-29 fleet v2 改寫）後已不含該段，列的前提消失。
- 注意：這批列沒有 BL-id（id 是 10-13 之後才補），所以 rows.tsv 用標題。
- 另有一個結構問題：`shared-sealed-zero-diff-validator` 的 sidecar 夾帶了三條無關缺陷（verify_pass=false 可在 reviewer SHIP 下收斂；campaign-contract fresh 路徑 Work Order 自鎖；codex live-spend probe 要帶 --model）。第三條已出貨（probe-engine-capability.sh:385），前兩條無處可追，且來自 2026-07 的 codepower 舊版引擎，現況未驗，列為未確認。

### 1ca2a808b、05cfafb33
全部有對應 merge，內容與列的問題一致。`Full-suite reds at 6e91be30` 裡 statusline-live-tee T2 一項是 003c4c6bd（10-12）已修，早於刪列。

### 4e86b6658（最嚴重的一次操作失誤，但已自行修復）
- 訊息只寫 BL-0205（context-budget per_model），實際 BACKLOG 刪了 9 列。
- 53eafe87d（同日）訊息自認「a bad slice removed eight unrelated rows」並整份還原。
- 現況：BL-0117、0123、0124、0144 仍在 BACKLOG；BL-0122、0201、0202、0203 之後被別的 commit 刪除（10-19 的 merge a8dac5e62、6c5929433／a1cc180cb、closeout4／e034a53cb），那些不在本組範圍，需由負責那幾個 commit 的稽核者確認。
- 啟示：4e86b6658 到 53eafe87d 之間若有人以該中間狀態為基準，會漏掉 8 列；目前 develop 無此影響。

### 7c82382a6
- BL-0008：Preview 席位已在同日 9d3b6f2a0（owner instruction）換成 Qwen3.8-Max，commit 理由成立，歸 D。
- BL-0040：訊息理由是 solo 10/10 綠。原症狀是 24 次中紅 1 次，10 次綠證據偏弱；但輸出保存半件 08-23 已做，下次紅會留下 log。歸 D（弱）。
- BL-0020：見下表，歸 C。

### e05a1edc3
BL-0039 的 sidecar 有八項，列內只談六項；程式修了前六項，後兩項（panel 補充的 (7)(8)）沒修，sidecar 同 commit 被刪，無處再追。

### 061cc11c7
BL-0026 是 owner 發問的來源（2026-09-07 「是不是要統一做個盤點表定期 check 所有 harness 是否支援」）。矩陣工具出貨了，但見下表。

## C 類與未確認明細

### C-1 BL-0020 PEER-REPORTED (openclaw): agy flash/low implementer is no-go on real briefs
- 刪除 commit：7c82382a6（merge 2c40bf42e）
- 為什麼算：commit 理由「沒有 shipped config 引用 agy flash/low implementer」我查證屬實（`.claude/review-loop-config.md` implementer 是 grok-4.7，template 也沒預設 agy）。但列有三個東西沒被這個理由涵蓋：(1) peer 回報 `Reply: none`，openclaw 從未收到回覆；(2) 回報的事實（agy `-p` 5 分鐘自停、超過約 40 行 brief 在 low 下 silent no_op、`run_command` 10 秒上限會把測試迴圈丟背景）只存在這一列，references 裡沒有等價記載；(3) 與考核紀錄「24/24 全過」的矛盾沒解決。這些屬低風險，可算「弱 C」。
- Effort：S
- Source：peer（openclaw via hangar-bridge，msg_01M2KNFAB7P7TGGMF4K5QYQFYH）
- 是否擋別的工作：否
- 建議 Trigger-Type：event（下一次 agy implementer 考核，或 openclaw 再回報）；先補一則回覆給 openclaw，再決定是否把事實寫進 multi-agent-portability.md

### C-2 BL-0026 Per-hook × per-harness support matrix with verification dates
- 刪除 commit：061cc11c7
- 為什麼算：只做一半。`scripts/hook-harness-matrix.js` 與 `docs/hook-harness-matrix.md` 出貨，但矩陣所有儲存格都是「未驗證」，證據檔 `hooks/harness-support-evidence.json` 只有 1 筆 `packaged`（post-compact），沒有任何 `fired`；`--check`（60 天過期警告）只出現在 harness-maintenance SKILL 的工具表，沒進 preflight／CI／hook，所以「定期重驗」沒有任何自動觸發。原列的觸發條件（Codex `Stop`/`SessionEnd` 給 dirty-protected-paths 的 live-fire 未驗）也沒有任何地方追。CLAUDE.md 「腳本存在不等於在跑」正是這種形狀。
- Effort：S
- Source：owner（2026-09-07）
- 是否擋別的工作：否（但 owner 親自提的）
- 建議 Trigger-Type：date／periodic（例如每次 release 前跑 `--check`，或掛進 `preflight-release.sh`）；加上 event（第二個 harness 註冊新 hook 時）

### C-3 BL-0039 sidecar 旁註 (7)(8)：instant2 fixture 以 opaque 重錨、filter 不驗 engine/runner/role
- 刪除 commit：e05a1edc3（連同 sidecar `v2-34-37-first-pass-review-cut-list.md`）
- 為什麼算：BL-0039 本體六項都修了；旁註 (7)(8) 來自 2026-08-23 qc panel（MiniMax-M3，verified），e05a1edc3 沒碰 instant2 fixture，後來 04b003ad6 只改 TTL。兩項被連同 sidecar 一起刪。
- Effort：S
- Source：self（qc panel 發現）
- 是否擋別的工作：否
- 建議 Trigger-Type：file-touch（下次動 `hooks/tests/calendar-teeth-negative.test.sh` instant2，或 capability-evidence producer 契約收緊時）

### 未確認-1 suite oracle lock：被殺掉的全套件執行讓下一次被拒（f2955b99e）
- 原因：口徑是 flock，進程死則鎖自動釋放；08-28 d96bc3f0d 已修 worker 子 shell 繼承 fd 的洩漏。但列的第二例（09-04 `kill -9` 後被拒）發生在該修正之後，我找不到針對它的修正；601ae2c6b（10-02）只間接改 snapshot 子行程。殘留可能是 `.owner` 殘影讓拒絕訊息指向死 pid（不是真鎖死）。
- Effort：M（原列）；Source：self（未標）；擋別的工作：否
- 建議 Trigger-Type：event（下次又被誤拒時，先 `lsof` 看誰握鎖）

### 未確認-2 Promote depth-0 hetero-run watcher to a shipped dispatch-watch script（f2955b99e）
- 原因：沒有 `dispatch-watch` 腳本。替代物：`wait-dispatch-results.js`（v2.36.32，等 exit 檔）、`watch-foreman.js`（07-14，早於列）、level-front-door.md:463 寫「host 停車就 `SendMessage` 喚醒」。是否等價於列要的「depth-0 偵測 phase 由 running 變 terminal 後喚醒停車工頭」無法從程式判定。10-13 稍後的 bash-launch-guard（ad2271760）擋「沒有喚醒機制的背景派工」，也屬相關但不同。
- Effort：S；Source：self（v2.36.0 session）；擋別的工作：否
- 建議 Trigger-Type：event（下次 /l4–/l6 有停車工頭需要手動喚醒時）

### 未確認-3、4 sidecar 夾帶（f2955b99e，列為 shared-sealed-zero-diff-validator）
- verify_pass=false 非阻塞、reviewer SHIP 下仍收斂；campaign-contract fresh 路徑 Work Order 自鎖（無 list/dispose CLI）。兩條來自 codepower 2026-07-24／07-31 的舊引擎觀察，現行 autopilot-engine.js 仍有相關邏輯（:4220 `hasActiveRootWorkOrders`），是否仍可重現未驗。
- Effort：S 與 M；Source：peer（codepower）；擋別的工作：否
- 建議 Trigger-Type：event（下次動 continuation admission／Work Order lifecycle，或 implement-review 收斂條件）

## 可疑但歸為 A／D 的備註
- BL-0134：列說 15 份不符，merge 只還原 14 份，訊息沒解釋差一份；但審查者重算 110 個 pin 全數相符，視為已解。
- BL-0101：列 Context 明寫 declined 三項（sweep env knob、symlink escape、rollover guard），屬有意放棄。
- BL-0152：commit 稱非真缺口，我讀 `mission-routing-campaign-bridge.test.sh:653/675` 確認該分支有被測試驅動。
- 所有 A 類我核對的是 merge 訊息／CHANGELOG／diff 檔案與列的問題相符，沒有重跑測試（唯讀限制）。
