# Multi-Agent Coding Assistant Skill Portability

本文件探討如何讓 autopilot 的 skill/agent 系統同時支援多個 coding agent（Claude Code、OpenCode、Gemini CLI、Codex）。

## 已知 Agent 系統架構對比

| 維度 | Claude Code | OpenCode | Gemini CLI | Codex |
|------|-------------|----------|-----------|-------|
| **Plugin 註冊** | `.claude-plugin/plugin.json` | `opencode.json` 的 `plugin: [...]` | ? | ? |
| **Skills 格式** | `skills/*/SKILL.md` | `.opencode/skills/*/SKILL.md` | ? | ? |
| **Skill 自動發現** | `.claude/skills/` + `skills/` | `.opencode/skills/` + `.claude/skills/` + `.agents/skills/` | ? | ? |
| **Agents 格式** | `agents/*.md` | `.opencode/agents/*.md` | ? | ? |
| **Hooks 系統** | `hooks/hooks.json` + script files | `.opencode/plugins/*.ts` (event-based) | ? | ? |
| **Hook Event 表面** | PreToolUse, PostToolUse, PreCompact, SessionStart, Stop | `tool.execute.before`, `session.created`, `session.compacted` 等 | ? | ? |
| **外部擴展 Protocol** | MCP | MCP + Plugin API | ? | ? |

## 核心發現：Skill Format 是事實標準

Skill 的 YAML frontmatter + Markdown body 格式在 Claude Code 和 OpenCode 之间已经近乎通用：

```yaml
---
name: skill-name
description: >
  One sentence covering what this skill does AND when to trigger it.
  Use when: "trigger phrase 1", "trigger phrase 2"
  Not for: adjacent use cases
---

# Skill Name

## Section 1
...
```

**兩者差異**：
- `name` 格式：兩者都是 lowercase hyphen-separated，長度限制相似
- `description`：兩者都要求 1-1024 chars，會出現在 skill tool 的 available_skills 清單
- `compatibility` field：OpenCode 明確支援 `compatibility: opencode`；Claude Code 忽略未知 field

**建議**：在 SKILL.md frontmatter 加入 `compatibility` 欄位標注支援的 agent：

```yaml
---
name: dev-flow
description: ...
compatibility: claude-code opencode
---
```

## Agent 格式對比

### Claude Code Agent

```markdown
---
name: reviewer
description: Use when performing pre-commit review...
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch
model: opus
---

# Reviewer

You are the Reviewer for the autopilot plugin...
```

### OpenCode Agent

```markdown
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-6
permission:
  edit: deny
  bash: ask
---

You are in code review mode...
```

**關鍵差異**：

| 維度 | Claude Code | OpenCode |
|------|-------------|----------|
| `tools:` field | 有（工具白名單） | 無（由 permission 控制） |
| `mode:` field | 無 | primary/subagent/all |
| `permission:` field | 無 | 有（精細控制） |
| Agent 存放路徑 | `agents/` | `.opencode/agents/` |

## Hook/Plugin 系統不兼容

**這是遷移最大的障礙**。Claude Code 的 hook 系統（PreToolUse/PostToolUse/PreCompact/Stop/SessionStart）與 OpenCode 的 plugin event 系統（`tool.execute.before`/`session.created` 等）**沒有直接對應關係**。

### 遷移策略

#### 1. 純計算腳本（推薦）

如果 hook 的核心邏輯是**計算/檢查**，將其重寫為可被 skill 直接或通過 `!()` 語法呼叫的腳本。

```bash
# Claude Code hook: branch-protection.js
# 遷移策略：保留為 pure script，透過 skill 內的 `!()` 呼叫

#!/usr/bin/env node
const fs = require('fs');
const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
// ... logic
```

#### 2. Plugin 適配層

對於需要即時攔截的工具调用，透過 OpenCode Plugin API 包裝：

```ts
// .opencode/plugins/autopilot-branch-protection.ts
import type { Plugin } from "@opencode-ai/plugin"

export const BranchProtectionPlugin: Plugin = async (ctx) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash" && output.args.command?.match(/\bgit\b/)) {
        // ... protection logic
      }
    },
  }
}
```

#### 3. OpenCode 專用 Plugin 與 Claude Code 專用 Hook 並行

將不相容的 hooks 拆分為兩個實作：

```
autopilot/
  hooks/                    # Claude Code hooks (原目錄)
    hooks.json
    branch-protection.js
    ...
  .opencode/
    plugins/                # OpenCode plugins (新建)
      branch-protection.ts
      intent-capture.ts
    agents/
    skills/
```

## Skill Portability 分類

### 高可移植（直接複製）

- `skills/dev-flow/SKILL.md` — 純引導流程，無 agent/hook 依賴
- `skills/quality-pipeline/SKILL.md` — 流程定義，調用 reviewer agent 但本身無平台特定程式碼
- `skills/think-tank/SKILL.md` — 純對話流程
- `skills/think-tank-dialectic/SKILL.md` — 純對話流程

### 中等可移植（需小幅適配）

- `skills/finish-flow/SKILL.md` — 包含對 hooks 的引用，需改為條件引用
- `skills/ceo-agent/SKILL.md` — 包含對 scripts 的引用，部分 agent 特定指令

### 低可移植（需重寫）

- 所有 agent 定義（`agents/*.md`）— 工具聲明格式不同
- 所有 hook 腳本（`hooks/*.js`）— 架構完全不同

## 遷移檢查清單

當需要將 autopilot skill 遷移到 OpenCode 時：

- [ ] 確認 skill 主體（SKILL.md）無平台特定工具調用
- [ ] 將 agent 引用從 `autopilot:reviewer` 改為 `reviewer` 或 `.opencode/agents/reviewer.md`
- [ ] 將 hook 引用改為條件判斷（OpenCode 環境，跳過 hook 專用指令）
- [ ] 將 `!()` 嵌入式腳本改為明確的 Bash 調用
- [ ] 在 frontmatter 加入 `compatibility: claude-code opencode`
- [ ] 驗證 skill 在目標 agent 的 `skill` tool 中正確出現

## 討論：是否需要一個 `agent-abstraction` Skill？

選項：

1. **不做** — 手動維護兩套技能樹，靈活但維護成本高
2. **做一個 `cross-agent-runtime` skill** — 這個 skill 檢測當前運行環境，提供統一的抽象層。例如：
   - 檢測是 Claude Code 還是 OpenCode（環境變數、工具可得性）
   - 動態路由 agent 調用
   - 條件化 hook 行為

目前建議 **選項 1（不做）**，原因：
- 大多數 skill 已經是平台無關的 Markdown
- Agent 和 Hook 的差異是結構性而非功能性的
- 引入抽象層會增加複雜度和調試難度

如果未來有第三個 agent 需要支持，再考慮抽象層。

## 參考資料

- [OpenCode Skills Documentation](https://opencode.ai/docs/skills/)
- [OpenCode Agents Documentation](https://opencode.ai/docs/agents/)
- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/)
- [Claude Code Skills Documentation](https://docs.claude.com/en/skills)
- [Claude Code Hooks Documentation](https://docs.claude.com/en/hooks)
