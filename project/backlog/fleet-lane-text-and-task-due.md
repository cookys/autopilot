# fleet 相關兩點

BL-0415：fleet lane 文字沒有清掉，參照 2b1d4711。
BL-0417：
- dispatch 時能否帶上 fleet task 的 next_evidence_due 欄位（PM 2026-11-06 要求另排一個 S 項）。
- hub 79000b8 會把 task_result 的 until 丟掉，已排在 fleet BL-0014，等 11-10 解凍；本 repo 不動。
