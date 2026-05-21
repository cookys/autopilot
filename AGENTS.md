# autopilot — Universal Agent Orchestration Plugin

## 專案目標
提供 Standalone-capable 的 AI Agent 生命週期編排與方法論框架。內含 16 個 Skills、3 個 Methodology Agents 以及 25 個 Hooks。支援 **Claude Code**、**OpenCode/Codex** 與 **Gemini/Antigravity CLI (`agy`)**。

---

## 🛠️ 跨平台相容開發規範 (Cross-Platform Compatibility Rules)

為了確保 autopilot 在多種 AI 開發代理人環境中皆能原生且無摩擦地安裝與執行，所有在此專案工作的 AI 代理人必須嚴格遵守以下開發鐵律：

### 1. 雙描述檔同步更新 (Manifest Sync)
專案內有兩份 `plugin.json`：
- **Claude Code 專用**：`.claude-plugin/plugin.json`
- **Antigravity / Codex 專用**：根目錄 `plugin.json` (必備，用於 `agy plugin validate` 驗證)
* **規則**：當更新版本號、描述或依賴時，**必須同時修改此兩份檔案**，保持內容完全一致。

### 2. 多環境路徑 Fallback 機制 (Hook Path Resolution)
- **背景**：不同 Agent 執行 Hook 時會注入不同的外掛根目錄變數。
- **規則**：**嚴禁**在 Hook 程式碼（Node.js / Shell）中只讀取 `CLAUDE_PLUGIN_ROOT`。所有解析路徑的邏輯必須導入以下 Fallback 鏈路：
  * **Node.js**:
    `const pkgRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.CODEX_PLUGIN_ROOT || process.env.AGY_PLUGIN_ROOT || process.env.GEMINI_PLUGIN_ROOT || path.dirname(__dirname);`
  * **Shell**:
    `if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || [ -n "${CODEX_PLUGIN_ROOT:-}" ] || [ -n "${AGY_PLUGIN_ROOT:-}" ] || [ -n "${GEMINI_PLUGIN_ROOT:-}" ];`
- **`hooks.json` 定義**：在描述檔中，維持使用 `${CLAUDE_PLUGIN_ROOT}` 作為預設路徑變數（因為各平台的轉換層會主動搜尋並取代此字樣）。

### 3. 校驗與測試 (Validation Gate)
在修改任何描述檔、外掛勾子或 Skill 之後，必須在終端執行：
```bash
agy plugin validate .
```
必須確保輸出 `[ok]` 且所有 skills, agents, hooks 被 100% 正確解析，無任何警告與錯誤。

---

## 📁 關鍵路徑 (Key Paths)

- `skills/` — 外掛技能（YAML Frontmatter + Markdown）
- `agents/` — 方法論 Agents 定義
- `hooks/` — 生命週期 Hook 腳本與 `hooks.json`
- `references/` — 跨 Agent 相容性文檔與指令規範
- `references/multi-agent-portability.md` — 跨 Agent 設計對比與遷移細則
