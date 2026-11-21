# fleet 與 autopilot:誰管什麼

一句話:fleet 管「工單與看板」——任務、巡查、訊息、長工作的等待與取件,跨席位運作;autopilot 管「session 內」——hooks 把關、skills 方法論、決策卡、派工軌,在你這個席位內運作。

| 職責 | 歸屬 | 入口 |
|------|------|------|
| 工單（tasks） | fleet | `fleet task show <id>`、PM console 的任務清單 |
| 巡查 / 看板 | fleet | `fleet pm status`(每個 project 一行);stuck/overdue 就 `fleet pm <project> status` 往下查 |
| 訊息 | fleet | fleet 的 send / messaging(席位間通訊) |
| 長工作等待(watch)、上傳(upload)、取件(fetch) | fleet | `fleet watch`(完整參數與用法見 fleet plugin 的 `fleet-usage` skill) |
| session 內 gates(hooks) | autopilot | [hooks/README.md](../../hooks/README.md) |
| skills(方法論流程) | autopilot | [docs/guide/skills.md](skills.md) |
| 決策卡 | autopilot | `scripts/open-decision.js` |
| 派工軌(dispatch rails) | autopilot | `scripts/dispatch-hetero.sh` 等;選軌看 [references/hetero-dispatch.md](../../references/hetero-dispatch.md) |

## 遇到 X 去哪裡

- **不知道哪些工單在跑、誰卡住** → `fleet pm status`;哪個 project 顯示 stuck/overdue,就用 `fleet pm <project> status` 往下查(project 名稱,或 task id / 8 字以上前綴)。
- **工作超過 15 分鐘** → 背景起跑 + `fleet watch --pid <pid> --log <abs log> --task <fleet task id>`(session 內用 fleet MCP 的 `watch` tool,傳 pid、log 路徑與 task id),絕不 sleep、不輪詢。完整參數以 fleet plugin 的 `fleet-usage` skill 為準。
- **要傳訊息、下工單、取回產物** → fleet 的 messaging / upload / fetch,不是 autopilot。
- **派工被擋下** → 看下面的「派工被擋下時」。
- **要發決策卡 / 問 PM** → `scripts/open-decision.js`。
- **不知道該用哪個 skill** → [docs/guide/skills.md](skills.md) 的 31 個 skill 目錄。
- **機械活該派給哪個引擎 / 模型** → `scripts/resolve-dispatch.sh`(skill 文件不寫死 model / mode)。

## 派工被擋下時

PM console 席位派工時,`hooks/dispatch-model-guard.js` 對帶 `Engine:` 標頭的 subagent brief 做 Fleet-Task 硬阻擋;read-only brief(`Explore` / `Plan` / `web-fetch` / `claude-code-guide`)與 haiku 席位不查。三種擋下與修法(hook 原文):

| 擋下原因 | hook 原文 | 修法 |
|----------|-----------|------|
| brief 前 10 行缺 `Fleet-Task: <id>` | `PM Console 派工硬阻擋：此 subagent brief 帶有 Engine: 標頭，但前 10 行缺少 Fleet-Task: <26-char id> 綁定。請先開啟或挑選對應的 fleet 任務（使用 fleet task show <id> 確認狀態為 open），並將「Fleet-Task: <id>」加入 brief 前 10 行後再重新派工。` | 開或選一張 open 任務,把 `Fleet-Task: <id>` 寫進 brief 前 10 行再派。 |
| 查無此單(unknown id) | `PM Console 派工硬阻擋：查無此單 Fleet-Task: ${taskId}。PM 席位自己的 courier 沒有此任務；若任務開在其他 courier，請綁定此 courier 持有的 open 任務，並將「Fleet-Task: <id>」加入 brief 前 10 行後再重新派工。` | 任務開在別家 courier 時,改用此 courier 持有的 open 任務(`fleet task show <id>`)綁定。 |
| 任務已結束(closed) | `PM Console 派工硬阻擋：brief 中的 Fleet-Task: ${taskId} 已結束（closed: done/failed/cancelled）。請開啟或挑選進行中的 open 任務（使用 fleet task show ${taskId} 確認），並將新的「Fleet-Task: <id>」加入 brief 前 10 行後再重新派工。` | 開新任務(或選一張進行中的 open 任務),換新 id 再派。 |

`${taskId}` 是訊息裡的任務 id 佔位。fleet 不可用時 fail-open 放行,並在 stderr 記一行 `dispatch-model-guard: fleet task <id> check unavailable — allowing (fail-open)`。
