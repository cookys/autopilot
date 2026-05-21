# Multi-Agent Coding Assistant Skill Portability

本文件探討如何讓 autopilot 的 skill/agent 系統同時支援多個 coding agent（Claude Code、OpenCode/Codex、Gemini/Antigravity CLI `agy`）。

---

## 🗺️ 已知 Agent 系統架構對比

| 維度 | Claude Code | OpenCode / Codex | Gemini / Antigravity (`agy`) |
|------|-------------|------------------|-----------------------------|
| **Plugin 註冊描述檔** | `.claude-plugin/plugin.json` | 根目錄 `plugin.json` | 根目錄 `plugin.json` (必備，且支援 `/plugin validate` 校驗) |
| **Skills 格式** | `skills/*/SKILL.md` | `skills/*/SKILL.md` | `skills/*/SKILL.md` (相容 Markdown frontmatter) |
| **Skill 自動發現** | `.claude/skills/` + `skills/` | `.agents/skills/` + `skills/` | `~/.gemini/antigravity-cli/plugins/` |
| **Hooks 系統描述檔** | `hooks/hooks.json` | `hooks.json` | `hooks.json` 或 `hooks/hooks.json` |
| **Hook Event 類型** | SessionStart, PreCompact, PostToolUse, Stop | SessionStart, PreCompact, PostToolUse, Stop | SessionStart, PreCompact, PostToolUse, PreToolUse |
| **環境變數注入** | `CLAUDE_PLUGIN_ROOT` | `CODEX_PLUGIN_ROOT`, `AGENT_PLUGIN_ROOT` | `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT` |

---

## 1. 核心發現：Skill Format 是通用標準

Skill 的 YAML frontmatter + Markdown body 格式在各個 Agent 平台之間已經近乎通用：

```yaml
---
name: skill-name
description: >
  One sentence covering what this skill does AND when to trigger it.
  Use when: "trigger phrase 1", "trigger phrase 2"
  Not for: adjacent use cases
compatibility: claude-code codex gemini
---

# Skill Name
...
```

**規範細節**：
- `name` 格式：均為 lowercase hyphen-separated，長度限制相似。
- `description`：均要求 1-1024 字符，會出現在 Agent 決策時的 available_skills 清單中。
- `compatibility`：在 SKILL.md frontmatter 加入 `compatibility` 欄位，用以標注所支援的 agent。

---

## 2. Manifest (描述檔) 雙模相容性

由於 Claude Code 預設讀取 `.claude-plugin/plugin.json`，而 Antigravity (`agy`) 與 Codex 則要求根目錄必須存在 `plugin.json`：
* **開發規範**：任何對描述檔的修改，**必須同時同步更新根目錄 `plugin.json` 與 `.claude-plugin/plugin.json`**，否則會導致其他 Agent 驗證（如 `agy plugin validate`）失敗。

---

## 3. Hook/Plugin 系統相容性與環境變數

雖然各 Agent 平台在 Hooks 事件命名上高度一致（例如 `SessionStart`、`PreCompact`），但在背景執行腳本時注入的「外掛根路徑」環境變數不同。

### 絕對路徑解析規範
不要在 JS 腳本中寫死 `process.env.CLAUDE_PLUGIN_ROOT`。開發 Hook 腳本時，必須採用**多 Agent 變數鍊與物理路徑 fallback 降級機制**：

**JavaScript / Node.js 範例**：
```javascript
const path = require('path');
const pkgRoot = process.env.CLAUDE_PLUGIN_ROOT 
             || process.env.CODEX_PLUGIN_ROOT 
             || process.env.AGY_PLUGIN_ROOT 
             || process.env.GEMINI_PLUGIN_ROOT 
             || path.dirname(__dirname); // fallback 到本機執行腳本的父目錄
```

**Bash 範例**：
```bash
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || [ -n "${CODEX_PLUGIN_ROOT:-}" ] || [ -n "${AGY_PLUGIN_ROOT:-}" ] || [ -n "${GEMINI_PLUGIN_ROOT:-}" ]; then
  # 支援 Context Injection
else
  # 降級輸出
fi
```

**`hooks.json` 指令格式**：
在 `hooks.json` 的 `"command"` 定義中，由於相容性轉換層（如 `agy` 載入 Claude 外掛時）會主動尋找並替換 `${CLAUDE_PLUGIN_ROOT}` 關鍵字，因此**依然保留 `${CLAUDE_PLUGIN_ROOT}` 字樣**以配合其相容轉換，但底層執行腳本必須落實上述的多變數 Fallback 機制。

---

## 4. 遷移與開發檢查清單

當在 autopilot 中開發新功能或更新 Hooks 時，請確保：
- [ ] 根目錄的 `plugin.json` 與 `.claude-plugin/plugin.json` 的版本號與內容保持同步。
- [ ] 所有的 Hook 腳本（JS / Shell）均已導入「多 Agent 變數鍊與物理路徑 fallback」。
- [ ] 檢驗指令 `agy plugin validate <path_to_autopilot>` 可成功通過，無錯誤警告。
