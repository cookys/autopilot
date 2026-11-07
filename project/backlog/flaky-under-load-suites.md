# 只在負載下紅的測試套件

BL-0414：
- plan-review-roster-admission、runner-binary：單獨跑綠，負載高時紅。
- foreman-eval-sandbox.test.js：2026-11-06 全套平行時紅，單獨跑綠。
- 做法：找出共用資源或時間假設，修成與負載無關；不要用重跑掩蓋。

BL-0418：dispatch-hetero-account.test.js 有一個 subtest 會在它的 cwd repo 裡 commit，跑出 fixture 範圍。
gitenv 已修掉 GIT_DIR 外洩這一類；這條要查證是否還有剩下的情況（cwd 本身是真 repo 時的 commit 路徑），並留下負控制。
