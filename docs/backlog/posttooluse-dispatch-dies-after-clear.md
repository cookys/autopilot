# PostToolUse dispatch dies after /clear

No sidecar existed in history. Original row text from 5d0b29c1d^:docs/BACKLOG.md. Effort is recorded as M (the open work is the detection spike; the docs item already shipped).

> ### PostToolUse dispatch dies after `/clear` — process restart required（verified）
> - **Trigger**: 下次有 user 回報 intent-capture / audit-log / reload-watch 在 long-running session 沒更新；或 Claude Code 升級 release notes 提到 hook dispatch 變更
> - **Context**: 2026-05-14 三階段觀察，verified via fresh-process test. Phase 1: post-reload intent-capture stagnates. Phase 2: after /clear in the same session every PostToolUse hook stops firing and reload does not re-init dispatch. Phase 3: a fresh claude process brings the matcher back.
> - **Verified hypothesis**: Claude Code PostToolUse dispatch table is initialized once at process boot.
> - **Workaround**: full exit and relaunch (not /clear, not reload).
> - **Impact**: v2.7.2 cross-session intent recovery dies in a long-running session after /clear; the user does not notice the hooks are dead.
> - **Next step options**: (a) detection spike before any code — empirically check what the session id does across startup, clear, and compact; the v2.8.1 dialectic ruled the naive heuristic non-functional. (b) upstream report asking for PostToolUse re-init on /clear. (c) docs section shipped in v2.8.1.
> - **Effort**: M
> - **Source**: 2026-05-14 v2.7.2 post-`/clear` diagnostic + fresh-process verification; 2026-06-02 v2.8.1 hook-followups dialectic (KR2 deferred → docs-only)

Audit finding (section 3.3, dropped by 5d0b29c1d): docs shipped; the detection spike and the upstream report were never done. Origin self. Trigger-Type event.

Restored 2026-10-19 from 5d0b29c1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
