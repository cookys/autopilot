# Autopilot website — growth / IA / narrative panel

Status: **SYNTHESIZED 2026-07-16**  
Engines: **codex `gpt-5.6-sol`** (fullest) · **agy** (full artifact) · **MiniMax-M3** · **glm-4.7**  
Prompt frame: 壯大專案、創造真實使用者 — 天馬行空但可落地  
Canon (already frozen): [`NARRATIVE.md`](NARRATIVE.md) · [`TA.md`](TA.md) · [`WEEKLY.md`](WEEKLY.md)

Raw outputs (machine-local, not shipped): `/tmp/panel-growth/out-*.txt`  
agy artifact: `~/.gemini/antigravity-cli/brain/…/autopilot_growth_strategy.md`

This doc is **advisory product IA** — not a commit to re-route the live site tomorrow. Implementation picks are marked **NOW / NEXT / LATER**.

---

## 0. 四家共識（先讀這個）

| 層 | 共識 |
|----|------|
| **敵人** | 不是「寫 code 慢」，是 **AI 產能↑ → 人變全職 reviewer / 核對員 / 最慢的 API** |
| **英雄** | 想當 CEO／創業者視角、被雜事與覆核地獄壓垮的人（**不是** CEO agent 本體） |
| **武器** | 你丟隕石（目標／紅線）→ 多元補視角 → CEO 取捨往前 → 收斂 gate／artifact 擋假 done |
| **結局** | 人不在 loop；只在越線／真卡死時被叫回來 |
| **Landing 骨架** | Hero 承諾 → 痛點 → 契約（隕石）→ 多元／收斂 → 離場等級 → 證據（含打臉）→ 安裝／第一顆隕石 |
| **首屏 CTA** | 不要四顆並列；**主＝看一次真實 run／次＝安裝**（sol 最硬） |
| **該砍** | 首頁 skills 炫技、訪客向 multi-harness 長文、元件版 roadmap 待辦牆 |
| **壯大鉤** | Dogfood 收據、Gate 可獨立採用、可驗證 interrupt 徽章、公開門診／打臉、互動「紅線／第一顆隕石」 |

**分歧（要你拍）：**

| 題 | sol | minimax | glm | agy |
|----|-----|---------|-----|-----|
| **主定位句** | 對比 Claude 速度 vs 不必在場 | 你只發隕石，CEO 做完 | 扔隕石／引力場 或 為了「不在場」 | 痛點／角色／本質三選一 |
| **IA 激進度** | 大重排（demo/start/recipes/reference） | 現路由微調文案 | 合併頁（mechanism/truth） | ladder/setup/evidence 改名 |
| **一級導覽** | 看它跑｜開始｜原理｜證據｜參與 | 現行 9 頁微調 | 6 頁精簡 | 8 頁敘事鏈 |

**推薦定錨（合成者）：**

1. **主標採 sol #1**（最短、品類切割最乾）：  
   > Claude Code 讓你寫得更快；Autopilot 讓你不必一直在場。  
2. **簽名句保留**（隕石品牌，不洗版）：今天，我們發隕石給 CEO。  
3. **副標可用 minimax #1 或 sol #2**（契約句）。  
4. **IA 採 sol 的「產品層 vs reference 層」**，URL 可漸進 rename（不必一次斷鏈）。  
5. **壯大第一波**：Receipt dogfood + Meteor Clinic + Gate Pack 入口敘事（不必先做徽章工程）。

---

## A. 定位句 — 四家備選 + 合成

### A1. Codex `gpt-5.6-sol`（首選組）

1. **Claude Code 讓你寫得更快；Autopilot 讓你不必一直在場。** ← panel 自選主標  
2. 你只發目標與紅線，CEO agent 負責爭論、取捨、推進，只有越線才叫你。  
3. 別再當 AI 工廠的總審稿人：Autopilot 把多模型產能變成能自己收斂的交付。

### A2. MiniMax-M3

1. 你只發隕石，CEO 自己把事情做完。  
2. 給 AI 一個老闆，比給它一百個 prompt 有效。  
3. 當你不再卡在中間覆核，事情才真的開始跑。

### A3. glm-4.7

1. Autopilot：你是扔隕石的人，我們是接住隕石並推進的引力場。  
2. 別讓 AI 把你變成更高級的核對員；把隕石丟進來，剩下的讓系統自己閉環。  
3. 這是一個為了讓你「不在場」而存在的 CEO 作業系統。

### A4. agy

1. 別再當 AI 程式碼的廉價監工：定義紅線，讓 CEO Agent 帶多模型工廠自動收斂。  
2. 從被 AI 寫爛的 code 淹沒 → 只發送隕石的決策者。  
3. 拒絕人肉覆核與假 done；多元智囊 + 收斂機械 gate，真正 remove human from the loop。

### 合成用法

| 位置 | 建議句 |
|------|--------|
| H1 | sol #1 |
| H1 副／產品定義 | sol #2 或 minimax #1 |
| 簽名／footer | 既有隕石簽名（NARRATIVE） |
| OG / SEO | minimax #3 或 sol #3 |
| 痛點卡 | glm #2 / agy #1 口語化後（禁「幹」、少「監工」當主標） |

---

## B. 理想 Landing 區塊（合成 9 段）

| # | 區塊 | 目的 | 視覺 | 一句文案 | 來源 |
|---|------|------|------|----------|------|
| 1 | **離開駕駛座** | 品類 + 承諾 | 隕石進系統，研究→決策→執行→驗證自行展開；游標幾乎不點 | Claude Code 讓你寫得更快；Autopilot 讓你不必一直在場。 | sol |
| 2 | **AI 越快，你越忙** | 痛點 | 輸出↑ / review queue 更陡；滿「請確認」 | 如果每個 agent 都等你拍板，你得到的不是自動化，只是更多部屬。 | sol + 四家 |
| 3 | **你發隕石，系統接手** | 心智契約 | 三格：目標紅線／取捨推進／越線才找你 | 你定義不能輸的條件；其餘分岔，由 CEO agent 往前選。 | sol + NARRATIVE |
| 4 | **看它跑一次** | 取代功能宣稱 | run replay：survey → 爭論 → CEO → worktree → peer → gate → artifact | 不要相信「全自動」三個字；看一次它怎麼決定、怎麼失敗、怎麼拉回。 | sol **NOW 關鍵洞** |
| 5 | **多元 ≠ 開會秀** | 為什麼 multi-engine | 異質觀點地圖；CEO 標取捨理由，不是投票 | 多個模型不是為了聲量，而是讓重要盲點在動工前浮出來。 | sol |
| 6 | **收斂不靠人肉盯** | 為什麼敢離場 | 漏斗：peer / 眾議會 / unit contract / 機械 gate → artifact | 模型可以發散；交付必須通過能被機器檢查的窄門。 | sol + glm |
| 7 | **離場旋鈕** | /l3–/l6 結果化 | 四級：一段 thread → 一條任務 → lifecycle → 只收終局 | 從少管一個 thread，到只在紅線被碰到時出現。 | 四家 |
| 8 | **證據，包括打臉** | 信任 | 成功 run ∥ known-bad / H2 被推翻 | 不展示 agent 自報完成；只展示留下什麼，以及哪裡曾經錯。 | 四家 |
| 9 | **發出第一顆隕石** | 轉化 | 左：3 分鐘 run · 右：安裝 · 下：3 個起跑任務 | 挑一件你不想再親自追的工作，讓 Autopilot 接住。 | sol |

**CTA 規則（sol，採納）：**

- 主：**看一次真實 run**（→ `/demo` 或暫用 `/proof` + 內嵌 replay 骨架）  
- 次：**安裝 Autopilot**（→ `/install` 或未來 `/start`）  
- 小字：**先看它何時會叫我回來**（→ `/levels` / 未來 `/autonomy`）  
- **禁止** GitHub / 文件 / Install / Architecture 四 CTA 並列

**現行 Landing 已對齊：** 產品句、角色三角、6 步 pipe、隕石一次、口語痛點、day timeline、proof 條、雙 CTA + install。  
**尚未落地：** 可播 run replay（B4）、離場旋鈕產品 UI、三起跑任務卡。

---

## C. 全站 IA — 三層對照

### C1. 現行（已上線）

`/` · `/philosophy` · `/levels` · `/install` · `/skills` · `/architecture` · `/multi-harness` · `/proof` · `/roadmap`

### C2. Codex sol 提案（最完整，**NEXT 藍圖**）

一級導覽只留五個：**看它跑｜開始使用｜運作原理｜證據｜參與**

| 頁 | URL | 用戶問題 | 下一點 |
|----|-----|----------|--------|
| Landing | `/` | 我能少管什麼？為何不是另一套 agent framework？ | `/demo` |
| 真實 Run | `/demo` | 丟隕石後系統做了哪些決策？ | `/start` |
| 開始使用 | `/start` | 第一次怎麼安全跑？ | `/recipes` |
| 任務配方 | `/recipes/*` | 哪種工作先交出去？ | recipe 詳 |
| 離場等級 | `/autonomy` | 授權到哪？何時叫我？ | `/start` |
| 概念 | `/concepts/*` | 多元／CEO／gate | `/proof` |
| 證據 | `/proof` | 可檢查的成功／失敗／打臉 | `/demo` |
| 參考 | `/reference/*` | 架構／skills／harness | deep GitHub |
| 貢獻／治理 | `/contribute` `/about` | 能貢獻什麼、邊界 | GitHub |
| 路線 | `/roadmap` | 未解真問題 + 完成條件 | issues |

**三個 rename 原則（sol）：**

1. `/install` → `/start`：安裝不是成功，**第一顆隕石跑完**才是  
2. `/levels` → `/autonomy`：離場多少，不是內部級號課  
3. skills / architecture / multi-harness → `/reference/*`：技術深度退出產品主線

### C3. 其他引擎精簡版

| 引擎 | 重點 |
|------|------|
| **minimax** | 現 9 頁可保留；動線 `/`→`/levels`→`/install`；懷疑者 `/`→`/philosophy`→`/proof` |
| **glm** | 6 頁：`/` `/manifest` `/altitudes` `/mechanism` `/truth` `/roadmap` |
| **agy** | `/philosophy`→`/ladder`→`/setup`→`/capabilities`→`/architecture`→`/evidence`→`/future` |

### 合成遷移（不一次斷鏈）

| 階段 | 做什麼 |
|------|--------|
| **NOW** | 文案／CTA／砍首頁 skills 炫技；`multi-harness` 降級為「主場誠實一句 + link」 |
| **NEXT** | 新增 `/demo`（靜態 replay 亦可）；`/recipes` 三個起跑；導覽改五欄文案（URL 可先 alias） |
| **LATER** | URL 正式 rename + redirect；`/reference/*` 收攏技術頁 |

---

## D. 敘事主線（30 秒 · 合成定稿）

**英雄**  
因 AI 產能暴增，反而困在 review、重下 prompt、確認清單裡的人。

**敵人**  
「所有分岔都回到人」——更多選項、更多假完成；你變成整座 AI 工廠最慢的 API。  
（不是「寫 code 太慢」。）

**武器**  
Autopilot：丟目標與紅線 → 異質模型補視角 → CEO agent 取捨 → 執行往前 → peer／機械 gate／artifact 擋自嗨。

**結局**  
你離開 thread；系統繼續推；只在紅線、無法收斂、或需要新授權時把真正值得決定的事交還你。

**30 秒旁白（sol，可進 about / demo 片頭）：**

> AI 本來應該替你省時間，卻把你變成全職 reviewer。每個 agent 都很快，但每個分岔都等你決定，每個「完成」都等你驗屍。Autopilot 改變的是這個責任結構：你只丟下目標與不可退讓的紅線；多個模型補齊視角，CEO agent 做取捨，執行系統往前推，gate與 artifact 負責阻止它自我感覺良好。最後，你不是更會管理 AI——你是不必一直在場。

**一句結局（minimax）：** 你不再是工頭，你重新是老闆。  
（站內可用；勿蓋過 H1 的 sol 對比句。）

---

## E. 壯大與獲客 — 合併 12 鉤 → 優先序

| 優先 | 鉤子 | 本質 | 來源 | 為何先 |
|------|------|------|------|--------|
| **P0** | **Autopilot Receipt（dogfood）** | 自家 PR 附 Meteor / CEO decisions / Gates / Human interrupts / Artifacts | sol | 零新產品面；立刻有 proof 素材 |
| **P0** | **Meteor Clinic（隕石門診）** | 每週 1 個真實小任務：只收目標+≤3 紅線；公開 log（含失敗） | sol + minimax 變體 | 案例庫 + demo 素材 + 社群 |
| **P0** | **Gate Pack 敘事入口** | 可獨立 MIT 的收斂 gate（secret/scope/completeness…）+ known-bad；完整 lifecycle 為升級 | sol + agy GHA | 降低採用門檻＝創造使用者 |
| **P1** | **Human Interrupt 徽章** | 可驗證 run facts 徽章（禁止手填）；點進 replay | sol | 病毒鏈 repo→proof→站 |
| **P1** | **Red-line / 翻車模擬器** | Landing 互動：輸入目標+紅線 或貼翻車 PR → 展示會在哪代被擋 | glm + agy | 體驗「定義邊界」而非寫 code |
| **P1** | **Levels 互動旋鈕** | 「你願意出現幾次？」→ 對應 /l? + 建議 skill 包 | minimax | 比教學頁更可分享 |
| **P2** | **打臉 RSS / Known-bad 名人堂** | proof 延伸成持續更新；不護短 | minimax + agy | SEO + 信任 |
| **P2** | **CEO-notes 親筆短文** | `/ceo-notes` 維護者寫「我為何不親自做這件事」 | minimax | 人格 > 功能表 |
| **P2** | **教育：不當 AI 中階主管** | 教 delegation contract，不是 prompt 技巧；產出 = meteor 契約 + run | sol | 篩真痛用戶 |
| **P2** | **Artifact-first PR 模板 / 文化** | 乾淨 PR 格式傳播 → 別人問「這怎麼來的」 | glm | 格式即品牌 |
| **P3** | **Panel 公開吵架頁** | multi-engine 審自家 code 可視化 | glm | 極客信任；成本高 |
| **P3** | **工時 vs 額度計算機** | 人肉審 vs multi-engine 成本 | agy | 給主管；非主受眾 |

**刻意不做（與 NARRATIVE 一致）：** 假 stars、假節省時數、企業採購長文、錯誤 install 路徑、全面 harness 相容吹噓。

---

## F. 最該砍／降級（≤3 共識 + 執行）

| # | 砍什麼 | 改成什麼 | 共識 |
|---|--------|----------|------|
| 1 | **首頁／產品主線的 skills 目錄炫技** | 一次 run 裡 skills 如何接力；完整表進 `/reference/skills` 或 GitHub | 四家 |
| 2 | **訪客向獨立 multi-harness 敘事長頁** | 一句「Claude Code-first；可攜邊界見 reference」 | sol + agy + glm |
| 3 | **元件／版本中心的 roadmap 待辦牆** | 3 個未解使用者問題 + 可驗證完成條件 | sol + minimax + glm |

**另：install 頁** 只留 happy path；除錯長文 → Issues / advanced docs（glm）。

---

## G. 建議落地順序（網站 + 壯大）

### NOW（文案／結構，不改 URL）

1. Landing H1 試 sol #1（zh + en）；副標契約句；CTA 改「看一次真實 run」優先  
2. 內頁 StoryChrome CTA 對齊同一契約  
3. Skills 頁：場景／時機敘事為主，目錄降附錄  
4. Multi-harness：縮成誠實邊界卡 + deep link  
5. Roadmap：改 3 題公開問題（可從 unit-contract / interrupt / known-bad 取材）  
6. 本 repo dogfood：下一個非 trivial PR 強制附 **Autopilot Receipt** 模板（寫進 CONTRIBUTING 或 website 短頁）

### NEXT（新表面）

1. `/demo`：靜態或錄製 run replay（哪怕是 JSON 驅動假播放器）  
2. `/recipes` ×3：research-to-ship · multi-engine decision · repo-takeover  
3. Meteor Clinic 第一期：issue 模板 + 一則公開 run 寫進 `/proof`  
4. Gate Pack 行銷頁（可先只是 narrative + 指向既有 scripts gates）

### LATER（工程 + rename）

1. Interrupt badge 從 artifact 生成  
2. URL 遷移 `/start` `/autonomy` `/reference/*` + 301  
3. Red-line 互動小工具（無後端則 client mock + 真實 gate 規則表）

---

## H. 各頁「天馬行空但對齊敘事」一覽

| 頁（現行） | 該回答的 CEO 問題 | 天馬行空強化 |
|------------|-------------------|--------------|
| `/` | 這是什麼、我能離場嗎 | 見 §B；主 CTA = run 不是 docs |
| `/philosophy` | 為何人要出 loop | 改「責任結構」故事，少原則條列 |
| `/levels` | 我能懶到多遠 | 離場旋鈕 UI；人介入次數曲線 |
| `/install` | 5 分鐘進來 | Happy path only；裝完立刻「丟第一顆隕石」任務 |
| `/skills` | 何時碰到哪些能力 | 時間線／場景，非 28 格 icon wall |
| `/architecture` | 故事怎麼疊成系統 | 工廠流水線動畫：寫≠審≠會 |
| `/multi-harness` | 主場與誠實邊界 | 降級 reference；首屏不搶戲 |
| `/proof` | 憑什麼信 | Receipt 牆 + known-bad + H2；連 Clinic |
| `/roadmap` | 一起解哪題 | 3 題未解 + 完成條件；邀共同解題者 |

---

## I. 開放決策（等你一句）

1. **H1 是否採用 sol #1**（對比 Claude），還是更偏隕石口語（minimax #1）？  
2. **P0 壯大先做哪個：** Receipt / Clinic / Gate Pack 敘事？  
3. **IA 激進度：** 只改文案（minimax）vs 加 `/demo`+`/recipes`（sol NEXT）vs 全 rename（LATER）？

---

## J. 引擎完整度備註

| 引擎 | 完整度 | 備註 |
|------|--------|------|
| codex gpt-5.6-sol | ★★★★★ | IA 重排最可用；壯大鉤最可執行 |
| agy | ★★★★ | 全文在 artifact；略多形容詞，結構完整 |
| MiniMax-M3 | ★★★★ | Landing 表乾淨；砍法務實 |
| glm-4.7 | ★★★ | 視覺隱喻強；IA 過併可能丟深度 |

Panel 規則延續站點：引擎為 **codex / agy / MiniMax / glm**（不再用 grok 湊數）。
