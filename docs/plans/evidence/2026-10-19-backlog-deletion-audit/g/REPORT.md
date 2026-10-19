# 旁註檔稽核報告（commit b9caa7db6 刪除的 95 個 docs/backlog/*.md）

稽核基準：HEAD 6f46a571c（develop）。方法：逐檔讀 `b9caa7db6^` 內容，再用 HEAD 的程式碼、CHANGELOG、BACKLOG、plans、INDEX、HANDOFF 查驗。全表在 `sidecars.tsv`。

## 總數

| 類別 | 數量 |
|---|---|
| A 已完成（用 HEAD 程式碼行號或 CHANGELOG/commit 驗證） | 82 |
| B 已轉移（HEAD 有追蹤且觸發條件帶過去） | 1 |
| C 被埋 | 9 |
| D 有意放棄／無內容 | 2 |
| 未確認 | 1 |

結論：沒有發現「高重要性」的被埋項。9 個 C 類裡，真正有實質影響的只有 2 個（openclaw 的兩個副作用、engine implement-review 的 verify 紅燈仍可被 reviewer SHIP 收斂）；其餘為 Effort S 的 🔵 級殘項。

## 驗證強度（誠實說明）

A 類的證據多數是「HEAD 程式碼中已有對應機制」（讀程式碼或 grep 行號），不是重跑測試。規定不能跑測試套件，因此沒有任何一項是以重現／執行驗證的。少數 A 項有保留：
- `cost-tracker`：fable 價格列與 hasPriceRow 已有；原文要求的「引用官方價格頁 URL」在程式碼註解中找不到，屬次要缺口。
- `engine-scorecard-js`：`--role-default-scope` 只涵蓋 consult/discuss，其他角色 fail closed，是設計選擇（程式碼註解說明）。
- `cc-shim-framing`：沒有照原文建議在啟動環境停掉標題產生，而是在 dispatch-review.sh 解析端對該行做精確比對跳過；效果已解，路線不同。
- `mods-live-campaign-phase` 的 Gap 2（dev-flow 階段寫入端）由後來的 stage-graph 取代，不是原先提的做法。

- `foreman-model`：第 (2) 項（dispatch-model-guard 不得硬斷 opus）已確認：dispatch-model-guard.js:73 為設定驅動的 guarded_models_implementing，無對 sub-orchestrator 的硬編碼。
- 各檔證據欄原本只引用旁註檔自稱的 12 列（hook-stderr、killed-dead、mission-grant、no-operator-level、308-8f、resolve-review-loop-test、the-mission-graph、the-shipped-operator-pin、qualification-provider、foreman-context、managed-rail-resume、suite-pollutes），已全部補上 HEAD 的檔案或行號。

## B 類（1）

- `contract-first-escalation-and-local-repair-gates-2-3-classes-shipped-v2-34-32-cl.md`：class (a) 未出貨部分在 docs/BACKLOG.md 的 BL-0035（Trigger 為 owner 核准專案、要求 planted negative case，Pointer 指向同主題的 `contract-first-escalation-and-local-repair-gates-p6d-incident-follow-up.md`，該檔仍在）。觸發條件有帶過去。

## D 類（2）

- `every-gate-needs-a-negative-control-the-caution-needs-a-routine-behind-it.md`：規則本身已採用（owner 2026-10-13 同意；references/evidence-discipline.md §58；CLAUDE.md「Rule — negative control」）。BL-0058 在 commit 81f8cfd8e 以 shipped 刪除。「meta-gate（檢查每個閘都有負控制）」未建，evidence-discipline.md:1274 明文記錄「there is still no meta-gate」。理由有紀錄：owner 核准以規則取代機制。
- `topic-title.md`：空白範本（`<Topic title>` 佔位），無工作內容。

## C 類詳表（9）

### C1 peer-reported-openclaw-an-active-l5-marker-deadlocks-the-bounded-campaign-l5-its.md（重要性：中）
- 問題：openclaw 回報的主訴求已在 v2.36.28 出貨；兩個副作用沒完成。(a) precondition_failed 拒絕時回報 `admission_release.status=released`，但 durable 狀態仍留 `live_lease`，下一次啟動撞 `campaign_state_lease_open`，他們手動清 ledger。(b) `verify_cmd` 子行程繼承到沒有使用者 `bats` 的 PATH，「command not found」應歸 precondition 而不是 verification。
- Trigger 原文：「(remaining) side effect (a) — rejection reports `released`, state keeps `live_lease` — is the third sighting of that class and the larger item; reproduce with the peer's ledger backup before designing. Side effect (b) — `verify_cmd` inherits a PATH without the operator's tool — is a precondition-vs-verification classification question.」
- Effort：(a) 較大，(b) S。
- Source：peer（openclaw／hangar-75，經 fleet，2026-09-12）。
- 為何判定沒人追：HEAD 只有 docs/plans/2026-09-12-integration-ledger-and-marker-gates.md:118 把它列為非目標「Logged, out of scope」，而 "Logged" 指的就是這個被刪的旁註檔；docs/BACKLOG.md 沒有 openclaw 的列（只剩第 13 行的刪除線「openclaw main claim v2.36.28」），docs/HANDOFF.md:57 是舊接手段。
- 留意：同家族的 stuck IMPLEMENTING 問題在 v2.36.71 修過（wall 到期、boundary_rejected resume），(a) 可能已被部分覆蓋；沒有重現就不能說已關。需向 openclaw 取 `rollout-campaign.log` 與 ledger 備份（只在他們主機）。
- 擋別的工作：否，屬已知會讓 campaign 手動清 ledger 的繞路。

### C2 shared-sealed-zero-diff-validator.md（重要性：中低）
- 檔內其實有 4 條。三條已解（共用 zero-diff 驗證模組 `src/engine/sealed-zero-diff-validator`；Work Order 自鎖已排除 controller WO，autopilot-engine.js:4228；live-spend probe 已強制 `--model`，probe-engine-capability.sh:393）。
- 未完成的一條：「engine implement-review：verify_pass=false 非阻塞、可在 reviewer SHIP 下收斂」。2026-07-24 codepower /l6 P0a 實測：所有 verify_round 都 `verify_pass:false`，loop 仍以 reviewer SHIP-AS-IS 收斂並回報 committed，實際缺陷（TS2322、8 個測試紅）全靠 foreman 自驗攔下。
- Trigger 原文：「下次動 engine implement-review 收斂邏輯或 resolve-review-loop verify 欄位時。」
- Effort：未標（修法方向：收斂條件改為 reviewer SHIP 且（verify_pass 或 verify 缺席白名單），至少對 `verify_pass:false + converged` 發 WARNING）。
- Source：self（codepower 實測）。
- 為何判定沒人追：BACKLOG／plans／INDEX／CHANGELOG 對 verify_pass 紅燈收斂都查無；HEAD 程式碼 autopilot-engine.js:12117-12175 仍在 verify 未過時以 `convergenceReason='reviewer'` 收斂（我讀程式碼判斷，未執行）。注意：managed 規劃路徑（campaign contract）另有 `campaign_verification` 把關，風險主要在非 managed 的 `engine implement-review --verify-cmd`。
- 擋別的工作：否。

### C3 roster-qualification-remaining-legs-explorer-suite-brain-re-sit-implementer-leg.md（重要性：低）
- 問題：explorer 角色的正式資格考（suite）從未建；brain 重考部分已在 BACKLOG（「Brain-seat sittings in the shipped qualification defaults」，算 B）。
- Trigger 原文：「Explorer formal suite — before autonomous routing claims for that role.」
- Effort：L（原文，針對 verification-author suite 設計；explorer 未估）。
- Source：self（v2.34.15 qualification-cli-transport 後續）。
- 為何判定沒人追：HEAD 的 docs/BACKLOG.md 無 explorer 字樣；docs/plans/2026-08-22-implementer-qualification-suite.md:149 與 2026-08-26-cursor-cli-adaptor.md:526 只把它列為範圍外。
- 擋別的工作：否。觸發是「對 explorer 角色做自動路由主張之前」，是否存在這種主張沒有檢查機制。

### C4 check-phase-review-receipt-min-reviewed-seats-enforcement-test-on-a-multi-seat-f.md（重要性：低）
- 問題：`--min-reviewed-seats` 只有解析守衛測試（case 14）與 min=1 接受案例，沒有「較高下限在 3 席 chain 上被執行」的測試。程式碼本身有執行（check-phase-review-receipt.js:909）。
- Trigger 原文：「next touch of the seat-coverage rule」。Effort：S。Source：self（MiniMax FOLLOW-UP，core review g4）。
- 沒人追：BACKLOG 無此列。擋別的工作：否。

### C5 campaign-bridge-resolves-lease-identity-from-campaigncontrol-initial-state-corre.md（重要性：低）
- 問題：`campaignControl.initial_state` 名稱說「initial」實為即時 replay 狀態，改動 appender 時可能默默失效；建議改名 `live_state`，並加端對端 BOUNDARY_REJECTED fixture。
- Trigger 原文：「any change to `recordCampaignEvent` / the campaign event appender that stops assigning `campaignControl.initial_state = appended.state` (`src/engine/autopilot-engine.js:~4557`), or a second appender path that bypasses it.」Effort：S。Source：self（rail-fix qc panel 2026-08-30）。
- 沒人追：HEAD 三處仍賦值 initial_state（autopilot-engine.js:3173, 5082, 8371），沒改名。端對端 fixture 部分已有 v2.36.112 的 boundary e2e 覆蓋。擋別的工作：否。

### C6 governance-cli-ux-polish-experience-critic-findings-v2-34-13-dogfood.md（重要性：低）
- 問題：五支治理 CLI 的拒絕訊息只講條件不給修法（decision-ledger veto「no decision 'x' in the ledger — nothing to veto」不列可否決清單）、usage error 無 flag 級範例；`next-pick parse` 的 envelope 缺口已有 schema_version。
- Trigger 原文：「下一次動五支治理腳本任一時捎帶;或 critic 再報同類。」Effort：S。Source：self（v2.34.13 KR5 dogfood，GLM-5.2 critic）。
- 沒人追：BACKLOG 無此列；decision-ledger.js:249 與 next-pick.js:69 的訊息仍是原樣。擋別的工作：否。

### C7 v2-36-112-review-follow-ups.md（重要性：低）
- 問題：v2.36.112 review 的 🔵 殘項。已解：run.sh summary 會顯示 SKIP（run.sh:576）、Row E 已關。仍開：`RUN_LEDGER_MAX_ROTATIONS` 仍從 sweep 環境讀（run-ledger.sh:2817）；verify-red-green 對逃出 repo 的 symlink 的拒絕；B3 拒絕碼無測試釘住；`finish_reason=length` 且內容為空白的案例；seat sweep 對 terminal 不看鎖、TERMINAL_EVENT_TYPES 與「abandoned」事件的詞彙核對；註解過期。
- Trigger 原文：「next touch of the respective file.」Effort：S。Source：self（逐列 review 與合併 review）。
- 沒人追：HEAD 無追蹤。擋別的工作：否。

### C8 live-state-dir-leftovers-multi-row-findmnt-040-only-unescape-per-process-ssd-war.md（重要性：低）
- 問題：四項 🔵 殘項中前三項已修（findmnt 多列 live-state-dir.js:99-101、/proc/mounts 逸出 :129、200K 窗口測試）；第三項「無 findmnt 且無 /proc/mounts 的主機上，退回 ~/.autopilot 的警告每次 hook fire 都印一次」未修：:288 的 warn 沒有去重（只有 override 路徑有 `warnedOverrides`）。
- Trigger 原文：「a host with neither findmnt nor /proc/mounts (macOS, unverified) where the SSD warning is observed once per hook fire」。Effort：S。Source：self（v2.36.1 pre-merge review）。
- 沒人追：BACKLOG 無此列。擋別的工作：否。

### C9 pin-store-hardening-fsync-orphaned-temp-files-and-re-validation-of-stored-rows.md（重要性：低）
- 問題：(a) fsync 與 (b) 孤兒 tmp 清理已做（scripts/lib/jsonl-store.js:153,168,208,215）；(c) `readPinRows`（engine-capability-state.js:914）仍不對可解析的列做 schema 驗證，手改過的列（expires 放日期、多一個鍵）會被讀回並在下次 snapshot 寫回（`validatePinRow` 只在 build 時用，:994）；(d) `--role ''` 視為未指定，維持原樣。
- Trigger 原文：「a report of a `pins.jsonl` lost or corrupted by power loss (not a process kill), a store directory accumulating `.pins.jsonl.tmp.*` litter, or the first consumer that reads the pin store without going through `readPinRows`.」Effort：S each。Source：self（depth-0 QC panel 2026-09-11, GLM-5.2）。
- 沒人追：BACKLOG 無此列。檔案 0600 且 operator 自有，CLI 輸入造不出壞列。擋別的工作：否。

## 未確認清單

- `managed-campaign-intake-a-rejected-intake-sometimes-releases-the-mission-claim-a.md`：四個子問題中，(2) repair 死結（v2.36.71 repair_lineage digest 對稱化）與 (3) awaiting_disposition resume（v2.36.41）有 CHANGELOG 證據；(1)「mission_grant_ref_mismatch 的拒絕不釋放 claim」無法驗證——該錯誤碼在 src 已不存在，我沒找到等價的拒絕路徑，不能斷言已修；(4)「repair grant 要在 merge 後取」的陷阱沒找到文件化位置。需要有人讀 campaign-intake.js 的 claim 之前／之後拒絕路徑才能定案。

另外，C1 (a) 是否已被 v2.36.71 部分覆蓋，需取 openclaw 的 ledger 才能重現。

## 產物

- `/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/blaudit/g/sidecars.tsv`（95 行：檔名、類別、證據）
- `/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/blaudit/g/REPORT.md`
- `list.txt`、`all.txt`（刪除前全文串接）、`map.js`（分類產生器）為中間檔。
