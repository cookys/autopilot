# autopilot — BACKLOG

<!-- next-id: BL-0336 -->

One entry = one index row per [`references/backlog-entry.md`](../references/backlog-entry.md); evidence lives at
the row's `Pointer` (a plan, a project, or a sidecar under `docs/backlog/`). Gate:
`node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (config `.claude/backlog-config.md`, `mode: block`;
residual debt in `.claude/backlog-debt.json` ratchets down only). Migrated 2026-09-14 by
`scripts/migrate-backlog-entries.js` (manifest `docs/backlog/MIGRATION-2026-09-14.json`).

**FIRED queue (order, as of 2026-09-14)** — rows whose trigger has fired are worked in this order:

1. ~~`chatgpt-tunnel-host` (E)~~ SHIPPED v2.36.32 · 2. ~~`openclaw` main claim~~ v2.36.28 · 3. ~~`cookys-7840hs` four defects~~ v2.36.33 ·
4. ~~foreman rail Shape B~~ v2.36.34 · 5. ~~`308-db` (a) residue sweep~~ v2.36.35 · 6. ~~2026-09-12 dogfood four defects~~ v2.36.36 ·
7. ~~backlog entry schema Phases 1–4~~ v2.36.38–39 · 8. ~~disposition resume~~ v2.36.41 · 9. ~~ledger flag burns a grant~~ v2.36.42 · 10. ~~reviewer no_verdict releases the claim~~ v2.36.43. Next: operator-named work, or the 308-8f dispatch-hetero reports.

### 回合被判定主工作目錄被改動，但分支位置其實沒動
- **Id**: BL-0285
- **Status**: open
- **Since**: 2026-10-23
- **Origin**: peer
- **Reporter**: hangar
- **Report**: 2026-10-23 bundle docs/hangar-harvest-2026-10
- **Reply**: none
- **Problem**: 有一次實作回合被判定為主工作目錄被改動而整輪作廢，但紀錄證明分支位置沒動，只有系統自己的簿記參照變了；原因還沒重現。
- **Impact**: 可能無故作廢一輪已完成的實作與其花費。
- **Trigger**: next edit to main-checkout-boundary.sh or the lifecycle-roots writer, or a third unexplained main_checkout_mutated rejection
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED hangar 2026-10-23 (bundle docs/hangar-harvest-2026-10 ea8b40a95); session d12f8e4c 2026-09-19, hypothesis, unreproduced
- **Pointer**: docs/backlog/main-checkout-mutated-with-no-head-movement.md

### mods Now tab: a background row may never end after a session resume
- **Id**: BL-0002
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: mods 的 Now 分頁上，session 離開再 resume 後，原本的背景工作不會再送完成通知，那一列可能永遠掛著；對話紀錄裡也沒有 resume 標記可判斷。
- **Impact**: 最壞是畫面上殘留一列已不存在的背景工作，屬於顯示問題；先實測再決定要不要修。 (draft)
- **Trigger**: a stale 背景指令 or 監看 row is seen, or a session is resumed after quitting with background work running
- **Trigger-Type**: event
- **Effort**: S
- **Source**: feat/mods-activity review, 2026-10-12 (UNVERIFIED live behavior)
- **Pointer**: docs/backlog/mods-activity-row-never-ends.md
- **Context**: Half fixed in b36936691: a retained background row is dropped when the transcript is unreadable and the session id changed. Left: resume; probe quitting mid `sleep 600`, find a transcript signal.

### Cross-repo dispatch has no worktree or handoff rule
- **Id**: BL-0004
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: 一個專案的工作要派到另一個專案的程式庫去做時，目前沒有規則說明該用哪個專案的工作樹、標記檔與交接文件。當初規劃工作樹位置規則時，刻意把這一項延後。 (draft)
- **Impact**: 跨專案派工時各 session 可能各做各的、交接位置不一致；平常很少遇到。 (draft)
- **Trigger**: the first real cross-repo dispatch that goes wrong (worktree, marker or handoff location disagrees)
- **Trigger-Type**: event
- **Effort**: M
- **Source**: worktree-placement gap 5, deferred by the plan (D12), 2026-10-12
- **Pointer**: docs/backlog/worktree-and-handoff-placement-has-no-rule.md
- **Context**: Owner 2026-10-17: keep as is, set no rule now; decide when a real case appears. Rails resolve placement from their own --from repo root; nothing says which repo root, marker or handoff a cross-repo run uses.

### Host Conformance tool — authorized by the 2026-08-23 consolidation decision, never built
- **Id**: BL-0014
- **Status**: open
- **Since**: 2026-09-20
- **Origin**: self
- **Problem**: 2026-08-23 的整併決議核准要做一個「主機一致性檢查」工具，但至今沒有人做。決議分支已合併，成果卻不存在。 (draft)
- **Impact**: 缺這個工具就無法自動檢查各平台行為是否一致；需擁有者決定是否排程。 (draft)
- **Trigger**: before any coding-harness architecture migration is proposed again, OR when a host capability claim is disputed by a peer
- **Trigger-Type**: event
- **Effort**: L
- **Source**: 2026-09-20 remote-branch triage (decision branch merged at 47b52eac; deliverable absent)
- **Pointer**: docs/backlog/host-conformance-tool.md
- **Context**: Owner 2026-10-17: stays approved, wait for the trigger. Needs its own registered plan; the decision doc lists the six report sections.

### Foreman rail residuals (v2.36.34) — accepted and named, not hidden
- **Id**: BL-0015
- **Status**: open
- **Since**: 2026-09-13
- **Origin**: self
- **Problem**: 工頭 rail 出貨時，審查接受並記下幾個已知殘留風險。cgroup 已處理；剩下對外網路沒有限制、Write 和 Edit 不算進工具上限、hand 以 inline 派工會隨工頭一起死掉。
- **Impact**: 只有在真實工頭運行時出現逃脫或連外問題才需處理；目前列為觀察項。 (draft)
- **Trigger**: **NOT FIRED — recorded at ship time, 2026-09-13.** Fires when a real foreman run trips one of them.
- **Trigger-Type**: event
- **Effort**: M
- **Source**: `docs/plans/2026-09-13-foreman-rail-b-build.md`, ship-time adjudication.
- **Pointer**: docs/backlog/foreman-rail-residuals-v2-36-34-accepted-and-named-not-hidden.md
- **Context**: cgroup item fixed in 64259622f (each foreman worker turn in a systemd user scope, shared scripts/lib/worker-containment.sh). Open: egress, Write/Edit uncounted, inline hands die with the foreman.

### PEER-REPORTED (hangar): register preview/review servers with lab-ingress instead of ad-hoc 0.0.0.0 ports
- **Id**: BL-0018
- **Status**: open
- **Since**: 2026-10-05
- **Origin**: peer
- **Reporter**: hangar（hangar--claude-2）
- **Report**: 01M45R3JWAVVZ5WDTQ4M89A503
- **Reply**: 2026-10-05 01M45R4M3V0999MB5HEV8E7R84
- **Problem**: hangar 的 claude 工作階段反映：預覽與審查伺服器應向 lab-ingress 登記，而不是各自開 0.0.0.0 的臨時埠。目前審查伺服器只綁本機 127.0.0.1，沒有登記機制。 (draft)
- **Impact**: 其他機器想看預覽時只能自己想辦法；原定版本已不會出貨，需擁有者重訂時程並與 hangar 確認。 (draft)
- **Trigger**: mods shipped with 3.0.0 AND hangar lab-ingress v2 `lab preview` decided
- **Trigger-Type**: peer
- **Effort**: M
- **Source**: fleet `01M45R3JWAVVZ5WDTQ4M89A503` from hangar--claude-2 (2026-10-05, on cookys' request); replied `01M45R4M3V0999MB5HEV8E7R84`
- **Pointer**: docs/backlog/lab-ingress-preview-integration.md
- **Context**: review server self-registers; a PreToolUse hook (not skill text) routes ad-hoc previews to `lab preview` with a LAN-bound registered fallback; registry format co-defined with hangar.

### agy `--input-format stream-json` raises the payload ceiling but does NOT remove it — and above it the failure is SILENT
- **Id**: BL-0021
- **Status**: open
- **Since**: 2026-09-11
- **Origin**: peer
- **Reporter**: twgs-revival
- **Report**: 2026-09-11 peer
- **Reply**: 2026-09-11 session 587b795f:2936
- **Problem**: twgs-revival 回報：agy 改用 stream-json 輸入雖提高了內容上限，但超過上限後會無聲失敗而不報錯。我方已在本機驗證屬實，目前仍保留硬性上限檢查。 (draft)
- **Impact**: 若有人移除上限檢查，超長內容會無聲出錯；現行檢查已擋住，只需保留該原則。 (draft)
- **Trigger**: the next agy-rail dispatch refused by `agy_argv_ceiling_assert`, or any work that proposes routing `dispatch-review.sh` / `dispatch-hetero.sh` / `dispatch-author.sh` through stream-json.
- **Trigger-Type**: event
- **Effort**: S
- **Source**: peer report from twgs-revival 2026-09-11, re-derived locally the same day with four probes; the since-removed `lib/agy-argv-ceiling.sh` guard, callers at…
- **Pointer**: docs/backlog/agy-input-format-stream-json-raises-the-payload-ceiling-but-does-not-remove-it-a.md
- **Context**: agystdin 0221af27e: stdin stream-json shipped fail-closed (170000 B cap, empty-response and token-ceiling checks). Stays open: lifting the cap safely needs a per-host measurement or a tail-nonce self-check.

### Main-checkout boundary: accepted residuals of an accident guard that is not a sandbox
- **Id**: BL-0023
- **Status**: open
- **Since**: 2026-09-13
- **Origin**: self
- **Problem**: 主目錄邊界防護只是防意外，不是安全沙箱；審查時記下幾個接受的殘留缺口。除非採用惡意工作者的威脅模型，否則不會處理。 (draft)
- **Impact**: 只有在有人刻意對抗時才有風險；一般使用不受影響，可考慮結案只留文件。 (draft)
- **Trigger**: fires only if the boundary is ever asked to be a sandbox — i.e. an adversarial worker becomes a threat model this repo adopts. Today it is not (`references/blind-dispatch.md`; v2.36.32's own contract says "accident guard, not a sandbox").
- **Trigger-Type**: event
- **Effort**: L
- **Source**: v2.36.32 review round 6, 2026-09-13, adjudicated at depth 0 by re-derivation.
- **Pointer**: docs/backlog/main-checkout-boundary-accepted-residuals-of-an-accident-guard-that-is-not-a-san.md
- **Context**: v2.36.32's detection layer fingerprints every ref, HEAD, symbolic-ref target, staged/unstaged diff content, and a size+mtime+type+link-target walk of every entry outside `.git`.

### Apply two-tier + pooled verdict to reviewer/implementer/owner/verification_author/brain
- **Id**: BL-0028
- **Status**: open
- **Since**: 2026-08-30
- **Origin**: self
- **Problem**: 資格考核的「兩層加合併判定」目前只用在 consult 與 discuss 角色，其他角色（審查、實作、驗證、最上層）尚未套用，因為還沒有各角色專屬的封存題庫。 (draft)
- **Impact**: 其他角色的考核結果較不穩定；要先建題庫，短期沒有急迫性。 (draft)
- **Trigger**: a role's own eval corpus + scorecard-first ON/OFF evidence exists — a frozen, sealed
- **Trigger-Type**: event
- **Effort**: L
- **Source**: `docs/plans/2026-08-29-qualification-verdict-stability.md` D8
- **Pointer**: docs/backlog/apply-two-tier-pooled-verdict-to-reviewer-implementer-owner-verification-author.md
- **Context**: `foldPooledVerdict`, `(VERDICT_Z, VERDICT_TAU)`, and the D3 error-class → tier map

### Codex payload install-time generation（2026-08-02 residual spike：NO-GO）
- **Id**: BL-0029
- **Status**: open
- **Since**: 2026-08-02
- **Origin**: self
- **Problem**: Codex 的安裝時產生內容曾做過探索，結論是不可行（NO-GO），條目記錄這個決定。只有在 Codex 官方新增原生安裝或升級機制時才重新評估。 (draft)
- **Impact**: 沒有實際影響，是一份決策紀錄；可考慮結案。 (draft)
- **Trigger**: Codex 提供受支援的 native plugin lifecycle：在 plugin install **與** Git marketplace upgrade/refetch 兩條適用路徑上，都能於 payload discovery 前自動執行 deterministic generator，且 generator…
- **Trigger-Type**: peer
- **Effort**: L
- **Source**: health-roadmap P6 Brief（2026-07-17）；[`codex-payload-residual-spike`](projects/_archive/2026/08/2026-08-02-codex-payload-residual-spike/README.md)…
- **Pointer**: docs/backlog/codex-payload-install-time-generation-2026-08-02-residual-spike-no-go.md
- **Context**: codex-cli 0.146.0 的 logged-in `codex exec` 已實證 installed Autopilot cache payload 與 linked support reference 可被讀取，且 audit 結果正確。殘餘 probe 同時反證把 local source 當 Git refresh：generation A…

### Release-time payload branch（B）重啟條件
- **Id**: BL-0030
- **Status**: open
- **Since**: 2026-07-17
- **Origin**: self
- **Problem**: 「發版時另開內容分支」的方案要等連續幾週測試全綠才重啟，但最近 30 次測試都因逾時被取消，前提目前不成立。 (draft)
- **Impact**: 暫時沒有影響；要先把 CI 修好才談得到這項。 (draft)
- **Trigger**: CI 連續數週綠＋真實 tag/release 節奏存在（非每 push 即 shippable）＋ C-Spike 已否決 install-time 路線
- **Trigger-Type**: event
- **Effort**: L
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）
- **Pointer**: docs/backlog/release-time-payload-branch-b.md
- **Context**: Generic push/PR test CI 已存在，但 B 仍需新建 tag→payload publication→push-credential 的 release path；於多 PATCH/日的節奏下，每個 Codex 可見修復多四個失敗點；QA 判 test-signal 時點最差（user…

### autopilot effort vocabulary has no `minimal` — the muse-spark contributor tier cannot be examined at its cheapest setting
- **Id**: BL-0033
- **Status**: open
- **Since**: 2026-09-04
- **Origin**: self
- **Problem**: autopilot 的努力等級詞彙沒有「最低」一級，導致 muse-spark 這類貢獻者席位無法用最便宜的設定來考核。是否擴充詞彙要由董事會或擁有者決定。 (draft)
- **Impact**: 便宜設定的席位無法被考核；影響範圍很小，屬選擇性改進。 (draft)
- **Trigger**: a second real need for a `minimal` effort tier appears (the muse-spark request of 2026-09-03 counts as the first)
- **Trigger-Type**: event
- **Effort**: L
- **Source**: v2.35.14 probe (`CHANGELOG.md`); opencode models.dev `reasoning_options` for the model
- **Pointer**: docs/backlog/autopilot-effort-vocabulary-has-no-minimal-the-muse-spark-contributor-tier-canno.md
- **Context**: Owner 2026-10-17: do not add `minimal` now; wait for a second need. `dispatch-hetero.sh` (`--effort` enum), `engine-scorecard.js` (`EFFORT_VALUES`), `src/engine/capability-evidence.js`, `schemas/review-loop-contract.schema.json`, `implementer-ladder.js` and the seat-hash partition all enumerate…

### Dispatch justification check for acceptance-oracle tasks — P6D incident follow-up
- **Id**: BL-0035
- **Status**: open
- **Since**: 2026-08-21
- **Origin**: self
- **Problem**: P6D 事故的後續只剩「派工理由檢查」尚未出貨：已有完整驗收依據的工作，派去重量級流程前要先說明理由。暫存區清單檢查與無狀態拒絕已出貨。
- **Impact**: 沒有派工理由檢查時，簡單且驗收明確的工作仍可能被送進過重的流程；其餘兩段已擋住。
- **Trigger**: an owner-approved project opens the dispatch-justification check; it must ship a planted negative case showing unjustified heavy dispatch for an acceptance-oracle task is blocked
- **Trigger-Type**: owner
- **Effort**: L
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026/08/2026-08-21-p6d-orchestration-incident/README.md) (incl. Fable 5 judgment).
- **Pointer**: docs/backlog/contract-first-escalation-and-local-repair-gates-p6d-incident-follow-up.md
- **Context**: Owner 2026-10-17: narrowed to the unshipped dispatch-justification control, keep waiting. Origin: a bounded six-file/three-command consumer task was routed through strict L5 Mission governance.

### Implementer suite hardening backlog (pre-merge review round-1 cut list)
- **Id**: BL-0037
- **Status**: open
- **Since**: 2026-08-22
- **Origin**: self
- **Problem**: 實作者考核套件的加固項目，測試已補了大半；剩下 Stage-0 機械化、真實 rail 冒煙測試、消費端矩陣、設定標示這幾項還沒做。
- **Impact**: 考核套件對惡意或異常情況較不堅固；目前沒有實際出事，屬加固性質。 (draft)
- **Trigger**: 第三場實作者正式施測之前（Stage-0 機械化與 live-rail smoke 應先落），或 reviewer 再報同類；config labelling 要改 grader 並重封資產，屬 owner 決定。
- **Trigger-Type**: event
- **Effort**: M
- **Source**: autopilot:reviewer pre-merge round-1,2026-08-22;`docs/plans/2026-08-22-implementer-qualification-suite.md` §6-§8。
- **Pointer**: docs/backlog/implementer-suite-hardening-backlog-pre-merge-review-round-1-cut-list.md
- **Context**: 2026-10-16 and 2026-10-19 landed fixtures, TTL, --trials tests and the implementer-exam hardening tests (969c46043); open: Stage-0 mechanisation, live-rail smoke, consumer matrix, config labelling.

### Brain-seat sittings in the shipped qualification defaults (v2 artifact)
- **Id**: BL-0041
- **Status**: open
- **Since**: 2026-08-23
- **Origin**: self
- **Problem**: 出貨的官方資格預設值裡不包含最上層代理（brain）席位的考核紀錄，這是刻意的。是否未來也要出貨，需擁有者決定。 (draft)
- **Impact**: 最上層代理席位的推薦只能依本機證據，沒有官方預設可參考；不影響其他席位。 (draft)
- **Trigger**: a consuming repo asks to adopt an owner/brain seat without self-qualifying; or the Board schedules the fourth brain sitting and it PASSES (a passing sitting is the first brain row worth shipping as a default).
- **Trigger-Type**: event
- **Effort**: S
- **Source**: v2.34.36 official-qualification-defaults ship;`references/qualification-defaults.md` § "What this does NOT do"。
- **Pointer**: docs/backlog/brain-seat-sittings-in-the-shipped-qualification-defaults-v2-artifact.md
- **Context**: v2.34.36 ships official defaults for `implementer` / `reviewer` / `verification_author` — all scorecard rows.

### Durable repair-lock — 解鎖路徑先行,鎖才准回來(P6D KR3 的第二階段)
- **Id**: BL-0042
- **Status**: open
- **Since**: 2026-08-21
- **Origin**: self
- **Problem**: P6D 事故修補的第二階段：要有「先有解鎖路徑、才准加持久鎖」的修復鎖。審查當時把鎖否決，改成無狀態拒絕，這一階段至今沒有做，且偏屬推測性需求。 (draft)
- **Impact**: 目前沒有觀察到繞過行為，可先放棄，真的發生再重提。 (draft)
- **Trigger**: 無狀態拒絕被實測繞過(terminalization 之外的路徑把 BOUNDARY_REJECTED campaign 排水/succession 掉而未修復 —— 例如 host 直驅 reducer 的 no_effect_release);或 engine_terminal_evidence…
- **Trigger-Type**: event
- **Effort**: L
- **Source**: 2026-08-21 pre-merge review(autopilot:reviewer);`docs/projects/_archive/2026-08-21-p6d-corrective-gates/`(歸檔後)。
- **Pointer**: docs/backlog/durable-repair-lock-p6d-kr3.md
- **Context**: v2.34.32 原出貨 durable claim-bound repair lock + 四 Mission 後盾,pre-merge review 兩枚 🔴 殺掉:解鎖路僅存於 mission-v2 ready/follow_up 排水(legacy receipt 永無解)、bypass enum…

### Skill contract-card rewrites under 成績單前置（G2 MiniMax R8）
- **Id**: BL-0043
- **Status**: open
- **Since**: 2026-08-16
- **Origin**: self
- **Problem**: 審查者指出，開發流程等大型技能的說明文件太長太雜，想改寫成精簡的規格卡片，但規定沒有開關對照的評測證據就不准重寫，所以一直沒動。 (draft)
- **Impact**: 不修只是文件維持冗長，模型讀起來較吃力；沒有立即故障。 (draft)
- **Trigger**: 四層 redesign 的 Policy 層設計定案,且目標 skill 有 eval ON/OFF 證據（成績單前置）
- **Trigger-Type**: event
- **Effort**: L
- **Source**: G2 review finding（MiniMax R8, 2026-08-16）;strategy thread 2026-08-16
- **Pointer**: docs/backlog/skill-contract-card-rewrites-under-g2-minimax-r8.md
- **Context**: 童子軍規則的漸近線——把重量級 skills（dev-flow、quality-pipeline 候選）改寫為 contract-card shape（trigger/inputs/decision-table/engine-pointers）。未評測前不得重寫。

### Strike-decay deferrals — the five mechanisms the panel cut from the first instrument
- **Id**: BL-0047
- **Status**: open
- **Since**: 2026-08-22
- **Origin**: self
- **Problem**: 席位失誤扣分機制的第一版只做最小功能，把五種防護（偵測器異常隔離、全艦斷路、頻率窗口、自動重考、品質抽樣）刻意延後，等出問題再補。 (draft)
- **Impact**: 目前沒有這些防護，若偵測器誤報可能讓多個席位同時被誤降級。 (draft)
- **Trigger**: Any of: (1) a detector is caught emitting strikes at an anomalous rate; (2) more than two seats trip in one short span and the cause turns out to be a gate bug, not the engines; (3) a re-exam is needed and nobody notices for a week; (4)…
- **Trigger-Type**: event
- **Effort**: M
- **Source**: hetero design panel 2026-08-22 synthesis §5/§6 + cut list; deferred by scope=Hold on the M-size first cut.
- **Pointer**: docs/backlog/strike-decay-deferrals-the-five-mechanisms-the-panel-cut-from-the-first-instrume.md
- **Context**: Deliberately NOT built in v2.34.35, each with a reason rather than an omission.

### Scaffold-tier effect A/B measurement（four-layer D6 promised row — repaired 2026-08-18）
- **Id**: BL-0051
- **Status**: open
- **Since**: 2026-08-18
- **Origin**: self
- **Problem**: 我們依能力分成三個鷹架層級，但從沒做過對照實驗證明層級真的影響成果品質，文件也明講不宣稱有效。實驗被延後，等有人要依層級決策才做。 (draft)
- **Impact**: 只要沒人拿層級當成果品質依據，就沒有影響。 (draft)
- **Trigger**: Before any skill or routing policy CONSUMES scaffold tiers（T0/T1/T2）as an outcome-quality claim（成績單前置 applies）;or before the next capability-tier expansion.
- **Trigger-Type**: event
- **Effort**: M
- **Source**: four-layer-redesign D6 closeout leftover（2026-08-17）;audit 2026-08-18（dev-flow-contract-card prologue）.
- **Pointer**: docs/backlog/scaffold-tier-effect-a-b-measurement-four-layer-d6-promised-row-repaired-2026-08.md
- **Context**: v2.34.11 shipped capability-tiered scaffolding with fail-closed T2, but `references/scaffold-tiers.md` Non-goals explicitly disclaims any tier→outcome effect claim — the A/B was deferred.

### Qualification CLI transport — runtime identity capture (codex and other CLIs)
- **Id**: BL-0052
- **Status**: open
- **Since**: 2026-08-17
- **Origin**: self
- **Problem**: 資格測試走 claude 命令列的路徑，現在會讀工具回報的實際模型並比對，對不上就拒收；但走 codex 等其他命令列時，工具仍不回報實際模型，身分只能靠操作者聲明。 (draft)
- **Impact**: codex 等席位的資格紀錄，模型身分可能不準；等工具提供回報後再處理。 (draft)
- **Trigger**: When codex (or another CLI kind) grows a verifiable runtime model-identity signal in headless mode, or before promoting a non-claude CLI-transport qualification to a decision where alias drift would be material.
- **Trigger-Type**: peer
- **Effort**: S
- **Source**: v2.34.15 pre-merge review; hardening round 2026-08-17; claude side shipped 2026-10-18.
- **Pointer**: docs/backlog/qualification-cli-transport-runtime-identity-capture.md
- **Context**: claude side done (`modelUsage` checked, fail closed; see Pointer). Other CLI kinds return no model id, so identity stays operator-asserted.

### t14 long-horizon per-turn verification gate
- **Id**: BL-0055
- **Status**: open
- **Since**: 2026-08-01
- **Origin**: self
- **Problem**: 每回合重新提醒模型守規則沒有明顯進步，因此改做每回合驗證。兩批評測（Haiku 4.5、5.5；模式 violations+features）都 PASS；預設模式 violations 未單獨評測。P2-4 收尾文件進行中；預設值由 owner 決定（卡 d-32849d39）。
- **Impact**: 預設仍未開啟，長時間工作時模型可能漸漸偏離規定；hook 已可選用，兩批評測都通過，等 owner 決定預設。
- **Trigger**: P2-4 verdict note merged and owner answers d-32849d39. Sidecar t14-long-horizon-per-turn-verification-gate.md stays referenced.
- **Trigger-Type**: event
- **Effort**: M
- **Source**: docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report.md (prior docs/projects/_archive/2026/07/2026-07-08-t14-reinject/report.md already corrected)
- **Pointer**: docs/plans/2026-10-20-per-turn-gate.md
- **Context**: p2-3r2 PASS (670b3ffaf): M3 ON 28/30 vs C 1/30. p2-3-h55 PASS (a10bceef5): M3 ON 23/30 vs C 0/30, Fisher p 8.71e-11, cost 2.10 USD. Details in sidecar.

### Mission graph scheduler 與 portfolio optimization
- **Id**: BL-0056
- **Status**: open
- **Since**: 2026-07-28
- **Origin**: self
- **Problem**: 任務圖目前只能擋住「階段暴增」，不會自動排最短路徑、跨專案排程或做進度看板。除非實測有閒置浪費或擁有者要求，否則不做。 (draft)
- **Impact**: 不做只是排程不夠聰明，系統並不會因此出錯或停擺。 (draft)
- **Trigger**: v2.34.0 的 frozen deliverable graph gate 已出貨，且至少兩個真實 portfolio 顯示靜態 dependency batches 造成可量測的 idle time，或使用者明確要求跨專案排程／dashboard。
- **Trigger-Type**: event
- **Effort**: L
- **Source**: 2026-07-28 Mission Convergence Portfolio 34-phase runaway audit；`governance-correction.md`
- **Pointer**: docs/backlog/mission-graph-scheduler-portfolio-optimization.md
- **Context**: v2.34.0 只需要機械阻止 phase explosion：bounded deliverable count、DAG、parallel/batch/depth/gate budget 與 ready-node admission。Critical-path optimization、dynamic reorder、跨 repo portfolio、priority queue、進度…

### Mission authority store 與 cross-harness enforcement hardening
- **Id**: BL-0057
- **Status**: open
- **Since**: 2026-07-28
- **Origin**: self
- **Problem**: Mission 的防護只能擋誠實的程式，若有惡意的同帳號程式去改 .git 內的紀錄就擋不住，其他平台也沒有強制擋下的機制。要擴大保護需要獨立帳號或遠端服務。 (draft)
- **Impact**: 目前只防疏忽不防惡意；在單人單機環境風險低。 (draft)
- **Trigger**: 需要把 Mission `enforce` 宣稱擴到目前未有 executable blocking adapter 的 harness，或 threat model 升級為防止惡意 same-UID worker 刪改 `.git` 內 registry/state；若只是誠實 agent 的 branch/session…
- **Trigger-Type**: event
- **Effort**: L
- **Source**: 2026-07-28 Mission P1/P2 parity audit與獨立 Architect/Ops/Skeptic review；`governance-correction.md`
- **Pointer**: docs/backlog/mission-authority-store-cross-harness-enforcement-hardening.md
- **Context**: 本次只實作 current-host 可驗證的 Git-common-dir durable registry、CAS 與 fail-closed adapter。防惡意本機程序需要獨立 UID、root-owned/remote daemon 或具 authenticity 的 authority service；精確 provider…

### `check-test-integrity.sh` warn → block needs an accuracy record first
- **Id**: BL-0060
- **Status**: open
- **Since**: 2026-08-23
- **Origin**: self
- **Problem**: 測試完整性檢查目前只警告不擋，誤報率仍遠高於翻成攔截的門檻。前兩條降誤報規則已出貨（封閉規則，精度代價 C1–C14，重放仍報同樣 9 筆）；第三條規則與新一輪重放尚未做。
- **Impact**: 維持警告時違規仍可通過，只能靠人自己看警告，沒人看就漏掉。 (draft)
- **Trigger**: a re-replay of the same seed and 60 merges shows under 5% false positives, or someone proposes flipping mode to block
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。
- **Pointer**: docs/backlog/check-test-integrity-sh-warn-block-needs-an-accuracy-record-first.md
- **Context**: Rules 1-2 shipped (merge 1ce92330d, tirules). Left: rule 3 (substitution pairing), then a re-replay of the same 60 merges under 5% FP (was 91.7%, 7b84a5520). Mode stays warn. See sidecar.

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Id**: BL-0066
- **Status**: open
- **Since**: 2026-07-10
- **Origin**: self
- **Problem**: 用來測審查者「不亂報」能力的乾淨樣本集，實測 12 個有 5 個其實有問題，標籤不可靠。要做絕對準確度認證，需要重建真正確認乾淨的集合。 (draft)
- **Impact**: 審查者誤報率的數字不夠可信；只影響評測結論。 (draft)
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
- **Trigger-Type**: event
- **Effort**: M
- **Source**: 2026-07-10 L6-r2 WS-A campaign;MiniMax R2 的「reviewer-circular 標注」警告實證。
- **Pointer**: docs/backlog/certified-clean-evals-clean-diff-specificity-certified.md
- **Context**: 2026-07-10 syscontract campaign 實測:12 個「clean」標籤(merged-未被翻 標注法)倒了 5 個(舊01/舊03/06/08/新03),其中新03 的 flag 還抓到當日 develop 現行真 bug(ladder-run.sh pipefail,v2.32.18 修)。全火力…

### Domain-aware routing — consume the `work_domain` telemetry to route reviewer/implementer by diff domain
- **Id**: BL-0067
- **Status**: open
- **Since**: 2026-06-26
- **Origin**: self
- **Problem**: 系統已記錄每次改動屬於哪個領域，但還沒用這個資訊去挑選審查者或實作者，還缺兩階段解析等前置條件，故延後。 (draft)
- **Impact**: 不做只是挑審查者時不分領域，沒有故障，也不影響正確性。 (draft)
- **Trigger**: ALL remaining prerequisites are met (telemetry alone is NOT a trigger): (1) a **two-pass resolve** in `resolve-review-loop.sh` without breaking the single-shot JSON contract; (2) a **pre-impl planned-scope signal** for implementer…
- **Trigger-Type**: event
- **Effort**: L
- **Source**: 2026-06-26 domain-telemetry ship (Phase 4); the deferred KR4 of the plan.
- **Pointer**: docs/backlog/domain-aware-routing-consume-the-work-domain-telemetry-to-route-reviewer-impleme.md
- **Context**: `/l5` 現已把 resolved `reviewer_runner` 傳入 `dispatch-review.sh`，所以舊 prerequisite (1) 已完成；domain probe 仍只輸出 `work_domain`/`domain_source` telemetry，沒有 domain-conditioned roster 或 two-pass…

### L1 block-mode override re-enable — needs a REAL isolation boundary (cgroup is NOT enough)
- **Id**: BL-0068
- **Status**: open
- **Since**: 2026-06-26
- **Origin**: self
- **Problem**: 測試完整性的強制模式下，合理的測試縮減沒辦法放行，需要真正的隔離邊界才能安全開放豁免，而單靠資源限制不夠，所以維持不開。 (draft)
- **Impact**: 遇到正當縮減測試時只能人工處理；情況很少。 (draft)
- **Trigger**: when a `/l5` block-mode project hits a legitimate `executed_set_shrink` that should be waivable, AND a real isolation boundary is available.
- **Trigger-Type**: event
- **Effort**: L
- **Source**: test-integrity-l1 (v2.25.7) + W1/W2/W3 ship (v2.25.8); gpt-5.5 review verdict in session 2026-06-26; spec §8.3 / §12.
- **Pointer**: docs/backlog/l1-block-mode-override-re-enable-needs-a-real-isolation-boundary-cgroup-is-not-e.md
- **Context**: The override stays **DEFERRED**.

### `/l5` hetero-parallel width fan-out (machinery built, deliberately unwired)
- **Id**: BL-0070
- **Status**: open
- **Since**: 2026-06-23
- **Origin**: self
- **Problem**: /l5 想把一批工作同時分給多個不同廠牌的模型並行處理，相關機制做好了但刻意沒接上，因為沒有實際需求。 (draft)
- **Impact**: 沒人需要就沒有影響；可考慮直接決定不做。 (draft)
- **Trigger**: a concrete, repeated need to fan one batch across heterogeneous engines in parallel that clone-per-unit (l5 Parallel units) cannot serve; wiring must first lift the one-rail-per-.git limit
- **Trigger-Type**: event
- **Effort**: S
- **Source**: 2026-06-23 `docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md` scope-cut + Phase L ship (`577ba8d`).
- **Pointer**: docs/backlog/l5-hetero-parallel-width-fan-out-machinery-built-deliberately-unwired.md
- **Context**: Phase L shipped `/l4` homogeneous (Claude) batch fan-out.

### First local runner capability semantics（availability/load，不是 quota）
- **Id**: BL-0073
- **Status**: open
- **Since**: 2026-08-01
- **Origin**: self
- **Problem**: 本機模型（如 ollama）的可用度與負載資料已經能量測，但還沒接到引擎的能力狀態系統，第一個本機執行器接上時才要補這一段。 (draft)
- **Impact**: 本機模型的狀態不會反映在能力狀態，目前沒有本機席位依賴它。 (draft)
- **Trigger**: 第一個 local runner（例如 ollama 類）接入 capability-state producer。
- **Trigger-Type**: event
- **Effort**: S
- **Source**: 2026-07-14 status CLI design + 2026-07-31 code audit。
- **Pointer**: docs/backlog/first-local-runner-capability-semantics-availability-load-quota.md
- **Context**: named endpoint identity 與獨立的 local-deployment availability/load observation schema 已實作；剩餘工作縮為第一個真實 local runner 的 observation→capability-state producer bridge。不得把現有 metered quota…

### HETO task-return detection can miss completed work
- **Id**: BL-0084
- **Status**: open
- **Since**: 2026-08-05
- **Origin**: owner
- **Problem**: 擁有者回報偶爾 HETO 已完成任務，但控制端沒偵測到回傳，一直等下去。只出現過一次且無法重現，也找不到負責偵測的程式。 (draft)
- **Impact**: 偶爾造成流程卡住空等；目前無法重現，需第二次發生才能追查。 (draft)
- **Trigger**: A second reproducible case where a completed HETO task produces no return event/notification, or before another HETO return-consumer is added.
- **Trigger-Type**: event
- **Effort**: S
- **Source**: user-reported intermittent missed HETO return detection (2026-08-05)
- **Pointer**: docs/backlog/heto-task-return-detection-can-miss-completed-work.md
- **Context**: The controller can remain waiting when HETO has completed a dispatched task but the return detector does not fire; inspect event names, buffering/flush, timeout, and terminal-state reconciliation without treating silence as success.

### No route for external field experience contributed INTO autopilot itself
- **Id**: BL-0085
- **Status**: open
- **Since**: 2026-08-25
- **Origin**: self
- **Problem**: 在其他專案使用 autopilot 學到、屬於 autopilot 的專案知識，沒有路徑回灌：學習技能只寫到該專案，提煉技能又排除 autopilot。同儕回報的流程（先回覆、再登 BACKLOG）不涵蓋這類知識。
- **Impact**: 其他專案學到的教訓會流失，autopilot 本身讀不到；目前只有一個案例（n=1），所以只是登記，還沒動工。
- **Trigger**: A second instance of a lesson learned while using autopilot on another project that belongs in autopilot's own skills/references and has nowhere to go.
- **Trigger-Type**: event
- **Effort**: S
- **Source**: knowledge-routing fix set, foreman first-pass review (2026-08-24)
- **Pointer**: docs/backlog/no-route-for-external-field-experience-contributed-into-autopilot-itself.md
- **Context**: Owner 2026-10-18: project knowledge, separate from peer reports; tied to the codeforge/mnemos ecosystem (codeforge is the first Mnemos source, a memory daemon). The route likely belongs with its project-knowledge flow.

### `peer-coordination` skill — ruled in, blocked on a spike sweep
- **Id**: BL-0086
- **Status**: open
- **Since**: 2026-08-25
- **Origin**: peer
- **Reporter**: cuda（推定）
- **Report**: 2026-08-24 peer
- **Reply**: 2026-08-25 session 61892959:1108
- **Problem**: 其他專案經 peer 通道要求新增「同儕協調」技能，讓多個 session 互相派工、溝通有統一做法。兩輪異質審查已裁定要做，但要先在各機器跑完實測才能動工。 (draft)
- **Impact**: 沒有此技能時，各 session 自行摸索協調方式，容易踩重複的坑。 (draft)
- **Trigger**: The R5 spike list below comes back with dated, per-machine results. Do not author the
- **Trigger-Type**: event
- **Effort**: M
- **Source**: cross-repo request via peer relay, 2026-08-24/25; ruled by two-round heterogeneous panel
- **Pointer**: docs/backlog/peer-coordination-skill-ruled-in-blocked-on-a-spike-sweep.md
- **Context**: autopilot models subordinates (`team`, `l3`–`l6`) and future-self (`handoff`) but has

### CEO/dev-flow: reversible-candidate release gates and optional Boil-the-Lake re-try
- **Id**: BL-0093
- **Status**: open
- **Since**: 2026-09-06
- **Origin**: peer
- **Reporter**: cuda（revival.3d）
- **Report**: 2026-09-06 peer
- **Reply**: 2026-09-05 session e1e51201:1496
- **Problem**: 可逆的候選改動仍要過發版核准。煮乾湖泊那條已評過但沒有資訊量，是否再測一次由擁有者決定。
- **Impact**: 可逆改動的發版門檻仍然過嚴；指引要等擁有者裁決才動。
- **Trigger**: owner decides to open this; point 3 (reversible-candidate release gates) and an optional point-1 re-try remain
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: cuda revival.3d peer message, 2026-09-06; ASTRA-SKILL-AUDIT report on cuda (/data/rw3d-evidence/2026-09-06/ASTRA-SKILL-AUDIT/report.md, not shared)
- **Pointer**: docs/backlog/ceo-dev-flow-guidance-proportionality-peer-request-to-soften-boil-the-lake-near.md
- **Context**: Point 2 shipped in the 98e5c6e7d merge. BL-0147 is tracked separately. Owner decision card d-c9b50973 for text.

### Sealed-campaign review-station migration
- **Id**: BL-0106
- **Status**: open
- **Since**: 2026-10-03
- **Origin**: peer
- **Reporter**: cuda chatgpt-tunnel
- **Report**: 2026-10-03 peer
- **Reply**: 2026-10-03 session 76c98aac:1628; 2026-10-15 reporter: no campaign run since 10-08, in_rail_review: single at seal is enough, shelve until hit
- **Problem**: 其他專案的 campaign（自動化連續任務）建立後被封存，之後想在同一個 campaign 內改成「每次修復單獨審查、最後再整體審查」，目前做不到，只能在建立時選。 (draft)
- **Impact**: 遇到這種需求的專案只能重建 campaign；建立時就選好的情況不受影響。 (draft)
- **Trigger**: next peer/operator campaign needing per-repair single review plus a terminal panel inside one already-sealed campaign
- **Trigger-Type**: event
- **Effort**: M
- **Source**: peer-reported cuda/chatgpt-tunnel 2026-10-03
- **Pointer**: docs/backlog/sealed-campaign-review-station-migration.md
- **Context**: single+terminal panel works at intake; only in-place migration of a sealed campaign's review_station is missing.

### mods P5 proxy-decision reminders (writer first)
- **Id**: BL-0110
- **Status**: open
- **Since**: 2026-10-04
- **Origin**: owner
- **Problem**: 擁有者要求 mods 介面能顯示「代理替你做的決定」提醒。目前沒有任何地方記錄這類決定，所以介面無從顯示；要先做記錄寫入，再做監看，最後才是顯示。 (draft)
- **Impact**: 擁有者想看到代理的決定卻看不到；屬新功能，排在 mods 隨 3.0.0 發布之後。 (draft)
- **Trigger**: after mods ship with 3.0.0
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: owner request and C4 research, 2026-10-04
- **Pointer**: docs/backlog/mods-p5-proxy-decision-reminders.md
- **Context**: no live decision ledger exists and nothing writes proxy-decision rows, so the live band cannot show them yet; writer, then watcher sidecar, then display.

### mods/live recent conversation: groups expand by mouse only
- **Id**: BL-0123
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: mods/live 介面的「最近對話」區塊，群組只能用滑鼠點開；在 tmux 裡用鍵盤無法移到群組並展開，按 Enter 反而觸發前面的切換分頁按鈕。 (draft)
- **Impact**: 只用鍵盤或 ssh 的使用者無法展開群組；擁有者若要用鍵盤才需處理。 (draft)
- **Trigger**: Claude Code 支援 pane 內非分頁 Button 的鍵盤焦點或 hotkey 時
- **Trigger-Type**: peer
- **Effort**: S
- **Source**: now-recent-turns screenshot run, merge `82d34da4`, 2026-10-12
- **Pointer**: docs/backlog/mods-live-recent-groups-keyboard.md
- **Context**: 2026-10-17 measured on Claude Code 2.1.301: in-pane Button hotkey draws its prefix but keys go to the input box; focus stays on top tabs only. Host blocks it; reported to Claude Code.

### autocompact: users never learn to set autoCompactWindow; T2 still says STOP
- **Id**: BL-0124
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: owner
- **Problem**: 使用者通常不知道要設定自動壓縮視窗（autoCompactWindow），偵測功能和 T2 新提示文字都已完成，剩下是在下一版發布標題寫出這個設定，讓使用者知道要設。 (draft)
- **Impact**: 使用者會被不必要地要求停下重開；擁有者已驗證 Claude Code 的摘要夠用，改文字屬指引，需評測證據。 (draft)
- **Trigger**: next alpha or 3.0.0 release cut
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: context reset cost analysis, 2026-10-12
- **Pointer**: docs/plans/evidence/2026-10-12-context-reset-cost/README.md
- **Context**: detection and T2 wording shipped (BL-0124 merge, ON/OFF eval docs/plans/evidence/2026-10-14-t2-wording-onoff/). Left: name autoCompactWindow in the next release heading so users learn to set it.

### fleet dispatch carries no lineage, so work sent to a peer drops out of the dispatch tree
- **Id**: BL-0144
- **Status**: open
- **Since**: 2026-10-13
- **Origin**: self
- **Problem**: 用 fleet 把工作派給另一個 session 時，派工樹在那裡就斷了：fleet 的派工只帶收件人和工作內容，不帶「這是誰底下的工作、第幾層」。
- **Impact**: 派去別的 session 的工作，派工分頁只會顯示「之後的工作沒有紀錄」。目前很少這樣派，影響小。
- **Trigger**: fleet 跨 session 派工變成常態（一週數次以上），或派工樹計畫出貨後擁有者要求追到對方那一端
- **Trigger-Type**: event
- **Effort**: M
- **Source**: dispatch tree plan, step 4 deferred by owner ruling 2026-10-13
- **Pointer**: docs/plans/2026-10-13-dispatch-tree.md
- **Context**: Plan §4, D4. Carry root/parent/depth as remote-reported telemetry, never an edge (the far side is an LLM relaying it; G1 finding 56a3391e). Needs a fleet dispatch field plus a receiver record, shown as a labelled hint.
### Compaction handoff: T2 text and the remaining checks
- **Id**: BL-0147
- **Status**: open
- **Since**: 2026-10-14
- **Origin**: self
- **Problem**: 交接機制已出貨。剩：T2 提示改成先寫交接檔再繼續（指引變更，要 eval 和 owner 同意）；間隔設定只有開 session 的檢查會讀。壓縮點已有第一筆實測（約窗口減 33K，數據在 Context），還缺別台機器或別的模型的紀錄。
- **Impact**: 交接檔要模型自己寫才有，現在的 T2 提示沒叫它寫，所以壓縮後多半只有腳本產生的那部分。
- **Trigger**: owner 同意改 T2 文字並排 eval 時，或別的模型出現新壓縮點紀錄時（核對 pre_tokens 是否為這次壓縮）
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: BL-0124 review, 2026-10-14; mechanism merged from lane/hand, 2026-10-15
- **Pointer**: docs/plans/evidence/2026-10-12-context-reset-cost/README.md
- **Context**: Compaction point measured 2026-10-17 (window 533000): preTokens 499974-501310, about window minus 33K. Done: model note budget 4000B+, half-write guard. Eval: quiz/grade on real transcripts, ON = handoff file, OFF = 20-turn tail.

### Move exam registration to llm-playground; autopilot reads one JSON
- **Id**: BL-0194
- **Status**: open
- **Since**: 2026-10-15
- **Origin**: owner
- **Problem**: 考試登記機制要全部搬到 llm-playground，不維護多份；由 dyno 產出一份 JSON 給 autopilot 綜合評估，至少含每小時解題數、資格、通過率、花費。
- **Impact**: 兩邊各記一份會不一致，排席位時看到的數字對不上。
- **Trigger**: llm-playground 回報 intake 流程後，由 owner 確認新的 P5–P7 範圍。
- **Trigger-Type**: peer
- **Effort**: M
- **Source**: owner, 2026-10-15
- **Pointer**: docs/plans/2026-10-16-bl0194-qualification-registry-move.md
- **Context**: Exam moves to llm-playground intake after SWE34, via engine-qualify headless. Trust auto/confirm/off (default auto). P5–P7; P3 optional, off; P4b is a residual pull.

### 依功能把 autopilot 分成 hetero engine、flow、lab 三塊（拆法未定）
- **Id**: BL-0206
- **Status**: open
- **Since**: 2026-10-18
- **Origin**: owner
- **Problem**: autopilot 同時含異質引擎（panel、discuss、plan review、code review）、軟體開發流程、實驗性功能，使用者難分辨哪些是核心。拆法還沒定。
- **Impact**: 不分組只是說明與目錄較雜，沒有功能影響；使用者要分辨用途時較費力。
- **Trigger**: owner 重新提起分組，或新增的技能與腳本再次難以歸類
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: owner, 2026-10-18（放棄 tier 欄位時順帶提出，以後再說）
- **Pointer**: docs/backlog/split-autopilot-into-hetero-engine-flow-lab.md
- **Context**: 拆法未定（候選深度見 sidecar）；owner 2026-10-18 說以後再說，不主動推進。

### roundtable Phase 1 - the /roundtable skill, distilled from several manual rooms
- **Id**: BL-0216
- **Status**: open
- **Since**: 2026-09-19
- **Origin**: owner
- **Problem**: 圓桌第一階段要把幾場手動開過的討論整理成可重複使用的技能，目前只有書面計畫，技能還沒寫。
- **Impact**: 每次討論仍得手動組場，前面幾輪累積的做法無法沉澱成固定流程。
- **Trigger**: three more manual rooms run under the Phase 0 protocol, each with an evidence dir, OR the owner asks for the skill by name
- **Trigger-Type**: owner
- **Effort**: L
- **Source**: original operator 2026-09-19 Phase 0 ("值,先詳細寫成 plan 留 backlog,我們應該多經歷幾輪再來繼續"); restored 2026-10-19; dropped by 5f3aa3b1d
- **Pointer**: docs/plans/2026-09-19-roundtable.md
- **Context**: Room-log: utterances append to room.jsonl; windows only read it. Windows A and B built and owner-approved 2026-10-19. Fleet transport excepts hetero discussion; review stays hetero. Skill still waits on its trigger. Detail is in Pointer.

### roundtable - a non-Claude seat is addressed through the host's switchboard courier handle (Phase 0 finding F1)
- **Id**: BL-0217
- **Status**: open
- **Since**: 2026-09-19
- **Origin**: self
- **Problem**: 非 Claude 的席位必須用該主機的交換台信使名稱來稱呼，不能用 Claude 的名稱，否則會送到錯的地方。
- **Impact**: 叫錯名稱時訊息會廣播到整台主機，該席收不到本來要給它的內容。
- **Trigger**: the next manual room seats a non-Claude harness (verify fleet send --to courier --local pane in and fleet reply out from the pasted frame)
- **Trigger-Type**: event
- **Effort**: S
- **Source**: Phase 0 finding F1, restored 2026-10-19; dropped by 5f3aa3b1d cleanup
- **Pointer**: docs/plans/evidence/2026-09-19-roundtable/notes.md
- **Context**: `fleet peers` now tags couriers `[switchboard: …]` and refuses a handle without one; protocol.md must name the courier lookup, never `--to <host> --local`

### Openclaw leftover side effects: a refusal keeps a live lease, and verify PATH is a precondition miss
- **Id**: BL-0218
- **Status**: open
- **Since**: 2026-09-12
- **Origin**: peer
- **Reporter**: openclaw
- **Report**: 2026-09-12 fleet
- **Reply**: none
- **Problem**: 主訴求已出貨。還剩兩件：拒絕時回報已釋放，持久狀態卻仍留有效租約，下次啟動會撞上未關租約；驗證指令繼承的搜尋路徑缺工具，找不到命令應算前置條件失敗。
- **Impact**: 下次啟動被未關租約擋住；缺工具被當成驗證失敗，分不清是環境還是產品。
- **Trigger**: a refusal reports released while durable state keeps a live lease, or verify_cmd inherits a PATH missing the operator tool
- **Trigger-Type**: peer
- **Effort**: S
- **Source**: openclaw fleet relay 2026-09-12; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/peer-reported-openclaw-an-active-l5-marker-deadlocks-the-bounded-campaign-l5-its.md
- **Context**: Main claim shipped in v2.36.28. Original effort label was Fix. (a) may be partly covered by v2.36.71, unconfirmed.

### Managed rail: already-scrambled carry-only ledger segments cannot project
- **Id**: BL-0219
- **Status**: open
- **Since**: 2026-09-16
- **Origin**: self
- **Problem**: 帳本裡已經被打亂、只剩搬移片段的段落無法再投影還原。寫入端先出貨，讀取端的復原刻意留到後面，還沒做。
- **Impact**: 受影響主機的舊帳本無法還原，輪替後的紀錄一直讀不回去。
- **Trigger**: host ledgers already rotated under the sorted group_by carry still throw event input artifact must match the prior output artifact
- **Trigger-Type**: event
- **Effort**: L
- **Source**: l5 plan 2026-09-16, writer-only; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/managed-rail-scrambled-carry-reader-recovery.md
- **Context**: Reader recovery for rotation-carry rows, or a locked migration proving digests unchanged. Re-sized L on 2026-09-19.

### Roster qualification: Explorer formal suite
- **Id**: BL-0228
- **Status**: open
- **Since**: 2026-08-17
- **Origin**: self
- **Problem**: 名冊資格還缺探索者角色的正式考卷。在宣稱這個角色可以自動派工之前，必須先補上這套考卷。腦席重考已在別列，這裡只留探索者這一段。
- **Impact**: 探索者角色可能在沒有正式考卷時就被拿去自動派工。
- **Trigger**: Explorer formal suite — before autonomous routing claims for that role
- **Trigger-Type**: event
- **Effort**: L
- **Source**: v2.34.15 qualification 2026-08-17; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/roster-qualification-remaining-legs-explorer-suite-brain-re-sit-implementer-leg.md
- **Context**: Implementer leg already shipped. This row is only the Explorer formal suite. Brain re-sit lives in another row.

### consult_dispatch has no seat once the qc panel consumes the roster
- **Id**: BL-0230
- **Status**: open
- **Since**: 2026-09-11
- **Origin**: self
- **Problem**: 品管席佔走名冊後，諮詢席仍退回同家族原生席。警告現在已點名被排除的席位與原因；還缺專供諮詢的後備名單：與提問者去相關、非 panel 成員、只要求回傳文字。
- **Impact**: 需要問另一個家族時，仍沒有正式通路，只能照警告自行宣告席位。
- **Trigger**: next consult on a host whose qc panel covers the whole roster, or the next edit to consult eligibility in the topology resolver
- **Trigger-Type**: event
- **Effort**: M
- **Source**: measured 2026-09-11 fleet-comms; restored 2026-10-19; dropped by 41f1bff64; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/consult-dispatch-no-seat-after-qc-panel.md
- **Context**: Warning half merged (consultseat 51290f69a). Left: topology eligibility plus a new config key. Native-fallback seats are dispatched, not refused; see sidecar.

### Per-hook by per-harness support matrix with verification dates
- **Id**: BL-0231
- **Status**: open
- **Since**: 2026-09-07
- **Origin**: owner
- **Problem**: 掛鉤與執行環境支援表各格多數仍未以實際觸發驗證（證據檔只有一筆打包紀錄，沒有實際觸發）。另需 owner 決定：表只收我們自己註冊的掛鉤，grok 與 agy 的原生事件證據是否擴充進來。
- **Impact**: 矩陣上的「支援」多數仍未被實際觸發證明；原生事件層也沒有證據列，grok 與 agy 的掛鉤支援只能靠散文記載。
- **Trigger**: the next hook registered on a second harness, a harness-maintenance run that finds a hook-event claim older than 60 days, or the owner deciding whether the matrix should accept native-event (grok/agy) evidence rows
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: owner 2026-09-07 dirty-tree hook; restored 2026-10-19; dropped by 061cc11c7; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/per-hook-per-harness-support-matrix-with-verification-dates-hook-inventory-that.md
- **Context**: Old id BL-0026. 2cdefb419 wired only the 60-day advisory into preflight. Left: most cells unverified (no fired evidence), plus owner call on grok/agy native rows. See sidecar.

### Engine-routing axis: evidence bar for any model-to-worktype default
- **Id**: BL-0232
- **Status**: open
- **Since**: 2026-06-29
- **Origin**: self
- **Problem**: 任何模型預設負責某類工作，都還沒有站得住的證據門檻。領域感知路由那一列因此少了先決條件，這條規則目前只留在個人筆記。
- **Impact**: 沒有這條證據門檻，模型對工作類型的預設可以被直接寫死。
- **Trigger**: before hardcoding any domain-to-engine or phase-to-engine default, or when someone proposes a static model-to-worktype table
- **Trigger-Type**: event
- **Effort**: S
- **Source**: 2026-06-29 dual-agent survey; restored 2026-10-19; dropped by 5d0b29c1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/engine-routing-axis-evidence-bar.md
- **Context**: Original label was a standing evidence bar, recorded here as effort S. Domain-aware routing lost this prerequisite.

### Official codex plugin as a peer consult channel
- **Id**: BL-0233
- **Status**: open
- **Since**: 2026-07-05
- **Origin**: self
- **Problem**: 把官方外掛當成同級諮詢通道的試驗，諮詢通道已經出貨。審查通道的校準，以及救援寫入的沙箱姿態，都沒有後續列在追。
- **Impact**: 審查通道與救援寫入的風險沒有列在追，出貨後無人接手。
- **Trigger**: consult channel already shipped; remaining trigger is review-channel calibration and the rescue write sandbox posture
- **Trigger-Type**: event
- **Effort**: S
- **Source**: 2026-07-05 orchestrator-economy; restored 2026-10-19; dropped by 5d0b29c1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/official-codex-plugin-peer-consult-spike.md
- **Context**: Consult channel shipped. No follow-up row for review calibration or the rescue write sandbox posture.

### PostToolUse dispatch dies after /clear
- **Id**: BL-0234
- **Status**: open
- **Since**: 2026-05-14
- **Origin**: self
- **Problem**: 清掉對話之後，工具用完的回呼就不再觸發，必須整個程式重開。說明已寫好，自動偵測與向上游回報都還沒做。
- **Impact**: 長時間工作階段在清空後，紀錄與稽核會靜默停住，使用者不知道。
- **Trigger**: Next report that intent, audit, or reload watch stops updating in a long session, or hook-dispatch notes change
- **Trigger-Type**: event
- **Effort**: M
- **Source**: 2026-05-14 v2.7.2 post-clear diagnostic; restored 2026-10-19; dropped by 5d0b29c1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/posttooluse-dispatch-dies-after-clear.md
- **Context**: Docs shipped in v2.8.1. Detection spike and the upstream report were never done.

### Investigate the /reload-plugins hook count discrepancy
- **Id**: BL-0235
- **Status**: open
- **Since**: 2026-05-14
- **Origin**: self
- **Problem**: 重新載入外掛時，畫面上的掛鉤數量和實際清單差兩筆。功能仍正常，這項外觀調查從未做完。
- **Impact**: 數量對不上會讓人誤判掛鉤沒載入，功能本身沒壞。
- **Trigger**: Next time someone writes reload-watch logic, or a Claude Code update changes hook reload semantics
- **Trigger-Type**: event
- **Effort**: S
- **Source**: 2026-05-14 v2.7.2 reload verification; restored 2026-10-19; dropped by 5d0b29c1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/reload-plugins-hook-count-discrepancy.md
- **Context**: Reported 11 hooks while the file had 13. Live hooks still fired. Cosmetic only.

### Upstream report for agy install symlinked-destination truncation
- **Id**: BL-0236
- **Status**: open
- **Since**: 2026-06-11
- **Origin**: owner
- **Problem**: 安裝時若目的地是符號連結，會把來源檔案截成空檔。防護已出貨，向上游回報仍要擁有者同意才能送。
- **Impact**: 上游不知道這個會清掉檔案的行為，別人的安裝仍可能踩到。
- **Trigger**: Before the next agy plugin install of autopilot in the fleet, or the next hardening slot; owner must send the report
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: 2026-06-11 incident plus sandbox repro; restored 2026-10-19; dropped by 5d0b29c1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/agy-install-symlinked-dest-upstream-report.md
- **Context**: Guard shipped in v2.15.1. The upstream report still needs the owner account and identity consent.

### Move large dispatch calibration scratch off the quota path
- **Id**: BL-0237
- **Status**: open
- **Since**: 2026-07-13
- **Origin**: self
- **Problem**: 大型校準暫存仍寫在有配額的暫存區。其餘清理已出貨。沒有找到還會產生這類目錄的腳本，可能已不存在。
- **Impact**: 配額再次被大型暫存撐滿時，整機指令會因磁碟配額假死。
- **Trigger**: Next calibration.sh or swe-calibrate large clone, or when per-user temporary usage grows again
- **Trigger-Type**: event
- **Effort**: S
- **Source**: 2026-07-13 usrquota diagnosis; restored 2026-10-19; dropped by 5d0b29c1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/dispatch-calibration-scratch-non-quota-path.md
- **Context**: No script producing the swe-calibrate scratch directories was found, so it may no longer exist. 2026-10-23: git log -S finds no swe-calibrate producer ever in scripts, evals or src; not closed, an external tool may still make them.

### Watcher roots set has no upper bound
- **Id**: BL-0239
- **Status**: open
- **Since**: 2026-10-04
- **Origin**: self
- **Problem**: 監看器記錄的專案根目錄清單沒有上限。其餘強化已修完，這項留給後續階段。
- **Impact**: 長時間追蹤很多專案時，這份清單會一直變大。
- **Trigger**: P3 start
- **Trigger-Type**: event
- **Effort**: M
- **Source**: mods P1a reviews, 2026-10-04; restored 2026-10-19; dropped by a1cc180cb; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/mods-p1a-known-follow-ups.md
- **Context**: Old id BL-0109. Everything else in that row was already fixed. P3 owns the bound.

### Cursor seat admission stays blocked until tool-deny or a portable sandbox
- **Id**: BL-0240
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: self
- **Problem**: Cursor 席位仍不能准入，因為該代理無法強制拒絕未授權工具，資格考也還沒跑。要等官方做出可攜沙箱或全面拒絕，或擁有者同意花錢再測。
- **Impact**: 沒有這一列時，不准入的原因只寫在計畫裡，之後沒人會記得何時可以重測。
- **Trigger**: cursor-agent ships a catch-all deny or portable sandbox, rerun the 18 probes under docs/plans/evidence/2026-08-29-cursor-containment-probe, or the owner authorises the Stage-1 spend
- **Trigger-Type**: event
- **Effort**: M
- **Source**: 2026-10-19 deletion audit, never had a row; restored 2026-10-19; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/plans/2026-09-02-cursor-transport-fallback.md
- **Context**: Also docs/plans/2026-08-26-cursor-cli-adaptor.md. Seat blocked: cursor-agent cannot enforce tool-deny.

### mods-visible-dispatch: P2 guard-port Phase 2 merged, latency unmeasured, P4 parked
- **Id**: BL-0241
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: owner
- **Problem**: P2 guard-port Phase 2 已合併（三個觀察 hook 串成一次執行，每次工具呼叫 7 次降為 5 次）；owner 決定照現狀合併，延遲沒量。P4 的 progress.json 與 work-round 投影仍掛起，目前沒有程式會讀它。
- **Impact**: 延遲改善沒有數字佐證，要等之後的基準量測。progress.json 掛起不影響現有功能。
- **Trigger**: a later latency re-baseline is run (reference measurement, not a merge gate), or radar asks for P4 progress.json and the work-round projection
- **Trigger-Type**: event
- **Effort**: M
- **Source**: owner ruling 2026-10-23 d-585003b0 (partial keep); 2026-10-19 deletion audit, restored; docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/plans/2026-10-03-mods-visible-dispatch.md
- **Context**: Phase 2 merged 59905f025 (gport2) by owner d-0ed54425=A: KR1 only reached 5 spawns, KR2 latency unmeasured, host load ~35. reload-watch and failure-escalation stay separate. P4 parked.

### dispatch-tree step 5 and R blocked by the D0 probes
- **Id**: BL-0242
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: self
- **Problem**: 派工樹的後段步驟被探針擋住，還沒有結果就不能做。車隊那一步已經另有追蹤。
- **Impact**: 步驟停在探針，沒人盯著就不會重跑，後面的工作也不會開始。
- **Trigger**: D0 probes clear step 5 (row h) and R (row d2 kimi/agy/opencode not_run); fleet step tracked by BL-0144
- **Trigger-Type**: event
- **Effort**: M
- **Source**: 2026-10-19 deletion audit, never had a row; restored 2026-10-19; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/plans/2026-10-13-dispatch-tree.md
- **Context**: Fleet step is tracked by BL-0144. Step 5 and R stay blocked on the D0 probes.

### workflow-snapshot P3: handoff reads the snapshot and dev-flow calls task-card
- **Id**: BL-0243
- **Status**: open
- **Since**: 2026-10-13
- **Origin**: owner
- **Problem**: 交接時讀取壓縮快照，以及流程開始時自動寫任務卡，這兩件還沒做，要等評測與擁有者裁決。
- **Impact**: 交接仍不會讀快照，任務卡也不會在流程開始時自動寫入。
- **Trigger**: P3: handoff reads the snapshot and dev-flow calls task-card, after guidance and eval
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: original backlog row; restored 2026-10-19; dropped by 0a9c9efac; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/plans/2026-10-13-workflow-snapshot-at-compaction.md
- **Context**: Prior row deleted in 0a9c9efac. BL-0147 covers T2 text only, not P3.

### default-dispatch-topology P5 per-host rollout, cuda first
- **Id**: BL-0244
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: self
- **Problem**: 預設派工拓樸的逐主機推廣還沒做，原來說先從 cuda 那台開始。之後預設拓樸又改過，是否仍適用尚未確認。
- **Impact**: 各主機可能一直用舊的拓樸設定，沒有人安排逐台更新。
- **Trigger**: per-host rollout of the default dispatch topology, cuda first
- **Trigger-Type**: event
- **Effort**: S
- **Source**: 2026-10-19 deletion audit, never had a row; restored 2026-10-19; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/default-dispatch-topology-p5-rollout.md
- **Context**: Archived plan P0-P4 shipped in v2.35.16. P5 per-host rollout was left untracked.

### eval-router-judge harness was never built
- **Id**: BL-0245
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: owner
- **Problem**: 路由評審的量測工具只有計畫、沒有做出來。優先順序低，之後改技能說明需要量化證據時才會用到。
- **Impact**: 下次需要量化路由準確度時，才會發現量測工具從未建立。
- **Trigger**: next skill-description tightening needs routing-precision evidence
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: 2026-10-19 deletion audit, never had a row; restored 2026-10-19; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/eval-router-judge-harness-unbuilt.md
- **Context**: Low priority. The harness was never built. The plan is archived.

### Mission stays not ready after a section 11 downgrade
- **Id**: BL-0248
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: peer
- **Reporter**: codepower twgs-revival
- **Report**: 01M59ZPRRAH8CGMG59HHD8816N
- **Reply**: 2026-10-19 01M59ZQBD887MCS212ZQY3MYDX
- **Problem**: 第十一節降級並記錄整合之後，任務圖仍判定還沒準備好，也沒有辦法把節點標成結束。
- **Impact**: 整合做完仍過不了就緒檢查，任務卡在無法收尾的狀態。
- **Trigger**: after a section 11 downgrade and record-integration, the mission graph still says not ready and nothing marks the node terminal
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PEER-REPORTED codepower twgs-revival 2026-10-19
- **Pointer**: docs/backlog/mission-not-ready-after-section-11-downgrade.md
- **Context**: See BL-0220. 2026-10-23 BLOCKED: no "section 11 downgrade" concept in the repo; need a minimal repro from codepower twgs-revival (detail in the Pointer); the fleet MCP was down, request not sent.

### One command that writes the autocompact window and the context budget
- **Id**: BL-0250
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: peer
- **Reporter**: codepower twgs-revival
- **Report**: 01M59WNDJSZG3Y6YTERWD9DF4J
- **Reply**: 2026-10-19 01M59WPA9TSF4TR7ST9AJRWF4V
- **Problem**: 每次工作階段開始的對齊檢查與完整提示已經出貨。剩下的是一道指令同時把兩處的建議值寫好，這件事還沒做。
- **Impact**: 兩處仍得各自手改。對不齊時會被提醒，但沒有一道指令一次寫好。
- **Trigger**: the owner asks for one command that writes both recommended values
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED codepower twgs-revival 2026-10-19
- **Pointer**: docs/backlog/autocompact-window-context-budget-manual-align.md
- **Context**: Alignment check and full prompt shipped in merge e993e0fc0. The one-command writer is not built.

### agy 1.4.2 headless large output prints SUCCESS envelope but process does not exit
- **Id**: BL-0253
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: peer
- **Reporter**: codepower
- **Report**: 01M5AMCPARPY10G4GYCJAKT80X
- **Reply**: 2026-10-20 01M5AMDBG5B1ZDDVFD1CPTKM3Y
- **Problem**: agy 一點四點二在無頭模式輸出很大（約六千詞元以上）時，會印出成功信封，但行程不結束，要等外面逾時。一點二點一不會。
- **Impact**: 派工審查的 agy 席可能一直等行程結束，審查因此卡住。
- **Trigger**: when codepower confirms a fix or workaround on their side, or the first agy review seat run that hangs after a closed envelope
- **Trigger-Type**: peer
- **Effort**: S
- **Source**: PEER-REPORTED codepower 2026-10-20
- **Pointer**: docs/backlog/agy-142-headless-envelope-no-exit.md
- **Context**: Probably affects the agy review seat. 2026-10-23: agy-served claude-sonnet-5-5-low hands parked on their own background tasks until the dispatch wall timeout; see sidecar.

### t14 batch driver does not re-run infra failures and cannot see mid-run OAuth expiry
- **Id**: BL-0254
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: self
- **Problem**: 批次驅動在基礎設施失敗後沒有依計畫重跑，而且登入只在每次開始前檢查，跑到一半過期不會停機。
- **Impact**: 失敗樣本不會補跑，中途登入失效被當成一般錯誤繼續跑。
- **Trigger**: before any further run of the t14 gate batch driver
- **Trigger-Type**: event
- **Effort**: S
- **Source**: t14 second experiment batch, 2026-10-20
- **Pointer**: docs/backlog/t14-batch-driver-infra-rerun-oauth.md
- **Context**: G-15 runner_timeout and C-16 runner_error were left at attempt 1. Depth-0 did not supplement this batch. Detail is in the Pointer.

### P6 feed-trust follow-ups: confirm-mode answer step, plan wording, reject-then-confirm, repeated stderr
- **Id**: BL-0261
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: self
- **Problem**: 信任檢查剩兩件事：確認模式下 owner 在面板回覆後，還得再跑一次答覆指令才算數；計畫第五節對紀錄驗證的用詞與實作不符。其餘兩項已修。
- **Impact**: 前者要改技能說明才能自動化，後者是文件與行為不一致。
- **Trigger**: next guidance eval allowed to edit the engine-onboarding skill text, or the next change to the P6 plan
- **Trigger-Type**: event
- **Effort**: S
- **Source**: hetero-review p6trust g2
- **Pointer**: docs/backlog/p6-trust-followups.md
- **Context**: Items 3 and 4 merged (feedtrust d079b69bb). Items 1 and 2 left; item 1 is skill text at skills/engine-onboarding/SKILL.md:77 and needs eval evidence.

### familyOfEngine has no deepseek arm
- **Id**: BL-0264
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 引擎家族判斷沒有 deepseek 的分支，該席會被看成未知；無頭模式接著以退出碼二結束，並要求呼叫端自己傳家族旗標。這是刻意失敗關閉，不會把席誤分成別的家族。
- **Impact**: 日後加入 deepseek 席時，無頭流程會停下來等人補旗標，不會悄悄歸錯家族。
- **Trigger**: a deepseek seat is added to the roster
- **Trigger-Type**: event
- **Effort**: S
- **Source**: hderive g2 review 38be393a
- **Pointer**: docs/backlog/deferred-review-2026-10-21.md

### qualification-sweep does not read the headless pins file
- **Id**: BL-0267
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 資格掃描的旗標只從名冊組出來，不會讀無頭釘選檔。目前釘選檔只用來跟某次活動的名冊對照。
- **Impact**: 掃描與釘選檔各走各的，改一邊時另一邊不會跟著變。
- **Trigger**: the sweep is changed to take its pinned fields from the pins file
- **Trigger-Type**: event
- **Effort**: S
- **Source**: hderive g1 27ae0ab9
- **Pointer**: docs/backlog/deferred-review-2026-10-21.md

### Cross-harness token discipline for resident seats
- **Id**: BL-0271
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: peer
- **Reporter**: llm-playground claude-4 (c4140)；llm-playground claude-4 (c4140)；llm-playground claude-4 (c4140)
- **Report**: 01M5EWE5D6HT343H26BCXSHBPM；01M5EX8WGH1FT9MJDXYNQ2WGWN；01M5EY27E8E1PJVDB7B05FEENX
- **Reply**: 2026-10-21 01M5EWEHPTPD4F0P6KAP5VDCAH；2026-10-21 01M5EX9883PHTTG3N2HPE08CG6；2026-10-21 01M5EY2GX2JCMJB1VX3TMF81EX
- **Problem**: 跨工具的長駐席位沒有共用的用量紀律。交接時機、讀檔、輪詢、子代理與回覆節奏都靠各席自己拿捏。
- **Impact**: 主執行緒會累積到十億級用量。壓縮後仍比新執行緒肥，成本與延遲都下不來。
- **Trigger**: the owner decides whether to build P1-P3 of the concurrency plan.
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: PEER llm-playground claude-4 2026-10-21
- **Pointer**: docs/backlog/cross-harness-token-discipline.md
- **Context**: Item 4: owner chose P0 only (d-02c60498); p0spike 8eee6eac0 settled the seven hook facts; P1-P3 not started.

### Guidance cut gate is red on develop and not in preflight
- **Id**: BL-0272
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 指引裁切檢查在開發主線上是紅的，也沒接進合併前檢查。它一定要指定基準，而合併前檢查沒有固定的舊版基準。
- **Impact**: 摘要與評測包不一致時，合併前檢查現在不會擋下。
- **Trigger**: after the second-phase pack covers every manifest file that differs from the 2.x baseline
- **Trigger-Type**: event
- **Effort**: S
- **Source**: dwire merge 215d9084c, 2026-10-21 discoverability audit
- **Pointer**: docs/backlog/guidance-cut-gate-red-not-in-preflight.md
- **Context**: The check against base 3.0.0-alpha.3 exits 1. The evidence-discipline digest does not match the pack.

### Review deferrals from 2026-10-21
- **Id**: BL-0276
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 當天審查留下的小項多已修完，剩下幾組可等待的小項，以及凍結在評測檔裡的三項成本欄位問題。
- **Impact**: 凍結檔內的成本欄位問題要等下一個新評測列才能修。
- **Trigger**: the deferred review items from 2026-10-21 can be picked up now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: dmech, dwire and bl215 reviews, 2026-10-21
- **Pointer**: docs/backlog/review-deferrals-2026-10-21.md
- **Context**: Fixed: fixa, bl273, runnerk, fixb, fixc, bl276r, tokrace (aa49e22e8, tokmech), pidbound (7e9b235e1). Left: dnone, deval, three dcard-v3 items, repo-residue-sweep mkdtemp throw; see sidecar.

### Remaining entry gaps from the 2026-10-21 discoverability audit
- **Id**: BL-0277
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: owner
- **Problem**: 盤點還有幾個入口沒教完。派工樹只有一行說明，工頭派工自述還沒接上第五級，警告格式號稱會在工作階段開始時用但沒有掛上，任務的多數子命令也沒有入口。
- **Impact**: 功能在，但其他代理仍不知道這些入口何時該用。
- **Trigger**: the remaining entry gaps named in the 2026-10-21 audit can be taught now
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: 2026-10-21 discoverability audit
- **Pointer**: docs/plans/evidence/2026-10-21-discoverability-audit/README.md
- **Context**: Detail in remaining-discoverability-entry-gaps.md. Dispatch-tree sentence withdrawn 2026-10-23: neither pilot arm opened depth0-control-loop.md; needs a SKILL.md-level change with its own eval.

### Uncalled-script follow-ups that touch guidance need eval
- **Id**: BL-0279
- **Status**: open
- **Since**: 2026-10-22
- **Origin**: owner
- **Problem**: 十支腳本已標明誰在用。還有四件後續這次沒做，兩件要先評測，一件要負責人決定，一件被已封印的圖擋住，並非四件都改指引。
- **Impact**: 指引仍沒寫何時、由誰去跑，之後的人還是會猜。
- **Trigger**: the owner accepts an eval for the guidance follow-ups in the sidecar
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: BL-0275 relabel, 2026-10-22
- **Pointer**: docs/backlog/uncalled-scripts-guidance-follow-ups.md
- **Context**: two need eval, one needs an owner decision, one is blocked by a sealed graph pin. (c) closed by ADR-0002 (qc-panel dormant).

### dispatch-hetero test suites leave detached child processes behind
- **Id**: BL-0289
- **Status**: open
- **Since**: 2026-10-23
- **Origin**: self
- **Problem**: Two detached helper processes from a dispatch-hetero test run were still running nine days later on this host.
- **Impact**: A suite leaves detached children behind and wastes host resources.
- **Trigger**: next time the dispatch-hetero suites are touched
- **Trigger-Type**: event
- **Effort**: S
- **Source**: observed on this host, 2026-10-23
- **Pointer**: docs/backlog/dispatch-hetero-suite-detached-children.md
- **Context**: Processes were bash -c IN_DETACHED_CHILD=1 ... detached_main from /tmp/autopilot-test-dispatch-hetero-*. Add cleanup in the suite.

### Seat schema admits / and . in engine and model; audit path-building consumers
- **Id**: BL-0291
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: self
- **Problem**: 座位 schema 現在允許引擎與模型名稱含斜線和句點（oqseat 單元），所以含上層目錄的名稱也能通過檢查；所有用這些名稱組檔案路徑的使用端都需要逐一檢查。
- **Impact**: 若某處直接把 id 拼進檔案路徑，可能寫到預期目錄之外。
- **Trigger**: the audit can be picked up now; no merge needed
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: 2026-10-24 oqseat review (lane/oqseat, not yet on develop)
- **Pointer**: docs/backlog/seat-schema-slash-dot-path-consumers.md
- **Context**: The widening is on lane/oqseat, not yet on develop; develop's isSafeSeatId still rejects them. Details in sidecar.

### resolve-review-loop.sh family_of case table has no direct test
- **Id**: BL-0292
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: self
- **Problem**: 審查迴圈解析腳本裡的 bash 家族對照表沒有直接測試；新的家族測試只涵蓋內嵌的 JS 版本。
- **Impact**: 對照表改錯或與 JS 版漂移時，沒有測試會發現，跨家族檢查可能誤判。
- **Trigger**: the bash family table is edited or a new engine family is added
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: 2026-10-24 oqseat review
- **Pointer**: docs/backlog/family-of-case-table-no-direct-test.md
- **Context**: The JS familyOf suite is on lane/oqseat; bash family_of is only touched indirectly today. Details in sidecar.

### plan-review: author-side precondition_failed burns the logical id
- **Id**: BL-0296
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: self
- **Problem**: plan 審查在作者端的前置條件失敗時，會把邏輯 id 直接燒掉，同一代重跑也被終局鎖擋住，只能換 id。
- **Impact**: 一個小前置錯誤就要換 id 重來，浪費一輪審查。
- **Trigger**: next plan review that dies on an author-side precondition_failed
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: bldone9 2026-10-24 code reading
- **Pointer**: docs/backlog/plan-review-precondition-burns-logical-id.md

### Long sessions never reap their background work
- **Id**: BL-0297
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: peer
- **Reporter**: llm-playground c4140
- **Report**: 01M5NBBZDBHD4Y53Q78QP2ZNKB
- **Reply**: none
- **Problem**: 長時間的工作階段不會回收背景工作：背景殼層、監看與等待迴圈會一直累積，tasks 目錄也越積越多。peer llm-playground 回報。
- **Impact**: 資源被吃掉，還會有失控的等待迴圈。
- **Trigger**: a long session shows leftover background shells, or a state-checkpoint restore is edited
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER-REPORTED llm-playground c4140 2026-10-24
- **Pointer**: docs/backlog/long-session-background-work-not-reaped.md

### fbtool P1: findings-write protection must land before the cc runner
- **Id**: BL-0299
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: self
- **Problem**: 審查結果檔的寫入保護，必須在接上 cc runner 之前完成。目前的文字檢查只能防不小心提到，擋不了真的寫入。
- **Impact**: 沒有真正保護，審查結果可能被改寫而不被發現。
- **Trigger**: before the cc runner is wired into fbtool, or fbtool P1 starts
- **Trigger-Type**: event
- **Effort**: M
- **Source**: bldone9 2026-10-24 fbtool P1 note
- **Pointer**: docs/backlog/fbtool-p1-findings-write-protection.md

### Claude Code upstream report draft (owner decides whether to send)
- **Id**: BL-0301
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: self
- **Problem**: 整理了一份給 Claude Code 上游的回報草稿，交 owner 決定是否送出。內容是同為 2.1.309 時觀察到的四個行為問題。
- **Impact**: 不回報的話，這些問題會繼續影響長時間工作。
- **Trigger**: owner decides whether to send the draft
- **Trigger-Type**: owner
- **Effort**: XS
- **Source**: bldone9 2026-10-24 observations on CC 2.1.309
- **Pointer**: docs/backlog/claude-code-upstream-report-draft.md

### run-implementer-matrix.sh pins a stale implementer pack digest
- **Id**: BL-0303
- **Status**: open
- **Since**: 2026-10-25
- **Origin**: self
- **Problem**: implementer 矩陣評測腳本寫死的 pack 雜湊，和目前 pack 檔的實際雜湊不一致，正式執行一開始檢查輸入就會失敗。這是既有問題，不是新引入。
- **Impact**: implementer 矩陣評測無法正式執行，要先決定是重新凍結 pack 還是還原 pack。
- **Trigger**: next implementer matrix run is planned, or the script or its pack is edited
- **Trigger-Type**: event
- **Effort**: S
- **Source**: BL-0294 hand finding 2026-10-25
- **Pointer**: docs/backlog/implementer-matrix-stale-pack-digest.md

### bash-launch-guard test timing assertion fails under high host load
- **Id**: BL-0305
- **Status**: open
- **Since**: 2026-10-25
- **Origin**: self
- **Problem**: 其中一條防護測試要求長輸入（16000 字元與 64 KB）各在 100 毫秒內處理完。主機負載高（約 35）時穩定失敗：10/25 量到 121 與 106 毫秒，三次重跑都紅；負載正常時是綠的。
- **Impact**: 推送前跑套件會出現和改動無關的紅，要人工判讀是不是真的有問題。
- **Trigger**: next time the suite is run before a push, or the test file is edited
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: 2026-10-25 pre-push suite runs at 670b3ffaf and 1d38cfefb
- **Pointer**: docs/backlog/bash-launch-guard-timing-assertion-load.md

### depth-0 per-turn gate: P3 evaluation and P4 guidance still to do
- **Id**: BL-0306
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: owner
- **Problem**: 計畫要讓 depth-0 依任務決定要不要替工人開啟每回合驗證。P0 探測、P1 驗證腳本、P2 接線都已完成並合併，還沒做的是 P3 開關評測與 P4 指引。
- **Impact**: 沒做完評測就不知道這功能值不值得預設推廣，預設仍維持關閉。
- **Trigger**: P3 ON/OFF evaluation can start now (cap 20 USD approved); P4 only on a P3 PASS
- **Trigger-Type**: ready
- **Effort**: L
- **Source**: owner d-32849d39 (A, default off), d-6f6b706f (A: P0 cap 1 USD, P3 cap 20 USD), d-b3bc7aef (BL-0318 option B); plan merged 4ebcb428b
- **Pointer**: docs/backlog/depth0-per-turn-gate-status.md
- **Context**: P1 ae44b5a0a; P2 merges 7230a7f6e, b60ab831a; owner said run P3 right after acceptance passes; follow-on of BL-0055. Detail at Pointer.

### dev-setup --harness agy --install fails validation on agy 1.4.7
- **Id**: BL-0308
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: peer
- **Reporter**: twgs-revival peace--claude-2
- **Report**: 2026-10-26 fleet
- **Reply**: 2026-10-26 fleet
- **Problem**: 3.0.0-alpha.6 在 agy 1.4.7 安裝驗證失敗（3 個錯誤、4 個警告，載入的 agent 為 0）：三個 agent 檔的工具欄位格式不對，另有檔案不被載入或被截斷。
- **Impact**: agy 上裝不起這個 plugin；agy 審查目前走 cleanroom，不受影響。
- **Trigger**: someone needs the autopilot plugin itself installed on agy, or agy reviewers stop using cleanroom
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER-REPORTED twgs-revival (peace--claude-2) 2026-10-26, agy 1.4.7, 3.0.0-alpha.6
- **Pointer**: docs/backlog/agy-147-plugin-install-validation.md
- **Context**: Check first whether Claude Code and Codex read an array-form tools field; then edit the source files or convert at agy install time.

### Orchestrator slows itself down: seven process gaps from a peer
- **Id**: BL-0309
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: peer
- **Reporter**: twgs-revival peace--claude
- **Report**: 2026-10-26 fleet
- **Reply**: 2026-10-26 fleet
- **Problem**: peer 回報編排者自己拖慢進度的七處：交接檔不分 owner 指示與前任判斷、停滯偵測看不到只改計畫不合入、DOA 內仍去問、審查迴圈不隨嚴重度縮編等。
- **Impact**: 流程多花輪次與 owner 時間；指引類改動要先有 ON/OFF 評測。
- **Trigger**: an ON/OFF eval slot opens for items 1, 5, 7, the item 3 DOA-table rows and the top-stale wiring (efficiency class, jumps the queue)
- **Trigger-Type**: owner
- **Effort**: L
- **Source**: PEER-REPORTED twgs-revival (peace--claude) 2026-10-26
- **Pointer**: docs/backlog/orchestrator-self-slowdown-seven-gaps.md
- **Context**: Items 2, 6 shipped c9366c79a; item 3 mechanism shipped 4a34aa3a0; item 4 closed (d-f1aea07b, A). Left: top-stale wiring, item 3 DOA-table rows, items 1, 5, 7, all guidance needing ON/OFF eval. See sidecar.

### Stamped eval rows may have lost files from their frozen set
- **Id**: BL-0310
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: self
- **Problem**: 已蓋章的評測列可能漏凍結檔案（bpack、gdorm、dcard-v3、qs-v3）。要查蓋章後這些檔有沒有被改過；改過的話，該列結果無法從原檔重新推導。
- **Impact**: 檔案蓋章後若被改，舊評測列的結果就無法重新驗證。
- **Trigger**: a spare lane is free for the audit, or an old stamped row is re-derived
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: fbstamp closure-scan observation 2026-10-26
- **Pointer**: docs/backlog/stamped-rows-missing-frozen-files.md
- **Context**: Past batch evidence must not be edited; this is a read-only check. transcript-query.js unchanged since 10/4.

### affected-suites selects about 500 suites for the fbatch stub
- **Id**: BL-0311
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: self
- **Problem**: 評測用的 stub 檔與 dispatch 系列腳本同名，affected-suites 因此把約 500 支套件選進來，驗收時間大增。
- **Impact**: 每次動到相關檔，驗收都要多等很久。
- **Trigger**: next acceptance run that touches an fbatch stub, or the next edit to affected-suites.js
- **Trigger-Type**: event
- **Effort**: S
- **Source**: fbland and fbrestamp acceptance runs 2026-10-26
- **Pointer**: docs/backlog/affected-suites-overselects-on-stub-basename.md

### skill-onoff-markers suite is occasionally red, suspected $RANDOM directory collision
- **Id**: BL-0312
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: self
- **Problem**: skill-onoff-markers 測試偶發紅，懷疑建立臨時目錄時用隨機數取名而撞名；還沒重現確認。
- **Impact**: 推送前套件出現與改動無關的紅，要人工判讀。
- **Trigger**: next red of the skill-onoff-markers suite, or an edit to its make_repo helper
- **Trigger-Type**: event
- **Effort**: XS
- **Source**: pre-push suite runs 2026-10-26
- **Pointer**: docs/backlog/skill-onoff-markers-random-dir-collision.md

### Suites red on base at every pre-push run: one list
- **Id**: BL-0313
- **Status**: open
- **Since**: 2026-10-27
- **Origin**: self
- **Problem**: 推送前跑套件，有十幾支在 base 上本來就紅（非新引入），每次都要人工判讀；清單與各自的紅法見旁檔。
- **Impact**: 真正的新紅會被淹沒，每次推送都得重新分辨。
- **Trigger**: next pre-push suite run, or a lane touches one of the listed suites
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: pre-push suite runs 2026-10-26 to 10-27 (noexpiry, agyargv2, fbland, fbv3)
- **Pointer**: docs/backlog/base-red-suite-list.md
- **Context**: bash-launch-guard timing is BL-0305 and is not repeated here.

### Capability probe classifies errors from a merged stderr file after agy-stream-json
- **Id**: BL-0314
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: self
- **Problem**: 能力探測讀合併後的錯誤檔做分類；agy 經 stream-json 處理後，stdout 上的額度或認證字樣消失，分類會失準（與 BL-0298 同類退化）。
- **Impact**: 額度或認證錯誤被當成別種錯誤，席位狀態可能被誤判。
- **Trigger**: next edit to probe-engine-capability.sh or the dispatch-review agy handling, or a misclassified agy probe
- **Trigger-Type**: event
- **Effort**: S
- **Source**: bltidy14 candidate (1), 2026-10-26
- **Pointer**: docs/backlog/probe-classify-error-loses-agy-stdout-signals.md
- **Context**: Same class, minor: dispatch-review.sh AGY_OUT rescue, cleanroom-launch.sh OUT_FILE.

### Two suites go red under load: paid-batch-auth-stop and agy-stdin-transport
- **Id**: BL-0315
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: self
- **Problem**: paid-batch-auth-stop 有時序問題（calls=2）；agy-stdin-transport 的 hetero 段推送前對照時 base 上也紅。兩支單跑都全過，判斷與負載有關，次數未量。
- **Impact**: 推送前套件出現與改動無關的紅，要人工判讀。
- **Trigger**: next time either suite goes red on a pre-push run, or either test file is edited
- **Trigger-Type**: event
- **Effort**: S
- **Source**: bltidy14 candidates (3) and (4), 2026-10-26
- **Pointer**: docs/backlog/intermittent-red-paid-batch-auth-stop-agy-stdin.md

### fbatch v3 pilot could confirm the develop journal only indirectly
- **Id**: BL-0317
- **Status**: open
- **Since**: 2026-10-27
- **Origin**: self
- **Problem**: findings-batch v3 先導測的 instrument_checks 只能用間接證據確認 develop 的紀錄檔，因為 cell repo 在計分後就清掉了。
- **Impact**: 儀器檢查目前只有間接證據，沒有直接的 journal 檔可查。低優先。
- **Trigger**: the next paid ON/OFF eval that scores from a develop journal, or the runner is next edited
- **Trigger-Type**: event
- **Effort**: S
- **Source**: findings-batch-v3 pilot closure 2026-10-27 (self)
- **Pointer**: docs/backlog/fbatch-v3-journal-indirect-evidence.md
- **Context**: Direct evidence needs the runner to keep the journal file before the cell repo is cleaned.

### The library path openDecision() skips the --not-authorized and DOA checks
- **Id**: BL-0320
- **Status**: open
- **Since**: 2026-10-28
- **Origin**: self
- **Problem**: 只有命令列開卡會檢查「這題為何輪不到自己決定」的旗標與 DOA；程式內部開卡的路徑（提問攔截 hook、子代理預算 hook、資格考確認代 owner 開卡）完全不檢查。
- **Impact**: 自動開卡的路徑在自主模式下仍能開出 DOA 內的卡，繞過 BL-0309 第 3 項剛上的防線。
- **Trigger**: someone picks up BL-0309 item 3 follow-ups, or an auto-opened card inside the DOA is seen in an autonomous session
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: doagate merge 4a34aa3a0 and depth-0 ruling 2026-10-28 (self)
- **Pointer**: docs/backlog/open-decision-library-path-unchecked.md
- **Context**: Depth-0 ruling on doagate deliberately did not add the check to the library path; first inventory what boundary each of the three callers' cards belongs to, then decide whether to add it. Follow-on of BL-0309.

### A review seat that fails once voids the whole generation
- **Id**: BL-0322
- **Status**: open
- **Since**: 2026-10-28
- **Origin**: self
- **Problem**: 四席審查中只要有一席失敗（例如被閒置上限砍掉），整代審查就作廢，必須人工把同一席重派才能繼續；同席重派通常就成功。
- **Impact**: 每次單席故障都多等一輪並要人介入，審查變慢。
- **Trigger**: next review generation voided by a single seat fault, or the next edit to the review collector
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: bltidy20 handoff list 2026-10-28; idle cap shipped ae247356e, paid-batch auth stop shipped 8183aaaf2
- **Pointer**: docs/backlog/review-seat-fault-no-auto-redispatch.md

### The severity table edit in code-review was never measured
- **Id**: BL-0323
- **Status**: open
- **Since**: 2026-10-28
- **Origin**: self
- **Problem**: 審查指引的嚴重度表原本與批次指引互相矛盾，後來改字面消除了矛盾，但這處改動沒有跑過開關對照評測。
- **Impact**: 指引改動沒有成績單；單一工作線的行為是否真的沒變，也沒量過。
- **Trigger**: next eval round on quality-pipeline guidance, or the owner deciding to accept the edit as a wording fix
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: bltidy20 handoff list 2026-10-28; edit in 33224ad72
- **Pointer**: docs/backlog/code-review-tier-table-edit-not-evaluated.md

### Find out which rail starts grok with the fleet server loaded
- **Id**: BL-0324
- **Status**: open
- **Since**: 2026-10-28
- **Origin**: self
- **Problem**: 本 session 底下啟動的 grok 曾載入艦隊通訊服務；艦隊端已修，但我方哪條派工線起的 grok、有沒有把艦隊設定帶進去，還沒查。
- **Impact**: 工作用引擎可能意外出現在艦隊名單，收到不該收的訊息。
- **Trigger**: next time a worker engine shows up in the fleet directory, or the next edit to a grok launch rail
- **Trigger-Type**: event
- **Effort**: S
- **Source**: bltidy20 handoff list 2026-10-28 (self)
- **Pointer**: docs/backlog/grok-loads-fleet-under-session-tree.md

### Other Stop hooks run git on the worker tree and read its own .git/config
- **Id**: BL-0325
- **Status**: open
- **Since**: 2026-10-29
- **Origin**: self
- **Problem**: 每回合驗證已改成不讀工人自己的 git 設定檔，但其他在結束時執行的鉤子仍直接對工人的工作目錄跑 git，工人若改了自己的 git 設定，這些鉤子看到的結果可能被影響。
- **Impact**: 工人可藉改自己的 git 設定，讓這些鉤子漏報或誤報；目前只是風險，尚未見實際被利用。
- **Trigger**: next change to a Stop or SubagentStop hook that runs git, or a worker seen editing its own git config
- **Trigger-Type**: event
- **Effort**: M
- **Source**: BL-0319 closeout, 2026-10-29 (self)
- **Pointer**: docs/backlog/stop-hooks-git-isolation.md
- **Context**: Same class as the closed BL-0319; per-turn-gate is handled, the hooks listed at Pointer are not. Follow-on of BL-0306.

### Per-turn gate P2 known limits to settle in P3 design
- **Id**: BL-0326
- **Status**: open
- **Since**: 2026-10-29
- **Origin**: self
- **Problem**: 每回合驗證的接線版有幾個已知限制：工人換到子目錄時可能不生效、前景原生子代理無法使用、與另一個外殼同時觸發時工人只剩一次修正機會、紀錄檔名格式讀取端要配合、兩個 git 設定項沒有測試涵蓋。
- **Impact**: 不處理的話，評測結果可能被這些限制扭曲，或有工人繞過驗證的縫。
- **Trigger**: P3 design starts, or the next change to the per-turn gate hook
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: d0gp2 P2 merge review, 2026-10-29 (self)
- **Pointer**: docs/backlog/depth0-per-turn-gate-status.md
- **Context**: Five limits listed at Pointer under Known limits of P2. Follow-on of BL-0306.

### Selection result reports each changed file's contribution
- **Id**: BL-0333
- **Status**: open
- **Since**: 2026-10-29
- **Origin**: owner
- **Problem**: 選出幾百支套件時，看不出是哪個改動檔把它們拉進來的，也就不知道該先處理哪個。
- **Impact**: 每次都要手動逐檔試跑才能找出灌水來源，這次調研就花了大量時間。
- **Trigger**: work can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: owner request 2026-10-29 (suite speed research)
- **Pointer**: docs/backlog/pre-push-suite-speed.md
- **Context**: Contribution report: add per-file contrib to --json. Negative control: single-suite diff reports exactly 1 sole-pulled. After BL-0332.

### Time assertions scale with the timing factor and host-wide process scans are prefix-scoped
- **Id**: BL-0334
- **Status**: open
- **Since**: 2026-10-29
- **Origin**: owner
- **Problem**: 幾支測試用固定的短時間判斷（例如 2 秒內工人要啟動），機器忙的時候工人還沒起來就被判失敗；另有測試掃整台機器的程序，會看到別人的。
- **Impact**: 2026-10-29 串行跑已紅過一次；平行下預期更多假紅（預測：負載 30+ 時牆鐘斷言串行下就已紅）。
- **Trigger**: work can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: owner request 2026-10-29 (suite speed research)
- **Pointer**: docs/backlog/pre-push-suite-speed.md
- **Context**: Scale time asserts by test_timing_scale, prefix-scope pgrep, wait FAKE_STARTED in gate-rules R2 :133. Negative control: red under load before, green after (B3).

### Rerun and serial stage of the parallel run produce false reds
- **Id**: BL-0335
- **Status**: shipped 53b8a434b 2026-10-29
- **Since**: 2026-10-29
- **Origin**: self
- **Problem**: 平行模式的重跑和串行段會出假紅：有些套件在池內紅、串行重跑還是紅，但同一版本單獨直接跑是綠的，害人以為改動壞了。
- **Impact**: 推送前套件出現假紅，要人工一支支單獨重跑確認，白費時間又不可信。
- **Trigger**: work can start now; the fix is already in progress
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: 2026-10-29 pre-push run (self)
- **Pointer**: docs/backlog/pre-push-suite-speed.md
- **Context**: Facts under the BL-0335 section at Pointer. Follow-on of BL-0331.
