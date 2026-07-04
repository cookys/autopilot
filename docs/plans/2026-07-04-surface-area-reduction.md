# Plan — 表面積精煉（surface-area reduction）

> Status: R0 — Fable 5 起草（Cookys 口頭核可方向），交 codex 線實作。
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
四個 skill 目錄與 slash 命令**原樣保留**；四個 SKILL.md（31/42/104/55 行）瘦成
≤15 行薄殼（frontmatter 觸發語照舊＋一行「語意見 `ceo-agent/references/level-front-door.md` §LN」）。
身體裡目前超出 front-door 的內容（l5 的 roster/immutable-base 段、l6 的 per-unit pipeline）
**上移進 front-door 對應章節**，不是刪除。
驗收：四個 `/lN` 觸發行為 diff＝零（description 不變）；`validate.sh` 綠；
`grep -c` front-door 含上移內容；SKILL.md 四檔合計 ≤60 行。

### B2. think-tank-dialectic 薄殼化
同 B1 模式：`/think-tank-dialectic` 入口與 description 保留；350 行身體遷成
`think-tank/references/dialectic-mode.md`（think-tank 的升級模式 —— 升級規則本來就在
think-tank SKILL.md 裡）；原 SKILL.md 瘦成薄殼。dialectic 自己的 6 個 references 隨遷。
驗收：兩個入口觸發不變；升級路徑（think-tank LOW consensus → dialectic）文字仍互相引用成立。

### B3. `model-routing.md` 去重（5 份 → 1 canonical）
`references/model-routing.md` 為 canonical；`skills/{dev-flow,survey,think-tank,quality-pipeline}/references/model-routing.md`
四份副本改為薄指標檔（或 symlink —— 注意 codex payload 的 rsync `-L` 會解 symlink，
薄指標檔更穩）。驗收：內容單一來源；四個 skill 內引用路徑仍解析；
`check-canonical-invariants.sh` 綠。

### B4. Tier 標記（分層不分家）
`docs/skills.md` 重排為三層：核心（dev-flow、quality-pipeline、learn、next、finish-flow、debug）
／委派（ceo-agent＋lN 家族）／pioneer（其餘）。僅文件排版＋各 SKILL.md frontmatter 加
`tier:` 欄（無行為影響）。呼應教材角色卡的使用者端分層。

## 2. C 組 — 一個 sprint（結構性）

### C1. codex 鏡像改「發版時生成」（-37k 行，最大單筆）
`platforms/codex/plugin` 從 git 工作樹移除；`sync-codex-plugin-skills.sh` 改為
release 步驟：產 payload → push 到 **orphan branch `codex-payload`**（或 release artifact），
marketplace.json 指向該 branch。前置 Spike（依「不驗證不宣稱」規矩）：
codex marketplace 是否支援指定 branch/ref 安裝 —— 用真 codex CLI 驗，不查到就不動工。
連動退役：pre-commit/preflight 的 payload drift gate、`codex-plugin-package.test.sh`
改在 release 流程跑。驗收：repo 行數 -≈37k；codex 端真機安裝成功；
`preflight-release.sh` 含 payload 生成步驟。

### C2. hook multiplexer
既有 BACKLOG 條目（per-event multiplexer），納入本 plan 排程，不重複描述。

## 3. 明確不做

- 不刪任何 skill 目錄／slash 入口（憲法級約束＋避免 MAJOR）。
- 不砍任何 quality gate（每個 gate 都有屍體背書；砍 gate 永遠是最後的事）。
- 不動 tree engine 等 pioneer 層功能（低頻但有主人）。

## 4. 北極星量測（隨 preflight 印一行，不擋）

`preflight-release.sh` 加一行非阻斷輸出：
`prose=$(cat skills/*/SKILL.md skills/*/references/*.md references/*.md|wc -l) engine=$(find src -name '*.js'|xargs cat|wc -l)`
—— 每版看得見 prose↓ engine↑ 的趨勢即可，不設硬門檻。
