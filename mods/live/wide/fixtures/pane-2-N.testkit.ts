// console v5 P2 design step 2-N: the pane area (rows 0-41, columns 115-208 of out-wide-all/209x49-s8/screen.txt; copied, read-only design source). The running dot is the glyph table circle.
export const PANE_2_N: { id: string; rows: string[]; model: Record<string, unknown> } = {
  id: "2-N",
  rows: [
    "╭─ 2 待決 · 詳情 ────────────────────────────────────────────────────────────────────────────╮",
    "│ 來龍去脈 2 列 · 收起                                                                       │",
    "│                                                                                            │",
    "│ 艦隊 · 12 條產線 · 執行 8 · 失敗 2 · 卡住 2                                                │",
    "│   ◉ codeforge    ϟ 41 tok/s  ▆▆▄▃▆   tux-sync 測試                                         │",
    "│   ◉ autopilot    ϟ 37 tok/s  ▄▅▆▆▅   band 對比修正                                         │",
    "│   ◉ hangar       ϟ 63 tok/s  ▆▇▆▅▆   盤點 client 尺寸                                      │",
    "│   ◉ fleet        ϟ 30 tok/s  ▃▄▄▅▄   courier 重試佇列                                      │",
    "│   ◉ hippo        ϟ 22 tok/s  ▂▃▃▄▃   安裝 P1.5                                             │",
    "│   ◉ lab          ϟ 18 tok/s  ▂▂▃▂▂   gate 掃描                                             │",
    "│   ◉ alfred       ϟ 15 tok/s  ▁▂▂▂▃   部署前檢查                                            │",
    "│   ◉ mnemos       ϟ 11 tok/s  ▁▁▂▁▂   索引重建                                              │",
    "│   ✗ hangar 換池  失敗 3 輪           等 NAS 回應逾時                                       │",
    "│   ✗ docs 建置    失敗 1 輪           mdbook 版本不符                                       │",
    "│   ⋯ pinball 美術 卡住                等操作員選版                                          │",
    "│   ⋯ 308 地圖     卡住                等素材                                                │",
    "│                                                                                            │",
    "│ 今天已決的卡 · 最近 6 筆                                                                   │",
    "│   08:31 合併 plan → a（照建議）                                                            │",
    "│   08:31 外掛更新時機 → b                                                                   │",
    "│   08:02 預覽先拍幾欄 → a（照建議）                                                         │",
    "│   07:40 hippo 安裝批次 → a                                                                 │",
    "│   07:15 mnemos 匯入時段 → c（附註：晚上再跑）                                              │",
    "│   06:50 alfred 上線日 → a（照建議）                                                        │",
    "│                                                                                            │",
    "│ 本機事件 · 最近 5 筆                                                                       │",
    "│   09:41 pm status 更新                                                                     │",
    "│   09:40 hangar 回報 client 尺寸                                                            │",
    "│   09:38 codeforge check-all 綠                                                             │",
    "│   09:35 autopilot 送審                                                                     │",
    "│   09:31 fleet 重試佇列清空                                                                 │",
    "│                                                                                            │",
    "│ 其他頁                                                                                     │",
    "│ 1 現況  待決 3 · 動手 1 · 殘留 2 項                                                        │",
    "│ 3 派工  執行中 2 輪 · 失敗 1 輪 · 完成 1 輪                                                │",
    "│ 4 審查  欠審 1 · 我替你決定的事 4                                                          │",
    "│ 5 花費  5h 42% · 7d 18% · 今日 380k tokens                                                 │",
    "│ 6 殘留  要你處理 2 · 自動清理 1                                                            │",
    "│ 7 艦隊  執行 8 · 失敗 2 · 卡住 2                                                           │",
    "│ 8 待辦  3 張 · 最近到期 11-30                                                              │",
    "│ 9 說明  狀態圖示與按鍵表                                                                   │",
    "╰─ 數字鍵 跳到那一頁 · e 展開來龍去脈 ───────────────────────────────────────────────────────╯",
  ],
  model: {
    "page": 2,
    "moved": [],
    "more": [],
    "pin": [],
    "ctx": [
      "來龍去脈第 1 列",
      "來龍去脈第 2 列"
    ],
    "ctxFold": true,
    "ctxOpen": false,
    "lanes": [
      {
        "state": "running",
        "name": "codeforge",
        "speed": "ϟ 41 tok/s  ▆▆▄▃▆",
        "task": "tux-sync 測試"
      },
      {
        "state": "running",
        "name": "autopilot",
        "speed": "ϟ 37 tok/s  ▄▅▆▆▅",
        "task": "band 對比修正"
      },
      {
        "state": "running",
        "name": "hangar",
        "speed": "ϟ 63 tok/s  ▆▇▆▅▆",
        "task": "盤點 client 尺寸"
      },
      {
        "state": "running",
        "name": "fleet",
        "speed": "ϟ 30 tok/s  ▃▄▄▅▄",
        "task": "courier 重試佇列"
      },
      {
        "state": "running",
        "name": "hippo",
        "speed": "ϟ 22 tok/s  ▂▃▃▄▃",
        "task": "安裝 P1.5"
      },
      {
        "state": "running",
        "name": "lab",
        "speed": "ϟ 18 tok/s  ▂▂▃▂▂",
        "task": "gate 掃描"
      },
      {
        "state": "running",
        "name": "alfred",
        "speed": "ϟ 15 tok/s  ▁▂▂▂▃",
        "task": "部署前檢查"
      },
      {
        "state": "running",
        "name": "mnemos",
        "speed": "ϟ 11 tok/s  ▁▁▂▁▂",
        "task": "索引重建"
      },
      {
        "state": "failed",
        "name": "hangar 換池",
        "speed": "失敗 3 輪",
        "task": "等 NAS 回應逾時"
      },
      {
        "state": "failed",
        "name": "docs 建置",
        "speed": "失敗 1 輪",
        "task": "mdbook 版本不符"
      },
      {
        "state": "waiting",
        "name": "pinball 美術",
        "speed": "卡住",
        "task": "等操作員選版"
      },
      {
        "state": "waiting",
        "name": "308 地圖",
        "speed": "卡住",
        "task": "等素材"
      }
    ],
    "lanesHead": "艦隊 · 12 條產線 · 執行 8 · 失敗 2 · 卡住 2",
    "hist": {
      "title": "今天已決的卡",
      "rows": [
        "08:31 合併 plan → a（照建議）",
        "08:31 外掛更新時機 → b",
        "08:02 預覽先拍幾欄 → a（照建議）",
        "07:40 hippo 安裝批次 → a",
        "07:15 mnemos 匯入時段 → c（附註：晚上再跑）",
        "06:50 alfred 上線日 → a（照建議）"
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
      null,
      "執行中 2 輪 · 失敗 1 輪 · 完成 1 輪",
      "欠審 1 · 我替你決定的事 4",
      "5h 42% · 7d 18% · 今日 380k tokens",
      "要你處理 2 · 自動清理 1",
      "執行 8 · 失敗 2 · 卡住 2",
      "3 張 · 最近到期 11-30",
      "狀態圖示與按鍵表"
    ]
  },
}
