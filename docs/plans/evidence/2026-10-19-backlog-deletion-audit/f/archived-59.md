# commit 5f3aa3b1d 歸檔的 59 份 plan：是否「沒出貨卻被歸檔」

方法：`git show --name-status -M 5f3aa3b1d` 取 R 開頭、docs/plans/ 頂層 *.md 且檔名不含附屬後綴者，共 59 份主 plan（另有 19 份 .rubric.md 等附屬檔隨行，不計）。狀態欄取 `5f3aa3b1d^` 版 plan 的前 25 行；CHANGELOG 命中取 `5f3aa3b1d^:CHANGELOG.md` 已釋出 `## v…` 段落（排除 Unreleased），字面比對 stem 或去掉日期的 slug，前後界限為 [A-Za-z0-9-] 以外字元（同 gate）。判定欄「出貨」＝狀態欄自述出貨，或該版標題／Headline 直接以此 plan 為內容，或程式碼與 INDEX 完成列可佐證。

統計：出貨 51；可疑 2；部分出貨 4；可疑(已追蹤) 1；未確認 1

| # | plan | 當時狀態欄 | CHANGELOG 命中段落(版本×次數) | 判定 | 依據 |
|---|---|---|---|---|---|
| 1 | 2026-04-11-think-tank-dialectic | **狀態：** ✅ Phase 1 完成 — v2.2.0 已 merge 到 develop 並 push | v2.32.52×2, v2.31.16×3, v2.13.1×1, v2.12.0×1, v2.7.7×1, v2.7.0×1, v2.2.1×1, v2.2.0×16 | 出貨 | 狀態欄 Phase 1 完成、v2.2.0；CHANGELOG 命中只是後續版本引用，但 INDEX 歷史債列已記 v2.2.0 |
| 2 | 2026-04-12-methodology-agents-and-hooks | **狀態：** ✅ Shipped in v2.4.0 — merged to develop as `14276bb` on 2026-04-12 | v2.4.0×1 | 出貨 | 狀態欄自述已出貨 |
| 3 | 2026-05-14-context-handoff-hardening | **狀態：** ✅ Shipped in v2.7.2 — merged to develop as `670cc23` on 2026-05-14 (implementation: `6780a2b`) | v2.7.2×1 | 出貨 | 狀態欄自述已出貨 |
| 4 | 2026-05-14-eval-router-judge | **狀態：** 📋 Proposal — pending review / sequencing | v2.7.2×1 | 可疑 | 狀態欄 Proposal；CHANGELOG v2.7.2 只寫「Eval-proxy clarification + router-judge plan (01ad396)」＝寫了 plan，沒建 harness。repo 內無 router-judge 腳本。BACKLOG/INDEX 無追蹤（INDEX 僅列為「referenced in CHANGELOG」的 plan-only record） |
| 5 | 2026-05-14-reload-plugins-agent-invokable | **狀態：** ✅ Option D shipped (commit `a80c19d`, develop) — short-term remediation in place; Option A (Claude Code core agent-invokable reload) tracked a | v2.7.1×2 | 出貨 | 狀態欄自述已出貨 |
| 6 | 2026-05-14-retro-roundup | **狀態：** ✅ Shipped in v2.7.3 — merged to develop as `57c88ee` on 2026-05-14 | v2.7.3×3 | 出貨 | 狀態欄自述已出貨 |
| 7 | 2026-05-14-superpowers-coexistence | **狀態：** ✅ Shipped in v2.7.0 — merged to `develop` as `eb70999` on 2026-05-14 | v2.25.12×1, v2.7.1×1, v2.7.0×2 | 出貨 | 狀態欄自述已出貨 |
| 8 | 2026-05-14-test-suite | **狀態：** 📋 Proposal — pending sequencing | v2.7.5×1 | 出貨 | 狀態欄過期(Proposal)；CHANGELOG v2.7.5 Test Suite Foundation 實作並引用此 plan，hooks/tests 現已龐大 |
| 9 | 2026-05-22-multi-agent-portability-correction | **狀態：** 📝 Draft — pending user review | v2.17.2×1, v2.7.3×2 | 出貨 | 狀態欄過期(Draft)；v2.7.3 Multi-Agent Portability Correction 為其出貨 |
| 10 | 2026-06-02-hook-transcript-pivot | > **Status**: spike done (GO) → foundation build → live timing gate → rewire/re-enable | v2.8.0×1 | 出貨 | 狀態欄是進度條；v2.8.0 Hook transcript pivot 為其出貨 |
| 11 | 2026-06-02-skill-leverage-extraction | > **Status**: review round 1 complete (Architect/Ops/Skeptic) → revised → scope pending Board confirm | v2.7.7×1 | 部分出貨 | v2.7.7 出貨，並寫明 think-tank-dialectic、ceo-agent 抽取被評估為負 ROI 而否決＝縮減版；狀態欄「scope pending Board confirm」過期 |
| 12 | 2026-06-04-distill-consolidate | > **Status**: PROPOSED. Revisits §0.3.1 (DEFERRED post-R3) of `docs/plans/2026-06-03-distill-skill.md`. | v2.11.1×1, v2.11.0×3 | 出貨 | v2.11.0 distill cross-machine consolidate |
| 13 | 2026-06-04-parallel-read-fanout | > **Status**: PROPOSED (via `research-to-ship`, 2026-06-04, after 3 research rounds + an empirical | v2.12.2×1 | 部分出貨 | 狀態欄 PROPOSED；v2.12.2 只出貨文件規則(team cap-3、無平行 code-mutation)，plan 提的其他部分以 descoped 為準；無追蹤 |
| 14 | 2026-06-04-review-verify-barrier | > **Status**: PROPOSED (via `research-to-ship`, 2026-06-04). **Frame**: autopilot self-sufficiency — | v2.12.3×1, v2.12.1×1 | 部分出貨 | 狀態欄 PROPOSED；v2.12.1/v2.12.3 出貨縮減版(reviewer live-fact 規則、claim-completeness)，CHANGELOG 寫明 descoped 較大提案 |
| 15 | 2026-06-12-task-tree-engine | > **Status**: ✅ Shipped in v2.16.0 — merged as 569a8b2 (2026-06-12) | v2.25.4×1 | 出貨 | 狀態欄 v2.16.0；CHANGELOG 命中(v2.25.4)只是順帶引用，出貨本體在 v2.16.0 段落未用 slug 命名 |
| 16 | 2026-06-23-l4-l5-dep-graph-fanout | **Status**: dialectic **CONVERGED (round 2)** → **DESCOPED** (see review log). This is a | v2.25.4×1 | 可疑(已追蹤) | 狀態欄 DESCOPED(S0 spike＋S1 guard，Phase L 條件式)；CHANGELOG 命中 v2.25.4 是 finish-flow 分支清理的順帶提及(branch 名)，不是出貨它。實況：/l4 同質 fan-out 已出貨，/l5 異質 fan-out 機制「做好但刻意不接」→ HEAD BACKLOG BL-0070 有 Trigger 追蹤 |
| 17 | 2026-06-25-test-integrity-gate | > Status: **P1a IMPLEMENTED & VERIFIED**(branch `feat/test-integrity-gate-p1a`;待 ship）。override = fail-safe stub,完整 provenance → L1 project。見 §9 實作紀錄。 | v2.25.7×1, v2.25.6×1 | 出貨 | P1a 出貨 v2.25.6/v2.25.7；override 完整 provenance 與 L1 block 模式 → BL-0068、BL-0060 追蹤 |
| 18 | 2026-06-26-trust-tiered-review-policy | > **Status**: design draft → gpt-5.5 xhigh adversarial review loop (2026-06-26). Round 1: FIX-THEN-SHIP | v2.25.11×1 | 部分出貨 | v2.25.11「Implements the buildable core」；其餘(local 席 future-gated、shadow→gate) 部分見 BL-0069，其他未確認；狀態欄 design draft 過期 |
| 19 | 2026-06-27-update-checker | > **Status**: Design CONVERGED via 3-round gpt-5.5 spec-review (4🟠+2🟡 → 2🟠 → SHIP-AS-IS). Ready for hetero impl. | v2.26.4×1, v2.25.16×2 | 出貨 | v2.25.16 update-checker；CHANGELOG 命中含 v2.25.16 標題 |
| 20 | 2026-06-30-hetero-engine-lifecycle-methodology | > Status: **CONVERGED v8** — ready for human approval → expand to a tracked project. | v2.26.11×1 | 出貨 | v2.26.11 methodology v1，段落直接引用 plan |
| 21 | 2026-07-02-engine-capability-state | > Status: Proposal R0 - authored while CC is actively repairing the repo; do not implement until the current repair branch/worktree is stable. | v2.36.46×1, v2.36.24×1, v2.35.9×1, v2.34.14×1, v2.34.12×1, v2.32.58×2, v2.32.55×2, v2.32.53×1, v2.32.50×2, v2.32.44×1, v2.32.29×1, v2.31.2×5 | 未確認 | 狀態欄 Proposal R0(「CC 修復完成前不要實作」)；CHANGELOG 命中都只是在別的版本引用 scripts/engine-capability-state.js；腳本確實存在(strike、pin-seat、brain-status)，由後續 plan 建出，無法證明此份 R0 被整份執行 |
| 22 | 2026-07-03-endpoints-cli | - **Status**: ✅ Shipped in v2.31.8 — merged as `be663af` | v2.32.22×1, v2.31.8×2 | 出貨 | 狀態欄自述已出貨 |
| 23 | 2026-07-04-quality-floor-engine | **狀態**: ✅ COMPLETE + campaign R1 executed (v2.31.14): 30 runs, ceiling effect at sonnet (30/30 both arms) — no outcome lift measurable; KEY mechanism  | v2.31.11×1 | 出貨 | v2.31.11/2.31.12 完成 P1–P4＋orchestration eval；campaign R1 結果無 lift 已誠實記錄 |
| 24 | 2026-07-05-terse-reviewer-contracts | > Status: FULLY SHIPPED 2026-07-10 — template −16% (v2.32.16, haiku leg) + reviewer.md −17% + | v2.32.16×1, v2.32.15×2, v2.31.20×1 | 出貨 | 狀態欄自述已出貨 |
| 25 | 2026-07-08-observation-first-skills | > Status: R3 — R2 判定:gpt-5.5/grok/GLM SHIP-AS-IS;opus 1 blocking(紅綠 base-run 語意)+ MiniMax 2 kernels,本版吸收 | v2.32.8×1 | 出貨 | v2.32.8 |
| 26 | 2026-07-09-dispatch-model-guard | > Status: APPROVED 2026-07-09 — D1=`fable` only; D2=`ask` (fail-closed); D3=fail-open (allow+warn) | v2.36.71×1, v2.36.9×2, v2.36.2×1, v2.35.16×2, v2.35.15×2, v2.32.13×5 | 出貨 | 狀態 APPROVED；hooks/dispatch-model-guard.js 現存、後續多版調整；命中的版本是後續修改而非首發，首發版未用 slug |
| 27 | 2026-07-09-verify-strength-precursors | **Status**: precursor (1) shipped 2026-07-09 (v2.32.11); (2) and (3) scheduled as D7 in [`2026-08-03-next-touch-debt-retirement.md`](2026-08-03-next-t | v2.32.11×2 | 出貨 | precursor 1 出貨 v2.32.11；(2)(3) 由 next-touch-debt-retirement D7 承接，INDEX 完成表 2026-08-05 記 A01–A14 retired |
| 28 | 2026-07-14-dispatch-lineage | Status: in-progress (foreman /l5, run-id `foreman-lineage-p1-1784044280`) | v2.32.32×1 | 出貨 | 狀態欄寫 in-progress 過期；v2.32.32 出貨 |
| 29 | 2026-07-15-skill-transport-payoff-ab | > Status: COMPLETE — reviewer arm shipped in v2.32.34 (`3e7d344`); implementer arm completed 2026-08-02 with H1 confirmed (`D=0`, keep off) | v2.32.34×1 | 出貨 | 狀態欄自述已出貨 |
| 30 | 2026-07-29-qc-panel-honesty | (無狀態欄) | v2.36.46×1 | 出貨 | 無狀態欄；CHANGELOG 命中只是 v2.36.46 的測試名單，但 INDEX 完成表 2026-07-29 runtime-convergence-mvp 寫明 QC panel honesty 已併入出貨 |
| 31 | 2026-08-16-four-layer-redesign | > Status: R2 (final, post-G2 terminal adjudication) · Owner: cookys (CEO-mode delegated 2026-08-16) · Branch: develop → feature branch `feat/four-laye | v2.34.11×2 | 出貨 | v2.34.11 |
| 32 | 2026-08-16-owner-kernel-retirement | > Status: R2 (final, post-G2 terminal adjudication) · Owner: cookys · Branch: develop (execute on a feature branch) · Frame: retirement + knowledge ex | v2.34.20×1, v2.34.10×3 | 出貨 | v2.34.10 REVERSAL |
| 33 | 2026-08-17-autonomous-brain-integration | > Status: **FROZEN** (R2, post-G2 terminal adjudication, 2026-08-17) · Owner: depth-0 | v2.34.13×1 | 出貨 | v2.34.13 |
| 34 | 2026-08-18-dev-flow-contract-card | > Status: ✅ Shipped in v2.34.18 — merged as `242a8d4d` (instrument/spec/P4 shipped; card | v2.34.19×1, v2.34.18×2 | 出貨 | 狀態欄自述已出貨 |
| 35 | 2026-08-21-verdict-bytes-preservation | > **Status**: ✅ Shipped in v2.34.33 — merged as `f98c7ea0` (was R3 FROZEN: G1 15 + G2 9 | v2.34.33×1 | 出貨 | 狀態欄自述已出貨 |
| 36 | 2026-08-22-no-confidence-decay | > **Status**: authoring (depth-1 foreman, run `nocon-decay-l4`) | v2.34.35×1 | 出貨 | 狀態欄 authoring 過期；v2.34.35(memory strike-decay-shipped) |
| 37 | 2026-08-23-official-qualification-defaults | > **Status**: authored 2026-08-23 (dev-flow L-2), depth-1 foreman run `official-defaults-l4` | v2.34.45×1, v2.34.36×1 | 出貨 | 狀態欄 authored 過期；v2.34.36 |
| 38 | 2026-08-28-consult-discuss-qualification | > **Status**: **SHIPPED — wave 2 complete v2.35.1** (depth-0 terminal adjudication, 2026-08-28) — | v2.35.1×1, v2.34.46×1, v2.34.45×1 | 出貨 | 狀態欄自述已出貨 |
| 39 | 2026-08-28-implementer-ladder | Status: implemented on `feat/implementer-ladder` (not merged). | v2.35.12×1, v2.34.45×4 | 出貨 | 狀態欄「not merged」過期；v2.34.45 出貨 src/engine/implementer-ladder.js |
| 40 | 2026-08-29-qualification-verdict-stability | > **Status**: **APPROVED for implementation** (2026-08-30) — two bounded plan-review generations, gen-2 | v2.35.4×1, v2.35.3×1 | 出貨 | v2.35.3/2.35.4 |
| 41 | 2026-09-04-default-dispatch-topology | Status: **design + rollout proposal, awaiting owner decisions (§8)**. Requested 2026-09-04 by the | v2.35.16×2 | 可疑 | 狀態欄「design + rollout proposal, awaiting owner decisions」；v2.35.16 出貨 P0–P4，但明寫「P5 逐主機 rollout 另開，cuda 優先」。P5(各主機跑 dev-update.sh→resolve-dispatch-topology.js→commit review-loop-config、KR5 一週後評估)無 BACKLOG／INDEX 追蹤 |
| 42 | 2026-09-04-dev-flow-hetero-loops-default | Status: **R2 — FROZEN after plan-review generation 2 (owner go 2026-09-04)**. Ships as MINOR **v2.36.0** | v2.36.0×1 | 出貨 | v2.36.0 |
| 43 | 2026-09-05-statusline-live-context-feed | # Plan — statusline → hook live context feed | v2.36.1×2 | 出貨 | 狀態欄自述已出貨 |
| 44 | 2026-09-07-l4-host-provider-readiness-bootstrap | > Status: ✅ Shipped in v2.36.8 — merged as 4b3d6ba7 (2026-09-06); P5 dogfood pending on cuda | v2.36.8×1 | 出貨 | v2.36.8；狀態欄尾巴「P5 dogfood pending on cuda」無追蹤(低) |
| 45 | 2026-09-07-unknown-escalation-ladder | > Status: ✅ Shipped in v2.36.15 — merged as 6ac62767 (2026-09-07); plan frozen at g2, pre-merge review ×3 folded | v2.36.15×1 | 出貨 | 狀態欄自述已出貨 |
| 46 | 2026-09-08-family-aware-ladder-ordering | (無狀態欄) | v2.36.18×1 | 出貨 | 無狀態欄；CHANGELOG v2.36.18 僅寫「新 plan，未執行」＝命中是 authoring 非出貨；但 scripts/lib/effort-scale.js 的 normalizeEffort 與 resolve-dispatch-topology.js 的 rankOf 已落地(實作 P1/P2)，故為出貨，只是出貨 release 沒用 slug |
| 47 | 2026-09-11-operator-pin-supersedes-qualification | > Status: **R2 — FROZEN** (G2 terminal, depth-0 final adjudication 2026-09-11) · Owner: depth-0 session under Board delegation · | v2.36.27×1, v2.36.26×1, v2.36.25×1, v2.36.24×1, v2.36.23×1 | 出貨 | v2.36.24–27 P1–P3 |
| 48 | 2026-09-12-portable-knowledge-routing | **Status**: planned, 2026-09-12 | v2.36.30×1 | 出貨 | 狀態欄 planned 過期；v2.36.30 標題直接出貨；scripts/resolve-knowledge-routing.sh 現存 |
| 49 | 2026-09-13-foreman-rail-b-build | (無狀態欄) | v2.36.34×1 | 出貨 | v2.36.34 |
| 50 | 2026-09-13-non-claude-foreman-rail-design | **Status**: design (round 1), 2026-09-13. **Owner ruling 2026-09-13: round 2 builds Shape B** — | v2.36.34×1 | 出貨 | 設計文件，v2.36.34 引用並出貨 |
| 51 | 2026-09-13-repo-residue-sweep | `missing-dir` → `dirty` (any `status --porcelain` line) → `clean-integrated` (tip is an ancestor of | v2.36.35×3 | 出貨 | v2.36.35 |
| 52 | 2026-09-14-backlog-entry-migration | > Status: execution plan derived from the G1-reviewed parent `2026-09-14-backlog-entry-schema.md` §4 Phase 4 · | v2.36.48×1, v2.36.39×1 | 出貨 | v2.36.39 |
| 53 | 2026-09-14-backlog-entry-schema | > Status: G1 reviewed + folded 2026-09-14 (frozen at depth 0) · Owner: cookys (opened on operator go) · Branch: develop · Frame: design plan | v2.36.39×1, v2.36.38×1 | 出貨 | v2.36.38/2.36.39 |
| 54 | 2026-09-15-final-panel-per-seat-pins | > Status: execution plan for ONE managed deliverable (`/l5`, mission graph node `final-panel-pins-2026-09-15`). | v2.36.46×1 | 出貨 | v2.36.46；但同 commit 刪了 open 列「Managed rail never passes scorecard scope files — fallback_ladder always []」(Pointer 指向本 plan)，未確認是否已修 |
| 55 | 2026-09-15-peer-residue-config-ladder-qc-namespace | > Status: execution plan for ONE managed deliverable (`/l5`, mission graph node `peer-residue-2026-09-15`). | v2.36.45×1 | 出貨 | 單一 managed deliverable 執行計畫；對應 v2.36.4x–v2.36.59 條目直接引用；其 open follow-up 列已在 5f3aa3b1d 被 gate 刪除，見 buried-plans.md 根因節 |
| 56 | 2026-09-16-blind-review-packet | > Status: execution plan for ONE managed deliverable (`/l5`, mission graph node | v2.36.60×1, v2.36.59×1 | 出貨 | 單一 managed deliverable 執行計畫；對應 v2.36.4x–v2.36.59 條目直接引用；其 open follow-up 列已在 5f3aa3b1d 被 gate 刪除，見 buried-plans.md 根因節 |
| 57 | 2026-09-16-final-panel-blind-admission | > Status: execution plan for ONE managed deliverable (`/l5`, mission graph node | v2.36.58×1 | 出貨 | 單一 managed deliverable 執行計畫；對應 v2.36.4x–v2.36.59 條目直接引用；其 open follow-up 列已在 5f3aa3b1d 被 gate 刪除，見 buried-plans.md 根因節 |
| 58 | 2026-09-16-ledger-rotation-order | > Status: execution plan for ONE managed deliverable (`/l5`, mission graph node | v2.36.54×1 | 出貨 | v2.36.54(writer-only)；同 commit 刪了 open 列「already-scrambled carry-only ledger segments cannot project」(Pointer 指向本 plan，CHANGELOG 僅寫「重估 L」)，BACKLOG 現無此列，未確認 |
| 59 | 2026-09-16-proof-parity-raw-log | > Status: execution plan for ONE managed deliverable (`/l5`, mission graph node | v2.36.57×1 | 出貨 | 單一 managed deliverable 執行計畫；對應 v2.36.4x–v2.36.59 條目直接引用；其 open follow-up 列已在 5f3aa3b1d 被 gate 刪除，見 buried-plans.md 根因節 |

## 可疑清單詳述

總評：59 份中沒有「整份被歸檔卻完全沒做」且完全無人追蹤的重大案例；多數（51 份）判定出貨，其中約 20 份是狀態欄過期（寫 Proposal／Draft／in-progress／not merged，實際已出貨），這些歸檔本身正確，只是留在 _archive 的 plan 讀起來像沒做完。真正需要處理的是下列 3 份加 1 份未確認，另有 4 份「部分出貨」屬刻意縮減。

### 可疑 1：2026-05-14-eval-router-judge（現位於 docs/plans/_archive/2026/05/）
- 狀態欄：「Proposal - pending review / sequencing」，Size L。
- CHANGELOG 命中：只有 v2.7.2 一行「Eval-proxy clarification + router-judge plan (01ad396)」，意思是寫了 plan，不是建了 harness。repo 內找不到 router-judge 的腳本或 eval。
- 未完成：整個 router-judge harness（量真實 16+ skill 競爭下的 routing precision，現有 run-eval-batch.sh 只量 description 在零干擾下的吸引力，約 2.5% baseline）。plan 自述「不是急事；下次 description tightening 需要量化證據時會撞牆」。
- 追蹤：HEAD 的 BACKLOG 沒有；INDEX 只有「Plan-only records」一行寫「referenced in CHANGELOG (eval harness work)」，等於把它標成已吸收，其實沒有。可能被後來的 skill ON/OFF（evals/skill-onoff）與 stage-graph evals 部分取代：未確認。
- 建議：若仍要，補一列 Trigger「下一次 skill description 調整需要 routing precision 量化證據」Trigger-Type event、Effort L、Origin self；若已被取代，在 INDEX 該列改寫為 superseded。重要性：低。

### 可疑 2：2026-06-23-l4-l5-dep-graph-fanout（_archive/2026/06/）
- 狀態欄：「dialectic CONVERGED (round 2) -> DESCOPED」：S0 go/no-go spike＋S1 ship-regardless guard，Tier-2 fan-out build（Phase L）以兩道 S0 gate 為條件。
- CHANGELOG 命中：v2.25.4 一次，是 finish-flow 分支清理的順帶提及（分支名），不是出貨它。
- 實況：/l4 同質（Claude）batch fan-out 已出貨、guard（check-disjointness.sh）存在；/l5 異質 fan-out「機制做好但刻意不接」。
- 追蹤：HEAD BACKLOG BL-0070（Trigger-Type event，有明確觸發）。所以不算被埋，歸檔本身可接受。判定：可疑但已追蹤。

### 可疑 3：2026-09-04-default-dispatch-topology（_archive/2026/09/）
- 狀態欄：「design + rollout proposal, awaiting owner decisions (8)」。
- CHANGELOG 命中：v2.35.16 標題直接出貨 P0–P4，並寫「P5 逐主機 rollout 另開，cuda 優先」。
- 未完成：P5 fleet rollout（各主機 dev-update.sh -> resolve-dispatch-topology.js -> 只在與 auto 不同處 commit .claude/review-loop-config.md，附 topology.json 為證據；KR5 一週後評估）。
- 追蹤：BACKLOG／INDEX 皆無（HEAD 沒有 rollout 列）。這是跨主機的營運工作，不一定屬本 repo；仍建議補一列或在 INDEX 註記「P5 由各主機自理」。建議 Trigger「cuda 或其他主機 dev-update 後」，Trigger-Type event，Effort S（每主機），Origin owner（2026-09-04 經 cuda 轉達）。重要性：低到中，且 v2.35.16 之後預設拓樸已多次調整，P5 是否仍適用：未確認。

### 未確認：2026-07-02-engine-capability-state（_archive/2026/07/）
- 狀態欄：「Proposal R0 - ... do not implement until the current repair branch/worktree is stable」。
- CHANGELOG 命中 4 處全是別的版本引用 scripts/engine-capability-state.js（strike、pin-seat、brain-status），沒有一處說出貨這份 plan。腳本確實存在，由後續 plan（cross-harness、no-confidence-decay、operator-pin）逐步建出，無法證明 R0 的整份範圍被執行。若有未建部分就是被歸檔掩蓋；需要逐 phase 對照才能定論。重要性：未確認。

### 部分出貨（刻意縮減，記錄在案，非被埋）
- 2026-06-02-skill-leverage-extraction：v2.7.7 出貨並明寫 think-tank-dialectic、ceo-agent 抽取被否決。
- 2026-06-04-parallel-read-fanout：v2.12.2 只出貨文件規則；其餘 descoped。
- 2026-06-04-review-verify-barrier：v2.12.1／v2.12.3 出貨縮減版，CHANGELOG 明寫 descoped 較大提案。
- 2026-06-26-trust-tiered-review-policy：v2.25.11 出貨「buildable core」；其餘部分 shadow→gate 見 BL-0069，local 席 future-gated 的部分未確認。

### 順帶發現：歸檔時連帶被刪的 open 追蹤列
5f3aa3b1d 同時刪了 Pointer 指向這批已歸檔 plan 的 open 列，例如：final-panel-per-seat-pins 的「Managed rail never passes scorecard scope files - fallback_ladder always []」（v2.36.46 診斷出同一病因，但修法選的是常設 pin，不是讓 rail 傳 scope 檔，所以該缺陷是否仍在：未確認）；ledger-rotation-order 的「already-scrambled carry-only ledger segments cannot project」（CHANGELOG 只說重估為 L，BACKLOG 現無此列）；disposition-resume-scope-sha 的「ADJUDICATING / VERTICAL_VERIFICATION resumes still spend the Mission claim」。這三條建議列入下一輪列級稽核（詳見 buried-plans.md 根因節）。

附錄資料：/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/blaudit/f/archived-raw.txt（59 份原始狀態欄與命中行）、moved-stems.txt（59 個 stem）。
