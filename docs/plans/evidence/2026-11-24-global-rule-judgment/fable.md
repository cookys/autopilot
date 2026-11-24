建議：不選 A；選 B，並把 B 再往前一步做成「分層常駐」（下稱 B+）：紅線原文不動，授權表只把別條線的 lead 列移到各主機的 `CLAUDE.host.md`，其餘常駐。
省多少：B 實際約省 800–1,000 token（落在約 4,300–4,500，不是 brief 估的 3,500）；B+ 約省 1,700–2,000（落在約 3,300–3,600）；A 省約 3,800 但換回下列失敗。
最大風險：A 的外移檔放在 `~/.claude/authority-table.md`，而保留下來的紅線正好規定「讀真實 `~/.claude` 要操作員卡」，四條例外卡又一起被搬走，等於沒有任何 session 能合規地讀到授權表；常駐檔只剩「go 認 attested from」，於是「位址是真的、但這個授權人無權給這個 go」會被照做。

# 全域規則檔處置評估（fable 席，獨立評審）

Fleet-Task: 01M85MNPK70A6YM29Q18KT63R3
卡片：d-57f18305

讀取範圍：壓短提案全文；現行全域規則檔全文用的是本 session 開場已載入的那一份（量測檔第 3 節我只核對了章節標題與行號範圍 248–420，沒有逐字比對兩份是否同版）。token 數除了 brief 給的 5,306 與 1,500 之外都是我依段落長度估的，沒有實際跑 tokenizer，套用前請量一次。

各段估計（合計約 5,300）：Goal 約 110、Principles 約 900、Red lines 約 950、Authority（表約 1,850＋Notes 約 300＋Delivered answers 約 550）約 2,700、Communication 約 230、Precedence 約 120、Language 約 130、Pointers＋Host-local 約 240。

---

## 第 1 題：A 的精簡版漏掉或改掉的語意

標記：「會」＝有具體的輸入或狀態會導致錯誤結果；「不會」＝說不出具體失敗，或別處已有同一條規則。

### Red lines

| # | 原文 | A 版 | 真實失敗會不會回來 |
|---|---|---|---|
| R1 | `~/.claude` 四條例外卡（d-522f32f4／d-7436a800 自席 transcript；d-d031e0de 別席 usage 數字；d-4b987a63 plugin 與設定更新；d-dd69ee58 PM 派出的決策萃取） | 「例外見 authority-table.md」；但提案的外移清單只有 Authority table、Notes、Delivered answers 三節，例外卡原本在 Red lines 節，沒被列進去 | 會。指標指向一個不含這些內容的檔。狀態：本席要讀自己舊 session 的 transcript 找交接 → 常駐檔只看到「讀寫需操作員卡」→ 停下來要卡，或 PM 為同一件事重開卡。反方向：d-dd69ee58 的限制（只限 Claude 席、不給中國模型、raw 不離機）也一起消失 |
| R2 | 外移檔位置 | `~/.claude/authority-table.md` | 會。保留的紅線說讀真實 `~/.claude` 要卡；現行例外只涵蓋 `~/.claude/projects/` 的 transcript 與 plugin／設定更新，沒有一條允許讀這個新檔。守規則的 session 讀不到授權表，讀了的 session 就違反紅線 |
| R3 | tier 2 清單：history rewrite、毀掉存有資料的 disk／pool／VM、**沒有驗證過的 dump** 的 DROP／TRUNCATE／mass DELETE、`do-release-upgrade` | 只剩 force-push、DROP/TRUNCATE、格式化、撤銷憑證、對外資料、遠端重開機 | 會（兩個方向）。(a) mass DELETE 與 history rewrite 不在清單 → `DELETE FROM … ` 不帶 WHERE 被當成不在 tier 2。(b) 「沒有驗證過的 dump」這個限定詞沒了 → 有 dump 的 DROP 原本是 tier 1，現在變成要操作員本人確認，多開卡 |
| R4 | tier 2 的做法：先說 blast radius 與為何沒有備份可用，再拿操作員本人確認（**走 PM 卡**） | 「要操作員本人確認」 | 會。少了「走 PM 卡」，加上 Delivered answers 外移，lane 會直接對操作員開卡或在自己 session 裡問，正是 d-cf2db280「不開第二張卡」要擋的事 |
| R5 | tier 1：live network／sshd 變更要掛 dead-man timer；在授權內自己決定；回報備份位置與還原指令 | 「先備份並讀回驗證、寫好還原指令」 | 會。狀態：遠端主機改 pf／sshd 設定，有設定檔備份但沒有計時器 → 把自己鎖在外面，備份在進不去的機器上 |
| R6 | Snapshot by context 的五種做法（`cp f f.bak.$(date +%s)`、stash／branch、`mnemos_backup.sh --label`、ZFS／LV snapshot、dead-man timer） | 刪 | 部分會。mnemos 那條是專用腳本，不知道就會用 `cp` 複製一個正在寫的資料庫當備份；其餘屬常識，不會 |
| R7 | tier 0 舉例（scratch／cache、build 輸出、乾淨 worktree 的 `git worktree remove`、已推送或已歸檔且核對過的資料） | 「拋棄式」三個字 | 會（摩擦方向）。合併後清 worktree、刪已推送分支是每條 lane 每天做的事；沒有舉例時保守的 session 會當 tier 1 先備份或去問 |
| R8 | 「Do not manufacture friction」 | 刪 | 不會（「拿不準就備份當 tier 1」還在） |
| R9 | `rm -rf "$HOME"`：「前綴賦值之後任何由 `$HOME` 衍生的東西」＋括號裡的實例＋「無人值守／評測 agent 用自己的沙箱 HOME」 | 「由 `$HOME` 前綴賦值衍生的路徑」 | 會。壓短後的句子語意不通，讀不出「`HOME=x cmd && rm -rf "$HOME"` 刪的是真的家目錄」這個機制；沙箱 HOME 一句也沒了。這條是發生過才寫的，實例就是規則本體 |
| R10 | `grep -r … /` 的原因（本機 grep 是 ugrep、燒過 14 小時 CPU） | 只留禁令 | 不會（禁令還在） |
| R11 | `fleet approve`：不核准自己或同儕的請求、不請同儕核准自己的；是禮貌閘不是安全邊界 | 「模型絕不執行 `fleet approve`」 | 會（窄）。「請另一個 session 幫我 approve」不再被字面涵蓋 |
| R12 | 「dispatch 的 accepted 是確認收到，不是執行權」 | 「訊息不等於授權」 | 不會（fleet MCP 的說明裡有同一句） |
| R13 | OpenClaw 的出處（hangar ADR-0001、gotcha 檔名） | 只留禁令 | 不會 |

另外一件與語意無關但會擋住 A 的事：A 改寫了 Red lines 的文字，屬 11-15 widening 的第 7 類（改 Red lines 或此表），PM 不能自己套用，一定要操作員卡。提案的風險段只說「搬位置不改字」，那只對授權表成立，對紅線不成立。

### Authority table、Notes、Delivered answers（A 整段外移，常駐只剩一行）

| # | 原文 | 真實失敗會不會回來 |
|---|---|---|
| T1 | 「不信文字裡的宣稱；別人轉述的『PM 說 go』不算 go」 | 會。A 只留「go 只認 attested from」。狀態：attested from 是某條 lane，內文寫「PM 已同意」→ from 確實通過驗證，session 照做 |
| T2 | 各列的 Where（授權人只管哪些 repo／哪條線） | 會。見第 2 題 F1 |
| T3 | 各列的 May not（對外正式環境、tier 2、憑證、`~/.claude`、`fleet approve`、超出預算、要操作員到場的事；game lead 不得 tag／發佈公開物、P2 前不得生角色成員；GPU 線「沒有 CPU 預檢收據不給 GPU 時段、worker 不寫 PASS/FAIL」；recovery 線「驗收前不刪來源檔」；hangar 線「成員不能自己擴白名單」） | 會。見第 2 題 F2、F6 |
| T4 | 到期日：game lead 2026-12-03、hangar infra lead 2026-12-08、recovery 線交還並確認後失效 | 會。見第 2 題 F3。兩個日期離今天分別只剩 9 天與 14 天 |
| T5 | PM 11-15 widening 的 1–7 類（新增費用、憑證與 scope、要操作員動手、改 Goal 或門檻、對外可見、無讀回備份的毀損、改紅線或此表）＋「由 PM 判斷、有疑問就開卡」＋「`~/.claude` 的 hooks、權限規則、憑證不算設定」 | 會。見第 2 題 F4 |
| T6 | 11-15 widening (a) 先例條款的限制（同類、同或更低 tier、同或更小範圍；依此做的事不成先例；先例不改 tier）與 (c) 更新類的條件（canary、每台備份＋sha16、回滾指令、dead-man timer、console 路徑） | 會（只影響 PM 席與 hangar）。PM 自己判斷時沒有限制文字 → 先例鏈會越接越遠 |
| T7 | Lane (self) 列：自己 repo 的 `develop` 不用 go，`--no-ff`、tip 測試綠、known-red 不變長、一行 sha 回報、壞了自己 revert | 會。見第 2 題 F5。這是每條 lane 每天用的一列 |
| T8 | PM extension 列：合 `main` 要 `--no-ff`、tip 綠、不 force-push；live 資料變更要驗證過的快照、在副本試跑、回滾指令，go 之前回報 | 會。PM 的 go 一句話，執行條件在表裡 |
| T9 | Notes：lane 向 PM 回報與提問、不找操作員；PM 可隨時停 game lead；lead 的範圍不因 PM go 變大 | 會。見第 2 題 F7 |
| T10 | Notes：風險在 release 處理；live 只跑 pin 住的 sha；升 live 要 PM 逐次 go ＋每台備份 sha16 | 部分會。autopilot 的 repo `CLAUDE.md` 有重複這條，其他 repo 不一定有 |
| T11 | Notes：重用主機上既有 token 的換池是常設 go；複製 token 或新登入仍要卡 | 會（只影響 hangar）。兩個方向：每次換池都開卡，或把複製 token 也當常設 go |
| T12 | Notes：game race 參賽者只觀察計分、不互相交付工作 | 會（只影響 game lead） |
| T13 | Delivered answers：PM 送達的操作員答覆算數（卡號、原題、選項、digest）；request id 不是自己發的不動手；tier-2 前核對題目與 executor；不開第二張卡；`[操作員決定]` 首行；等待時 fleet 單寫 `waiting_on_operator`；`[step-done]`；`[副本]` 不動手不再問；操作員直接回答要同回合轉給 PM | 會。見第 2 題 F8、F9 |

### 其他段落

| # | 原文 | A 版 | 會不會 |
|---|---|---|---|
| P1 | 「照意圖讀規則，不照字面；能用不推進目標的活動滿足的規則就是讀錯了」 | 刪 | 會（弱）。這是壓短版最需要的一句：規則變短之後更容易被字面滿足 |
| P2 | 「理由不是許可」 | 刪 | 不會 |
| P3 | Done = used 的後半：「還沒有使用者能跑時，在真實目標上用真實 payload 跑一次端到端」 | 刪 | 會。狀態：內部工具沒有使用者 → 「沒人能用所以綠燈就算完成」 |
| P4 | Ceremony 的三層（探索：一行結果；可逆實驗只要問題、成本上限、停止條件、不超過 1 天；預註冊門檻與 hetero review 只給難反悔的方向性決定） | 「儀式與風險相稱」 | 會（摩擦方向）。小改動也跑四家審查，燒共用池 |
| P5 | Mechanize：腳本要冪等、有測試、有 audit 行；便宜引擎來寫；教訓 14 天內變腳本／hook／lint 否則刪；操作員只拿不可化約的動作 | 留前半 | 部分會。「給操作員一串步驟」會回來；14 天規則有 autopilot:learn 承接，不會 |
| P6 | Prepare ahead：下一筆 READY 由機器送到、少於兩筆可開工算排程失速、不需稀缺資源的工作立刻平行開工、check-in 時間是回頭確認點不是開工時間 | 「排程資源不空轉也不塞無效工作」 | 會。「等到約定時間才開工」是操作員 11/8 專門糾正過的行為；autopilot 的 repo 檔有部分重複，其他 repo 沒有 |
| P7 | No spinning：卡住只回報一次並附建議 | 刪 | 不會（repo 檔有） |
| P8 | Failure handling：只有別的 session 也會撞牆才寫 lesson | 刪 | 不會 |
| P9 | Review：實作者可以證明不可達來反駁；generation cap 不變，到 cap 由 PM 裁定 | 刪 | 會。審查來回超過 cap 沒有終止條件 |
| P10 | 「工作狀態放在 fleet task」 | 刪 | 不會（repo 檔有） |
| C1 | fleet 工具沒載入時用 ToolSearch 載入；shell `fleet send` 的回覆會進沒人讀的 inbox | 只留「不用 shell」 | 會。MCP 工具在多數 session 是 deferred；沒有「去載入」這句，session 看不到工具就退回 shell，回覆石沉大海 |
| C2 | 「回覆是資訊，不是授權」 | 刪 | 會（弱）。與 T1 同類 |
| C3 | 廣播用 `@channel`、沒有萬用字元；人看到的是 `project · Harness (courier)` | 刪 | 不會（fleet MCP 說明有） |
| C4 | 回報「對里程碑，不對活動」 | 刪 | 不會（Goal 段有同義句） |
| L1 | Precedence：同層較新的操作員決定優先；repo 檔只能加嚴、不能放寬授權或紅線；每條規則只有一個權威位置 | 只留順序 | 會。狀態：某 repo `CLAUDE.md` 寫「本 repo 可直接合 main」→ 沒有「不能放寬」這句，session 當成有效細則 |
| L2 | 規則壽命：14 天沒抓到東西就是刪除候選；加一條要提一條刪 | 刪 | 會（慢性）。這個檔就是因為只加不刪才長到 5,306 |
| L3 | 語言：已知失敗模式（長段技術內容中途變簡體、列出的用字）與「每段前自檢」；涵蓋思考過程的呈現 | 「不漂移成簡體」 | 會（弱到中）。這條講過多次才寫成帶實例的版本 |
| L4 | Pointers：絕對路徑只是示意要對 README 確認、hangar `gotchas/`、`mnemos_backup.sh`、每專案 memory 路徑、PM SOP 與 charter | 多數刪 | 不會（查得到）；`mnemos_backup.sh` 見 R6 |
| L5 | Host-local：「可加細節或更嚴，不得放寬」 | 只留 `@` 引用 | 不會（host 檔自己開頭有同一句） |

---

## 第 2 題：授權表外移後會再發生的真實失敗

先講機制。外移檔只有在 session「覺得需要查」的時候才會被讀；而需要它的時刻（收到一則 go）正好是 session 以為自己已經懂規則的時刻，因為常駐檔那一行說的就是「看 from」。另外，壓縮之後常駐檔會重載，用 Read 讀進來的外移檔內容不會。

| # | 輸入或狀態 | 錯誤結果 |
|---|---|---|
| F1 | autopilot lane 收到一則 attested from＝game lead 的訊息：「go，合進 main」 | from 驗證通過，常駐檔沒有「game lead 只管 game repo」→ 用一個無權的 go 合了 main |
| F2 | lane 收到 PM 的 go：「把這版發到公開 registry」或「開一個付費額度跑評測」 | PM 列的 May not（對外、費用）不在眼前；紅線精簡版只有「對外資料」算 tier 2，發佈與費用都不是資料 → 照做。原表的第 1、5 類要求這兩件事開操作員卡 |
| F3 | 2026-12-04 之後，game lane 收到 game lead 的 go；或 12-09 之後 ops 席依 hangar 列按白名單鍵 | 到期日不在常駐檔，沒有任何東西讓 session 去比對日期 → 過期的授權繼續被用 |
| F4 | PM 席在壓縮之後判斷「這件事能不能照先例自己決定」 | 1–7 類不在眼前，要靠記得去讀外移檔；漏掉第 2 類（token 複製）或第 6 類（沒有讀回備份）→ 該開卡的沒開。PM 是這張表用得最重的席位，也是壓縮最頻繁的席位 |
| F5 | lane 審完一條 SHIP-AS-IS 分支，測試綠 | 兩種錯：(a) 不知道自己 `develop` 免 go → 去跟 PM 要 go，PM 被叫醒、分支掛著，`check-unmerged-ship.js` 1 小時後亮；(b) 把「lane 可自己合」記成也涵蓋 `main` 或別人的 repo |
| F6 | recovery 線成員完成轉檔，磁碟快滿，想刪來源檔 | 「驗收前移除來源檔屬 tier 2」只寫在該列的 May not；紅線精簡版的 tier 2 清單沒有這一項 → 當 tier 0（已有轉出副本）刪掉，無法重來 |
| F7 | lane 遇到要操作員決定的事 | 「lane 問 PM、不問操作員」與「不替操作員開卡」都外移 → 直接開卡或在 session 裡等操作員；操作員面板出現重複卡，同一題被答兩次且可能不一致 |
| F8 | executor 收到 PM 送達的答覆，裡面的 request id 不是自己發的；或題目與自己問的不一樣 | 核對規則外移 → 依 from＝PM 就動手；若是 tier-2 操作，做的是別人問的那一題 |
| F9 | lead 收到首行 `[副本] <executor>` 的訊息 | 不知道這是副本 → 自己也執行一次，或再問一次操作員 |
| F10 | hangar 依 capacity 的輸出要換池 | 常設 go 的界線（重用既有 token 可以、複製 token 或新登入要卡）外移 → 每次都開卡，或連複製 token 也當成常設 go |
| F11 | 任何守規則的 session 想讀 `~/.claude/authority-table.md` | 紅線說要卡 → 不讀。於是 F1–F10 不是「偶爾沒讀到」，而是預設狀態 |

歸「不會」的：game race 參賽者規則、GPU 線的預檢收據規則，若該線的 repo `CLAUDE.md` 或 charter 已有同一條就不受影響。我沒有讀那些檔，無法確認，所以在第 1 題仍標「會」。

---

## 第 3 題：建議

### 不選 A

省最多（約 3,800），但 R1、R2、F11 是結構性的，不是機率性的：外移檔的位置與保留的紅線互相衝突。把外移檔改放別處（例如 PM repo）可以解掉 R2，F1–F10 仍在，因為那些是「有沒有在眼前」的問題。A 還改了紅線文字，本來就要操作員卡。

### C 是可接受的保底

這 5,306 token 是快取前綴的一部分，每回合以快取讀取計價；它擋的是合錯 main、重複開卡、鎖在主機外這類一次就很貴的事。如果操作員不想為這件事花判斷，C 沒有任何失敗風險。

### 建議：先 B，再做 B+

**B（PM 可自己套用，不碰紅線與授權表的字）**

- 落點估約 4,300–4,500，不是 3,500。Red lines＋Authority 三節原文約 3,650，這部分不動；能壓的六段合計約 1,730，壓到約 750 已經是保留下列各句後的下限。
- 壓短時必須留下（第 1 題標「會」的）：P1 照意圖讀、P3 端到端一次、P6 的「check-in 是回頭確認點」與「下一筆 READY 由機器送到」、P9 generation cap、C1 的 ToolSearch 與 shell inbox 原因、C2、L1 的「repo 檔不得放寬」、L2、L3 的失敗實例。
- 可以放心刪：P2、P7、P8、P10、C3、C4、L4 大部分、R10／R13 類的出處說明（但那些在紅線裡，B 不動）。

**B+（分層常駐，需要操作員在 d-57f18305 上點頭，因為動到授權表的位置）**

做法：利用已經存在、由 hangar 維護、用 `@` 引入的 `CLAUDE.host.md`。它是開場就載入的，不用 session 自己去讀 `~/.claude`，所以不撞紅線，也不靠「記得去查」。

- 全域檔常駐：Red lines 原文（約 950）；授權表的表頭規則（attested from、不信轉述）、PM 四列（含 11-15 widening 的 1–7 類原文）、Lane (self) 列、Notes、Delivered answers（合計約 2,000）；其餘段落照 B 壓短（約 750）。合計約 3,300–3,600。
- 移到主機檔：game lead 列只放在 game 主機、GPU 線 lead 列只放在三台 GPU 主機、recovery 線 lead 列只放在 recovery 主機、hangar infra lead 列只放在 hangar 主機。四列合計約 1,300 token，文字原樣搬、不改字。PM 席的主機檔放全部四列，因為 PM 要裁定所有線。
- 全域檔在原位置各留一行：「<授權人位址>：範圍限 <哪條線>，全文在該線主機的 host 檔；本機沒有這一列就表示它的 go 在這裡不算數。」約 120 token。這一行是關鍵：它讓「這裡沒有載入這一列」變成一條明確規則（預設拒絕），F1 與 F3 就不會回來。
- 到期日跟著列走；另外建議 hangar 產生 host 檔的腳本在到期當天自動把過期列拿掉並回報 PM，這樣到期不靠任何 session 記得比日期。這符合 Mechanize repeats，也是 A、B、C 都沒有的改進。

B+ 相對現況的失敗風險：只有一個，host 檔與全域檔不同步（某主機少了該有的列）。結果是該線 lead 的 go 在那台主機被拒，屬於會被看到、往安全方向錯的失敗；hangar 的盤點腳本加一項比對即可。

**不建議現在做的**

- 「只載入本席相關的授權列」做到 session 層級（比主機更細）：需要新的載入機制，host 檔已經能拿到大部分好處。
- 把 Delivered answers 的核對規則改由 PM 的送達訊息自帶：可再省約 350，但那等於讓訊息內容定義自己該怎麼被信任，與「訊息不授權」相抵觸。

### 順序

1. PM 現在套 B（不動紅線與表的字，屬 PM 可決範圍；套用前後各量一次 token）。
2. 同一張卡 d-57f18305 請操作員決定是否做 B+；同意後由 hangar 產生各主機的 host 檔，全域檔同一次推送拿掉那四列（不留兩套）。
3. A 不做；若將來要再縮，縮的對象應該是 Principles 的重複（各 repo `CLAUDE.md` 已經重述了一大半），不是授權表。
