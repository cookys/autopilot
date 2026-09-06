## 目標

接續 **l4 host provider-readiness bootstrap**（L 級，v2.36.8）：D1（P1–P4）已在分支 `feat/v2.36.8-l4-host-bootstrap` 實作並 commit（`d0b95eff`），四套 suite 綠、RED 對照記在 ledger；**pre-merge review（autopilot:reviewer, opus）派出中**。另有 owner 追加的 Fix：`fix/dispatch-model-guard-remind`（worktree `../autopilot-guard-fix`，2 commits）等 v2.36.8 合併後接著出 v2.36.9。
（取代前一版 handoff。）

## 現況

- **autopilot**：`develop` = `origin/develop` = `c7cc64aa`（docs-only 六筆已推）。分支 `feat/v2.36.8-l4-host-bootstrap` 一筆 `d0b95eff`（29 files, +883/−145），working tree 乾淨；version 已 bump 2.36.8（mirror 同步）。
- **D1 內容**：`provider-bootstrap.js` `LEVEL_ROSTER_PROFILE`（l4 VA/QC optional；l5/l6 required）、`deriveStrictL5InvocationPolicy(resolved, level)`、`projectRosterForLevel`（略過的選配席從 collector roster 投影掉，否則 WIZHALL 形狀 roster drift）、`roster_profile {level, omitted_seats}`；`bin/autopilot.js` l4|l5|l6 建 bootstrap、waiver 理由收窄；observation 收 `l4`／`waived`；intake 訊息文字。測試：cli 117／consumer 34／engine 486／observation 78 綠；RED 見 `docs/projects/2026-09-07-l4-host-bootstrap/ledger/p3-red-run.md`；P0 表 `ledger/p0-spike.md`。docs：front-door、portability、installation、BACKLOG 兩列刪、CHANGELOG v2.36.8、project README。
- **發現（已寫進 docs，不是偏差）**：managed engine 的 terminal-QC 閘（`prepare_implementation_loop`／`min_panel_size`）與 level 無關，`--campaign-contract` run 仍要完整 QC panel；「QC 選配」只是 bootstrap roster 規則。l4 子集 roster 一律記 `policy_override`（含 0 uncertified 的 `(none)` stderr 行，pre-existing 語意，KR3 byte-identical 優先）。
- **Fix 分支 `fix/dispatch-model-guard-remind`**（自 develop，worktree `../autopilot-guard-fix`）：`bbdb0b84` guard 預設 `mode: remind`（貴引擎 → deny 帶提醒，agent 自己決定：換便宜模型或首行 `Engine: <model> (intentional: <why>)` 靜默放行；`mode: ask`／`on_missing_model: ask` 仍可回對話框；guard test 76 綠）＋ `83de0a94` Codex adapter `lifecycle.md` SHADOW 條款改成鏡射 CC canon（cuda codex-astra 回報；package test 118 綠）。**未加 CHANGELOG／未 bump**——合併時補 v2.36.9。
- **cuda**：已回覆 codex-astra session（SHADOW = 該 repo `enforcement_mode: shadow`，合法路線 a 走非 managed、b owner 改 enforce）。WIZHALL P5 dogfood 等 v2.36.8 上 develop 後通知 instance `01M1RKK4DH2KQS014KJS8Z35DV`（先 `fleet peers` 確認）。

## 已決事項(不重議)

- 同前版：coverage advisory、不加 roster identity 硬閘、ADR-0001 同一條 live probe、`strict_level` 真實 level、v2.36.7 waiver 保留（bootstrap 認證 ⇒ 無 waived）、KR3 三條隔離負對照、PATCH v2.36.8、不動 D4 claim set。
- owner 2026-09-06：dispatch-model-guard 不得彈窗問使用者，提醒 agent 自己判斷 ⇒ `mode: remind` 為預設。
- 兩個 Fix 走 v2.36.9（guard 是 hook 行為＝PATCH；adapter 文字搭車）。

## 下一步

1. 收 reviewer 報告（agent 名稱在 TaskList；15 分鐘沒動就 SendMessage 催）；Major 以上修在同分支、重跑四套 suite；PASS 後 `TaskUpdate #4 completed`。
2. finish-flow L-5：`git checkout develop && git merge --no-ff feat/v2.36.8-l4-host-bootstrap`；`bash scripts/preflight-release.sh`（8/8）；INDEX 進行中列移到已完成、project README 標 done（或 archive）；**owner 說推才 push**。
3. v2.36.9：`git merge --no-ff fix/dispatch-model-guard-remind`，CHANGELOG 加 v2.36.9 節（guard remind＋adapter SHADOW），`node scripts/sync-version.js --version 2.36.9 --hook-count 29 --skill-count 30`，`bash scripts/sync-codex-plugin-skills.sh`，preflight，commit；`git worktree remove ../autopilot-guard-fix`。
4. push 後 fleet 通知 cuda WIZHALL 跑 P5（用 `fleet send --to cuda --instance <id>`；`fleet reply` 對 ephemeral 訊息會 403，改 `--repo`／`--instance`）。
5. 等待中：cuda QUIET-a claim（v2.36.6）、7840hs receipt 重跑（v2.36.3）。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git branch --show-current; git log --oneline -1                 # feat/v2.36.8-l4-host-bootstrap; d0b95eff
node -p "require('./.claude-plugin/plugin.json').version"       # 2.36.8
bash hooks/tests/provider-readiness-consumer.test.sh 2>&1 | tail -1   # PASS 34
git -C ../autopilot-guard-fix log --oneline -2                  # 83de0a94, bbdb0b84
bash hooks/tests/dispatch-model-guard.test.sh 2>&1 | tail -1     # (run in the worktree) PASS 76
```

## Read-order

1. CHANGELOG.md v2.36.8 節、`docs/projects/2026-09-07-l4-host-bootstrap/ledger/p0-spike.md`。
2. `git show d0b95eff -- src/readiness/provider-bootstrap.js bin/autopilot.js`。
3. `../autopilot-guard-fix/hooks/dispatch-model-guard.js` handleGuard。

## 陷阱

- Bash 工具 >120 s 後 context-budget 可能誤響 T2；這次 hook 說 192k/1M，實際照 statusline。
- reviewer 派工要 `model:`＋首行 `Engine:`；brief 禁跑 `hooks/tests/run.sh`。
- engine 測試注入 resolver 的 option 名是 `reviewLoopResolver`（`resolveReviewLoop` 會被忽略而走真 resolver）。
- observation wire 的 record key 是 canonical 排序（`status` 在 `unit` 前）。
- resolver 對 `- qc_panel:`（空值）會給名單預設值但 `qc_panel_seats:[]`／`complete:false`；刪掉 VA 要連 `verification_author_*` 欄位一起刪否則 resolver 報 inconsistent。
- `fleet reply <msg_id>` 對 instance-narrowed ephemeral 訊息回 403 not_a_recipient；用 `fleet send --to cuda --repo <repo>`。
