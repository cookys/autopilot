# Plan — 表面積精煉（surface-area reduction）

> Status: R1 — MiniMax-M3 對抗審查（3🔴3🟠）已裁決收編，見文末審查紀錄。交 codex 線實作。
> Size: B 組＝S（一週內）；C 組＝M（一個 sprint）。
> 憲法級約束（Cookys 2026-07-04 明示）：**`/l3`–`/l6` 等 slash 入口是人類肌肉記憶的
> invoke 點，一個都不能少** —— 精煉的對象是文件與鏡像的表面積，不是入口、不是功能。

## 0. 論點與現況數據（2026-07-04 量測）

複雜度不在 27 個 skill，在表面積。北極星：**每個版本 prose 行數應降、engine 行數應升**
（prose 靠模型自律執行、會被 rationalize；code 可測試）。

| 層 | 規模 | 定性 |
|---|---|---|
| codex 鏡像 `platforms/codex/plugin` | 185 檔 / 37,397 行 | 純稅（repo 一半） |
| prose（27 SKILL.md 4,099 行＋42 references 6,113 行） | 10,212 行 | 負債率最高 |
| scripts | 69 個 / 20,446 行 | 資產 |
| engine `src/` | 3,025 行 | 資產、正確方向 |

## 1. B 組 — 一週內（零功能損失、零入口損失）

### B1. `/l3`–`/l6` 薄殼化（NOT 合併入口）
四個 skill 目錄與 slash 命令**原樣保留**；四個 SKILL.md 瘦成薄殼 —— 但薄殼不是一行指標：
保留 frontmatter 觸發語＋**3–5 行語意摘要**（該層最不可違反的硬規則，如 l5 的 immutable-base、
l6 的「勞務外派信任不外派」）＋粗體 MUST-READ 指向 `level-front-door.md` §LN。
超出 front-door 的身體內容（l5 roster 段、l6 per-unit pipeline）上移進 front-door 對應章節。
註：front-door 檔頭本來就宣告「The /lN skills are thin — all execution semantics live here」——
l5/l6 長出身體是對原設計的漂移，本項是回歸而非新設計；l3/l4（31/42 行）證明薄殼模式可行。
驗收（行為探針，非文字斷言 —— R1-F1）：薄殼化後 `/l5`、`/l6` 各實際觸發一次，
驗證 (a) 它讀了 front-door（transcript 可見）(b) immutable-base／dispatch-author 規則被遵守；
`validate.sh` 綠；四檔合計 ≤80 行。

### B2. think-tank-dialectic 薄殼化
同 B1 模式：`/think-tank-dialectic` 入口與 description 保留；350 行身體遷成
`think-tank/references/dialectic-mode.md`；薄殼保留 3–5 行語意摘要（何時該升級、絕不首發）
＋MUST-READ 指標。dialectic 的 6 個 references 隨遷。
**升級判定不動**：LOW-consensus→dialectic 的判定規則住在 think-tank SKILL.md，本項不碰它
（R1-F2 建議抽成 script/engine 判定 —— 判定是重判斷輕機械，現階段 REFUTED；
記為北極星「prose→kernel」的未來候選）。
驗收（行為探針）：薄殼化後實際觸發 `/think-tank-dialectic` 一次，驗證它載入 dialectic-mode.md
並執行既有流程（沉默預檢→問題重述 gate→…）；think-tank 的升級段文字未被改動（git diff 空）。

### B3. `model-routing.md` 去重（5 份 → 1 canonical）
`references/model-routing.md` 為 canonical。四份 skill 內副本**保留為真實檔案**
（引用路徑零破壞），但降格為「生成物」：`sync-version.js` 式的同步腳本從 canonical 覆寫四份，
＋`check-canonical-invariants.sh` 加一條 **byte-parity** 檢查（四份必須與 canonical 位元組相等，
否則 pre-commit 紅）。（R1-F4：指標檔方案有相對路徑深度與兩處真相問題 —— 採其替代案；
symlink 因 rsync `-L` 出局的判斷維持。本項目標是「單一維護真相」，非省行數。）
驗收：改 canonical 後跑同步腳本四份跟進；手改副本被 pre-commit 擋下。

### B4. Tier 標記（分層不分家）
兩步走（R1-F5：frontmatter 未知欄位的跨平台解析容忍度未驗，不得先宣稱「無行為影響」）：
1. **第一步只動 `docs/skills.md`** 排版三層：核心（dev-flow、quality-pipeline、learn、next、
   finish-flow、debug）／委派（ceo-agent＋lN 家族）／pioneer（其餘）。零 frontmatter 改動。
2. frontmatter `tier:` 欄位＝獨立後續：先在 claude code＋codex 兩平台各做一次帶未知欄位的
   plugin load dry-run，確認解析容忍，才動手。
驗收：第一步後 `check-readme-parity`／`validate.sh` 綠；第二步有兩平台 load 紀錄。

## 2. C 組 — 一個 sprint（結構性）

### C1a. Spike（先行、獨立收尾）— codex 安裝源可指向什麼？
用真 codex CLI 驗三個候選：orphan branch／release artifact／獨立小 repo。
產出=一頁紀錄（哪個可行＋逐字命令）。**Spike 結論出來前，C1b 不存在**（R1-F3：
上一版把未驗證方案直接寫進驗收，違反本 repo「不驗證不宣稱」—— 已改正）。
Spike 全滅的誠實出路：維持 committed mirror，本項作廢，改僅追求 B 組。

### C1b. 鏡像改「發版時生成」（-≈39k 行；以 C1a 結論為準）
`platforms/codex/plugin` 移出工作樹；`sync-codex-plugin-skills.sh` 改為 release 步驟，
產 payload → 發布到 C1a 選定的目標；marketplace 指向之。
**Gate 重接（明列，R1-F3）**：
- 退役：pre-commit 的 payload `--check`（工作樹無 payload → drift 概念隨鏡像一併消失，
  生成是 release 時從源碼確定性產出，不存在「開發期 payload 髒」的窗口）。
- 移駐 release 流程：`codex-plugin-package.test.sh`（對生成物跑）＋
  **post-publish smoke**：從發布 ref 真機安裝＋跑一次 `/dev-flow` 觸發探針。
驗收：repo 行數 -≈39k；上述兩個 release gate 綠；`preflight-release.sh` 含生成＋smoke 步驟；
CLAUDE.md/AGENTS.md 的 payload 相關描述同步更新。

### C2. hook multiplexer
既有 BACKLOG 條目（per-event multiplexer），納入本 plan 排程，不重複描述。

## 3. 明確不做

- 不刪任何 skill 目錄／slash 入口（憲法級約束＋避免 MAJOR）。
- 不砍任何 quality gate（每個 gate 都有屍體背書；砍 gate 永遠是最後的事）。
- 不動 tree engine 等 pioneer 層功能（低頻但有主人）。

## 4. 北極星量測（隨 preflight 印一行，不擋）

量測（R1-F6 修正：去巢狀遺漏、去 symlink 重複計）：
```bash
prose=$(find skills references -name '*.md' -type f | sort -u | xargs cat | wc -l)
engine=$(find src -name '*.js' -type f | sort -u | xargs cat | wc -l)
```
`preflight-release.sh` 印出兩值＋與上一 release 的差。**軟硬門檻**（R1-F6：無門檻＝theater）：
prose 較上一版 **+5% 以上 → preflight 輸出 WARNING 並要求 CHANGELOG 寫一行 justification**
（不阻斷 merge，但缺 justification 時 `check-optin-changelog.js` 式的 release gate 擋）。
先跑一次抓 baseline 再啟用門檻。

## 5. 審查紀錄（R1 — MiniMax-M3，2026-07-04）

| # | 嚴重度 | 裁決 | 收編位置 |
|---|---|---|---|
| F1 觸發時可見性≠文字 diff | 🔴 | ✅ 採（驗收改行為探針；薄殼保留語意摘要） | B1 |
| F2 升級判定驗收只 grep | 🔴 | ⚙️ 部分採（行為探針＋不動判定段）；「抽成 engine 判定」現階段 REFUTED（重判斷輕機械），記為北極星候選 | B2 |
| F3 Spike 未驗先寫進驗收＋gate 重接未拆 | 🔴 | ✅ 採（拆 C1a/C1b、gate 退役/移駐明列、post-publish smoke）；「開發期 payload 髒窗口」子點 REFUTED —— 鏡像移除後工作樹無 payload 可髒 | C1 |
| F4 指標檔路徑深度／兩處真相 | 🟠 | ✅ 採其替代案（生成副本＋byte-parity gate） | B3 |
| F5 frontmatter 未知欄跨平台未驗 | 🟠 | ✅ 採（兩步走） | B4 |
| F6 量測漏巢狀＋無門檻＝theater | 🟠 | ✅ 採（find -type f 去重＋軟硬門檻 +5% justification） | §4 |
