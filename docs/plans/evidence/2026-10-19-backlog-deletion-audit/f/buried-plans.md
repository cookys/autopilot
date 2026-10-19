# 被埋 plan 稽核：docs/plans/ 頂層主 plan 的追蹤檢查表

稽核基準：HEAD（develop，6f46a571c）。唯讀。被埋定義：狀態欄不是 shipped/done/superseded/abandoned，且 (a) HEAD 版 docs/BACKLOG.md 與 docs/backlog/*.md 沒有帶 Trigger 的列指向它、(b) docs/projects/INDEX.md 的進行中表也沒記觸發條件或下一步、(c) docs/HANDOFF.md 沒有追蹤。

INDEX 現況說明：自 v2.36.80 起 INDEX 是 plan 登記簿，每份 docs/plans 的 plan 都必須有一列（Version 欄寫 `active`），所以「INDEX 有登記」本身不代表有人追；那些列只有標題，沒有觸發條件或下一步。因此 (b) 的欄值分「進行中表」「完成表」「僅登記簿」三種。(c) 全部 plan 都不在 HANDOFF.md（grep slug 皆 0）。

分類計數：非工作 5；狀態過期 43；狀態過期+已追蹤 1；已追蹤 10；被埋 3；半埋 3

## 一、被埋與半埋（需要補回追蹤）

結論：確認被埋 3 份（roundtable、cursor-cli-adaptor、cursor-transport-fallback；後兩份是同一件事），半埋 3 份（mods-visible-dispatch、dispatch-tree、workflow-snapshot-at-compaction）。其餘 59 份非 shipped 狀態欄的 plan，不是實際已出貨（只是狀態欄沒更新）、就是已有 BACKLOG 列或進行中表追蹤、或本身是調研／手冊／已棄。

「半埋」的定義：整份 plan 在 INDEX 進行中表有列，但該列只寫 active，沒有觸發條件；plan 內有明確未做且無人追的 phase，原本對應的 BACKLOG 列在 plan 建立時被 gate 刪掉。

### 被埋 1：docs/plans/2026-09-19-roundtable.md（已確認，即你發現的那份）
- 狀態欄原文：「Phase 0 done 2026-09-19, operator verdict: worth it; parked in BACKLOG until >=3 more manual rooms have run」。這句話是承諾，但 commit 5f3aa3b1d 刪掉了承載它的 BACKLOG 列，現在 BACKLOG 沒有。
- 刪掉的兩列（`git show 5f3aa3b1d -- docs/BACKLOG.md`）：
  1. 「roundtable Phase 1 - the /roundtable skill, distilled from several manual rooms」Status open、Trigger「>=3 more manual rooms have run under the Phase 0 protocol with an evidence dir each, OR the operator asks for the skill by name」、Effort L、Source operator 2026-09-19、Pointer 本 plan。
  2. 「roundtable - a non-Claude seat is addressed through the host's switchboard courier handle, not its Claude handle」Status open、Trigger「the next manual room seats a non-Claude harness (verify `fleet send --to <courier> --local <pane>` in and `fleet reply` out from the pasted frame)」、Effort S、Source Phase 0 finding F1、Pointer docs/plans/evidence/2026-09-19-roundtable/notes.md。
- 未完成：Phase 1（L，skill：skills/roundtable/SKILL.md、protocol.md、KR2/KR3）、Phase 2（S，hangar 跨 repo 慣例，KR4）、Phase 3（relay 層 room，plan 內已寫「deferred; BACKLOG」，BACKLOG 也沒了）。evidence 在 docs/plans/evidence/2026-09-19-roundtable/（notes.md、transcript.md、sends.jsonl），之後沒有新增 room 的證據。
- 是否其實已出貨：否。CHANGELOG 無 roundtable 字樣、repo 無 skills/roundtable、memory 與 .claude/knowledge 亦無。
- 建議補回：沿用原兩列。列 1 Trigger 同上，Trigger-Type: event（也可標 owner，因 operator 點名也算觸發），Effort L，Source/Origin owner。列 2 Trigger 同上，Trigger-Type event，Effort S，Origin self。Pointer 不要再指向 plan 檔本身，否則 gate 下次 --fix 又會刪（見下方「根因」）。

### 被埋 2：docs/plans/2026-08-26-cursor-cli-adaptor.md 與 被埋 3：docs/plans/2026-09-02-cursor-transport-fallback.md
- 狀態欄原文：
  - adaptor：「reviewed - 3 rounds / 6 generations, 44 blockers accepted and repaired, all terminal verdicts CONDITIONAL. Awaiting Board approval」（已過期；rail 實際已出貨，INDEX 完成表 2026-08-26 寫 Phase 1-4 落地）。
  - fallback：「Phases 1-4 shipped; Phase 5 is BLOCKED and Phase 6's admission is therefore not added」。
- 未完成：
  - adaptor Phase 5：`cursor-grok-4.6-high-fast` 的 Stage-1 implementer 資格考，INDEX 完成列寫「刻意未跑（真實 model spend，需 Board 授權）」。
  - fallback Phase 5/6：cursor 席位不得准入（`UNQUALIFIED_RUNNERS="cursor"` 維持），因 `qualification-review-provider.js` 的 `callCli()` cursor 分支無條件拒絕——cursor-agent 無法強制 tool-deny（docs/plans/evidence/2026-08-29-cursor-containment-probe/ 18 個探針證實）。解除條件寫在 plan 3.5：「cursor-agent 出真正的 catch-all deny 或能撐過 --force 的可攜 sandbox，然後完整重跑 18 個探針」。
  - 附帶事實：dispatch-author.sh 的 cursor 分支唯讀姿態只是 cooperative，已記在 references/hetero-dispatch.md。
- 是否其實已出貨：否（Phase 5 未跑，CHANGELOG 無資格考紀錄；BACKLOG 無任何 cursor 列）。
- 建議補回（一列即可，兩份 plan 共用）：Trigger「cursor-agent 發行新版且宣稱有 catch-all permissions.deny 或可攜 sandbox（重跑 docs/plans/evidence/2026-08-29-cursor-containment-probe 的 18 個探針）；或 owner 明確授權花錢跑 Stage-1 implementer 考」；Trigger-Type: event（外部發版）；Effort M（推估，未確認）；Origin self（owner 2026-09-02 經 twgs-revival peer 授權做 fallback，Phase 5 本身是 self 登記）。重要性：低到中，卡在外部，沒有緊迫性，但目前連「為何不准入」都只存在 plan 內。

### 半埋 4：docs/plans/2026-10-03-mods-visible-dispatch.md
- 狀態欄原文（節錄）：「R5.2 - P1W FROZEN 2026-10-04 ...」。INDEX 進行中表有列，只寫 active。
- 已做：P1a、P1c、P1W（CHANGELOG v2.36.115、3.0.0-alpha 條目）；P5 → BL-0110（docs/backlog/mods-p5-proxy-decision-reminders.md）；P6 屬分支 feat/mods-pane-navigation。
- 未做且無追蹤：P2（hook 延遲先量，產出 hook-latency-baseline.json，決定是否開 guard port plan）、P3（事件核心＋閒置：scripts/wake-events.js、hooks/idle-observe.js、declare-idle）、P4（work-round 投影、progress.json、scripts/portfolio-replan.js）。上述腳本在 scripts/、hooks/ 皆不存在，BACKLOG 無列，plan 內也沒有「不做」的裁決。memory 的 work-round-proposal-2026-10-03 說「repo 未改」。
- 是否其實已出貨：否（檔案不存在、CHANGELOG 無 wake-events／portfolio-replan／declare-idle）。可能已被 stage-graph／live-pane 路線取代：未確認，需 owner 裁。
- 建議補回：一列「mods P2-P4 要做或撤」，Trigger「owner 對 P2-P4 作成裁決（open-decision 面板）；或 3.0.0 final 切版前」，Trigger-Type: owner，Effort L，Origin owner（2026-10-03 三方設計討論，owner 開的）。

### 半埋 5：docs/plans/2026-10-13-dispatch-tree.md
- 狀態欄原文：「frozen (2026-10-13) after two plan-review generations ...」，後接 D0/3b/3d 進度。進行中表有列（active）。
- 已做：3a、3b（merged 92002f7f）、3c、3d（BL-0176）；BL-0174/0175 已出貨（CHANGELOG）。
- 未做且無追蹤：step 5（blocked：D0 row h 不過，stamp 改寫使 rail 指令變複合、allow 規則不再涵蓋）與 R（blocked：D0 row d2 對 kimi、agy、opencode 為 not_run；codex 已 pass）。plan 要求「修訂後再過一次 plan review 才能做 R」。fleet step 4 → BL-0144（有 Trigger）。
- 建議補回：Trigger「對 kimi／agy／opencode 跑 D0 row d2（d0-probe.sh）並有結果；或修好 row h」，Trigger-Type: event，Effort M，Origin self。

### 半埋 6：docs/plans/2026-10-13-workflow-snapshot-at-compaction.md
- 狀態欄原文：「active, size L (P1-P2 and P4 landed on branch feat/workflow-snapshot-at-compaction; P3 deferred)」。
- 已做：P1、P2、P4（CHANGELOG Unreleased 條目已寫）。
- 未做：P3（`/handoff` 讀快照、dev-flow 呼叫 task-card.js，S，plan 寫「deferred: guidance, needs eval ON/OFF evidence」）；以及「下一次真實自動壓縮要驗三件事」的 human-gated 項。原 BACKLOG 列「Workflow snapshot at compaction and /clear」已在 0a9c9efac 被刪；BL-0147 只涵蓋 T2 提示文字與間隔設定，不涵蓋 P3。
- 建議補回：Trigger「下一次真實自動壓縮發生後核對 snapshot 三項；P3 待 d-c9b50973 指引裁決與 eval 排程」，Trigger-Type: owner，Effort S，Origin self。

## 根因（供你修 gate 時參考）
- `check-plan-graduation.js` 的 `backlog_row_has_plan` 只要 Pointer 解析到「存在的 plan（含 sidecar、evidence 目錄）」就刪列，不論 plan 是否已出貨。roundtable 的 plan 與 INDEX 登記簿（只有標題、active）並不承載 Trigger，所以觸發條件永久失追。
- 同一個 commit 還刪了 15 個 Status: open 的列（其中 13 個 Pointer 指向 docs/plans 或其 evidence；含 ledger-rotation-order、disposition-resume-scope-sha、final-panel-per-seat-pins 三份已歸檔 plan 的 open 追蹤項，以及 blind-review 系列的 managed rail 缺陷）。逐條確認不在本次範圍；我只抽查 3 條（`_pf_err` 洩漏、`max_changed_files`、`max_wall_seconds` 14400）看起來已修，其餘以下幾條我沒找到修復證據，建議另跑一次列級稽核：「already-scrambled carry-only ledger segments cannot project」（CHANGELOG v2.36.77/73 只說重估為 L）、「reviewer no_verdict leaves phase REVIEWING which --resume refuses」、「Codex back on the qc panel: pin swap waits for a live cleanroom parse」、「a reviewer that self-revokes a MUST-FIX under a reused finding id is normalised...」、「next-touch-validation.test.sh reads symbolic-ref HEAD - always red in detached worktree」、「Managed rail never passes scorecard scope files - fallback_ladder always []」。狀態：未確認。
- 之後的 --fix 與關閉動作也刪過帶 open 狀態、Pointer 指向 plan／evidence 的列（417 個被刪列中 311 個狀態為 open，多數是正常修完刪除，無法逐條判別），完整清單在 /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/blaudit/f/deleted-rows.tsv。

## 低優先、未確認（舊 plan 的 deferred 項，不列為被埋）
- 2026-06-17-tmuxai-ponytail-absorptions（狀態欄 shipped）：Q1 stream-json「模型在發問」事件探針，plan 寫 spike-gated，無追蹤；陳舊（6 月），重要性低。
- 2026-06-22-ceo-fleet-autonomy（shipped）：「Deferred north star」表（完整 routing table、tree-engine 當工頭、多節點 fleet），多半已被後續 engine／L5／L6 取代，未確認。
- 2026-06-03-distill-handoff 第 2 項：llm-playground 的 .gitignore 需加 `!.claude/skills/`，屬他專案，未確認是否做了。
- INDEX「規劃中」表仍列 fable-skills absorption 為「已追蹤於 BACKLOG」，實際 plan 已 CLOSED-NOT-PURSUED 且 BACKLOG 無此列，INDEX 該列過期（可順手刪）。

## 二、完整檢查表

| plan | 狀態欄(原文節錄) | (a) BACKLOG | (b) INDEX | (c) HANDOFF | 判定 | 依據 |
|---|---|---|---|---|---|---|
| 2026-08-26-cursor-cli-adaptor | > **Status**: reviewed — 3 rounds / 6 generations, 44 blockers accepted and repaired, all | 無 | 完成表 | HANDOFF.md 無 | 被埋 | Phase 5(cursor-grok-4.6-high-fast 的 Stage-1 implementer 資格考)刻意未跑，需 Board 授權；BACKLOG/INDEX 皆無追蹤 |
| 2026-09-02-cursor-transport-fallback | > **Status**: Phases 1-4 shipped; **Phase 5 is BLOCKED and Phase 6's admission is | 無 | 完成表 | HANDOFF.md 無 | 被埋 | Phase 5 BLOCKED：cursor-agent 無法強制 tool-deny，cursor 席位不准入；解除條件=cursor-agent 出 catch-all deny 或可攜 sandbox 後重跑 18 個探針；BACKLOG/INDEX 皆無追蹤 |
| 2026-09-19-roundtable | > Status: **Phase 0 done 2026-09-19, operator verdict: worth it; parked in BACKLOG until ≥3 more manual rooms have run** · Owner: cookys (depth-0) · Branch: `develop` (do | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 被埋 | Phase 1 skill(L) 的觸發「再跑 ≥3 次手動 room 或 operator 點名」與 Phase 2/3 全數失追 |
| 2026-10-03-mods-visible-dispatch | > Status: R5.2 — P1W FROZEN 2026-10-04（G1＋G2 審查、depth-0 全數裁決、receipt check rc=0）；R4.4 = owner 2026-10-04 裁決：P1c band 改為「專案·phase·已跑·進度」加結論詞（C3）、新增 P5（代決策提醒，寫入先於讀取），不動 rub | 無；sidecar:mods-p5-proxy-decision-reminde | 進行中表 | HANDOFF.md 無 | 半埋 | P1a/P1c/P1W 已出貨；P2(hook 延遲量測)、P3(wake-events＋閒置)、P4(work-round/progress.json/portfolio-replan) 對應腳本不存在；P5 → BL-0110；P2–P4 無觸發也無「不做」裁決 |
| 2026-10-13-dispatch-tree | Status: **frozen** (2026-10-13) after two plan-review generations (G2 blockers ruled by the coordinator; receipts in [`evidence/2026-10-13-dispatch-tree/plan-review/`](ev | BACKLOG 有(2) | 進行中表 | HANDOFF.md 無 | 半埋 | 步驟 5(blocked: D0 row h)與 R(blocked: kimi/agy/opencode not_run)，進行中表只寫 active；fleet(step 4) → BL-0144 |
| 2026-10-13-workflow-snapshot-at-compaction | > Status: **active, size L (P1-P2 and P4 landed on branch `feat/workflow-snapshot-at-compaction`; P3 deferred)** · Owner: depth-0 · Source: BACKLOG row "Workflow snapshot | 無 | 進行中表 | HANDOFF.md 無 | 半埋 | P1/P2/P4 已進 CHANGELOG(Unreleased)；P3(/handoff 讀快照、dev-flow 呼叫 task-card.js，需 eval)被標 deferred，原 BACKLOG 列已被刪；BL-0147 只涵蓋 T2 文字與間隔設定 |
| 2026-07-04-surface-area-reduction | > Status: **B 組 ✅ Shipped in v2.31.16 — merged as `b940209` (2026-07-04)**；C 組（C1a Spike → C1b 鏡像改生成、C2 multiplexer）留存 BACKLOG。原審查紀錄：MiniMax-M3 兩輪 SHIP-AS-IS ＋ gpt-5.5 兩輪 | 無 | 完成表 | HANDOFF.md 無 | 已追蹤 | B 組已出貨 v2.31.16；C1 鏡像改生成 → BL-0029/BL-0030；C2 multiplexer 已出貨 |
| 2026-08-02-codex-payload-residual-spike | > Status: FROZEN FOR EXECUTION | BACKLOG 有(3)；sidecar:codex-payload-install-time-gen | 進行中表 | HANDOFF.md 無 | 已追蹤 | INDEX 完成；遺留 → BL-0029/BL-0030/BL-0214 |
| 2026-08-17-brain-seat-exam-suite | > Status: **FROZEN** (two-generation bounded review complete, 2026-08-17) · Owner: cookys / Claude session 2026-08-17 · Branch: develop (docs) → feat branch at expand · F | 無 | 完成表 | HANDOFF.md 無 | 已追蹤 | INDEX 完成；遺留 brain-seat sittings → BL-0041 |
| 2026-08-21-p6d-corrective-gates | > 狀態: ✅ Shipped in v2.34.32 — merged as cd66b62a(無狀態終形;durable lock 重入條件在 BACKLOG) | BACKLOG 有(2)；sidecar:durable-repair-lock-p6d-kr3.md | 完成表 | HANDOFF.md 無 | 已追蹤 | INDEX 完成；遺留 → BL-0035、BL-0042 |
| 2026-10-06-dev-flow-stage-graph | > Status: R2 FROZEN (G2 terminal, depth-0 adjudicated) · Owner: cookys · Branch: Train A on develop, Train B on `release/3.0.0` (§4) · Frame: guidance + mechanism, author | 無 | 進行中表 | HANDOFF.md 無 | 已追蹤 | 進行中表；3.0.0 版號暫停見 memory hold-version-at-3-0-0 |
| 2026-10-13-live-pane-design-system | Status: **frozen** (2026-10-13) after two plan-review generations (§10, §10.2, §10.3; receipts in [`evidence/2026-10-13-live-pane/plan-review/`](evidence/2026-10-13-live- | 無 | 進行中表 | HANDOFF.md 無 | 已追蹤 | 進行中表；逐 phase 未確認 |
| 2026-10-16-bl0194-qualification-registry-move | > Status: frozen after G2 (depth-0 terminal adjudication); owner decision d-1f0c5e99: A2 + B1 + C1. Cross-repo, phases P1-P4b. | BACKLOG 有(2) | 進行中表 | HANDOFF.md 無 | 已追蹤 | BL-0194 仍在 BACKLOG(P4b 待做) |
| 2026-10-18-subagent-budget-gate | > Status: active · Owner: cookys · Branch: lane/budget · Frame: L, one deliverable | 無 | 進行中表 | HANDOFF.md 無 | 已追蹤 | 進行中表，當日新建 |
| 2026-10-19-outcome-quality-gate | > Status: active · Owner: cookys · Frame: M, three deliverables (record writer, checker, hook wiring) | 無 | 進行中表 | HANDOFF.md 無 | 已追蹤 | 進行中表，當日新建 |
| 2026-10-19-t14-per-turn-gate-experiment | > Status: S1-S6 done, verdict FAIL (FAIL-TRADE). Report: docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report.md · Owner: cookys · Branch: lane/bl0055 · Frame: | 無 | 進行中表 | HANDOFF.md 無 | 已追蹤 | 實驗完成 FAIL-TRADE；BL-0055 仍開(Trigger: 新 plan) |
| 2026-06-26-domain-aware-roster | > **Status**: Draft (R4 — converged after gpt-5.5 xhigh rounds 1→4; R4 raised 0🔴, spec-precision only) · for review before code | 無；sidecar:domain-aware-routing-consume-t | 完成表 | HANDOFF.md 無 | 狀態過期+已追蹤 | telemetry 已出貨(INDEX 2026-06-26 probe-diff-domain)；deferred 的 routing 在 BL-0067 |
| 2026-06-04-internalize-superpowers-trio | > **Status**: PROPOSED (via `research-to-ship`, 2026-06-04). Board chose all 3 HIGH candidates, build | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | CHANGELOG v2.13.0 已出貨(brainstorm skill、plan-template、verification 規則) |
| 2026-06-26-ecosystem-standalone-and-onboard | > **Status**: **Approved (R1)** — Board approved 2026-06-26. Resolved: v1 skill = **full** (scaffold + | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-06-27 onboard skill 已出貨 |
| 2026-06-26-onboarding-readme-revamp | > **Status**: Draft (R0) — ready for `/l5 gpt-5.5 xhigh` | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-06-26；CHANGELOG v2.25.12 |
| 2026-06-26-triage-superpowers-footprint | > **Phase**: P0 of `2026-06-26-ecosystem-standalone-and-onboard.md` (no code; gate before any edit). | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | 為上一份 plan 的 P0，隨 onboard 出貨 |
| 2026-06-27-auto-handoff-rework | > **Status**: Design converged via 3-round decorrelated gpt-5.5 xhigh review (2🔴+3🟠+2🟡 → 1🟠+2🟡 → writer-atomicity → conditional SHIP-AS-IS). Ready for `/l5`. | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-06-27 已出貨 |
| 2026-06-27-opt-in-hooks-config-enablement | (無狀態欄) | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-06-27 已出貨 |
| 2026-07-01-cross-harness-engine-infrastructure | > Status: CONVERGED R3 - Codex + agy non-Claude review loop returned SHIP-AS-IS; ready for human approval. | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表有 Phase 7(2026-07-02)與 engine hardening 列；Phase 0–6 逐項未確認；內 7 個未勾框是審查前置檢查表，非工作項 |
| 2026-07-08-l6-resilience-improvements | > 2026-07-08。v1（5 個獨立 patch）經 hetero 三家族 loop-review（codex/agy/MiniMax）一致判 FIX-THEN-SHIP/RECONSIDER：**5 patch 治標，根因＝缺統一 orchestrator 狀態機 + single-source-of-truth**。Board  | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-08 已出貨(R0–R5) |
| 2026-07-09-worktree-teardown-seam | > Status: **READY FOR IMPLEMENTATION** — converged through a 4-round heterogeneous loop-review (2026-07-09). **Do NOT collide with the in-flight `dispatch-model-guard` (d | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | CHANGELOG v2.32.14 已出貨 |
| 2026-07-14-loop-convergence-gates | **Status**: ✅ Implemented on feature/loop-convergence-gates (v2.32.31) — all 5 gates landed; gates 1+3 red-case proven (7 real incident fixtures TRIP; healthy + boundary  | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-14 已出貨 |
| 2026-07-17-identity-containment-port | (無狀態欄) | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-17 已出貨 |
| 2026-07-18-codex-author-transport-hardening | **Status**: In progress — implementation authority granted; Track B remains locked | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | Track A 已出貨 v2.32.54；Track B 屬 Mnemos 專案，非 autopilot 工作 |
| 2026-07-26-review-scope-stop-loss | Status: approved by user on 2026-07-26. | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-26 已出貨 |
| 2026-07-29-bounded-backlog-intake | Status: frozen review intake; no implementation is authorized by this document. | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-29 已出貨 |
| 2026-07-29-durable-continuation-identity | (無狀態欄) | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-29 runtime-convergence-mvp |
| 2026-07-30-controller-execution-discipline | (無狀態欄) | 無 | 進行中表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-30 已出貨 |
| 2026-07-30-repair-lineage-convergence | (無狀態欄) | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-30 已出貨 |
| 2026-07-31-correctness-gates | status: approved | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-31/08-01 已出貨 |
| 2026-07-31-evidence-eval-truth | status: approved | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-31/08-01 已出貨 |
| 2026-08-01-backlog-convergence-plan-set | status: approved | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-07-31/08-01 已出貨 |
| 2026-08-02-hook-test-harness-determinism | > Status: FROZEN FOR EXECUTION | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-02/03 已出貨 |
| 2026-08-02-review-path-efficiency | status: frozen-for-execution | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-02/03 已出貨 |
| 2026-08-02-reviewer-output-token-budget | > Status: FROZEN FOR EXECUTION | 無 | 進行中表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-02/03 已出貨 |
| 2026-08-02-skill-transport-implementer-arm | > Status: FROZEN FOR EXECUTION | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-02/03 已出貨 |
| 2026-08-03-next-touch-debt-retirement | status: implemented | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-05：A01–A14 retired |
| 2026-08-04-platform-capability-trigger-activation | status: review-pending-r4 | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-04/05 D1–D4 / D1–D3 已出貨 |
| 2026-08-05-codex-native-lifecycle-enforcement | status: reviewed_conditional | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-04/05 D1–D4 / D1–D3 已出貨 |
| 2026-08-05-codex-native-lifecycle-enforcement-amendment | status: review_pending | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-04/05 D1–D4 / D1–D3 已出貨 |
| 2026-08-18-verification-author-suite | > 狀態: ⛔ STOPPED at G2 terminal (generation cap with accepted blockers) — NOT approved for implementation; Board decision required for any v3 redesign | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-18 已出貨 |
| 2026-08-18-verification-author-suite-v3 | > 狀態: ✅ Shipped in v2.34.17 — merged as `99c618d9`（frozen at v3-G2 terminal with depth-0 adjudication; implemented P1-P5 + two-round implementation review） | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | INDEX 完成表 2026-08-18 已出貨 |
| 2026-08-20-multiturn-event-harness | Status: R2 (post-G1 restructure). Owner ruling 2026-08-18 (option B). Evidence base: | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | commit 42a584b86「campaign CLOSED on Phase A (Board ruling)」；evidence 有 phase-a-adjudication.md；INDEX 無完成列 |
| 2026-08-21-panel-progress-view | > 狀態: ✅ Shipped in v2.34.30 — merged as f9aecfca | 無 | 完成表 | HANDOFF.md 無 | 狀態過期 | （狀態欄已標 shipped v2.34.30） |
| 2026-09-12-input-containment-gates | > Status: **R0 — DRAFT** (depth-0, 2026-09-12) · Deliverable node: `p23-input-containment-gates` · | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | P1–P5 皆已合併(merge(p23)、INDEX 進行中→歸檔列 v2.36.28/29)；狀態欄仍寫 R0 DRAFT |
| 2026-09-12-integration-ledger-and-marker-gates | > Status: **R0 — DRAFT** (authored depth-0, 2026-09-12) · Owner: depth-0 session under CEO delegation · | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | P1–P5 皆已合併(merge(p23)、INDEX 進行中→歸檔列 v2.36.28/29)；狀態欄仍寫 R0 DRAFT |
| 2026-09-17-blind-review-cleanroom-intake | > Status: draft for plan hetero loop · Size: L · Base: `d7912c7e` (v2.36.62 shipped, 1b-A merge `94d44940`) · Parent: | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | INDEX 登記簿列 v2.36.59–69 已出貨；狀態欄仍寫 draft |
| 2026-09-17-blind-review-cleanroom-launcher | > Status: draft for plan hetero loop · Size: L · Base: `ceb7c81d` (v2.36.61) · Parent plan: | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | INDEX 登記簿列 v2.36.59–69 已出貨；狀態欄仍寫 draft |
| 2026-09-17-blind-review-packet-deny-config | > Status: draft for plan hetero loop · Size: M · Base: `6a414c3c` (v2.36.63 shipped; 1b-B merge `bc4ea99e`) · Parent: `docs/plans/2026-09-16-blind-review-packet.md` | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | INDEX 登記簿列 v2.36.59–69 已出貨；狀態欄仍寫 draft |
| 2026-09-17-blind-review-packet-engine | > Status: draft for plan hetero loop · Size: L · Base: `bee8da3d` (v2.36.60) · Parent plan: | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | INDEX 登記簿列 v2.36.59–69 已出貨；狀態欄仍寫 draft |
| 2026-09-18-blind-review-panel-parallel | > Status: draft for plan hetero loop · Size: L · Base: `aab9523d` (v2.36.64) · Parent: | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | INDEX 登記簿列 v2.36.59–69 已出貨；狀態欄仍寫 draft |
| 2026-09-18-blind-review-panel-standby | > Status: draft for plan hetero loop · Size: M · Base: `aeea2ca7` (v2.36.65) · Parent: | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | INDEX 登記簿列 v2.36.59–69 已出貨；狀態欄仍寫 draft |
| 2026-09-18-blind-review-panel-station | > Status: draft for plan hetero loop · Size: L (two independent deliverables) · Base: `9a0dac5b` (v2.36.67) · Parent: | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | INDEX 登記簿列 v2.36.59–69 已出貨；狀態欄仍寫 draft |
| 2026-09-19-blind-review-2d-overlap | > Status: frozen g2 (2026-09-19) — ready for implementation as two managed campaigns · Size: L (two independent deliverables) · Base: `b3e7b6f6` (v2.36.72) · Parent: | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 狀態過期 | D2 出貨 v2.36.77；D1(station overlap)已於 commit 3b3eca49f 裁定不做並關 BL-0016 |
| 2026-10-17-review-only-campaign-fix-increment | > Status: D1-D5 landed (2026-10-17), default `adoption.return_review` stays `full`; D5 evidence in `evidence/2026-10-17-review-only-increment/README.md`; flipping the def | BACKLOG 有(2)；sidecar:affected-suites-selects-nearly | 進行中表 | HANDOFF.md 無 | 狀態過期 | D1–D5 已出貨；D5 實測無節省，default 維持 full，決定已下(CHANGELOG) |
| 2026-06-03-distill-handoff | (無狀態欄) | 無 | 完成表 | HANDOFF.md 無 | 非工作 | 交接筆記；項目已出貨(v2.9.0/2.10.0)；其 open item 2(llm-playground .gitignore) 屬他專案 |
| 2026-07-08-fable-skills-absorption | > Status: CLOSED-NOT-PURSUED (Board CEO-delegated ruling 2026-08-23) — largely superseded by evidence-discipline promotion, skill-contract-card, and review checklists; re | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 非工作 | CLOSED-NOT-PURSUED(2026-08-23)；但 INDEX「規劃中」表仍寫「實作需 Board 決定，已追蹤於 BACKLOG」——BACKLOG 實際沒有此列，INDEX 該列過期 |
| 2026-08-14-strict-l5-policy-refresh | (無狀態欄) | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 非工作 | 操作手冊(模型出新版時更新 strict-L5 roster)，非待辦 plan；CHANGELOG 有引用 |
| 2026-08-16-four-layer-redesign-survey | (無狀態欄) | 無 | 完成表 | HANDOFF.md 無 | 非工作 | 調研(survey)；四層 redesign 已出貨 v2.34.11 |
| 2026-08-18-skill-onoff-instrument-repair | **Status**: R2 FROZEN, **RETIRED — owner ruled option B (2026-08-18)**. Neither Phase 1 nor | 無 | 僅登記簿(active/無觸發) | HANDOFF.md 無 | 非工作 | RETIRED(owner 裁 B, 2026-08-18)，已棄；僅作約束紀錄 |
