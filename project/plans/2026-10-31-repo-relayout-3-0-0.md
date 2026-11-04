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
- 每個階段開始前，進行中的 lane 先合併或停在乾淨點。P4 前必須清空，目前有 BL-0336 U1、U2 與 d0gate v2 U2（d0gate v2 U2 的處置見 D9 第 3 點）。
- 其他分支用 `relayout-rebase` 依 layout-map 改寫自己的 diff。
- 順序：§2 → §4 spike → P1 → P2 → P3 → P4 → P5。
- 每個階段都是獨立 lane，走四席審查。P4 後發 alpha 給 owner 實測。

## 7. 驗收（每個階段）
- 依 §2 基準比對套件的 ID、數量與結果。P3 以前用現行 run.sh，P3 以後用 tests/run.sh。
- 合併前全綠：layout-lint、leak-guard、check-hook-inventory、hook-harness-matrix --check、check-claude-md-inventory、doc-drift-gate、check-plan-graduation、所有封存物件的檢查器（比對規則見 D9 第 1 點）、`sync-all.sh --check`（含 codex 與 opencode）。
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
依據：`docs/plans/evidence/2026-10-31-repo-relayout-3-0-0/seal-closure.md`（含「relay0 前後比對」一節）。第一代審查後，第 1、2、3、4、5、6 點已修，第 7 點為新增。

1. **基準紅改成逐物件指紋**：下列物件在 relay0 前（85b3189df）與現況（ca97d97b3）都是紅的，期間沒有 commit 動過它們，定為搬家前的基準紅。只比「哪些物件紅」不夠，所以基準逐物件記三樣東西：
   - 穩定識別：物件路徑。
   - 正規化後的失敗診斷：不符的檔清單、算出的 digest、錯誤碼。
   - 該物件及其雜湊引用檔的逐檔 sha256。
   - 每個階段合併前，經 layout-map 換算後，三樣都要與基準完全相同。基準紅物件「變得更壞」或位元組被動到，都算紅；原本紅的轉綠或消失，也要在該階段寫明原因。方法沿用 seal-closure「relay0 前後比對」的逐行比對（兩點跑相同指令、`diff` 輸出）。
   - **基準紅完整清單，共 8 類，合計 27 個物件（8 graph、13 authority，加上 g8、g67、amend-5、amend-7、rail digest、2026-08-14 收據各 1，共 8＋13＋6）加 2 份審查 artifact（以 frozen-walk 與 ta.sh 於 ca97d97b3 唯讀重跑核對）：**
     1. 8 組 mission graph（`node scripts/mission-execution-graph-check.js` 產生）：backlog-actionable-successor、codex-payload-residual-spike、codex-payload-residual-spike-successor、hook-test-harness-determinism、plan-review-codex-trusted-cwd-fix、qualification-verdict-stability、reviewer-output-token-budget-successor、skill-transport-implementer-arm。
     2. 13 份 task-authority（比對 `mission_graph_digest` 與檢查器算出的 graph 摘要；產生器是 seal-closure 的 ta.sh，P1 一併進 repo）。路徑為 `docs/mission-<slug>-task-authority.json`，slug 為：
        agy-effort-rail-wording-2026-09-16、backlog-entry-migration、backlog-entry-schema、blind-review-packet-2026-09-16、disposition-resume-2026-09-16、final-panel-blind-admission-2026-09-16、final-panel-pins-2026-09-15、integration-ledger、ledger-rotation-order-2026-09-16、peer-residue-2026-09-15、proof-parity-raw-log-2026-09-16、qualification-verdict-stability（graph 本身也紅，檢查器 rc=2）、red-verification-repair-2026-09-16。
     3. FROZEN stage-graph-g8 列（`stamp-prereg.js --row stage-graph-g8 --check`，rc=2）：不符 4 檔：`packs/manifest.json`、`run-skill-onoff-eval.sh`、`run-skill-onoff-matrix.sh`、`stamp-prereg.js`。
     4. FROZEN stage-graph-g67（frozen-walk 走訪）：
        - 本體 5 個不符檔：`arms/g67/off.json`、`arms/g67/on.json`、`prereg/stage-graph-g67.json`、`prereg/stage-graph-g67.md`、`run-g67-campaign.js`。
        - amend-1 不符 3 檔：`run-skill-onoff-eval.sh`、`packs/manifest.json`、`README.md`（`stamp-g67-amendment.js --check` 只報前述的 `run-skill-onoff-eval.sh` 與 `README.md`，rc=2；兩個產生器的差異都要記）。
     5. FROZEN 修訂 amend-5 的 `lib/stage-graph-cell.js`（frozen-walk 走訪）。
     6. FROZEN 修訂 amend-7 的 `../../scripts/check-guidance-eval.js`（frozen-walk 走訪）。
     7. d0gate rail digest：預登錄 57d04ce6，現算 29dfe2ef（`run-d0gate-campaign.js --print-runner-pin`）。
     8. 2026-08-14 platform-capabilities（`platform-capability-claims.js validate-consumers`，claim-ID tampering，rc=1），以及 depth0-per-turn-gate 的 g1、g2 審查 artifact（plan sha256 不符，現算 45955cba，`check-phase-review-receipt.js`）。
   - **合法修改的第二個出口**：適用對象是基準紅物件中，雜湊引用檔落在第 6 點排除清單內的，主要是 d0gate rail digest 與 O9 rail 檔（P4 必改），其次是 O12 的 `validate-*.js`（退役候選）。該物件的指紋可以在「依計畫修改那些檔」的那個階段變動，條件有三：
     - 在 F1 新增集宣告「預期指紋變更」，附理由。
     - 把新指紋寫回基準指紋檔，與 layout-map 一起送審。
     - 未在排除清單內的引用檔仍然不得變動。
     這是「轉綠或消失要寫明原因」之外的第二個出口。
   - 其餘 FROZEN 表（files、w2a-g、amend-2/3/4/6/8、qs 系列、dcard 系列、gdorm、bpack、findings-batch 系列、d0gate）frozen-walk 全部相符，列為綠。
   - **產生器**：frozen-walk 目前只在暫存，在 P1 lane 進 repo，成為正式檢查器；各類紅各自的檢查器見上列括號。基準指紋檔（逐物件三樣記錄）在 P1 lane 產出，作為 repo 內的證據檔。
   - 修改第一部分 §7「合併前全綠：所有封存物件的檢查器」：改為每個階段合併前，紅的集合與指紋必須與基準完全相同，不能新增紅。
2. **sources manifest 的路徑基準（O1）與逐檔例外**：manifest 照計畫進 `project/missions/`。
   - 檢查器 `loadSourceCoverageManifest` 改以登錄表的基準目錄解析 `plan_path`，基準是 `project/`；bootstrap 階段為 `docs/`。manifest 位元組不變。
   - 仍保留防路徑穿越：解析結果必須在基準目錄內。
   - **逐檔例外要能宣告自己的解析基準。** 進行中 mission 的 manifest 留在 `docs/` 時，它的解析基準就是 `docs/`。
   - **所有讀 `plan_path` 的程式都走登錄表同一個解析器**，不各自寫死：
     - `scripts/mission-execution-graph-check.js`（sources coverage 檢查器，`loadSourceCoverageManifest`）。
     - `scripts/check-plan-graduation.js`（`plan_active_lineage` 讀 `plan_path`／`rubric_path`，第 479、610–638 行）。
     - `scripts/lib/sealed-docs.js`（讀 `docs/mission-*-sources.json`，以 `plan_path` 相對 `docs/`）。
     - `scripts/next-touch-validation.js`（寫死 `docs/mission-*-sources.json`、`path.join(repo, 'docs', source.plan_path)`；依第 3 點是退役候選，若仍保留就必須走同一解析器）。
     - `scripts/scaffold-mission.js`（產生 `mission-<slug>-sources.json`，輸出目錄與其中的 `plan_path` 要一致）。
   - 在 P1 lane 實作，屬機制改動。負控制：一個逃出基準目錄的 `plan_path` 必須紅；例外 manifest 用自己的基準時必須綠，改用全域基準時必須紅。
   - 不採「manifest 放 `project/` 根目錄」。理由更正：選項 A 搬的是 43 個 sources manifest（不是 103 個；103 是 docs 根目錄所有 mission-*.json 的數量）。選 A 會讓同一個 mission 的 sources manifest 和它的 graph、authority 分在兩個目錄，而且 `project/` 根目錄會多出 43 個 json，不符合 owner「開發 repo 也要整齊」的要求。
3. **凍結列變成只能存檔（O8、O9、O12）**：
   - 搬家後，以下凍結列只當歷史紀錄，不再當正式可重跑的評測：
     - FROZEN g67、g8，以及指向 `check-guidance-eval.js` 的外部鍵。
     - next-touch 驗證器的釘表。
   - 這些列不改寫舊檔。要重跑就重新預註冊。
   - **受影響的套件走 F1 宣告，不改 pin。** 搬動被釘檔的那個階段，下列套件要在該階段的 F1 新增集宣告為「退役」或「預期結果改變」，各附理由；`git grep -l` 核對的完整名單如下，階段開工時要重跑一次：
     - `hooks/tests/next-touch-validation.test.sh`、`next-touch-single-manifest-source.test.sh`（next-touch 驗證器與釘表）。
     - `hooks/tests/skill-onoff-g67.test.sh`、`skill-onoff-g8.test.sh`、`skill-onoff-gdorm.test.sh`（g67、g8 列與其外部鍵）。
     - `hooks/tests/hook-multiplexer-benchmark.test.sh`、`grok-implementer-ab.test.sh`（next-touch 釘表指向的 fixture 與證據）。
     - `hooks/tests/mission-terminal-rollover.test.sh`、`mission-retire-on-integration.test.sh`（fixture 內含 hook-multiplexer-benchmark 與 next-touch 的歷史文字）。
     - `hooks/tests/check-guidance-eval.test.sh`、`sealed-zero-diff-validator-parity.test.sh`、`uncalled-script-labels.test.sh`、`implementation-campaign-dogfood.test.sh`、`doc-drift-gate.test.sh`、`paid-batch-auth-stop.test.sh`、`session-marker-write-target.test.sh`（提到上述腳本或檔名，逐一判斷是否受影響）。
   - `next-touch-validation.js`、`validate-next-touch-*.js` 列為死碼退役候選，在 §3 處理「只剩測試引用」的腳本時一併評估。
   - owner 裁決（d-6cc94c50，2026-10-31）：d0gate v2 的預註冊在 P4 合併後才蓋章，pin 記錄搬家後的位元組。
   - d0gate v2 U2 在 P4 之前停在乾淨點，不算 P4 前必須清空的進行中工作。
   - 現有 d0gate rail digest 已不符（57d04ce6 對 29dfe2ef），屬於基準紅（第 1 點）。
4. **SECURITY.md 與 D8 修正（O7、O8、O11）**：
   - `docs/plans/2026-08-04-platform-capability-trigger-activation.md`（B 類第一筆）不在 `evals/`：它在 P1 隨 plans 以位元組不變的方式進入 `project/`，依 C2，`project/` 不匯出。在 P1 之前，C2 匯出工具的明確排除清單要點名這個檔，負控制：把它放進收錄範圍，匯出必須紅。
   - B 類其餘 6 檔在 `evals/skill-onoff/prereg/`，不搬。
   - `evals/skill-onoff/packs/manifest.json`、`prereg/FROZEN.json`、各份 platform-capabilities.json，都留在私有開發 repo，內容不改。
   - 依 C2 與 D1，`evals/`、`evidence/`、`project/` 都不匯出。
   - 收回「§4 之後產生清理過的後繼物件」的承諾。
   - codex 鏡像裡那份 platform-capabilities.json 位在會匯出的 `platforms/` 底下，C2 匯出工具必須依 D1「任何深度的證據檔一律排除」擋下它。負控制路徑用「依 layout-map 換算後的 P4 後路徑」，不寫死現在的 `platforms/codex/plugin/docs/projects/...`。
5. **進行中的 mission（blind-review-2d-snapshot，O4）**：
   - 實際路徑，共 6 檔，在退場前留在 `docs/`：
     - `docs/mission-blind-review-2d-snapshot-2026-09-19-execution-graph.json`
     - `docs/mission-blind-review-2d-snapshot-2026-09-19-sources.json`
     - `docs/mission-blind-review-2d-snapshot-2026-09-19-task-authority.json`
     - `docs/plans/2026-09-19-blind-review-2d-overlap.md`
     - `docs/plans/2026-09-19-blind-review-2d-overlap.rubric.md`
     - `docs/plans/2026-09-19-blind-review-2d-overlap.plan-review-manifest.json`（sources 沒有引用它，但與 plan 同 stem，`plan_active_lineage` 以 stem 判斷，所以跟著留）。
   - `.claude/mission-routing-config.json` 不搬，所以不放進 docs 例外。更正：seal-closure O4 原寫「graph、sources、authority、plan、rubric 共 6 檔」只列 5 項，實際第 6 檔就是上列 manifest。
   - 若 P1 開始時仍未退場，登錄表加這 6 條逐檔例外，每條附理由，且宣告解析基準為 `docs/`（見第 2 點）。
6. **改寫器的禁止改寫清單（範圍只放位元組必須保持不變的檔）**：
   - P1–P4 的路徑改寫器讀一份獨立、可檢查的禁止改寫清單，涵蓋 seal-closure 總表中位元組必須保持不變的封存物件與其雜湊引用的檔，不只 `sealedDocFiles()` 的 34 張 graph。
   - 負控制：在清單內的檔植入一個字元，改寫器必須拒絕。這份清單在 P1 lane 建立。
   - **依計畫允許修改的檔列為排除，各附理由，並接到第一部分 §1 的逐檔例外機制：**
     - O9 的 rail 檔（`dispatch-hetero.sh`、`per-turn-gate-arm.js`、`gate-verify.js`、`hooks/per-turn-gate.js`、`lib/seed-claude-config.js`）：P4 必改，該列已轉為存檔（第 3 點）。
     - O8 的被釘測試檔：只有 `hooks/tests/skill-onoff-g67.test.sh` 與 `skill-onoff-g8.test.sh` 兩個（FROZEN 的 `../../hooks/tests/` 鍵實查只有這 2 個），P3 搬，列已轉為存檔。`skill-onoff-gdorm.test.sh` 在第 3 點有宣告，但 FROZEN 沒有釘它的位元組，不屬排除項。
     - O12 釘住的 `validate-*.js`：退役候選。
     - O10 repin 流程裡的兩份 SKILL.md（dev-flow、ceo-agent）：重釘流程本來就會改。
     - O14 anchors manifest 的 `file` 欄：P4 只改這一欄，區段雜湊不變。
7. **匯出後執行期的收據依賴（O11）**：
   - 查證結果（讀程式，未執行）：`scripts/dispatch-hetero.sh:2125` 與 `scripts/dispatch-review.sh:299` 的 `validate_d2_agy_claims` 把收據預設路徑寫死為 `$SELF_DIR/../docs/projects/_archive/2026/08/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json`，環境變數 `AUTOPILOT_PLATFORM_CAPABILITY_RECEIPT` 可覆蓋。收據不可讀時直接 `die_precondition "D2 capability claim validation failed"`，沒有預設行為。只有 agy 席位會走到（hetero 在不是 codex、grok 等其他 runner 時；review 在 agy 審查席），且之後還會 `--reprobe`。
   - `scripts/sync-codex-plugin-skills.sh:102` 把同一份收據列在 `DOC_FILES`，同步進 codex 鏡像，所以會被帶進會匯出的 `platforms/` 底下。
   - 裁決：匯出的執行期程式不得依賴未匯出的檔。C2 之前要有一條 lane 依證據二選一：(a) 收據缺少時，走有文件、有測試的預設行為；(b) 另外產生一份不含個人資料的執行期收據，並且匯出。
   - 在這之前，D1 的引用檢查必須能對現行寫死的路徑轉紅，當作負控制。

## D10 P1 落地裁決（depth-0，2026-11-02；依據 p1-plan dry-run 與 simulate 比對）
1. **4 個未分類檔**：`docs/review-candidate.md` 進 `docs/guide/`；`docs/training/README.md` 刪除（只是搬家墓碑）；`docs/COEXISTENCE-fable5.md` 進 `project/handoff/`；`docs/metrics/surface-lines.json` 留在原位，登錄表逐檔例外（讀它的是 `repo-layout.js` 與 `preflight-release.sh`）。
2. **9 月前 plan 的歸檔**：既有 `check-plan-graduation` 現況回報 0 份未歸檔，計畫的 121 份是日期篩。改用三條件：日期早於 2026-09-01；INDEX 有 row 且不在進行中或規劃中；沒有被封存 sources manifest 釘住，也不是進行中 mission 的 lineage。共 71 份歸檔。被 sealed manifest 釘住的 16 個 stem 留在 `project/plans/` 不歸檔，因為 manifest 位元組不能改，`plan_path` 以 `project/` 為基準解析，歸檔會讓它解析不到。另有 1 份在規劃中、1 份沒有 INDEX row，同樣不歸檔。
3. **歸檔目錄裡的證據檔**（221 個，`docs/plans/_archive/**/evidence/**` 與 `docs/projects/_archive/**/evidence/**`）留給 P2：規則 6 與 7 補排除，規則 8 補納入（P2 才啟用）。
4. **D9.7 收據** `docs/projects/_archive/2026/08/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json` 留在原位，登錄表逐檔例外，理由引 D9.7「C2 前另開 lane 二選一」。`dispatch-hetero.sh`、`dispatch-review.sh`、`sync-codex-plugin-skills.sh` 三支不改。
5. **D9.4**：`docs/plans/2026-08-04-platform-capability-trigger-activation.md` 位元組不變進 `project/plans/`，用測試斷言與 dry-run summary 的一段說明記錄，不寫成例外（例外的語意是「逃出規則」，schema 沒有目的地欄位）。
6. **登錄表改動**：照 dry-run `plan.json` 的 `registry_changes` 核准，加上 surface-lines.json 與 D9.7 收據兩條例外，以及規則 6、7、8 的歸檔證據排除或納入。
7. **HANDOFF**：合併 `docs/HANDOFF.md` 與 `docs/projects/ongoing-maintenance/HANDOFF.md`；`HANDOFF-l6-resilience.md` 與 `HANDOFF-engine-qualify-seats.md` 只改名。
8. **INDEX**：P1 只把 INDEX.md 原樣搬到 `project/projects/`。拆分與 5 支讀者的改動另開 P1b。
9. **引用改寫規則**：只改寫 layout-map 的精確 key（完整檔案路徑）；目錄形式的 `docs/plans`、`docs/projects` 不盲改，列清單逐類判斷。測試 fixture 以 mktemp 建 `docs/` 樹的不碰。D9.5 的 6 個檔與 `.claude/mission-routing-config.json` 搬完必須與原本一模一樣；封存 mission json 位元組不動；CHANGELOG 連結照改；profiles 雜湊鏈不用 sed，改走 `profiles-hash-repin` 順序，獨立 commit；`no-rewrite.json` 的 path 欄位跟著改、sha 不變，獨立 commit。
10. **recorder 修正**：`seal-baseline.js` 的 recorder 把 sources 的 `plan_path` 當成相對 graph 所在目錄，與檢查器（走登錄表基準）不一致；P1 前改走 `repo-layout.js` 的 `manifestBase` / `resolveManifestPath`，並證明在 base 樹上重新 record 與已提交的 `seal-baseline.json` 位元組相同。
11. **個資遮罩保留**：leak-guard 把搬移後又被改過的檔當成全是新增行來掃。合併後的 `project/handoff/HANDOFF.md`，以及連結被改寫的兩份封存 plan（`2026-06-03-distill-handoff.md`、`2026-10-13-review-only-external-candidate.md`），上面的 `scripts/redact-personal.js` 遮罩（`<email>`、`<host>` 之類的佔位符）照舊保留，不為了通過掃描而還原，也不加 `leak-guard-registry.json` 例外。改寫器在 refs-docs 與 content 階段對這三個檔跑一次 redact-personal，重跑結果相同。
12. **BACKLOG 欄位上限**：路徑改寫讓 t14 gate-batch 那一列的 Source 多出 3 個位元組，超過 160 的上限，而上限是 block 等級的檢查。改寫器在 content 階段把那個括號裡的「already」拿掉，其他字不動。
13. **resolve-project-paths 測試**：這支測試用 HEAD 的登錄表造「bootstrap」與「P1」兩個 worktree，原本是把 `docs/` 改成 `project/`。HEAD 本身變成 P1 之後方向要反過來：bootstrap 那個把 `project/` 改回 `docs/`，P1 那個就是 HEAD，backlog 是 `project/backlog/BACKLOG.md`。改寫器在 content 階段逐處精確替換，每處必須恰好命中一次。
14. **測試檔改寫規則與 dispatch-hetero fixture**：測試檔裡只有路徑前面是 repo 根目錄變數（`$REPO_ROOT/`、`path.join(REPO_ROOT, '`）時才改寫；其他一律維持 `docs/`，兩個通用鍵也一樣。例外是改寫器內逐檔審過的清單 `THIS_REPO_TEST_FILES`：這些測試讀的是真實 repo 的路徑，或比對工具印出的真實路徑。`dispatch-hetero.test.sh` 的 hermetic 倉庫會複製已封存 graph 提到的檔案；graph 位元組不能改，它的 `spec.path` 仍是搬家前的名字，`plan_path` 則以 `project/` 解析，所以 content 階段讓 fixture 兩個名字都放一份（舊名字由已提交的 layout-map 反查新位置）。
15. **複製登錄表的 fixture**：`semver.test.sh`（preflight-release）與 `backlog-peer-report-lost.test.sh`（pre-push 沙箱）把真實的 `repo-layout.js` 複製進自己造的 docs/ 風格倉庫。登錄表現在是 P1，會和 fixture 的檔案位置對不上。這兩處不改測試的路徑，而是在複製之後用 sed 把 fixture 裡那份登錄表改回 docs/ 路徑（與 resolve-project-paths 的 fixture 同一條 sed），讓 fixture 繼續當消費端慣例。這兩個檔因此不在 `THIS_REPO_TEST_FILES` 裡。
16. **專案設定檔清單**：content 階段改寫目錄形式路徑的 5 個檔（`.claude/backlog-config.md`、`dev-flow-config.md`、`finish-flow-config.md`，以及 foreman-landing-pipeline 的 `closeout-brief.md`、`implement-brief.md`）都是本 repo 自用的設定與工頭模板（模板裡的 `$C` 指 autopilot 的 clone），不是給消費端複製的範本；消費端範本在 `project-config-template/`，那裡的 docs/ 維持不動。
17. **階段的驅動層**：每個 apply 階段只接受全新的乾淨 clone：開工前 `git status --porcelain --ignored` 必須完全是空的（沒有修改、未追蹤或被忽略的檔），否則 exit 2、什麼都不寫，所以回滾時沒有既有檔案可能被弄丟。階段拋錯時由驅動層統一還原：tracked 檔與 index 回到 HEAD，並移除所有未追蹤或被忽略的檔（在乾淨 clone 裡，那只可能是本階段新增的）。`--log` 的寫入屬於階段本身：寫不進去就讓階段失敗並還原，不做 best-effort，因為呼叫端要了 log，半套落地比被拒絕更糟。指令鏈要在每個階段之間 commit，遇到失敗就停：`for ph in …; do apply --phase $ph && git add -A && git commit -qm $ph || exit 1; done`。
18. **通用鍵預設保留（結構規則）**：`docs/BACKLOG.md` 與 `docs/projects/INDEX.md` 在任何地方都預設維持 `docs/`，因為它們是消費端慣例的名字。只有三種情況改寫：(1) 前面接著指本 repo 根目錄的變數（`$REPO_ROOT/`、`path.join(REPO_ROOT, '…`）；(2) 整檔都在講本 repo 的工作紀錄、設定或同步清單，即改寫器內的 `THIS_REPO_GENERIC_PATHS`（`project/` 下搬過去的檔、`.claude/`、`CHANGELOG.md`、`CLAUDE.md`、`AGENTS.md`、`scripts/sync-manifest.json`，後者的檢查指令跑在本 repo 的 backlog 上）；(3) 逐行審過的 `THIS_REPO_GENERIC_LINES`（見 19）。沒有人審過的檔保留原文，所以漏列的結果是保守的。取代第 2 輪的 `CONSUMER_FACING_FILES` 反向清單（那份漏了 `next-pick.js` 與 `dispatch-experience-critic.sh`，同一類第二次出現）。它們的功能性路徑都走登錄表，不靠字面。全 repo 逐檔的舊規則與新規則對照在 `scan-table-generic.md`。
19. **逐行清單與 hooks/README.md**：`THIS_REPO_GENERIC_LINES` 逐行審過，用該行的一段文字指名，只放講本 repo 自己 backlog 的句子（BL 編號、某一列、連結）：`consult-discuss-seats.md`、`evidence-discipline.md`、`hetero-dispatch.md`（兩處）、`tree-adapter.md`、`context-continuation.md`、`hetero-impl-loop.md`、`hooks/README.md`（Tracking、tracked in、/compact 三行）、`agent-liveness-check.js`、`watch-foreman.js`、`hooks/fixtures/agy-payload-probe/README.md`。不在清單內而保留 `docs/` 的有 `governance-config.md`、`knowledge-routing.md`（兩處）、`reviewer-mvp-portfolio.md`、`finish-flow/SKILL.md`、`next-pick.js`、`dispatch-experience-critic.sh`。`hooks/README.md` 是本 repo 的檔，但 session-handoff 那一列描述每個使用者 repo 的 handoff 檔，所以 `KEEP_DOCS_LINES` 讓該列的 `docs/HANDOFF.md` 維持原樣；該檔其他鍵（settings-reference、BACKLOG、封存 plan）都是本 repo，照改。
20. **GitHub blob 連結**：`github.com/cookys/autopilot/blob/<分支>/<layout-map 的鍵>` 的路徑段落和一般引用一樣改寫，因為連結跟著分支走。釘在 commit 或 tag 的連結指向當時的樹，舊路徑才是對的，維持不動。被封存的 eval pack 內的複本照 no-rewrite 清單不改。
21. **改寫器的字面後續與設定檔位置**：五個設定檔裡的目錄形式和佔位符路徑（`docs/projects/YYYY-MM-DD-<name>/`、`docs/plans/YYYY-MM-DD-<name>.md`、`mkdir -p docs/…`、`mv docs/projects/… docs/projects/_archive/…`、`$C/docs/backlog/`）的新位置一律向登錄表問（`pathFor`），evidence 在 P1 仍留在 `docs/plans/evidence/`，也由登錄表回答，不自己推。另有三處沒有模式可循的殘留，用必須恰好命中一次的字面替換：`.claude/dev-flow-config.md` 裡「autopilot's tree is `docs/`」的說明；`seal-baseline.test.sh` registry-base 斷言的否定條件（它指的是舊 recorder 算出的 `project/missions/plans/…`，改寫把它變成沒有任何 recorder 會產生的字串，條件永遠成立，現在還原成會命中的字串並加一條斷言證明舊 recorder 真的產生它）；`uncalled-script-labels.test.sh` 的 ADR 路徑註解。
22. **凍結檔與被 manifest 釘住 hash 的檔**：`evals/skill-onoff/prereg/stage-graph.md`、`stage-graph-card.json`（計畫仍 active）與 `evals/skill-onoff/archaeology-scan.js` 位元組不變；`evals/orchestration/run-p2-batch.js` 也一樣，因為 per-turn-gate 各批 `manifest.json` 的 `hashes.wrapper` 釘著它的 sha256，p2-batch-loop 套件會拿現檔對這個雜湊。`FROZEN.json` 的雜湊蓋的是 P1W 的 markers、transcript-query 與各 prereg 檔，沒有蓋到這四個，所以 seal-baseline 的 `build-no-rewrite` 產生器從來沒列它們（且該產生器現在無法重現已提交的 `no-rewrite.json`：已提交檔多了 49 筆後加的項目）。因此由 relayout 工具自己封存：`FROZEN_PREREG` 常數讓 refs 階段從第一個階段起就跳過它們，no-rewrite 階段把它們的項目寫進 `no-rewrite.json`（sha256 取自 HEAD 的 blob，檔案必須仍等於 HEAD，依路徑插在排序位置，`via` 為 `prereg-frozen:D10.22` 或 `manifest-pinned:D10.22`）。`no-rewrite.json` 兩種格式都不像時拋 InputError。全 repo 掃描「sha256 被別處寫下的檔」的表在 `scan-table-pinned.tsv`：真正拿現檔對雜湊的只有這個 wrapper；其他命中是封存的 pack 副本（evals/skill-onoff/packs/manifest.json 釘的是 pack 內的檔，live 檔只是內容相同）、dogfood-packet-MANIFEST 的歷史封包紀錄，以及 profiles 雜湊鏈（由 profiles 階段重釘），都沒有任何測試拿 live 檔對它們。
23. **supersession-anchors.json 的 note**：`check-supersession-anchors.js` 保護的是 `protected_regions` 指向的原始檔區段的 sha256，json 自己的 `note` 欄位不在保護區內，所以 P1 照一般引用改寫 note 裡的封存 plan 路徑；O14 的說明「P4 只改 file 欄位」指的是 `file` 欄位要等 P4 才動，沒有排除 P1 改 note。
24. **evidence 子樹不改寫，並在每個 refs 階段結尾做總檢查**：路徑底下有 `evidence/` 這一段的精確鍵（`EVIDENCE_RE`）在 P1 一律不改寫，不論 layout-map 怎麼寫，因為 evidence 在 P2 才搬。從搬走的檔出發、指向沒搬的 evidence 檔的相對連結仍要改基準（連結本身要繼續有效），所以連結規則不套這條。另外每個 refs 階段結束時，這個階段寫進文字的每一個路徑（精確鍵、GitHub 連結、相對連結的新目標）都必須是樹裡存在的檔，否則階段失敗、exit 2、驅動層還原。
25. **content 階段的兩句說明**：`docs/README.md` 加一句「evidence 目錄（`docs/plans/evidence/`、各 `_archive/**/evidence/`）在 P1 仍留在 docs/，P2 才搬」；合併後 HANDOFF 的作者位址一行維持 D10.11 的遮罩，同一行補上位址的格式（形如 `<id>+<user>@users.noreply.github.com`，用 git log 查 owner 的提交），由 `annotateHandoffAddress` 在遮罩之後寫入。不寫 `git log -1`：最近一次提交的作者可能是錯的身分。
26. **sandbox 與 fixture 的身分一律一種處理**：登錄表的 `path(key)` 回本專案的位置。仿本專案結構的 sandbox（複製 profiles、skills 與一個專案目錄，`profile-guided-dispositions` 早就這樣寫：註解『the sandbox mimics THIS repo』，路徑向登錄表問）與以 `REPO_ROOT` 指向的 mktemp 專案樹，都把工作紀錄建在登錄表說的位置，因此 P1 之後是 `project/…`；讀取者不改。content 階段用必須恰好命中一次的字面替換改兩支測試：`check-escalation-coverage` 的 fixture 改向登錄表問 `projects_dir`／`projects_archive_dir`；`qualification-scorecard-tools` 的 r75 sandbox 與其來源改 `project/projects/_archive/…`。被審的 repo 是另一個 fixture 時（`review-packet`、`review-runner`），拿 `defaultDenyList(<被審 repo>)`，不拿本專案常數 `DEFAULT_PACKET_DENY_LIST`（可執行的清單 `src/runners/review-packet.js` 本身已是登錄表驅動，沒有字串被改寫，是測試拿錯清單）。曾考慮把 `check-escalation-coverage.js` 與 `build-profile-payload.js` 改成 `pathFor(root)`，驗證時與 `profile-guided-dispositions` 既有的 sandbox 慣例衝突而撤回；讀取者對非本專案根目錄的行為屬登錄表遷移的後續，掃描見 `scan-table-readers.md`。
27. **hermetic 副本補回密封 mission graph 還在用的舊名**：D9.5 的現行 mission graph（位元組不變）把 `docs/BACKLOG.md` 列為 node 的輸出路徑，enforce 模式的 session-mode 在沒有執行期狀態可以替它背書的副本裡，會因輸出檔不存在而拒絕（`OUTPUT_MISSING_CREATE_AUTH`）。所有以 `REPO_ROOT="$TEST_TMP/hermetic-repo"`（或 `$TMP`）建立 hermetic 副本的 hooks/tests 套件（`session-mode`、`dispatch-author-session-mode`、`status-finish-followup`、`context-window`、`dispatch-author-claude-native`、`mission-routing-admission`），加上 `autopilot-cli` 的 `copy_hermetic_repo`，因此補一份 `docs/BACKLOG.md`（content 階段一條規則 `seedHermeticCopies`，不是逐支補），做法同 D10.13 的 dispatch-hetero fixture（密封 graph 用舊名，fixture 兩個名字都放）。這是測試的處置；真實 repo 的處置 owner 已裁定選項 C（卡 d-0d8b3b31）：由 routesucc lane 把 mission routing 改指向 successor graph，執行期的 legacy 重綁在合併後做。

---
# E 修訂（PM 裁定 2026-11-05；與上文衝突時以本節為準，上文各節不改）

來源：PM 以 fleet 訊息於 2026-11-05 裁定（`pm--claude`）；E1(a) 另引 operator 規則「不要用託管 CI 一樣都走本機」（`CLAUDE.md` Process rules：「No hosted CI (operator): suites and the merge gate run locally; never add a hosted workflow」）。方向提案見 `project/plans/2026-11-05-rolekit-direction.md`。
版號依 operator 決策卡 d-c76529c3（2026-11-05，PM 轉達）：角色套件工作照 3.0.0 現行 bump 規則走 3.0.0.x，不升 3.1。

## E1 三項修訂
**(a) P3 不新增 `.github/workflows/test.yml`**（取代 §3 P3 第三條，原文在 `:100`）
- 來源：operator 規則（上述）加 PM 裁定 2026-11-05。
- P3 改成：`tests/run.sh` 仍是唯一入口；驗證在本機跑，合併前用 `node scripts/affected-suites.js` 選套件，選到至少一半就跑全套（`tools/migrate/suite-baseline.js` 的 `record`，依 `skills/quality-pipeline/references/test-policy.md` 的 operator 決定 d-a62f4abc）；付費路徑照現行哨兵擋掉。不新增任何託管 workflow；C 章與 §7 提到「進 CI」的 fixture，一律理解為本機執行。

**(b) 保留頂層 `roles/`（角色套件，3.0.0.x 的工作）**
- 來源：PM 裁定 2026-11-05。這裡只保留位置，內容與是否出貨由 `project/plans/2026-11-05-rolekit-direction.md` 決定；本修訂不建立 `roles/`。
- 放在 **P4**：頂層白名單是登錄表 `scripts/lib/repo-layout.js` 的 `allowlists.top_dirs`，每項帶 `since` 階段，layout-lint 的 `allowlist:top_dirs` 檢查讀它（`scripts/layout-lint.js:156`）；P4 是最後一個改頂層目錄集合的階段（新增 `lib/`、tools 子目錄），把 `roles`（`since: 'P4'`，purpose: 角色套件，3.0.0.x 工作）一起登錄，避免在 P5 之後為它單獨再改一次登錄表。實體只有 `roles/README.md`（空目錄不進 git），由 P4 的產生器建立。
- 匯出白名單在 **C2**（`:245`）：展開清單加入 `roles/`，3.0.0 時其內容只有 README；規則仍是排除優先。P5 的「每個頂層目錄一份短 README」順帶涵蓋它。
- 若 3.0.0.x 的 A/B 不成立，再以修訂撤銷這個位置。

**(c) BL-0388 使用端那半邊，列為 3.0.0 的一步，排在 P4 之後、C2 匯出工具之前**（C6 的第 4 與第 5 步之間）
- 來源：PM 裁定 2026-11-05。內容見 `project/backlog/BACKLOG.md` 的 BL-0388 與 `project/backlog/consumer-rules-in-claude-md.md`：plugin 的 CLAUDE.md 到不了使用端專案，所以使用端需要的規則要改由 skill、hook 或 reference 帶。
- 為什麼在 P4 之後：P4 才改完 `scripts/`、`hooks/` 的位置與 CLAUDE.md 的 Scripts inventory，這一步要掃根目錄與子目錄的 CLAUDE.md，先搬完再掃，規則只改一次；為什麼在 C2 之前：匯出的是公開版，公開版的使用端要拿到這些規則，且 C2 的相對引用檢查要看到規則的新載體。
- 載體優先選 hook 與 reference；改 skill 本文屬於內容改寫，依 `skills/CLAUDE.md` 的 scorecard-first 另行取得 eval 證據（§8 本來就把改寫 skill 內容排除在範圍外）。
- BL-0388 留在 backlog，當這一步的追蹤列；完成時依 plan-graduation 規則關閉。
