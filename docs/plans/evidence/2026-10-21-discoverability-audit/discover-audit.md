# 功能可發現性稽核：agent 該用、但入口找不到的功能

調查日期 2026-10-21，repo 在 develop，唯讀。

## 總結

共 **9 項**進清單。「完全找不到」7 項、「只有 hook 事後提醒」2 項。

最嚴重的是待決面板這一串，它直接造成「owner 看不到東西」：

1. **待決卡（open-decision.js open）**：`skills/**/SKILL.md`、`agents/*.md`、`AGENTS.md`、SessionStart 注入文字全部零命中。只有 Stop hook 在事後用 regex 補一句，而且那句話本身教得不完整（見項 3）。
2. **owner 在面板回答後沒人關卡**：面板會送出 `[待決回覆]` 開頭的 prompt，但全 repo 沒有任何 hook 或 skill 處理它，也沒人教 agent 去跑 `close --id`。卡片因此永遠留在面板上。
3. **owner-question-guard 的提示不夠用**：只寫 `node scripts/open-decision.js open ...`，沒有必填旗標，沒有 close，用相對路徑。
4. **SessionStart 注入只有 12 列 skill 對照表**：沒有一個字提到 mods、面板、`show` 工具。

其餘 5 項是影響較小的狀態寫入腳本（`pin-evidence-anchors.js`、`task-card.js`、`compaction-rehydrate.js`）、roundtable mod（owner 已知延後）、以及兩份沒人連到的 mod 契約文件。

另有查過、確認入口有教或不需 agent 配合的項目，列在最後一節，避免重查。

---

## 清單（依影響排序）

| # | 功能 | 類別 | 它做什麼（讀程式確認） | agent 何時該用 | 現況判定＋證據 | 建議放進哪個入口 | 不用會怎樣 |
|---|------|------|------------------------|----------------|----------------|------------------|------------|
| 1 | `scripts/open-decision.js open` | 腳本／mod 面板資料 | 往 `<git-common-dir>/autopilot/decisions/<scope>.json` 追加一張決策卡（question、background、options、recommendation、why、blocks、not-authorized）。live mod 的「待決」分頁與「現況」分頁的「要你處理」列讀這個檔。見 `scripts/open-decision.js:1-30` | 任何要等 owner 決定或回答的時刻：長跑 CEO／l3–l6 session 碰到 DOA 邊界、需要 owner 選項、要回報 owner 一個待辦。**包含不用 AskUserQuestion、改用文字問的情況** | **完全找不到**（SKILL／agents／AGENTS.md）；**只有 hook 事後提醒**（`hooks/owner-question-guard.js:112`，Stop 才觸發）。證據見 G1 | `skills/ceo-agent/SKILL.md` 第 34、88 列「escalate at DOA boundary」附近加一句機制；`skills/l3`~`l6` 的 front-door 同步指向；或在 SessionStart 注入（見項 4）。`ceo-agent` 的 escalate 現在沒有任何機制可循 | owner 看不到待決。CEO session 用文字轉述選項，一捲動就消失；面板「待決」分頁是空的。這正是觸發案例 |
| 2 | `scripts/open-decision.js close --id <id>`，加 `[待決回覆]` 回覆格式 | 腳本／mod 面板資料 | owner 在待決分頁選好選項按送出後，live mod 以 `$.prompt.submit` 送一則 prompt：第一行 `[待決回覆]`，之後每題一行 `<id>｜<題目前 30 字> → <答案>[｜補充：<備註>]`。見 `mods/live/model.ts:1565-1572`、`mods/live/register.ts:702-712`。卡片本身只能被 `close --id` 移除 | 收到 `[待決回覆]` 開頭的 prompt 時：把它當成 owner 的答覆照辦，並對每個 id 跑 `close --id`（idempotent） | **完全找不到**。證據見 G2：`待決回覆` 在 skills／agents／hooks／AGENTS.md 零命中（只出現在 `mods/live/model.ts` 與 `references/mods.md`）；`closeDecisionById` 只被 `hooks/ask-decision.js`（只關自己開的 AskUserQuestion 卡）和 `scripts/lib/qualification-confirm.js` 呼叫 | 同項 1：同一段教「開卡、收到 `[待決回覆]` 後關卡」。另可在 mod 送出的 prompt 本身加一行指示，或改成 hook 自動關（見機制類 M2） | 已答的卡永遠掛在面板上，owner 分不出哪些還沒處理；`age_s` 一直長、被標 stale。另外 `[待決回覆]` 不是 asUser 送出（`register.ts:702`），沒有指示的 agent 可能把它當成來源不明的文字 |
| 3 | owner-question-guard 的 block 訊息 | hook | Stop hook：最後一則 assistant 文字像在等 owner 回答、且沒有 `d-xxxxxxxx` 卡片編號，就 block 一次（`stop_hook_active` 時放行）。見 `hooks/owner-question-guard.js:100-117` | agent 被擋時需要知道怎麼補 | **只有 hook 事後提醒**，且訊息不完整：(a) 只寫 `open ...`，沒列必填的 `--question`、`--option` 至少兩個才算選項、`--recommendation`、`--why`、`--not-authorized`（`open-decision.js:21-24`）；(b) 用相對路徑 `scripts/open-decision.js`，在消費端專案的 cwd 不一定存在（**未實測**，dev-flow 的 `node scripts/stage-advance.js` 也是同一慣例，所以我不判定為 bug，只標未驗證）；(c) 沒提 close；(d) 只在回覆寫完之後才觸發，文字問題已經出現在對話裡 | 直接改 hook 的 reason 字串（機制類，不需 eval） | 被擋的 agent 靠猜 CLI 語法，可能開出沒有選項／沒有 why 的空卡；owner 看到的卡品質差 |
| 4 | SessionStart 注入文字 | hook（注入） | `src/hooks/handlers/session-start.js` 的 `BASE_AUTOPILOT_CONTEXT`：12 列 skill 觸發表加一句收尾。`hooks/session-start.js` 再附上 compaction recovery、handoff、設定檢查等 | 每個 session 開頭、clear、compact 後都會注入，是 agent 一定讀到的唯一常駐入口 | **完全找不到**：注入文字裡 mods、面板、待決、`show`、`open-decision` 全零命中（G4）。PostCompact 的 `state-checkpoint.js` 只注入 workflow 快照，也沒提 | 機制類：在 `BASE_AUTOPILOT_CONTEXT` 末尾加 2–3 行：要等 owner 回答先開卡、收到 `[待決回覆]` 要關卡、要給 owner 看檔案或 diff 用 `show` 工具 | 所有 session 起點都不知道 mod 存在；項 1、2 的修補若只靠 skill 文字，非 CEO 流程的 session 仍讀不到 |
| 5 | `scripts/pin-evidence-anchors.js apply`（`--exclude-ref`） | 腳本 | 把 receipt 引用但沒有任何 ref 指到的 commit 釘在 `refs/autopilot/evidence-anchors/<sha>`，避免刪分支後 `git gc` 回收，receipt 還在但證據 commit 消失。見 `scripts/pin-evidence-anchors.js:1-40` | 手動刪除 dispatch 分支或 worktree 之前（reap 腳本之外的路徑） | **完全找不到**（G5）：SKILL／agents／AGENTS／references 零命中；reap 腳本與 residue 腳本對 `evidence-anchors` 也零命中，所以 reap rail 不會自動呼叫。只有 `docs/scripts-inventory.md:46`（給人的索引）和 auto-memory | `skills/finish-flow/SKILL.md` 的 worktree／branch 清理步驟，或讓 reap 腳本自己呼叫（機制，見 M4） | 2026-08-06 已有四個 receipt 指向的 commit 實際被回收（腳本 header 自述）。靠 auto-memory 提醒的 agent 只在這台機器上有 |
| 6 | `scripts/task-card.js set\|show\|clear` | 腳本／session 狀態 | 把 session 的目標、成功條件、plan 路徑、review ledger 路徑、需求寫進 `~/.autopilot/task-card/<sid>.json`，讓 PreCompact 的 workflow 快照在 compaction／clear 後讀回。見 `scripts/task-card.js:1-18` | session 開頭定下目標後，以及目標改變時 | **完全找不到**，且已知：`docs/plans/2026-10-13-workflow-snapshot-at-compaction.md:92` 與 `docs/BACKLOG.md:1069` 明寫 P3「dev-flow 呼叫 task-card」延後、等 eval ON/OFF 證據；`docs/plans/evidence/2026-10-03-mods-visible-dispatch/u5-spike.md:84` 記錄 `~/.autopilot/task-card/` 在這台機器不存在，因為沒人呼叫 | `skills/dev-flow/SKILL.md` 進入 `intent` 節點處（已排在 BACKLOG P3） | 壓縮後快照裡沒有目標與成功條件，agent 靠摘要記憶續做，容易漂移 |
| 7 | `scripts/compaction-rehydrate.js`（`write\|rehydrate\|work-order\|heartbeat\|reconcile\|admit\|postcompact-adapter\|high-water\|adopt-orphan`） | 腳本 | managed campaign 在壓縮或 resume 之後做 Work Order 對帳與 continuation admission，fail-closed。見 `scripts/compaction-rehydrate.js:1-30`、`docs/scripts-inventory.md:89` | 壓縮或 resume 後的 managed campaign depth-0 | **完全找不到**（G7）：skills／agents／references／hooks 的 CLI 名稱零命中；背後函式在 `src/engine/continuation-admission`、`controller-execution`，我**沒有**追到有哪個引擎路徑自動呼叫它，所以不能斷定 agent 是否需要手動跑。**狀態：未確認**，要 owner 或熟悉 campaign 的人確認 | 若 agent 需要手動呼叫：`skills/ceo-agent/references/depth0-control-loop.md` 的 rehydrate 段（該檔已提 `build-rehydration-bundle.js`）；若引擎自動，則不用動 | 若屬於需手動呼叫：壓縮後的 depth-0 沒有對帳就續跑，可能重派已完成的 unit |
| 8 | roundtable mod：`/rt-room` 指令、`mods/roundtable` 面板、`scripts/roundtable-window.js`、`scripts/lib/room-log.js` | mod 工具（指令）／mod 面板資料／腳本 | 把圓桌討論的每句話追加到 `<rooms>/<room>/room.jsonl`（kind：say／relay／system），面板每秒重讀；Enter 呼叫 `roundtable-window.js send ROOM TEXT` 追加 owner 的話並 fleet 發給各席位。見 `mods/roundtable/register.ts:1-10,152`、`scripts/roundtable-window.js:1-20` | 擔任 moderator 的 agent：每輪對各席位 relay、追加 `relay`／`system` 列；流程見計畫 §8 | **完全找不到**（G8）：SKILL／agents／AGENTS／references／hooks 零命中，只有 `CLAUDE.md` 的腳本名單。**這是已知延後**：`docs/plans/2026-09-19-roundtable.md:3,15,106` 寫 Phase 3 skill 等 BL-0216，觸發條件是再手動辦三次圓桌或 owner 要求；`roundtable-window.js:8` 自述「No skills/roundtable/SKILL.md in this phase」 | 照原計畫：`skills/roundtable/SKILL.md` 與 `references/protocol.md`（Phase 3，需 eval） | 現在沒有 agent 知道有圓桌面板，moderator 只能手動照計畫文件做。屬刻意延後，列出是因為 owner 特別問 mod |
| 9 | 兩份 mod 契約文件沒接進任何 agent 入口：`references/mods.md`、`references/review-page.md` | 文件 | `mods.md` 說明 live mod 的資料來源與待決分頁的 `[待決回覆]` 流程；`review-page.md:112-114` 是 repo 裡唯一寫到「depth-0 在 DOA 問題上用 open-decision.js 加一筆」的文字 | 想知道面板資料怎麼供應的 agent | **完全找不到**入口連結（G9）：兩個檔名在 `skills/*/SKILL.md`、`skills/*/references/*.md`、`agents/`、`AGENTS.md` 零命中 | 不必單獨連結；項 1 的 skill 文字落地後，指向 `references/review-page.md` 的 decisions 段即可 | 唯一一句正確說法躲在沒人連到的 reference 裡，等於不存在 |

---

## 證據（grep 指令與結果）

全部在 `/home/cookys/projects/autopilot` 執行。

**G1 open-decision 在 agent 入口的出現位置**
```
grep -rnE "待決|open-decision|decisions pane|live pane|live mod|mods/" skills agents AGENTS.md references
```
結果：`skills/**` 與 `agents/**` 與 `AGENTS.md` 零命中（對 mods 相關詞）。命中只在 `references/mods.md`、`references/review-page.md:112,114`、`references/evidence-discipline.md:1294-1301`（後者講 ui-lint，與用法無關），以上不被任何 SKILL 連到（G9）。
```
git grep -n "open-decision" -- hooks scripts skills agents AGENTS.md references docs/scripts-inventory.md CLAUDE.md
```
非測試命中：`hooks/ask-decision.js`（AskUserQuestion 自動開卡）、`hooks/subagent-budget.js:360`（預算 deny 自動開卡）、`hooks/owner-question-guard.js:6,112`（Stop 事後 block）、`scripts/lib/qualification-confirm.js`、`references/review-page.md:112`、`docs/scripts-inventory.md:65`、`CLAUDE.md`（只有腳本名單）。
`ceo-agent` 的 escalate 文字：`skills/ceo-agent/SKILL.md:34`「Ask only when ... a decision crosses the resolved red-line/DOA boundary」和 `:88`「only escalate at DOA boundary」，兩處都沒說用什麼機制去問。`AskUserQuestion` 在 skill 中只出現於 distill／learn／research-to-ship／`level-front-door.md:51`，都是 hook 會自動開卡的那條路。

**G2 回覆格式與關卡**
```
git grep -n "待決回覆" -- . ':!*.test.*' ':!docs/plans' ':!CHANGELOG.md'
git grep -nE "closeDecision|closeDecisionById" -- 'hooks/*.js' 'scripts/*.js' 'src' ':!*.test.*'
```
第一條：只有 `mods/live/model.ts:1572`（定義 `DECIDE_REPLY_HEAD`）和 `references/mods.md:71`（及 evals 與 platforms 的鏡像副本）。第二條：只有 `hooks/ask-decision.js:97-98` 和 `scripts/lib/qualification-confirm.js:19,303`。也就是 `open-decision.js` 手開的卡，沒有任何自動關閉路徑。

**G3 guard 訊息**：`hooks/owner-question-guard.js:111-114`，內容已摘在表中。

**G4 SessionStart／PostCompact 注入**
`hooks/hooks.json` 的 SessionStart 有 `session-start.js`、`version-drift-check.js`、`runs-watch-autostart.js`、`residue-auto-reap.js`；UserPromptSubmit 只有 `advisory-relay.js`；PostCompact 是 `state-checkpoint.js`。讀 `src/hooks/handlers/session-start.js` 的 `BASE_AUTOPILOT_CONTEXT`：12 列 skill 表，無 mods、面板、show。`advisory-relay.js` 只轉送 cost／console／batch-format 三種提醒，而 mod 的 advisory 已改成只給 owner 的 toast（`mods/live/advisories.ts:1-8`）。

**G5**
```
git grep -n "pin-evidence-anchors" -- . ':!*.test.*' ':!docs/plans' ':!CHANGELOG.md' ':!evals'
git grep -n "evidence-anchors\|anchor" -- scripts/reap-dispatch-branches.sh scripts/reap-dispatch-worktrees.sh scripts/lib/worktree-reap.sh scripts/repo-residue-sweep.js hooks/residue-auto-reap*.js skills/finish-flow
```
第一條：`CLAUDE.md:27`、`docs/scripts-inventory.md:46`、歸檔專案文件、`platforms/codex` 鏡像。第二條：只有 `reap-dispatch-branches.sh` 內無關的 `anchorDirectory`（另一套 sentinel 機制），沒有呼叫 `pin-evidence-anchors`。

**G6**
```
git grep -n "task-card" -- . ':!*.test.*' ':!docs/plans/_archive' ':!CHANGELOG.md'
```
命中：`CLAUDE.md`、`docs/BACKLOG.md:1069-1076`、workflow-snapshot 計畫、`docs/scripts-inventory.md:55`、evals 的 pack 副本。`skills/`、`agents/`、`hooks/` 零命中。

**G7**
```
git grep -n "compaction-rehydrate" -- hooks src skills references ':!*.test.*'
```
零命中（只有 `scripts/compaction-rehydrate.js` 自己的 usage 與 `CLAUDE.md`、inventory、mission graph json）。

**G8**
```
git grep -n "rt-room\|roundtable" -- skills agents AGENTS.md references hooks/*.js ':!*.test.*'
```
零命中。

**G9**
```
for r in mods review-page; do git grep -l "$r.md" -- 'skills/*/SKILL.md' 'skills/*/references/*.md' agents AGENTS.md; done
```
兩個都零命中。

---

## 查過、判定「入口有教」或不需 agent 配合（不進清單）

| 項目 | 判定 | 依據 |
|------|------|------|
| `show` 工具／`/show` 指令（`mcp__autopilot__show`） | 入口有教 | 註冊時 `isDeferred: false`（`mods/viewer/register.ts:27`），description 寫明「Use it when the user asks to see, open or look at a file or a diff」（`mods/viewer/show.ts:19-22`）；本 repo 的 `CLAUDE.md` Don't 段也寫。skill 沒提，但工具 description 每個 session 都載入。次要缺口：消費端專案沒有那條 CLAUDE.md，只靠 description；建議在項 4 的注入加一行 |
| `session-mode.js`、`stage-advance.js`、`stage-graph.js` | 入口有教 | `skills/dev-flow/SKILL.md:41,110,113,126,229-370`、`skills/ceo-agent/SKILL.md:296,343,454`、`finish-flow/SKILL.md:31`、`quality-pipeline/SKILL.md:15` |
| `decision-ledger.js`、`probe-unknown.js` | 入口有教 | 各 3 個與 10 個 SKILL.md 命中 |
| `session-tasks.js`（band 任務列）、`awaiting-owner.js`（要你處理）、`advisory-relay` | 不需 agent 配合 | hook 自動寫；任務列靠 TaskCreate／TaskUpdate，`dev-flow`、`ceo-agent`、`finish-flow` 的 SKILL.md 都有提，且 `.claude/settings.json:3` 釘了 `CLAUDE_CODE_ENABLE_TODO_TOOLS` |
| `ask-decision.js`（AskUserQuestion 自動開卡／關卡） | 機制已涵蓋 | PreToolUse 自動開、PostToolUse 與 SessionEnd 自動關 |
| `record-integration.js`、`check-containment.js`、`check-inputs-landed.js`、`dispatch-tree.js`、`dispatch-status.js`、`wait-dispatch-results.js` | 入口有教 | 經 SKILL 連到的 reference：`skills/l5/references/hetero-impl-loop.md`、`references/hetero-dispatch.md`（由 `ceo-agent/references/level-front-door.md` 與 `depth0-control-loop.md` 連到） |
| `watch-foreman.js`、`agent-liveness-check.js`、`check-stall-fuse.js`、`build-rehydration-bundle.js`、`run-approval.js`、`cost-digest.js` | 入口有教 | `skills/ceo-agent/references/{level-front-door,depth0-control-loop}.md`、`skills/l5/references/hetero-impl-loop.md` |
| `dispatch-model-guard`、`subagent-budget`（Lane:／Engine:／Budget-Ack） | hook 訊息自帶做法 | deny 訊息列出合法重派方式（`hooks/dispatch-model-guard.js:210-216`、`hooks/subagent-budget.js:476-482`）；`Lane:`、`Engine:` 在 `skills/l3`~`l6` 有教 |
| `render-review-page.js`、`statusline-live-tee.js`、`toggle-payload-capture.js`、`write-task-status-input.js` | 不需 agent 配合 | watcher、review-server、引擎或人類設定時使用（`hooks/README.md:352-355`、`hooks/merge-task-status-lib.js`、`src/status/sources-manifest.js`） |

---

## 修補方式分類

本 repo 規定：改 skill 文字（指引）要先有 eval ON/OFF 證據；讓已說的事真的發生（機制）不需要。以下依此分。

### 機制類（不需 eval，可直接做）

- **M1 重寫 owner-question-guard 的 reason**（項 3）：列出必填旗標範例、`close` 用法、卡片編號寫進回覆。只改 hook 輸出，不改任何要求的清單。
- **M2 讓 `[待決回覆]` 關卡變機制**（項 2）：最乾淨的做法是別靠 agent。在已存在的 UserPromptSubmit host（`hooks/advisory-relay.js`）偵測 `[待決回覆]` 開頭，自己呼叫 `closeDecisionById`。注意 `mods/live` 的 sandbox 不能 require repo 的 lib（`references/mods.md:15`），所以處理器放在 hooks 側。退而求其次：在 `sendDecide` 送出的文字最後加一行指示，叫 agent 對每個 id 跑 `close --id`。
- **M3 擴充 SessionStart 的 `BASE_AUTOPILOT_CONTEXT`**（項 4）：加 2–3 行（待決卡、`[待決回覆]`、`show`）。這是注入文字，不是 skill；`src/hooks/handlers/session-start.js` 的現有測試要跟著調。
- **M4 讓 reap 腳本在刪分支前自動呼叫 `pin-evidence-anchors.js apply --exclude-ref`**（項 5）：把「已在做的刪除」變安全，不新增要求。
- `show` 的 tool description 已夠，不需動。

### 指引類（改 SKILL.md，需要先有 eval 證據）

- **S1** `skills/ceo-agent/SKILL.md` DOA 邊界段（第 34、88 列）加「開卡」機制句，並讓 `l3`~`l6` 指向它（項 1）。注意 `hooks/ask-decision.js` 檔頭已記錄「the skill-text version scored 0/10 ON and OFF」，也就是純 skill 文字版本曾實測無效，所以 S1 的優先順序應排在 M1、M2、M3 之後，且 eval 前不要預期它單獨有效。
- **S2** `skills/dev-flow/SKILL.md` 在 `intent` 節點呼叫 `task-card.js set`（項 6）。已在 BACKLOG 排為 P3，等 eval。
- **S3** `skills/roundtable/SKILL.md`（項 8）。已在 BL-0216，觸發條件未到。
- **S4** `skills/finish-flow/SKILL.md` 清理步驟加手動刪分支前先 pin（項 5）。若做 M4 就不需要這項。

### 需要 owner 或熟悉者確認
- 項 7（`compaction-rehydrate.js`）：我沒有追到引擎是否自動呼叫。確認前不要改任何文字。
- 項 3 的相對路徑問題：未實測。若消費端專案的 cwd 解不到 `scripts/open-decision.js`，M1 要改成用 `$CLAUDE_PLUGIN_ROOT` 的寫法；`skills/finish-flow/SKILL.md:80-95` 有一套解析 plugin root 的寫法可參考。
