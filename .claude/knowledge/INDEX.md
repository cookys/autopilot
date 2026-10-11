# Knowledge Base

> autopilot 自家 knowledge — 經驗性知識庫，記錄 plugin 開發 / dogfood / coexistence 實戰學習。Bootstrap 自 2026-05-14 D-1/D-2 dogfood 之後。

## 最近學習 (Recent)

<!-- 新條目加在這裡，保持最多 10 條 -->

| 日期 | 類別 | 簡述 | 文件 |
|------|------|------|------|
| 2026-10-11 | debug | Claude Code 自動更新會刪舊版本，測驗釘版只連結過去會壞；整個複製到 `~/.autopilot/claude-pin/<版本>/claude` | [debug-patterns.md](debug-patterns.md) |
| 2026-10-10 | debug | Codex bwrap workspace-write 沙盒在可寫根目錄（含 /tmp）留下空的 `.git` 等掛載點，讓 worktree 檢查誤判；`.git` 要含 HEAD 或 `gitdir:` 才算倉庫 | [debug-patterns.md](debug-patterns.md) |
| 2026-09-29 | debug | worktree 身分寫穿的第二條路徑：git 在 worktree 跑 hook 時會 export `GIT_DIR`，測試在暫存目錄 `git init`+裸 `git config` 會寫進主 clone 共用的 config（631 個 Test User commit），v2.36.103 在 run.sh/lib.sh unset 並加 drift guard | [debug-patterns.md](debug-patterns.md) |
| 2026-09-29 | debug | `resolve-dispatch-topology.js` 不帶旗標會寫 `~/.autopilot/topology.json`；唯讀用 `--json --out /dev/null`，比對用 `--check` | [debug-patterns.md](debug-patterns.md) |
| 2026-08-27 | arch | 訂閱不等於便宜:同一個 CLI、同一組登入,指向 first-party 模型走「大方的池」,指向第三方模型走「按 API 價計費的池」,差一個數量級;`auto` 沒有獨立額度(是母池的子項),`-fast` 是進出各 2 倍、只買延遲不省錢;CLI 查不到用量,只有互動模式的 slash command 有 | [vendor-quota-shapes.md](vendor-quota-shapes.md) |
| 2026-08-25 | arch | 驗證一份「描述環境」的文件要獨立重畫地圖再 diff,不是逐句查證——逐句查不出它少畫了一整條通道;三位審查者全過,且其中一人據以推理的前提本身就是漏掉的那條 | [architecture.md](architecture.md) |
| 2026-08-25 | arch | 讀斷言不等於測斷言:一席讀了「改鬆會變紅」的註解判 Verified Clean,另一席突變後發現全綠、真實語料 5→2;panel 合成必須 union-on-verified-critical,多數決會壓掉盲點catch | [architecture.md](architecture.md) |
| 2026-10-02 | debug | bwrap 不能巢狀（apparmor_restrict_unprivileged_userns=1），suite 隔離改用拋棄式快照 | [debug-patterns.md](debug-patterns.md) |
| 2026-10-03 | debug | agy 1.2.15：agent 名稱不進 log（用 agent=true 判）、agents 目錄被遷成絕對 symlink、會自動更新 | [debug-patterns.md](debug-patterns.md) |
| 2026-10-03 | debug | setsid(1) 解不開啟動時被忽略的 SIGINT；背景啟動的 runner 會吞 INT | [debug-patterns.md](debug-patterns.md) |

## 知識分類

| 文件 | 內容 |
|------|------|
| [architecture.md](architecture.md) | Review repair authority、peer/Heto 分界與 fallback panel 資格 |
| [git-ref-lifecycle-races.md](git-ref-lifecycle-races.md) | Git refs / dispatch branch lifecycle 的 race-safe enumeration、ack publication、prepared restore、worktree lifetime lock 與 reviewer probe patterns |
| [debug-patterns.md](debug-patterns.md) | 診斷技巧與假死 pattern：CLI option 相容性、529 silent-retry 分層診斷、worktree config 寫穿身分污染 |
| ⚠️ `claude-code-plugin-dogfood-lessons.md`（**遺失**：2026-05-14 寫成並登錄，但從未 commit 進本 repo；2026-07-16 doc-sync 發現時鏡像 repo 不在此機。若他機還有請補回並 commit。這是 `references/knowledge-routing.md` §4「不 commit 就等於沒寫」的前例） | Claude Code plugin/hook 開發 5 大 pattern（catalog drift / cross-cwd state / prose fragility / review loop / dogfood trade-off）|

## 跨 repo mirror

本檔案同時 mirror 在 `cookys/TWGameProject` 之 `server/.claude/knowledge/claude-code-plugin-dogfood-lessons.md`（commit `00a04c6e7`）。同一作者跨 repo 工作，知識存兩處方便 grep。**更新時兩邊同步**，避免漂移：

```bash
# 從 TWGameProject 同步過來
cp ~/projects/TWGameProject/server/.claude/knowledge/claude-code-plugin-dogfood-lessons.md \
   ~/projects/autopilot/.claude/knowledge/

# 反向同步
cp ~/projects/autopilot/.claude/knowledge/claude-code-plugin-dogfood-lessons.md \
   ~/projects/TWGameProject/server/.claude/knowledge/
```

若日後有第二個 repo 也要加入 mirror，考慮升級到 single-source（autopilot 為主）+ 其他 repo 透過 git submodule 或 symlink 引用。

## 使用指南

### 讀取時機
- 開始 plugin/hook 開發前瀏覽
- 遇到 dogfood / routing / chain delegation 問題時查閱

### 更新時機
使用 `autopilot:learn` skill 記錄新知識。注意 cross-repo mirror 規則。

### `last-verified` 慣例
每個 knowledge 檔案第一行用 HTML comment 標記最後驗證日期：
```
<!-- last-verified: YYYY-MM-DD -->
```
- 新增/修改 entry 時，更新該檔案的 `last-verified` 日期
- 超過 30 天未驗證的檔案，session 開始時應優先瀏覽確認是否過期
