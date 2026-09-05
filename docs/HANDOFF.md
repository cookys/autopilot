## 目標

無進行中工作。這份 handoff 是 2026-09-05 第二次收尾快照：**v2.36.2 已 merge 到 develop（`6712ba67`），尚未 push**。
（取代前一版 handoff。）

## 現況

- **autopilot**: `develop` = `00986d3c`（merge `6712ba67` + maintenance 表 hash 戳記），比 `origin/develop`（`9b6596fd`）多 4 個 commit，**未 push**（owner 沒說要推）；working tree 乾淨；fix 分支已刪。
- **version**: 2.36.2（30 skills，29 hooks：16 default-on／13 opt-in）。
- **v2.36.2 內容**：live 窗口 `> 0` 才算訊號（context-budget／foreman-guard）；depth0-delegate-gate 計數上鎖；foreman-guard 0/≥2 列診斷每 agent 每種文字一次；
  `dispatch-model-guard` 漏 `model:` 預設 **deny**（不再跳 dialog；`on_missing_model: deny|ask|allow`）；四項測試強度；context-budget state 新增 `lastLive {at, ageMs, present, used}`。
- **suite**: 316/321 綠。既有紅：contract-parity 8、consult-discuss-switch 3（develop 同樣紅）；probe-runner-coverage 只在 `--parallel` 下偶紅、序列跑兩棵樹都綠。
- **QC**: autopilot:reviewer@opus FIX-THEN-SHIP → MUST-FIX（codex template 鏡像）已同步、三條 🟡 已摺入；該 reviewer 停車 27 分鐘沒輸出，SendMessage 戳一下才回報。

## 已決事項(不重議)

- 漏 `model:` 的派工是 deny 不是 ask——這從來不是人的判斷，deny reason 帶糾正動作讓模型自己重派（owner 2026-09-05 dogfood 原話）。guarded engine 仍 ask。
- `withLock` 在 depth0-delegate-gate 刻意複製不 import（單點崩潰隔離，與 `executableText` 同理）。
- 前一版全部沿用（live 檔走 RAM、120 s freshness、depth-0 deny tier 不做…）。

## 下一步

1. owner 說推再推：`git push origin develop`（先 `git show origin/develop:.claude-plugin/plugin.json` 確認沒人搶 2.36.2）。
2. BACKLOG 新 row「context-budget falls back to inference after a long foreground tool call」：本 session 1M 窗口兩次無「(statusline)」的 T2（call 36 在 600 s suite 後、call 50 在 Agent spawn 後），下一次發生先讀 `$XDG_RUNTIME_DIR/autopilot/context-budget/<sid>.json` 的 `lastLive` 再動 freshness cap。
3. 其餘同前：tmpfs 擁有者檢查（多人主機前）、plan-loop disposition 形狀、P5 fleet rollout（cuda 授權）、`normalize_agy_alias`／stale topology cache／g1 `42864072`／ladder auto。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain && git log --oneline -3                 # 空；00986d3c 6712ba67 1821954a
git log --oneline origin/develop..develop | wc -l              # 4（未 push）
node -p "require('./.claude-plugin/plugin.json').version"      # 2.36.2
bash scripts/preflight-release.sh | tail -1                     # 8/8
bash scripts/sync-codex-plugin-skills.sh --check | tail -1      # in sync
node --test hooks/context-budget.test.js hooks/depth0-delegate-gate.test.js scripts/lib/live-state-dir.test.js  # 89 pass
```

## Read-order

1. CHANGELOG.md — v2.36.2 節。
2. docs/BACKLOG.md — `grep -n "^### " | tail -8`，新 row 兩筆（🔵 leftovers、live tick 餓死）。
3. hooks/README.md — dispatch-model-guard 列與 § Live context feed。

## 陷阱

- reviewer subagent 會停車：transcript mtime 不動 >10 分鐘就 SendMessage 要 verdict，不要乾等（本次 27 分鐘）。
- `hooks/tests/run.sh --parallel` 會讓 probe-runner-coverage 偶紅；判紅先在乾淨 develop worktree 序列重跑同一檔。
- suite log 裡有測試自己印的 `exit=1`／`ALL PASS` 字樣，Monitor 只認 `════════ Summary ════════`。
- Bash 工具跑 >120 s 的前景指令後，context-budget 可能走推斷路徑假響 T2（見 BACKLOG row）。
