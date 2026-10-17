# autopilot — BACKLOG

<!-- next-id: BL-0213 -->

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
- **Problem**: mods 的 Now 分頁上，如果 session 中途離開再 resume，原本的背景工作已經不在、也不會再有完成通知，那一列可能永遠掛著；對話紀錄裡沒有 resume 的標記可判斷。subagent 與 headless 那種不會有通知的背景指令已修好。
- **Impact**: 最壞是畫面上殘留一列已不存在的背景工作，屬於顯示問題；先實測再決定要不要修。 (draft)
- **Trigger**: a stale 背景指令 or 監看 row is seen, or a session is resumed after quitting with background work running
- **Effort**: S
- **Source**: feat/mods-activity review, 2026-10-12 (UNVERIFIED live behavior)
- **Pointer**: docs/backlog/mods-activity-row-never-ends.md
- **Context**: scanBackground (mods/live/model.ts) ends rows on a task-notification status, TaskStop, or for flagged Bash results the next real prompt. Resume: probe quitting mid `sleep 600`, find a transcript signal first.

### Cross-repo dispatch has no worktree or handoff rule
- **Id**: BL-0004
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: 一個專案的工作要派到另一個專案的程式庫去做時，目前沒有規則說明該用哪個專案的工作樹、標記檔與交接文件。當初規劃工作樹位置規則時，刻意把這一項延後。 (draft)
- **Impact**: 跨專案派工時各 session 可能各做各的、交接位置不一致；平常很少遇到。 (draft)
- **Trigger**: the first real cross-repo dispatch that goes wrong (worktree, marker or handoff location disagrees)
- **Effort**: M
- **Source**: worktree-placement gap 5, deferred by the plan (D12), 2026-10-12
- **Pointer**: docs/backlog/worktree-and-handoff-placement-has-no-rule.md
- **Context**: Owner 2026-10-17: keep as is, set no rule now; decide when a real case appears. Rails resolve placement from their own --from repo root; nothing says which repo root, marker or handoff a cross-repo run uses.

### Foreman ↔ depth-0 coordination: typed `worker_condition` was planned (r6) and never built
- **Id**: BL-0012
- **Status**: open
- **Since**: 2026-09-20
- **Origin**: self
- **Problem**: 規劃過「工頭與最上層代理之間，用結構化的工作狀態互相溝通」的設計，但從未實作，計畫已被擱置。條目標示為有觸發條件才重啟。 (draft)
- **Impact**: 沒有影響現有功能；可考慮直接結案不做。 (draft)
- **Trigger**: a foreman wait loop that must tell "hand parked on a question" from "hand still working" without reading the transcript
- **Effort**: M
- **Source**: 2026-09-20 orphan-plan triage (plan frozen into a mission graph, zero identifiers in history)
- **Pointer**: docs/backlog/foreman-depth0-typed-worker-condition.md
- **Context**: plan archived as dropped-never-built; the mission graph that sealed it is terminal.

### Host Conformance tool — authorized by the 2026-08-23 consolidation decision, never built
- **Id**: BL-0014
- **Status**: open
- **Since**: 2026-09-20
- **Origin**: self
- **Problem**: 2026-08-23 的整併決議核准要做一個「主機一致性檢查」工具，但至今沒有人做。決議分支已合併，成果卻不存在。 (draft)
- **Impact**: 缺這個工具就無法自動檢查各平台行為是否一致；需擁有者決定是否排程。 (draft)
- **Trigger**: before any coding-harness architecture migration is proposed again, OR when a host capability claim is disputed by a peer
- **Effort**: L
- **Source**: 2026-09-20 remote-branch triage (decision branch merged at 47b52eac; deliverable absent)
- **Pointer**: docs/backlog/host-conformance-tool.md
- **Context**: Owner 2026-10-17: stays approved, wait for the trigger. Needs its own registered plan; the decision doc lists the six report sections.

### Foreman rail residuals (v2.36.34) — accepted and named, not hidden
- **Id**: BL-0015
- **Status**: open
- **Since**: 2026-09-13
- **Origin**: self
- **Problem**: 工頭 rail 出貨時，審查接受並記下幾個已知殘留風險：例如以 setsid 啟動的 kimi 只能整組終止、對外網路沒有限制。這些都是刻意接受而非遺漏。 (draft)
- **Impact**: 只有在真實工頭運行時出現逃脫或連外問題才需處理；目前列為觀察項。 (draft)
- **Trigger**: **NOT FIRED — recorded at ship time, 2026-09-13.** Fires when a real foreman run trips one of them.
- **Effort**: M
- **Source**: `docs/plans/2026-09-13-foreman-rail-b-build.md`, ship-time adjudication.
- **Pointer**: docs/backlog/foreman-rail-residuals-v2-36-34-accepted-and-named-not-hidden.md

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
- **Effort**: S
- **Source**: peer report from twgs-revival 2026-09-11, re-derived locally the same day with four probes; `scripts/lib/agy-argv-ceiling.sh`, callers at…
- **Pointer**: docs/backlog/agy-input-format-stream-json-raises-the-payload-ceiling-but-does-not-remove-it-a.md
- **Context**: a peer host (twgs-revival, 2026-09-11) reported that agy 1.2.0's `--input-format stream-json` reads NDJSON from stdin and so bypasses the 131072-byte `MAX_ARG_STRLEN` argv wall, measured at 208951 bytes with `status: SUCCESS`, and…

### Reconnaissance and implementation share one leaf bash budget, so a leaf can exhaust it before touching code
- **Id**: BL-0022
- **Status**: open
- **Since**: 2026-09-13
- **Origin**: peer
- **Reporter**: 308-db
- **Report**: 2026-09-13 session
- **Reply**: 2026-09-12 session d1423f91:5171
- **Problem**: 308-db 回報：工頭派給葉節點的指令預算，偵察與實作共用一份，葉節點可能還沒動到程式就把預算用完。目前沒有區分，只能手動拆成兩個葉節點。 (draft)
- **Impact**: 大任務容易中途被預算截斷而空轉；已知繞法是拆成兩段。 (draft)
- **Trigger**: **NOT FIRED — peer observation, 2026-09-13.** Fires when a leaf under this rail is measured hitting its command cap with zero diff.
- **Effort**: S
- **Source**: `308-db` via the local session mesh, 2026-09-13.
- **Pointer**: docs/backlog/reconnaissance-and-implementation-share-one-leaf-bash-budget-so-a-leaf-can-exhau.md
- **Context**: `308-db` ran six Agent-worktree leaves on 2026-09-13; three hit the 40-command bash ceiling **after reconnaissance was complete and before a single line changed**.

### Main-checkout boundary: accepted residuals of an accident guard that is not a sandbox
- **Id**: BL-0023
- **Status**: open
- **Since**: 2026-09-13
- **Origin**: self
- **Problem**: 主目錄邊界防護只是防意外，不是安全沙箱；審查時記下幾個接受的殘留缺口。除非採用惡意工作者的威脅模型，否則不會處理。 (draft)
- **Impact**: 只有在有人刻意對抗時才有風險；一般使用不受影響，可考慮結案只留文件。 (draft)
- **Trigger**: fires only if the boundary is ever asked to be a sandbox — i.e. an adversarial worker becomes a threat model this repo adopts. Today it is not (`references/blind-dispatch.md`; v2.36.32's own contract says "accident guard, not a sandbox").
- **Effort**: L
- **Source**: v2.36.32 review round 6, 2026-09-13, adjudicated at depth 0 by re-derivation.
- **Pointer**: docs/backlog/main-checkout-boundary-accepted-residuals-of-an-accident-guard-that-is-not-a-san.md
- **Context**: v2.36.32's detection layer fingerprints every ref, HEAD, symbolic-ref target, staged/unstaged diff content, and a size+mtime+type+link-target walk of every entry outside `.git`.

### kimi reviewer rail: file-indirection for prompts above the argv wall (needs a live kimi credential to probe)
- **Id**: BL-0025
- **Status**: open
- **Since**: 2026-09-07
- **Origin**: peer
- **Reporter**: 308
- **Report**: 2026-09-07 peer
- **Reply**: 2026-09-07 session 515b9ae8:2014
- **Problem**: 308 回報：kimi 審查在提示超過約 12 萬位元組時會失敗，因為舊版 kimi 不支援從檔案讀提示。現在本機已是新版 kimi，是否仍有此限制需要重新探測且需要可用的登入。 (draft)
- **Impact**: 大型審查包在 kimi 席位上會被拒絕；目前可改用其他席位。 (draft)
- **Trigger**: a host with a working `kimi login` (this host's managed:kimi-code OAuth has no credential as of 2026-09-07, so the probe could not run), or Kimi Code CLI shipping `--prompt-file` / stdin prompt input (0.39.1 has neither: `-p ''` is…
- **Effort**: S
- **Source**: 308 report 2026-09-07, run review-1788751167-2077044-2d7b.
- **Pointer**: docs/backlog/kimi-reviewer-rail-file-indirection-for-prompts-above-the-argv-wall-needs-a-live.md
- **Context**: v2.36.14 fails closed pre-spend when the kimi prompt exceeds ~120 KB (Linux MAX_ARG_STRLEN, 308 hit rc=126 on a 145 KB prompt).

### Codex dev-mode hook entry that survives plugin cache replacement (`~/.codex/hooks.json` → repo path)
- **Id**: BL-0027
- **Status**: open
- **Since**: 2026-09-07
- **Origin**: self
- **Problem**: Codex 的外掛快取被取代後，開發模式的 hook 設定會失效，使用者會看到模組找不到的錯誤。計畫新增一條指向 repo 路徑的設定，等再有人回報第二次才動工。 (draft)
- **Impact**: 開發者在 Codex 升級外掛後 hook 可能失效；目前只遇過一次。 (draft)
- **Trigger**: a second report of `PostCompact MODULE_NOT_FOUND` on a host that ran `dev-setup.sh --harness codex --install` with `--force`, or a Codex release that documents whether hook `command` strings run through a shell (then a self-contained…
- **Effort**: S
- **Source**: local Codex session hand-off via agent-call 2026-09-07; `hooks/tests/codex-plugin-package.test.sh` upgrade case.
- **Pointer**: docs/backlog/codex-dev-mode-hook-entry-that-survives-plugin-cache-replacement-codex-hooks-jso.md
- **Context**: v2.36.10 guards the update (refuse under live sessions) but cannot make a live session survive it: Codex pins `PLUGIN_ROOT` to `~/.codex/plugins/cache/…/<version>/`, and both `plugin add` (in-place upgrade) and `plugin remove` delete…

### Apply two-tier + pooled verdict to reviewer/implementer/owner/verification_author/brain
- **Id**: BL-0028
- **Status**: open
- **Since**: 2026-08-30
- **Origin**: self
- **Problem**: 資格考核的「兩層加合併判定」目前只用在 consult 與 discuss 角色，其他角色（審查、實作、驗證、最上層）尚未套用，因為還沒有各角色專屬的封存題庫。 (draft)
- **Impact**: 其他角色的考核結果較不穩定；要先建題庫，短期沒有急迫性。 (draft)
- **Trigger**: a role's own eval corpus + scorecard-first ON/OFF evidence exists — a frozen, sealed
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
- **Effort**: L
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026/08/2026-08-21-p6d-orchestration-incident/README.md) (incl. Fable 5 judgment).
- **Pointer**: docs/backlog/contract-first-escalation-and-local-repair-gates-p6d-incident-follow-up.md
- **Context**: Owner 2026-10-17: narrowed to the unshipped dispatch-justification control, keep waiting. Origin: a bounded six-file/three-command consumer task was routed through strict L5 Mission governance.

### Implementer suite hardening backlog (pre-merge review round-1 cut list)
- **Id**: BL-0037
- **Status**: open
- **Since**: 2026-08-22
- **Origin**: self
- **Problem**: 實作者考核套件在合併前審查，提出一批加固項目被砍到之後處理，例如惡意 git 設定、被替換的參照、拖延不動的實作者等測試情境。這些測試至今沒有補。 (draft)
- **Impact**: 考核套件對惡意或異常情況較不堅固；目前沒有實際出事，屬加固性質。 (draft)
- **Trigger**: 第三場實作者正式施測之前（Stage-0 機械化與 live-rail smoke 應先落），或 reviewer 再報同類；config labelling 要改 grader 並重封資產，屬 owner 決定。
- **Effort**: M
- **Source**: autopilot:reviewer pre-merge round-1,2026-08-22;`docs/plans/2026-08-22-implementer-qualification-suite.md` §6-§8。
- **Pointer**: docs/backlog/implementer-suite-hardening-backlog-pre-merge-review-round-1-cut-list.md
- **Context**: 2026-10-16 landed fixtures, TTL and --trials tests; open: Stage-0 mechanisation, live-rail smoke, consumer matrix, config labelling. Detail in the sidecar.

### agy output envelope invalid on create-a-new-file responses (blocks agy implementer qualification)
- **Id**: BL-0038
- **Status**: open
- **Since**: 2026-08-22
- **Origin**: self
- **Problem**: agy 在「新建檔案」類回應時輸出格式不合法，過去導致 agy 實作者無法通過考核。現在已改成當作遙測遺失並改看產物判斷，但上游問題與重新考核尚未完成。 (draft)
- **Impact**: agy 作為實作者的資格仍卡著；比較像需要重考的任務，不是程式錯誤。 (draft)
- **Trigger**: 下一次要考 agy 家族 implementer 時（v2.35.13 起信封無效只是遙測遺失、狀態看 artifact，且 log 會留信封原文——重考就能同時拿到 row 與重現樣本）;或 agy 更新後 changelog/實測顯示…
- **Effort**: S
- **Source**: `docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify/README.md`。
- **Pointer**: docs/backlog/agy-output-envelope-invalid-on-create-a-new-file-responses-blocks-agy-implemente.md
- **Context**: 2026-08-22 implementer 施測(agy 1.1.17):flash-high 6 案、pro(event 147)2 案、flash-medium(event 152)6 案 envelope FAIL + 2 案 stall——envelope 失敗案**全部**是建新檔任務且同簽名(family-wide、發生率隨 tier…

### Brain-seat sittings in the shipped qualification defaults (v2 artifact)
- **Id**: BL-0041
- **Status**: open
- **Since**: 2026-08-23
- **Origin**: self
- **Problem**: 出貨的官方資格預設值裡不包含最上層代理（brain）席位的考核紀錄，這是刻意的。是否未來也要出貨，需擁有者決定。 (draft)
- **Impact**: 最上層代理席位的推薦只能依本機證據，沒有官方預設可參考；不影響其他席位。 (draft)
- **Trigger**: a consuming repo asks to adopt an owner/brain seat without self-qualifying; or the Board schedules the fourth brain sitting and it PASSES (a passing sitting is the first brain row worth shipping as a default).
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
- **Effort**: M
- **Source**: hetero design panel 2026-08-22 synthesis §5/§6 + cut list; deferred by scope=Hold on the M-size first cut.
- **Pointer**: docs/backlog/strike-decay-deferrals-the-five-mechanisms-the-panel-cut-from-the-first-instrume.md
- **Context**: Deliberately NOT built in v2.34.35, each with a reason rather than an omission.


### Outcome-shaped quality-gate enforcer (opt-in) — replaces the rejected invocation check
- **Id**: BL-0050
- **Status**: open
- **Since**: 2026-08-18
- **Origin**: self
- **Problem**: 我們想做一個檢查，確保品質檢查流程真的有跑過，但原本以「有沒有呼叫」為準的做法被否決；新做法需要品質流程先產生可驗證的執行收據，目前還沒有。 (draft)
- **Impact**: 目前沒有機制保證品質檢查一定被執行，只能靠流程自律。 (draft)
- **Trigger**: When an enforcer for the quality gate is wanted again, OR when `quality-pipeline` grows a SHA-bound "this ran" receipt that a gate could re-derive from. Not before: the current design has nothing to verify against.
- **Effort**: M
- **Source**: think-tank 5-role panel 2026-08-18（collision insights…
- **Pointer**: docs/backlog/outcome-shaped-quality-gate-enforcer-opt-in-replaces-the-rejected-invocation-che.md
- **Context**: P7 ruled out the obvious enforcer.

### Scaffold-tier effect A/B measurement（four-layer D6 promised row — repaired 2026-08-18）
- **Id**: BL-0051
- **Status**: open
- **Since**: 2026-08-18
- **Origin**: self
- **Problem**: 我們依能力分成三個鷹架層級，但從沒做過對照實驗證明層級真的影響成果品質，文件也明講不宣稱有效。實驗被延後，等有人要依層級決策才做。 (draft)
- **Impact**: 只要沒人拿層級當成果品質依據，就沒有影響。 (draft)
- **Trigger**: Before any skill or routing policy CONSUMES scaffold tiers（T0/T1/T2）as an outcome-quality claim（成績單前置 applies）;or before the next capability-tier expansion.
- **Effort**: M
- **Source**: four-layer-redesign D6 closeout leftover（2026-08-17）;audit 2026-08-18（dev-flow-contract-card prologue）.
- **Pointer**: docs/backlog/scaffold-tier-effect-a-b-measurement-four-layer-d6-promised-row-repaired-2026-08.md
- **Context**: v2.34.11 shipped capability-tiered scaffolding with fail-closed T2, but `references/scaffold-tiers.md` Non-goals explicitly disclaims any tier→outcome effect claim — the A/B was deferred.

### Qualification CLI transport — runtime identity capture
- **Id**: BL-0052
- **Status**: open
- **Since**: 2026-08-17
- **Origin**: self
- **Problem**: 資格測試若走 codex、claude 等命令列，這些工具不回報實際使用的模型，所以模型身分只能靠操作者自己聲明，萬一背後換了模型也看不出來。 (draft)
- **Impact**: 資格紀錄的模型身分可能不準；等工具提供回報後再處理。 (draft)
- **Trigger**: When any CLI harness (codex / claude) grows a verifiable runtime model-identity signal in headless mode, or before promoting a CLI-transport qualification to a decision where alias drift would be material.
- **Effort**: S
- **Source**: v2.34.15 pre-merge review; hardening round 2026-08-17.
- **Pointer**: docs/backlog/qualification-cli-transport-runtime-identity-capture.md
- **Context**: CLI transports return no model id, so administered identity is operator-asserted (pre-run probe recorded per the v2.34.15 governance rule; the HTTP path caught glm-5.2→glm-5.3 exactly via its runtime echo).

### t14 long-horizon per-turn verification gate
- **Id**: BL-0055
- **Status**: open
- **Since**: 2026-08-01
- **Origin**: self
- **Problem**: 實驗發現每回合重新提醒模型守規則，只是讓措辭改變，行為沒有明顯進步。於是提出每回合驗證的做法，但還沒做。 (draft)
- **Impact**: 長時間工作時模型仍可能漸漸偏離規定，目前沒有機制擋。 (draft)
- **Trigger**: The next experiment aimed at improving long-horizon constraint adherence, or before claiming that prompt re-injection solves t14-class drift.
- **Effort**: M
- **Source**: `docs/projects/_archive/2026-07-08-t14-reinject/report.md` § Follow-up.
- **Pointer**: docs/backlog/t14-long-horizon-per-turn-verification-gate.md
- **Context**: Per-turn re-injection moved vocabulary but did not produce a statistically conclusive behavior lift.

### Mission graph scheduler 與 portfolio optimization
- **Id**: BL-0056
- **Status**: open
- **Since**: 2026-07-28
- **Origin**: self
- **Problem**: 任務圖目前只能擋住「階段暴增」，不會自動排最短路徑、跨專案排程或做進度看板。除非實測有閒置浪費或擁有者要求，否則不做。 (draft)
- **Impact**: 不做只是排程不夠聰明，系統並不會因此出錯或停擺。 (draft)
- **Trigger**: v2.34.0 的 frozen deliverable graph gate 已出貨，且至少兩個真實 portfolio 顯示靜態 dependency batches 造成可量測的 idle time，或使用者明確要求跨專案排程／dashboard。
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
- **Effort**: L
- **Source**: 2026-07-28 Mission P1/P2 parity audit與獨立 Architect/Ops/Skeptic review；`governance-correction.md`
- **Pointer**: docs/backlog/mission-authority-store-cross-harness-enforcement-hardening.md
- **Context**: 本次只實作 current-host 可驗證的 Git-common-dir durable registry、CAS 與 fail-closed adapter。防惡意本機程序需要獨立 UID、root-owned/remote daemon 或具 authenticity 的 authority service；精確 provider…

### `check-test-integrity.sh` warn → block needs an accuracy record first
- **Id**: BL-0060
- **Status**: open
- **Since**: 2026-08-23
- **Origin**: self
- **Problem**: 測試完整性檢查目前只警告不擋，因為它對每一行都做判斷，準確度未知。要累積足夠真實案例、確認不會誤擋，才改成強制。 (draft)
- **Impact**: 維持警告時違規仍可通過，只能靠人自己看警告，沒人看就漏掉。 (draft)
- **Trigger**: 累積夠多真實 range 的 violation 輸出,足以判斷「違規流是否準確到可以擋」時;或有人主動
- **Effort**: M
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。
- **Pointer**: docs/backlog/check-test-integrity-sh-warn-block-needs-an-accuracy-record-first.md
- **Context**: v2.34.38 刻意停在 `warn`。原因不是保守,是 L0 的判準粒度:它對 match 到的測試檔**每一行

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Id**: BL-0066
- **Status**: open
- **Since**: 2026-07-10
- **Origin**: self
- **Problem**: 用來測審查者「不亂報」能力的乾淨樣本集，實測 12 個有 5 個其實有問題，標籤不可靠。要做絕對準確度認證，需要重建真正確認乾淨的集合。 (draft)
- **Impact**: 審查者誤報率的數字不夠可信；只影響評測結論。 (draft)
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
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
- **Effort**: S
- **Source**: 2026-06-23 `docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md` scope-cut + Phase L ship (`577ba8d`).
- **Pointer**: docs/backlog/l5-hetero-parallel-width-fan-out-machinery-built-deliberately-unwired.md
- **Context**: Phase L shipped `/l4` homogeneous (Claude) batch fan-out.

### M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
- **Id**: BL-0072
- **Status**: open
- **Since**: 2026-07-09
- **Origin**: self
- **Problem**: 部分評測題的判分程式與被評測的程式碼跑在同一個程序，對抗性的模型可以偷看判分器的密鑰作弊。評測題若給不可信的實作者使用，需改成分開的程序。 (draft)
- **Impact**: 只有拿這些題測不可信模型時才會被騙過，一般使用無影響。 (draft)
- **Trigger**: 下次把 `evals/orchestration/tasks/t15-cache-invalidation`、`t16-findings-triage`、`t17-purity-invariant` 用於對抗性 implementer 情境（`/l5`、`/l6` hetero 派遣、或任何候選碼不可信的場合）。
- **Effort**: L
- **Source**: opus 對抗性重攻，2026-07-09。`docs/projects/_archive/2026-07-09-m3-band-tasks/report.md` § "Residual: in-process introspection"。
- **Pointer**: docs/backlog/m3-band-fixtures-t15-t17-implementer-process-isolation.md
- **Context**: 這三個 oracle 的判分 python 與候選碼在**同一個 process** 內執行，候選模組 import 時可用 `sys._getframe()` 走訪呼叫端 frame 的 globals/locals，撈出判分器從未匯出的密鑰。opus 2026-07-09…

### First local runner capability semantics（availability/load，不是 quota）
- **Id**: BL-0073
- **Status**: open
- **Since**: 2026-08-01
- **Origin**: self
- **Problem**: 本機模型（如 ollama）的可用度與負載資料已經能量測，但還沒接到引擎的能力狀態系統，第一個本機執行器接上時才要補這一段。 (draft)
- **Impact**: 本機模型的狀態不會反映在能力狀態，目前沒有本機席位依賴它。 (draft)
- **Trigger**: 第一個 local runner（例如 ollama 類）接入 capability-state producer。
- **Effort**: S
- **Source**: 2026-07-14 status CLI design + 2026-07-31 code audit。
- **Pointer**: docs/backlog/first-local-runner-capability-semantics-availability-load-quota.md
- **Context**: named endpoint identity 與獨立的 local-deployment availability/load observation schema 已實作；剩餘工作縮為第一個真實 local runner 的 observation→capability-state producer bridge。不得把現有 metered quota…

### broader shared-config containment / per-worktree isolation（2026-07-17, follow-up）
- **Id**: BL-0074
- **Status**: open
- **Since**: 2026-08-01
- **Origin**: self
- **Problem**: 現在只保護 git 設定裡的使用者名稱與信箱，派出去的工作者若亂改 .git/config 其他設定，倉庫會被污染。要靠每個工作樹各自隔離設定。 (draft)
- **Impact**: 工作者誤改共用設定會影響其他工作，屬清理問題而非惡意防護。 (draft)
- **Trigger**: when a dispatched worker poisons a non-identity shared `.git/config` key
- **Effort**: L
- **Source**: 2026-07-17 U1b panel findings remediation on identity-containment port.
- **Pointer**: docs/backlog/broader-shared-config-containment-per-worktree-isolation-2026-07-17-follow-up.md
- **Context**: v2.32.51 identity rail contains ONLY `user.name`/`user.email` (local scope).

### Durable merge execution crash recovery
- **Id**: BL-0075
- **Status**: open
- **Since**: 2026-07-28
- **Origin**: self
- **Problem**: 合併過程若在中途當機，記憶體裡的合併紀錄會遺失，因為目前沒有統一的持久化收據位置可寫入。要等收據目錄與恢復權責標準化。 (draft)
- **Impact**: 合併當機後得人工判斷做到哪一步；發生機率低。 (draft)
- **Trigger**: When a caller-owned durable merge receipt directory and recovery authority are standardized.
- **Effort**: S
- **Source**: depth-0; p3-risk
- **Pointer**: docs/backlog/durable-merge-execution-crash-recovery.md
- **Context**: A process crash after one ordered merge edge can lose the in-memory aggregate receipt; P3 intentionally omitted a WAL because its frozen contract supplied no storage-path authority.

### Bind dirty content continuity from preflight to execution
- **Id**: BL-0076
- **Status**: open
- **Since**: 2026-07-28
- **Origin**: self
- **Problem**: 合併預檢與實際執行之間，無法證明被保留的未提交內容沒變過，因為預檢收據只記路徑類別、沒記內容指紋。等預檢格式升級再做。 (draft)
- **Impact**: 極少數情況下，未提交的修改可能在預檢後被悄悄改動而沒被發現。 (draft)
- **Trigger**: When merge preflight schema v2 is designed or a consumer requires cross-phase content-continuity proof.
- **Effort**: S
- **Source**: depth-0; p3-risk
- **Pointer**: docs/backlog/bind-dirty-content-continuity-from-preflight-to-execution.md
- **Context**: P3 detects content drift after execution starts, but cannot prove preserved bytes are unchanged since P2 issuance because the P2 receipt binds path categories rather than content/index digests.

### HETO task-return detection can miss completed work
- **Id**: BL-0084
- **Status**: open
- **Since**: 2026-08-05
- **Origin**: owner
- **Problem**: 擁有者回報偶爾 HETO 已完成任務，但控制端沒偵測到回傳，一直等下去。只出現過一次且無法重現，也找不到負責偵測的程式。 (draft)
- **Impact**: 偶爾造成流程卡住空等；目前無法重現，需第二次發生才能追查。 (draft)
- **Trigger**: A second reproducible case where a completed HETO task produces no return event/notification, or before another HETO return-consumer is added.
- **Effort**: S
- **Source**: user-reported intermittent missed HETO return detection (2026-08-05)
- **Pointer**: docs/backlog/heto-task-return-detection-can-miss-completed-work.md
- **Context**: The controller can remain waiting when HETO has completed a dispatched task but the return detector does not fire; inspect event names, buffering/flush, timeout, and terminal-state reconciliation without treating silence as success.

### No route for external field experience contributed INTO autopilot itself
- **Id**: BL-0085
- **Status**: open
- **Since**: 2026-08-25
- **Origin**: self
- **Problem**: 在其他專案使用 autopilot 學到的經驗，沒有路徑可以回灌到 autopilot 本身：學習技能只寫到該專案，提煉技能又排除 autopilot 自己。 (draft)
- **Impact**: 外部使用心得會流失，其他專案學到的教訓回不到本專案；目前案例少。 (draft)
- **Trigger**: A second instance of a lesson learned while *using* autopilot on another project that
- **Effort**: S
- **Source**: knowledge-routing fix set, foreman first-pass review (2026-08-24)
- **Pointer**: docs/backlog/no-route-for-external-field-experience-contributed-into-autopilot-itself.md
- **Context**: `learn` records facts/gotchas into `.claude/knowledge/`; `distill` produces reusable

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
- **Effort**: M
- **Source**: cross-repo request via peer relay, 2026-08-24/25; ruled by two-round heterogeneous panel
- **Pointer**: docs/backlog/peer-coordination-skill-ruled-in-blocked-on-a-spike-sweep.md
- **Context**: autopilot models subordinates (`team`, `l3`–`l6`) and future-self (`handoff`) but has

### Sealed campaign `verify_cmd` runs the whole suite — green since 2026-10-13, but about 56 min; owner chose option C
- **Id**: BL-0087
- **Status**: open
- **Since**: 2026-08-30
- **Origin**: self
- **Problem**: 開發主線上的全套測試在 2026-10-13 已經全綠，但單獨跑一次約 56 分鐘；每個 campaign 的驗收命令和 CI 都要跑完整套，而 CI 上限是 15 分鐘，所以仍然跑不完。
- **Impact**: 用整套測試當驗收命令的 campaign 會因逾時失敗，CI 也會被取消。方案 C 已於 2026-10-13 寫進 CLAUDE.md；剩方案 B，見 Trigger。
- **Trigger**: BL-0001 landed 2026-10-16 (quality gate runs affected-suites first) and is shown not to miss suites (then add option B on top of C)
- **Effort**: M
- **Source**: l6-verdict-stability-p1 salvage campaign 2026-08-29.
- **Pointer**: docs/backlog/hooks-tests-run-sh-is-red-on-develop-sealed-campaign-verify-cmd-is-unsatisfiable.md
- **Context**: Full run green at f108ec42 (480/480, ~56 min serial). Graph authors write each node's verification_commands by hand (no scaffold default names the suite). Option B (per-node affected suites) waits on BL-0001.


### CEO/dev-flow guidance proportionality — peer request to soften "Boil the Lake" / near-zero completion cost, TaskCreate-missing semantics, reversible-candidate release gates
- **Id**: BL-0093
- **Status**: open
- **Since**: 2026-09-06
- **Origin**: peer
- **Reporter**: cuda（revival.3d）
- **Report**: 2026-09-06 peer
- **Reply**: 2026-09-05 session e1e51201:1496
- **Problem**: cuda 專案審計我方技能後提出：CEO 與開發流程的指引太極端（例如「完成成本近乎零」的說法）、缺少任務工具時的處理沒說清、可逆候選的發版檢查過嚴，希望放寬。 (draft)
- **Impact**: 外部專案認為指引不合比例；改動需先有評測證據，擁有者尚未決定。 (draft)
- **Trigger**: owner decides to open this; AND eval ON/OFF evidence exists for the affected skills (scorecard-first rule). Point 1 (Boil the Lake) was evaluated 2026-10-17: UNINFORMATIVE, no change; only points 2 and 3 plus an optional point-1 re-try remain.
- **Effort**: M
- **Source**: cuda revival.3d peer message, 2026-09-06; ASTRA-SKILL-AUDIT report on cuda (/data/rw3d-evidence/2026-09-06/ASTRA-SKILL-AUDIT/report.md, not shared)
- **Pointer**: docs/backlog/ceo-dev-flow-guidance-proportionality-peer-request-to-soften-boil-the-lake-near.md

### CI runs only on version bumps — ordinary develop pushes never execute the suite, so regressions pile up unseen
- **Id**: BL-0094
- **Status**: open
- **Since**: 2026-09-23
- **Origin**: self
- **Problem**: 自動測試只在版本號變動時才會跑，平常推到 develop 的修改完全沒人測。上次修 CI 時發現，兩次發版之間已經悄悄壞掉 34 個測試，等到發版才一次爆出來。 (draft)
- **Impact**: 問題會累積到發版當下才被發現。擁有者 2026-10-13 否決用 GitHub CI 在每次推送時跑（推送頻繁，額度很快用完）。
- **Trigger**: a way to run checks between releases that does not use GitHub CI is proposed, or a release lands red again for reasons older than that release
- **Effort**: S
- **Source**: 2026-09-23 PEACE-side CI repair (34 tests had rotted between releases; `.github/workflows/test.yml` path filter = `.claude-plugin/plugin.json` only)
- **Pointer**: docs/backlog/ci-repair-2026-09-23-followups.md
- **Context**: release-gating is deliberate (header comment). A cheap develop-triggered `dispatch-detach` smoke + `sync-all --check` would catch drift weeks earlier; the full suite can stay release-gated.




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
- **Effort**: M
- **Source**: peer-reported cuda/chatgpt-tunnel 2026-10-03
- **Pointer**: docs/backlog/sealed-campaign-review-station-migration.md
- **Context**: single+terminal panel works at intake; only in-place migration of a sealed campaign's review_station is missing.

### mods P1a known follow-ups (hardening)
- **Id**: BL-0109
- **Status**: open
- **Since**: 2026-10-04
- **Origin**: self
- **Problem**: mods P1a 審查留下的強化事項，只剩 watcher 的 roots 集合沒有上限（src/status/runs-watch.js 的 `new Set()`），其餘已在 P1b 修完。
- **Impact**: 長時間跑、追蹤很多專案時集合會一直長大；目前沒有實際問題。
- **Trigger**: P3 start
- **Effort**: M
- **Source**: mods P1a row and combined reviews, 2026-10-04
- **Pointer**: docs/backlog/mods-p1a-known-follow-ups.md
- **Context**: 2026-10-17: everything fixed except the watcher roots-set bound (P3 owns it; see sidecar).

### mods P5 proxy-decision reminders (writer first)
- **Id**: BL-0110
- **Status**: open
- **Since**: 2026-10-04
- **Origin**: owner
- **Problem**: 擁有者要求 mods 介面能顯示「代理替你做的決定」提醒。目前沒有任何地方記錄這類決定，所以介面無從顯示；要先做記錄寫入，再做監看，最後才是顯示。 (draft)
- **Impact**: 擁有者想看到代理的決定卻看不到；屬新功能，排在 mods 隨 3.0.0 發布之後。 (draft)
- **Trigger**: after mods ship with 3.0.0
- **Effort**: M
- **Source**: owner request and C4 research, 2026-10-04
- **Pointer**: docs/backlog/mods-p5-proxy-decision-reminders.md
- **Context**: no live decision ledger exists and nothing writes proxy-decision rows, so the live band cannot show them yet; writer, then watcher sidecar, then display.





### Run stage-graph v11 regression covering the packet guidance text
- **Id**: BL-0116
- **Status**: open
- **Since**: 2026-10-11
- **Origin**: self
- **Problem**: 要在 3.0.0 正式版前跑一次 stage-graph 的 v11 回歸評測，涵蓋新的 packet 審查指引文字。目前檢查擋住，因為兩份指引檔不在原預先登記的範圍內，需要先修訂登記。 (draft)
- **Impact**: 沒跑評測就改了指引文字，等於沒有證據支持；正式版前必須處理。 (draft)
- **Trigger**: before the 3.0.0 final cut
- **Effort**: M
- **Source**: packet-guidance owner ruling, 2026-10-11
- **Pointer**: none
- **Context**: Gate blocks: hetero-review SKILL.md and code-loop.md are outside prereg guidance.files; hetero-loops.md hash differs from v10. Write a prereg revision adding both files (as P5 did), freeze v11, then run it.

### PEER-REPORTED (c4140 llm-playground): revise dev-flow SKILL.md foreground-wait advice
- **Id**: BL-0117
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: peer
- **Reporter**: c4140 llm-playground
- **Report**: 01M4NVXM8WM1Q6GR4VSTST0P22
- **Reply**: 2026-10-12 01M4NVY57683RPV21TNXTGQC2D
- **Problem**: c4140 的 llm-playground 專案回報：dev-flow 說明裡建議在前景等待最多 15 分鐘，這個建議有問題；現在系統對前景輪詢已改為只提醒，但說明文字尚未改。 (draft)
- **Impact**: 說明文字仍可能誤導使用者在前景久等；改動屬於指引，需要評測證據，排在 3.0.0 正式版前。 (draft)
- **Trigger**: before the 3.0.0 final cut, with the v11 guidance eval
- **Effort**: S
- **Source**: fleet msg `01M4NVXM8WM1Q6GR4VSTST0P22`; replied `01M4NVY57683RPV21TNXTGQC2D`
- **Pointer**: none
- **Context**: depth-0 foreground sleep/tail polling now draws an advice-only warning (depth0-delegate-gate); the dev-flow SKILL.md foreground-wait (<=15 min) wording is guidance text and waits for eval evidence before it changes.



### Find what rewrites the committed t7-config-rename fixture outside the suite
- **Id**: BL-0122
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: 已提交的評測範例檔 config.json 曾被改寫成壓縮格式。測試套件內已確認都只寫暫存副本，並加了斷言：套件內再寫到範例檔會直接點名是哪個檔。真正的寫入者還沒抓到，最可能是有人在原位執行該題自己的測試。
- **Impact**: 低。範例檔被無聲改動，容易誤提交；套件內的回歸已有斷言擋住。
- **Trigger**: config.json 再次在 git status 出現改動時，當下查是哪個流程在原位跑了 t7
- **Effort**: S
- **Source**: discuss-exam-fix full suite 2026-10-12; narrowed by BL-0122 lane 2026-10-14
- **Pointer**: none
- **Context**: Not recurring as of 2026-10-16 (no fixture change in git status or commits since 10-12). Known writer: t7 tests/tool.test.js run in place.

### mods/live recent conversation: groups expand by mouse only
- **Id**: BL-0123
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: mods/live 介面的「最近對話」區塊，群組只能用滑鼠點開；在 tmux 裡用鍵盤無法移到群組並展開，按 Enter 反而觸發前面的切換分頁按鈕。 (draft)
- **Impact**: 只用鍵盤或 ssh 的使用者無法展開群組；擁有者若要用鍵盤才需處理。 (draft)
- **Trigger**: Claude Code 支援 pane 內非分頁 Button 的鍵盤焦點或 hotkey 時
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
- **Effort**: M
- **Source**: dispatch tree plan, step 4 deferred by owner ruling 2026-10-13
- **Pointer**: docs/plans/2026-10-13-dispatch-tree.md
- **Context**: Plan §4, D4. Carry root/parent/depth as remote-reported telemetry, never an edge (the far side is an LLM relaying it; G1 finding 56a3391e). Needs a fleet dispatch field plus a receiver record, shown as a labelled hint.
### 增量帶回重審在真實席位下用不了
- **Id**: BL-0201
- **Status**: open
- **Since**: 2026-10-17
- **Origin**: self
- **Problem**: 帶回重審的增量模式遇到真實審查席位時多半無法運作：審查協定沒要求意見開頭寫檔案與行號，沒寫就退回完整審查；席位照要求答覆時又把意見寫兩份、或漏掉識別碼前綴，整輪被擋下。
- **Impact**: 增量模式在真實席位下要嘛退回完整審查、要嘛整輪失敗，省不到錢也不能設為預設。
- **Trigger**: 決定把增量設為預設之前，或有人在真實席位組合上開啟增量帶回
- **Effort**: M
- **Source**: BL-0146 D5 實測 2026-10-17
- **Pointer**: docs/plans/evidence/2026-10-17-review-only-increment/README.md
- **Context**: 實測 9 輪中 9 輪被擋 (主組)；加一句 spec 文字後 12 輪中 4 輪被擋。修法選項在 README 第 5 節。

### 附錄把同一個舊問題按席位重複列出
- **Id**: BL-0202
- **Status**: open
- **Since**: 2026-10-17
- **Origin**: self
- **Problem**: 三個席位各報一次同一個舊問題，上一輪留下的問題清單就列三行，而且每個席位都收到全部行；清單約占增量輸入的四分之一。
- **Impact**: 範圍小的帶回，清單比省下的檔案還大，增量反而多花輸入。
- **Trigger**: 增量帶回要設為預設，或帶回範圍不大但席位數增加
- **Effort**: S
- **Source**: BL-0146 D5 實測 2026-10-17，審查 finding 0ad19dc1
- **Pointer**: docs/plans/evidence/2026-10-17-review-only-increment/README.md
- **Context**: 每個舊問題 3.0 至 3.1 行；去重後約少三分之二的清單位元組，未實測。

### 帶回修正刪掉或改名的檔案時，舊問題清單會誤導席位
- **Id**: BL-0203
- **Status**: open
- **Since**: 2026-10-17
- **Origin**: self
- **Problem**: 修正把某個檔案刪掉或改名後，上一輪留下的問題清單仍指向舊路徑，席位去答覆那一行，說問題還在，卻沒發現另一個檔案還引用已不存在的模組。
- **Impact**: 增量模式漏掉改名造成的壞引用，並對作者回報不存在的問題。
- **Trigger**: 增量帶回要設為預設，或有人回報帶回重審漏掉改名造成的壞引用
- **Effort**: M
- **Source**: BL-0146 D5 實測 2026-10-17
- **Pointer**: docs/plans/evidence/2026-10-17-review-only-increment/README.md
- **Context**: 改名情境 4 個增量格中 1 格整組席位都漏，其餘只有 1 席說對；完整審查 6 席全說對。

### Compaction handoff: T2 text and the remaining checks
- **Id**: BL-0147
- **Status**: open
- **Since**: 2026-10-14
- **Origin**: self
- **Problem**: 交接機制已出貨。剩：T2 提示改成先寫交接檔再繼續（指引變更，要 eval 和 owner 同意）；間隔設定只有開 session 的檢查會讀。壓縮點已有第一筆實測（約窗口減 33K，數據在 Context），還缺別台機器或別的模型的紀錄。
- **Impact**: 交接檔要模型自己寫才有，現在的 T2 提示沒叫它寫，所以壓縮後多半只有腳本產生的那部分。
- **Trigger**: owner 同意改 T2 文字並排 eval 時，或別的模型出現新壓縮點紀錄時（核對 pre_tokens 是否為這次壓縮）
- **Effort**: M
- **Source**: BL-0124 review, 2026-10-14; mechanism merged from lane/hand, 2026-10-15
- **Pointer**: docs/plans/evidence/2026-10-12-context-reset-cost/README.md
- **Context**: Compaction point measured 2026-10-17 (window 533000): preTokens 499974-501310, about window minus 33K. Done: model note budget 4000B+, half-write guard. Eval: quiz/grade on real transcripts, ON = handoff file, OFF = 20-turn tail.







### Qualification wall cap and truncation rules after run-to-completion
- **Id**: BL-0160
- **Status**: open
- **Since**: 2026-10-14
- **Origin**: self
- **Problem**: 資格考改成每題考完後，總時間上限約 3 小時，平均每題超過約 3 分鐘才會撞到，先觀察重考有沒有「中途到時間」。另外已鎖定合格的場次中途到時間仍算合格，沒考到的題目可能藏著嚴重錯誤。
- **Impact**: 中。慢模型可能一直拿不到判定；截斷時可能放過一個沒考到的嚴重錯誤。
- **Trigger**: 重考 consult／discuss 出現 wall-truncated 紀錄，或 owner 決定截斷怎麼判
- **Effort**: S
- **Source**: review of 763f77de, 2026-10-14
- **Pointer**: docs/backlog/qualification-wall-cap-after-run-to-completion.md
- **Context**: engine-qualify.js:3740-3767: 1800 s per administration x 3 x2 multiplier, 400 s per call; observe first. A truncated locked_qualify pool stays qualified though sticky Tier-1 could still fail it.


### Dispatch-tree 3d live check: kimi child env
- **Id**: BL-0176
- **Status**: open
- **Since**: 2026-10-15
- **Origin**: self
- **Problem**: tmux 掛錯上層的問題（3d）與 codex 端到端已實跑確認通過；只剩 kimi 子程序拿到的身分仍只看過程式碼，需要有憑證的環境。
- **Impact**: 低。程式和模擬測試都已涵蓋；實跑是確認，不是已知缺陷。
- **Trigger**: a credentialed env for kimi
- **Effort**: S
- **Source**: review of lane/dispatch-tree-3b and lane/dt3d, 2026-10-15
- **Pointer**: docs/backlog/dispatch-tree-3b-follow-ups.md
- **Context**: 3d merged 2026-10-15 (plan §4 step 3d). Rows l and d2 (codex) ran and passed 2026-10-15 (d0-rerun-2026-10-15b). Open: kimi with creds.






### Move exam registration to llm-playground; autopilot reads one JSON
- **Id**: BL-0194
- **Status**: open
- **Since**: 2026-10-15
- **Origin**: owner
- **Problem**: 考試登記機制要全部搬到 llm-playground，不維護多份；由 dyno 產出一份 JSON 給 autopilot 綜合評估，至少含每小時解題數、資格、通過率、花費。
- **Impact**: 兩邊各記一份會不一致，排席位時看到的數字對不上。
- **Trigger**: P4a llm-playground side merged and the reconcile report clean (P4b cutover per the plan)
- **Effort**: M
- **Source**: owner, 2026-10-15
- **Pointer**: docs/plans/2026-10-16-bl0194-qualification-registry-move.md
- **Context**: 2026-10-17: P1, P2, P3 and P4a autopilot side merged; P4a llm-playground side in review (two owner decisions pending); P4b remains, plus llm-playground r4/t15 SKIP follow-up (see plan Progress line).


### 依功能把 autopilot 分成 hetero engine、flow、lab 三塊（拆法未定）
- **Id**: BL-0206
- **Status**: open
- **Since**: 2026-10-18
- **Origin**: owner
- **Problem**: autopilot 同時含異質引擎（panel、discuss、plan review、code review）、軟體開發流程、實驗性功能，使用者難分辨哪些是核心。拆法還沒定。
- **Impact**: 不分組只是說明與目錄較雜，沒有功能影響；使用者要分辨用途時較費力。
- **Trigger**: owner 重新提起分組，或新增的技能與腳本再次難以歸類
- **Effort**: M
- **Source**: owner, 2026-10-18（放棄 tier 欄位時順帶提出，以後再說）
- **Pointer**: docs/backlog/split-autopilot-into-hetero-engine-flow-lab.md
- **Context**: 拆法未定（候選深度見 sidecar）；owner 2026-10-18 說以後再說，不主動推進。

### opencode v2 adaptor follow-ups: OPENCODE_PERMISSION precedence, probe seat root, test cosmetics
- **Id**: BL-0208
- **Status**: open
- **Since**: 2026-10-18
- **Origin**: self
- **Problem**: opencode v2 adaptor 審查時留下三件小事沒做：一、兩個 adaptor 都沒清掉環境裡的權限覆寫變數，要先實測它和注入設定誰優先；二、探測用的席位根目錄建法不夠穩；三、測試檔有一段兩邊都回空字串的死碼。
- **Impact**: 第一項若環境變數優先，理論上可放寬審查員的工具權限，目前只是推論、沒有實測；二三只是加固與整潔。
- **Trigger**: 下一次動 opencode adaptor，或有人在環境裡設 OPENCODE_PERMISSION
- **Effort**: S
- **Source**: oc2 審查第 1 代 aa784ab5、第 2 代 95279be8／3b543bc0／b311744d（hetero-review-loop ledger）
- **Pointer**: docs/backlog/opencode-v2-adaptor-follow-ups.md
- **Context**: spike 報告與 references/multi-agent-portability.md 的 OpenCode 2.x adaptor 一節。

### Autonomous next-pick never checks a row's Trigger, so deliberately parked rows rank first
- **Id**: BL-0212
- **Status**: open
- **Since**: 2026-10-18
- **Origin**: self
- **Problem**: 自動選題只看大小和存在天數，不檢查 Trigger 是否已發生；刻意擱著等觸發的條目最舊，所以永遠排第一。2026-10-18 選到 BL-0071，量測後發現觸發並未發生。
- **Impact**: 自動挑選會浪費一輪在量測，再提議關閉。
- **Trigger**: 下一次自動選到觸發未發生的條目，或要在 /next 自動路徑加入觸發檢查時
- **Effort**: S
- **Source**: 本 session，2026-10-18
- **Pointer**: docs/backlog/next-pick-ignores-trigger.md
- **Context**: 70 條 Trigger 皆為自由文字，機械判斷不了，需一道判斷步驟；屬指引層改動，須先有 eval 證據。另 `preferences.class_weights` 檔不存在，KR6 目前沒作用。
