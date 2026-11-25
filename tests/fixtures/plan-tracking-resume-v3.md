# 多 lane 計畫的機械追蹤與 PM 席 /clear 接續

- 狀態：第三版。先盤點既有計畫與零件，再定整體架構(fable 5.2 出稿),最後才排 phases。第二版(0948ed9a)的骨架被推翻，原因見 §3 第 1 點、§6 第 1 點。
- owner:PM。日期 2026-11-25。
- 來源：操作員 11-25 的原話:
  - 「怎樣驗收才能確保不漏?文件上做 check list 對工單?還是有更系統化做法?fleet pm 能處理嗎?」
  - 「多 lane 計畫這種要怎樣整進系統機制裡面機械檢查並讓你 clear 後可以正確 resume」
  - 「單派出去你被 compact 完後就不記得了?我們老是遇到這問題」

## 1. 目標與不做的事
- 目標：跨 lane 的計畫，每一項都可以由機器回答四件事：
  1. 有沒有單。
  2. 做完了沒(有沒有綁版本的驗收收據)。
  3. 目前仍生效的裁定有哪些。
  4. 計畫原文的承諾有沒有漏抄進表。
- PM 席 /clear、compaction 或重開之後，只看 `fleet pm resume` 的輸出，就能接上所有在途項目。
- 驗收(端到端，實跑 pm:knowledge/plans/2026-11-25-fleet-routing-mechanization.md,跨 pm、autopilot、fleet、capacity 四條 lane):
  1. 負控制：用 cancel 拿掉一張子單，coverage 報漏；刪掉表裡一列但保留原文承諾，coverage 點名漏掉的承諾編號。
  2. 補回後，coverage 的覆蓋缺口為 0。
  3. 先從凍結列和 hub 事件建一份帶序號的預期清單，裡面故意放已知漏單，以及兩則同時生效的裁定。接著 PM 席實際 /clear,保存新 context 第一回合只靠 resume 列出的項目和下一步，用同一組序號逐項比對，0 漏。
- 不做的事：
  - 不另開 PM 筆記或第二套台帳；每種狀態只有一個正本(§4)。
  - 不做 hub 的管理後門。
  - /clear 的執行端只有 courier(§6 第 4 點)。

## 2. 今天的失敗(證據)
| # | 輸入或狀態 | 錯誤結果 | 證據 |
|---|---|---|---|
| F1 | 路由計畫 §11 有 16 項，寫成文字後由 PM 手派 | 沒有任何機器知道有沒有漏派 | 路由計畫 49b75cbe |
| F2 | compaction 後跑 `fleet pm resume` | 頭部 12,554–15,065 字被截到 3,000,只剩 id;`UNLANDED 缺` | 本 session resume 輸出;fleet pm_resume.rs:40,542-548 |
| F3 | PM 的裁定只寫在聊天裡 | compaction 摘要和 handoff 各漏一部分 | fable 評估：handoff 23 分鐘就漏九張單 |
| F4 | 單結了就算完成 | pane 改善版合併了卻沒上到操作員的 pane,沒人發現 | codeforge 01M889SR1X |
| F5 | 換了 session 的席位 | 舊單 accept 或 cancel 失敗 | 01M88RCTN2;fleet 查明 courier 本來就用 seat 比對，問題在 requester 端舊版 courier 本機沒有這張單 |
| F7 | 已手派的單無法認領 | 再跑一次就重開 | autopilot:scripts/check-plan-phases.js:19 |

- 原本的 F6(只能指定一個 assignee)已不成立：plan-to-tasks 已有 `PLAN_TO_TASKS_ASSIGNEE_MAP`(autopilot:scripts/plan-to-tasks.js:10)。


## 3. 既有計畫盤點(先看過去有什麼)
- 範圍：pm、autopilot、fleet、hippo、hangar 裡和「單、計畫列、收據、裁定、等待、決策卡、接續、巡查」有關的計畫、已上線零件和在途單。
- 數量:pm 39 列(8 個重疊群組，10 項答應退役但還在)、fleet 28 列(5 處矛盾)、autopilot 約 25 項零件。逐列原稿含主機字樣，不進 repo,以 fleet blob 附給審查者。
- 盤點出的重點：
  1. fleet 現行程式有三件事推翻第二版：queued 單不上 hub、`enqueue` 沒有 parent、取消 queued 單會直接刪列。
  2. 八種狀態大多在 11-20 的分工表就有正本了(`plans/2026-11-20-pm-system-integration.md:17-25`,`pm-sop.md:273` 標為操作員定案)。問題出在答應的退役沒做。
  3. autopilot 的交接內容有四套零件，彼此重疊、沒有共用格式：state-checkpoint、session-handoff、handoff skill、pm-resume。
  4. plan-to-tasks 和 finish-triage 已合併，但只有手動探針在呼叫，沒有 hook 或 skill 驅動。
  5. 沒有任何零件把 PM 的裁定寫回單上，也沒有零件能在 resume 時把裁定讀回來。
  6. 巡查有三套：fleet patrol、pm 的 patrol 腳本、autopilot 的 pm-switchboard。派工守門有兩支：work-order-guard、dispatch-class。
  7. system-remediation 追蹤表本身就是第二套台帳，而且狀態已過時(W2 仍標 open,但 fleet `b3ab4fa5` 已合併)。

## 4. 架構：每種狀態一個正本
- 骨架：計畫列不預建 queued 子單。
  - 每份計畫開一張已發佈的一般父單，requester 是 PM。
  - 列清單的正本是凍結的計畫檔。
  - 子單到可以派的時候才建，用一般 dispatch 帶 `--parent`,不帶 `--queue`。
  - 還沒開跑的列，裁定掛在父單上並標列號。
- 下游推進採對帳式：sync 每次重算「前置已驗收、沒有生效中的 hold、還沒有單」的列，再補派。
  - `result_reported` 本來就要 requester accept,PM 一直在迴路裡，所以 queue 加 after 沒有多出自主性。
  - 斷線重連後重算一次即可，不依賴單次事件。

| 狀態 | 唯一正本 | 誰寫 | 誰讀 |
|---|---|---|---|
| 單 | hub 上的 fleet task | courier | 所有人 |
| 計畫列 | 凍結計畫檔的 phases 表，身分是 (repo:path, phase),不含 sha;父單只記 revision 和 sync 快照 | 計畫 owner;快照由 autopilot 的 sync 寫 | sync;resume 只讀父單快照 |
| 收據 | 該列子單上的證據事件 | 只有 requester 側的 finish-triage,工人自寫的不算 | resume、sync |
| 裁定(原話、理由、取代關係) | hippo store,標 `task:<id>` 和列號；單上只留一則帶 hippo id 的 ruling 留言 | PM,經 `scripts/ledger.sh` | resume,經 rulings.sh |
| 等待條件 | 已開跑的列：子單的 typed waiting_on。未開跑的列：父單上帶列號的 hold 裁定 | assignee 或 PM | patrol、resume、sync |
| 決策卡 | fleet decision,入口只有 `open-decision.js` | 操作員的答覆經 courier | resume、等待的那一席 |
| go 帳 | pm 的 hippo store | 只有 `ledger.sh` | PM |
| 接續現況 | 不儲存，由 `fleet pm resume` 即時算出 | 沒有人寫 | 每一席開場 |

- handoff 不是任何狀態的正本，只放別處沒有家的東西：
  - 對話脈絡(operator_thread)。
  - 子代理的產出(subagent_outputs)。
  - 卡號和單號。
- 接續表的 `pending_rulings` 在清空前必須是空的，還沒落地的裁定要先寫進 hippo。

## 5. 退役(留下哪個唯一入口)
| 群組 | 留下 | 退掉什麼、在哪一步 |
|---|---|---|
| 1 接續 | 工作狀態只看 `fleet pm resume`;handoff 只留對話殘留 | S0:PM 不再讀 PM-STATE。S5:autopilot 的 state-checkpoint 和 session-handoff 只留一行狀態，四套交接零件收成一套；沒有呼叫端的 pm-auto-handoff、checkpoint-coverage 在 S5 接上或刪除 |
| 2 /clear 執行端 | 只有 courier 執行 | autopilot 的 pm-auto-clear-resume Phase 2 取消；hangar 的重開腳本照 fleet 重啟計畫 P6 退役 |
| 3 轉單與收據 | 匯入只走 plan-to-tasks,驗收只走 finish-triage | S3、S4 接線。stage-graph 計畫和 fleet task-system-v2 在 S0 標「不做」 |
| 4 在途清單 | 人看 `fleet pm resume`(含計畫段),機器看 `pm status` JSON,兩者共用同一個函式 | 不新增 `fleet pm plans`。S3:plan-audit.js 併入 sync、initiatives.sh 改成查父單、remediation 表的手寫狀態欄刪掉。S0:PM-STATE 退役 |
| 5 裁定 | 正本在 hippo,寫入只走 ledger.sh,讀取只走 rulings.sh | fleet 不加 active/superseded 欄；hippo M6 裡「計畫狀態、handoff 進 hippo」那部分不做 |
| 6 巡查 | 偵測規則只放在 fleet patrol | pm 的 patrol 腳本、chase-stale.py、pm-switchboard.js,在 fleet 版上線並連兩天沒漏之後一起退。lead-watch 只留處理程序，不做偵測 |
| 7 決策卡 | 正本是 fleet decision | 遷移歸 autopilot 的 decision-card-reliability 計畫；本計畫只要求 resume 讀單一來源 |
| 8 守門 | 派工守門只留 fleet-send-work-order-guard(pm 這邊的 plan_gate 已在 fd3ef28a 退掉) | fleet-dispatch-class.js 和 pm 剩下的三支 hook,依 14 天命中報表決定退役，最早 12-09;退役前先重播原本的失敗案例 |

- 答應退役但還在的十項：
  - S0,PM 做：PM-STATE.md 的開放項轉單後凍結，`CLAUDE.md` 和 `pm-sop.md` 裡的指向移除；watchlist 讀取端刪除；`knowledge/roles/pm-aide.md` 刪除。
  - S0,autopilot 做:cost-fuse.js 刪檔。
  - 其餘：S3 退 plan-audit、initiatives;S5 退壓縮 hook 快照和 hangar 重開腳本；手寫 metrics.md 在排程上線當天停；open-decision 自有卡片帳歸群組 7。
- 以上都屬 tier 0,git 留有歷史。

## 6. 衝突裁決
| # | 矛盾 | 裁決 |
|---|---|---|
| 1 | fleet 現況(queued 不上 hub、enqueue 沒有 parent、cancel 刪列)對第二版 §4.1、§4.2 | 計畫列不用 queued(§4)。plan-to-tasks.js:307-309 同時傳 `--parent` 和 `--queue` 的行為待查。cancel 不留痕的問題進 fleet backlog,不當本計畫的前置 |
| 2 | 裁定正本：第二版寫在單上，分工表和 hippo rulings.md 寫在 hippo | hippo 勝。若要改成以單上留言為正本，等於改 11-20 的定案，要開操作員卡 |
| 3 | handoff 的地位：skill 寫「正式」、SOP 寫「備份」、分工表寫「停寫」 | 統一成一句：handoff 只帶對話殘留，工作狀態看 resume |
| 4 | /clear 執行端有三條路 | courier 執行。上線順序：fleet 的 WAITING_ON_PM/IN_FLIGHT 先上，seat-op-lock rebase 後再一起上 |
| 5 | 第二版把不存在的 `--check` 當成現有零件 | 刪掉這個前提和 F2。resume 只讀 hub 和 hippo,執行時不呼叫 node,不需要修復模式 |
| 6 | 計畫檔分放在 `plans/` 和 `knowledge/plans/` 兩處 | sync 的掃描清單兩處都列。新計畫一律放 `knowledge/plans/`,舊檔不搬 |
| 7 | remediation 表是第二套台帳 | 把它當成一份計畫，轉成 phases 表交給 sync,作為第二個實測對象 |
| 8 | live-case 清冊被說成第二份 backlog,SOP 卻要求繼續加列 | 清冊是偵測器的驗收依據，不是 backlog。每列都要有單號；沒有單的列，轉單或刪除 |
| 9 | gate-fix 說「不事後歸零」,第二版說「測試數 0 判失敗」 | 收據只在驗收前把關，已 done 的列不回頭翻。測試數 0 算「未驗證」:停在 result_reported 並帶 waiting_on,不算失敗 |
| 10 | 判斷 wait 是否有效的邏輯寫了四份，沒有清除 API,升級鏈有三條 | fleet 合成一個核心函式並補上顯式清除，排在 fleet 既有的 W2、W8,不擋本計畫 |
| 11 | done_when 和 next_evidence_due 的定義有歧義；status、console、state-contract 各自輸出 | state-contract 是唯一的輸出契約，resume 和 status 共用同一個函式。由 fleet 做，不當前置 |
| 12 | dedupe 的鍵含標題，W9 卻會改標題 | 計畫列身分放在本文首行的 `Plan:`、`Phase:`,不靠標題 |
| 13 | compaction-continuity 要求「壓縮前擷取」,分工表要求「只留一行」 | 分工表勝 |
| 14 | 多份計畫的檔頭過時 | 各 owner 在 S0 當場更正 |

## 7. Phases(最小順序)
- 每一步的交付，都以 PM 席實際 /clear 一次的結果為證據。被取代的舊零件在同一步退掉。
- S1、S2 可以並行。S3 對 fleet 的前置只有一項：resume 讀得到父單上的留言。S4 到 S6 彼此不擋。

<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| S0P | S | - | test -f log/resume-baseline.json | yes | S0P [執行:pm] 入口收斂：退役 PM-STATE 指向、watchlist 讀取端、pm-aide.md;改 handoff 字句；建帶序號的預期清單，實際 /clear 一次記基線漏項 |
| S0A | S | - | timeout 300 node --test scripts/tests/retired-parts.test.js | no | S0A [執行:autopilot] 刪 cost-fuse.js;handoff SKILL 改成只帶對話殘留；pm-auto-clear-resume 的 Phase 2 標取消；各計畫檔頭更正 |
| LINT | S | - | timeout 300 node --test scripts/tests/plan-inventory-lint.test.js | no | LINT [執行:autopilot] 計畫 lint:機制類計畫必須有「既有計畫盤點」一節，列出重疊與退役；缺了就報錯 |
| S1F | S | - | fleet pm resume --seat pm--claude --role pm | yes | S1F [執行:fleet] 把已合併的 WAITING_ON_PM、IN_FLIGHT、PM 主機舊版誤催修正、dedupe 送上線(PM 給 rollout go);重跑基線：在途單漏 0 項，等待中的單誤催 0 次 |
| S2P | S | - | timeout 120 python3 -m pytest tests/test_ledger_task_ruling.py -q | no | S2P [執行:pm] ledger.sh --task <id> [--row]:寫 hippo,並在單上留帶 hippo id 的 ruling 留言；resume 列出所有生效中的裁定 |
| S3A | M | S0A | timeout 300 node --test scripts/tests/plan-sync.test.js scripts/tests/plan-coverage.test.js | no | S3A [執行:autopilot] plan-to-tasks --sync(父單、身分去掉 sha、不用 queue、偵測 untracked、快照寫到父單)與 --coverage(對原文承諾編號);plan-audit 併入；SessionStart 注入時順便跑 sync |
| S3F | S | S1F | timeout 300 cargo test -p fleet-cli pm_resume_plans | no | S3F [執行:fleet] resume 加計畫段，讀父單快照，和 pm status JSON 共用同一個函式 |
| S3P | S | S3A,S3F | timeout 600 node ../autopilot/scripts/plan-to-tasks.js --coverage pm:knowledge/plans/2026-11-25-fleet-routing-mechanization.md | yes | S3P [執行:pm] 路由計畫 §11 和 remediation 表轉成 phases 表；負控制兩項(取消一張子單、刪一列保留原文)都要報漏，補回後缺口 0;initiatives.sh 退役 |
| S4A | M | S3A | timeout 300 node --test scripts/tests/finish-triage-accept.test.js | no | S4A [執行:autopilot] finish-triage 接進 PM 驗收路徑；收據綁 commit 和目標；合併列和上線列分開；通過後觸發 sync 補派。重播 codeforge pane 已合併未上線那一例，必須顯示未完成並帶 waiting_on |
| S5F | M | S1F,S2P | fleet pm resume --seat pm--claude --role pm | yes | S5F [執行:fleet][協作:autopilot,hangar] PM 席打開 seat-auto-clear(P4)加 seat-op-lock;autopilot 四套交接零件收成一套；hangar 重開腳本退役；自動 /clear 一次，對照預期清單漏 0 項 |
| S6 | S | S5F | timeout 120 python3 scripts/hook-hit-report.py --days 14 | yes | S6 [執行:pm][協作:autopilot] 依 14 天命中數退役巡查群組和守門群組，每項附命中數；退役後一週內同類失敗 0 次 |
<!-- /phases -->

## 8. 不做
- 預建 queued 子單；為了計畫去改 fleet 的 queued 發佈、parent 或 tombstone。
- 新增 `fleet pm plans` 指令；在 fleet 的 ruling 上加結構化欄位。
- 第二版 P1 的裁定 Stop hook。正在退役守門，不再加新的；主路徑改用 S2P 的指令。
- 第二版 F2 的 `--check` 修復模式，以及 coverage 快取檔。
- 收據的完整欄位(運行版本、測試數、side_effect、改版沿用)。等 S4A 跑出真實失敗再加。
- 統一 autopilot 的三種 lane 內部收據；決策卡搬遷；stage-graph;task-system-v2;hippo M6 的流程狀態；舊工單樹；甘特圖；hub 管理後門。

## 9. 待查(問 owner,不擋 S0、S1、S2)
- fleet:
  - 同時帶 `--parent` 和 `--queue` 時，CLI 是丟掉其中一個還是報錯？
  - PM 能不能對自己開一般父單？父單留言有沒有大小上限？
  - resume 的卡片段和裁定段現在從哪裡讀、怎麼印？
- autopilot:pm-switchboard.js 實際查哪些規則？
- hangar:重開腳本現況如何？
- PM:PM-STATE 還有哪些開放項沒有單？派便宜引擎掃一次。

## 10. 審查紀錄
- 第二版三家審查(fable 5.2、astra 6.2、neon)的處置見 0948ed9a 的 §9。其中「Stop hook」「--check 修復模式」「預建 queued 子單」三項在第三版撤回，理由見 §6、§8。
- 第三版：先盤點(pm、fleet、autopilot 三份),再由 fable 5.2 出整體架構，下一步送審時附上盤點表。
