# PM 席開機預載逐塊處置建議

來源：PM 附的 preload-inventory（PM session 壓縮後第一個回合，用量 136,747 token）。
判斷標準：全域規則「Checks earn their place」——說不出刪掉後哪個真實失敗會回來的，就歸可刪。
token 欄：有清冊數字的照清冊（英文 chars/4、中日文 chars/3）；標「校準」的是用本席同版 harness 的實測比例換算；標「推算」的是相減得到。

## 總表

| 區塊 | 現在 token | 處置 | 預估省 | 刪掉後回來的失敗 | 負責的 lane 或檔案 |
|---|---:|---|---:|---|---|
| A1 工具 schema：Artifact（用過一次就常駐） | 約 9,600（校準） | 改成按需載入：發佈交子代理，主席不載這支工具 | 9,600 | 無。圖還是照樣發給操作員，只是換人發 | PM 席作法；autopilot 提供發佈腳本或子代理說明 |
| A2 工具 schema：fleet 九支 | 約 4,500（校準） | 改寫壓短（dispatch、send、task_result 三支說明最長） | 1,200 | 整個刪掉 PM 就不能派工；壓短不會 | fleet lane，`plugins/lib/tools/tools.ts` |
| A3 system prompt＋內建工具 | 約 17,100（校準） | 維持；另有一項待驗證（見逐塊 A3） | 0（待驗證最多約 5,000） | harness 內建，動不了 | harness；PM repo 的專案設定（待驗證） |
| B1 全域 CLAUDE.md | 5,306 | 改寫壓短 | 1,300 | 整個刪掉：lane 會把轉述的 go 當授權、破壞性操作沒有分級 | 操作員的全域檔；要操作員卡（動到授權表文字） |
| B2 host 檔 | 清冊沒有獨立列（PM 主機上未查到，見未查到 3） | 維持 | 0 | 本機的檔是擋誤 clone hangar | hangar |
| B3 PM repo CLAUDE.md | 1,623 | 維持 | 0 | PM 不知道 lane 位址和自己的授權範圍 | pm repo `CLAUDE.md` |
| B4 MEMORY.md 索引（108 行） | 4,379 | 改寫壓短＋主題檔按需 | 2,500 | 整個刪掉：操作員糾正過的事會再犯（重問已答的卡、當總機照轉）；刪重複的那些不會 | PM 席記憶目錄 |
| B5 skill 清單（70 個） | 7,322 | 改寫壓短＋少數改成只能手動叫 | 3,300 | 整個刪掉：不會自己叫 lead-watch、handoff、agent-call；壓短的風險是選錯 skill | autopilot `skills/*/SKILL.md` 的 description |
| B6 SessionStart hook 注入（skill 介紹＋復原狀態） | 2,500（已撞 9,999 字上限） | skill 對照表刪；Fleet State 改按需；未回訊息維持 | 1,800 | 對照表：無（與 B5 重複）。未回訊息那三行刪掉，壓縮前後到的訊息會漏看 | autopilot `src/hooks/handlers/session-start.js` 與 state-checkpoint |
| B7 deferred tool 清單（67 個名字） | 2,022 | 改寫壓短：PM 席關掉用不到的連接器與 plugin | 300 | 無（PM 不寫 plugin、不用 Docs／Gmail／Calendar／Drive 連接器） | hangar（席位設定）；連接器開關要操作員 |
| B8 agent types（11 個） | 1,487 | 維持；`autopilot:README` 那一列刪 | 約 15 | README 那列：無，它是文件被誤註冊成 agent | autopilot `agents/README.md` |
| B9 MCP instructions | 1,292 | 改寫壓短 | 800 | fleet 那段整個刪掉：不知道 fyi、附件、watch 的用法；壓短不會（skill 與全域檔都有） | fleet lane `tools.ts`；Docs 連接器同 B7 |
| B10 harness 小塊（日期、環境、模型、語言、git 狀態等 7 塊） | 358 | 維持 | 0 | harness 內建 | harness |
| C1 壓縮摘要 | 3,654 | 改寫壓短（給壓縮指示） | 1,600 | 整個刪掉：這一段操作員的糾正和進行中的單號會掉 | PM 席的壓縮指示；autopilot（workflow state 那段） |
| C2 autopilot restored-state（交接檔） | 911 | 維持 | 0 | 壓縮後不知道急件與下一步 | autopilot state-checkpoint |
| C3 壓縮後還原的檔案（3 塊＋1 參照） | 1,711 | 維持（harness 行為） | 0 | 無法關；見逐塊 C3 的作法 | harness |
| C4 cron 帶入＋remote session 記錄 | 293 | 維持 | 0 | 每小時巡查的排程會掉 | harness |
| D 未歸類：保留的對話尾段為主 | 約 72,700（推算，未驗證） | 改成按需：大輸出不進主席 | 約 42,700（縮到 30,000；未驗證） | 這段是最近的原話，全刪會斷線；縮小靠行為，不靠刪檔 | PM 席作法；harness 參數未查到 |
| E 每 prompt 重複注入 | 不在 136,747 裡；每次約 105 token 起 | task_reminder 刪（待驗證開關）；fleet 來訊壓短；Agent hook 改成違規才出聲 | 每個壓縮週期約 2,000–5,000（推算） | task_reminder：無（PM 的工作狀態只記在 fleet task） | harness；fleet lane；autopilot hook |
| 合計 | 136,747 | | 確定可省 22,400 → 約 114,300；加上 D → 約 72,000；A3 待驗證成立再少約 5,000 | | |

合計列對帳：A 31,200＋B 26,289（B2 沒有數字，不計）＋C 6,569＋D 72,689 ＝ 136,747。清冊把 Artifact 與 fleet 的 schema 另列一塊 15,428，它與 A1、A2 重疊，本表併進 A，不重複算；所以清冊表合計 48,286 扣掉 15,428 後是 32,858，等於 B＋C。確定可省的是 A1、A2、B1、B4–B9、C1 相加 22,415。D 以縮到 30,000 計。

## 本單重點：未歸類的 88k 到底是什麼

結論分三層。

1. 已查到（清冊檔內有原文）：壓縮摘要最後一句寫明「摘要之後的訊息是壓縮前最近的訊息，原文保留」。所以壓縮後確實留了一段對話尾段，它算在第一回合的用量裡，清冊沒有列它。
2. 已查到（本席同版 harness 的 transcript，只看型別與大小，未讀內容）：
   - `data-flow-records` 是 `{response_id, listed}` 的清單，是記帳，不送進模型。本席每次壓縮邊界後也有一筆（75k 字元、785 筆），形狀與 PM 那筆 130k 字元一致。所以 130k 字元那筆不佔 context，清冊的猜測有一半不成立。
   - 壓縮邊界記錄的 `compactMetadata.preservedMessages` 列出保留了幾則訊息。本席最近十次是 89 到 233 則（有一次是 0），保留段約 68k 字元，其中 thinking 約 18k–24k、工具結果約 8k–12k。
   - 清冊第 22 塊（10 支工具的完整 schema，15,428 token）就在 tools 陣列裡：本席 tools 陣列 107k 字元、32 支，其中 Artifact 一支 37,294 字元，fleet 的 dispatch、send、task_result 都在。所以這塊與 system＋tools 重疊，清冊表合計要扣掉它。
   - system＋tools 的 token 數：本席三次壓縮後的 cache read 都是 30,088，對應 system 9,045＋tools 107,687 字元，比例 3.88 字元／token。套到 PM 的 121,041 字元約 31,200 token。
3. 未查到：PM 席那段尾段實際多大。相減得到約 72,700 token，這個數同時吃進了 B、C 各塊的估算誤差（清冊中文混排的塊用 chars/4 偏低，我重估 B＋C 可能多 7,000 上下），以及第一回合前才送達的 fleet 來訊。本席同樣位置只有約 25,000–30,000 token，PM 高出兩倍多，原因未驗證（推測是巡查的大型工具輸出留在尾段）。

是不是每次都載入：尾段只在壓縮後出現，新開的 session 沒有。但 PM 席長時間不重開，等於每個壓縮週期都帶著。

## 逐塊理由

### A1 Artifact schema（約 9,600）

Artifact 是 deferred tool，PM 用過一次後 schema 就留在 tools 裡，壓縮後也照樣還原（摘要開頭的 tools-used 清單會把用過的工具帶回來）。這一支佔整個 tools 陣列三分之一。PM 用它只是為了把圖發給操作員。改成派 haiku 子代理發佈、只收回網址，主席就不會載入這支。子代理一次約兩萬 token 的 haiku 價，換主席每回合少讀 9,600。刪掉後沒有失敗回來。

### A2 fleet 九支 schema（約 4,500）

派工是 PM 的本業，要留。dispatch 6,278、send 4,613、task_result 3,132 字元，說明文字裡的規則（size、priority_reason、plan 路徑、不得寫時間）壓縮摘要第 2 節又抄了一遍，表示模型是撞到拒絕才學會，不是讀說明學會。建議 fleet lane 把說明壓到每支一半，規則靠拒絕訊息講清楚。

### A3 system prompt＋內建工具（約 17,100）

harness 內建。有一項待驗證：Workflow、SendFeedback、AskUserQuestion、ScheduleWakeup、ReportFindings 五支合計約 24,000 字元（約 6,000 token），PM 的規則本來就是「要他決定的事開卡」，AskUserQuestion 用不到。如果在 pm repo 的專案設定把這幾支列為 deny 會讓 schema 不送出，就能再省約 5,000。這點沒有驗證過，要做一次實驗：加 deny 後重開，比對請求裡的 tools 清單。專案設定在 pm repo 裡，不是 `~/.claude`，屬於 PM 職權。

### B1 全域 CLAUDE.md（5,306）

各節字元數：授權表 8,295（39%）、Red lines 4,056、Principles 3,623、Delivered operator answers 1,854，其餘合計約 3,200。

- 授權表：PM 列四列共 3,245 字元，其中 11-15 擴權一列就 1,946。lead 四列（遊戲、GPU、復原、hangar）共 3,319 字元。PM 席是授權人，需要知道各 lead 的界線，但不需要全文；工作席只需要自己那一列。建議改成每席載入「自己那列全文＋其他列各一行」，全文放 charter。PM 席約省 800 token，工作席更多。
- Delivered operator answers：寫給執行者看的收件規則，可壓到一半。
- `~/.claude` 的四條例外：可併成一段。

不能刪的理由都有真實案例：hangar 拒收轉述的 go、卡片被重問、破壞性操作分級。所以是壓短，不是刪。這是動授權表的文字，照表內第 7 類要操作員卡，建議 PM 開一張卡附改寫前後對照。

### B2 host 檔

清冊沒有把 host 檔列成獨立一塊，PM 主機上有沒有、多大未查到。本機那份約 150 token，擋的是誤 clone hangar，維持。

### B3 PM repo CLAUDE.md（1,623）

維持。Goal、lane 位址表、PM 授權範圍都是每回合會用的。唯一可壓的是「no host facts」那段的掃描步驟（約 1,900 字元），那些步驟 lab 的 pre-commit hook 已經在做；留三行即可，約省 250，不急。

### B4 MEMORY.md 索引（4,379，108 行）

每行平均 160 字元。分三類處理：

- 與全域檔或 PM repo CLAUDE.md 重複，或已有機制在擋的，刪索引行（約 17 行）：Main merges delegated、~/.claude touch needs card、Pipeline all resources、Fleet tasks are SSOT、Right-size workers、Decide don't card、Agents don't sleep、Always 正體中文（已有 Stop hook 檢查中文比例）、Lane prompts: PM decides、KR never gates go-live、Automate never assign、Check clock before overdue、PM is PO、Expensive engines 與 Cost line 併一行、Find all fix once 與 Fix system not instance 併一行、兩條標明「shipped 後刪」的指標。
- 領域事實併成主題檔，索引各留一行（約 35 行變 6 行）：ThinkSmart、機房與主機、語音、GLM／z.ai／本地模型席、pane 與 TUX 設計、卡片格式。卡片格式那六七條是可以 lint 的，應該進 `open-decision.js` 的檢查，照全域規則「教訓 14 天內變成腳本或刪掉」。
- 留下：操作員重複糾正、目前沒有機制擋的行為規則（不重問已答的卡、不當總機照轉、先查 lane 的說法再轉述、相關席位同時沉默算事故等）。

目標 45 行以內、約 1,900 token。整份刪掉不行：索引是通往記憶檔的唯一入口，摘要裡列的那些被操作員抓到的錯會回來。

### B5 skill 清單（7,322，70 個）

各群字元數：autopilot 32 個 17,870；內建與其他 19 個 7,802（dataviz 1,447、code-review 1,216 最長，動不了）；autopilot-distill-skills 6 個 1,686；anthropic-skills 13 個 852。

- autopilot 的 description 平均 560 字元，長在中英雙語觸發詞和「Not for」導向。壓到每個 250 字元以內，省約 2,450 token。
- `fleet-usage` 出現兩次（裸名與 `autopilot:fleet-usage`，內容相同），刪一個，省約 110。
- l3 到 l6 是使用者打指令才用的入口（共 2,272 字元），改成只能手動叫，不進清單。
- autopilot-distill-skills 那 6 個是個人蒸餾的 skill，與 PM 工作無關，PM 席不裝，省約 420。

風險是壓短後選錯 skill。上線前要做一次路由負控制：拿十句典型觸發句，壓短前後各跑一次，選到的 skill 要一樣。

### B6 SessionStart hook 注入（2,500）

這塊已經撞到 9,999 字元上限被截斷，截掉的是後面的內容，留下來的卻大半是雜訊：

- skill 對照表 12 列（約 1,300 字元）：與 B5 的 description 重複。刪。
- `open-decision.js` 用法那一行（約 800 字元）：PM 天天用，留，但參數說明可縮成指向 `--help`。
- 已回答待處理的卡號兩行：留，很短，擋的是卡被忘掉。
- Unanswered Fleet Messages：留。擋的是壓縮前後到的訊息漏看，這是真的發生過的事。
- Fleet State 的 RED 清單：改成按需。現在 67 列裡有 28 列是「(task not in fleet list) unknown stale_24h」，沒有任何可行動的資訊；另外 36 列每列被截在 60 字元，句子讀不完。PM repo CLAUDE.md 已經規定壓縮後要查 fleet tasks 和未結的卡，這裡留一行計數加指令就夠。那 28 列過期登記本身是 bug，要清。

### B7 deferred tool 清單（2,022）

內建 28 個佔 5,812 字元，動不了。可動的是 claude.ai 連接器 14 個名字（Docs 8、Gmail、Calendar、Drive 各 2）與 easel、plugin-authoring，共約 1,200 字元。PM 不用這些。連接器是帳號層設定，關掉要操作員動手，價值只有 300 token，建議併進別的卡順便問，不單獨開卡。

### B8 agent types（1,487）

`autopilot:README` 是 agents 目錄下的說明檔被當成 agent 註冊，描述是「Agent from autopilot plugin (Tools: All tools)」。省不了多少，但它是一個會被誤派的錯誤目標，把檔案移出 agents 目錄。其他維持，長的兩條（web-fetch、claude-code-guide）是內建。

### B9 MCP instructions（1,292）

fleet 3,005 字元，內容與 fleet-usage skill、全域檔 Communication 節重複，可壓到 900 字元：留位址格式、fyi 何時不能用、大內容走 upload、dispatch accepted 不是授權。Claude Docs 連接器 1,892 字元，PM 不用，處置同 B7。autopilot、easel、plugin-authoring 三段各一行，維持。

### C1 壓縮摘要（3,654）

摘要是模型在壓縮時寫的，不是每個 session 都有，但 PM 席每個週期都帶。可以少的部分：

- 「Workflow state (verbatim)」十行全部是 absent，plain session 不該輸出這段（autopilot 修）。
- 「Security rules still in force (verbatim)」十一行，全域檔裡都有。
- 第 2 節的 fleet 呼叫規則與 open-decision 指令：屬於記憶檔或工具說明，不該每次重寫進摘要。
- 第 5 節已解決清單：交接檔（C2）已有。

留下：操作員這一段的原話與糾正、進行中的單號、下一步。目標 2,000 token。

### C2、C3、C4

C2 交接檔是每個 token 價值最高的一塊，維持。C3 是 harness 把壓縮前最近讀過的檔案還原，關不掉；設計稿首頁那種檔案被還原沒有用，作法是主席不要直接讀大檔，交子代理讀。C4 維持。

### D 保留的對話尾段（約 72,700，未驗證）

這不是預載檔，改檔案省不到。能做的：

- 巡查的大輸出（`fleet tasks --all --tree --json` 之類）寫到檔案，主席只讀分類後的一行；這是 11-16 減量裁示已經要求的方向。
- 讀檔、彙整交 haiku 子代理，主席只收結論。
- 尾段長度有沒有 harness 參數可調：未查到。

本席同版 harness 的尾段約 25,000–30,000 token，表示 30,000 是做得到的水準。

### E 每 prompt 重複注入

- task_reminder：清冊記 164 次。本席實測每次送出約 421 字元（約 105 token）。PM 的工作狀態只記在 fleet task，不用內建 task 工具，這個提醒對 PM 是純雜訊。能不能關未查到（可能跟著 A3 的 deny 一起消失，同一次實驗可以驗）。
- silent_turn_reminder（111 字元、56 次）、auto_mode（149 字元、5 次）：很小，harness 內建，維持。
- fleet 來訊每則 740–1,240 字元：這才是 PM 每回合真正的重複成本。交接檔寫「45 則 patrol wake」。建議 fleet lane 縮信封欄位，patrol wake 合併成一則。
- PreToolUse:Agent hook 每次約 500 字元：改成只在缺 Engine 標頭或缺 model 時出聲，合規的呼叫不注入。擋的失敗（漏寫 model）已經由 deny 擋住，提醒文字是重複的。

## 建議值

壓縮後的起點降到 70,000 token 以下，新開 session 的固定預載降到 35,000 以下，壓縮點維持在 200,000 上下才合理；不建議改成 35%（350,000）。

理由：

1. 現在壓縮點約 200,000（Opus 這組的設定是 t2 150K、窗口 233K，出自本 lane 的記憶筆記，PM 席實際設定未再核對），壓縮後起點 137,000，中間只有 63,000 的工作空間。每做 63,000 token 的事就壓一次，每次要重寫約 118,000 token 的快取。
2. 起點降到 70,000，工作空間變成 130,000，壓縮次數少一半。
3. 用相對成本估（cache read 0.1、cache write 1.25、每回合新增 1,500 token，這個每回合數字沒有量過）：

| 起點 | 壓縮點 | 每單位工作的相對成本 |
|---:|---:|---:|
| 137,000 | 200,000 | 14.3 |
| 114,000（只做確定可省的） | 200,000 | 12.4 |
| 70,000 | 200,000 | 9.8 |
| 70,000 | 350,000 | 14.4 |
| 137,000 | 350,000 | 17.2 |

   算式：(起點＋壓縮點)／(20×每回合新增) ＋ (1.25×起點 ＋ 0.1×壓縮點)／(壓縮點−起點)。主要成本是每回合重讀整個 context，所以把門檻拉到 350,000 會更貴，即使壓縮次數變少。起點 70,000、壓縮點 200,000 比現在省約三成。
4. 這個算式沒有算壓縮造成的遺忘。如果起點降不下來（D 段縮不了，停在 100,000 以上），退而求其次是把壓縮點放寬到 230,000–250,000，而不是 350,000。

只改檔案（B、C、A1、A2）到不了 70,000，只能到約 114,000。把 D 縮到 30,000 之後約 72,000；再加上 A3 的待驗證項或 E，才會低於 70,000。所以 D 一定要處理。

## 未查到，以及還缺的證據

1. PM 席保留尾段的實際大小與組成。缺：PM transcript 壓縮邊界那筆的 `compactMetadata`（保留幾則、post 值），以及第一個回合請求的訊息拆解。同目錄的 `post-compact-breakdown.py` 可以直接跑出來（只印大小與數量，不印內容；已在本席 transcript 試跑過）。PM 席讀自己的 transcript 在現有例外之內。
2. PM 那次請求的 tools 陣列是否與本席相同（Artifact 與 fleet schema 在裡面）。本席已證實，PM 的要用同一支腳本看 `largest_tools`。PM 第一回合 cache read 只有 18,628，比 system＋tools 的 31,200 少，原因未查到。
3. PM 主機有沒有 host 檔、多大。清冊沒有這一列。
4. deny 內建工具會不會讓 schema 不送出、task_reminder 會不會跟著消失。缺一次實驗。
5. 尾段長度有沒有 harness 參數。
6. PM 席每回合平均新增多少 token、每個壓縮週期收到幾則 fleet 來訊。建議值的成本表用的是假設值 1,500。
7. skill description 壓短後路由是否不變。缺一次前後對照。
