# Investigate the /reload-plugins hook count discrepancy

No sidecar existed in history. Original row text from 5d0b29c1d^:docs/BACKLOG.md.

> ### Investigate `/reload-plugins` hook count discrepancy
> - **Trigger**: 下次有人寫 reload-watch 邏輯時，或 Claude Code update 改 hook reload semantics
> - **Context**: 2026-05-14 v2.7.2 post-reload 觀察 `/reload-plugins` 回報「11 hooks」但 hooks.json 實際 13 entries (1 PreCompact + 1 SessionStart + 3 PreToolUse + 6 PostToolUse + 2 Stop)。差 2 — 可能忽略 SessionStart 或 PreCompact runtime hook count。Live functionality OK（intent-capture 確認 firing post-reload）
> - **Effort**: S
> - **Source**: 2026-05-14 v2.7.2 post-ship reload verification

Audit finding (section 3.3, dropped by 5d0b29c1d): cosmetic; a small investigation never done. Origin self. Trigger-Type event. Effort S.

Restored 2026-10-19 from 5d0b29c1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
