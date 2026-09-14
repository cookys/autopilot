# `engine-qualify-impl.test.js` 單次無法重現的紅(1/24 solo,訊息未捕獲)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一次它在 full-suite / CI 或 solo 跑紅(歸因半件)。**保存半件已做(2026-08-23)**:`hooks/tests/run.sh` L1 現在把 `node --test` 全輸出 tee 進 `/tmp/autopilot-l1-unit.*`,紅了保留並印路徑、綠了即刪(planted red 驗證訊息確實落檔)。solo 迴圈仍須自帶 `2>&1 | tee`——run.sh 管不到 ad-hoc 跑法。
- **Context**: 2026-08-23 v2.34.37 收尾期間,`node --test scripts/engine-qualify-impl.test.js` 在約 24 次 solo 連跑中出現**一次** `pass 0 / fail 1`;當時的 harness 只 grep 摘要行、沒有保留 log,`AssertionError` 的 message 因此**遺失**,無法歸因。事後立刻以保留 log 的 harness 連跑 10 次 + 另外多輪 solo 3 跑,全綠,兩次 `hooks/tests/run.sh --parallel 8` 全 275 檔綠。所以:**已知有一次紅、未知原因**,不宣稱已修、也不宣稱是 flake。可疑面向:同檔仍有 `testWallSecondsOverride: 0` 的零牆 fixture、以及 live-rail 派工會起真子行程(`impl-qualify-live-*` 暫存目錄、`fake-dispatcher` wrapper),機器極度吃緊時子行程失敗會以什麼形狀冒出來沒有被觀察過。修向:先把該測試的失敗輸出常態保存(`node --test` 的 stdout 全存進 artifact),再談歸因 —— 這正是「紅字部分為雜訊就不再被讀」那族危害的入口。
- **Effort**: S(先加保存,再看下一次紅)。
- **Source**: 2026-08-23 v2.34.37 收尾實測(run `fix-bundle-l4`),foreman 直接觀察。

