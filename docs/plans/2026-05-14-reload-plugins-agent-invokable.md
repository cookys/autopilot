# `/reload-plugins` Agent-Invokable — Unblocking D-2-Style Dogfood Automation

**日期：** 2026-05-14
**狀態：** ✅ Option D shipped (commit `a80c19d`, develop) — short-term remediation in place; Option A (Claude Code core agent-invokable reload) tracked as long-term watch item.
**Size：** S–M (depends on chosen option, see §3) — Option D landed as S-size (~70 lines + hooks.json registration, 2-round review)
**Origin：** D-1 + D-2 dogfood verification on `develop@f5c1d0a`, loud finding #3 (`docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md` 之 D-2 §Reload behaviour)

---

## 1. 問題

`/reload-plugins` 是 Claude Code 的 **user-side slash command**，agent 無法在 session 內 fire。這在以下情境造成 bottleneck：

1. **D-2-style dogfood**：要驗證 `disabledSkills` 之類的 plugin config 變更，必須先 reload，但 agent 自己跑不了，必須要使用者手動干預。
2. **Plugin update mid-session**：使用者 `git pull` 把 plugin 推到新版（dev install）或 marketplace 升級後，session-start 的 catalog snapshot **不會** 自動 refresh，新 skill 對 agent 不可見直到 user manually reload — 但很多時候 user 自己不知道需要做。D-1 dogfood 本身就踩到（autopilot v2.7.x 新 skills 在 disk 但不在 session catalog）。
3. **Auto-fix workflows**：例如 autopilot 自己改 `.claude/dispatch-config.md` 之後想立即驗證新 chain — 同樣需要 reload，agent 卡住。

當下 workaround：

- 告知使用者手動跑 `/reload-plugins`
- 或：放棄 in-session 驗證，留給下次 session 自然 refresh
- 或：用「reasoned inference」代替實際 observation（D-2 §C-1/C-2 就是這樣處理的）

這些 workaround 都不可接受作為長期解法 — 因為它讓 dogfood / verification 必須包含 human-in-the-loop，無法走 ralph-loop / CEO agent 完全自主執行的流程。

## 2. 受影響的範圍

| 場景 | 當下 impact | 是否 blocking |
|------|-------------|---------------|
| D-2-style scenario dogfood | 必須手動 reload | ⚠️ blocking automation |
| autopilot 自己改 dispatch-config 後驗證 | 無法 in-session 驗證 | ⚠️ blocking auto-iteration |
| Plugin dev install + git pull workflow | 新 skill 對 agent 隱形 | ⚠️ frequent user surprise |
| 一般 plugin install/uninstall | user typically 在裝完後自己 reload | ✓ low impact |

## 3. 選項分析

### Option A — 等 Claude Code 核心提供 agent-invokable reload hook

**形式**: Claude Code CLI 提供 `claude plugins reload` Bash command，或 agent SDK 暴露 `reloadPlugins()` API。

**Pros**:
- 最乾淨 — agent 走標準 tool 介面，無 side-channel
- 適用所有 plugin（不只 autopilot）
- 不需要 autopilot 自己維護 fragile mechanism

**Cons**:
- autopilot 控制不了時程
- 可能 Anthropic 不認為值得加（slash command 即足夠）

**估算成本**: 0（external dependency），但 turnaround 可能數月

### Option B — Bash workaround: 重啟整個 Claude Code session

**形式**: agent 透過特殊 sentinel 讓 user-side wrapper 殺掉 session 重啟。autopilot hook 在 session start 時偵測 sentinel，automaticly fresh-load。

**Pros**:
- autopilot 自己 100% 控制
- Catalog 一定 refresh（fresh session）

**Cons**:
- **session state loss** — 對話歷史、in-flight TaskCreate state 都會掉
- 與「in-session 驗證」目標相違：dogfood 要在同 session 內看到 before/after
- 觸發 sentinel 機制脆弱（wrapper 不在的 user 跑會卡住）

**估算成本**: M (~1 day) 寫 wrapper + hook + sentinel protocol

**判定**: ❌ 對 D-2 dogfood 沒幫助（state loss = 無法在同 session 內 before/after compare）

### Option C — autopilot pseudo-reload via in-context catalog mirror

**形式**: autopilot 在 user-prompt-submit hook 偵測 plugin file mtime 變動 → 把新 skill description 注入 system message，**模擬** catalog refresh 給 agent 看。實際 Claude routing 仍是舊 catalog snapshot，但 agent 的 routing intuition 變成 based on injected mirror。

**Pros**:
- 不需重啟 session
- in-session 可觀察「routing 行為差異」
- autopilot 100% 自家可控

**Cons**:
- **不是真的 reload** — Skill tool 實際 invoke 時仍受真實 catalog 限制（agent 可能 propose `superpowers:test-driven-development` 但實際 invoke 拿不到 skill 內容）
- agent 容易混淆 mirror 跟 reality（"我看 catalog 有，怎麼 invoke 失敗?"）
- Pollute system message with hot-reloaded content，可能 trigger cache invalidation

**估算成本**: M (~1 day) 寫 hook + injection format

**判定**: ⚠️ 適合 D-2 routing observation（不 actually invoke），不適合需要實際 dispatch 的 workflow

### Option D — 不修，明確記錄為 Known Limitation + 提供 reload-watch helper

**形式**: 接受 reload 是 user-side。autopilot 提供一個 hook，在偵測到 `.claude/dispatch-config.md` / `settings.local.json` / `plugins/installed_plugins.json` mtime 變動時，post-tool-use 印一行 reminder：「Catalog changed — `/reload-plugins` recommended before next routing query」。

**Pros**:
- 最低成本，~30 分鐘工
- 不引入 fragile mechanism
- 明確 user contract：你改 plugin config 就 reload，autopilot 自動提醒
- D-2-style dogfood 改用「人工 in-loop」明確的 SOP（runner-guide 加 step 「user, please /reload-plugins now」），把限制 surface 出來而不是試圖繞過

**Cons**:
- 沒解決 automation 完整性 — ralph-loop 或 CEO agent 仍會卡在這步
- 對「routing intuition observation only」場景（D-1 的 9 個 case 多數屬此）價值有限：本來就不 invoke skill，reload 與否不影響 intuition

**估算成本**: S (~30 min) hook + 1 個小 helper script

**判定**: ✅ 最務實的當下 fallback

## 4. 推薦：D 為短期 + A 為長期

**短期**（v2.8.x 範圍內）：實作 Option D。

- 新增 hook：`hooks/reload-watch.sh`（or `.py`），post-tool-use 觸發，diff `installed_plugins.json` + `.claude/dispatch-config.md` mtime，變動則注入單行 reminder
- 修改 D-2-style dogfood runner guide：明確列「Step 3.5 (user action): please run `/reload-plugins` now」
- README + `plugins/installed_plugins.json` description 加 known-limitation 說明
- Skill `quality-pipeline` 若 detect 到 dispatch-config 跟 catalog 不一致，emit warning（已有 `!cat dispatch-config.md` 但沒 cross-check catalog awareness）— 此處改動 nice-to-have

**長期**（Q3 2026 觀察）：開 issue 在 anthropics/claude-code 請求 agent-invokable reload。若 Anthropic accept 並 ship，autopilot 立即 migrate 過去並 deprecate Option D 的 watcher hook。

**不採 B / C**：B state loss 反成本太大；C 引入 mirror 跟 reality 不一致風險。

## 5. Acceptance Criteria

實作 Option D 完成判定：

1. 在 dev install 環境，於 session 內 `git pull` autopilot 後（disk skill 變多），下次 post-tool-use 應自動 emit 一行 reminder
2. 在 D-2-style 流程，user 改 `.claude/settings.local.json` 後，下個 post-tool-use 應 emit reminder
3. Reminder 必須 idempotent — 同一個 mtime 狀態下重複 trigger 不應重複噴 reminder
4. False positive rate: 一般 dev workflow 不應觸發（例如改 source code 不算 plugin config 變動）
5. Documentation: README 加 known limitation 段，dogfood runner-guide 加 Step 3.5

## 6. Non-Goals

- 不嘗試 in-process plugin reload（Claude Code core 不支援，超出 autopilot scope）
- 不重做 D-2 dogfood — 既有 log 的 reasoned inference 仍有效
- 不修改 Claude Code 的 `/reload-plugins` 行為（external dependency）

## 7. Open Questions

1. Reminder 形式：印一行還是改成 hard fail（要求 user explicit `/reload-plugins` 才能繼續）？硬 fail 對 ralph-loop 不友善。傾向 soft reminder。
2. mtime 偵測精度：FS 不穩可能觸發 false positive。可改 hash diff。
3. 對 marketplace install 而非 dev install 是否需要不同行為？mtime 適用前者；後者升級走 marketplace 路徑，可能需要 hook into Claude Code 的 plugin update event（未必有）。

## 8. References

- D-1 + D-2 dogfood log: `docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md` §D-2 loud finding
- 既有 hook 範例: `hooks/hooks.json` + `hooks/*` (可參考 watcher pattern)
- 相關 skill: `quality-pipeline` (作為 `!cat` 注入的既有先例)
