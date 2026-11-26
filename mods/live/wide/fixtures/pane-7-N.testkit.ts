// console v5 P2 design step 7-N: the pane area (rows 0-41, columns 115-208 of out-wide-all/209x49-s40/screen.txt; copied, read-only design source). The running dot is the glyph table circle.
export const PANE_7_N: { id: string; rows: string[]; model: Record<string, unknown> } = {
  id: "7-N",
  rows: [
    "╭─ 7 艦隊 · 詳情 ────────────────────────────────────────────────────────────────────────────╮",
    "│ 模型 opus · 41 tok/s ▆▆▄▃▆（近 5 分鐘）                                                    │",
    "│ 最近 run hetero-1795623455（codex，已交件）                                                │",
    "│ 產線：design/console-full · 審查中                                                         │",
    "│                                                                                            │",
    "│ 12 條產線 · 最近一件事 → 下一步                                                            │",
    "│   ◉ codeforge    ϟ 41 tok/s  ▆▆▄▃▆ 09:38 check-all 綠，合 develop  → 補 tux-sync 反例      │",
    "│   ◉ autopilot    ϟ 37 tok/s  ▄▅▆▆▅ 09:35 band 淺色對比 4.7         → 等 codeforge 審查     │",
    "│   ◉ hangar       ϟ 63 tok/s  ▆▇▆▅▆ 09:40 量到 client 209x51        → 交實拍單 01M825HR     │",
    "│   ◉ fleet        ϟ 30 tok/s  ▃▄▄▅▄ 09:31 重試佇列清到 0            → courier 逾時改 30 秒  │",
    "│   ◉ hippo        ϟ 22 tok/s  ▂▃▃▄▃ 09:29 P1.5 裝好 3/5 台          → 裝剩下 2 台           │",
    "│   ◉ lab          ϟ 18 tok/s  ▂▂▃▂▂ 09:26 gate 掃完 41 個 repo      → 寫掃描報告            │",
    "│   ◉ alfred       ϟ 15 tok/s  ▁▂▂▂▃ 09:20 部署前檢查 7/9 過         → 修 2 項設定           │",
    "│   ◉ mnemos       ϟ 11 tok/s  ▁▁▂▁▂ 09:18 索引重建 62%              → 跑完驗查詢            │",
    "│   ✗ hangar 換池  失敗 3 輪         09:22 NAS stat 逾時 600 秒      → 第 4 輪前先查 NAS     │",
    "│   ✗ docs 建置    失敗 1 輪         09:05 mdbook 0.5 不認新語法     → 釘 mdbook 版本        │",
    "│   ⋯ pinball 美術 卡住              昨天 18:10 交 3 版封面          → 等你選版              │",
    "│   ⋯ 308 地圖     卡住              昨天 16:40 缺第 3 區素材        → 等素材進來            │",
    "│                                                                                            │",
    "│ 今天結束的產線 · 最近 6 筆                                                                 │",
    "│   09:05 codeforge · tux-sync 交件                                                          │",
    "│   08:40 hangar · 盤點交件                                                                  │",
    "│   08:12 autopilot · band 交件                                                              │",
    "│   07:30 docs · 版本交件                                                                    │",
    "│   07:02 fleet · 重試交件                                                                   │",
    "│   06:41 hippo · P1.4 交件                                                                  │",
    "│                                                                                            │",
    "│ 本機事件 · 最近 3 筆                                                                       │",
    "│   09:41 pm status 更新                                                                     │",
    "│   09:40 hangar 回報 client 尺寸                                                            │",
    "│   09:38 codeforge check-all 綠                                                             │",
    "│                                                                                            │",
    "│ 其他頁                                                                                     │",
    "│ 1 現況  待決 3 · 動手 1 · 殘留 2 項                                                        │",
    "│ 2 待決  3 張要你選 · 1 張要先動手                                                          │",
    "│ 3 派工  執行中 2 輪 · 失敗 1 輪 · 完成 1 輪                                                │",
    "│ 4 審查  欠審 1 · 我替你決定的事 4                                                          │",
    "│ 5 花費  5h 42% · 7d 18% · 今日 380k tokens                                                 │",
    "│ 6 殘留  要你處理 2 · 自動清理 1                                                            │",
    "│ 8 待辦  3 張 · 最近到期 11-30                                                              │",
    "│ 9 說明  狀態圖示與按鍵表                                                                   │",
    "╰─ 數字鍵 跳到那一頁 · e 展開來龍去脈 ───────────────────────────────────────────────────────╯",
  ],
  model: {
    "page": 7,
    "moved": [],
    "more": [],
    "pin": [
      "模型 opus · 41 tok/s ▆▆▄▃▆（近 5 分鐘）",
      "最近 run hetero-1795623455（codex，已交件）",
      "產線：design/console-full · 審查中"
    ],
    "ctx": [],
    "ctxFold": false,
    "ctxOpen": false,
    "lanes": [
      {
        "state": "running",
        "name": "codeforge",
        "speed": "ϟ 41 tok/s  ▆▆▄▃▆",
        "task": "tux-sync 測試",
        "ev": "09:38 check-all 綠，合 develop",
        "next": "補 tux-sync 反例"
      },
      {
        "state": "running",
        "name": "autopilot",
        "speed": "ϟ 37 tok/s  ▄▅▆▆▅",
        "task": "band 對比修正",
        "ev": "09:35 band 淺色對比 4.7",
        "next": "等 codeforge 審查"
      },
      {
        "state": "running",
        "name": "hangar",
        "speed": "ϟ 63 tok/s  ▆▇▆▅▆",
        "task": "盤點 client 尺寸",
        "ev": "09:40 量到 client 209x51",
        "next": "交實拍單 01M825HR"
      },
      {
        "state": "running",
        "name": "fleet",
        "speed": "ϟ 30 tok/s  ▃▄▄▅▄",
        "task": "courier 重試佇列",
        "ev": "09:31 重試佇列清到 0",
        "next": "courier 逾時改 30 秒"
      },
      {
        "state": "running",
        "name": "hippo",
        "speed": "ϟ 22 tok/s  ▂▃▃▄▃",
        "task": "安裝 P1.5",
        "ev": "09:29 P1.5 裝好 3/5 台",
        "next": "裝剩下 2 台"
      },
      {
        "state": "running",
        "name": "lab",
        "speed": "ϟ 18 tok/s  ▂▂▃▂▂",
        "task": "gate 掃描",
        "ev": "09:26 gate 掃完 41 個 repo",
        "next": "寫掃描報告"
      },
      {
        "state": "running",
        "name": "alfred",
        "speed": "ϟ 15 tok/s  ▁▂▂▂▃",
        "task": "部署前檢查",
        "ev": "09:20 部署前檢查 7/9 過",
        "next": "修 2 項設定"
      },
      {
        "state": "running",
        "name": "mnemos",
        "speed": "ϟ 11 tok/s  ▁▁▂▁▂",
        "task": "索引重建",
        "ev": "09:18 索引重建 62%",
        "next": "跑完驗查詢"
      },
      {
        "state": "failed",
        "name": "hangar 換池",
        "speed": "失敗 3 輪",
        "task": "等 NAS 回應逾時",
        "ev": "09:22 NAS stat 逾時 600 秒",
        "next": "第 4 輪前先查 NAS"
      },
      {
        "state": "failed",
        "name": "docs 建置",
        "speed": "失敗 1 輪",
        "task": "mdbook 版本不符",
        "ev": "09:05 mdbook 0.5 不認新語法",
        "next": "釘 mdbook 版本"
      },
      {
        "state": "waiting",
        "name": "pinball 美術",
        "speed": "卡住",
        "task": "等操作員選版",
        "ev": "昨天 18:10 交 3 版封面",
        "next": "等你選版"
      },
      {
        "state": "waiting",
        "name": "308 地圖",
        "speed": "卡住",
        "task": "等素材",
        "ev": "昨天 16:40 缺第 3 區素材",
        "next": "等素材進來"
      }
    ],
    "lanesHead": "12 條產線 · 最近一件事 → 下一步",
    "hist": {
      "title": "今天結束的產線",
      "rows": [
        "09:05 codeforge · tux-sync 交件",
        "08:40 hangar · 盤點交件",
        "08:12 autopilot · band 交件",
        "07:30 docs · 版本交件",
        "07:02 fleet · 重試交件",
        "06:41 hippo · P1.4 交件"
      ]
    },
    "events": [
      "09:41 pm status 更新",
      "09:40 hangar 回報 client 尺寸",
      "09:38 codeforge check-all 綠",
      "09:35 autopilot 送審",
      "09:31 fleet 重試佇列清空",
      "09:29 hippo 裝好第 3 台",
      "09:26 lab gate 掃描完",
      "09:22 hangar 換池第 3 輪逾時",
      "09:20 alfred 檢查 7/9",
      "09:18 mnemos 索引 62%",
      "09:12 autopilot 審查通過",
      "09:05 docs 建置失敗",
      "09:01 codex 席額度 47%",
      "08:55 hangar 盤點完成",
      "08:40 agy 交件 hangar",
      "08:31 待決 2 張送出",
      "08:22 codex PASS autopilot",
      "08:15 換池 team → pool-b",
      "08:02 agy PASS hangar",
      "07:58 lab gate 放行",
      "07:41 docs 第 2 版退件",
      "07:30 codex PASS lab",
      "07:12 fleet 合進 develop",
      "07:02 agy 交件 fleet",
      "06:50 alfred 上線日已決",
      "06:41 hippo P1.4 交件",
      "06:21 hippo 合進 develop",
      "06:05 codex 第 1 版退件"
    ],
    "summaries": [
      "待決 3 · 動手 1 · 殘留 2 項",
      "3 張要你選 · 1 張要先動手",
      "執行中 2 輪 · 失敗 1 輪 · 完成 1 輪",
      "欠審 1 · 我替你決定的事 4",
      "5h 42% · 7d 18% · 今日 380k tokens",
      "要你處理 2 · 自動清理 1",
      null,
      "3 張 · 最近到期 11-30",
      "狀態圖示與按鍵表"
    ]
  },
}
