# wasted-turns P1 基準（2026-11-23 台北）

- `p1-baseline-autopilot.json`：autopilot 席，7 天窗，`--self`（以 CLAUDE_CODE_SESSION_ID 鎖席）；1377 回合，白跑 50（3.63 / 100，hook_block 50）。
- 其他席（fleet、hangar）的基準 JSON 由各席以同一支腳本重跑後附檔，見計畫 §3.2。
- 指令：`CLAUDE_CODE_SESSION_ID=<sid> node scripts/wasted-turns-report.js --self --seat <label> --out <path>`。
- `p1-baseline-hangar.json`：hangar 席，7 天窗，19457 回合，白跑 825（4.24 / 100）；hook_block 806，by_hook 前五 bash-footgun-guard 442、bash-launch-guard 165、mcp__fleet__send 86、Bash 68、dispatch-model-guard 13。由 hangar 席於 2026-11-23 用 develop 269efae8f 的串流版腳本產生（fleet blob 13fb7908…）。
- fleet 席（29460 回合，hook_block 688；by_hook 前五 bash-footgun-guard 421、bash-launch-guard 134、mcp__fleet__send 68、Bash 43、dispatch-model-guard 7）由 fleet 席回報，JSON 在其主機 /tmp，未入本目錄。
