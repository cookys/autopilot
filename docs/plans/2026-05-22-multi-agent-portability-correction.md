# Multi-Agent Portability Correction — autopilot v2.7.3

**日期：** 2026-05-22
**狀態：** 📝 Draft — pending user review
**Size：** M
**Branch（建議）：** `fix/v2.7.3-multi-agent-portability-correction`
**取代/修正 commits：** `bf0c637`（OpenCode support）、`b7d1adb`（Codex/Antigravity 相容）、`139ca49`（AGENTS.md）

---

## 1. 背景

PM 在 `bf0c637 → b7d1adb → 139ca49` 三個 commit 引入多平台（OpenCode / Codex / Antigravity）相容性，但**未經 SDK / 官方文件查證**。CTO 派工程師深度 survey 後（見 §2），確認文件與程式碼皆含多項**事實錯誤**，且 hook 修改實際上**會讓 runtime 變更糟**。本 plan 列出需修正項與替代設計。

### 1.1 觸發原因
- `hooks/intent-capture.js` 加入 fallback env var 鏈但仍 hardcoded `.claude-plugin/plugin.json`，在 OpenCode / Antigravity 環境會直接 throw。
- `hooks/session-start.sh` 的「Claude 風格 envelope vs 普通輸出」分流條件被反向擴大，造成在任何非 Claude 平台上都會輸出 Claude 專屬 envelope。
- `references/multi-agent-portability.md` 與 `AGENTS.md` 列舉的 env var、CLI 命令、目錄路徑大多為虛構或拼錯。
- `.opencode/` 目錄是**整份副本**（16 SKILL.md + 3 agent .md + 4 個 symlink 失效），維護負擔極高。

### 1.2 不是要解什麼
不是「放棄多平台支援」。方向正確，只是執行錯。

---

## 2. Survey 事實摘要（CTO 派工調研，2026-05-22）

| 既有聲明 | 實際 | 來源 |
|---|---|---|
| `CODEX_PLUGIN_ROOT` env var | ❌ 不存在；Codex 只有 `CODEX_HOME` | developers.openai.com/codex/config-reference |
| `AGY_PLUGIN_ROOT` env var | ❌ 未查到任何 agy 注入 env var | antigravity.google/docs |
| `GEMINI_PLUGIN_ROOT` env var | ❌ 未查到 | 同上 |
| `OPENCODE_PLUGIN_ROOT` env var | ❌ 不存在；plugin 透過函式參數拿 `{ project, client, $, directory, worktree }` | opencode.ai/docs/plugins |
| `opencode.json` 有 `skills.paths` 鍵 | ❌ 無此鍵；skills 走目錄慣例自動掃 | opencode.ai/docs/skills |
| `opencode.json` `plugin` 鍵接受本地路徑 | ❌ 只接受 npm 套件名陣列；本地 plugin 自動發現於 `.opencode/plugins/` | opencode.ai/docs/plugins |
| Antigravity plugin manifest 是 `plugin.json` | ❌ 是 `gemini-extension.json`（沿用 Gemini CLI extension 格式） | geminicli.com/docs/extensions/reference |
| `agy plugin validate` 命令 | ❌ 不存在；只有 install/uninstall/list/enable/disable/import | deepwiki.com/google-antigravity/antigravity-cli |
| Antigravity workspace skills 在 `.agent/skills/` | ⚠️ 拼錯；官方是 `.agents/skills/`（複數） | codelabs.developers.google.com/getting-started-google-antigravity |
| Antigravity global skills 在 `~/.gemini/antigravity-cli/plugins/` | ❌ 是 `~/.gemini/antigravity/skills/` | 同上 |
| Codex 只讀 AGENTS.md、不是 skill host | ❌ Codex **是** skill/plugin host，掃 `.agents/skills/` → `~/.agents/skills/` → `/etc/codex/skills/` → bundled | developers.openai.com/codex/skills |
| SKILL.md 三家互通 | ✅ Claude Code / OpenCode / Codex / Antigravity 皆用相同 YAML frontmatter（`name` + `description`）| 各家 docs |

**關鍵新發現**：`.agents/skills/`（複數）是 **Codex + OpenCode 的天然交集目錄**，Antigravity 拼法亦同。這應成為 autopilot 的主要 source-of-truth path。

---

## 3. 設計決策

### 3.1 採用「單一 source + 各平台 thin wrapper」取代「整份副本」

**R2 修正版**（恢復 `_bodies/` — `agents/<role>.md` **確含** YAML frontmatter；移除 `.opencode/skills/<name>` symlink；只保留 `.agents/skills/` 為主要交集）：

```
autopilot/
├── skills/                              ← single source of truth
│   └── <skill>/SKILL.md
├── agents/
│   ├── reviewer.md / debugger.md / planner.md   ← 既有（含 YAML frontmatter，給 Claude Code）
│   └── _bodies/<role>.body.md           ← (new) 無 frontmatter 純 body；OpenCode {file:..} reference 來源
├── hooks/                               ← Claude Code hooks（bash + JS）— 不改名、不擴 env var
├── .opencode/                           ← OpenCode wrapper（沿用既有路徑）
│   ├── opencode.json                    ← schema 修正後版（移除非法 skills.paths / plugin 鍵）
│   ├── plugins/autopilot.ts             ← in-process plugin（補 circuit breaker；保留既有 __dirname 3-level climb）
│   ├── package.json                     ← (new) declare @opencode-ai/plugin peer dep
│   └── agents/<role>.md                 ← frontmatter only，body 用 {file:../../agents/_bodies/<role>.body.md}
├── .agents/skills/ → ../skills          ← (new) symlink；OpenCode + Codex + Antigravity workspace 全部走這條
├── platforms/codex/config.toml.example  ← (new) Codex 安裝範例
├── scripts/
│   ├── setup-symlinks.sh / .ps1         ← (new) 安裝必經步驟，含 Windows 對應
│   ├── install-antigravity.sh / .ps1    ← (new) symlink 自動化；replaces INSTALL.md
│   ├── sync-agent-bodies.sh             ← (new) 從 agents/<role>.md 拆出 body 寫到 _bodies/；pre-commit 強制
│   └── preflight-portability.sh         ← (new) §5 自動化驗收
├── .claude-plugin/plugin.json           ← canonical source-of-truth（version + description）
├── plugin.json                          ← mirror，由 sync-version.js 從 canonical 寫出
├── AGENTS.md                            ← agents.md spec readme（依 spec 建議四節 + autopilot 自加）
└── CLAUDE.md                            ← Claude Code 專屬開發守則（從 b1ee7a6 復原）
```

**為何不留 `.opencode/skills/<name>` symlink**：OpenCode native 同時掃 `.opencode/skills/`、`.claude/skills/`、`.agents/skills/`。`.agents/skills/` 已是 source-of-truth path，再加 `.opencode/skills/` symlink 是 drift surface（Skeptic R1 §I1）。

**為何恢復 `agents/_bodies/`**：R1 Architect 認為 over-engineering 但 R2 自驗發現 `agents/<role>.md` **確含** `name / description / tools / model` YAML frontmatter。OpenCode `{file:..}` 會把整檔 inline 入 agent prompt body、frontmatter 變成 prompt 文本污染。`_bodies/` 拆出無 frontmatter 純 body 解決此問題（Architect R2 catch）。`scripts/sync-agent-bodies.sh` 自動從 `agents/<role>.md` 解析、拆 body 到 `_bodies/`，pre-commit 強制執行避免 drift。

### 3.2 抽屜原則（哪些東西放哪）

| 內容 | 位置 | 理由 |
|---|---|---|
| Skill body | `skills/<name>/SKILL.md` | YAML frontmatter 已是事實標準 |
| Skill `compatibility` 欄位 | 寫進 SKILL.md frontmatter（單一檔案） | 不需整份複製 |
| Claude Code agent 完整定義 | `agents/<role>.md`（含 frontmatter） | 既有；Claude Code 直接讀 |
| Methodology agent **純 body** | `agents/_bodies/<role>.body.md`（無 frontmatter） | OpenCode `{file:..}` reference 來源；避免 frontmatter 洩入 prompt（Architect R2） |
| OpenCode agent wrapper | `.opencode/agents/<role>.md` 用 `{file:../../agents/_bodies/<role>.body.md}` | OpenCode 官方支援 `{file:...}`，解析相對 config 檔目錄 |
| Claude Code hook | `hooks/*.{sh,js}` | 維持，**不擴 env var fallback**（見 §3.3） |
| OpenCode hook | `.opencode/plugins/autopilot.ts` 內 export functions | OpenCode 是 in-process TS plugin、不跑外部腳本 |
| Skill 發現主路徑 | `.agents/skills/ → ../skills` symlink | Codex + Antigravity + OpenCode 三家共同掃此路徑 |
| Antigravity global 安裝 | 透過 `scripts/install-antigravity.sh` 連結到 `~/.gemini/antigravity/skills/` | global path 為 codelabs walkthrough 來源、未來可能漂移，封裝在 script 內好替換 |

### 3.3 Hooks 修正（critical）

**Review 收斂後決策**（Ops review §C2 + Skeptic §C2）：
- 砍掉 `path.dirname(__dirname)` 物理 fallback——`dev-setup.sh` 用 symlink install 時 Node 預設解析 real path，路徑會跳到 repo 真實位置、產生 dev/install 路徑不對稱。
- `CLAUDE_PLUGIN_ROOT` 缺失就直接 return `'unknown'`、不 throw。
- **不要** 加 `CODEX_PLUGIN_ROOT` / `AGY_PLUGIN_ROOT` / `GEMINI_PLUGIN_ROOT` 假變數鏈。

```js
// hooks/intent-capture.js
function getPluginVersion() {
  const pkgRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pkgRoot) return 'unknown';  // Non-Claude host or missing env: silent skip.
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}
```

`hooks/session-start.sh` 還原為**單一條件 `CLAUDE_PLUGIN_ROOT`**（從 b1ee7a6 取原版）。

**OpenCode 對應路徑（R3 Architect catch 算術錯）**：
- R1 改用 `directory` 是錯（Skeptic R2 catch：`directory = cwd` 不是 plugin install dir）。
- R3 改回保留既有 `__dirname` 3-level climb——但 **R3 Architect 實測算術也錯**：從 `<repo>/.opencode/plugins/` 出發走 `..`, `..`, `..` 落到 `<repo>` 的 **parent** dir，不是 repo root。既有 code 一直 silent return `'unknown'`（catch 吃掉 ENOENT）。**這是 latent bug、不是設計。**
- R4 正解：**2-level climb**（`plugins/` → `.opencode/` → repo root）+ 加驗收：dev 機跑 `getPluginVersion()` 必須回實際版本字串、非 `'unknown'`。
- Bun ESM 下 `__dirname` 行為文件未定（Skeptic R3 catch）→ Phase 3 加 **Spike 0** 實機驗證 `console.error(typeof __dirname, __dirname)` 在 plugin context 內；失敗 fallback 用 `import.meta.url + fileURLToPath(import.meta.url)`。

```ts
// .opencode/plugins/autopilot.ts
function getPluginVersion(): string {
  try {
    // 2-level climb: .opencode/plugins/ → .opencode/ → <repo-root>
    const pluginRoot = path.join(__dirname, "..", "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
    return pkg.version || "unknown";
  } catch { return "unknown"; }
}
// Acceptance: on dev box, must return actual version (e.g. "2.7.3"), not "unknown".
// If Spike 0 finds __dirname undefined in Bun ESM, swap to:
//   const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

**Phase 1 子步驟（Architect R1 §C1，R2 補驗收條件）**：audit `hooks/hooks.json`，**驗收 acceptance**：所有 hook event 的 `command` 欄位均以 `${CLAUDE_PLUGIN_ROOT}` 為前綴；若有絕對路徑或缺前綴 → 修正。Architect R2 觀察：OpenCode 不解 Claude env var、未展開即 noop——audit 結論預期是「無變更」。

### 3.4 OpenCode plugin 修正

當前 `.opencode/opencode.json` 用：
```json
"plugin": ["./.opencode/plugins"]
```
官方規定 `plugin` 只接受 **npm 套件名**。本地 plugin 自動發現於 `.opencode/plugins/`（無需 `opencode.json` 列出）。修正：

```jsonc
// .opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  // 不需要 "plugin": [...]（本地路徑自動發現）
  // 不需要 "skills": { "paths": ... }（不存在此鍵）
  "agent": {
    "autopilot-reviewer": {
      "description": "...",
      "mode": "subagent",
      // 從 .opencode/opencode.json 出發，../ 上去 repo root 取 agents/<role>.md
      // Skeptic review §C1 提醒：`{file:...}` 解析相對 config 檔目錄
      // Phase 3 必須 spike 驗證 OpenCode 是否真支援 `../` 跨層解析
      "prompt": "{file:../agents/reviewer.md}"
    }
  },
  "instructions": ["./README.md"]
}
```

**Skill 發現策略**：OpenCode native 同時掃 `.opencode/skills/`、`.claude/skills/`、`.agents/skills/`。autopilot 只建立 `.agents/skills/ → ../skills` 一條 symlink（OpenCode 走這條、Codex 走這條、Antigravity workspace 走這條）。**不**建立 `.opencode/skills/<name>` symlink——多一條 = 多一條 drift surface。

**Phase 3 spike 必做（Architect §C2 + Skeptic §C1）**：
1. `mkdir -p /tmp/oc-test/.agents/skills/foo` + 放 minimal SKILL.md，跑 OpenCode 看 skill list 是否出現。
2. `.opencode/opencode.json` agent.prompt 用 `{file:../agents/reviewer.md}` 跨層解析，跑 `opencode agents list` 確認載入無誤。
3. 兩個 spike 任一失敗就回退到保留 `.opencode/skills/` symlink + `agents/` 本地副本。

### 3.5 Antigravity 範圍（已拍板）

**只做 skill 共享**，不碰 hook / plugin manifest。實作：
- repo 加 `.agents/skills/ → ../skills/` symlink（Antigravity 也讀 `.agents/skills/`）。
- 新檔 **`scripts/install-antigravity.sh`**（Ops §I4）——10 行 bash 偵測 OS + `ln -s`；PowerShell sibling `install-antigravity.ps1` 給 Windows。取代原計畫的 `INSTALL.md`。
- 全域路徑 `~/.gemini/antigravity/skills/` 來源是 codelabs walkthrough（非 stable spec，Skeptic §C3）——script 內加註「以 `agy --version` 為準、若漂移請開 issue」。
- **不寫** `gemini-extension.json`、不寫 hook adapter。

### 3.6 AGENTS.md / CLAUDE.md 角色重新切割

- **AGENTS.md**：依 agents.md spec 建議的四節（Project Structure / Coding Conventions / Testing / PR Guidelines）+ autopilot 自加（Build / Contribution）。Skeptic §I2 提醒：spec 不強制章節、要明寫「依 spec 建議 + autopilot 自加」。**寫跨家共識路徑（如 `.agents/skills/`）可，寫某平台獨有鐵律（如 `agy plugin validate`）不可**（Ops §M3）。
- **CLAUDE.md**：恢復 b1ee7a6 原版（scripts inventory、hook count、severity vocab、reply preference、coexistence 細節）。引用 AGENTS.md 為 generic readme。
- **`references/multi-agent-portability.md`**：改寫為事實版，每個聲明附 URL，刪除未查證項。

### 3.8 新增 Script Pseudocode（Ops R2 §C3 要求）

**`scripts/setup-symlinks.sh`**（idempotent；Linux/macOS/WSL）：
```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
declare -a LINKS=(
  ".agents/skills:../skills"                       # global Codex/Antigravity workspace
)
for entry in "${LINKS[@]}"; do
  link="${REPO}/${entry%%:*}"
  target="${entry##*:}"
  [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ] && continue   # already correct
  [ -e "$link" ] && rm -rf "$link"                                       # purge stale
  mkdir -p "$(dirname "$link")"
  ln -s "$target" "$link"
done
```

**`scripts/setup-symlinks.ps1`**（Windows；需 Dev Mode 或 admin）：
```powershell
$repo = Split-Path -Parent $PSScriptRoot
$links = @{ ".agents\skills" = "..\skills" }
foreach ($pair in $links.GetEnumerator()) {
  $link = Join-Path $repo $pair.Key
  $target = $pair.Value
  if (Test-Path $link) { Remove-Item -Recurse -Force $link }
  New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop
}
# Dev Mode 未開時 New-Item SymbolicLink 會丟 UnauthorizedAccessException；caller 應 catch + 報錯
```

**`scripts/install-antigravity.sh`**（OS-detect + symlink global）：
```bash
#!/usr/bin/env bash
# verified-against: codelabs walkthrough 2026-05-22; antigravity.google/docs/skills
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)" in
  Linux|Darwin) DEST="$HOME/.gemini/antigravity/skills" ;;
  *) echo "Unsupported OS; use install-antigravity.ps1 on Windows" >&2; exit 1 ;;
esac
mkdir -p "$DEST"
LINK="$DEST/autopilot"
[ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$REPO/skills" ] && { echo "already installed"; exit 0; }
[ -e "$LINK" ] && { echo "ERROR: $LINK exists and is not the expected symlink" >&2; exit 2; }
ln -s "$REPO/skills" "$LINK"
echo "installed: $LINK -> $REPO/skills"
echo "verify with: agy skills list 2>/dev/null | grep autopilot"
```

**`scripts/sync-agent-bodies.sh`**（拆 frontmatter，pre-commit `--check` only；R4 修：awk 改 state machine，三方 R3 reviewer 都實測舊版邏輯壞）：
```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$REPO/agents/_bodies"

# --check mode: compare without writing; exit 1 if drift
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

for src in "$REPO"/agents/{reviewer,debugger,planner}.md; do
  name=$(basename "$src" .md)
  dst="$REPO/agents/_bodies/${name}.body.md"

  # Explicit state machine — survives body-internal `---`、no-frontmatter files、blank lines after frontmatter
  body=$(awk '
    BEGIN { state="start" }
    state=="start" && NR==1 && /^---$/ { state="in"; next }
    state=="start" && NR==1 { state="out" }                          # no frontmatter: print everything
    state=="in"    && /^---$/ { state="out"; next }
    state=="in"    { next }                                          # inside frontmatter — skip
    state=="out"   { print }
  ' "$src")

  # Guard: if state machine produced empty body, the source file is malformed
  if [ -z "$body" ]; then
    echo "ERROR: $src has no body (or unclosed frontmatter)" >&2; exit 2
  fi

  if [ "$CHECK" = "1" ]; then
    if ! diff -q <(echo "$body") "$dst" >/dev/null 2>&1; then
      echo "drift: $dst (run: scripts/sync-agent-bodies.sh)" >&2
      exit 1
    fi
  else
    echo "$body" > "$dst"
  fi
done
```

**Pre-commit 策略**（R3 Skeptic + Ops cross-finding）：採 **check-only**（不 auto-stage）。理由：auto-stage 會在 user 改 `agents/<role>.md` 後悄悄 stage 新 `_bodies/<role>.body.md`、超出 user 預期；check-only 失敗訊息明確要 user 跑 `scripts/sync-agent-bodies.sh` → 再 `git add agents/_bodies/` → 再 commit（3-step、繁瑣但顯式）。同樣策略套用 `sync-version.js --check`。

**`scripts/setup-symlinks.ps1`**（R3 Ops catch：補 Dev Mode 偵測）：
```powershell
$repo = Split-Path -Parent $PSScriptRoot
$links = @{ ".agents\skills" = "..\skills" }
foreach ($pair in $links.GetEnumerator()) {
  $link = Join-Path $repo $pair.Key
  $target = $pair.Value
  if (Test-Path $link) { Remove-Item -Recurse -Force $link }
  try {
    New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop | Out-Null
  } catch [System.UnauthorizedAccessException] {
    Write-Error "Enable Developer Mode (ms-settings:developers) or run as Administrator. See README Windows section."
    exit 2
  }
}
```

**`scripts/install-antigravity.ps1`**（R3 Ops catch：R3 §3.1 列出但 §3.8 缺；R4 補骨架）：
```powershell
# verified-against: codelabs walkthrough 2026-05-22
$repo = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:USERPROFILE ".gemini\antigravity\skills"
$link = Join-Path $dest "autopilot"
$target = Join-Path $repo "skills"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
if (Test-Path $link) {
  $existing = (Get-Item $link).Target
  if ($existing -eq $target) { Write-Host "already installed"; exit 0 }
  Write-Error "ERROR: $link exists and is not the expected symlink"; exit 2
}
try {
  New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop | Out-Null
  Write-Host "installed: $link -> $target"
} catch [System.UnauthorizedAccessException] {
  Write-Error "Enable Developer Mode or run as Administrator"; exit 2
}
```

**`scripts/install-hooks.sh`**（R3 Ops catch：§3.7 提及無 pseudocode；R4 補）：
```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
git -C "$REPO" config core.hooksPath .githooks
chmod +x "$REPO"/.githooks/*
echo "installed: $REPO/.githooks/ as git hooks dir"
echo "verify: git config core.hooksPath  # should print .githooks"
```

**sync-version.js editPlan 重構（R3 Ops catch）**：現行 editPlan 把 `.claude-plugin/plugin.json` 當寫入目標——與 R4 「canonical = read-only truth」語義衝突。Phase 0.5 必須**重構** editPlan：`.claude-plugin/plugin.json` 從 replacements list 移到 readSource、把版本/描述讀出來、再寫入根 `plugin.json` + `README.md` badge。CLI arg 仍接受 `2.7.3` 等版本參數，但**寫入只發生在 mirror**，canonical 在用戶手動編輯後成為 source。

### 3.7 雙 plugin.json 同步（已升級為 Phase 0.5）

**Ops R1 §C1 揭發**：`scripts/sync-version.js` 的 `editPlan` 完全沒涵蓋根 `plugin.json`；`hooks/hooks.json` description 已 drift（寫 v2.7.4 但 plugin.json 停在 2.7.2）、README badge 也 stale。§3.7 「強制同步」承諾無 enforcement——必須在 Phase 1 之前 harden。

**Canonical source-of-truth（Ops R2 §C2 catch）**：`.claude-plugin/plugin.json` 為 truth；根 `plugin.json` 為 sync-version.js 寫出的 mirror。原因：Claude Code 直接讀 `.claude-plugin/plugin.json`；Antigravity/OpenCode 透過 mirror 取資料。`--check` 模式從 `.claude-plugin/plugin.json` 讀當前 version + 從 `hooks/hooks.json` 中 hook count 推算 → 與根 `plugin.json` / `README.md` 比對；不一致回 exit 1。

**Phase 0.5（新增）做什麼**：
1. 擴 `sync-version.js` 的 `editPlan` 加 entry：根 `plugin.json`（version + description 從 canonical 來）、`README.md` 的 version badge 與 hooks count badge。
2. 加 `scripts/sync-version.js --check`（read canonical → 比對 mirror → 不一致 exit 1）。
3. **執行順序（Skeptic R2 §I1 catch）**：**先**跑 `node scripts/sync-version.js 2.7.3` 把當前 drift 補齊並 commit（讓 working tree 進入一致狀態）→ **再**裝 `.githooks/pre-commit` 啟用 `--check`。順序顛倒會自我 block。
4. 用 `git config core.hooksPath .githooks`（不寫 `.git/hooks/`，便於 repo-tracked）；提供 `scripts/install-hooks.sh` 一行安裝。
5. README 安裝章移除手工 sync 字樣。

---

## 4. 實作步驟（dev-flow 友善）

**Phase 順序設計**（Architect §I2 + Ops §I2）：每個 Phase 一個 commit、可獨立 ship。Phase 0 / 0.5 / 1 為 hot-fix 路徑（修 runtime bug + 同步基建），優先 merge。Phase 2-5 後續批次。

### Phase 0 — Branch + 立刻修壞東西
1. `git checkout -b fix/v2.7.3-multi-agent-portability-correction`
2. **Pre-flight：working-tree drift 處理**（Ops R2 §5）：當前 `hooks/hooks.json` / `scripts/dev-setup.sh` / `scripts/risk-counter.sh` 已 modified、未 commit。確認哪些是有意義變更（保留）、哪些是 dev 副作用（`git checkout` 復原）。**所有 Phase 0 commit 在乾淨 working tree 上做**。
3. **Commit A**「revert hook env var fallback chain」：`git checkout b1ee7a6 -- hooks/intent-capture.js hooks/session-start.sh`
4. **Commit B**「restore CLAUDE.md from b1ee7a6」：`git checkout b1ee7a6 -- CLAUDE.md`
5. **Commit C**「rm 4 dangling reference symlinks」（Ops R1 §C4，R2 驗證確實 dangling — `../../../` 只到 `.opencode/`、不到 repo root）：條件式 rm 防呆：
   ```bash
   for f in .opencode/skills/{quality-pipeline,think-tank,survey,dev-flow}/references/model-routing.md; do
     [ -L "$f" ] && [ ! -e "$f" ] && rm "$f" && echo "removed dangling: $f"
   done
   ```

### Phase 0.5 — sync-version.js hardening（Ops R1 §C1）
6. 擴 `scripts/sync-version.js` editPlan：加根 `plugin.json` + `README.md` badge。Canonical source = `.claude-plugin/plugin.json`（§3.7）。
7. 加 `--check` 旗標：讀 canonical → 比對 mirror → drift 回 exit 1。
8. **先**跑 `node scripts/sync-version.js 2.7.3` 補當前 drift、commit（Skeptic R2 §I1 順序修正）。
9. **再**加 `.githooks/pre-commit` + `git config core.hooksPath .githooks` + `scripts/install-hooks.sh`、commit。

### Phase 1 — Hooks runtime fix（M1，最關鍵）
10. 依 §3.3 重寫 `hooks/intent-capture.js` 的 `getPluginVersion()`：env var 缺失就回 `unknown`、不做物理 fallback。
11. `hooks/session-start.sh` 已在 Phase 0 復原為 b1ee7a6 單一條件版本——audit 確認。
12. **Audit `hooks/hooks.json`**（Architect R1 §C1 + R2 補驗收）：每個 hook event 的 `command` 必須以 `${CLAUDE_PLUGIN_ROOT}` 為前綴；無前綴或絕對路徑 → 修正。預期 audit 結論「無變更」。
13. Smoke test 包含 **symlinked install 場景**（Skeptic §C2）—— `ln -s $(pwd)/hooks/intent-capture.js /tmp/symlinked.js && CLAUDE_PLUGIN_ROOT=$(pwd) node /tmp/symlinked.js < /dev/null`，驗回值非 `unknown`、無 throw。

### Phase 2 — AGENTS.md / CLAUDE.md / portability doc 切分（M2）
14. CLAUDE.md 已在 Phase 0 復原——加一行「跨平台分發細節見 `references/multi-agent-portability.md`」。
15. 改寫 AGENTS.md 為 agents.md spec readme（依 spec 建議四節 + autopilot 自加 Build/Contribution，明寫此區分；Skeptic R1 §I2）。
16. 重寫 `references/multi-agent-portability.md` 事實版（依 §2 表，每聲明附 URL）。

### Phase 3 — OpenCode 結構（M3，spike-driven）
17. **Spike 0**（R3 Skeptic catch）：在 `.opencode/plugins/autopilot.ts` 內加 `console.error("[autopilot] __dirname:", typeof __dirname, __dirname)`，跑 OpenCode 看實際值。若 `undefined` → 改用 `import.meta.url + fileURLToPath`。
18. **Spike 1**（R1 Skeptic §C1）：tmp 環境驗 `{file:../../agents/_bodies/reviewer.body.md}` 跨層解析。
19. **Spike 2**（R1 Architect §C2、R2 升優先級）：tmp 環境驗 OpenCode 是否真會掃 `.agents/skills/`。Spike 結果寫進 plan 附錄 §A.X。
20. **退路（R3 Architect catch sync 矛盾）**：
    - Spike 1 失敗 → `sync-agent-bodies.sh` 擴 dst 寫**兩份**（`agents/_bodies/` + `.opencode/agents/_bodies/`），pre-commit `--check` 同時驗兩份。
    - Spike 2 失敗 → 恢復 `.opencode/skills/<name>` symlink → `../../skills/<name>`。
    - **無論 Spike 結果，Phase 4 step 25 `.agents/skills/` symlink 仍照做**——對 Codex/Antigravity 有效。
20. 加 `scripts/sync-agent-bodies.sh`（R2 Architect catch）：parser 從 `agents/<role>.md` 剝 YAML frontmatter、output body 到 `agents/_bodies/<role>.body.md`。加入 pre-commit 強制執行。
21. 修 `.opencode/opencode.json`：移除 `skills` 鍵、移除 `plugin` 鍵（本地路徑非合法值）、保留 `agent.*` 與 `instructions`；agent.prompt 改 `{file:../../agents/_bodies/<role>.body.md}`。
22. 加 `.opencode/package.json`（Ops R1 §I1）：宣告 `@opencode-ai/plugin` peer dep；README 加 `cd .opencode && npm install`（或確認 OpenCode runtime 自帶 type）。
23. `.opencode/plugins/autopilot.ts`：補 circuit breaker / disable flag / stale clear。**`getPluginVersion` 改 `__dirname` 2-level climb**（R3 Architect catch：既有 code 3-level 算術錯、一直 silent return `'unknown'`）。Acceptance：dev 機跑必須回實際版本。Spike 0 若顯示 `__dirname` 在 Bun ESM 為 `undefined`，改用 `import.meta.url + fileURLToPath`。
24. 把 `.opencode/skills/*` 整個目錄移除（OpenCode 改走 `.agents/skills/`，前提 Spike 2 成功）。

### Phase 4 — Codex + Antigravity skill 共享（M4）
25. 加 `.agents/skills/` symlink → `../skills/`（`ln -s ../skills .agents/skills`）；確認 git 以 symlink 形式 commit；audit `.gitattributes` 無 symlink 干擾條目（Skeptic R2）。
26. 加 `scripts/setup-symlinks.{sh,ps1}`（pseudocode 見 §3.8）；`scripts/dev-setup.sh` 在 **L54 之後**（所有 validate 區塊結束）、**L56 之前**（marketplace 註冊）插入呼叫 `"$REPO_DIR"/scripts/setup-symlinks.sh`。R3 Ops catch：原寫法「validate-tools 後」在 dev-setup.sh 找不到對應字串。
27. 加 `scripts/install-antigravity.{sh,ps1}`（pseudocode 見 §3.8）。Script header 標註 `# verified-against: codelabs walkthrough 2026-05-22`。
28. 加 `platforms/codex/config.toml.example`。
29. 更新 README 安裝章——Windows 用戶導向 WSL 或明寫「Dev Mode + `git config --global core.symlinks=true`」。

### Phase 5 — Validation
30. 加 `scripts/preflight-portability.sh`：自動驗 §5 中可自動的條目（hooks smoke、sync-version --check、`readlink .agents/skills`、validate.sh、`sync-agent-bodies.sh --check`）。
31. 手動驗：Claude Code 重啟 → SessionStart 正常 → 工具操作後 intent-capture 寫檔。
32. 若機器有 OpenCode：跑一次 session 確認 skill list 出現、`opencode agents list` 看到 autopilot-reviewer、verify agent prompt body 不含 `name: reviewer` frontmatter 文字（R2 regression 防呆）。

---

## 5. 驗收標準

**自動驗收**（由 `scripts/preflight-portability.sh` 一次跑完，Ops §I3）：
- [ ] `CLAUDE_PLUGIN_ROOT=$(pwd) node hooks/intent-capture.js < /dev/null` 不 throw、`~/.autopilot/intent/*.json` 有寫入
- [ ] `node hooks/intent-capture.js < /dev/null`（無 env var）也不 throw、`getPluginVersion()` 回 `unknown`（對偶 case，Skeptic §I4）
- [ ] 從 symlink 路徑跑 `node /tmp/symlinked-intent.js` 仍能取得正確 version（Skeptic §C2）
- [ ] `bash hooks/session-start.sh` 在 `CLAUDE_PLUGIN_ROOT` 設定下輸出 `hookSpecificOutput`、未設定下輸出 `additional_context`
- [ ] `scripts/sync-version.js --check` exit 0（兩份 plugin.json + README badge 一致）
- [ ] `readlink .agents/skills` 回傳 `../skills`、`readlink -f .agents/skills` 落在 `skills/`
- [ ] `scripts/validate.sh` 通過所有 16 個 skill
- [ ] `references/multi-agent-portability.md` 內每個事實聲明對應的 URL 可達（Skeptic R2：用 `curl -fsL -o /dev/null -w '%{http_code}'` GET 而非 HEAD，因 codelabs/developers.openai.com 對 HEAD 回 405/403；接受 200/301/302）
- [ ] `scripts/sync-agent-bodies.sh --check` exit 0（_bodies/ 與 agents/<role>.md 同步、Architect R2 防 frontmatter 洩入）

**手動驗收**：
- [ ] Claude Code 重啟 → SessionStart 注入 context 正常、無 stderr warning
- [ ] 若機器有 OpenCode：`opencode` 跑起來、skill 列表含 autopilot 16 個、`opencode agents list` 顯示 autopilot-reviewer
- [ ] 若機器有 Codex（OpenAI）：codex 載入 `.agents/skills/` 內 autopilot skill
- [ ] `AGENTS.md` 內**沒有任何**未經 URL 佐證的 env var / CLI 命令 / 路徑（人工 grep）
- [ ] `CLAUDE.md` 與 `AGENTS.md` 無內容重複、各自定位明確（人工讀）

---

## 6. 風險與回退

| 風險 | 緩解 |
|---|---|
| `{file:../agents/reviewer.md}` 跨層解析 OpenCode 不支援 | Phase 3 Spike 1 先驗；失敗則退路：`agents/<role>.md` 副本進 `.opencode/agents/`（恢復原 `.opencode/agents/` 拷貝） |
| OpenCode 不掃 `.agents/skills/` | Phase 3 Spike 2 先驗；失敗則退路：恢復 `.opencode/skills/<name> → ../../skills/<name>` symlink |
| `.agents/skills/` symlink 在 Windows checkout 失效或變純文字檔 | 強制 `setup-symlinks.ps1` 為安裝必經、`dev-setup.sh` 自動跑、README 明寫 Windows 需 Dev Mode |
| `path.dirname(__dirname)` 在 symlink install 解析到 repo real path | 直接砍 fallback：env var 缺失就回 `unknown`、不嘗試物理推斷 |
| `@opencode-ai/plugin` 在 OpenCode runtime 找不到 | `.opencode/package.json` 宣告 peer dep + README 寫安裝命令；若 runtime 自帶則 noop |
| Antigravity global path `~/.gemini/antigravity/skills/` 漂移 | `install-antigravity.sh` 註明來源 + 加 `--dry-run` 預檢 |
| 復原 CLAUDE.md 與後續其他 commit 衝突 | Phase 0 拆 commit A/B/C，bisect 友善（Ops §I2） |

回退：每個 Phase 為獨立 commit。Phase 0/0.5/1 可作為 hot-fix 立刻 ship，Phase 2-5 後續批次。

---

## 7. Out of Scope（明確不做）

- 不寫 Antigravity hook adapter（spec 不穩、需求未驗證）
- 不抽象「universal hook layer」（Survey §F 結論：hooks 是真正的不可攜部分）
- 不引入 `compatibility:` field 自動分發（沒有平台真的解析它）
- 不發 npm package / `npm pack` 分發（symlink → tarball 行為未驗，留作 v2.8 評估；Skeptic OQ）
- 不寫 Windows native（無 WSL / 無 Dev Mode）的 symlink fallback 方案（targets `.txt` 文字檔解析）——導向 WSL 或開 Dev Mode
- 不把 `plugin.json` 設成 `.claude-plugin/plugin.json` 的 symlink（潛在 `npm pack` tarball 行為問題；改用 sync-version.js 解，Skeptic OQ）

---

## 8. 已拍板決策（2026-05-22）

1. **OpenCode 路徑沿用 `.opencode/`**（不搬 `platforms/opencode/`）。
2. **Antigravity 範圍**：只做 skill 共享 + `scripts/install-antigravity.sh`（symlink 自動化）；**不寫** `gemini-extension.json`、不寫 hook adapter。
3. **採 dialectic review**（Architect / Ops / Skeptic 三方）後再進 dev-flow Phase 0——本次 review 已收斂於 §9。

## 9. R1 Review 收斂記錄（2026-05-22）

三方 reviewer 一致 `APPROVE_WITH_CHANGES`。Critical findings 全部納入：

| Finding | 來源 | 落點 |
|---|---|---|
| `{file:...}` 解相對 config 檔目錄、`./agents/...` 從 `.opencode/opencode.json` 解到 `.opencode/agents/`、需 `../` 跨層 + Spike 驗證 | Skeptic §C1 | §3.4 + Phase 3 step 16 |
| `.opencode/skills/<name>` symlink 多餘（OpenCode 已掃 `.agents/skills/`） | Skeptic §I1 + Architect §C2 | §3.1 簡化、Phase 3 step 17 Spike 2 |
| `sync-version.js` 沒涵蓋根 `plugin.json`、需 pre-commit 強制 | Ops §C1 | §3.7 升為 Phase 0.5 |
| 4 個 dangling reference symlinks 目前就壞 | Ops §C4 | Phase 0 Commit C 立刻 rm |
| Windows symlink 變純文字 比 missing 還糟 | Ops §C3 | Phase 4 step 24 `setup-symlinks.{sh,ps1}` 列為安裝必經 |
| `path.dirname(__dirname)` 在 symlink install 不對 | Ops §C2 + Skeptic §C2 | §3.3 砍 fallback、Phase 1 加 symlink smoke test |
| `agents/_bodies/` over-engineering（既有 agents/<role>.md 已是純 body） | Architect §I1 | §3.1 + §3.2 移除 `_bodies/` |
| `.opencode/plugins/autopilot.ts` 用 `__dirname` 3-level climb 不可靠 | Architect §C3 | §3.3 + Phase 3 step 21 改用 context.directory |
| `@opencode-ai/plugin` 依賴未交代 | Ops §I1 | Phase 3 step 20 加 `.opencode/package.json` |
| Phase 0 不 revert 但拆 commit | Ops §I2 | Phase 0 拆 A/B/C |
| §5 混 manual + automatable | Ops §I3 + Architect §I3 + Skeptic | §5 拆兩段；Phase 5 step 28 加 `preflight-portability.sh` |
| Out of Scope 與 Phase 4 install 指南矛盾 | Ops §I4 | §3.5 升 INSTALL.md 為 `install-antigravity.sh` |
| AGENTS.md 章節是 plan 自己拍 | Skeptic §I2 | §3.6 明寫「依 spec 建議 + autopilot 自加」 |
| §3.7 pre-commit / CI 模糊 | Skeptic §I3 | §3.7 明指 git-native `.githooks/pre-commit` |
| 驗收 `getPluginVersion` 缺對偶 case | Skeptic §I4 | §5 自動驗收第 2 條 |
| Architect §C1: hooks.json SessionStart audit | Architect §C1 | Phase 1 step 11 加 audit |
| Antigravity global path 為 walkthrough 來源、非 stable spec | Skeptic §C3 | §3.5 + script 內註腳 |

未納入的 Skeptic R1 OQ（升到 §7 Out of Scope）：npm pack symlink 行為、`plugin.json` 是否 symlink 化、6 個月後 OpenCode schema 收緊——皆暫不解。

## 10. R2 Review 收斂記錄（2026-05-22）

R2 三方一致 `NEEDS_R3`——R1 修正過程中**自身引入 3 個 critical bug**：

| R2 Finding | 來源 | R3 落點 |
|---|---|---|
| Plan §3.1 line 58 自稱「agents/<role>.md 已是純 markdown body」**事實錯誤**：實檢 reviewer/debugger/planner.md 均含 `name/tools/model` YAML frontmatter；`{file:..}` inline 後 frontmatter 會洩入 OpenCode prompt body | Architect R2 §I1 | §3.1 恢復 `_bodies/`；§3.2 加列；Phase 3 step 20 加 `sync-agent-bodies.sh` |
| R1 §3.3 改用 OpenCode `directory` 參數讀 `plugin.json` 是**新引入未驗證假設**：OpenCode `directory = 使用者 cwd`，**不是** plugin install dir | Skeptic R2 §C1 | §3.3 改為「保留既有 `__dirname` 3-level climb」（其實 R1 不該動它） |
| Phase 0 Commit C `rm` 改為**條件式**：`[ -L ] && [ ! -e ]` 雙重檢查確認 symlink 確實 dangling 才 rm；防 Phase 3 已先跑時誤刪 | Architect R2 regression | Phase 0 Commit C 改條件式 |
| Phase 0.5 step 7/8 順序錯：先裝 pre-commit hook 會 block step 8 自己的 sync commit | Skeptic R2 §I1 | Phase 0.5 重排：step 8 (sync drift) → step 9 (install hook) |
| `--check` source-of-truth 未定義 | Ops R2 §C2 | §3.7 明寫 canonical = `.claude-plugin/plugin.json`；mirror = 根 `plugin.json` |
| Spike 1/2 安排在 Phase 3 但 §3.5 共用設計依賴它們 | Architect R2 §C2 | Phase 3 step 19 加「Spike 失敗時 Phase 4 step 25 `.agents/skills/` 仍照做」 |
| `setup-symlinks.{sh,ps1}` / `install-antigravity.{sh,ps1}` 4 個 script 無 pseudocode | Ops R2 §C3 | 新增 §3.8 收錄 pseudocode |
| `git config core.symlinks` 是 local、不影響其他 clone 者 | Skeptic R2 §M2 | Phase 4 step 29 README 寫「Windows clone **前**需 `git config --global`」 |
| §5 `curl -I` 在 codelabs/openai docs 站會 false-negative | Skeptic R2 §M1 | §5 自動驗收第 8 條改用 `curl -fsL -o /dev/null` |
| working tree 已有 modified `hooks/hooks.json` / `dev-setup.sh` / `risk-counter.sh` 干擾 Phase 0.5 sync | Ops R2 §5 | Phase 0 step 2 新增 working-tree drift 預檢 |
| `.gitattributes` 是否與 symlink 衝突未確認 | Skeptic R2 | Phase 4 step 25 加 audit |
| install-antigravity 自身 6 個月後 drift | Skeptic R2 | §3.8 pseudocode 加 `# verified-against:` header |
| Phase 1 step 12 hooks.json audit 缺驗收條件 | Architect R2 §C1 | §3.3 末段補「acceptance：所有 hook 用 `${CLAUDE_PLUGIN_ROOT}` 前綴」 |
| dev-setup.sh 自動跑 setup-symlinks 的插入位置不明 | Ops R2 §5 | Phase 4 step 26 明寫「validate-tools 後、CLAUDE_DIR 操作前」 |

R2 真正搞錯的 finding（不採納）：
- **Ops R2 §C4 反翻案「4 symlinks target 存在」**：實地驗證 `target exists: NO` × 4，Ops R1 原 finding 正確。R2 數錯 `../` 層數（`.opencode/skills/X/references/` → `../../../` 只到 `.opencode/`、需 `../../../../` 才到 repo root）。Phase 0 Commit C 維持 rm（加條件式防呆）。

---

## 11. R3 Review 收斂記錄與 R4 處置（2026-05-25）

R3 三方一致 `NEEDS_R4`——R3 修正過程**意外封凍既有 latent bug**。R4 處置原則：**Spike-driven**——OpenCode/Bun runtime 行為等「文件未寫只能實機驗」的事推到 Phase 3 Spike 階段解，plan 不再多嘗試靜態斷言。

| R3 Finding | 來源 | R4 落點 |
|---|---|---|
| `.opencode/plugins/autopilot.ts:27` `__dirname` 3-level climb 算術錯，落 repo parent，一直 silent return `'unknown'` | Architect R3 | §3.3 改 2-level、加 acceptance；Phase 3 step 23 反映 |
| `__dirname` 在 Bun ESM 行為未驗證（OpenCode docs 未寫） | Skeptic R3 | Phase 3 加 **Spike 0** 實機驗證；fallback `import.meta.url + fileURLToPath` |
| `sync-agent-bodies.sh` awk 邏輯實測壞（body 內 `---` / 無 frontmatter / 緊鄰空行 3 case） | Architect + Ops + Skeptic | §3.8 改顯式 state machine + malformed-source guard |
| Phase 4 step 26 anchor「validate-tools 後」在 dev-setup.sh 不存在 | Ops R3 | 改寫精準 anchor「L54 之後、L56 之前」 |
| `install-antigravity.ps1` 完全缺 pseudocode | Ops R3 | §3.8 補骨架 + Dev Mode catch |
| `setup-symlinks.ps1` 缺 Dev Mode 偵測 | Ops R3 | §3.8 補 `UnauthorizedAccessException` catch |
| `install-hooks.sh` 缺 pseudocode | Ops R3 | §3.8 補 |
| `sync-version.js` 既有 editPlan 把 canonical 當寫入對象、與 R3 §3.7 read-only 語義衝突 | Ops R3 | §3.8 末段明寫 Phase 0.5 為**重構**而非擴展 |
| pre-commit auto-stage vs check-only 未定 | Skeptic + Ops | §3.8 明寫 check-only + 3-step UX |
| Phase 3 step 19 Spike 1 退路與 §3.1 single-source 矛盾 | Architect R3 | Phase 3 step 20 改：退路時 sync script 寫兩份 |

R3 揭發但**推到 Spike 階段現場解**（不在 plan 靜態解）：
- Windows symlink 雞生蛋（Skeptic R3）：Phase 5 preflight 加偵測純文字 stub
- 根 `plugin.json` mirror 給誰看（Skeptic R3）：Phase 0.5 重構 sync-version.js 時順便標註「npm/GitHub metadata only」
- §5 URL ping 對負向聲明無效（Skeptic R3）：Phase 5 preflight 只 ping 正向聲明
- `.gitattributes` 對 symlink 干擾（Skeptic R3）：Phase 4 step 25 audit
- working-tree drift 處置 SOP（Ops R3）：Phase 0 step 2 進場時逐檔現場判斷

## 12. 進入 dev-flow 前的閘門

- [x] R1 / R2 / R3 三輪 critical / important findings 已落入 §9 / §10 / §11 對應段落
- [x] §3.3 OpenCode `getPluginVersion` 算術修正（R3 Architect catch）
- [x] §3.8 awk 改 state machine（三方 R3 共識）
- [x] Phase 4 step 26 anchor 精準到 dev-setup.sh 行號
- [x] `install-antigravity.ps1` / `setup-symlinks.ps1` Dev Mode catch / `install-hooks.sh` pseudocode 補齊
- [x] Pre-commit 策略：check-only
- [x] **使用者拍板（2026-05-25）：套用 R4 修正、進 Phase 0**

**Spike-driven 原則明文化**：Phase 3 Spike 0/1/2 為 plan 與現實對齊的閘門。任何 Spike 失敗 → §3.5 退路啟動 → 不阻斷 Phase 0/0.5/1/2/4 hot-fix + doc 路徑。
