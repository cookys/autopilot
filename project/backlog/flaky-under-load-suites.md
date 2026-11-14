# 只在負載下紅的測試套件

BL-0414（review-server 那筆已獨立成 BL-0425，要求在負載 40 以上穩定重現並找出根因，只靠重跑變綠不算數）：
- plan-review-roster-admission、runner-binary：單獨跑綠，負載高時紅。
- foreman-eval-sandbox.test.js：2026-11-06 全套平行時紅，單獨跑綠。
- hooks/tests/review-server.test.sh：2026-11-07 Z7 全套（負載 44）時 pool 與單獨跑都紅，失敗的斷言是 "watcher-started server answers 200: expected '200', got '000'"；之後在 develop d8ffe3ffa 與 Z7 124a507ce 各單獨跑一次，rc=0。已獨立成 BL-0425。
- 做法：找出共用資源或時間假設，修成與負載無關；不要用重跑掩蓋。
