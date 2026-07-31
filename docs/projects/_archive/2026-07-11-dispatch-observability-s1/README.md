# Dispatch Observability — Stage 1（失聯歸零）

> Status: SHIPPED v2.32.20（2026-07-11, inline depth-0 execution）
> Origin: Board 方向討論 2026-07-11 — 「hetero engine 一派發下去就失聯，需要更好的監察、協調、溝通機制」。三階段路線的第一階段（監察）；Stage 2（pi RPC 雙工溝通）已於 v2.32.21 出貨，Stage 3（自適應調度 policy）保留在 `docs/BACKLOG.md` 的 R6 協調條目。
> Six-element task: docs/BACKLOG.md「Dispatch observability Stage 1」條目（本專案為其執行紀錄）。

## Problem

hetero dispatch 是 fire-and-forget：run 的身分證（`$LOG` 路徑、worktree、cgroup unit）只在 final JSON 才吐出，depth-0 派發後無法定位、監看、判活該 run——只能等 timeout 或 exit。關鍵事實：worker 事件流**已經即時落盤**（`run_worker … >"$LOG" 2>&1`），缺的是 start-time manifest、解析器、判活面。

## Shipped

1. **Run manifest**（`dispatch-hetero.sh` + `dispatch-review.sh`）：起跑即寫 `${TMPDIR}/autopilot-dispatch-runs/<run-id>.manifest.json`（run_id、活流 log 路徑、worktree、lock、預測 containment、pid）＋ stderr 宣告；每條退出路徑 finalize（`ended_at`/`final_status`）；detach 子行程改寫 pid。逃生口 `AUTOPILOT_DISPATCH_MANIFEST=0`。
2. **`scripts/dispatch-status.js`**：`--run <id>` 一行 JSON（phase/alive/liveness{lock,pid,scope}/last_event_age_s/events/tool_calls/tokens/files_touched/stall）。判活主訊號 = worktree 生命鎖的 flock 探測（與 `_wt_is_live` 同契約、detach-safe）。log 解析自動偵測 codex-chrome（`tokens used` 尾註，v0.144.0 真實捕流 fixture）/ 通用 JSONL / plain；無訊號格式誠實回 `null`。stall = alive 且 log mtime 超過 `--stall-secs`（report-only，Stage 1 不自動砍）。
3. **成本遙測入 ledger**：hetero final JSON 增列 additive `run_id`/`usage`/`wall_secs` → engine `dispatch_implementation` ledger entry 透傳——第一筆 per-dispatch 成本數據（Stage 3 調度 policy 的地基）。

## Deviations（記錄性）

- **review final JSON 不動**（BACKLOG scope 原文寫兩個 dispatcher 的 final JSON 都加欄位）：`review-result` 是 `additionalProperties:false` 嚴格契約（v2.32.19 SSOT 剛硬化，`src/runners/review.js` 對 unknown field throw、7 個發射點）；manifest 已給 review 可觀測性，usage 可由 `raw_log` + `--usage-only` 事後導出。加欄位的爆炸半徑（validator + schema + anthropic JS 發射器 + mirror）與收益不成比。
- 順手修一條 PRE_EXISTING（develop 基準驗證）：`codex-plugin-package.test.sh` sandbox fixture 缺 `schemas/`（v2.32.19 加 payload 時漏更新）。

## Review loop（decorrelated, 3 families）

| Round | Engine | Verdict | Disposition |
|-------|--------|---------|-------------|
| R1 | codex/gpt-5.5 xhigh | FIX-THEN-SHIP (2) | 兩條皆實：① review manifest `final_status` 恆 null → cleanup trap 以 exit code（腳本的權威狀態契約 0/1/2）映射；② flock `free` 時 pid/scope 仍可判活 → 違反 `_wt_is_live` 契約（worker 繼承 lock fd,`free` = 權威死亡,pid alive = pid 重用），改 free 權威否決 |
| R2 | codex/gpt-5.5 xhigh | FIX-THEN-SHIP (1) | 實：JSONL 內容嗅探會把 model 印的 JSON 行當 telemetry（self-report 洩漏）→ 格式改 dispatcher 宣告（manifest `log_format` + `--format`），嗅探降級 ad-hoc 診斷 |
| R3 | codex/gpt-5.5 xhigh | FIX-THEN-SHIP (1) | 實：`tokens used` 全文掃描 + last-wins 可被 worker 在 exec 輸出注入（中途輪詢/中止 run）→ 尾錨定 footer + emit 端 `AGENT_EXIT==0` 閘（clean exit ⇒ 真 footer 必佔尾位） |
| R4 | MiniMax-M3（codex quota 枯竭換家族,fail-closed 正確擋下 partial output） | FIX-THEN-SHIP (9) | 逐條查證：8 駁回（`-n` guard 已在、`is-active` exit-0 即 active、detach 路徑 LEDGER 必非空、4 條要求的註解/行為已存在、run_id-in-precondition 是刻意關聯設計）；1 Minor 採納（usage 子 schema `additionalProperties:false`——文件化 parser 閉合建構的事實） |
| R4b | agy/Gemini 3.5 Flash (High) | **SHIP-AS-IS** (none) | 第三家族確認輪 |

收斂依據：驗證後未決 finding 集 = 空（converge by verification, not verdict string）。

## Verification

- `hooks/tests/dispatch-status.test.sh` 52 assertions，含載重驗收：**mid-run `alive:true`**（dispatch 背景執行中 manifest 可發現＋判活）、stall 偵測、review 契約位元組不變 guard、逃生口。
- 全套件 120/120 綠（前景跑）；codex token 解析對真實捕流 empirical 驗證（7,420 tokens、1 exec tool call）。
- 信任邊界不變：telemetry 全部源自 harness 事件流／kernel 鎖／cgroup／git artifacts，無任何 worker 自報通道；無 verdict 語意變更。
