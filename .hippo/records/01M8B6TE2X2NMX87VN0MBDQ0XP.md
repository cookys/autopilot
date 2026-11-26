---
id: 01M8B6TE2X2NMX87VN0MBDQ0XP
kind: issue
created: 2026-11-26T05:56:26.333Z
---
- **Since**: 2026-11-25
- **Problem**: GLM-5.3／5.4 reviewer 科（思考關、T1 主機宣告、/v1/messages）都是 degraded、evaluation_passed=false：known-bad 漏抓（oracle 拒 01、02、07、17、20）、輸出非 {verdict,findings} 格式、witness call 超出 case domain、mutation control 失敗。
- **Impact**: GLM 不能當 reviewer 席；verification_author 科已過，只用於白名單 T0／T1 內容，不受影響。
- **Trigger**: GLM 出新版本（5.5 以上）或雲端開放思考開的協定時重考，用 ~/.tmp/glm-qual 的 cell 腳本與 QRP_CN_WORK_TIER=T1 宣告（題庫 leak-scan 0 命中）
- **Source**: PM 裁定 01M89NZGZZ（單 01M83BNDZB）；第 5 輪結果見單留言
- **Pointer**: docs/plans/evidence/2026-11-25-glm-qualify-r5/README.md
