# Astra — R1 修正確認（限定 A01–A12 與修稿引入的重大問題）

日期：2026-10-03
審查者：astra（owner 指定 GPT-6-Astra / xhigh）
R1：/tmp/claude-1000/-home-cookys-projects-autopilot/b6a5e0d8-0ed5-452c-851f-829091022bc1/scratchpad/plan-2026-10-03-mods-visible-dispatch.r1.md
SHA256：e5192f1e69620bfc67a0501ac23c31588431d4aab5dc8e0c9fe2f4ca4e468537
對照：/tmp/autopilot-astra-mods-r0-review.3wlEQg/review.md

結論：7 條到位、5 條部分到位、0 條未到位。R1 新引入 2 項 🟠 Major，未發現新 🔴 Critical。兩項新問題分別落在 A05、A07 的修正內容內，下方分開命名方便處置，不另增 review phase。

「到位」指計畫已補上原 finding 所要求的設計／驗收契約，不表示實作已測通。本次只對照 R0 findings 與 R1 修改；少量讀取既有 cost/context/session-mode 來源核對新增引用，沒有從頭重審，也沒有執行派工、benchmark 或改 repo。

## 逐條確認

| Finding | 判定 | R1 段落／行號 | 確認與殘留 |
|---|---|---|---|
| A01 身分與 deliverable/attempt | 到位 | §2.5 L24；§2.7 L40–51；§4 P4 L140、144；§8 D3 L178 | 兩種 campaign namespace 分列；root 為 job；Work Order key 與 deliverable 關聯有表；README display-only；移除 branch@start-sha；補雙 attempt/README 變更負對照。 |
| A02 receipt 綁定與驗收層級 | 到位 | §2.5 L25；§2.7 L49；§4 P1b L102–104、110 | 移除任意 --results；task 結論沿用 status task；review gate 另表；舊 candidate、錯 root、衝突、accepted 但未收尾均有處理／負對照。 |
| A03 scope／writer／公平探測 | 部分到位 | §4 P0 S2 L81；P1a L93–99；P1b L105；P1c L113 | manifest scope、scope lock、輪轉探測已補；但不同 root scope 仍共寫 project 級 SSD 退路與 index，鎖域未跟共享輸出對齊。見 R-A03。 |
| A04 producer 生命週期 | 部分到位 | §3 L58、61；§4 P0 S2/S5 L81–82；P1a L97–99；P1c L113、117 | mod 改為只讀，移除 desktop spawn 假設；但 setsid/nohup watcher 的退出、故障後恢复及最後 reader 離開的政策未定，S5 只測 mod timer。見 R-A04。 |
| A05 頁面更新與 bundle | 部分到位 | §4 P1b L105–110；§8 D1 L176 | 四種觸發、debounce、bundle 複製、保留政策、refresh 負對照已補；發布目錄拓樸不可照字面實作，新問題 N01；project index 鎖另見 R-A03。 |
| A06 freshness／重播契約 | 部分到位 | §2 KR5 L20；§2.5 L26；§4 P1a L94–98；P1c L117；P4 L141；§6 L161 | 三時間、watch envelope、固定時計／canonical 比對已補；progress heartbeat 僅限 live run，idle/blocked 的活 producer 仍會過期；runs heartbeat 間隔等於有效期。見 R-A06。 |
| A07 idle 關聯／解除 | 部分到位 | §4 P3 L133–137；P4 L141–144 | repo/root/session、supersede、clear、inputs 已補；多 session 聚合新規則可把互相衝突的宣告提升成 project idle，新問題 N02。 |
| A08 benchmark 負對照 | 到位 | §2 KR3 L18；§4 P0 S6 L83；P2 L124–127 | 已知延遲正對照、實際 hook 數為零的對照、enabled≈zero 合法，原 finding 的錯誤預設已移除。 |
| A09 cost/context scope 遺漏 | 到位 | §2 KR1 L16；§3 L62；§4 P1c L114、117 | P1 band 與 KR 已補，session 與 host 累計分開，sid/as_of/缺值有描述，雙 session 負對照已補。 |
| A10 第二 plugin 自動退路 | 到位 | §4 P0 L87；§8 D4 L179 | S1=no 保持 classic、mod unavailable；第二 plugin 成為獨立決策，不再視為等價退路。 |
| A11 null/0 與副作用驗證 | 到位 | §2 KR5 L20；§4 P4 L143 | 改為 projector fixture 斷言 null/有效零，以及 child_process/PATH fake 記錄呼叫；不再假裝 integer|null schema 能辨識 unknown。 |
| A12 兩軸 enum／計數 | 到位 | §2.5 L25–26；§4 P1b L104、110 | execution 與 acceptance enum/展示映射、索引分列、未收尾標記均具體；保留來源 unknown，null 只適用新投影缺值。 |

## 尚未收斂的原 findings（保留原嚴重度 🟠）

### R-A03：scope lock 尚未涵蓋共同輸出

R1 §4 P0 S2 L81、P1a L96、P1b L105、P1c L113。

root A 與 root B 有不同 scope_key，兩者各自取得 flock 是合法的；但 SSD fallback 仍只有 ~/.autopilot/review/<project_key>/live/runs.json。兩份不同 root 快照可以輪流蓋掉它。專案 index 也用「同 scope lock」重產，不同 scope 的 lock 不能序列化同一個 index 的發布。原先要求的「同 repo 兩 root」測試尚未覆蓋這兩個共同寫入點。

最小補正：SSD fallback 也按 scope 分檔，reader 核對 envelope.scope；project index 用 project 級發布鎖，或交由 project 級唯一 producer 重產。增加兩 root watcher 並行的測試，驗證兩份 fallback 與 index 不交叉或漏列。既有兩個 watcher「同 scope」測試保留。

### R-A04：將 child 移出 mod 後，還需要界定 watcher 本身的生命週期

R1 §3 L61；§4 P0 S5 L82；P1a L97–99；P1c L113。

flock 防止重複 writer，但不會處理獲鎖 child 在 set 返回後退出、最後 session 結束後仍跑、或第二 session 因 writer_busy 退成 reader 後如何恢復。R1 能顯示 stale/unavailable，這部分已補；尚缺 producer 的停止／恢復契約與真實啟動路徑測試。S5 現在驗的是 mod clock，沒有驗 session-mode 啟動的 detached watcher。

最小補正：明訂是按 project 常駐還是按活躍 session 存活，指定退出條件與失敗後恢复方式；可以明確採手動重啟與 band 指引，不必新增 service manager。負對照沿用 A04：啟動即退出、已有 writer 死亡、兩 reader 剩一個、最後 reader 離開。驗 session-mode → producer → envelope 的真實路徑。

### R-A06：idle/blocked 的健康 producer 仍可能 stale

R1 §4 P1a L96；P4 L141；§6 L161。

progress 心跳現在只在「有 live run」時重發。因此專案宣告 nothing_left 或 blocked_on_owner 後沒有 live run，即使 watcher 還活著，300 秒後仍 stale；與 §6「stale 只在 producer 死後」不符。runs envelope 的 heartbeat=60s、valid_for_s=60，排程稍延遲就會在正常 heartbeat 間隔標 stale。

最小補正：對仍在被觀測的 project，idle/blocked 也持續 heartbeat；或明訂它们為靜態快照、如何表示 freshness，修改相應保證。heartbeat 間隔應留有效期餘裕。補 fake clock：無 live run 但健康 observer、producer 停止、心跳排程有小延遲，各自得到預期狀態。不要把發布時間更新當成尚未重查來源的新觀測。

## R1 新引入的 🔴／🟠

### N01 🟠 Major — .next 在待替換目錄裡，無法照所列步驟原子發布

R1 §4 P1b L105（A05 修正新增）。

候選位於 <out-root>/<date>/<job>/.next/，卻要求「原子 rename 成 <job>/、舊版改 <job>.prev/」。若直接把 .next rename 成它的父目錄，目的地非空且包含來源，不能用普通目錄 rename 完成。若先把 <job> 改名為 <job>.prev，.next 也一起搬走，原來源路徑便不存在；兩次搬移也不是一次原子發布。

最小補正：候選先放在與 job 平行的目錄；定義可行的發布切換。需要持續可讀的原子切換時，可用不可變版本目錄配原子替換的 current symlink／指標。若只採兩次 rename，需明訂缺頁窗口、失敗 rollback，不能聲稱全程原子。以首次發布、第二次更新、切換中途失敗三種情境驗證。這是發布步驟問題，無需新增 phase 或影像依賴。

### N02 🟠 Major — 新的 any-declaration 聚合會把衝突 session 判成整個 project 閒置

R1 §4 P3 L134、137；P4 L142（A07 修正新增）。

新規則明確寫「至少一宣告 nothing_left 未被 supersede 且 runs.live=0」就 idle.declared=true。例：同 project/session A 宣告 nothing_left，session B 隨後宣告 blocked_on_owner，兩者都無背景 run，也沒有新 manifest/set/retire 來 supersede A。按此公式 project 仍 idle=true；若 idle.reason 選 nothing_left，P4 就替需要 owner 的專案出重排提案。R1 只測「單獨 blocked_on_owner 不觸發」，沒有混合宣告測試，也沒有定義 reason 的衝突選擇。

另須明訂 runs.live=0 是「已確認沒有 live」；如果只是 confirmed-running 的計數為零，未知／未探測 run 不能因此變成無工作。

最小補正：保留各宣告 scope，定義 project 層的 owner-blocked/budget/conflict 處理；不能讓 any nothing_left 擊穿另一個仍有效的阻塞宣告。重排只消費無衝突、與當前執行根匹配且已確認無 live 的狀態；有未知資訊就顯示 unknown/衝突。補「nothing_left + blocked_on_owner」、「nothing_left + budget」、「nothing_left + 未探測 run」負對照。這只是修正聚合規則，不授權新的排程或狀態裁決系統。

## 交回建議

在原 R1 段落修 R-A03、R-A04、R-A06、N01、N02 即可；不用重新展開整份 plan。A01/A02/A08/A09/A10/A11/A12 不因這次確認重開。

