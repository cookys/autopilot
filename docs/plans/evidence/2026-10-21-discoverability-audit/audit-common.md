# 全面可發現性盤點：共用規則（每組相同）

你是唯讀調研員。repo：/home/cookys/projects/autopilot（develop）。不准改檔、commit、checkout，不准執行會呼叫模型、派工、寫 store 的指令（只讀程式、grep、跑 `--help` 前先看檔頭確認它不會直接動作）。回報用正體中文，程式碼、路徑、指令維持原文。

## 背景
owner 發現 autopilot 很多功能做好了，但其他 agent（Claude Code session、子代理、非 Claude agent）不知道它存在或何時該用。第一輪只查了 mods 與少數狀態腳本，結果在 `/tmp/claude-1000/-home-cookys-projects-autopilot/a00e4fc4-f640-486c-8dc6-743887676102/scratchpad/discover-audit.md`（可讀，已查過的項目不必重查，直接引用其判定；但它第 5 項 pin-evidence-anchors 判錯了：`scripts/repo-residue-sweep.js:911` 與 `scripts/reap-dispatch-branches.sh:1263` 都會呼叫）。這一輪要**逐項全面**。

## agent 入口的定義
`skills/*/SKILL.md`、SKILL.md 直接連結的 references 檔（含 `skills/*/references/*.md` 與被它們連到的 `references/*.md`，追一層連結即可）、`agents/*.md`、`AGENTS.md`、`CLAUDE.md`（注意：CLAUDE.md 只在本 repo 生效，消費端專案讀不到；只出現在 CLAUDE.md 的腳本名單不算「有教」）、hooks 注入的文字（SessionStart／UserPromptSubmit／PostCompact，`src/hooks/handlers/session-start.js` 的 `BASE_AUTOPILOT_CONTEXT` 等）、工具 description、`bin/autopilot.js` 的 usage（只有在某入口叫 agent 去看 usage 時才算）。`docs/scripts-inventory.md` 是給人看的索引，不算入口。

## 每一項的判定
先讀程式確認它實際做什麼，再歸到一類：
- `A 自動`：由 hook、引擎或另一支腳本自動呼叫，agent 不需主動用（附呼叫端 檔:行）。
- `B 入口有教`：入口裡有寫何時用、怎麼用（附 檔:行）。
- `C 只有事後提醒`：只有 hook 擋下或提醒時才講。
- `D 找不到`：agent 該主動用，但入口零命中（附 grep 指令與零命中結果）。
- `E 不需 agent`：CI／release 閘門、installer、測試工具、純人類操作、內部 lib。
- `F 死碼嫌疑`：沒有任何呼叫端、也沒有入口，看不出誰會用（附 grep 證據）。
只要 C、D、F 進主表，A、B、E 放附錄一行一項（名稱＋判定＋證據檔:行）。

## 輸出
寫到 `/tmp/claude-1000/-home-cookys-projects-autopilot/a00e4fc4-f640-486c-8dc6-743887676102/scratchpad/audit-<你的組名>.md`：
- 開頭白話總結：本組共幾項、A/B/C/D/E/F 各幾項、最嚴重的 3 項。
- 主表（C/D/F）：名稱／它做什麼／agent 何時該用／判定＋證據／建議放進哪個入口（具體 SKILL.md 或注入點）／不用會怎樣。依影響排序（owner 看不到東西、agent 會做錯、浪費成本在前）。
- 附錄（A/B/E）。
- 每一項都要有證據；零命中也要寫出 grep 指令。不准只看檔名推測。
最後給我的訊息：各類計數、主表前 5 項一行一句、檔案路徑。
