# Dispatch Observability — Stage 1（失聯歸零）

> Status: SHIPPED v2.32.20（2026-07-11, inline depth-0 execution）
> Origin: Board 方向討論 2026-07-11 — 「hetero engine 一派發下去就失聯，需要更好的監察、協調、溝通機制」。三階段路線的第一階段（監察）；Stage 2（pi RPC / cc-shim stream-json 雙工溝通）與 Stage 3（自適應調度 policy）留在 BACKLOG。
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

## Verification

- `hooks/tests/dispatch-status.test.sh` 52 assertions，含載重驗收：**mid-run `alive:true`**（dispatch 背景執行中 manifest 可發現＋判活）、stall 偵測、review 契約位元組不變 guard、逃生口。
- 全套件 120/120 綠（前景跑）；codex token 解析對真實捕流 empirical 驗證（7,420 tokens、1 exec tool call）。
- 信任邊界不變：telemetry 全部源自 harness 事件流／kernel 鎖／cgroup／git artifacts，無任何 worker 自報通道；無 verdict 語意變更。
