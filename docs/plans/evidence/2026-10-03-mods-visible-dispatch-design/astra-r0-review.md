# Astra — Mods visible-dispatch plan R0 review

Reviewer: astra（owner 指定 GPT-6-Astra / xhigh）
Date: 2026-10-03
Review type: R0 advisory review，供作者修稿；不是正式 G1/G2 gate receipt。
Plan: /tmp/claude-1000/-home-cookys-projects-autopilot/b6a5e0d8-0ed5-452c-851f-829091022bc1/scratchpad/plan-2026-10-03-mods-visible-dispatch.md
Plan SHA256: 6f43308d175e79a7ce96c77781095d47c260d64fdee119e83cb0ddee273b7723（163 行）
Repo HEAD observed: 9ebea9280636b7633e91399fae39cfbf6e53e88a

結論：建議修 R0 後再送正式 review。方向支持：既有事實投影、沿用 status runs、receipt 才提供驗收結論、renderer 不決定 gate、視覺 diff 留給專案。主要缺口是關聯契約與生產者生命週期；目前有幾條 happy-path fixture 可以全過，但真實多專案、多回合、長任務仍會顯示錯誤資訊。

本次唯讀核對 plan、inputs.md、三份 research 的相關內容，以及 status/dispatch/controller/task receipt/benchmark 程式。沒有跑真實派工、benchmark 或 mods runtime；沒有改 repo。下列負對照是建議加入的測試，不是已執行結果。只在 /tmp 寫本 review。

## Findings

### A01 🟠 Major — 身分契約未串到 deliverable / attempt，campaign 亦非單一 ID 空間

Plan：§2.5 L24；§4 P4 L120、123；§8 D3 L159。

「只用既有 ID」方向對，但欄位清單只有 root_run_id/run_id/campaign_id/logical_plan_id；尚未指定 project、round、deliverable、attempt 如何 join。現有 src/engine/controller-execution.js:1626–1648 的 canonical Work Order 使用 root_run_id + graph_node + attempt，並有 work_order_id；src/status/task-runtime.js:87–116 明確區分 mission_campaign_id 與 icc_campaign_id。controller progress receipt 本身還有 deliverable_id、generation、frozen_denominator_digest（controller-execution.js:451–498）。這些不能折成一個模糊 campaign_id 或 phase 名稱。

P4 把 controller progress → ledger stage → README phase 當同一欄位的替代來源，卻沒有語義對照。README phase 是文件結構，stage 是程序/gate，未必等於 execution deliverable；把它們拼成同一分母，會在 retry 時增加完成單位。branch@start-sha 也會把同 branch、同起點的兩次獨立執行合併；--branch 應是 selector，遇到多個 root 應列候選或要求消歧。

修法：在既有輸入/輸出契約補一張欄位來源及關聯表，保留各 ID namespace；round 的 canonical key 與 campaign/dispatch 的關係明訂。deliverables 保留原 graph ID，attempt/repair/gate 掛其下；README phase 留 display-only，缺權威分母時 percent=null。沒有既有 round ID 的流程，明訂最小持久關聯 metadata 或顯示 unbound，不能用 branch 猜。
負對照：同 branch/SHA 兩 root；同 deliverable 兩 attempts；Mission 與 ICC ID 不同；README 改標題/分段後，執行 ID、分母與結果歸属不變。

### A02 🟠 Major — receipt 路徑＋verdict 不足以代表這個回合的驗收

Plan：§2.5 L25、29；§4 P1b L84–87、91；§4 P4 L125。

--results 是任意 receipt 路徑清單，只抄 verdict，沒有驗證它對應目前 project/root/attempt/candidate commit，也沒有定義多份 receipt 不一致時的顯示。舊 commit 的 PASS review 或其他回合的 PASS 可以被放在本 job 頂端；review gate PASS、task acceptance、task closeout 也可能混成單一 PASS chip。

現成入口已存在：autopilot status task --root-run-id <id> --json（src/status/cli.js:432–445）；collectTaskStatus 與 buildTaskStatus 負責 task 狀態投影。schemas/task-status.schema.json:8–34 包含 repo_identity/root_run_id/candidate_commit/candidate_tree_sha/acceptance_verdict/can_merge/can_close。acceptance_verdict 的值是 accepted/rejected/unknown，不是泛用 PASS/FAIL；接受候選不等於已收尾。應明確复用這個來源，避免 renderer 再做一套 task aggregation。

修法：結果保留 receipt kind、scope、bound IDs、candidate SHA/tree 與出處；透過既有讀取/驗證介面取得 task 結論。review receipt 顯示成該 gate 的結果，只有匹配的 task-level receipt 提供 task acceptance/closeout；缺失、衝突、舊候選都明示。renderer 可以轉譯顯示文字，但不得自行提升權限層級。
負對照：rc=0 無 receipt；錯 root PASS；舊 SHA PASS；review PASS 但 task rejected；acceptance accepted 但 can_close=false；同 scope 衝突 receipts。

### A03 🟠 Major — live 輸出缺 project/scope 隔離及單一 writer 規則

Plan：§3 L42、45；§4 P1a L79；§4 P1c L94；§6 L138。

dispatch-status 預設 manifestDir 是全機共用的 /tmp/autopilot-dispatch-runs（scripts/dispatch-status.js:76–79）；--list 未按 repo 過濾。P1c spawn argv 沒有 project/root selector；每個 session 都起 watcher，卻預設寫 runs/all.json，並共寫同 project 的 live/runs.json。兩個 session 即使各自 atomic rename，仍可輪流覆蓋不同 scope 的有效快照；atomic rename 不等於 writer ownership。

此外，collectRuns 現在從固定順序選前 8 個 live run（src/status/cli.js:152–178），--list 依 started_at 升序。單純把 cap 參數化仍會永久略過第 9 個 run 的 liveness，不能承諾它在 15 秒內可被正確觀察。也要注意 --list 實際不含 epoch/ledger/stage/final_status（dispatch-status.js:899–911）；新欄需要明確讀取 manifest，不能假設 enriched row 已有。

修法：定義穩定 project key 與執行 scope，watcher 的輸入、輸出和 reader 都帶相同 scope；選擇每 scope 唯一 writer，或每 session 獨立檔後由既有 CLI 聚合。enrich 採有界輪轉/公平取樣，未探测欄位為 unknown，不能算成確認 running。
負對照：兩 repo、同 repo 兩 root、兩 session 同時啟動/退出；9 個以上 live rows，最後一個的狀態變化能在明訂時限內被看到；未定 project 的 session 不把全機資料標成當前專案。

### A04 🟠 Major — mod watcher 的啟動與存活尚未被 P0 驗證

Plan：§4 P0 S2/S5 L68、71；§4 P1c L94–98。

P0 測 fs 可讀與 UI mount，不驗證 P1c 真正依賴的 spawn → 持續寫檔 → reload → 重接。研究報告 Part 1 明示 $.process 是 CLI-only，spawn 是 async generator，child 跟其迴圈生命週期相關；桌面能 mount band 並不證明它能起 producer。這是研究檔所載能力邊界，本次未獨立實測 mods API。

只在 $.state 記 pid 也不足以避免失效：舊 child 已退出、reload 殺掉迴圈、pid 重用，狀態仍可殘留，造成一直不再起 watcher。相反地，沒有多 session ownership 就可能起多支。

修法：把 S5 擴成「每 surface 的完整資料供應路徑」實測，包含 host path、process capability、child 結束/重載處理、取消與重連；缺 producer 時顯示 unavailable/CLI fallback。桌面退路須有實際啟動者，不能僅改讀另一個檔案路徑。
負對照：process API 不可用、child 提早退出、reload、session.end、多 session；Classic hooks 正常，band 不以新觀測時間包裝舊資料。

### A05 🟠 Major — JSON→頁面沒有更新接線，資產也未形成可部署 bundle

Plan：§2 KR1 L16；§2.5 L27–28；§4 P1a L79；P1b L84–90；P4 L123；§8 D1 L157。

目前 watcher 只寫 JSON，renderer 只是可手動執行的腳本；沒有誰在派工/階段/結果變化後觸發 render 和專案 index 更新。即使每 10 秒 JSON 都更新，無 JS 的 HTML 仍不會改，瀏覽器重新整理也只拿到舊檔案。這無法完成「回合內同步成 owner review 網頁」。

served root 刻意與 checkout/evidence 分開是合理的，但所有 img/a 都要求相對路徑，原圖又可能在原 evidence 位置；沒有明訂將選定資產複製進 served bundle 的步驟。D1 的 path+sha256 是可定位/比對資訊，不會保存原圖 bytes，也不保證之後可重建。

修法：在現有 P1b/P1c 中指定明確觸發者、debounce、成功後發布順序與失敗保留舊頁規則；不用另開 phase。bundle 收入需展示的資產（使用普通檔案複製即可，不必引影像庫），定義相對 URL 和保留政策；durable 匯出與可清理 live 檔分開。
負對照：已開頁後 run 結束/receipt 到達，再 refresh 就看到新內容；兩 job 同時 render 索引不漏列；來源原圖搬走後已發布 bundle 仍可讀；生成半途失敗不把索引指向半成品。

### A06 🟠 Major — milestone-only 更新與 300 秒 freshness／byte-identical KR 互相衝突

Plan：§2 KR5 L20；§2.5 L26–27；§4 P1c L98；P4 L121、124。

progress.json 只在里程碑/declare-idle 更新，valid_for_s 卻固定 300。持續 40 分鐘的健康派工，五分鐘後就 stale；如果用 periodic generated_at 更新維持 freshness，「兩次無變更 byte-identical」又必然失敗。cockpit study §6 原本明訂 emit-on-change 加 heartbeat；R0 漏了 heartbeat。

runs producer 說 observed_at，consumer 卻檢查 written_at，沒有共用 envelope 契約。每次讀取只刷新 observed_at 還可能把沒有再探測的來源洗成 fresh。

修法：區分來源事實時間、重新觀测時間、快照發布時間；明訂 live refresh/heartbeat 的 producer，以及 durable milestone 的發布頻率。byte-identical 驗證用固定時計重播同一輸入，或比較排除 freshness envelope 的 canonical payload；不要要求真實 heartbeat 的整檔 bytes 不變。沿用 runs --json 舊有 array 形狀，新 watch envelope 要明訂，避免 additive 聲明下改舊契約。
負對照：fake clock 推進超過 300 秒，活著且完成新觀測的 producer 保持 fresh；停止 producer 後 stale；固定 clock 和輸入才 byte-identical；舊來源未再驗證時不因新讀取時間而變新。

### A07 🟠 Major — declare-idle 沒有解除與 session→project 的關聯規則

Plan：§4 P3 L114；§4 P4 L121–122。

宣告寫在 idle/<sid>.declared.json，project 快照與 replanner 卻按 project 讀取。R0 沒有定義 sid 來源、無 CC session 的 CLI/Codex 呼叫如何綁 project/root、多 session 衝突如何解決，以及何時使舊宣告失效。宣告 nothing_left 後開始新工作，舊檔仍在；重排器只要看到一次 nothing_left 就可能在忙碌專案重新出提案。

另 P4 讀 idle.reason，但列出的 progress/1 最小契約沒有 idle 欄位；budget 宣告的投影亦未定義。classic Stop 的「這個 session 沒背景工作」只能是觀察，不代表整個 project 無工作。

修法：宣告帶 project/root/session 身分與有效範圍；由既有開始/恢復事件解除或使舊宣告失效，明訂多 session 的顯示規則；observation 和 declaration 分欄。補齊 progress 欄位與 reason mapping，重排只消费當前適用的 nothing_left 宣告。
負對照：declare nothing_left → 新 run 開始；另一 session 仍 busy；舊 session 重開；缺 sid/缺 payload 欄位；blocked_on_owner/budget 不被當成 nothing_left。

### A08 🟠 Major — P2 的負對照會把有效的「低開銷」結果判成儀器壞掉

Plan：§4 P0 S6 L72；§4 P2 L107–110。

disabled p95 必須顯著低於 enabled，否則測量無效，等於事先排除「hooks 開銷很低」的合法結論；也與 L108 未達門檻就不搬互相矛盾。空 settings 也不足以作為「確實無 plugin hooks」的證據，需量到實際執行的 hook/spawn 數。

既有 benchmark-hook-multiplexer.js:95–123 的 registration selector 只挑 multiplexer 與 opt-in hooks；這確實需要 S6 決定如何覆蓋全部 hooks，不能把該輸出直接標成全 hooks baseline。本次只讀程式，沒有執行成本測試。

修法：用可控的已知延遲 hook/marker 作儀器正對照，用確認 hook/spawn 數為 0 的配置作負對照；容許兩臂差異接近零。釘住相同 tool-call 工作負載，說清楚 p95 是每次 hook 區間還是整個回合，確認 CLI 的 disabled 配置真有效。
負對照：已知延遲可被測出；零延遲/零 hooks 不被當儀器失敗；disabled 還有 hook marker 時拒絕出比較結論。

### A09 🟠 Major — 已定 P1 的 cost/context band 沒有對應交付或 KR

Plan：§2 KR1–2 L16–17；§3 L45；§4 P1c L95。

最初討論列的 P1 是派工面板、成本和 context band、toast；R0 的 band 只有 running/oldest/stalled/last rc。cost 到 P4 只是投影欄位，context 沒有展示交付；P0 讀 context 檔的 spike 也沒接到 P1 功能。

修法：先由 depth-0 對照 owner 已定 scope，若仍包含成本/context，補到既有 P1c 及 KR。沿用既有 live context/cost 來源，釘清 session cost 與每日累計的不同語義；無來源顯示 unknown。若已獲 owner 同意延期，將該 scope 決定寫入 plan，避免實作者誤認 P1 已完整。
負對照：cost/context 缺來源、過期、0 與 unknown，以及兩個 session 不互相借用數值。

### A10 🟡 Minor — S1=no 的第二 plugin 退路不符合已定包裝目標

Plan：§0 L7；§4 P0 L73；P1d L100–103。

owner 要 mods 在 autopilot 本體、易用的一次安裝；S1=no 直接改成同 repo 第二 plugin，沒有說明安裝/發現/更新是否仍一次完成。資料夾留在同 repo 並不等於同一 plugin。這是條件式決策缺口；S1=yes 時不觸發。

修法：先把退路定成 classic 功能維持可用、mod 明示 unavailable；如果要第二 plugin，需另列包裝決策與一次安裝的實測結果，不能把它視為既定等價退路。

### A11 🟡 Minor — integer|null schema 不能拒絕「unknown 填 0」

Plan：§4 P4 L125；§5 L128。

integer|null 合法接受 0，不知道這個 0 是量測所得或 unknown 的替代；目前負對照無法由所寫 schema 成立。grep 不到 dispatch 字樣也不能證明沒有經 helper 執行派工。

修法：缺來源 fixture 直接 assert projector 輸出 null；有效零值 fixture assert 0。若 datum 帶 known/source discriminator，可另用條件 schema 檢查一致性。replanner 的無副作用測試應在 process/fleet/dispatch 依賴邊界設 spy 或 fake，斷言沒有呼叫；grep 留作輔助。

### A12 🟡 Minor — 展示枚舉與雙軸狀態仍有矛盾

Plan：§2.5 L26、29；§4 P1b L85、91；P4 L125。

固定 chip enum 沒有 exited，但負對照要求 RUNNING／exited；已退出但未验收的 run 不應回到 RUNNING。又「unknown 一律 null」若照字面套到原樣保留的 receipt，会與既有 acceptance_verdict='unknown'、dispatch phase='unknown' 衝突。索引混算 PASS 與 RUNNING，也未說明「仍執行但 gate 已 PASS」如何計數。

修法：執行軸保留 running/exited/unknown 等來源狀態，驗收軸單獨標 accepted/rejected/unknown（顯示 chip 可做明訂映射）；索引清楚標示統計哪個軸。null 原則限定新投影中缺失的值，保留已發布來源 enum，避免改既有契約。

## P0 六個 spike 的取捨

- S1：保留。除了最小 session.start + Stop，應覆蓋實際 autopilot package；語法錯的負對照斷言「拒絕/錯誤有記錄、classic 訊號仍發生」，除非實測已證明，不要綁死特定字串 refused。S1=no 依 A10 處理。
- S2：保留但擴成讀「真實 runs envelope」及來源路徑解析。只讀 context 檔成功不證明 runs 來源、大小、權限或 desktop host 路徑相同；fallback 也要實測。與 A03/A04/A06 共用測試。
- S3：40 列 timeline/SVG 不是 P1c 描述的派工表，gantt 又在 §7 排除。除非實際 pane 必須畫該 SVG，降為探索性 spike，不作交付前置。
- S4：終端 Image 顯示沒有出現在 P1c，desktop 也明確不用 Image。保留探索結果即可，不應為未交付的能力額外佔 owner human gate。
- S5：UI fixture loop 有價值，但須加 A04 的 process/host 路徑/重載/取消實測；這是目前六個 spike 最關鍵的缺口。
- S6：保留；依 A08 補儀器校準。整體不必新增一串 phase，把這些檢查放回原有 deliverable 的 gate。

## §8 預設值

D1：方向有條件支持「原圖不必全進 git」。但 ~/.autopilot/review 若可清理，不能同時當唯一 durable evidence。明訂保留政策、bundle 搬移與資產遺失顯示；200 KB 合成圖可作預覽，不取代已引用的原圖。頁面 metadata+sha256 不能重建 bytes。產合成圖若沿用專案輸出就寫明，避免 renderer 被迫新增影像實作。

D2：支持本機為預設、公開發布需明示。P1 可以只交付已驗證的 localhost/LAN 操作流程；不要在 out-of-scope 同時承諾尚未定義供應者與驗收的 --publish-artifact 功能。手機從另一台裝置不能直接訪問主機的 127.0.0.1；390px viewport 預覽與實機 LAN review 要分別寫明怎麼驗。

D3：支持一個「有明確既有 execution root 的 round」對應一個 job，phase/gate/retry 留在它下面。campaign 是否等於 root 必須用現有 binding 證實；不可把 mission campaign、ICC campaign、root 視為同義詞。branch@start-sha 不適合作 fallback canonical identity（A01）。

## 補充：輸入調查已出現新證據

§0 L8/inputs.md 的「沒人有 gantt」已不適合作絕對敘述：共用 fleet inbox 的 revival.3d 回覆 01M40P3H7W3BX8HBQV3PWYKHXN 自述已有 scripts/reports/experience-audit/ 的靜態 gantt/dispatch/status 頁，且 owner 要求每階段更新。這是尚未獨立查證的 peer 報告，宜標為來源，請 depth-0 併入問卷；不能據此聲稱相關程式已在本次核驗。它支持 A05 的更新接線需求，也提供先盤點既有 renderer 的線索。

## 修稿順序建議

先在原有 phases 內補：A01/A02 關聯與 receipt 消費契約 → A03/A04 producer scope/lifecycle → A05/A06 真正更新與 freshness → A07/A08 負對照 → A09 scope 對齊。其他為原段落的小修，不另造執行 phase，也不增建第二套狀態 store。

