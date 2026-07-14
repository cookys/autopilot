# dispatch-branch-lifecycle — session-end 整合候選 gate + repo-branch reaper + 中間輪收斂

> Source: 2026-07-14 codex-worktree audit（`/home/twgs-dev/reports/2026-07-14-codex-worktree-audit.md`）§5 autopilot 側修法；BACKLOG「Dispatch-branch lifecycle」條目。
> Board 指令：CEO 寫 plan → hetero engine loop review 收斂 → 實作。

## OKR

**Objective**: 把「merge-back + branch/worktree GC 由 depth-0 負責」從純 prose 責任降級為 deterministic 工具 + gate，讓 TWGameProject 式殘骸（70 條 branch + 46-commit 整合候選懸空）成為結構上不可能靜默發生的事。

**Key Results**:
1. **KR1 — session-end gate**: finish-flow / front-door 收尾時存在一個 deterministic 檢查：dispatch-owned 整合候選 branch（`ceo-integration-candidate-*` 等）存在且 ahead>0 ⇒ 擋 clean exit、要求 merge/保留記 handoff/丟棄三選一明確裁決。
2. **KR2 — reaper 工具**: `scripts/reap-dispatch-branches.sh` 存在且 preserve-first：contained（`merge-base --is-ancestor`）⇒ bundle 存證後刪；未 contained ⇒ 保留並列出。絕不 fail-open 刪未存證內容。
3. **KR3 — 中間輪收斂**: 整合成功後被取代的 `-r<n-1>` 中間輪 branch 有明確 lifecycle（工具支援 + prose wiring），不再無限累積。
4. **KR4 — 品質**: plan 經 hetero loop review 收斂（無未決 Critical/Major）；實作測試綠（fixture repo red/green）；`preflight-portability.sh` 過；版號 PATCH bump + 文件三處落地。

## Scope（Hold — L-1.5 audit 結果）

| Dimension | In/Out | Note |
|-----------|--------|------|
| Source | IN | 新 `scripts/reap-dispatch-branches.sh`；gate wiring（finish-flow L-5.x + level-front-door §4/§5）；orphan-log prune 小修 |
| Tests | IN | `hooks/tests/reap-dispatch-branches.test.sh`（fixture repo、red/green） |
| Docs | IN | CLAUDE.md inventory row、`references/hetero-dispatch.md` branch-lifecycle 節、CHANGELOG |
| Version | IN | PATCH（新 script + gate 為 shipped-code 行為） |
| Codex payload | IN | 觸及 `skills/finish-flow` / `skills/ceo-agent/references` ⇒ `sync-codex-plugin-skills.sh`（pre-commit gate 會抓） |
| Consumers | IN | /l4-/l6 front-door prose 引用新工具 |
| TWGameProject 殘骸執行 | OUT | 使用者 2026-07-14 裁決全部擱置；本專案只出工具，不對該 repo 動手 |
| codex-native spawn_agent 納管 | OUT | 獨立 BACKLOG 條目 |
| E1 manifest 合規 gate | OUT | 獨立 BACKLOG 條目 |
| Migration / API | N/A | 無 |

## Phases

| Phase | Content | Status |
|-------|---------|--------|
| P0 | Plan 撰寫（docs/plans/2026-07-14-dispatch-branch-lifecycle.md） | pending |
| P1 | Hetero loop review of plan（agy Gemini + cc-shim GLM/MiniMax，收斂至無 Critical/Major） | pending |
| P2 | 實作（TDD：fixture tests 先行） | pending |
| P3 | 實作 diff hetero review loop + 文件 wiring | pending |
| L-5 | finish-flow（quality gate → merge develop → archive） | pending |

## 已知限制（引擎面）

codex quota 死至 2026-07-20、grok 402 ⇒ review 面用 agy（Gemini 3.5 Flash (High)）+ cc-shim `--endpoint glm|minimax`（endpoints 已驗活）。跨家族去相關成立（Google + Zhipu/MiniMax vs 實作方 Anthropic-inline）。
