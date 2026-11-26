// console v5 P2 design step 4-L: the pane area (rows 0-41, columns 116-208 of out-wide-all/209x49-s23/screen.txt; copied, read-only design source). The running dot is the glyph table circle.
export const PANE_4_L: { id: string; rows: string[]; model: Record<string, unknown> } = {
  id: "4-L",
  rows: [
    "╭─ 4 審查 · 詳情 ───────────────────────────────────────────────────────────────────────────╮",
    "│ note 1｜src/cli/statusline.rs:212｜窄寬度時配額列會先截掉重置時間，                       │",
    "│         操作員看不到幾點重置；建議改成先截掉 fleet 那一段。                               │",
    "│ note 2｜scripts/check-all.sh:88｜flake guard 重跑一次就算過，                             │",
    "│         同一條連續兩天都要重跑，應該登進 flaky 清單。                                     │",
    "│ 第 1 輪 blocking 1｜CJK 專案名時切到半個字。                                              │",
    "│ 第 1 輪 blocking 2｜quota 檔不存在時印出空白而不是「—」。                                 │",
    "│ 第 1 輪 blocking 3｜80 欄時分隔線多一格。                                                 │",
    "│ 三條都修完，第 2 輪重看確認。                                                             │",
    "│ 審查席：codex gpt-6.1 · effort high                                                       │",
    "│                                                                                           │",
    "│ 艦隊 · 12 條產線 · 執行 8 · 失敗 2 · 卡住 2                                               │",
    "│   ◉ codeforge    ϟ 41 tok/s  ▆▆▄▃▆   tux-sync 測試                                        │",
    "│   ◉ autopilot    ϟ 37 tok/s  ▄▅▆▆▅   band 對比修正                                        │",
    "│   ◉ hangar       ϟ 63 tok/s  ▆▇▆▅▆   盤點 client 尺寸                                     │",
    "│   ◉ fleet        ϟ 30 tok/s  ▃▄▄▅▄   courier 重試佇列                                     │",
    "│   ◉ hippo        ϟ 22 tok/s  ▂▃▃▄▃   安裝 P1.5                                            │",
    "│   ◉ lab          ϟ 18 tok/s  ▂▂▃▂▂   gate 掃描                                            │",
    "│   ◉ alfred       ϟ 15 tok/s  ▁▂▂▂▃   部署前檢查                                           │",
    "│   ◉ mnemos       ϟ 11 tok/s  ▁▁▂▁▂   索引重建                                             │",
    "│   ✗ hangar 換池  失敗 3 輪           等 NAS 回應逾時                                      │",
    "│   ✗ docs 建置    失敗 1 輪           mdbook 版本不符                                      │",
    "│   ⋯ pinball 美術 卡住                等操作員選版                                         │",
    "│   ⋯ 308 地圖     卡住                等素材                                               │",
    "│                                                                                           │",
    "│ 今天的審查紀錄 · 最近 5 筆                                                                │",
    "│   08:31 合併 develop codeforge 05e2                                                       │",
    "│   08:22 codex PASS autopilot e931                                                         │",
    "│   08:02 agy PASS hangar 5cab                                                              │",
    "│   07:55 合併 develop autopilot 7d1c                                                       │",
    "│   07:41 退件 grok 第 2 版                                                                 │",
    "│                                                                                           │",
    "│ 其他頁                                                                                    │",
    "│ 1 現況  待決 3 · 動手 1 · 殘留 2 項                                                       │",
    "│ 2 待決  3 張要你選 · 1 張要先動手                                                         │",
    "│ 3 派工  執行中 2 輪 · 失敗 1 輪 · 完成 1 輪                                               │",
    "│ 5 花費  5h 42% · 7d 18% · 今日 380k tokens                                                │",
    "│ 6 殘留  要你處理 2 · 自動清理 1                                                           │",
    "│ 7 艦隊  執行 8 · 失敗 2 · 卡住 2                                                          │",
    "│ 8 待辦  3 張 · 最近到期 11-30                                                             │",
    "│ 9 說明  狀態圖示與按鍵表                                                                  │",
    "╰─ 數字鍵 跳到那一頁 · e 展開來龍去脈 ──────────────────────────────────────────────────────╯",
  ],
  model: {
    "page": 4,
    "moved": [
      "note 1｜src/cli/statusline.rs:212｜窄寬度時配額列會先截掉重置時間，",
      "        操作員看不到幾點重置；建議改成先截掉 fleet 那一段。",
      "note 2｜scripts/check-all.sh:88｜flake guard 重跑一次就算過，",
      "        同一條連續兩天都要重跑，應該登進 flaky 清單。",
      "第 1 輪 blocking 1｜CJK 專案名時切到半個字。",
      "第 1 輪 blocking 2｜quota 檔不存在時印出空白而不是「—」。",
      "第 1 輪 blocking 3｜80 欄時分隔線多一格。",
      "三條都修完，第 2 輪重看確認。",
      "審查席：codex gpt-6.1 · effort high"
    ],
    "more": [],
    "pin": [],
    "ctx": [],
    "ctxFold": false,
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
      "title": "今天的審查紀錄",
      "rows": [
        "08:31 合併 develop codeforge 05e2",
        "08:22 codex PASS autopilot e931",
        "08:02 agy PASS hangar 5cab",
        "07:55 合併 develop autopilot 7d1c",
        "07:41 退件 grok 第 2 版",
        "07:30 codex PASS lab 93fa",
        "07:12 合併 develop fleet 2b6e"
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
      null,
      "5h 42% · 7d 18% · 今日 380k tokens",
      "要你處理 2 · 自動清理 1",
      "執行 8 · 失敗 2 · 卡住 2",
      "3 張 · 最近到期 11-30",
      "狀態圖示與按鍵表"
    ]
  },
}
