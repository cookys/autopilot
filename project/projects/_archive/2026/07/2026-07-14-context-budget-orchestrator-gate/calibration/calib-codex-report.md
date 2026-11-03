# Codex 門檻校準回溯報告

回溯模擬：用歷史 Codex CLI rollout 記錄還原 context 成長軌跡，與 Claude 端門檻校準同構。

## 資料與方法

| 語料 | 路徑 | sessions |
|------|------|----------|
| A (twgs-dev) | `/home/twgs-dev/.codex/sessions/` | 254 |
| B (peace/cookys 複本) | `/home/twgs-dev/peace-transcripts/codex-sessions/` | 778 |

**每次 API call 的 context 大小** = `event_msg.token_count` → `info.last_token_usage.input_tokens`
（含 cached；cached 是 input 的子集，不另加）。**峰值 context** = 一個 session 內所有 call 的 max input_tokens。
Model context window 直接讀 `info.model_context_window`。

**分類訊號**（實際觀察 `session_meta`，非憑記憶）：
- `originator`：`codex-tui` / `codex_cli_rs` → **互動 TUI**；`codex_exec` / `Claude Code` → **dispatch (headless)**。
- 佐證：`thread_source=subagent`、`source.subagent.thread_spawn`、`cwd` 帶 worktree/`/root/`。
- 輪次：`agent_path`（如 `security_scanner_r1_fix`）/ cwd / 檔名 抽 `r<N>`。

觀察到的 context window 有三種：**121600**（gpt-5.3-codex-spark）、**258400**（gpt-5.5）、**353400**（gpt-5.6-sol）。
題目給的 258k 門檻正好是 gpt-5.5 的視窗，不是「上限附近」而是真實上限。

腳本：`extract_codex.py`（逐 session 抽序列）＋ `analyze_codex.py`（統計）。未把整檔讀進 context。

---

## 1. 峰值 context 百分位（互動 vs dispatch 分開）

絕對 token：

| 語料 / 類別 | n | p50 | p90 | p99 | max | mean |
|-------------|---|-----|-----|-----|-----|------|
| A 互動 TUI | 126 | 328k | 334k | 334k | 338k | 296k |
| A dispatch | 108 | 27k | **113k** | **199k** | 249k | 46k |
| B 互動 TUI | 89 | 316k | 317k | 334k | 334k | 259k |
| B dispatch | 661 | 53k | **142k** | **244k** | 247k | 73k |

峰值占「該 session 自己視窗」的比例（更能反映危險區，因視窗大小不同）：

| 語料 / 類別 | peak/window p50 | p90 | p99 | ≥75% | ≥90% |
|-------------|-----|-----|-----|------|------|
| A 互動 | 0.93 | 0.95 | 0.95 | 86% | 68% |
| A dispatch | 0.12 | 0.41 | 0.71 | 1% | **0%** |
| B 互動 | 0.89 | 0.90 | 0.95 | 75% | 10% |
| B dispatch | 0.23 | **0.93** | 0.95 | 16% | **13%** |

**判讀**：
- 互動 TUI session 幾乎都吃到視窗上緣（p50 ≈ 0.9×window）——靠 `context_compacted` 續命，是 hook 門檻真正該守的對象，但 codex 不跑 autopilot hook。
- **dispatch 絕對量溫和**：A p99=199k、B p99=244k，兩組 dispatch **沒有任何一個** session 的峰值越過 258k。

---

## 2. 門檻掃描 {100k / 150k / 200k / 258k / 300k}

**dispatch（autopilot 真正 dispatch 給 codex 的部分）：**

| 門檻 | A %越過 | A 越過後平均 call | A 越過後 out-tok | B %越過 | B 越過後平均 call | B 越過後 out-tok |
|------|--------|------|------|--------|------|------|
| 100k | 12.0% | 21.5 | 8.6k | 28.7% | 50.2 | 26.9k |
| 150k | 4.6% | 26.8 | 8.8k | 9.2% | 20.9 | 11.0k |
| 200k | 0.9% | 68.0 | 13.4k | 6.2% | 16.6 | 9.8k |
| **258k** | **0.0%** | – | – | **0.0%** | – | – |
| 300k | 0.0% | – | – | 0.0% | – | – |

**互動 TUI（對照，非 dispatch）：** ≥80% session 越過 100k，越過後仍跑數千 call、燒 0.5–1.2M out-tok——這是 compaction 常態，不是 dispatch 行為。

**判讀**：dispatch 越過 200k 是長尾（<7%），越過 258k 為 **0%**。越過門檻後續跑的量也小（十幾～幾十 call）。dispatch 側沒有失控的 context 爆量。

---

## 3. Re-dispatch 逐輪成長斜率（回答「delta re-dispatch 能省多少」）

以 dispatch session 的**起始 prompt** = 第一次 API call 的 input_tokens，依偵測到的輪次分箱：

| 輪次 | A n | A median 起始 | B n | B median 起始 |
|------|-----|------|-----|------|
| 1 | – | – | 11 | 20k |
| 2 | 4 | 17k | 28 | 20k |
| 3 | 1 | 15k | 19 | 20k |
| 4 | – | – | 9 | 20k |
| 5 | 1 | 15k | 12 | 19k |
| 7–18 | 各 1 | 17–18k | 各 1（15 輪 ×7）| 17–24k |

**線性擬合斜率：A = +0.3k / 輪，B = +0.2k / 輪 ≈ 0。**

**判讀（關鍵結論）**：**re-dispatch 的起始 prompt 不逐輪成長**——每一輪都從 ~17–20k 重新起步，與輪數幾乎無關。
autopilot 的 codex re-dispatch 路徑本來就是**無狀態**的：每輪重發一份 fresh prompt，不累積前幾輪對話。
→ **delta re-dispatch 對「起始 prompt」幾乎省不到東西**（本來就沒有累積可省）。
session 內的 context 成長來自 agent 自己讀檔／工具輸出，delta-prompt 方案碰不到那部分。

---

## 4. 真正的壓力點與建議

**壓力不在 prompt 累積，而在小視窗引擎的 session 內成長。** B 組 dispatch ≥90%-視窗的來源：

| model, window | ≥90% / 總 dispatch |
|---------------|------|
| **gpt-5.3-codex-spark, 121600** | **56 / 128 (44%)** |
| gpt-5.5, 258400 | 28 / 533 (5%) |

autopilot 的**預設 implementer 就是 gpt-5.3-codex-spark**，視窗只有 **121600**，且 44% 的 dispatch 已經吃到視窗 ≥90%（絕對峰值 max=120k，貼齊視窗）。這才是唯一實質風險區——但它是**單 session 內的 agentic 成長**（讀檔＋工具輸出），不是 dispatcher 重發 prompt 造成的。

### 建議

1. **不要為 re-dispatch 累積 prompt 設「上限＋改餵 delta」的機制**——資料顯示 codex re-dispatch 起始 prompt 本來就是無狀態、flat ~20k（斜率 ≈0）。delta 化省不到 token，只增複雜度。這與「Claude 端 re-dispatch 該設 cap」的直覺相反：codex dispatch 路徑已經是 delta-free。
2. **改用「視窗相對」門檻而非絕對值**。dispatch 絕對量 p99≈244k、從不破 258k，一個絕對 cap（如 200k）只會打到長尾。真正該守的是**占引擎自身視窗的比例**：
   - 建議 **soft warn @ 75% window、hard @ 90% window**。
   - 對映到絕對值：258400 視窗 → warn 194k / hard 232k；**121600 視窗（spark）→ warn 91k / hard 109k**。
3. **壓力的正確 lever 是縮小 dispatch scope，不是壓 prompt**：spark 44% 貼視窗，是它讀太多檔／工具輸出多。要降壓就（a）把單元切小（更少檔）、或（b）大 context 工作路由到 258k/353k 視窗引擎，而非發明 delta-prompt。
4. **互動 TUI 不在 autopilot 控制面內**（codex 不跑 hook），其常態貼滿視窗（p50≈0.9×window）只作為對照，不需 autopilot 介入。

**一句話**：dispatch 側 context 受控（p99 244k、0% 破 258k、re-dispatch 斜率≈0），**delta re-dispatch 無效益**；唯一實質壓力是預設 spark 引擎 121600 小視窗的 session 內成長，該用「90% 視窗」相對門檻＋縮 scope 處理，不用 prompt cap。

---
產物：`extract_codex.py`、`analyze_codex.py`、`A.jsonl`、`B.jsonl`、本報告
