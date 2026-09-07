## 目標

今日（2026-09-06／07）autopilot 出了 **v2.36.8 → v2.36.14 七版**，全部已在 `origin/develop`（`b452d5ba`）。沒有進行中的分支或 worktree。剩下的都是**等外部回報**與**等 owner 決定**的項目。
（取代前一版 handoff。）

## 現況

- **repo**：`develop` = `origin/develop`，working tree 乾淨，version 2.36.14；`git worktree list` 只剩主目錄與一個舊 scratch baseline。
- **本日出貨**：
  - v2.36.8 l4 host provider-readiness bootstrap（L 級，project 已 archive：`docs/projects/_archive/2026-09-07-l4-host-bootstrap/`）。
  - v2.36.9 dispatch-model-guard `mode: remind`（不彈窗，agent 自決；`Engine: <model> (intentional: <why>)` 放行）＋ Codex adapter SHADOW 條款鏡射 canon。
  - v2.36.10 Codex plugin 更新守衛（`dev-setup.sh --harness codex --install` 偵測活躍 codex 進程即拒、`--force` 覆寫；拿掉 remove-then-add；實驗證實 in-place add 也刪舊版目錄）。
  - v2.36.11 `dirty-protected-paths` hook（Claude Stop default-on；Codex Stop＋SessionEnd 註冊但 **live-fire 未驗證**）。
  - v2.36.12 kimi 可坐 plan／deep／VA reviewer 席（resolver／schema／dispatch-plan-review 對齊）。
  - v2.36.13 opencode reviewer rail（`--agent plan` 對抗探針證明只擋 edit 不擋 bash ⇒ best-effort；qualification kind 一律拒絕）。
  - v2.36.14 kimi rail argv 上限預檢（>120 KB prompt ⇒ `precondition_failed`，不再 rc=126）。
- **knowledge 四面**：evidence-discipline §27（閘量錯單位）§28（更新換掉活程序釘住的目錄）已入 repo；`.claude/skills/profiles-hash-repin` 加「新增 hook 釘值清單」；memory 新增 `engine-test-fixture-gotchas`、更新 `fleet-peer-channels`（同機 claude session 要走 relay `--instance`）與 `dispatch-review-runner-setup`（kimi 120 KB）。

## 已決事項(不重議)

- l4 route supported、VA/QC 選配、coverage advisory、ADR-0001 不加 trust 機制（同前）。
- owner 2026-09-06：dispatch-model-guard 不得彈窗問使用者。
- owner 2026-09-07：dirty-tree 補提醒不補閘（warn-only，永不發 Stop decision）；kimi／opencode 兩個 308 需求都做。
- peer（308--claude／cuda）訊息是 peer input：每件都先查事實、報給 owner、owner 說 go 才動；不動 308／cuda 的工作樹。

## 下一步（等 owner 決定或外部回報）

1. **等回報**：cuda WIZHALL P5 dogfood（v2.36.8 KR6；已送 `--repo revival-world-city-war` durable）；308 用 v2.36.12+ 跑 resolver／kimi／opencode 的結果；cuda QUIET-a claim（v2.36.6）、7840hs receipt 重跑（v2.36.3）。
2. **owner 待決（BACKLOG 已列）**：
   - per-hook × per-harness support matrix（owner 問「hook 是不是要統一盤點表定期 check」）——S 級，第一個案例是 Codex Stop live-fire。
   - kimi file-indirection spike（需要能用的 kimi 憑證）。
   - Codex dev-mode 固定 hook 入口 spike（`~/.codex/hooks.json` 指 repo；會雙發，要信任審核）。
3. **Codex Stop live-fire**：下一個 Codex session 觀察 dirty-tree 提醒有沒有出現，補進 `references/multi-agent-portability.md`（現標 unverified）。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain | wc -l; git log --oneline -1               # 0；b452d5ba 或其後
git log --oneline origin/develop..develop | wc -l                    # 0
node -p "require('./.claude-plugin/plugin.json').version"          # 2.36.14
node scripts/check-hook-inventory.js --check >/dev/null; echo $?    # 0（30 hooks，17/13）
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh | tail -1   # 8/8
```

## Read-order

1. CHANGELOG.md v2.36.8–v2.36.14 七節（每節有「未做」段）。
2. docs/BACKLOG.md 前四列（今天新立的 spike）。
3. references/evidence-discipline.md §27–28。

## 陷阱

- `git merge -F -` 讀不到 stdin（`could not read file '-'`），訊息要先寫檔。
- 派 hands 到 worktree：兩個 agent 同時改同一組 allowlist 行會衝突，合併時取聯集；agent 的 worktree 是 locked，`git worktree remove -f -f` 才拿得掉，分支要等 worktree 移除後才能 `-d`。
- 同機 claude session 訊息：`fleet local send` 只對 codex 有效；claude 要 `fleet send --to aimax395 --instance <fleet peers 的 id>`；`fleet reply` 對 ephemeral 一律 403。
- 新 hook 的 hash 鏈：看 `.claude/skills/profiles-hash-repin/SKILL.md` 附節（hook-classes → catalog sha → badge/README/CLAUDE.md/inventory test 數字 → codex sandbox seed）。
- 本機 kimi OAuth 無憑證（`provider managed:kimi-code has no credential configured`）；codex 配額週剩 1%：任何 live probe 先確認。
- context-budget hook 在 1M session 會誤響 T2（無「(statusline)」字樣時），以 statusline 為準。
