# Knowledge Base

> autopilot 自家 knowledge — 經驗性知識庫，記錄 plugin 開發 / dogfood / coexistence 實戰學習。Bootstrap 自 2026-05-14 D-1/D-2 dogfood 之後。

## 最近學習 (Recent)

<!-- 新條目加在這裡，保持最多 10 條 -->

| 日期 | 類別 | 簡述 | 文件 |
|------|------|------|------|
| 2026-07-24 | arch | Merge 完成後 cleanup 是 terminal invariant：驗證 worktree inactive/clean 與 branch containment，移除 worktree，再用 preserve-first reaper 或 `git branch -d`，最後重新列舉確認零殘留 | [git-ref-lifecycle-races.md](git-ref-lifecycle-races.md) |
| 2026-07-16 | debug | Silent-retry 假死（CLI×z.ai 確定性 529）— 分層診斷四步 + logging proxy 定位；readiness 探針要同傳輸同 payload | [debug-patterns.md](debug-patterns.md) |
| 2026-07-16 | debug | Git worktree 共享 .git/config — worker 裸 git config 寫穿主 clone 身分（Test Bot 事故）；teardown identity 校驗防線 BACKLOG | [debug-patterns.md](debug-patterns.md) |
| 2026-07-16 | arch | Git ref lifecycle races — enumeration status / stable snapshots / verified ack publication / prepared ref restore / lifetime flock / probe-first review / SHA-256 disclosure | [git-ref-lifecycle-races.md](git-ref-lifecycle-races.md) |
| 2026-05-14 | arch | Claude Code plugin dogfood 5 lessons — catalog snapshot vs disk drift / cross-cwd hook state merge / chain prose 同檔自相矛盾 / multi-round review progressive uncovery / dogfood observe-vs-invoke trade-off | ⚠️ `claude-code-plugin-dogfood-lessons.md` 遺失（從未 commit 進本 repo；鏡像 repo 不在此機。2026-07-16 doc-sync 發現。若他機還有請補回並 commit） |

## 知識分類

| 文件 | 內容 |
|------|------|
| [git-ref-lifecycle-races.md](git-ref-lifecycle-races.md) | Git refs / dispatch branch lifecycle 的 race-safe enumeration、ack publication、prepared restore、worktree lifetime lock 與 reviewer probe patterns |
| [debug-patterns.md](debug-patterns.md) | 診斷技巧與假死 pattern：529 silent-retry 分層診斷、worktree config 寫穿身分污染 |
| ⚠️ `claude-code-plugin-dogfood-lessons.md`（遺失，見上） | Claude Code plugin/hook 開發 5 大 pattern（catalog drift / cross-cwd state / prose fragility / review loop / dogfood trade-off）|

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
