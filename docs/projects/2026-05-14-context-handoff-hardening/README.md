# Context-Handoff Hardening — v2.7.2

**Status**: 🟡 In progress — L-1 setup
**Plan doc**: [`docs/plans/2026-05-14-context-handoff-hardening.md`](../../plans/2026-05-14-context-handoff-hardening.md)
**Branch**: `feat/v2.7.2-context-handoff-hardening`
**CHANGELOG**: pending v2.7.2 entry

---

## Project Goal

> **Final goal**: 解決使用者痛點「Claude Code auto-compact 經常丟掉重要 context」。在 compact 觸發時，由 **hook 自己**（不靠 Claude 合規 append）抽 transcript 寫出 survive-compact 的完整 handoff；SessionStart 看得到 last intent，resume 不再仰賴 Claude 上次有沒有自願寫對。
>
> **Success criteria**:
> 1. PreCompact 時，`hooks/state-checkpoint.sh` **不再依賴** Claude 合規 Edit-append。Hook 用 `jq` 從 `transcript_path` 直接撈最後 N 個 user/assistant turn 寫進 compaction-state.md。LLM-append 變 bonus、不是 load-bearing。
> 2. 新增 PostToolUse hook 每次 tool-use 結束時寫 rolling `~/.autopilot/last_intent.json`（sibling file，不在 transcript 內 → compact 不會碰）。
> 3. `hooks/session-start.sh` 開頭顯示 last_intent.json + compaction-state.md 的 resume hint。**不自動 rehydrate TaskList**（per Architect 對 Claude Code internal API 耦合的警告）。
> 4. 零 per-prompt 網路呼叫（pulled `count_tokens()` API approach per Ops + Architect review）。
> 5. 零既有 daily-driver UX regression（既有 9 hooks 行為不變、新 hook fail-open 沿用 large-file-warner 風格）。
> 6. 通過 think-tank 3-reviewer plan review，且 think-tank-dialectic 不需被觸發（HIGH consensus）。
>
> **Scope boundary**: 純 hooks/ + docs/。**不動 16 skills body**（這是 hook-layer 工作）、**不動 settings.json schema**（無法控 compact threshold）、**不寫 TaskList auto-rehydrate**（Architect REJECT-rationale）、**不打 count_tokens API**（Ops REJECT-rationale）。

## Phases

| # | Phase | Status | Commit |
|---|-------|--------|--------|
| L-1 | Project setup（README + INDEX + branch + L-1.5 + L-1.6 + L-5 forcing functions） | 🟡 in progress | — |
| L-2 | Plan doc | — | — |
| L-2.5 | 3-reviewer plan loop（max 3 rounds per finish-flow norm） | — | — |
| P1 | `hooks/state-checkpoint.sh` 改用 jq 自抽 transcript（Architect Move 1） | — | — |
| P2 | New PostToolUse hook：rolling `last_intent.json`（Architect Move 2） | — | — |
| P3 | `hooks/session-start.sh` 顯示 resume hint（Architect Move 3 簡化版，不做 TaskList rehydrate） | — | — |
| L-5 | finish-flow（Final Goal Review → Pre-Merge Review → Merge → Post-Merge Review → Archive → L Session End） | — | — |

## Review Background

本專案的設計**已先經過 3 reviewer 否決一輪**。詳細：

- **Initial proposal** (this session, before CEO mode): 3-layer design — (1) UserPromptSubmit + `count_tokens()` proactive threshold detection at 75%；(2) PreCompact exit 2 block + state.md；(3) SessionStart auto-rehydrate TaskList.
- **3-reviewer think-tank** (Architect / QA Devil / Ops/SRE):
  - **Architect: REJECT** with named alternative — root cause 不是「沒 handoff doc」，而是「Claude 的 append 步驟 best-effort、load 高時被跳」。提案的 3 層全部 sidestep 根因。
  - **QA Devil: REJECT (High)** — 7 個失敗模式列表，#1 整套仍依賴 LLM 自願寫 state.md（與原痛點同根因），#2 PreCompact exit 2 livelock，#4 multi-session race，#5 state.md vs git HEAD divergence。最毒一句：「使用者會結論 compact 比較好，至少它沒騙我說它記得什麼」。
  - **Ops/SRE: CONDITIONAL** — `count_tokens()` 在 hot path 違反 latency budget，network on every prompt 是 footgun。
- **Consensus convergence**: 痛點根因是 prompt reliability，不是 architecture。**3 人一致推 Architect 的替代設計**：hook 自己 jq 撈 transcript（零 LLM 合規依賴）+ PostToolUse Stop boundary 寫 sibling file + SessionStart 顯示 hint（不 rehydrate）。

本 plan 採納收斂後的設計。原 3 層被否決的設計記錄在這份 README 上方供未來避坑。

## Risks（pointer to plan §5）

主要 3 項預估風險（plan 寫好後詳細展開）：
1. PreCompact stdin JSON 格式變動 → hook jq query 壞掉。緩解：document Claude Code version tested、hook fail-open。
2. PostToolUse 過於頻繁 → `last_intent.json` 寫入競爭 / disk wear。緩解：節流 + atomic write。
3. SessionStart 顯示太多資訊噪音 → user 忽略。緩解：限制顯示 行數 + 用 `⚠` glyph 對齊既有 hook 慣例。

## Files touched (estimate)

**新增（3）**：
- `docs/plans/2026-05-14-context-handoff-hardening.md` — plan doc
- `docs/projects/2026-05-14-context-handoff-hardening/README.md` — 本檔
- `hooks/intent-capture.sh`（或 .js）— PostToolUse hook

**修改（4-5）**：
- `hooks/state-checkpoint.sh` — Phase 1 改寫
- `hooks/session-start.sh` — Phase 3 加 resume hint
- `hooks/hooks.json` — register new PostToolUse hook
- `docs/projects/INDEX.md` — 進行中 row
- 可能 `README.md` / `CHANGELOG.md` v2.7.2 entry（待 finish-flow L-5）

## Next step

進 L-1.5 Scope Completeness Audit → L-1.6 Skill routing → L-2 plan doc → L-2.5 reviewer loop。
