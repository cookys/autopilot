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

## 殘餘 Stage-2 前置（2026-07-11 三項全數 LIVE 驗證，MiniMax-M3 供電）

三個殘餘 spike 於 Stage-2 動工前逐一 live 驗（drivers＋transcripts: scratchpad `pi-s2/spike{1,2,3}-*.jsonl`；設計經 agy/Gemini 3.5 Flash 授權，family≠implementer）：

| Spike | 結論 | 證據 |
|-------|------|------|
| **skills-in-RPC** | ✅ **VERIFIED-loaded**（RPC 模式） | `.agents/skills/<name>/SKILL.md`（Agent Skills 標準，frontmatter `name`/`description`）**auto-discovery**（cwd 向上；project-local 需 `-a`/`--approve` 信任）與**顯式 `--skill <path>`** 兩路皆令模型 echo 出 SKILL.md 內的不可猜 token。pi 原生 skill 面在 RPC 下工作——**Stage-2 之後可考慮把 autopilot skills 以 `--skill` 餵給 pi implementer**（不像 agy「skills 不載入」的負面結果） |
| **無 tool 邊界的 steer** | ✅ 語意釐清：**排隊、於 message/turn 邊界遞送**（非 mid-message 硬打斷） | 純文字 `--no-tools` 從 1 數到 100 的任務，第 8 個 text_delta 後送 steer：in-flight 訊息**完整跑完到 100**（`queue_update` 立即可見），`message_end`＋`turn_end` 後才起**新 turn** 回 `STEER_ACK`。→ steer 是**邊界遞送**協調機制，不是硬中斷；要硬停用 `abort`（8ms）。對 supervisor 的含意：stall 探詢 steer 不會打斷 in-flight message，但 stalled run 本就無 in-flight message，探詢語意正確 |
| **RPC 長跑穩定** | ✅ **STABLE** | 12 個分開的 `sleep 12` bash tool call，~164s（≈2.7min），事件流連續（177 events，最大 inter-event gap 12010ms＝sleep 本身，無斷線/hang），`tool_execution_start`＝`tool_execution_end`＝12，agent_end 乾淨。13 個 `message_end` 各帶 `usage`，**per-message 非累計**：sum(input)=4010、sum(output)=412、`cacheRead` 單調成長 512→2048（context 累積）；last `totalTokens`=2248（僅最後一則） |

**Stage-2 usage 解析結論（load-bearing）**：pi 的 `message_end.usage` 是**每則訊息**（非累計）且含**巢狀 `cost:{input,output,…}`**。因此
(a) 通用 jsonl parser 的「last-seen-wins」對 pi 會**低報**（只取最後一則）；
(b) 遞迴通用 scan 對 `input`/`output` 會被 `cost.input=0` **碰撞歸零**（會回噬 grok 的 jsonl 路徑）。
→ **Stage-2 為 pi 用專屬 declared format `pi-rpc`**（非通用 jsonl），parser 只讀 `message.usage` 頂層鍵並**跨訊息聚合**：input=Σinput、output=Σoutput、cache_read=ΣcacheRead、total=input+output（誠實計費口徑，與既有 jsonl 的 total 後備一致）；tool_calls 只數 `tool_execution_start`。宣告格式紀律不變（dispatcher 宣告，永不內容嗅探）。

## 仍未驗（勿宣稱）

- follow_up / `streamingBehavior:"steer"` 的其他組合、OpenAI/訂閱 auth 供應商、`compat` 旗標對各 endpoint 的必要性未測。
- 模型服從 steer 是行為層,依模型而異;協議層（排隊+邊界遞送）才是保證。
