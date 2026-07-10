# Spike — pi RPC as the Stage-2 duplex channel（2026-07-11, VERIFIED live）

> Question: pi（earendil-works/pi-mono coding agent）的 RPC mode 是否給得出 Stage 2 要的**雙工**——對進行中的 worker 中途注入、即時砍除、逐訊息 token/cache 遙測？
> Answer: **是,三項全數 live 驗證**（MiniMax-M3 經 autopilot endpoints 供電;Anthropic quota 零消耗）。

## Setup（可重現）

- `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` → pi **0.80.6**。
- `~/.pi/agent/models.json` custom provider:`api:"anthropic-messages"` + `baseUrl` = MiniMax endpoint + **`"apiKey": "$AUTOPILOT_ENDPOINT_MINIMAX_TOKEN"`**——env-var 參照,**token 零落盤**;跑之前 `load-endpoints-env.sh` 填充即可。同法可接 GLM/任何 compatible endpoint。
- Print-mode 煙測:`pi --provider minimax --model MiniMax-M3 --no-session -p "…"` → 正確回 marker、rc 0、**honors cwd**。

## Verified（live transcripts: scratchpad `pi-spike/rpc-{a,b}.jsonl`）

| 能力 | 證據 |
|------|------|
| **steer 中途注入** | 任務=六次分開的 `sleep 2` tool call。第 2 次 tool call 開始後送 `{"type":"steer","message":…}` → `queue_update`（steering 佇列可見）→ `{"command":"steer","success":true}` ack → tool call 完成後以 user message 注入 → 模型回 `INJECTED_ACK` 停止,**後四次 tool call 未執行**。全程 7.8s。遞送語意如文件所述:tool-call 邊界、下次 LLM call 前 |
| **abort 即停** | 同任務,第 2 次 tool call 進行中送 `{"type":"abort"}` → **8ms 後 `agent_end`** |
| **逐訊息 usage** | 每個 `message_end` 帶 `usage: {input, output, cacheRead, cacheWrite, totalTokens, cost{…}, cacheWrite1h}`——**cache 命中即時可觀測**（實測 cacheRead 1664/1792,MiniMax 供應商側 cache 生效）。cost 為 0 是因 models.json 未填 cost 表,欄位機制本身工作 |
| **typed 事件流** | LF-JSONL:`agent_start/end`、`turn_start/end`、`message_start/update(text_delta)/end`、`tool_execution_start/update/end`、`queue_update`——vendor CLI 給不出的全套即時面 |
| **session 自有** | `--session-dir` 生效;JSONL tree（`id`/`parentId`）、記錄 cwd/model_change。`--no-session` 可關 |
| **follow_up / streamingBehavior** | 文件有（`{"type":"follow_up"}`、prompt 帶 `"streamingBehavior":"steer\|followUp"`）,本 spike 未逐一驗——列入殘餘 |

## 對 Stage 2/3 的含意

- 對照現有四個 runner:一發式（codex exec/agy -p/grok）**物理上**做不到這三件事;pi RPC 一次補齊「監察+協調+溝通」的溝通層,且 usage 遙測比 codex chrome 尾註（Stage 1 的 tail-anchor 苦工）**乾淨一個世代**——harness-authoritative typed 欄位,不用從合併文字流裡防注入地刮。
- **信任姿態不變**:pi 無 permission popup、tools 預設全開 → worktree 隔離 + wrapper-commit + artifact 驗證的既有軌**原樣沿用**;RPC 只是把「等 timeout」換成「可觀測、可打斷」。
- 整合草圖（未做,BACKLOG Stage-2 條目）:`dispatch-hetero.sh --runner pi`,supervisor 持 RPC stdio;manifest 增 duplex 通道資訊;stall 偵測從 report-only 升級成「steer 探詢 → 無回應才砍」。

## 殘餘（未驗,勿宣稱）

- follow_up / `streamingBehavior:"steer"`（純文字長訊息中途注入——無 tool 邊界時的遞送語意）未逐一驗。
- skills 在 RPC/print mode 是否載入未測（另一 spike;agy 的教訓:別假設）。
- 長跑穩定性、OpenAI/訂閱 auth 供應商、`compat` 旗標對各 endpoint 的必要性未測。
- 模型服從 steer 是行為層,依模型而異;協議層（排隊+注入）才是本 spike 的保證。
