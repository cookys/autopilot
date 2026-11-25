# 中國雲公開來源白名單 v1

適用：moonshot（kimi）、zhipu、alibaba、deepseek、minimax、qoder。閘門 `scripts/lib/cn-model-dispatch-gate.js` 要求每個請求宣告等級（`AUTOPILOT_CN_WORK_TIER` 或 `opts.tier`）；宣告 T0 或 T1 才放行，MiniMax 只收 T0，未宣告一律擋。

## 白名單（只有這幾類）

| 類 | 等級 | 例子 | 輸入來源 | 輸出怎麼進 repo |
|---|---|---|---|---|
| 公開 repo 的 lint 與風格檢查 | T0 | 對公開開源專案的 clone 跑 lint、列出違規 | 公開 repo 的原樣 clone，放在 git 工作樹以外的空沙箱 | 只收報告文字；要改檔另開 diff，由非中國席審 |
| 公開文件翻譯 | T0 | 公開文件、公開 README、公開 changelog 的中英互譯 | 公開網頁或公開 repo 的原文 | 譯文以檔案回傳，非中國席抽查 |
| 去識別題庫的 bench | T1 | SWE34 去識別題、rolekit 這類已去識別、不含內部名稱的題目 | 去識別後的題目包（leak-scan 乾淨） | 只收分數與回答，不收可執行 hook |

## 不在白名單的（一律 T2 以上，硬拒）

- 任何私有 repo、內部需求、fleet 內部訊息、操作員資料。
- 從私有需求改寫成中性 brief：改寫不降級，仍是 T2。
- 手寫的 brief 沒有佇列生產者標籤時預設 T2；本版在佇列（計畫 P3）上線前，由本席對上面三類逐張宣告 T0/T1，並在單上寫明來源。

## 運作規則

1. 只在 git 工作樹以外的空沙箱跑（`Task-Shape: from-scratch`，`dispatch-author.sh`）。
2. 輸出只以文字或 diff 回來；不收二進位與可執行 hook；由非中國席審。
3. T0/T1 任務命中任何內部標記（leak-scan、ar-redact），代表標籤出錯，立即停送並告警。
4. 預付容量閒置不構成送 T2 的理由。

出處：計畫 `project/plans/2026-11-25-cn-cloud-public-only.md`，PM 01M89JNT7Z（2026-11-25）。
