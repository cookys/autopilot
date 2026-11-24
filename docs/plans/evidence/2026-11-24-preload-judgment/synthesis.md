# PM 席預載量三家評審合成（astra、neon、fable）

Fleet-Task: 01M85GR9EGYY5N3YKK4HF87Z1H。三份原文同目錄：`astra.md`、`neon.md`、`fable.md`。本檔只做機械比對：三家都同意的列「要改」，分歧列各家理由交 PM 裁。

## 三家都同意（列為要改）

| 區塊 | 現在 token | 處置 | 三家估計可省 |
|---|---:|---|---|
| MEMORY.md 索引（108 行） | 4,379 | 壓短；事故詳情改按需讀，常駐只留約 20 條 | astra 3,879／neon 3,200–3,500／fable 2,500 |
| skill 清單（70 項） | 7,322 | 描述壓短；neon 另指出 `fleet-usage` 重複 | astra 5,822／neon 5,300–6,000／fable 3,300 |
| 全域 CLAUDE.md | 5,306 | 壓短（授權表可外移） | astra 3,806／neon 3,000–3,500／fable 1,300 |
| SessionStart 注入 | 2,500 | 刪與 skill 清單重複的對照表；動態待派行與未回訊息保留 | astra 1,800／neon 450–520（固定前導）／fable 1,800 |
| fleet 工具說明 | 約 750 | 壓短，保留通道、不授權、fyi 契約 | astra 549／neon 500–550／fable 800 |
| `autopilot:README` 被當 agent | 約 14 | 刪（移出 agents/） | 三家同 |
| 空的 SessionStart:compact hook | 0 | 核對設定後刪 | astra、neon |
| 壓縮門檻 | — | 不要為了省預載而改成 35%（350k） | 見下節 |

## 分歧（交 PM 裁）

| 議題 | astra | neon | fable |
|---|---|---|---|
| 壓縮門檻 | 200k 與視窗 35% 取較低者 | 200k（autoCompactWindow 233k）；35% 只作過渡 | 200k 上下；明說不建議 35% |
| 壓縮後起點目標 | 首請求 ≤60k | ≤50–55k（冷開機 ≤40k） | ≤70k（冷開機 ≤35k） |
| 15.4k 已載入的 deferred 工具結構 | 按需載入（未計入合計） | 未單列 | A1：Artifact 9.6k 改派子代理，主席不載 |
| 88k 未歸類差額 | 維持，未查到組成 | 取證 5 項後再定案 | 推算約 72.7k 是保留對話尾段，縮到 30k 靠行為 |
| Claude Docs 連接器 490 token | 按需載入 | 刪 | 關掉連接器（要操作員） |
| restored-state 911 | 壓短到 300 | 壓短到 450–550 | 維持 |
| repo CLAUDE.md（PM）1,623 | 壓短到 600 | 壓短省 900–1,050 | 維持 |

## 對本席已出貨的 Phase Z 的影響

三家都不贊成把壓縮點抬到 35% 視窗。Phase Z 把 PM 席 T2 預設設成 `{"pm": 35}`（視窗的 35%）；若 PM 席視窗是 1M，T2 變 350k，比現行 150k 還高。建議 PM 在 `~/.autopilot/config.json` 把 `context_budget.t2_pct_by_seat.pm` 設成與 200k 相當的值（1M 視窗約 20），或確認視窗大小後再定。這是設定值，不需要改程式。

## 確定可省合計

fable 算確定可省約 22,400（→約 114,300）；astra 算可控文字約 24,656；neon 階段一冷開機省約 15.5k、壓縮後再省約 17k。三家都明說未歸類差額沒有實測，不計入。
