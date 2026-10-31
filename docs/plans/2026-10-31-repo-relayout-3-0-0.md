# autopilot repo 全面整理（3.0.0）v3 定稿：乾淨、可開源、好擴充好維護

審查紀錄：四席 plan review（astra 主審，GLM、MiniMax、Qwen 深審）兩代，第一代 19 條、第二代 15 條全部採納。第二代修補寫在文末「定稿修補」，與正文衝突時以該節為準。

依據：盤點報告（develop @ 05704640d）。數字出處以【盤點】標示，來源是 scratchpad/layout/ 下的 docs-、repo-、code-inventory.md；各階段的產生器會用實際掃描重算引用數，不依賴盤點快照。
owner 裁定：
- d-172f3336：趁 3.0.0 全面重排。
- d-b6360a39：repo 已公開，請 depth-0 提出最好的作法。
- 長期規則：不留相容墊片，breaking 就乾淨改名，先發 `3.0.0-alpha.N` 讓 owner 測；版號凍結在 3.0.0。

## 0. 開源現況與處置
- **公開狀態**【已驗，2026-10-31 `gh repo view` 與 `gh api .../traffic/clones`】：PUBLIC，建立於 2026-03-18。目前 12 顆星、1 個 fork。GitHub traffic API 的 14 天 `uniques`=668，這是 GitHub 自己的去重計數。owner 也確認 repo 已公開。
- **不改寫歷史**：內容早已被 clone 與 fork 帶走，改寫收不回來，只會打斷所有既有 clone。
- **憑證事件紀錄**（已完成，2026-10-31）：
  - 只讀稽核掃了 HEAD 的 21,273 個已追蹤檔，以及 origin 上 6,641 個 commit 的歷史 blob 與 commit 訊息。
  - 結果：疑似真憑證 0 筆、無法判斷 0 筆。命中的都是測試假值、遮罩值、官方範例或誤判。報告在 scratchpad/layout/secret-audit.md。
  - 結論：沒有要撤銷的憑證。
  - 限制：短於 32 字元的自訂 token、3 MB 以上或含二進位的 blob 不在掃描能力內；寫進 SECURITY.md。
- **清理現有檔**：凍結物件（§4 封存閉包內的檔）一律視為已發布紀錄，逐檔豁免、不改，並在 SECURITY.md 說明。其餘含個人路徑、主機名、內網位址（例如 `<private-ip>`）的檔，改成 `$HOME`、`<host>` 佔位。完成條件：stamp-prereg --check 與全套件結果前後一致。
- **leak-guard**（新增檢查，接 pre-commit 與 CI）：
  - 擋新增或修改的已追蹤檔出現：`/home/<user>`、`/Users/<user>`、`/tmp/claude-<uid>`、本機主機名、私有網段 IP、`.env` 檔。
  - 憑證樣式沿用既有的 `scripts/secret-scan-diff.js`。
  - 豁免只認逐檔清單，不認整個目錄。
  - 負控制：植入個人路徑、植入合成假金鑰（格式正確、非真值）、新增 `.env` 檔，三項都要紅。

## 1. 目標佈局與放置規則
```
/  README(.zh-TW).md LICENSE CHANGELOG.md CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md CLAUDE.md AGENTS.md plugin.json
.claude-plugin/ .agents/ .opencode/ .github/ .githooks/
skills/ agents/ mods/ bin/ src/ schemas/ references/ profiles/ project-config-template/ website/   ← 原位
hooks/   hooks.json opt-in-manifest.json README.md
  default/  直接註冊在 hooks.json、預設啟用的 hook 主檔
  opt-in/   列在 opt-in-manifest.json 的 hook 主檔，不論經 multiplexer 或直接註冊（例如 per-turn-gate）
  lib/      非 hook 主檔的共用模組（原 hooks/_shared 4 檔加原 hooks/lib 2 檔，目前無同名；撞名就中止搬家）
lib/      原 scripts/lib：plugin 共用函式庫
scripts/  使用者 session 會執行的工具
  dispatch/ review/ mission/ worktree/ config/ engine/ scan/ install/
tools/    只給開發者與 CI 用：gates/ sync/ evals/ migrate/
tests/    unit/<原始碼路徑>/  integration/  fixtures/  run.sh
docs/     README.md  guide/(使用者)  dev/(貢獻者，含 adr/)  assets/
project/  plans/ projects/ backlog/(含 BACKLOG.md) missions/ handoff/
evidence/ 證據與評測原始資料
evals/    評測 harness 與 prereg（原位）
platforms/ 鏡像產物
```

**放置決策表**：layout-lint 依序套用，先命中者勝，每一列都有負控制。

| # | 條件 | 去處 |
|---|---|---|
| 1 | 測試檔（`*.test.*`、`tests` 用的 fixture） | tests/unit/<被測原始碼路徑> 或 tests/integration/（測兩個以上模組時） |
| 2 | 註冊為 hook 的主檔 | hooks/default/ 或 hooks/opt-in/，依登記在 hooks.json 或 opt-in-manifest.json |
| 3 | 被兩個以上頂層目錄 require 的模組 | lib/；只被 hooks 用的放 hooks/lib/ |
| 4 | 會被 skills、hooks、agents、src、mods、使用者設定或 session 執行 | scripts/<領域>/。領域依主要用途：派工→dispatch、審查與驗證→review、mission／stage／session→mission、worktree 與分支→worktree、設定與路由解析→config、引擎資格→engine、diff 掃描→scan、安裝→install |
| 5 | 只在 release、CI、pre-commit／pre-push 或手動維護時跑 | tools/gates/（檢查）、tools/sync/（鏡像與同步）、tools/evals/（評測與 benchmark）、tools/migrate/（一次性遷移） |
| 6 | 使用者或貢獻者要讀的 md | docs/guide/、docs/dev/ |
| 7 | 計畫、專案、backlog、mission、交接 | project/ |
| 8 | 機器產生的紀錄（jsonl、raw log、截圖） | evidence/ |

- 同時符合 #4 與 #5 的（例如 qualification 既是 runtime 讀取又手動執行），#4 勝。
- 例外只能逐檔登記在登錄表並附理由。
- 頂層目錄與根目錄檔案都有白名單。
- 未接線的 hook 主檔（約 15 支）：P4 逐支判定，死碼刪除並記 CHANGELOG；應保留者登記進 opt-in-manifest，放進 hooks/opt-in/。不設 disabled 目錄。

## 2. 前置：路徑登錄表（不搬檔）
- 新增 `scripts/lib/repo-layout.js`（P4 隨 lib 一起搬），提供 Node API 與 shell CLI。
  - 內容：每類路徑、§1 決策表、白名單、逐檔例外。
  - **階段化**：登錄表記錄目前所在的階段（bootstrap、P1…P5），每個階段只啟用該階段已完成搬家的規則。同一次合併只會有一個生效的佈局，沒有路徑別名。
- 改讀登錄表的檔案：
  - check-plan-graduation.js、affected-suites.js、doc-drift-gate.js、preflight-release.sh、check-config-docs.js、scaffold-mission.js、lib/sealed-docs.js。
  - check-hook-inventory.js：目前只單層掃 hooks/，stemFromCommand 只認 `hooks/<name>.js`。
  - hook-harness-matrix.js、post-tool-chain-lib.js 的讀取路徑。
  - sync-manifest.json 的 trigger glob，以及 run.sh 的 glob、serial-suites.txt。
- 測試基準：新增 `tools/migrate/suite-baseline.js`，用**現行**的 run.sh 加 affected-suites 輸出基準清單，內容是每支套件的 ID、執行數量與通過／失敗狀態。
  - 往後每個階段比對「依 layout-map 換算後的 ID 集合、數量、結果」。
  - 缺套件、多出不明套件、結果改變都算紅。
  - 唯一允許的差異是 scripts/tests/ 那 2 支目前沒被執行的測試。P3 前先單獨跑並記入基準，P3 時預期它們加入。
- 新增 layout-lint，只檢查當前階段已生效的規則。負控制：雜檔、放錯目錄、未登記的頂層目錄。

## 3. 分階段搬家
- 每一階段一個 lane，由產生器 `tools/migrate/relayout-<phase>.js` 執行。
- 產生器的工作：git mv、改寫所有引用、改寫 sync-manifest 的 trigger、更新登錄表的階段、重產受影響的鏡像，並輸出 `layout-map.json`。
- 鏡像要逐階段處理：platforms/codex/plugin 與 .opencode/plugin-package 都要重產。產生器要改兩支 sync 腳本實際的對應關係，不能只改 manifest。

- **P1 docs 分流**
  - 使用者文件搬到 docs/guide/，貢獻者文件搬到 docs/dev/，新增 docs/README.md。
  - 工作紀錄搬到 project/，兩份 HANDOFF 合併成一份。
  - mission-*.json 搬到 project/missions/，但要受 §4 的閉包規則約束。
  - 9 月前已出貨的 plan 照既有規則歸檔。
  - INDEX.md 拆成「進行中」與按年份的「已完成」。
- **P2 證據搬家**
  - docs/plans/evidence 搬到 evidence/。借證據當 fixture 的測試改用 tests/fixtures 的最小複本。
  - 新寫入的證據：先盤點所有寫證據的程式，改成一律經過遮罩器 `lib/evidence-writer`。
  - leak-guard 對 evidence/ 新增的檔照常檢查，所以直接寫入也繞不過。
  - 既有證據不可改，在逐檔豁免清單內。
  - 負控制：用未遮罩的方式直接寫一個證據檔，檢查要紅。
- **P3 測試集中**
  - hooks/tests、scripts/*.test.js、hooks/*.test.js、scripts/tests 依決策表 #1 搬家。
  - tests/run.sh 成為唯一入口，並呼叫 mods 的 run-tests.sh。
  - 新增 `.github/workflows/test.yml`：跑 affected-suites 選出的測試加 repo 稽核，付費路徑照現行哨兵擋掉。
- **P4 核心重排（breaking）**
  - scripts/lib 搬到 lib/；scripts 與 tools 依決策表分；hooks 分三層。
  - check-hook-inventory 改成列舉 default 與 opt-in 兩層、比對它們與兩份註冊檔的分層一致、偵測未接線的 hook。負控制：放一支未接線的 hook、放一支分層錯的 hook。
  - 同步更新：hooks/README 的層表、plugin.json 的描述計數、CLAUDE.md 的 Scripts inventory（改成依子目錄列）、check-claude-md-inventory、profiles 雜湊鏈重釘、skills／references／src／mods／agents／project-config-template／.githooks 的全部引用。
  - 只剩測試在引用的 5 支腳本：逐支判定，死碼刪除。
- **P5 開源文件**
  - CONTRIBUTING.md：如何跑測試、§1 決策表、如何新增 skill、script、hook。
  - SECURITY.md：回報管道、憑證稽核結論與掃描限制、逐檔豁免的已發布紀錄。
  - CODE_OF_CONDUCT.md、issue 與 PR 模板。
  - 每個頂層目錄一份短 README，根 README 改寫結構段落。

## 4. 封存閉包（P1 前的 spike）
- 先列出每個封存物件，以及它引用的所有檔、雜湊由誰持有、路徑的解析基準、對應的檢查器：
  - mission 的 sources manifest、task-authority 綁定的 graph、seal.json 的 spec_path（docs/ 與 evals/ 都有）
  - prereg 凍結清單（例如 d0gate 59 檔）
  - profiles 雜湊鏈、golden fixtures、review receipt
- 每個依賴二選一：
  1. 保持位元組不變地搬家，同時更新雜湊持有者，產生新的「後繼物件」；舊物件保留為歷史紀錄，不改寫。
  2. 明確留在原處，並寫進登錄表的例外。
- 閉包內有任何一項無法驗證時，該批不搬。
- 每個階段合併前，所有封存物件都要由各自的檢查器重新驗證通過，例如 stamp-prereg --check、check-blueprint-conformance、sealed-docs。

## 5. 使用者機器遷移表（P4，無墊片）

| 位置 | 舊 → 新 | 偵測器 | 修正 | 修後驗證 |
|---|---|---|---|---|
| settings.json statusLine.command | scripts/statusline-live-tee.js → scripts/config/statusline-live-tee.js | SessionStart 一次性檢查＋dev-setup --check | 印出的 `node … --fix-settings` | 狀態列有輸出 |
| ~/.zshrc source 行 | scripts/agy-shell-guard.zsh → scripts/install/agy-shell-guard.zsh | 同上（讀 zshrc） | 印出的 sed 一行 | 新 shell 載入成功 |
| 專案 .git/hooks（install-hooks.sh 裝） | 指向 scripts/resolve-qc-gate.sh 等 → 新路徑 | SessionStart 在該專案時＋dev-setup --check | 重跑 `install-hooks.sh` | hook 執行 exit 0 |
| 專案 .claude/*-config.md | 引用 scripts/<舊路徑> → 新路徑 | SessionStart 在該專案時 | 印出的改寫指令（依 layout-map） | config-audit 通過 |

- 確切的新路徑以 P4 的 layout-map 為準，表中只是預期。
- 偵測依 layout-map 比對舊路徑字串，不看檔案是否存在，所以舊安裝還留在磁碟上的情況也會被抓到。
- 升級測試 fixture：
  - 用裝了 2.x 的乾淨 HOME 加一個已 onboard 的專案，四個位置都放舊路徑，另含「舊安裝仍在磁碟」的變體。
  - 每一項都要驗：偵測到、修正指令可執行、執行後經新路徑正常運作。
- 涵蓋平台：Claude Code 走 SessionStart；codex、opencode 由 dev-setup --check 列出。

## 6. 進行中工作與順序
- 每個階段開始前，進行中的 lane 先合併或停在乾淨點。P4 前必須清空，目前有 BL-0336 U1、U2 與 d0gate v2 U2。
- 其他分支用 `relayout-rebase` 依 layout-map 改寫自己的 diff。
- 順序：§2 → §4 spike → P1 → P2 → P3 → P4 → P5。
- 每個階段都是獨立 lane，走四席審查。P4 後發 alpha 給 owner 實測。

## 7. 驗收（每個階段）
- 依 §2 基準比對套件的 ID、數量與結果。P3 以前用現行 run.sh，P3 以後用 tests/run.sh。
- 合併前全綠：layout-lint、leak-guard、check-hook-inventory、hook-harness-matrix --check、check-claude-md-inventory、doc-drift-gate、check-plan-graduation、所有封存物件的檢查器、`sync-all.sh --check`（含 codex 與 opencode）。
- 另做一次 trigger 驗證：在被搬動的路徑改一個檔，確認對應的 sync trigger 會觸發。
- 每個新檢查都附負控制，並記錄先紅後綠的輸出。

## 8. 不在範圍
改寫歷史；鏡像是否改成 release 時才產生（另立 backlog）；拆成多個 repo；改寫 skill 內容（依 scorecard-first 規則另行處理）。

---
# 附錄：盤點摘要【盤點，develop @ 05704640d】
- 整體：git 追蹤 21,273 檔、約 221 MB。
  - docs/ 13,597 檔，其中 docs/plans/evidence 12,098 檔、80.75 MB。
  - evals/ 4,704 檔，codex 鏡像 833 檔。
- docs：
  - 使用者文件約 11 份、貢獻者文件約 14 份。
  - docs 根目錄 121 檔，其中 103 個是 mission-*.json。
  - INDEX 266 KB、BACKLOG 100 KB；9 月前未歸檔的 plan 121 份。
- scripts：385 檔，根層 275、lib 108、tests 2，其中 78 個測試與腳本混放。
  - 依性質大約是：runtime 90、gate 58、評測與一次性 49、安裝 12。
  - 引用次數（code-inventory §1.4）：skills 548、references 244、profiles 388、project-config-template 40（其中涉及 26 支腳本）、.githooks 22。
  - 只剩測試在引用的 5 支。
- hooks：
  - 55 個程式、39 個並排測試。
  - hooks.json 註冊 26 個預設 hook，opt-in-manifest 有 14 個選用 hook；per-turn-gate 屬選用但直接註冊。
  - 未接線的約 15 支。
  - hooks 反向 require scripts/lib：live-state-dir 26 次、config-path 18 次。
- 測試：hooks/tests 599 支，其中測 scripts 的 283、測 src 的 47、測 hooks 的 13；沒有跑測試的 CI。
- 個人資訊：`$HOME` 出現在約 4,402 檔，其中 docs 約 4,324、hooks 45、evals 39；主機名 17 檔；內網 IP 出現在 2 個證據檔。
- 引用證據路徑的測試與評測檔約 300 個（docs-inventory §4）。check-plan-graduation 約 100 處、affected-suites 55 處寫死路徑（repo-inventory §3）。

---
# 定稿修補（第二代審查，depth-0 裁決後全部採納；與正文衝突時以本節為準）

## F1. 測試基準：保留與新增分開
- 每個階段維護兩份清單：
  - **保留集**：既有套件經 layout-map 換算後，覆蓋範圍與結果必須不變。
  - **新增集**：本階段宣告的新套件 ID 與斷言數變化，例如 layout-lint、leak-guard、升級測試、各負控制。新增集要經四席審查。
- 判紅：未宣告的新增、保留集有缺漏、任何結果改變。
- suite-baseline 本身的負控制，三項都要紅：
  - 從基準拿掉一支套件
  - 注入一支不存在的套件
  - 把一筆通過改成失敗

## F2. 放置決策表修正
- 「工作紀錄 → project/」移到「使用者與貢獻者 md → docs/」之前，也就是 #6 與 #7 對調。負控制：一份 plan md、一份 handoff md 都必須判到 project/。
- 決策表下加註：被封存物件引用的評測 harness 資料與 prereg 語料留在 evals/（§4）；新的開發者用評測腳本依 #5 放 tools/evals/。
- bootstrap 階段的白名單就收 tools/，一開始只允許 tools/migrate/，之後每個階段加入 gates/、sync/、evals/。

## F3. 憑證與個人資料
- **憑證結論改寫**：在掃描涵蓋的類別內，確認的真憑證為 0。三類標成【未驗】：短於 32 字元的自訂 token、3 MB 以上的 blob、二進位 blob。
- **發布前補審**：
  - 列出所有大檔與二進位 blob 的路徑，逐一判斷類型，例如 PNG、壓縮檔、sqlite。
  - 對 `key=value`、`"token":` 這類語境做短值人工審。
- **事件程序**：任何一筆確認為真，就撤銷或換新，記錄位置、撤銷時間，並驗證舊值已失效。
- **凍結檔逐檔分類**，取代原本的一律豁免：
  - 歷史證據（evidence、評測原始輸出）：不可改，豁免要附理由。
  - 現行的非證據封存文件（plan、rubric、spec）含個人資料：依 §4 產生清理過的後繼物件並重新封存，舊版只留在歷史。
- **順序**（補 §6）：
  1. 先清理非證據檔的個人資料，接著啟用 leak-guard，兩者都在 P1 前。
  2. 遮罩器隨 P2 上線。
  3. 任何搬動時仍未清乾淨的檔，必須在同一個 commit 清掉。
- **遮罩器的負控制**：餵入合成的個人路徑、私有 IP 與金鑰樣式值，斷言寫出的檔已替換且不含原值；把遮罩關掉時，這項測試要紅。

## F4. 使用者機器路徑的完整清單（P4 前置）
- P4 前用腳本產生**完整清單**，涵蓋：
  - install-hooks.sh 裝進專案的每一支 hook 與它指向的路徑
  - statusline 與 shell 整合
  - project-config-template 會寫進使用者專案的每處引用（40 處）
  - README、docs/guide 中教使用者直接執行的指令
  - codex、opencode 安裝後會指到 repo 路徑的地方
- 若 codex、opencode 的鏡像是自足的、不指回 repo 佈局，就寫明並附驗證；否則加進遷移表。
- 清單的每一列都要有舊路徑、新路徑、偵測器、修正、修後驗證。升級 fixture 由清單產生，逐列驗證，不再用「等」概括。

## F5. P1 與 P4 的讀者補漏
- `docs/scripts-inventory.md` 以逐檔例外釘在原位，到 P4 才與 check-claude-md-inventory.js 一起搬。
- check-claude-md-inventory.js 現在找不到 inventory 檔時會放行，改成直接紅，並附負控制：把檔案搬走，檢查要紅。這是在把既有檢查補成真的會擋，屬機制修正。
- P4 新增工作項：
  - opt-in-multiplexer.js 與 hooks/_shared/opt-in.js 的 stem 對應路徑，改成認得兩層。負控制：stem 放錯層或解析不到時，hook-harness-matrix --check 或冒煙測試要紅。
  - README.md 與 README.zh-TW.md 的 hooks-N 徽章總數，加上 sync-version 的 hook-count，與刪除未接線 hook 同步重釘。
- 事實更正：stemFromCommand 認的是 `hooks/<name>.js` 或 `hooks/<name>.sh`。


---

# 第二部分：修訂 C 與落地裁決

## repo 整理 修訂 C v3 定稿：私有開發 repo 加上只收 release 的公開 repo

審查紀錄：四席 plan review（astra 主審）兩代，第一代 14 條、第二代 15 條全部採納；第二代修補見文末 D 節，衝突時以 D 節為準。

**依據**：owner d-f7e0e290 選 C，d-2c21f2e7 照定稿開工（layout/plan.md），衝突時以本修訂為準。四家 hetero 討論（histdisc/）：一致反對原地改寫；採用「只在 release tag 匯出、白名單、先掃描、記錄來源 sha、縮短空窗、release note 寫明收不回」。

## C1 角色
- **開發 repo**：`cookys/autopilot` 改名為 `autopilot-dev` 並轉私有，歷史全部保留，ADR-0001 照舊用原 sha。
  - owner 規定開發 repo 也不能亂：定稿 §0、§2、§4、P1–P5 全部照做，含 P2 證據搬到 evidence/、證據遮罩器、凍結閉包外的全面清理。
  - leak-guard 在 pre-commit 照樣硬擋。
- **公開 repo**：新建 `cookys/autopilot`，每個 release tag 一個 commit，帶 `Source-Commit: <私有 sha>`。
  - **第一個 commit**：P5 之後、經 owner 確認發布的第一個 3.0.0 alpha tag（預計 v3.0.0-alpha.7，版號凍結在 3.0.0，alpha 序號由 owner 確認）。

## C2 匯出 `tools/release/export-public.js`（預設全擋）
- **展開清單**：登錄表的 `publish` 規則展開成明確檔案清單，預計收錄：
  - `.claude-plugin/ .agents/ .opencode/ skills/ agents/ hooks/ lib/ scripts/ mods/ bin/ src/ schemas/ references/ profiles/ project-config-template/ platforms/ docs/guide/ docs/dev/`
  - 根目錄的 README*、LICENSE、CHANGELOG、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、plugin.json
- **不收**：tests/、evals/、evidence/、project/、.claude/。tests 依賴不公開的證據，公開了也跑不起來。
- **規則**：
  - 未登記或判斷不明的路徑，匯出直接失敗。
  - 每一層都是排除優先：收錄目錄內的 fixtures、jsonl、.env、證據樣式檔一律排除。
  - 產生物（鏡像）引用的檔都要在清單內。
  - 推送前，實際要推的樹必須與清單完全相同。
- **隔離私有歷史**：用 `git commit-tree` 從匯出樹建 commit，parent 只指前一個公開 commit。只從公開 repo 的乾淨 clone 推送，推前用 `git rev-list` 確認沒有私有物件。
- **檢查與負控制**：任一檢查紅、或檢查程式本身執行失敗，都不推送。全部 fixture 進 CI，切換前全綠。

| 檢查 | 負控制 |
|---|---|
| 清單比對 | 收錄目錄內放排除樣式的檔；未登記的路徑 |
| leak-guard | 個人路徑、私有 IP、.env |
| secret-scan-diff | 合成假金鑰 |
| 二進位 | 未登記的二進位檔 |
| 大檔 | 3 MB 以上的檔 |
| 短 token 語境 | `token=` 加合成短 token |
| hooks.json 目標存在 | 刪掉一個被引用的 hook |
| `bin/autopilot.js --help` | 讓它以非 0 結束 |
| 相對引用 | 引用一個未匯出的檔 |
| 可重現 | 同一個 tag 匯出兩次，改動其中一次的輸入 |
| 執行失敗 | 掃描器 exit 2 |

## C3 貢獻流程與成本（寫進 CONTRIBUTING）
- **issue**：開在公開 repo。舊 repo 仍開著的 issue，切換時逐一手動重開。
- **PR**：視為修補提案。維護者在開發 repo 用 `git am` 套用並驗證，作者記在 `Co-authored-by`，下一次 release 帶出；原 PR 留言註明收進哪個 release 後關閉。
- **成本**（估計，未驗）：
  - 每次 release：約 10 分鐘機器時間，加上維護者約 10 分鐘看報告並推送。
  - 每個外部 PR：約 15 分鐘。
  - 目前外部 PR 流量接近零。

## C4 切換 PC（第一個 alpha tag 匯出驗證通過之後）
**窗口開始前**全部完成：
- `git bundle --all` 兩份，驗證能 clone、記錄的 sha 都解得到。
- 記下每個工作樹與 fleet 主機的 remote。
- C5 查證完成，fleet 各台對私有 repo 的存取已實測。
- 匯出的快照已驗證。
- 建 repo 與推送的指令寫成腳本並空跑過。

**窗口內只跑腳本**：
1. 本機與 fleet 改指向 `autopilot-dev`，凍結推送。
2. 改名並轉私有。
3. 立刻建立新的公開 repo，推送第一份匯出。
4. marketplace 與安裝說明改成淺層 clone，fleet 安裝主機重新安裝。
5. 發 release note：需要重新安裝；開發歷史不再公開；已外流的收不回；星星與 issue 的去向依 C5 第 5 項查證結果寫。

**回復**：

| 失敗在哪 | 回復 |
|---|---|
| 改名後 | 改回原名 |
| 轉私有後 | 轉回公開、改回原名 |
| 建新 repo 後、首推前 | 刪掉新 repo，再同上 |
| 首推之後 | 只能往前修 |

- 轉私有可能清掉星星與 watcher，改回公開也不會恢復，所以回復不保證星星（待 C5 查證）。
- 第 2、3 步執行前再請 owner 確認，附上備份證據與這段說明。
- 那一個 fork 會脫離舊 repo 繼續公開，只能在公告中說明。

## C5 待查證（PC 前）
1. GitHub 改名後的轉址規則，以及建立同名 repo 會使轉址失效。
2. 公開轉私有時既有 fork 的處理。
3. Claude Code、codex、opencode 從 git 安裝與更新的方式：淺層或完整 clone、pull 或重新 clone。
4. fleet 各台存取私有 repo 的方式：deploy key 或帳號。
5. 轉私有對星星、watcher、fork、release 與附件的影響。

## C6 順序（取代定稿 §6）
1. §0 清理加 leak-guard
2. §2 路徑登錄表
3. §4 封存閉包
4. P1–P4
5. C2 匯出工具
6. P5 開源文件
7. alpha tag（owner 確認）
8. PC 切換
9. owner 實測

每一步一條 lane，走四席審查。§2 等 BL-0336 U1 合併後再開始。

---
# D 第二代修補（depth-0 裁決後全部採納；與上文衝突時以本節為準）

## D1 匯出範圍
- **scripts/ 只剩執行期工具**：匯出排在 P4 之後，那時 gates、sync 與 sync-manifest.json 都已搬進不公開的 tools/。
- **引用檢查涵蓋結構化資料**：JSON 的路徑欄位、trigger glob、指令參數中的路徑也算引用。指到未匯出的檔就紅。
- **任何深度一律排除**：測試檔與測試目錄（`*.test.*`、`tests/`）、證據樣式檔（例如 hooks/harness-support-evidence.json）。

## D2 新增匯出檢查
每項都有負控制，而且首推前全部到位：
- symlink、gitlink、submodule：除非逐一登記並附目標，否則紅。
- LFS 指標檔。
- 不在白名單內的檔案權限，例如可執行位只准表列的檔。
- 大小寫與 Unicode 正規化後撞名。
- 收錄目錄內深層的測試檔與證據樣式檔。

## D3 隔離冒煙測試
- **環境**：把匯出樹放進乾淨環境，無法存取開發 repo 與私有 remote。
- **內容**：對每個支援的用戶端（Claude Code、codex、opencode）各跑一次實際安裝、載入、執行一個代表性 hook、更新流程。安裝方式依 C5 第 3 項的查證結果。
- **負控制**：弄壞一個入口檔，或刪掉一個必要依賴，冒煙測試要紅。

## D4 歷史隔離與可重現的發布門
- **只准公開鏈**：公開 repo 可達的 commit，只能是已核准的公開發布鏈。每個新公開樹都要逐檔符合匯出清單。負控制：故意把一個私有 commit 接成 parent，要紅。
- **可重現**：固定來源 commit 與匯出器版本，兩次獨立匯出的內容清單必須相同。另把其中一次的輸出改一個 byte，比較器必須拒絕。

## D5 切換順序與確認
1. 先凍結寫入。
2. 再做兩份 bundle，並驗證它們涵蓋凍結當下的所有 ref。
3. 改名、轉私有、建新 repo 三步的不可回復影響，在窗口開始前一次請 owner 確認。確認後連續執行，中途不再等人工確認。
4. 演練時驗證這個順序。

## D6 回復腳本
- 依記錄下來的工作樹與 fleet 清單還原 remote、解除推送凍結、恢復寫入權限，再跑 fetch、push 與安裝冒煙。
- 涵蓋每一步之後失敗的情況：改指向、改名、轉私有、建 repo、首推之前。
- 首推之後只能往前修。

## D7 fork 與未查證事項
- **fork 先盤點**：每個 fork 記下 owner、可見性、URL、關係。依 C5 第 2 項的查證結果選處理方式（保留並通知、請對方封存或轉私有），經 owner 確認後寫進切換腳本。
- **未查證的說法一律附條件**：C4 中關於 fork、轉址、星星、安裝方式的句子，都改成「依 C5 查證結果」。release note 由查證結果產生。
- **查證沒完成就不切換**：切換腳本在 C5 各項結果未記錄時拒絕執行。

## D8 §0 落地裁決（depth-0，2026-10-31；依據 relay0-inventory.md）
定稿內部不一致：§0 要 pre-commit 硬擋且豁免只認逐檔，但遮罩器排在 P2；過去 30 天新增 10,605 個證據檔，硬擋會卡住每次證據提交。裁決（不放鬆既有條文，只提前已列項目）：
- **leak-guard 只看 staged diff 的新增行，開 rename 偵測**。從不修改的歷史證據（約 4,500 檔）不需豁免；P2 純搬檔也不需豁免。逐檔豁免登錄表只收會被修改又必須保留命中的檔（測試 fixture、guard 自己的測試與文件、endpoints.env.example 與鏡像等）。
- **遮罩器的 library 與 CLI 提前到 §0**，寫端自動接線仍在 P2。guard 擋下時印出可直接執行的遮罩指令。
- 不做 warn 模式，不做目錄豁免。
- 封存非證據檔（B 類 7 檔）不在 §0 改，處置見 D9 第 4 點；§0 只在 SECURITY.md 列出。
- 負控制：證據目錄下新建含個人路徑的檔必須紅（證明無目錄豁免）；登錄表不存在必須紅；三項植入（個人路徑、合成假金鑰、.env）先紅後綠；遮罩器關閉時其測試要紅。

## D9 §4 封存閉包裁決（depth-0，2026-10-31）
依據：`docs/plans/evidence/2026-10-31-repo-relayout-3-0-0/seal-closure.md`（含「relay0 前後比對」一節）。

1. **基準紅清單**：以下項目在 relay0 前（85b3189df）與現況（ca97d97b3）都是紅的，期間沒有 commit 動過它們，定為搬家前的基準紅。
   - 8 組 mission graph（名單照 seal-closure 比對表）：backlog-actionable-successor、codex-payload-residual-spike、codex-payload-residual-spike-successor、hook-test-harness-determinism、plan-review-codex-trusted-cwd-fix、qualification-verdict-stability、reviewer-output-token-budget-successor、skill-transport-implementer-arm。
   - 13 份 task-authority。
   - FROZEN g8、g67。
   - d0gate rail digest（預登錄 57d04ce6，現算 29dfe2ef）。
   - 2026-08-14 platform-capabilities。
   - depth0-per-turn-gate 的 g1、g2 審查 artifact。
   - 修改 §7「合併前全綠：所有封存物件的檢查器」：改為每個階段合併前，紅的集合必須與基準紅完全相同。不能新增紅；原本紅的轉綠或消失，也要在該階段寫明原因。
2. **sources manifest 的路徑基準（O1）**：manifest 照計畫進 `project/missions/`。
   - 檢查器 `loadSourceCoverageManifest` 改以登錄表的基準目錄解析 `plan_path`，基準是 `project/`；bootstrap 階段為 `docs/`。manifest 位元組不變。
   - 仍保留防路徑穿越：解析結果必須在基準目錄內。
   - 在 P1 lane 實作，屬機制改動。負控制：一個逃出基準目錄的 `plan_path` 必須紅。
   - 不採「manifest 放 `project/` 根目錄」：那會讓 `project/` 根目錄堆 103 個 json，不符合 owner「開發 repo 也要整齊」的要求。
3. **凍結列變成只能存檔（O8、O9、O12）**：
   - 搬家後，以下凍結列只當歷史紀錄，不再當正式可重跑的評測：
     - FROZEN g67、g8，以及指向 `check-guidance-eval.js` 的外部鍵。
     - next-touch 驗證器的釘表。
   - 這些列不改寫舊檔。要重跑就重新預註冊。
   - `next-touch-validation.js`、`validate-next-touch-*.js` 列為死碼退役候選，在 §3 處理「只剩測試引用」的腳本時一併評估。
   - d0gate v2 何時蓋章，待 owner 裁決 d-6cc94c50，選項是 P4 後蓋章或照原順序先蓋。
4. **SECURITY.md 與 D8 修正（O7、O8、O11）**：
   - B 類 7 檔、`evals/skill-onoff/packs/manifest.json`、`prereg/FROZEN.json`、各份 platform-capabilities.json，都留在私有開發 repo，內容不改。
   - 依 C2 與 D1，`evals/`、`evidence/`、`project/` 都不匯出。
   - 收回「§4 之後產生清理過的後繼物件」的承諾。
   - codex 鏡像裡那份 `platforms/codex/plugin/docs/projects/_archive/.../evidence/platform-capabilities.json` 位在會匯出的 `platforms/` 底下，C2 匯出工具必須依 D1「任何深度的證據檔一律排除」擋下它，並把這個實際路徑列為匯出工具的負控制。
5. **進行中的 mission（blind-review-2d-snapshot，O4）**：
   - 它的 6 個檔在退場前留在 `docs/`。
   - 若 P1 開始時仍未退場，登錄表加這 6 條逐檔例外，每條附理由。
6. **改寫器的禁止改寫清單**：
   - P1–P4 的路徑改寫器要讀一份獨立、可檢查的禁止改寫清單，涵蓋 seal-closure 總表的所有封存物件與其雜湊引用的檔，不只 `sealedDocFiles()` 的 34 張 graph。
   - 負控制：在清單內的檔植入一個字元，改寫器必須拒絕。
   - 這份清單在 P1 lane 建立。
