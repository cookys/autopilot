---
id: 01M7894Y5TR235H8T0EMEKFTRE
kind: issue
created: 2026-10-12T00:00:00.000Z
---
- **Since**: 2026-10-12
- **Problem**: 一個專案的工作要派到另一個專案的程式庫去做時，目前沒有規則說明該用哪個專案的工作樹、標記檔與交接文件。當初規劃工作樹位置規則時，刻意把這一項延後。 (draft)
- **Impact**: 跨專案派工時各 session 可能各做各的、交接位置不一致；平常很少遇到。 (draft)
- **Trigger**: 3.0.0 之後；the first real cross-repo dispatch that goes wrong (worktree, marker or handoff location disagrees)
- **Source**: worktree-placement gap 5, deferred by the plan (D12), 2026-10-12
- **Pointer**: project/backlog/worktree-and-handoff-placement-has-no-rule.md
- **Context**: Owner 2026-10-17: keep as is, set no rule now; decide when a real case appears. Rails resolve placement from their own --from repo root; nothing says which repo root, marker or handoff a cross-repo run uses.
