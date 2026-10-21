# 可發現性盤點：hetero 組

## 白話總結
本組共 47 項（CLAUDE.md「Dispatch rails」38 項，其中 lib 21 支；加上 hetero-review-loop、dispatch-experience-critic、qc-panel、adjudicate-findings、check-phase-review-receipt、render-review-page、roundtable 三件〔window / room-log / mods/roundtable〕）。
A 自動 25／B 入口有教 18／C 0／D 4／E 0／F 0。再加 1 個「結構性」缺口（見主表 #0）：沒有任何一個入口把 consult／discuss／explore／plan-review／batch／foreman 放在同一張「何時選哪條」的表裡。
所有腳本都存在、無死碼。`skills/hetero-review` 與 `skills/agent-call` 點名的 7 支腳本全部存在（`ls` 驗證）；`hetero-review-loop.js` 的 collect/finalize/opt-out、`check-phase-review-receipt.js` 的 `--plan-artifact/--dispositions/--packets`、`resolve-review-loop.sh` 的 `plan_reviewer_engine`／`plan_deep_reviewer_*` 欄位都在程式裡對得上；agent-call 用的 `fleet peers`／`fleet send` 與 `fleet --help` 的 USAGE 一致。

最嚴重 3 項：
1. #0 沒有「rail 選擇表」：agent 要問模型意見、要模型讀 repo、要平行多單元、要背景工頭，得自己從七八個零散 reference 拼出來。
2. #1 `dispatch-explore.sh`：skills/ 與 agents/ 零命中，只存在 899 行的 `references/hetero-dispatch.md` 第 803 行起，且只在「codex plugin 不在時的退路」被提到。
3. #2 roundtable 全套（`/rt-room`、`roundtable-window.js`）：所有 agent 入口零命中，設計上「skill 等 BL-0216」，所以 agent 與 seat 端都不知道有這條路。

## 主表（C/D/F）

### #0 rail 選擇規則缺席（結構性，D）
- 它做什麼：N/A（是缺一張表）。現況：consult 只在 dev-flow／debug／think-tank 的 unknown ladder 與 `quality-pipeline` 表格被點名；discuss 只在 `think-tank/SKILL.md:115`；explore 見 #1；batch 只在 `ceo-agent/references/depth0-control-loop.md:527`；foreman 只在 `l5/references/hetero-impl-loop.md:290`；plan-review 在 `hetero-review/SKILL.md`、`research-to-ship`。`references/hetero-dispatch.md` 的「When to reach for it」（行 7）只講「為何用異質引擎」，不講「哪一條 rail」。
- agent 何時該用：任何要「問一句／讀 repo／審 plan／審 diff／寫碼／平行多單元／背景工頭」的當下，需要決定走哪支。
- 證據：`grep -rniE "which rail|rail (choice|selection)|choose (the|a) rail" skills references agents AGENTS.md` 只命中 `references/hetero-dispatch.md:788` 一行無關內容；`grep -n "dispatch-" AGENTS.md` 無任何 rail 名（只有 `resolve-dispatch.sh` 一句）；`src/hooks/handlers/session-start.js` 的 `BASE_AUTOPILOT_CONTEXT` 零 rail 名。
- 建議位置：`references/hetero-dispatch.md` 開頭加一張「意圖 → rail → 回傳是否為 verdict」的 8 列表（問意見→consult；多角色辯論→discuss；讀 repo 求答→explore；審 diff→review/hetero-review-loop；審 plan→plan-review；單單元寫碼→hetero；平行多單元→batch；非 Claude 工頭→foreman），並從 `skills/ceo-agent/SKILL.md`、`skills/dev-flow/SKILL.md`、`AGENTS.md` 各連一行過去。
- 不用會怎樣：agent 憑印象選 rail。已知會錯的情形：consult 走 `dispatch-review.sh` 會被 verdict 協議卡住（`references/consult-discuss-seats.md:12`）；該用 explore 的場合退回把整份 diff 當文字塞進 review rail，浪費 context。

### #1 `scripts/dispatch-explore.sh`（D）
- 做什麼：讓 codex／agy 異質引擎「直接讀真實 repo」並回答（能力探索、廣域 context 審查），事後用 `git status --porcelain` 前後比對，改了檔回 `explored_dirty` exit 4（`references/hetero-dispatch.md:803-825`）。
- 何時該用：想要另一個家族「讀 repo 後」給有依據的答案，而不是只看你貼的文字。
- 證據：`grep -rn "dispatch-explore" skills agents AGENTS.md src/hooks` → 零命中；`references/` 內僅 `hetero-dispatch.md`（803 起的專節與 799 行 codex plugin 退路）與 `acceptance-patterns.md:61`（測試教訓，不是用法）。呼叫端只有 repo 內自己的 lib 註解（`scripts/dispatch-explore.sh:185` 自身）。`hetero-dispatch.md` 本身是被 `l5/l6 SKILL.md` 為了「Context-window gate」而連到，讀者不會因此翻到第 803 行。
- 建議位置：#0 的選擇表；`skills/survey/SKILL.md`（survey 要「讀 repo 找事實」時的選項）；`skills/debug/SKILL.md` U1 之前的說明。
- 不用會怎樣：功能等於不存在；需要 repo-grounded 第二意見時只能走較慢的 author rail 或不走異質。

### #2 roundtable：`scripts/roundtable-window.js`、`scripts/lib/room-log.js`、`mods/roundtable`（`/rt-room`）（D，已知且刻意）
- 做什麼：一個房間 log（`room.jsonl`）；視窗 A 在 tmux 內 `open/tail/input/send` 並 fleet-send 給各 seat，視窗 B（mod，`/rt-room`）唯讀顯示（`scripts/roundtable-window.js:1-40`、`mods/roundtable/register.ts:152`）。
- 何時該用：owner 要多台機器的 agent 在同一房間討論，owner 在旁插話。
- 證據：`grep -rniE "roundtable|rt-room" skills agents AGENTS.md references src/hooks` → 零命中；`roundtable-window.js:9` 自述「No skills/roundtable/SKILL.md in this phase」；`docs/plans/2026-09-19-roundtable.md:3` 寫「skill still waits on BL-0216」（BL-0216 在 `docs/BACKLOG.md:686`）。只有 `docs/scripts-inventory.md:264-265`（給人看，不算入口）有一行。`room-log.js` 的唯一呼叫端是 `roundtable-window.js:16`，本身不需要入口。
- 建議位置：BL-0216 的 `skills/roundtable/SKILL.md`；在那之前最少在 `skills/think-tank/SKILL.md` 一行「多機房間討論見 roundtable（暫無 skill）」避免 owner 以為沒做。`/rt-room` 是 mod 指令，owner 輸入 `/` 才看得到，對 agent 不可見。
- 不用會怎樣：seat 端收到 fleet 訊息不知道自己在房間裡、該怎麼回；owner 做完的功能沒人能被指到。

### #3 `scripts/dispatch-tree.js`（D，低）
- 做什麼：唯讀合併「子代理樹＋rail 樹」成一棵以 session 為根的樹，連不上的分支標 `untracked`（檔頭 `scripts/dispatch-tree.js:1-25`）。
- 何時該用：depth-0 想看「這個 session 到底派了什麼、哪些沒追蹤到」，補 `dispatch-status.js` 看不到的層。
- 證據：`grep -rn "dispatch-tree" skills agents AGENTS.md src/hooks mods` 零命中；入口層只有 `references/hetero-dispatch.md:589` 的一行用法註解。腳本間的 `dispatch-tree 3b` 字樣是設計代號，不是呼叫（`repo-identity.sh:119` 等註解）。`mods/live` 也沒呼叫它（`grep -rn dispatch-tree mods` 零命中），註解稱是 live pane 的 identity hand-off step 1，尚未接上。
- 建議位置：#0 選擇表的「觀測」列，與 `dispatch-status.js` 並列。
- 不用會怎樣：漏掉未追蹤的巢狀派工，只能憑 ledger 手對。

## 弱 B 備註（不進主表，但值得順手補）
- `dispatch-status.js`、`wait-dispatch-results.js`：只在 `ceo-agent/references/level-front-door.md:283`、`l5/references/hetero-impl-loop.md`、`hetero-dispatch.md:852` 出現；`AGENTS.md:83-90` 的 Dispatch／foreman 條款講到「用 dispatcher 自己的 status 查詢」「別 bare nohup」但不點名這兩支，非 Claude agent 讀 AGENTS.md 找不到名字。`hooks/depth0-delegate-gate.js:51` 只在被擋時提到 wait-dispatch-results（屬 C 型提醒）。建議 `AGENTS.md` 該段補一行具名。
- `dispatch-foreman.sh`：`hetero-dispatch.md:854` 自述「Not wired into /l5 yet」，入口只在 l5 的 clone-per-unit 配方（`hetero-impl-loop.md:290`）。若不打算接，沒問題；打算讓 agent 選就要進 #0 表。
- `references/review-page.md` 沒被任何 skill／agent 入口連到（`grep -rn "review-page.md" skills agents AGENTS.md references` 零命中）；但 render-review-page.js 由 `src/status/runs-watch.js:458` 自動呼叫，agent 不需主動用，歸 A。

## 附錄（A/B/E）

### Dispatch rails 頂層
- dispatch-hetero.sh：B `skills/l6/SKILL.md:53`、`skills/l5/references/hetero-impl-loop.md`、`skills/hetero-review/SKILL.md`（Code Loop 步驟 4）
- dispatch-review.sh：B `skills/l6/SKILL.md:36`、`skills/engine-onboarding/SKILL.md`、`ceo-agent/references/depth0-control-loop.md`
- dispatch-author.sh：B `skills/l6/SKILL.md:35-38`、`skills/ceo-agent/SKILL.md:189`
- dispatch-author-kimi.js：A 由 `scripts/dispatch-author.sh` 呼叫（grep 命中）
- dispatch-consult.sh：B `skills/debug/SKILL.md:37`、`skills/dev-flow/SKILL.md:239,266`、`skills/quality-pipeline/SKILL.md:60`、`skills/hetero-review/SKILL.md`（Not for 指向）
- dispatch-discuss.js：B `skills/think-tank/SKILL.md:115-118`
- dispatch-batch.sh：B `ceo-agent/references/depth0-control-loop.md:527-547`、`level-front-door.md:407`
- dispatch-foreman.sh：B（弱）`skills/l5/references/hetero-impl-loop.md:290`
- dispatch-anthropic-review.js：A 由 `dispatch-author.sh`、`dispatch-review.sh` 呼叫
- dispatch-local-openai.js：B `skills/engine-onboarding/SKILL.md`、`references/local-model-team-recipe.md`
- dispatch-plan-review.js：B `skills/hetero-review/SKILL.md:40`、`skills/research-to-ship/SKILL.md:61,69,117`
- dispatch-contract.js：B `skills/l6/SKILL.md`、`depth0-control-loop.md`
- dispatch-status.js：B（弱）`level-front-door.md:283,298`
- check-context-window.js：A 由 `scripts/lib/context-window.sh`、`resolve-review-loop.sh`、`src/engine/campaign-intake.js` 呼叫；B `skills/l5/SKILL.md:39`、`l6/SKILL.md:97`
- wait-dispatch-results.js：B（弱）`l5/references/hetero-impl-loop.md`、`hetero-dispatch.md:852`

### Dispatch rails lib（內部，A，被 rail 腳本 source／require）
- context-window.sh：被 dispatch-hetero／author／review 呼叫
- dispatch-author-codex-transport.sh：`dispatch-author.sh`
- dispatch-detach.sh：`dispatch-foreman／author／review.sh`
- cleanroom-launch.sh：`dispatch-review.sh`、`src/engine/campaign-intake.js`；`references/blind-dispatch.md` 亦提
- main-checkout-boundary.sh：`dispatch-hetero.sh`、`dispatch-foreman.sh`
- output-quiescence.sh：`dispatch-author.sh`、`dispatch-review.sh`
- pi-rpc-run.js：`dispatch-hetero.sh`
- grok-effort.sh：`dispatch-hetero／author／review.sh`
- cursor-model.sh、agy-model-alias.sh、agy-argv-ceiling.sh：同上三支 rail
- plan-review-findings.js／plan-review-normalize.js／plan-review-timeout.js／plan-review-context.js／plan-review-panel.js：`scripts/dispatch-plan-review.js:57-68` require
- worker-containment.sh：`dispatch-hetero.sh`、`dispatch-foreman.sh`
- review-fanout.js：`src/runners/review.js`
- repo-identity.sh：`dispatch-hetero／explore／foreman／author.sh`
- dispatch-branch-ledger.sh：`dispatch-hetero／foreman.sh`、`repo-residue-sweep.js`
- gitconfig-containment.sh：`dispatch-hetero／author.sh`

### 其他指名項
- hetero-review-loop.js：B `skills/hetero-review/SKILL.md:44-60`、`references/code-loop.md`、`dev-flow/references/hetero-loops.md`
- dispatch-experience-critic.sh：B `ceo-agent/references/depth0-control-loop.md:500-515`（§9 post-merge）
- qc-panel.js：B `skills/quality-pipeline/SKILL.md:57,65-69`
- adjudicate-findings.js：B `skills/quality-pipeline/SKILL.md:41,147-149`
- check-phase-review-receipt.js：B `skills/hetero-review/SKILL.md`（Plan Loop 步驟 5、Code Loop 步驟 5）、`skills/dev-flow/SKILL.md`
- render-review-page.js：A `src/status/runs-watch.js:458,490,502`、`src/status/compare-input.js:29`
- room-log.js：A（callee）`scripts/roundtable-window.js:16`，其入口缺口併入 #2
- skills/hetero-review：腳本引用 `plan-rubric-scaffold.js`、`resolve-review-loop.sh`、`dispatch-consult.sh`、`dispatch-hetero.sh` 等 7 支全存在（`bash` 迴圈 `[ -e ]` 驗證）
- skills/agent-call：只用 `fleet peers`／`fleet send`，`fleet --help` 的 USAGE 兩者皆有；MCP 工具 `directory/send/reply/state` 與 fleet MCP 說明一致
