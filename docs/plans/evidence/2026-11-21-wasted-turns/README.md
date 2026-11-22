# wasted-turns P1 基準（2026-11-23 台北）

- `p1-baseline-autopilot.json`：autopilot 席，7 天窗，`--self`（以 CLAUDE_CODE_SESSION_ID 鎖席）；1377 回合，白跑 50（3.63 / 100，hook_block 50）。
- 其他席（fleet、hangar）的基準 JSON 由各席以同一支腳本重跑後附檔，見計畫 §3.2。
- 指令：`CLAUDE_CODE_SESSION_ID=<sid> node scripts/wasted-turns-report.js --self --seat <label> --out <path>`。
