# Autopilot — narrative freeze（對話濃縮）

Status: **FROZEN 2026-07-16** after multi-engine panel (codex gpt-5.5 / gpt-5.6-sol · agy · MiniMax-M3 · glm-4.7)  
Audience: product site `website/` + anyone joining the project

---

## 1. 核心精神（一句到三句）

1. **Remove human from the loop** — 人盡量不待在中間覆核地獄。  
2. **多元** 讓 **CEO agent** 做選擇時比單人／單模型更完整（survey、think-tank、research-to-ship、multi-engine）。  
3. **收斂** 在執行跑歪時把路拉回（peer 審、眾議會、機械閘、artifact 真相）。  

CEO agent **不是**叫人當 Board 每題點頭；是 AI 在分岔用 CEO **取捨往前**。  
人：丟**目標／紅線（隕石／no-go）**；真卡死或越線才出面。

**「人一直在場」vs 自動化（landing 雙日對照＋demo 工程附錄）：**  
- 人一直在場：確實能多**發想**各種問題的解法，但**每個細節 spec 都要人類決策**；模型 tool use 改完說「好了」後，驗證仍掛人。  
- Autopilot：**盡力自動化**發想與細節決策——**有內建處理就走內建，沒有就找業界 best practice** 再 CEO 取捨；人要**講好 no-go**，不是每一行。  
- Landing **禁止**把內部狀態（IDLE/INTAKE/ESCALATE…）當主菜展開查表；主菜＝**同一張工單、兩種一天**（時間負擔轉移）。狀態機／event trace **只在** `/demo`。見 `LANDING-UX-PANEL.md`。

**簽名（全站最多當品牌句，不洗版）：**  
> 給想當 CEO 的人 · 也給快被雜事跟 AI 產能壓垮的人；今天，我們發隕石給 CEO。

**隕石（站內定義）：** 你丟進去的硬條件（目標、紅線、不可退讓）——系統要接住、推進、擋歪；不是「砸基層」的負面黑話。

---

## 2. 發展歷史（濃縮弧線，非版本年表）

| 階段 | 長出什麼 | 為什麼 |
|------|----------|--------|
| 技能／紀律 | lifecycle skills、quality、project tracking | Claude  alone 會亂 grep、假 done |
| 方法論 agents | reviewer / debugger / planner 唯讀 | 三紅線進 agent 層 |
| 委派階梯 | /l3–/l6、ceo-agent、foreman、worktree | 人要離 thread，又要關卡還在 |
| 異質工廠 | dispatch-hetero/review/author、多 runner | 寫≠審≠會；artifact 不當自報 |
| 座位與額度 | roster、scorecard、endpoints、status | 誰有資格坐哪、額度政治 |
| 觀測與收斂閘 | manifest、sensing、loop-convergence、unit contract | 失聯、8 代空轉、未授權開跑 |
| 量測誠實 | known-bad、A/B、H2 被推翻 | 敢公開認栽才配談信任 |

**現在產品臉：** 不是「28 skills 目錄」，是 **CEO-altitude 作業系統**：多元決策 + 收斂執行 + 少人在 loop。

---

## 3. 受眾（誰被發隕石）

1. 想用 **CEO／創業者視角** 做事的人  
2. 想 **跳脫各種大小事** 的人  
3. **AI 越幫越累**（輸出↑ 覆核地獄↑）的人  

非目標：大眾科普「什麼是 AI coding」、企業採購長文、假數據背書。

---

## 4. 站點 IA（現行）

| 路徑 | 回答的 CEO 問題 |
|------|-----------------|
| `/` | 這是什麼、為誰、憑什麼；主 CTA＝看 run |
| `/demo` | **工程師敘事**：壞 loop → 控制面狀態機（含 DISPATCH／FINALIZE）→ /l5 event trace |
| `/levels` | 一句話對照 → 卡片／矩陣；**主因**卸 ctx 讓主腦長活；**附加** Fable（Claude Code 高智慧模型）坐主腦規劃協調，實作卸異質 → 省 token／fee |
| `/recipes` | **runbook**：trigger／cause→effect／狀態路徑／DONE vs ESCALATE |
| `/philosophy` | 為什麼是多元／收斂／少人 |
| `/install` | 兩行安裝＋**一天入手**冷啟動（onboard→/next→驗收；對齊 deck3 #9–#17） |
| `/skills` | 何時碰到哪些能力（非目錄炫技） |
| `/architecture` | 故事怎麼疊成架構 |
| `/multi-harness` | 主場與可攜誠實邊界 |
| `/proof` | 打臉與證據文化 |
| `/roadmap` | 接下來往哪（精選） |

實作：`layout: home` + Vue 全幅敘事頁（Landing / *Page.vue + StoryChrome），**禁止**內頁退回 doxygen。

---

## 5. 文案禁區

- 大標禁用「幹」  
- 不當主句「你來拍板／當監工」  
- 少用 altitude、產能倦怠直譯、內部黑話堆疊  
- 優先句型：**你只定＿＿；系統在＿＿自己往前；只有＿＿才叫你**  
- 隕石句全站當簽名，不每段重複  

---

## 6. Panel 已採納（落地方向）

來自 codex(gpt-5.5+5.6-sol) / agy / MiniMax-M3 / glm：

1. 首屏**產品定義句** + 主／次 CTA + 可見 install  
2. **你／CEO agent／審查** 三角色  
3. **可掃流程**（進→想全→往前→動手→拉回→出）  
4. **隕石定義**一次說清  
5. **痛點口語**（擦屁股、第 17 個小問題）  
6. **run 時間線** + **proof 條**（無假數據）  
7. 內頁維持敘事頁規格  

---

## 7. 壯大／創用者 hetero（已跑）

問題：**如何讓專案壯大、創造真實使用者**——天馬行空但可落 IA／landing／敘事。  
引擎：**codex gpt-5.6-sol · agy · MiniMax-M3 · glm**（不再用 grok 湊數）。  
**輸出（合成定稿）：** [`GROWTH-PANEL.md`](GROWTH-PANEL.md)

摘要（詳見該檔）：

- **主標首選：** Claude Code 讓你寫得更快；Autopilot 讓你不必一直在場。  
- **Landing：** Hero→痛→契約→**真實 run**→多元→收斂→離場→打臉證據→第一顆隕石；主 CTA＝看 run，次＝安裝。  
- **IA NEXT：** `/demo` `/start` `/recipes` `/autonomy`；技術頁收 `/reference/*`。  
- **壯大 P0：** Autopilot Receipt dogfood · Meteor Clinic · Gate Pack 可獨立入口。  
- **砍：** 首頁 skills 炫技、訪客向 multi-harness 長文、元件版 roadmap 牆。
