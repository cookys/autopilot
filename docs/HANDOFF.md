## 目標

**進行中**：L-size「statusline→hook live context feed」——dev-flow 已進入，L gates 過了，plan 尚未寫，L-2.5 plan hetero loop review 尚未跑。
這份 handoff 是 2026-09-05 第一段，由 `context-budget` T2 在 153k 觸發（1M session，15%，**誤響**——本身就是這個 plan 要修的病）。

## 現況

- **branch**: `develop`，與 `origin/develop` 同步在 `40fb1f68`；working tree 只有本檔；尚未開 feature 分支（admission READY 已拿，見下）。
- **version**: 2.36.0；本 plan 落地後是 PATCH（新 hook + 改 hook + codeforge 一刀），不是 MINOR。
- **dev-flow 狀態**：`.claude/session-start-sha` = `40fb1f68`；`mission-routing-admission.js --level l3` 回 `READY`（enforce、deliverable_count 1）；
  TaskCreate 已建 #1 L-1.5 audit、#2 L-1.6 skill routing、#3 L-2.5 plan hetero review、#4 L-5 finish-flow（全部 pending）。
- **IN-FLIGHT**：一個 Explore 子代理（sonnet）在背景抽 plan 所需脈絡，輸出落
  `/tmp/claude-1000/-home-cookys-projects-autopilot/93196c52-25cb-47ca-821c-cec391832eed/tasks/ac7459443dbf604dd.output`
  （scratchpad 會隨 session 消失；若已不在就重派，prompt 見「Explore brief」節）。
- **plan reviewer 席**（`resolve-review-loop.sh`，resolved_from=topology）：chair `gpt-5.6-sol/codex/max`、deep `MiniMax-M3/cc-shim/high`；三個 knob 全 `auto`。

## 本段查證到的事實（plan 的 §0 用）

1. **hook stdin 拿不到窗口**：官方 hooks 文件——無 model（只有 SessionStart 偶爾給）、無 context window、無 token 用量、`transcript_path` 只有主 session 一份。
   GitHub #34340（env var 提案）closed not planned；#41689（payload 加 context_window）closed 無回應。本機 transcript `message.model` = `claude-fable-5-1`，無 `[1m]`。
2. **statusline stdin 拿得到**：`context_window.context_window_size`（200000／1000000）、`used_percentage`、`total_input_tokens`、`current_usage`；
   `subagentStatusLine` 的 `tasks[].contextWindowSize` + `tasks[].tokenCount`（需 CC ≥ 2.1.205；本機 2.1.260）。statusline stdin 含 base hook fields（session_id）。
3. **codeforge 就是這台的 statusline**（`~/.claude/settings.json` → `codeforge statusline`）。`src/cli/statusline.rs:119–172` 已解析 `context_window_size`／`used_percentage` 畫 ctx bar，
   **只畫不存**；唯一落地是 `CODEFORGE_DEBUG` 才寫 `/tmp/codeforge-sl.json`（無 session_id，多 session 互蓋）；沒處理 `subagentStatusLine`。
4. **autopilot 現況**：`hooks/context-budget.js` 跳過 `agent_id`、用「觀察到 N ⇒ 窗口 > N」推斷（`KNOWN_WINDOWS [200k, 1M]`）、state 檔 `~/.autopilot/context-budget/<sid>.json` 每 tool call 寫 SSD；
   這條 session 的 state 曾長期 `observedMax: 0`（每 5 次 call 才 parse）。`orchestrator-edit-gate` 只管 Edit/Write 且要 l3–l6 marker；無任何 hook 看 WebFetch/WebSearch/Read/Grep；一般對話 session 無 gate。
5. **tmpfs**：aimax395 `/dev/shm`、`/run/user/1000` 是 tmpfs，`/tmp` 是 ext4（owner 有幾台把 /tmp 改回 SSD）；無 swap。

## 已決事項（不重議）

- live 檔走 RAM，**路徑要探測不假設**：候選 `$XDG_RUNTIME_DIR/autopilot/` → `/dev/shm/autopilot-<uid>/` → `/tmp`，逐一 `findmnt -T <dir> -o FSTYPE` 只收 `tmpfs|ramfs`；全不過才退 SSD 並警告一次；同目錄 rename 原子寫。測試要用假 `findmnt` 回 `ext4` 驗 fallback 真的走。
- `context-budget` 自己的計數檔也搬到同一 tmpfs 目錄（session 壽命內即可丟）。
- 改動分兩刀兩 repo：codeforge 先（寫 live 檔 + `subagentStatusLine` 入口），autopilot 後（hook 讀 live 檔，有就用真窗口，沒有才退推斷；子代理分支查 `tasks[]`，T2 對工頭可 deny）；autopilot 這邊先把 live 檔格式契約寫成 brief。
- 第三件：depth-0 read-burst gate（PreToolUse 對 WebFetch/WebSearch/Read/Grep 在無 `agent_id` 時累計，連續 N 次 warn「派 Explore／survey」，Fable 級升 block），default-on 不綁 marker；它需要 live 檔的 `model.id`。
- depth-0 不自己做調研（memory `depth0-delegates-research`）；派工 prompt 第一行必須 `Engine: sonnet`（`dispatch-model-guard` 會擋）。

## 下一步

1. 收 Explore 子代理輸出（或重派），寫 `docs/plans/2026-09-05-statusline-live-context-feed.md`（模板 `references/plan-template.md`，§2.5 Global Constraints 放 tmpfs 探測規則與 live 檔 schema）。
2. 完成 #1 L-1.5 audit（README scope）、#2 L-1.6（skill routing：autopilot hooks 區無 skill-routing.md 條目 → N/A；codeforge 是 Rust → `harness-verify-loop` 可考慮）。
3. #3 L-2.5：`autopilot:hetero-review` plan loop（scaffold rubric → manifest → `dispatch-plan-review.js` 20 min → dispositions → receipt exit 0）。
4. 之後 L-3 開 `feat/v2.36.1-statusline-live-context-feed`、project dir、INDEX。實作派工，depth-0 不自己寫。
5. 未動的舊 next（v2.36.0 handoff）：P5 fleet rollout 等 owner 在 cuda 授權；BACKLOG 14 筆；g1 finding `42864072`；ladder auto 未決。

## Explore brief（重派用）

第一行 `Engine: sonnet`。要八節：①兩份 context-budget 舊 plan 的定案與被否決項；②foreman-cost-discipline D1..Dn；③BACKLOG 相關 row 的 heading+trigger；
④context-budget.js/lib 的 exports、config keys、state 檔、session id 推導、agent_id 處理、test 名；⑤profiles/hook-classes.json 登記方式與 `hook_classes_sha256` 重釘；
⑥hooks 註冊處（event/matcher/default-on）；⑦codeforge statusline.rs 的 StatusInput、read_status_input、bin 名、有無測試、有無 XDG_RUNTIME_DIR；⑧check-hook-inventory.js / check-claude-md-inventory.js 對新 hook/script 的要求。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain              # 只有 docs/HANDOFF.md
cat .claude/session-start-sha       # 40fb1f68…
node scripts/mission-routing-admission.js --repo-root "$PWD" --level l3 | head -c 80   # READY
bash scripts/resolve-review-loop.sh --field plan_reviewer_engine   # gpt-5.6-sol
findmnt -T /run/user/1000 -o FSTYPE  # tmpfs
```

## Read-order

1. 本檔「本段查證到的事實」與「已決事項」。
2. memory `depth0-delegates-research`、`live-state-goes-tmpfs`、`foreman-guard-default-on`。
3. `hooks/context-budget-lib.js` 頭 60 行（窗口推斷的自述）。
4. `skills/hetero-review/SKILL.md` Plan Loop Protocol。

## 陷阱

- zsh Bash 工具：`=====` 開頭的 echo 會被展開失敗、`--include=*.rs` glob 爆；要 bash 語意就 `bash -c`。
- `context-budget` T2 在 1M session 153k 會誤響一次（本段親歷）；handoff 寫完由 owner 決定是否 /clear，不必自動 clear。
- 派工 prompt 第一行沒 `Engine: <model>` 會被 `dispatch-model-guard` 擋。
- `sqlite3` 這台沒裝。

## 上一段（2026-09-04，已出貨）

v2.36.0 dev-flow hetero loops as default（merge `f756fcf5`）；之後兩個 docs commit（evidence-discipline §22–25、handoff）。
