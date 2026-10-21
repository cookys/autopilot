# autopilot — BACKLOG

<!-- next-id: BL-0278 -->

One entry = one index row per [`references/backlog-entry.md`](../references/backlog-entry.md); evidence lives at
the row's `Pointer` (a plan, a project, or a sidecar under `docs/backlog/`). Gate:
`node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (config `.claude/backlog-config.md`, `mode: block`;
residual debt in `.claude/backlog-debt.json` ratchets down only). Migrated 2026-09-14 by
`scripts/migrate-backlog-entries.js` (manifest `docs/backlog/MIGRATION-2026-09-14.json`).

**FIRED queue (order, as of 2026-09-14)** — rows whose trigger has fired are worked in this order:

1. ~~`chatgpt-tunnel-host` (E)~~ SHIPPED v2.36.32 · 2. ~~`openclaw` main claim~~ v2.36.28 · 3. ~~`cookys-7840hs` four defects~~ v2.36.33 ·
4. ~~foreman rail Shape B~~ v2.36.34 · 5. ~~`308-db` (a) residue sweep~~ v2.36.35 · 6. ~~2026-09-12 dogfood four defects~~ v2.36.36 ·
7. ~~backlog entry schema Phases 1–4~~ v2.36.38–39 · 8. ~~disposition resume~~ v2.36.41 · 9. ~~ledger flag burns a grant~~ v2.36.42 · 10. ~~reviewer no_verdict releases the claim~~ v2.36.43. Next: operator-named work, or the 308-8f dispatch-hetero reports.

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
- **Source**: peer report from twgs-revival 2026-09-11, re-derived locally the same day with four probes; `scripts/lib/agy-argv-ceiling.sh`, callers at…
- **Pointer**: docs/backlog/agy-input-format-stream-json-raises-the-payload-ceiling-but-does-not-remove-it-a.md
- **Context**: a peer host (twgs-revival, 2026-09-11) reported that agy 1.2.0's `--input-format stream-json` reads NDJSON from stdin and so bypasses the 131072-byte `MAX_ARG_STRLEN` argv wall, measured at 208951 bytes with `status: SUCCESS`, and…

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

### Arm the ordinary-strike threshold (currently shadow-only) — DATED REVIEW REQUIRED
- **Id**: BL-0046
- **Status**: open
- **Since**: 2026-08-22
- **Origin**: self
- **Problem**: 引擎評分機制會記錄席位的「失誤次數」，但目前只做影子記錄、不會真的把席位降級，因為怕誤判。要等影子資料累積並人工確認屬實，才打開。 (draft)
- **Impact**: 表現差的席位不會被自動降級，目前靠人工留意。擁有者 2026-10-13 同意等 11/22 檢討再決定。
- **Trigger**: When shadow data exists for a role — i.e. `would_requalify` has fired at least once against a seat and the operator has replayed those strikes and agrees each was a true engine/pair failure. Also: this row must be re-read by…
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: hetero design panel 2026-08-22 (kimi's "trench coat" objection), shipped shadow-first per synthesis §8.
- **Pointer**: docs/backlog/arm-the-ordinary-strike-threshold-currently-shadow-only-dated-review-required.md
- **Context**: v2.34.35 ships `ordinary_strike` accrual in SHADOW: strikes are recorded and `would_requalify` is projected, but `admission_status` stays `qualified`.

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
- **Problem**: 實驗發現每回合重新提醒模型守規則，只是讓措辭改變，行為沒有明顯進步。於是提出每回合驗證的做法，但還沒做。 (draft)
- **Impact**: 長時間工作時模型仍可能漸漸偏離規定，目前沒有機制擋。 (draft)
- **Trigger**: Plan review of docs/plans/2026-10-20-per-turn-gate.md, then owner approval of the P0 spike. Sidecar t14-long-horizon-per-turn-verification-gate.md stays referenced until a later change owns it.
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report.md (prior docs/projects/_archive/2026/07/2026-07-08-t14-reinject/report.md already corrected)
- **Pointer**: docs/plans/2026-10-20-per-turn-gate.md
- **Context**: Second experiment SUCCESS (M1 28/29 vs 5/29, M2 27/29 vs 11/29). Owner d-9f311d27 chose to write the plan. docs/plans/2026-10-20-per-turn-gate.md is drafted, awaiting review. C-arm M2 drop 23/30 to 11/29 is an open anomaly in phase P1.

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
- **Problem**: 測試完整性檢查目前只警告不擋。回放最近 60 個 merge 的違規，固定 seed 抽 150 筆，真陽性為 0，誤報太多，所以維持警告。
- **Impact**: 維持警告時違規仍可通過，只能靠人自己看警告，沒人看就漏掉。 (draft)
- **Trigger**: (a) exempt a test removed with its feature when same-topic replacement is added, keep N4; (b) surface_touch only on modified or deleted lines; (c) assertion form "if ! cmd; then exit"; (d) replay same seed and 60 merges, judge every group.
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。
- **Pointer**: docs/backlog/check-test-integrity-sh-warn-block-needs-an-accuracy-record-first.md
- **Context**: Merge 53dc0ad3f tightened (a)(b)(c), added N1-N8 and F1-F5. v2: 668 violations, 16 groups, 1 true positive, 15 false positives (93.8% false-positive rate); stays warn. Evidence: docs/plans/evidence/2026-10-19-test-integrity-replay-v2/.

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

### qc-panel refute pass — graduate from shadow to gating (calibration-gated)
- **Id**: BL-0069
- **Status**: open
- **Since**: 2026-06-24
- **Origin**: self
- **Problem**: 品管面板的「反駁檢查」目前只做影子記錄，不影響結論，因為怕它誤把嚴重問題壓掉。要看校準報告確認安全後才改成真的把關。 (draft)
- **Impact**: 不改則反駁檢查沒有實際效果，只是多花一點成本。 (draft)
- **Trigger**: `scripts/calibration.sh report` over accumulated refute-shadow samples shows the refute pass does **not** false-suppress critical/`MISSED:` findings (meets the existing graduation-criteria data block). Until then it stays shadow.
- **Trigger-Type**: event
- **Effort**: S
- **Source**: 2026-06-24 v2.24.0 ship (`77214a1`) + depth-0 qc 🔵 (reviewer `a4162329`).
- **Pointer**: docs/backlog/qc-panel-refute-pass-graduate-from-shadow-to-gating-calibration-gated.md
- **Context**: v2.24.0 shipped the refute pass as **shadow / non-gating** — it emits `refute_shadow` + rides into the calibration `--source` tag but never alters `verdict` (a refute pass that suppresses a true critical is worse than the bug it fixes).

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

### Affected-suites selects nearly every suite for a small diff
- **Id**: BL-0213
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: self
- **Problem**: 選擇器對很小的改動也選了幾乎全部套件。實測兩次合併：只改開發安裝腳本的一次選了 546 個（共 616），只改審查解析模組的一次選了 588 個（共 617）；其中固定必跑的只有 15 個，其餘多半是被少數共用檔案連鎖帶進來。
- **Impact**: 結果閘要執行紀錄，選五百多個套件就記不成，每次 push 只能報沒有紀錄；品質流程的測試也要跑這麼多。
- **Trigger**: the next small diff that selects more than half of all suites, or any push where the outcome gate reports no record
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: closeout4 investigation of node scripts/affected-suites.js --json on merges d997355a9 and b8bdd61f3, 2026-10-19
- **Pointer**: docs/backlog/affected-suites-selects-nearly-every-suite.md
- **Context**: Selected 102 / 269 / 83 on merges d997355a9, b8bdd61f3, 3765302f3. Main cause: decisions-sidecar.js reads src/engine/autopilot-engine.js as data (fileContains).

### Verify Codex marketplace remove and hook de-duplication on a real Codex CLI
- **Id**: BL-0214
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: self
- **Problem**: 開發模式安裝改成使用者層 hook 設定後，有兩件事只用假的 Codex 測過，沒在真的 Codex 上驗：一是移除 marketplace 的子命令是否存在可用，好讓解除安裝能清掉註冊；二是使用者層與外掛層同名 hook 是否會去重。
- **Impact**: 若子命令不存在，解除安裝會留下殘留註冊；若不去重，hook 可能每次觸發兩次。
- **Trigger**: the next dev-mode install on Codex (dev-setup.sh --harness codex --install) on a host with the real CLI
- **Trigger-Type**: event
- **Effort**: S
- **Source**: follow-up of BL-0027 (merge d997355a9), 2026-10-19
- **Pointer**: docs/backlog/verify-codex-marketplace-remove-and-hook-dedupe.md
- **Context**: Check (a) that "codex plugin marketplace remove" exists and works so --uninstall clears the derived dev marketplace registration, and (b) whether a user-level and a plugin-level hook with the same name are de-duplicated.

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

### Managed rail: no_verdict leaves the phase in REVIEWING and resume refuses
- **Id**: BL-0220
- **Status**: open
- **Since**: 2026-09-17
- **Origin**: self
- **Problem**: 審查沒有裁決時，階段會停在審查中，恢復執行會拒絕繼續。紀錄寫著可以等待後恢復，恢復卻不接受這個階段。
- **Impact**: 審查格式出錯後活動停在不可恢復的階段，這次嘗試只能放棄。
- **Trigger**: any managed campaign whose in-rail reviewer returns no_verdict (format fault) — the next run of that station
- **Trigger-Type**: event
- **Effort**: M
- **Source**: 1b-B campaign 2026-09-17; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/managed-rail-no-verdict-reviewing-resume.md
- **Context**: The claim is kept, but the persisted phase stays REVIEWING, outside the durable-wait set, so resume is refused.

### Managed rail: changed_files at the cap refuses repair when every sealed path was touched
- **Id**: BL-0221
- **Status**: open
- **Since**: 2026-09-17
- **Origin**: self
- **Problem**: 實作已經改過每一條封存路徑時，變更檔數達到上限，修復回合會被拒絕，即使沒有再碰到新檔案。
- **Impact**: 該修的回合進不去，封存路徑全被碰過的活動無法在軌道內修復。
- **Trigger**: the hand changed every sealed output path and verification is red, so repair is refused because changed_files is at max_changed_files
- **Trigger-Type**: event
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-17 impl-run1; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/managed-rail-changed-files-repair-refused.md
- **Context**: Original effort label was Fix. The changed_files axis uses >= against the sealed cap, so a repair that adds no new path is refused.

### next-touch-validation reads symbolic-ref HEAD and fails in a detached verification checkout
- **Id**: BL-0222
- **Status**: open
- **Since**: 2026-09-17
- **Origin**: self
- **Problem**: 下一觸驗證測試會讀目前分支名稱。受管軌道的驗證檢出是分離狀態，沒有分支名稱，這個讀取會失敗。是否仍會紅尚未重跑確認。
- **Impact**: 軌道內驗證可能因此變紅，同一提交在一般分支上卻是綠的。
- **Trigger**: next-touch-validation reads symbolic-ref HEAD during the rail's detached verification checkout
- **Trigger-Type**: event
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-17 detached checkout; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/next-touch-validation-symbolic-ref-detached.md
- **Context**: Seen 2026-09-17: red in-rail, green on a branch. Whether it is still red when detached was not re-run.

### Managed rail: a red campaign_verification keeps only digests, so the failing command is lost
- **Id**: BL-0223
- **Status**: open
- **Since**: 2026-09-17
- **Origin**: self
- **Problem**: 驗證變紅時，紀錄只留摘要雜湊，失敗的指令和輸出都沒留下來，事後看不出是哪一步、印了什麼。
- **Impact**: 只能重跑才知道失敗原因，當次的指令與輸出已經不在紀錄裡。
- **Trigger**: a red campaign_verification whose receipt keeps only digests, so the failing command and its output are lost
- **Trigger-Type**: event
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-17 impl-run1; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/managed-rail-red-verification-digests-only.md
- **Context**: The receipt sees stdout, stderr, and exit status, but nothing durable keeps the failing command or its tail.

### Managed rail: graph-check allows max_wall_seconds to 14400 but the contract schema caps 7200
- **Id**: BL-0224
- **Status**: open
- **Since**: 2026-09-17
- **Origin**: self
- **Problem**: 圖檢查允許牆鐘上限到一萬四千四百秒，契約上限是七千二百秒。收件時才拒絕，而且已經先花掉一次授權。
- **Impact**: 收件前檢查放行、收件時才拒絕，一次授權額度已經燒掉。
- **Trigger**: graph-check admits max_wall_seconds above 7200, then intake rejects and the grant attempt is already spent
- **Trigger-Type**: event
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-17 intake-rejected; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/managed-rail-max-wall-seconds-schema-mismatch.md
- **Context**: Original effort label was Fix. One limit, checked at graph time, so intake does not burn the attempt.

### Managed rail: ADJUDICATING or VERTICAL_VERIFICATION resume spends the claim before git-drift
- **Id**: BL-0225
- **Status**: open
- **Since**: 2026-09-16
- **Origin**: self
- **Problem**: 在裁決中或垂直驗證階段恢復時，會在檢查版本是否漂移之前就花掉任務的領取額度。
- **Impact**: 版本已漂移的恢復仍先消耗領取額度，一次嘗試白費。
- **Trigger**: a drifted ADJUDICATING or VERTICAL_VERIFICATION resume spends the Mission claim before the git-drift check
- **Trigger-Type**: event
- **Effort**: S
- **Source**: plan 2026-09-16 section 6, rubric R6; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/managed-rail-adjudicating-resume-spends-claim.md
- **Context**: Extend the pre-claim preflight from durable-wait phases to every git-candidate resume.

### Managed rail: a reviewer that withdraws a MUST-FIX and reuses the finding id is no_verdict
- **Id**: BL-0226
- **Status**: open
- **Since**: 2026-09-16
- **Origin**: self
- **Problem**: 審查者撤回一則必須修復、又沿用同一個發現編號時，系統把它當成沒有裁決，活動因此停住，雖然裁決其實讀得到。
- **Impact**: 讀得到的撤回被當成沒有裁決，活動停在等待，修復被拖延。
- **Trigger**: a rail review that withdraws a MUST-FIX and reuses the finding id is normalized as no_verdict
- **Trigger-Type**: event
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-16 MiniMax r1; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/managed-rail-revoked-finding-reused-id.md
- **Context**: Drop withdrawn findings before the duplicate-id check and keep them advisory.

### Managed rail does not pass the scorecard scope file, so fallback_ladder stays empty
- **Id**: BL-0227
- **Status**: open
- **Since**: 2026-09-15
- **Origin**: self
- **Problem**: 受管軌道沒把記分卡範圍檔傳進去，後備梯永遠是空的。有證據的品管席若沒有釘選，收件就會拒絕。這件事現在是否仍成立尚未確認。
- **Impact**: 有資格的品管席若沒釘選就進不了收件。是否仍如此尚未確認。
- **Trigger**: a qc seat qualified by scorecard for reviewer is refused at intake without a pin because fallback_ladder stays empty
- **Trigger-Type**: event
- **Effort**: S
- **Source**: plan section 0 fact 1 / section 6, 2026-09-15; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/managed-rail-scorecard-scope-fallback-ladder.md
- **Context**: Unconfirmed whether still true. v2.36.46 chose standing pins and did not make the rail pass the scope file.

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

### A stale topology tuple derails a plan-review loop
- **Id**: BL-0229
- **Status**: open
- **Since**: 2026-09-08
- **Origin**: self
- **Problem**: 拓撲記錄留著一個已退役的模型。計畫審查因此失敗，包裝程式結束碼為三且沒有任何輸出。兩項補救都還沒做：派工前對照模型清單，以及讓包裝程式露出執行器的錯誤訊息。
- **Impact**: 計畫審查會因過期席位名稱整圈停住，而且看不出是名稱錯了。
- **Trigger**: the next plan-review loop that ends required_seat_transport_exhausted, or the next topology regeneration
- **Trigger-Type**: event
- **Effort**: M
- **Source**: observed 2026-09-08 fleet-comms; restored 2026-10-19; dropped by 41f1bff64; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/stale-topology-tuple-derails-plan-review.md
- **Context**: Recorded model was retired. Two mitigations never done: validate with the runner model list, and surface runner stderr.

### consult_dispatch has no seat once the qc panel consumes the roster
- **Id**: BL-0230
- **Status**: open
- **Since**: 2026-09-11
- **Origin**: self
- **Problem**: 品管席把名冊上的引擎都佔走之後，諮詢席就沒有位子。解析仍退回同一家族的預設席，諮詢程式接著拒絕，提問的人沒有正式通路。
- **Impact**: 需要問另一個家族時沒有支援的路，只能繞過制度手動呼叫。
- **Trigger**: next consult on a host whose qc panel covers the whole roster, or the next edit to consult resolution
- **Trigger-Type**: event
- **Effort**: S
- **Source**: measured 2026-09-11 fleet-comms; restored 2026-10-19; dropped by 41f1bff64; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/consult-dispatch-no-seat-after-qc-panel.md
- **Context**: Resolver still falls back to a same-family native seat, and consult then refuses that seat.

### Per-hook by per-harness support matrix with verification dates
- **Id**: BL-0231
- **Status**: open
- **Since**: 2026-09-07
- **Origin**: owner
- **Problem**: 每個掛鉤在各執行環境是否支援，只做了一半。腳本已出貨，但每一格都還沒驗證，六十天過期檢查也沒進上線前檢查或持續整合。
- **Impact**: 表上看得到掛鉤，卻不知道各環境是否真的跑過，過期也不會被擋下。
- **Trigger**: the next second-harness hook registration, or a harness-maintenance run finding a hook-event claim older than 60 days
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: owner 2026-09-07 dirty-tree hook; restored 2026-10-19; dropped by 061cc11c7; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/per-hook-per-harness-support-matrix-with-verification-dates-hook-inventory-that.md
- **Context**: Old id BL-0026. Owner decides whether to finish it. Script shipped; cells unverified; 60-day check not in preflight or CI.

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
- **Context**: No script producing the swe-calibrate scratch directories was found, so it may no longer exist.

### Engine implement-review with verify_pass=false does not block
- **Id**: BL-0238
- **Status**: open
- **Since**: 2026-07-24
- **Origin**: peer
- **Reporter**: codepower
- **Report**: 2026-07-24 codepower
- **Reply**: none
- **Problem**: 實作審查在驗證沒過時仍不擋下，審查者放行就能收斂並當成已提交。有人回報過，程式仍依審查者的理由收斂。
- **Impact**: 驗證失敗的缺陷可以在審查放行後被當成已完成。
- **Trigger**: Next edit to engine implement-review convergence or the review-loop verify field
- **Trigger-Type**: peer
- **Effort**: M
- **Source**: codepower 2026-07-24 implement-review; restored 2026-10-19; dropped by f2955b99e; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/backlog/shared-sealed-zero-diff-validator.md
- **Context**: Reported 2026-07-24. The engine still converges with the reviewer reason. Read, not executed.

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

### mods-visible-dispatch P2 to P4: do or withdraw
- **Id**: BL-0241
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: owner
- **Problem**: 畫面上可見派工的後三段還沒做，也沒有人決定要繼續還是撤回。有可能已被新的階段圖路線取代，尚未確認。
- **Impact**: 沒有裁決的話，未完成的三段會一直掛著，或被別的路線默默取代。
- **Trigger**: owner decides do or withdraw for mods visible-dispatch P2 to P4; stage-graph route may supersede, unconfirmed
- **Trigger-Type**: owner
- **Effort**: L
- **Source**: 2026-10-19 deletion audit, never had a row; restored 2026-10-19; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: docs/plans/2026-10-03-mods-visible-dispatch.md
- **Context**: May be superseded by the stage-graph route; unconfirmed. P5 is already BL-0110.

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

### Final-panel seat whose transport fails leaves no reason
- **Id**: BL-0246
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: peer
- **Reporter**: codepower twgs-revival
- **Report**: 01M59ZPRRAH8CGMG59HHD8816N
- **Reply**: 2026-10-19 01M59ZQBD887MCS212ZQY3MYDX
- **Problem**: 最終審查有席位傳輸失敗時，座位紀錄沒留下結束碼、錯誤尾段與乾淨室階段。只有走乾淨室的席位會在那裡失敗。
- **Impact**: 事後分不出是傳輸失敗還是審查本身有問題，只能重跑才知道原因。
- **Trigger**: a final-panel seat fails in transport during the cleanroom and the seat record keeps no exit code, stderr tail, or stage
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PEER-REPORTED codepower twgs-revival 2026-10-19
- **Pointer**: docs/backlog/final-panel-seat-transport-failure-no-reason.md
- **Context**: See BL-0223: a red campaign_verification keeps only digests, so the failing command is lost.

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
- **Context**: See BL-0220: no_verdict leaves the phase in REVIEWING and resume refuses.

### Managed-rail failure messages do not say what to do
- **Id**: BL-0249
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: peer
- **Reporter**: codepower twgs-revival
- **Report**: 01M59ZPRRAH8CGMG59HHD8816N
- **Reply**: 2026-10-19 01M59ZQBD887MCS212ZQY3MYDX
- **Problem**: 受管軌道失敗時看不出該怎麼做：沒說登入失效、沒說哪個席位或主機，授權被釋放後還得人手重新授予。
- **Impact**: 操作者無法從訊息判斷要重登、換席位還是重新授權。
- **Trigger**: a managed-rail failure omits the auth failure, the seat or host, and that the released grant must be re-granted by hand
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PEER-REPORTED codepower twgs-revival 2026-10-19
- **Pointer**: docs/backlog/managed-rail-failure-messages-not-actionable.md
- **Context**: provider readiness, scorecard, and grant release each name a gap the operator cannot act on from the message alone.

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

### Child processes must declare lifetime and parent to fleet (FLEET_LIFETIME / FLEET_PARENT / FLEET_ROLE contract)
- **Id**: BL-0251
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: peer
- **Reporter**: openclaw hangar
- **Report**: 01M5A264B59E7ETAETJRAEBXJQ
- **Reply**: 2026-10-19 01M5A27RA0AFGZ3WCDYFVWQK5X
- **Problem**: autopilot 派出的 claude 系子行程（review 席位、eval run 等）被 fleet 當成互動 session 登記，aimax395 名冊累積約 200 筆殘留；fleet 端將只認 entrypoint cli，並以明確的 FLEET_LIFETIME 為準。
- **Impact**: 名冊被殘留子行程塞滿，操作者分不出哪些是真正的互動 session。
- **Trigger**: the operator decides to start the autopilot-side work (child_session_mint exports the fleet contract)
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: PEER-REPORTED openclaw hangar 2026-10-19
- **Pointer**: docs/backlog/fleet-child-lifetime-parent-contract.md
- **Context**: Explicit FLEET_LIFETIME wins; a child is never promoted to durable. On 2026-10-19 fleet 650f649 took effect on aimax395: FLEET_* children and non-TUI Claude sessions become ephemeral and drop ~10s after disconnect. Verify when starting.

### roundtable follow-ups deferred by the second review
- **Id**: BL-0252
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: self
- **Problem**: 第二輪審查把四件圓桌後續留到下次再做：三行程鎖競爭、殘留暫存檔、重複系統列，以及用法說明與實際參數不符。
- **Impact**: 高競爭下仍可能互搶；殘檔與重複列會累積；操作者看 USAGE 會漏掉已接受的參數。
- **Trigger**: next time room-log.js or roundtable-window.js is touched
- **Trigger-Type**: event
- **Effort**: S
- **Source**: the second-generation review of the roundtable work
- **Pointer**: docs/backlog/roundtable-follow-ups.md
- **Context**: Four deferred points: a three-process reclaim/release race, leftover lock files, duplicate skipped-seat rows, and USAGE lagging parseCli. Detail is in the Pointer.

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
- **Context**: Probably affects the agy review seat, which waits for process exit. Suggested forced_exit after a closed SUCCESS envelope. Detail is in the Pointer.

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

### Rename campaignControl.initial_state (persisted wire field, needs a design decision)
- **Id**: BL-0255
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: self
- **Problem**: 活動控制有一個已寫入線路的初始狀態欄位，名稱與用意不符。改名要遷移或乾淨的大版本切割，這次修正批次刻意留下。
- **Impact**: 名稱繼續留在持久資料裡，以後改名成本更高。
- **Trigger**: the owner decides whether to migrate the persisted field or cut it in a clean major
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: bluefix merge d0d87b1c4, owner d-15632582
- **Pointer**: docs/backlog/campaign-control-initial-state-rename.md
- **Context**: Left out of the bluefix batch as a design decision. No compatibility shim. Detail is in the Pointer.

### RUN_LEDGER_MAX_ROTATIONS reads the sweep environment with unclear intent
- **Id**: BL-0256
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: self
- **Problem**: 帳本輪替上限會讀掃測時的環境變數，預設四次。掃測環境是否該影響正式輪替還不清楚。
- **Impact**: 未決定就改，正式輪替可能跟著掃測設定走。
- **Trigger**: the owner decides whether sweep-time environment values should influence ledger rotation
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: bluefix merge d0d87b1c4
- **Pointer**: docs/backlog/run-ledger-max-rotations-sweep-env.md
- **Context**: Left out of bluefix d0d87b1c4. Default is 4. Detail is in the Pointer.

### BL-0039 notes 7 and 8: re-anchor the instant2 fixture and add a filter check
- **Id**: BL-0257
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: self
- **Problem**: 某條待辦的兩則附註還沒做：測試夾具要重新定錨，篩選也沒檢查引擎、執行器或角色。旁註已隨提交刪除。
- **Impact**: 夾具若漂移，負向測試可能不再測到原本要擋的情況。
- **Trigger**: next change to that test's instant2 fixture, or when the capability-evidence producer contract is tightened
- **Trigger-Type**: event
- **Effort**: S
- **Source**: backlog deletion audit section C-3, commit e05a1edc3
- **Pointer**: docs/backlog/bl0039-notes-instant2-filter.md
- **Context**: Notes 7 and 8 survived the body fix; the sidecar was deleted. Detail is in the Pointer.

### P6 feed-trust follow-ups: confirm-mode answer step, plan wording, reject-then-confirm, repeated stderr
- **Id**: BL-0261
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: self
- **Problem**: 信任檢查還有四件小事：確認模式答覆後還要再跑一次才算數、計畫第五節用詞與實作不符、拒絕後再確認會安靜回成功、設定檔損壞時每次都重複同一則錯誤。
- **Impact**: 不處理的話，確認流程會漏算、文件與行為不一致，錯誤訊息也會洗版。
- **Trigger**: next change to qualification-feed-trust or the P6 plan
- **Trigger-Type**: event
- **Effort**: S
- **Source**: hetero-review p6trust g2
- **Pointer**: docs/backlog/p6-trust-followups.md
- **Context**: Four small follow-ups. Automating the extra answer step needs eval evidence before skill text changes.

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

### seat-derive HELP omits the deterministic fallback order
- **Id**: BL-0265
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 席次預覽與無頭說明列出執行器版本、家族與釘選欄位從哪來，卻沒寫旗標、席次檔、推導值與釘選檔之間誰先誰後，呼叫端無法預測哪一個會贏。
- **Impact**: 說明沒寫優先順序前，呼叫端無法事先知道哪個來源會蓋過哪個。
- **Trigger**: next change to that file
- **Trigger-Type**: event
- **Effort**: S
- **Source**: hderive g2 44a00373
- **Pointer**: docs/backlog/deferred-review-2026-10-21.md

### prices 2^53 diagnostic matches only the literal
- **Id**: BL-0266
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 價格解析在捕捉錯誤時，只看訊息裡有沒有那串固定的大整數文字，應該改認預檢不安全整數這類錯誤。受影響的只有診斷文字，正確性不變。
- **Impact**: 診斷文字可能對不上真正的錯誤類別，計算結果本身不受影響。
- **Trigger**: next change to that file
- **Trigger-Type**: event
- **Effort**: S
- **Source**: priceread g1 f29c3939
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

### node tests that run git have no identity guard
- **Id**: BL-0268
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 測試身分守衛會檢查呼叫 git 的殼層測試有沒有引入共用函式庫，也會掃腳本裡的非測試信箱，但沒有檢查會跑 git 提交的節點測試是否自備身分。
- **Impact**: 這類測試在開發機靠家目錄設定會通過，換到暫時家目錄就變紅。
- **Trigger**: next change to test-identity-guard, or a new node test that runs git
- **Trigger-Type**: event
- **Effort**: S
- **Source**: hderive g1 review (identity finding)
- **Pointer**: docs/backlog/deferred-review-2026-10-21.md
- **Context**: the impl test itself is already fixed

### hetero-review-loop collect accepts an empty review range
- **Id**: BL-0269
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 審查收集在範圍內沒有任何提交或差異為空時，仍然會照常收集並產生看起來正常的收據，審的其實是空內容。
- **Impact**: 衝突後沒有產生提交的挑選提交會讓審查空轉，卻留下像是通過的紀錄。
- **Trigger**: next change to the collect subcommand of the review loop driver
- **Trigger-Type**: event
- **Effort**: S
- **Source**: landdocs 2026-10-21 empty-range finding
- **Pointer**: docs/backlog/hetero-collect-empty-range.md

### Pending owner-decision panel is unused by long-running sessions
- **Id**: BL-0270
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: peer
- **Reporter**: llm-playground lead (c4140)
- **Report**: 01M5EQF6YGW98MRG4TBW90YS2W
- **Reply**: 2026-10-21 01M5EQFP73V0Z6FFQQ3YEFF9ZS
- **Problem**: 長時間運行的工作階段幾乎不用待決面板。開啟、回答與關閉的機制已經出貨，技能說明還沒有依開關實驗改寫。
- **Impact**: 技能沒改之前，其他代理仍不知道何時該開待決卡，面板繼續閒置。
- **Trigger**: skill text for the ceo, dev-flow and level-3-to-6 skills waits on the eval on/off result
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER llm-playground 2026-10-21
- **Pointer**: docs/backlog/pending-decision-panel-unused-by-long-sessions.md
- **Context**: Mechanism merge 6e428fd6c. AGENTS.md merge 9aa45ce1b. Skill text remains.

### Cross-harness token discipline for resident seats
- **Id**: BL-0271
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: peer
- **Reporter**: llm-playground claude-4 (c4140)；llm-playground claude-4 (c4140)
- **Report**: 01M5EWE5D6HT343H26BCXSHBPM；01M5EX8WGH1FT9MJDXYNQ2WGWN
- **Reply**: 2026-10-21 01M5EWEHPTPD4F0P6KAP5VDCAH；2026-10-21 01M5EX9883PHTTG3N2HPE08CG6
- **Problem**: 跨工具的長駐席位沒有共用的用量紀律。交接時機、讀檔、輪詢、子代理與回覆節奏都靠各席自己拿捏。
- **Impact**: 主執行緒會累積到十億級用量。壓縮後仍比新執行緒肥，成本與延遲都下不來。
- **Trigger**: the owner decides whether to adopt the five rules and to spike the named settings
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: PEER llm-playground claude-4 2026-10-21
- **Pointer**: docs/backlog/cross-harness-token-discipline.md
- **Context**: Resident seats cannot change thread. Codex setting names are unverified.

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

### Dispatch-suppression scans only the hands-brief fixed fields
- **Id**: BL-0273
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 派工壓制檢查只掃簡報裡由控制者填的固定欄位。審查發現被逐字引用時會被誤擋，而簡報沒有控制者的自由文字欄。
- **Impact**: 真正該檢查的重派說明與審查提示目前都沒掃到，壓制規則等於沒接上。
- **Trigger**: scan the depth-0 redispatch prompt file and the reviewer prompt, which can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: dwire merge 215d9084c, 2026-10-21
- **Pointer**: docs/backlog/dispatch-suppression-fixed-fields-only.md
- **Context**: Merge 215d9084c. Four honest findings were all blocked. The brief has no controller free text.

### Two hook suites are already red on the depth-0 postmerge tree
- **Id**: BL-0274
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 兩支測試在主線合併後的工作樹上本來就是紅的，在工頭的複本裡卻是綠的，疑似和這台機器上正在跑的監看程序有關。
- **Impact**: 深度零的合併後檢查會把本來就紅的測試當成這次改動的失敗。
- **Trigger**: the two hook suites fail on the depth-0 postmerge tree and pass in the foreman clone
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: dmech postmerge note, 2026-10-21
- **Pointer**: docs/backlog/postmerge-hook-tests-already-red.md
- **Context**: Two hosting cases red at 3a44dd784, c722c250c and 9aa45ce1b. The live-state shell suite is 22 pass and 2 fail on the base.

### Scripts that appear uncalled need a keep-or-retire decision
- **Id**: BL-0275
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: owner
- **Problem**: 有幾支腳本在盤點裡幾乎沒有呼叫者。有的檔頭說會被品質面板用，實際只有另一支腳本用；有的所屬計畫已經歸檔。
- **Impact**: 沒人決定留或撤之前，這些腳本會繼續放著，之後的人分不出是備用還是廢棄。
- **Trigger**: the owner decides, for each script, whether to wire it or retire it
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: 2026-10-21 discoverability audit
- **Pointer**: docs/backlog/uncalled-scripts-keep-or-retire.md
- **Context**: A missing caller is not a reason to delete. Each script's purpose, caller and suggestion are in the sidecar.

### Review deferrals from 2026-10-21
- **Id**: BL-0276
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 當天的審查留下幾件小修：待決卡路徑含空白會壞、範圍走訪沒有共用、缺第二個範圍的隔離測試、注入文字與實際比對不符，以及檢查與判定的已知邊界。
- **Impact**: 含空白的路徑、第二個範圍，或只改縮排的分支，會得到錯的結果或看不出原因的錯誤。
- **Trigger**: the deferred review items from 2026-10-21 can be picked up now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: dmech, dwire and bl215 reviews, 2026-10-21
- **Pointer**: docs/backlog/review-deferrals-2026-10-21.md
- **Context**: Includes the unquoted card path, the shared scope walk, the handoff buffer copy, the finalize error line, and the patch-id boundaries.

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
- **Context**: Detail in remaining-discoverability-entry-gaps.md. Roundtable stays on BL-0216 and task-card on BL-0243.
