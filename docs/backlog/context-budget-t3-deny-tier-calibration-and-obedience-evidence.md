# context-budget T3 deny tier — calibration and obedience evidence

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 有可持久化的 context calibration／handoff obedience receipts，或再次觀察到 T3 後新派遣造成 spiral。
- **Context**: 先前 finish-flow marker blocker 已解；真正未完成的是用 session evidence 校準 deny threshold、handoff structure 與 anti-spiral policy，不能只靠靜態 token 比例。
- **2026-09-05 補充**：v2.36.1 起子代理（l4–l6 工頭）的 T2 deny 已由 `foreman-guard.js` 讀 live 檔實作；本 row 只剩 **depth-0** 的 deny tier，仍待校準證據。
- **Effort**: M。
- **Source**: context-budget follow-up audit。

