# Landing loop UX redesign — hetero author panel (2026-07-16)

Engines: **codex `gpt-5.5`** · **agy `gemini-3-flash`**

Consensus: **REVISE-LANDING** — replace numbered tabs + YOU|SYSTEM lookup with **same-ticket dual timeline** (human always-on vs Autopilot). Full state machine stays on `/demo`.

---

## 1. DIAGNOSIS

- 目前的 01/02/03/04 tabs 仍像「流程狀態索引」，使用者要先理解每一步的內部語意，才看得懂為什麼重要。
- YOU | SYSTEM 雙卡把焦點放在誰做什麼，卻沒有讓人感到「人被綁在椅子上」和「人可以離席」的時間差。
- /demo 的控制流語言滲進 landing，導致陌生工程師看到的是執行模型說明，不是產品價值。

## 2. NARRATIVE SPINE

同一個開發任務，人一直在場會被每個小決定綁住；Autopilot 讓人只定目標與紅線，剩下交給系統推進，只有碰到不能代決的地方才回來找你。

## 3. UX OPTIONS

### Option A:「同一張工單，兩種一天」

How it works  
用左右對照的時間軸呈現同一個任務。左邊是 Human always-on：每段都要回來看、判斷、確認。右邊是 Autopilot：人先設定目標與 no-go，系統一路推進，只有紅線或卡死才打斷。

Content units  
- 起點：你交代目標與不可踩的線  
- 中段：發想、取捨、實作、驗證  
- 打斷點：需要人決定的少數事件  
- 終點：不是「模型說完成」，而是有可檢查的結果

Why better for strangers  
它不需要理解內部狀態名。陌生工程師只要看兩條時間線，就能直覺理解差異：左邊一直回來，右邊大部分時間可以離席。

### Option B:「從盯場到放手的四格劇情」

How it works  
做成橫向四幕故事，而不是 tabs。每一幕都有一個具體場景、一句痛點、一句 Autopilot 行為。使用者往下滑或橫向掃過，就像看產品短劇。

Content units  
- 你不是少了 AI，你是被 AI 一直叫回來  
- 先講目標與紅線  
- 系統自己拆解、查最佳做法、做取捨  
- 交付前用 gate 檢查，不用自稱完成

Why better for strangers  
故事感比較強，文案空間也較大；但時間差的視覺衝擊不如雙時間軸直接。

## 4. RECOMMENDED

Primary: Option A「同一張工單，兩種一天」。

原因：這個 section 的核心不是解釋流程，而是讓人立刻感到時間負擔的轉移。雙時間軸最能把「一直在場」和「可以離席」做成可視化差異。

Delete from current UI  
- 刪掉 01/02/03/04 numbered tabs  
- 刪掉 YOU | SYSTEM 雙卡結構  
- 刪掉像內部狀態說明的段落  
- 刪掉任何 IDLE / INTAKE / ESCALATE / no-go chip dump  
- 保留 /demo CTA，但改成「看完整控制流」而不是補充狀態機註解

## 5. CONTENT SKETCH

### Section Title

你的時間，差在要不要一直坐在那裡

### Section Lead

同一張工單，差別不是 AI 會不會寫。  
差別是每個小規格都要你回來點頭，還是只有踩到紅線才找你。

### Timeline Labels

一直在場  
Autopilot 接手

### Row 1: 開始

一直在場  
你丟一句需求，模型開始寫。  
但方向不清時，它很快就回來問你。

Autopilot 接手  
你先講目標、限制、不能碰的紅線。  
剩下交給系統拆工作、排順序、推進。

### Row 2: 發想

一直在場  
它給幾個方案，你要逐一判斷。  
每個取捨都變成你的即時會議。

Autopilot 接手  
內建做法先用。  
沒有內建，就查業界做法，再用 CEO 視角取捨。

### Row 3: 實作

一直在場  
每個 micro-spec 都等你回覆。  
你一離開，工作就停在半路。

Autopilot 接手  
可以代決的就代決。  
碰到紅線、不可逆決策、硬卡住，才叫你回來。

### Row 4: 交付

一直在場  
模型說 done，你還是得自己查。  
因為「寫完」不等於「驗過」。

Autopilot 接手  
交付要過 gate。  
用測試、檔案、截圖或執行結果當證據，不用自我報告。

### Closing Line

你仍然是負責的人。  
只是不用負責每一次小停頓。

### CTA

看完整控制流

## 6. DEMO BOUNDARY

Only on `/demo`  
- 完整 state machine  
- IDLE / INTAKE / PLAN / EXECUTE / ESCALATE 等狀態名  
- event trace  
- gate 條件細節  
- no-go 如何中斷、恢復、重跑  
- 工程師想檢查控制流時才需要的完整路徑

Landing may show  
- 「目標 + 紅線」這個概念  
- 「只有紅線或硬卡才叫你」這個承諾  
- 「寫完不算，通過 gate 才算」這個原則  
- 一個高層次的任務旅程  
- CTA 引導想深挖的人去 `/demo`

## 7. VERDICT

REVISE-LANDING

目前不是內容錯，而是視角錯：landing 要賣時間負擔的轉移，不要展開內部狀態表。


## Agy summary (file-write mode)

- Parallel timeline (always-on interruptions vs autonomous + single verify gate)
- Landing ≠ state machine appendix
- Verdict: REVISE-LANDING
