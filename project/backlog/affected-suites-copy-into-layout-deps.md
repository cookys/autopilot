# affected-suites 看不出「把檔案拷進自己 layout」的依賴 (BL-0382)

Source: aa95f0ce3 full-suite triage, 2026-11-04 (PM ruling). 前置修補: 分支 hands/qrlayout/1。

## 現象
- 487e773b0 讓 scripts/claude-account.js 多了 `require('./quota-reporter')`。
- p2-batch-*、pipeline-bench、paid-batch-auth-stop、fleet-child-contract 各自把 claude-account.js 拷進暫時 layout，沒有拷 quota-reporter.js，於是全部以 exit 2 失敗。
- 縮小選取沒有選中這些套件，紅燈到完整套件才被發現。

## 修法方向（尚未實作）
1. 在 affected-suites 的依賴推導裡，把「fixture 內拷了某支 script」視為該套件依賴那支 script，以及它遞移 require 到的所有相對檔案。
2. 最好直接從 qrlayout 新增的共用複製清單（hooks/tests/lib/account-layer.list，由 hooks/tests/lib/account-layer.sh 的 cp_account_layer 讀取）推導，不另外維護第二份。
3. 紅案：重現這次漏抓。改動 claude-account.js 的 require 時，selector 必須選中 p2-batch-*、pipeline-bench、paid-batch-auth-stop、fleet-child-contract；修之前要先顯示紅（沒選中），修之後轉綠。

## 暫行規則（這條修好之前）
凡是改到 claude-account.js 或它 require 圖的變更，合併前都要跑完整套件，不能只跑縮小選取。
