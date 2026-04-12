# Universal Hooks Ship B (v2.5.0) — 8 Default-On + 6 Opt-In Hooks

**日期：** 2026-04-12
**狀態：** ✅ Shipped in v2.5.0 (2026-04-13, merge `817c707`)
**執行觸發條件：** Ship A (v2.4.0) 完成後 1-2 個 session 的 runtime dogfood 觀察期結束，把踩到的痛點作為 Ship B OKR 輸入
**來源：** Ship A (`2026-04-12-methodology-agents-and-hooks.md`) 的 deferred scope + r1 review 的 Critical/Major 修正
**Size：** L
**Dogfood：** Ship B 完成後，autopilot 將擁有自己的 `commit-secret-scan` / `branch-protection` hook 保護自己的 develop 分支；這形成「autopilot 方法論守護 autopilot 開發」的閉環

---

## 0. Ship B 前置條件（未滿足前禁止開 dev-flow L-1）

**必要條件**（三項都要達成才啟動）：

1. **Ship A runtime dogfood 至少 2 個 session** — 驗證 `autopilot:reviewer` / `:debugger` / `:planner` 實際 dispatchable，Output Contract 實際產出符合 §4.1.1 unified 骨架，quality-pipeline 的 Handoff enum consumption 實際 pattern-match 成功
2. **Ship A 觀察期有記錄新的痛點** — 若 dogfood 過程踩到新的 edge case（例如某 hook 的假設在 autopilot 自己身上不成立），要納入 Ship B OKR
3. **用戶明確批准執行** — 這份 plan 目前是 draft，不能直接被 `autopilot:dev-flow` 拉去執行；必須由用戶或 CEO 明確說「Ship B 啟動」才轉 active

**如果觸發條件未滿足就啟動會怎樣？** — Ship B 的 14 個 hook 會基於 Ship A 的理論設計 port，而非 Ship A 的實際 dogfood 經驗。會錯過所有 "autopilot 自己踩到才知道" 的調整機會（例如：`branch-protection` 的 PROTECTED regex 對 autopilot 的 feature branch 命名是否夠寬鬆、`cost-tracker` 對 Claude Code 實際 usage 物件格式是否正確等）。

## 1. 背景與動機

### 1.1 從 Ship A 繼承的主張

Ship A 的方法論 agent 層已經落地：`autopilot:reviewer` / `:debugger` / `:planner` 把 Three Red Lines 紀律帶進 agent 執行層，`quality-pipeline` 透過統一 Handoff enum 做 pattern-matching dispatch。但 Ship A 明確把**hook 層強制 enforcement** 延到 Ship B：

> Ship A §1.1：「Hook 層硬 enforcement 問題確實存在但移到 Ship B」

這個延後的理由是 **ship split**（r1 reviewer unanimous feedback）—14 個 hook port 是獨立的 L-ship，塞進 Ship A 會讓 critical path 炸掉、測試覆蓋不夠。現在 Ship A 已完成，Ship B 是繼續補完 hook 層的工作。

### 1.2 問題

autopilot 目前有 **1 個 hook**（`hooks/session-start.sh` — 只做 SessionStart priming）。所有紀律都靠 Claude 自律讀 skill / memory。這留下幾種可機器強制但目前靠自律的違規類型：

| 違規類型 | 目前狀態 | hook 能擋 |
|---------|---------|----------|
| Read 大檔案炸 context | 靠 Claude 自己判斷 | `large-file-warner` (>500KB 警告, >2MB 擋) |
| Tool-call 失控沒 /compact | 靠 Claude 觀察 | `suggest-compact` (counter + 50/75/100 閾值提醒) |
| Bash 誤執行 secret 洩漏 | 只有 memory feedback 規則 | `commit-secret-scan` (regex 擋 staged 內容) |
| Force push to main | memory 規則 + CLAUDE.md | `branch-protection` (硬擋 force push / commit on protected) |
| Token cost 飄走無追蹤 | 沒追蹤 | `cost-tracker` (per-session JSONL log) |
| Bash 歷史沒 redact | 沒 log | `audit-log` (with auto secret redaction) |
| Session 結束沒摘要 | 沒 log | `session-summary` (append to ~/.claude/sessions/) |
| Tool error 零散 | 沒集中 | `log-error` (append ~/.claude/error-log.md) |

Ship B port devteam 的 8 個通用 hook + 6 個 opt-in hook 關閉這些 gap。

### 1.3 為什麼這次要先踩 dogfood 再 ship

Ship A 的 r2 review 抓到一個 Critical：**`branch-protection.js` 的 PROTECTED regex (`main|master|production|release|prod`) 是 substring match**，會把 `release/v2.4.0` / `release-candidate` / `prod-diagnostics` / `mainline` 全部當 protected branch 擋住。這個 bug 是「紙上看不出來但實際一跑就炸」的典型。

Ship B 的 14 個 hook 每個都可能有類似的假設洞。**先跑 Ship A 1-2 個 session，觀察 Claude 在實際 autopilot 開發上的 behavior，才能把 Ship B hook 調校到實際可用**。而不是 port devteam 的 hook 然後發現 autopilot 自己踩雷。

### 1.4 來源研究

同 Ship A — [`NYCU-Chung/my-claude-devteam`](https://github.com/NYCU-Chung/my-claude-devteam) v1.1.0 (MIT)。devteam 的 15 個 hook 中，Ship B port 其中 14 個（移除 1 個 TWGameServer-specific）+ 依 Ship A review 發現的問題做調校。

---

## 2. OKR

### 2.1 成功條件

1. **8 個 Tier A default-on hook**（通用、語言無關、0 副作用）port 完成並在 `hooks/hooks.json` 註冊啟用
2. **6 個 Tier B opt-in hook**（技術棧 specific）port 完成並在 `settings.example.json` 提供啟用範例 + 註解
3. **autopilot 自己適用**—Ship B 的 hook 實際守 autopilot 自己的開發流程（例：`branch-protection` 擋 `main` commit、`commit-secret-scan` 掃 staged 內容）
4. **零 breaking change**—現有 autopilot 用戶升級後所有舊行為正常，新 hooks opt-in 可關閉
5. **版本 bump**—新 feature = minor bump `2.4.0 → 2.5.0`，`grep -rn "2.4.0" . | grep -v CHANGELOG | grep -v docs/plans/` 回空
6. **針對 Ship A r1 C1 的修正**—`branch-protection.js` 的 PROTECTED regex 必須是 **anchored whole-ref match**（不是 substring），且可由 env var / settings 覆寫；預設只守 `main`, `master`，不守 `release`, `prod`, `production`（後兩個誤擋 feature branch 機率太高）
7. **針對 Ship A r2 Minor 的修正**—hook 之間的 secret-redact regex 統一（避免 `audit-log.js` 和 `commit-secret-scan.js` 的 denylist 不一致）
8. **所有 8 個 Tier A hook 手動測試**（不是 3/8）—default-on hooks 可能硬擋用戶操作，每個都要 positive test（擋對的東西）+ negative test（不擋合法操作）

### 2.2 非目標（Out of Scope）

- **不**寫 hooks 的 unit test—autopilot 沒有 Node 測試框架慣例；依賴手動測試 + dogfood
- **不**做跨平台 polyglot—hooks 假設 Unix / Node.js，Windows 用戶需要 WSL 或不啟用
- **不** port devteam 的 `log-error.sh`（Bash 版）—改寫為 `log-error.js` 和其他 hook 風格一致
- **不**動 Ship A 的 agents / quality-pipeline 整合—那些已經 shipped，Ship B 只加 hook 層
- **不**把 TWGameProject 特化 hook 放進 autopilot—（`dev-sh-enforcer` / `sync-bug-pattern-scanner` 等）留在 `server/.claude/hooks/`

### 2.3 從 Ship A review loop 繼承的約束

Ship A r1 review 發現的問題，Ship B 的 hook 設計從一開始就納入：

| Ship A finding | Ship B 的對應設計 |
|---------------|----------------|
| C1: branch-protection regex substring match | **OKR 6 硬性要求** anchor match + 可 override |
| mi1: audit-log + commit-secret-scan secret regex 不一致 | **OKR 7 硬性要求** 抽共用 regex 模組 `hooks/_shared/secret-patterns.js` |
| mi1: suggest-compact counter persistence 未指定 | **Phase 1 設計時明確指定** 存 `/tmp/claude-tool-count-${sid}`，per-session 粒度 |
| mi1: cost-tracker privacy | **Phase 2 設計 opt-out**—`settings.json` 可關閉 |
| mi2: Phase 5 testing 3/4 太軟 | **OKR 8 強制 8/8**（Tier A 全部測），Tier B 維持 spot-check |
| M1: voltagent version drift (README hardcode agent 名字) | Ship B 不觸及 README 的 voltagent 引用；但 hook 內部不應 hardcode voltagent agent path |

---

## 3. L-1.5 Scope Completeness Audit（per v2.1.1 mandate）

> 注：此 audit 是 **plan 階段** 的草稿，正式執行時會在 dev-flow L-1 重跑並可能調整。

| Dimension | 狀態 | 產出位置 |
|---|---|---|
| **source** | ✅ 在 scope | `hooks/*.js` ×14 + `hooks/_shared/secret-patterns.js` + `hooks/hooks.json` + `settings.example.json` |
| **tests** | ❌ 不在 scope | hooks 無 unit test 慣例；靠手動測試 + dogfood |
| **docs** | ✅ 在 scope | `hooks/README.md`（所有 hook 的功能說明 + 啟用表）+ 本 plan doc |
| **API** | ❌ 不在 scope | hooks 不公開 API |
| **templates** | ✅ 在 scope | `project-config-template/hooks.json`（新增，讓 consuming projects 有範本）+ `settings.example.json` 的 opt-in 範例 |
| **CHANGELOG** | ✅ 在 scope | `CHANGELOG.md` v2.5.0 entry |
| **version** | ✅ 在 scope | `.claude-plugin/plugin.json` 2.4.0 → 2.5.0，marketplace.json 同步，兩份 README version badge 同步 + 新增 "hooks-14" badge。**MANDATORY**：`grep -rn "2.4.0" . \| grep -v CHANGELOG \| grep -v docs/plans/` 回空 |
| **migration** | ❌ 不在 scope | 零 breaking change；新 hooks 都是 opt-in 或不影響既有流程 |
| **consumers** | ✅ 在 scope | 透過 `grep -rn "hooks" skills/` 確認 skill 層沒有 hardcode hook 檔名（應該沒有；hooks 由 Claude Code 運行期呼叫） |
| **credit / attribution** | ✅ 在 scope | README `Inspired By` devteam 條目 update—加「Ship B 吸收 hooks 層」說明（不是新 entry，是更新既有 entry） |
| **dogfood** | ✅ 在 scope | Ship B 的 hook 實際守 autopilot 自己的開發流程；autopilot 從 v2.5.0 開始「吃自己的狗糧」 |

### 檔案總清單（估算）

**新增 (18)**：
1. 本 plan doc（`docs/plans/2026-04-12-universal-hooks.md`，已存在）
2. `docs/projects/YYYY-MM-DD-universal-hooks-ship-b/README.md`（在 dev-flow L-1 時建，不在此 plan scope）
3. `hooks/README.md`
4. `hooks/_shared/secret-patterns.js`（共用 secret regex 模組）
5-12. Tier A hooks ×8: `large-file-warner.js` / `suggest-compact.js` / `cost-tracker.js` / `audit-log.js` / `session-summary.js` / `log-error.js`（改寫自 devteam 的 log-error.sh）/ `commit-secret-scan.js` / `branch-protection.js`
13-18. Tier B hooks ×6: `config-protection.js` / `check-console.js` / `batch-format.js` + `accumulator.js`（batch-format 的相依）/ `test-runner.js` / `design-quality.js` / `mcp-health.js`
19. `settings.example.json`（opt-in hooks 的啟用範例）
20. `project-config-template/hooks.json`（consuming project 的 hook 範本）

**修改 (6)**：
21. `hooks/hooks.json`（註冊 Tier A 8 個 default-on hook）
22. `README.md`（新增 Hooks 章節 + hooks-14 badge）
23. `README.zh-TW.md`（同步）
24. `.claude-plugin/plugin.json`（2.4.0 → 2.5.0 + description 更新）
25. `.claude-plugin/marketplace.json`（同步）
26. `CHANGELOG.md`（v2.5.0 entry）

**總計：~20 新增 + 6 修改 = 26 檔案** — 單一 L-ship 合理範圍（比 Ship A 的修正後 13 檔多，但 hook 檔案平均較小且獨立）。

---

## 4. 核心設計

### 4.1 Tier A — default-on（8 個，通用、語言無關）

| Hook | Event | 擋什麼 | Ship A review 調整 |
|------|-------|-------|---------|
| `large-file-warner.js` | PreToolUse/Read | >500KB 警告 / >2MB 硬擋（支援 offset/limit 讓用戶明確要讀大檔） | 無調整，直接 port |
| `suggest-compact.js` | PreToolUse/Write\|Edit | tool-call counter per-session，50 / 75 / 100 次提醒 `/compact`（counter 存 `/tmp/claude-tool-count-${CLAUDE_SESSION_ID}`） | mi1 指定存儲位置 |
| `cost-tracker.js` | Stop | 讀 `usage.input_tokens` + `output_tokens`，依 model rate 算成本 append `~/.claude/metrics/costs.jsonl`。**可由 `settings.json` `autopilot.costTracker = false` 關閉** | mi1 privacy concern：加 opt-out |
| `audit-log.js` | PostToolUse/Bash | Bash 歷史 + 自動 secret redact（用 `_shared/secret-patterns.js`），append `~/.claude/bash-commands.log` | mi1 redact 統一：用共用模組 |
| `session-summary.js` | Stop | `git status --short` + `git log --oneline -10` → append `~/.claude/sessions/{YYYY-MM-DD}-{sid}.md` | 無調整 |
| `log-error.js` | PostToolUse/* | grep tool_output 含 `error\|failed\|fatal\|ENOENT` → append `~/.claude/error-log.md` | 從 devteam Bash 版改寫為 Node 風格統一 |
| `commit-secret-scan.js` | PreToolUse/Bash (git commit) | `git diff --cached` staged 內容 scan secret regex（用 `_shared/secret-patterns.js`）→ 阻擋 commit | mi1 redact 統一：用共用模組 |
| `branch-protection.js` | PreToolUse/Bash | **PROTECTED regex = anchored whole-ref match**：預設 `^(main\|master)$`；可由 env `AUTOPILOT_PROTECTED_BRANCHES` 或 `settings.json` `autopilot.protectedBranches` override。擋 commit on protected + force push to protected | **C1 硬性修正**：anchor match、預設縮窄、可 override |

### 4.2 Tier B — opt-in（6 個，預設 off）

同 Ship A plan §4.3，細節無變動：

- `config-protection.js`（ESLint/Prettier/Biome/Ruff config 保護）
- `check-console.js`（JS/TS console.log 掃描）
- `batch-format.js` + `accumulator.js`（Prettier + tsc at Stop）
- `test-runner.js`（vitest/jest sibling test）
- `design-quality.js`（frontend AI slop 偵測）
- `mcp-health.js`（MCP server 指數退避）

啟用方式：`settings.example.json` 每個 hook 有 commented example，用戶 copy 到自己的 `settings.json`。

### 4.3 `hooks/_shared/secret-patterns.js`（新抽象）

為了避免 `audit-log.js` 和 `commit-secret-scan.js` 的 regex 各自維護導致漂移（Ship A r1 mi1），抽一個共用模組：

```js
// hooks/_shared/secret-patterns.js
module.exports = {
  // Known service tokens (exact prefix + length)
  patterns: [
    { name: 'openai', pattern: /sk-[A-Za-z0-9]{20,}/ },
    { name: 'github-pat', pattern: /ghp_[A-Za-z0-9]{36}/ },
    { name: 'github-oauth', pattern: /gho_[A-Za-z0-9]{36}/ },
    { name: 'aws-access-key', pattern: /AKIA[A-Z0-9]{16}/ },
    { name: 'google-api', pattern: /AIza[A-Za-z0-9_-]{35}/ },
    { name: 'slack-bot', pattern: /xoxb-[A-Za-z0-9-]+/ },
    { name: 'anthropic', pattern: /sk-ant-[A-Za-z0-9-]{20,}/ },
  ],

  redact(text) {
    let result = String(text);
    for (const { pattern } of this.patterns) {
      result = result.replace(pattern, '<REDACTED>');
    }
    // Inline kv patterns
    result = result
      .replace(/--token[= ][^ ]*/g, '--token=<REDACTED>')
      .replace(/password[= ][^ ]*/gi, 'password=<REDACTED>')
      .replace(/sshpass\s+-p\s+'[^']*'/g, "sshpass -p '<REDACTED>'");
    return result;
  },

  scan(text) {
    // Returns array of { name, match } for each hit
    const hits = [];
    for (const { name, pattern } of this.patterns) {
      const m = String(text).match(pattern);
      if (m) hits.push({ name, match: m[0].slice(0, 8) + '...' });
    }
    return hits;
  },
};
```

`audit-log.js` 用 `redact()`，`commit-secret-scan.js` 用 `scan()`。兩者共用一份 pattern 清單。

### 4.4 PROTECTED branch 可配置化（C1 修正）

```js
// hooks/branch-protection.js
const DEFAULT_PROTECTED = /^(main|master)$/;
const getProtectedRegex = () => {
  // Priority: env var > settings.json > default
  if (process.env.AUTOPILOT_PROTECTED_BRANCHES) {
    return new RegExp(`^(${process.env.AUTOPILOT_PROTECTED_BRANCHES})$`);
  }
  // ... read settings.json autopilot.protectedBranches
  return DEFAULT_PROTECTED;
};
```

預設不含 `release`, `prod`, `production` — 太容易誤擋 GitFlow feature branches。

### 4.5 手動測試矩陣（OKR 8 — 8/8 Tier A）

Phase 5 整合驗證要求每個 Tier A hook 有 positive 和 negative test：

| Hook | Positive (應該擋) | Negative (不應該擋) |
|------|------------------|-------------------|
| large-file-warner | Read 3MB 檔 → exit 2 | Read 300KB 檔 → 通過 |
| suggest-compact | 第 50 次 write → 警告 | 前 49 次 write → 不提醒 |
| cost-tracker | Stop 後 metrics file 有 entry | `cost-tracker = false` 時無 entry |
| audit-log | Bash `curl -H "Authorization: ghp_xxx..."` → log 中看到 `<REDACTED>` | 無敏感資料的 bash 正常 log |
| session-summary | Stop 後 `~/.claude/sessions/` 有檔案 | 檔案內容含 git status |
| log-error | Bash 執行失敗 → `~/.claude/error-log.md` 新增 entry | 成功命令 → 無新 entry |
| commit-secret-scan | 在 staged 檔案塞 `sk-test1234567890test1234` → commit 被擋 | 無 secret 的 commit → 通過 |
| branch-protection | 在 `main` 分支 `git commit` → exit 2 | 在 `feat/foo` 分支 `git commit` → 通過 |

Tier B 測試維持 spot-check（3/6）— 這些是 opt-in，使用場景較專一，失敗也只影響 opt-in 用戶。

---

## 5. Phase Plan（草稿，正式執行時會在 dev-flow L-1 重開 TaskCreate）

### Phase 0 — 計畫審查（由 ceo-agent 主導 review loop）

1. 寫完本 plan doc ✅（你正在讀的）
2. 觸發條件滿足後啟動：派 ≥2 個 reviewer 並行 review（`voltagent-qa-sec:architect-reviewer` + `feature-dev:code-reviewer` + 可選 `voltagent-qa-sec:security-engineer`—因為 hook 涉及 secret handling）
3. 迭代直到 clean
4. 轉交 dev-flow L-size 執行

### Phase 1 — Tier A hooks（8 個 default-on，可並行）

- P1.1: `hooks/_shared/secret-patterns.js`（先寫，後續 hook 依賴）
- P1.2-P1.9: Tier A 8 個 hook（並行，用 `superpowers:dispatching-parallel-agents`）
- P1.10: `hooks/hooks.json` 註冊 Tier A 8 個 hook 到對應 lifecycle event

### Phase 2 — Tier B hooks（6 個 opt-in）

- P2.1-P2.6: 6 個 opt-in hook（並行）
- P2.7: `settings.example.json` + `project-config-template/hooks.json`

### Phase 3 — 文件

- P3.1: `hooks/README.md`（所有 hook 功能表 + 啟用說明）
- P3.2: README.md + README.zh-TW.md 新增 Hooks 章節 + hooks-14 badge
- P3.3: `.claude-plugin/plugin.json` + `marketplace.json` 2.4.0 → 2.5.0
- P3.4: CHANGELOG.md v2.5.0 entry
- P3.5: **版本同步 grep**—`grep -rn "2.4.0" . | grep -v CHANGELOG | grep -v docs/plans/` 回空

### Phase 4 — 手動測試（OKR 8 — 8/8 Tier A，3/6 Tier B）

- P4.1: 8 個 Tier A hook 的 positive + negative 測試矩陣
- P4.2: 3 個 Tier B hook 的 spot-check（自選，通常挑 config-protection / check-console / mcp-health）

### Phase 5 — finish-flow（L-5 強制閉環）

照 `autopilot:finish-flow` 展開 L-5.1 到 L-5.6 sub-tasks。

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **hook 吃掉 stdin 破壞 Claude Code pipeline**（Ship A r1 指出 hook integrity test 缺） | M | H | 每個 hook `process.stdout.write(d)` 結尾強制 passthrough；catch all exceptions；Phase 4 測試矩陣涵蓋 |
| **branch-protection regex 仍然誤擋**（儘管 C1 已修）| L | M | 預設縮窄到 `^(main\|master)$`，env var 可 override；README 明文警告 GitFlow 用戶需要 override |
| **secret-patterns.js 漏掉某個 cloud provider 的 token pattern** | M | M | Phase 1 P1.1 對比 gitleaks / truffleHog 的 canonical pattern 清單，選 top 10 常見 |
| **cost-tracker 在某些環境沒 `usage` 欄位導致 crash** | M | L | 所有欄位 `Number(x \|\| 0)` 容錯；無 usage → append 空 entry 或 skip |
| **用戶安裝 Ship B 後既有 workflow 被新 hook 擋住** | M | M | 所有 Tier A hook 預設在 `hooks.json` 啟用；用戶可在 `settings.json` 個別關閉；CHANGELOG 明確列出新 default-on hooks |
| **Ship B 的 dogfood 困難**—hook 在 autopilot 自己身上實測很難觸發 | M | L | `branch-protection` 可在 autopilot develop 分支測試；`commit-secret-scan` 可塞假 token 測試；`large-file-warner` 可 Read 大 markdown 測試 |
| **Windows 用戶 Bash script hook 無法跑** | L | M | 文件明示 hooks 假設 Unix / Node.js 環境；Windows 用戶用 WSL 或不啟用 |

---

## 7. Rollback Plan

- **整個 Ship revert**：`git revert <merge commit>` — 所有 hook 檔案消失、hooks.json 回到舊狀態、version 可手動回 2.4.0
- **單個 hook disable**：用戶在 `settings.json` 關個別 hook，不需 revert plugin
- **部分 Tier disable**：若發現 Tier A 某個 hook 假設錯誤，可只移除該 hook 的 `hooks.json` entry 而不影響其他
- **Version 回退**：`.claude-plugin/plugin.json` 和 `marketplace.json` version 改回 2.4.0

**無 schema migration / 資料遷移**，零資料遺失風險。

---

## 8. Definition of Done

- [ ] Ship A 已 shipped 至少 2 個 session 的 runtime dogfood（前置條件）
- [ ] 用戶明確批准 Ship B 啟動
- [ ] Phase 0 review loop 通過（≥2 個 reviewer LGTM）
- [ ] Phase 1: 8 個 Tier A hook port + `_shared/secret-patterns.js` + `hooks.json` 註冊
- [ ] Phase 2: 6 個 Tier B hook port + `settings.example.json` + `project-config-template/hooks.json`
- [ ] Phase 3: 文件完整（hooks/README.md + 兩份 README + plugin.json + marketplace.json + CHANGELOG）
- [ ] Phase 3: 版本 grep clean（`grep -rn "2.4.0" . | grep -v CHANGELOG | grep -v docs/plans/` 回空）
- [ ] Phase 4: 8/8 Tier A hook 手動測試通過 + 3/6 Tier B 抽測通過
- [ ] Phase 5: finish-flow L-5 全 sub-tasks 完成
- [ ] 新增 `docs/projects/YYYY-MM-DD-universal-hooks-ship-b/` project dir（L-1 建）+ archive to `docs/projects/_archive/`（L-5.5 歸檔）
- [ ] CHANGELOG v2.5.0 entry 完整
- [ ] Merge to develop 成功
- [ ] autopilot 從 v2.5.0 起「吃自己的狗糧」—Ship B 的 hook 實際守 autopilot 自己的開發流程

---

## 9. Execution Order

```
前置條件驗證（Ship A dogfood + 用戶批准）
    │
    ▼
Phase 0 — review loop（2-3 個 reviewer 並行）
    │
    ▼
Phase 1 (Tier A, parallel) ────┐
Phase 2 (Tier B, parallel) ────┤── 部分並行，_shared/secret-patterns.js 先
    │                           │
    ▼                           │
Phase 3 (docs + version) ◄──────┘
    │
    ▼
Phase 4 (manual testing matrix)
    │
    ▼
Phase 5 (finish-flow L-5)
```

**Critical path**: 前置條件 → Phase 0 → Phase 1 → Phase 3 → Phase 4 → Phase 5

**Parallelization**:
- Phase 1 的 8 個 Tier A hook 可並行（除 `_shared/secret-patterns.js` 要先）
- Phase 1 和 Phase 2 可部分重疊（不同檔案，不同 consumer）
- Phase 3 的 README + CHANGELOG 可和 Phase 1/2 後半並行

---

## 10. Credits & Source

同 Ship A — [`NYCU-Chung/my-claude-devteam`](https://github.com/NYCU-Chung/my-claude-devteam) v1.1.0 (MIT)。Ship B 吸收 14 個 hook 的技術底層 JS/sh 邏輯，並依 Ship A review 發現的問題（Critical 1, Minor 1）做調校：

- **C1 修正**：PROTECTED branch regex 從 substring match 改為 anchored whole-ref + env var override
- **mi1 修正**：secret-patterns 抽共用模組，解決 `audit-log` 和 `commit-secret-scan` 的 regex 不一致問題
- **mi1 修正**：cost-tracker 加 opt-out（privacy concern）
- **mi1 修正**：suggest-compact 的 counter persistence 明確指定為 `/tmp/claude-tool-count-${sid}` per-session
- **mi2 修正**：Phase 4 手動測試從 3/4 提升到 8/8（Tier A）

**不吸收**（同 Ship A 決定）：
- devteam 的 role agent 層（fullstack-engineer / frontend-designer / db-expert 等）
- P7/P9/P10 三層文化詞彙
- Loop 模式 `<loop-pause>` / `<loop-abort>` tag 協議

Attribution destination: `README.md` § Inspired By 已有 devteam entry（Ship A 建的），Ship B 只 update 說明加「v2.5.0 吸收 hook 層」。

---

## 11. Review Loop History

_待 Phase 0 review loop 執行後填寫_

Ship B 的 review loop 預計比 Ship A 輕—因為：
- 設計已經從 Ship A 繼承很多經驗（unified enum / ship split / review loop discipline）
- C1 / mi1 的修正已經預先寫進 plan，review 不用再發現一次
- hook 是小型獨立 JS 檔案，結構複雜度比 agent 低

但 `hooks/_shared/secret-patterns.js` 的 regex 選擇 + `branch-protection.js` 的 override 機制會是 review 重點。

---

## 12. 啟動指令（用戶接下來可以做的事）

**目前狀態**：plan draft 已完成，未執行。

**啟動 Ship B 的路徑**：

1. 用 Ship A（v2.4.0） dogfood 至少 1-2 個 session — 觀察 `autopilot:reviewer` / `:debugger` / `:planner` 實際運作
2. 評估是否有新的痛點應該納入 Ship B scope
3. 對用戶（Board）明確說：「Ship B 啟動」
4. CEO 讀這份 plan，用 `autopilot:dev-flow` 開 L-1，建 feature branch + project dir + phase tasks + finish-flow parent task
5. 按 §5 Phase Plan 執行

**在前置條件滿足前不執行 Ship B**—這份 plan 會一直處於 📋 Draft 狀態。
