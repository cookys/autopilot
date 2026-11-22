# 各 harness 的 fleet 用法知識來源

背景：harness 更新可能覆寫 operator 本機設定，但 repo 內 skills / AGENTS.md / 派工 brief 應讓每條線仍知道：用 **fleet watch**（不要 sleep 輪詢）、**upload / fetch** 傳大內容、**task_result** 交工單證據。本表盤點九種 harness；共享正文見 [`skills/fleet-usage/SKILL.md`](../../skills/fleet-usage/SKILL.md)（與 fleet plugin 同源，repo 內為非 Claude 座席與派工 brief 的錨點）。

| harness | 來源 | 更新後保留 | 缺口 |
|---------|------|------------|------|
| Claude Code | fleet plugin `fleet-usage` skill（SessionStart / MCP）；autopilot `docs/guide/fleet-and-autopilot.md`、`dev-flow` / `lead-watch`；hooks `foreman-guard` / `depth0-delegate-gate` | fleet plugin 隨 operator 安裝/更新；autopilot plugin 的 skills 隨 repo pin | 曾只靠 fleet plugin，repo 未自帶副本；已補 `skills/fleet-usage` |
| codex | 根 `AGENTS.md`；`platforms/codex/plugin/skills/*`（`sync-codex-plugin-skills.sh` 鏡像）；派工 brief + `references/multi-agent-portability.md` §8 | mirror 由 repo 再生，codex `plugin add` 會刷新套件 | 無 SessionStart 注入；須讀 `AGENTS.md` 或 brief 內指到 `skills/fleet-usage` |
| agy | 同 Claude Code plugin 匯入（`agy plugin install`）；根 `AGENTS.md` | `agy plugin install` 重讀 repo skills/hooks | instruction-tier：`-p` 不載 skill，fleet 知識須在 brief 正文或 `skills/fleet-usage` 指標 |
| grok | `dispatch-hetero.sh --runner grok` 派工 brief；`references/multi-agent-portability.md`；repo `scripts/lane-ops.sh` / `bg-quiet.sh` 註解 | repo-managed | 無獨立 skill 自動載入；依 brief + 共享 skill 路徑 |
| minimax | OpenCode / HTTP 座席（`opencode-containment`）；派工 brief | repo scripts + brief | 同 grok；無 harness 專用 fleet skill 目錄 |
| opencode | `.agents/skills` → `skills/`；`.opencode/` plugin；根 `AGENTS.md`（明訂不會自動下鑽子目錄） | symlink + plugin sync 在 repo | 無 Claude 式 SessionStart；須手動讀 `skills/fleet-usage` |
| cursor | `dispatch-hetero.sh --runner cursor` brief + broker；Cursor 規則在 operator / IDE 側 | repo brief 與 autopilot 文件 | 本 repo 無 Cursor 專用 fleet 設定檔；靠派工 brief 與本表 |
| qoder | `dispatch-hetero.sh --runner qoderclicn` brief；與 OpenCode 類似的顯式 runner | repo-managed brief | 同 cursor；CLI 不載 autopilot skills |
| GLM | OpenCode Go / zen 路由（`references/multi-agent-portability.md`）；派工 brief | repo 可攜表與 brief | 同 opencode 座席；無獨立 GLM fleet 文件 |

## 派工與維護

- 長等待、大附件、工單交件：一律以 [`skills/fleet-usage`](../../skills/fleet-usage/SKILL.md) 為準（`fleet watch`、`upload` / `fetch`、`task_result`）。
- 與 autopilot 分工：`docs/guide/fleet-and-autopilot.md`。
- 工單 rail 逐步：`references/multi-agent-portability.md`（Fleet work-order lanes）。
- 盤點腳本：`hooks/tests/fleet-usage-smoke.test.sh`（grep 斷言，無真實 fleet 呼叫）。