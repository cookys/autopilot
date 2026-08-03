# autopilot — BACKLOG

Trigger-conditioned future work. Each entry must have:
- **Trigger**：what must be true / observed before this fires
- **Context**：one-line problem statement
- **Effort**：S / Fix / L estimate
- **Source**：commit / review-round / retro that surfaced it

Entries without a trigger are rejected (per `skills/quality-pipeline/references/code-review.md` backlog spec).
`next time touching X`／`下次修改 X` is not a valid deferral trigger: it describes known debt, so
admit it to a bounded plan immediately. Valid conditional triggers require external capability,
observed evidence/incident thresholds, a new consumer, or an explicitly expanded threat model.

**Discovery**: when starting any work, `grep <topic>` here. Plan-doc-as-roadmap (`docs/plans/2026-05-14-retro-roundup.md`) post-archive 後遷移 entries 也都歸這裡。

## Audit snapshot（2026-08-04，`develop` @ `33cfd513`）

- **49 real entries**：2 個 Board decisions、18 個已排入執行計畫的 technical gaps、29 個 trigger 尚未成立的 conditional work；`<Topic title>` 範例不計入。
- 本輪逐條對照 code、tests、installed CLI、live probes 與 upstream CHANGELOG/release evidence 後，**0 個已完整完成可刪、0 個可安全視為重複合併**。Codex `PostCompact`、agy structured usage 與 strict `/l5` CLI trust-root 三個舊 conditional trigger 已成立，但 production implementation 尚未完成，所以改列 PLANNED，不誤刪為 done。
- 14 個既有 technical gaps 仍依序收斂於 [`2026-08-03-next-touch-debt-retirement.md`](plans/2026-08-03-next-touch-debt-retirement.md) 的 D1–D8；本輪新增／轉列的 4 項收斂於 [`2026-08-04-platform-capability-trigger-activation.md`](plans/2026-08-04-platform-capability-trigger-activation.md) 的 D1–D4。
- 29 個 conditional entries 主要是四類：等待仍未出現的外部平台／runner contract、等待 telemetry／事故樣本達門檻、等待新 runner／consumer，以及未來擴大 threat model／自動復原範圍才需要的 hardening。

---

### Codex payload install-time generation（2026-08-02 residual spike：NO-GO）
- **Trigger**: Codex 提供受支援的 native plugin lifecycle：在 plugin install **與** Git marketplace upgrade/refetch 兩條適用路徑上，都能於 payload discovery 前自動執行 deterministic generator，且 generator 非零退出會讓外層 install/upgrade fail-loud；或官方提供具同等順序與失敗語意、可由 live CLI 驗證的機制。
- **Context**: codex-cli 0.146.0 的 logged-in `codex exec` 已實證 installed Autopilot cache payload 與 linked support reference 可被讀取，且 audit 結果正確。殘餘 probe 同時反證把 local source 當 Git refresh：generation A 安裝後即使 local fixture 改為 B，`plugin list` 仍為 0.1.0、loader 仍讀 cache generation A，`marketplace upgrade <local>` 以「not configured as a Git marketplace」exit 1；未發布外部 Git fixture，故 Git snapshot refresh 語意維持 `unproven`。帶 `scripts`/`lifecycle` 的 disposable manifest 雖被接受並複製，install 仍成功、exit-17 generator 未執行，四份 installed curated manifests 也無這兩個欄位；native install/upgrade generation lifecycle 為 `fail`。結論維持 committed Codex payload mirrors 與所有 sync/drift gates，不做遷移。
- **Effort**: L（trigger 成立後另立 migration mission）
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）；[`codex-payload-residual-spike`](projects/_archive/2026-08-02-codex-payload-residual-spike/README.md) evidence（2026-08-02）

### Release-time payload branch（B）重啟條件
- **Trigger**: CI 連續數週綠＋真實 tag/release 節奏存在（非每 push 即 shippable）＋ C-Spike 已否決 install-time 路線
- **Context**: Generic push/PR test CI 已存在，但 B 仍需新建 tag→payload publication→push-credential 的 release path；於多 PATCH/日的節奏下，每個 Codex 可見修復多四個失敗點；QA 判 test-signal 時點最差（user install 時才爆）
- **Effort**: L
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）


## Format example

```markdown
### <Topic title>
- **Trigger**: <external or evidence condition; e.g. "after sample N of behavior Y" / "performance degrades below threshold Z">
- **Context**: <one-line problem>
- **Effort**: S | Fix | L (estimate)
- **Source**: <commit SHA / review-round / retro / plan ref>
```

---

## Active entries

### Fable skills absorption plan — Board triage
- **Status**: UNDECIDED — genuine orphan plan found during exhaustive 111-plan audit。
- **Trigger**: Before implementing any of its P1–P4 methodology changes, or when selecting the next behavior-rule improvement。
- **Context**: Do not silently archive or imply approval. Recommended order if reopened: P2 scope-rationalization checklist → P4 written/runs/verified claim ladder → P3 native-code review；P1 pressure-scenario guidance overlaps existing trigger-gated work。
- **Effort**: Board decision (then S per selected slice)。
- **Source**: `docs/plans/2026-07-08-fable-skills-absorption.md`。

### Harness capability-state refresh after 2026-08 platform releases
- **Status**: COMPLETE — D1 closed; D2 agy telemetry is next in [`platform-capability-trigger-activation`](plans/2026-08-04-platform-capability-trigger-activation.md).
- **Trigger**: ADMITTED 2026-08-04 — installed Codex 0.146.0, Claude Code 2.1.220, agy 1.1.10, OpenCode 1.17.15（latest 1.18.11 亦已 isolated probe）與 Grok 0.2.118 已超過多個 committed capability baseline；Codex、agy、Grok changelog 亦新增本 repo 會消費的 hook／structured-output／usage surface。
- **Context**: D1 已產出 closed、content-addressed aggregate receipt：D2=2、D3=4、D4=6 個 required claims 全部 validated 且 immediate re-probe 通過；optional set 保留 OpenCode truncation、Codex install-generator、Grok `SessionEnd` usage 與 generic `tier:` 的 blocked 結論。Grok headless JSON usage 已證實，但沒有把它偷換成 host hook firing。Receipt: [`platform-capabilities.json`](projects/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json)。
- **Effort**: L。
- **Source**: 2026-08-04 code + installed CLI + CHANGELOG capability re-audit；[`platform-capability-trigger-activation`](plans/2026-08-04-platform-capability-trigger-activation.md) D1。

### OpenCode `debug skill` truncation — restore portability check 16 to hard-fail
- **Trigger**: Upstream OpenCode fixes the corpus-volume-dependent `opencode debug skill` output truncation, or a supported OpenCode release changes the plugin/serve discovery surface again.
- **Context**: `scripts/preflight-portability.sh` check 16 is intentionally advisory while OpenCode 1.17 can omit discovered skills from `debug skill` output. Re-probe the real CLI after the upstream fix; if deterministic, restore the check to hard-fail. Do not treat the current advisory as a permanent acceptance of missing skill discovery.
- **Effort**: Fix.
- **Source**: 2026-07-17 OpenCode 1.17 migration run (v2.32.50); current `scripts/preflight-portability.sh` advisory wiring.

### t14 long-horizon per-turn verification gate
- **Trigger**: The next experiment aimed at improving long-horizon constraint adherence, or before claiming that prompt re-injection solves t14-class drift.
- **Context**: Per-turn re-injection moved vocabulary but did not produce a statistically conclusive behavior lift. The untested lever is mechanical verification at every turn: reject constraint-violating output and force a bounded retry. Keep this distinct from re-injection and measure against the existing t14 baseline.
- **Effort**: M.
- **Source**: `docs/projects/_archive/2026-07-08-t14-reinject/report.md` § Follow-up.

### Review-loop enum gate — behavioral per-field invalid-value proof
- **Status**: PLANNED — D1 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-change deferral; the per-field behavioral acceptance gap already exists.
- **Context**: The contract-schema SSOT checks declared enum parity, while generic resolver tests cover invalid→default behavior. D1 will drive one invalid value through every enum field and assert its fallback instead of deferring the known behavioral coverage gap.
- **Effort**: S–M.
- **Source**: `docs/projects/_archive/2026-07-10-contract-schema-ssot/README.md` § Residual / BACKLOG.

### Mission graph scheduler 與 portfolio optimization
- **Trigger**: v2.34.0 的 frozen deliverable graph gate 已出貨，且至少兩個真實 portfolio 顯示靜態 dependency batches 造成可量測的 idle time，或使用者明確要求跨專案排程／dashboard。
- **Context**: v2.34.0 只需要機械阻止 phase explosion：bounded deliverable count、DAG、parallel/batch/depth/gate budget 與 ready-node admission。Critical-path optimization、dynamic reorder、跨 repo portfolio、priority queue、進度 dashboard 與成本最佳化不屬於本次 prevention boundary；過早加入會把一個 P0 correctness gate 再膨脹成 scheduler 專案。啟動後應消費同一 frozen graph/receipt，不得建立第二套 Mission authority。
- **Effort**: L
- **Source**: 2026-07-28 Mission Convergence Portfolio 34-phase runaway audit；`governance-correction.md`

### Mission authority store 與 cross-harness enforcement hardening
- **Trigger**: 需要把 Mission `enforce` 宣稱擴到目前未有 executable blocking adapter 的 harness，或 threat model 升級為防止惡意 same-UID worker 刪改 `.git` 內 registry/state；若只是誠實 agent 的 branch/session reset，v2.34.0 local registry 已足夠。
- **Context**: 本次只實作 current-host 可驗證的 Git-common-dir durable registry、CAS 與 fail-closed adapter。防惡意本機程序需要獨立 UID、root-owned/remote daemon 或具 authenticity 的 authority service；精確 provider token/tool/cost telemetry 也只能在 host 真能觀測時加入。未有實證前不得用 HMAC、自述 counter 或 skill prose 假裝形成安全邊界。
- **Effort**: L
- **Source**: 2026-07-28 Mission P1/P2 parity audit與獨立 Architect/Ops/Skeptic review；`governance-correction.md`

### Codex production `PostCompact` recovery wiring
- **Status**: PLANNED — D3 in [`platform-capability-trigger-activation`](plans/2026-08-04-platform-capability-trigger-activation.md).
- **Trigger**: ADMITTED 2026-08-04 — Codex 0.129.0 official release/PR #19905 documents `PreCompact`/`PostCompact`, `manual|auto` matchers, payload, ordering and failure semantics；D1 已在 installed 0.146.0 上凍結 explicit `/compact` 與 threshold auto-compaction 的 live host firing claims；D3 可消費其 exact D3 claim-ID set。
- **Context**: v2.34.1 已有 host-neutral checkpoint/rehydration gate、`postcompact-adapter` CLI 與 continuation admission，缺的是 production Codex `hooks.json`＋官方 payload translation。D3 只接這條既有 authority，並以 effectful sentinel 證明 reconciliation 前第一個 effectful action 被阻擋；不得複製 Claude payload 假設或另造 recovery path。
- **Effort**: M
- **Source**: controller-execution-discipline v2.34.1 boundary；Codex 0.129.0 / PR #19905 + installed 0.146.0 re-audit；[`platform-capability-trigger-activation`](plans/2026-08-04-platform-capability-trigger-activation.md) D3。

### agy structured-output telemetry integration
- **Status**: PLANNED — D2 in [`platform-capability-trigger-activation`](plans/2026-08-04-platform-capability-trigger-activation.md).
- **Trigger**: ADMITTED 2026-08-04 — agy 1.1.8 CHANGELOG added structured JSON/stream-JSON output and usage；live agy 1.1.10 returned `input_tokens`／`output_tokens`／`thinking_tokens`／`cache_read_tokens`／`total_tokens` from the exact harness process。
- **Context**: 舊 transcript 事實仍成立：2026-08-03 corpus 262 files / 8,850 rows、202 files（77.1%）truncated，且 transcript top-level 仍 0 token/usage fields；不可回填歷史 token。新的 authoritative surface 是 dispatch 時的 native structured envelope，但現行 `dispatch-review.sh`／`dispatch-hetero.sh` 仍走 plain PTY，`engine-scorecard.js` 也硬編碼 `agy_schema_not_exposed`。D2 會分離 response 與 usage、保住既有 framing、拒絕 worker 假 telemetry，並讓新 dispatch samples 可量測；歷史 transcript samples 繼續明示 unavailable。
- **Effort**: L。
- **Source**: 2026-07-25 telemetry audit `9bc10591`；agy 1.1.8 CHANGELOG + 1.1.10 live structured-output probe；[`platform-capability-trigger-activation`](plans/2026-08-04-platform-capability-trigger-activation.md) D2。

### grok implementer 摩擦調校（toolFailure 28%／零 commit 72%／effort 反效果假說）
- **Status**: PLANNED — trigger satisfied；D8 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md). `develop` 已有 52 個 `dispatch-hetero(grok): edits` commits（原條目後新增 28 個），尚未做同任務 A/B。
- **Trigger**: grok 真正被當成 `dispatch-hetero.sh` implementer 常態使用之後（累積 ≥30 個寫檔 session）。
- **Context**: 原本「派遣路徑全為唯讀」的樣本描述已過時；現在真正剩下的是受控校準。歷史訊號仍只有相關性：`toolFailure>0`、零 commit 與 high-effort 較慢都可能是任務難度自選偏差。下一步應用同一批任務做 effort A/B，量測 tool failure、wrapper commit、返工與品質；**不可因舊相關性直接關掉 high**。
- **Effort**: M（需先累積母體，再跑 A/B）
- **Source**: 2026-07-25 context-window telemetry audit recorded by `9bc10591`。

### dispatch-author codex transport：cgroup supervision tier（fd-less inter-poll escapee 殘差閉環）
- **Status**: PLANNED — D3 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md)；2026-07-18 後 transport 已被多次修改（含 `1361ed01`），但 cgroup tier 尚未實作。
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-touch deferral；原 trigger 也已被 post-entry transport edits 滿足。
- **Context**: v2.32.54 transport hardening 的 normal-exit 不完整樹偵測＝監控期累積 descendant snapshots＋exit 後 /proc fd-holder 掃描（TERM/KILL＋reject）；deadline 路徑的 `reap_tree(pgid,10,worker_pid)` 做 kill 前 worker-rooted tree walk。**已驗證涵蓋 honest-failure orphan**：deadline_setsid_orphan／orphan_deleted_fd_holder 兩個 executable 負控對現行實作 157/157 GREEN（regression 已 bank）。**殘差全屬對抗性 worker（out of threat model，v2.25.8 先例）**：(1) poll 間隙 setsid 逃逸「且」不持 private-channel fd 的子孫；(2) deadline 前蓄意兩層 setsid reparent-race 搶在 pre-kill walk 前脫離 worker 樹（gpt-5.5 P3-panel F2，depth-0 以 mutation-validation 判 non-reproducible-honestly、adversarial-only）；(3) 同 uid inode-rebind／`(deleted)` fd 自替換（gpt-5.5 F3/F4、非升權，worker 本就控自身輸出）；(4) model 在 CLI chrome 前注入 fake banner（F1，需 CLI compromise）。完全閉環＝把 dispatch-hetero 的 `systemd-run --user --scope`＋`cgroup.procs` 空集驗證 tier 移植過來（fallback 保留現行路徑＋誠實 provenance 欄位）。repo 先例：cgroup containment 是 teardown-hygiene provenance、非 security attestation。**同一 D3 新增 caller-boundary acceptance**：2026-08-04 live plan-review 證明 `dispatch-plan-review.js` 從 untrusted `/tmp` cwd 啟動 Codex author，0.146.0 兩次皆在 model 前以 repository-trust error exit；須綁 canonical reviewed repo cwd／等價 verified trust flag，並保留 wrong-binding fail-closed 負控，不能再讓 formal hetero gate 被 transport 假死。
- **Effort**: S–M。
- **Source**: 2026-07-18 v2.32.54 P1 review round 4 + P3 terminal qc panel（gpt-5.5/opus）＋ depth-0 mutation-validated adjudication（project ledger p1 round-4 / p3 finding_adjudicated events）；[`platform-capability-trigger-activation` review receipt](plans/2026-08-04-platform-capability-trigger-activation.review.md)（2026-08-04）。

### classify-error quota 共現 gate 偏寬 — 裸 `status`/`error` 子串共現即判 quota
- **Status**: PLANNED — D1 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-touch deferral；既有對抗 fixture 已證明 acceptance gap。
- **Context**: v2.32.53 的 `payment required`/`balance exhausted` 共現 gate 用裸子串（`402`/`status`/`error`/`http` 任一共現即過）——opus 對抗探針實證兩個假陽性樣板可通過。要精度就把 gate 綁到數字 HTTP token（如 `\b402\b`/`status[ :=]4xx`）而非裸詞。前身兩項 run E 殘項（quota merge role 分片、`on_engine_unavailable` 接線）已於 v2.32.54 核銷。
- **Effort**: Fix
- **Source**: 2026-07-17 /l5 run E opus panel 🔵（殘留意見）；v2.32.54 核銷時拆出

### Dispatch-branch lifecycle — SHA-256 `check --ack` residual
- **Trigger**: 第一個 SHA-256 object-format repository 要使用 manual `check --ack`／restore acknowledgment。
- **Context**: inventory、reap 與 restore tests 已支援 SHA-256；剩餘缺口是 acknowledgment validator 仍只接受 40-hex SHA-1。
- **Effort**: S。
- **Source**: 2026-07-31 code/backlog audit。

### Orchestrator edit-gate hermetic baseline
- **Status**: PLANNED — D1 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-change deferral；test 繼承真實 HOME 是已知 hermeticity gap。
- **Context**: 舊條目中的 context-budget HOME、OpenCode migration 與 eval-doc claims 均已修復；目前只剩 orchestrator edit-gate test 仍繼承真實 HOME，需建立 fresh hermetic baseline。
- **Effort**: S。
- **Source**: 2026-07-31 exhaustive backlog audit；targeted gate test目前 20 assertions green。

### context-budget T3 deny tier — calibration and obedience evidence
- **Trigger**: 有可持久化的 context calibration／handoff obedience receipts，或再次觀察到 T3 後新派遣造成 spiral。
- **Context**: 先前 finish-flow marker blocker 已解；真正未完成的是用 session evidence 校準 deny threshold、handoff structure 與 anti-spiral policy，不能只靠靜態 token 比例。
- **Effort**: M。
- **Source**: context-budget follow-up audit。

### skills frontmatter `tier:` 欄位（B4 step 2 — 分層進 frontmatter）
- **Trigger**: 先在 Claude Code ＋ codex 兩平台各做一次「帶未知 frontmatter 欄位」的 plugin load dry-run 且確認解析容忍（R1-F5：未驗不得宣稱無行為影響）；兩平台紀錄在手才動工。
- **Context**: v2.31.16 B4 step 1 已把 docs/skills.md 排成 core/delegation/pioneer 三層（純排版）。step 2 = 把層級寫進各 SKILL.md frontmatter `tier:` 欄位，讓工具可機讀。風險面＝frontmatter 是路由面。
- **Effort**: S（含兩平台 dry-run）
- **Source**: docs/plans/2026-07-04-surface-area-reduction.md §B4；v2.31.16 收尾 deferred。

### distill/learn 邊界句進 description(+ retro「session」詞彙鄰接註記)
- **Status**: PLANNED — D5 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-description-change deferral；routing boundary is already absent from discovery text.
- **Context**: v2.31.18 episodic 觸發語(「這個專案的方法論值得留」等)使 distill 的觸發面更靠近 learn 領域;「learn 記事實、distill 產程序」的邊界句目前只住在 finish-flow L-5.6 的提示裡,不在兩個 skill 自身的 description/Not-for(gap 先於本次變更存在,review 判非阻斷)。retro 的 "session analysis" 與 "distill this project/session" 詞彙鄰接、動詞相異,今日無字面碰撞。改 description = 路由面 = L 待遇。
- **Effort**: S(但 L 待遇 review)
- **Source**: 2026-07-05 v2.31.18 L-5.2 review(autopilot:reviewer)兩條 Suggestion。

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
- **Context**: 2026-07-10 syscontract campaign 實測:12 個「clean」標籤(merged-未被翻 標注法)倒了 5 個(舊01/舊03/06/08/新03),其中新03 的 flag 還抓到當日 develop 現行真 bug(ladder-run.sh pipefail,v2.32.18 修)。全火力 reviewer(sonnet+全契約+tools)比「merged=clean」標注法強。配對一致性協議(m3-pathc-syscontract.md final protocol)不需要標籤,已作為現行量測法;真 certified-clean 集需逐案對抗性預審(每案先過一輪全火力 review + 人工裁決),成本高,等有絕對認證需求再建。
- **Effort**: M
- **Source**: 2026-07-10 L6-r2 WS-A campaign;MiniMax R2 的「reviewer-circular 標注」警告實證。

### distill-scan 校準：friction bucket 混入非使用者文本 ＋ 複合命令儀式盲點
- **Status**: PLANNED — D5 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-touch deferral；both precision and recall gaps were reproduced in the recorded corpus.
- **Context**: 2026-07-04 首次全量掃描（761 sessions）發現兩個校準問題：(1) **friction bucket 噪音** —— 「recurring-correction candidates」樣本混入大量非使用者更正文本：`<teammate-message>` 轉發、dispatch prompt（「OUTPUT ONLY RAW JSON…」「Review this change for security…」）、session-continuation 摘要 —— `--real-only` 沒把這些注入類內容濾掉，稀釋了真實 friction 訊號；建議在抽取層排除 teammate-message 區塊/已知 dispatch-prompt 模板/continuation 標頭。(2) **複合命令儀式盲點** —— n-gram 對「單次 Bash 呼叫內的多步 pipeline」不可見：同 session 實測跑了 ≥8 次的「rewrap→encrypt→push」發布儀式完全沒出現在 trigram/bigram（每次都是一個大複合命令，tokenizer 只取首 token）；若複合命令內部的 `&&`/`;` 步驟能拆進 n-gram 流，這類儀式才可被挖掘。兩者都不影響現有計數正確性，是召回率問題。
- **Effort**: S（friction 過濾）＋ S–M（複合命令拆解，注意別把 heredoc 內容誤拆）
- **Source**: 2026-07-04 Fable 5 session 首次 /distill 全量掃描實測。


### distill identifier lint 開放給外部 skill pack 使用（單獨入口）
- **Status**: PLANNED — D5 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-touch deferral；the reusable lint entry point is a known missing interface.
- **Context**: distill 的 identifier lint（email/IPv4/`/home/<user>/`/FQDN/key-shapes ＋ `~/.autopilot/distill/identifiers.deny`）目前只在 distill 流程內部可用。手寫的個人 pack（本次的 teaching-materials 等五個 skill 走 self-use 豁免，含使用者自己的路徑/帳號）在公開分享前需要同一道 lint，但沒有獨立入口可呼叫。建議：把 lint 抽成可獨立執行的入口（`--path <dir>` 掃任意 skill 目錄），distill 內部改為呼叫同一入口 —— 一份實作兩處使用。
- **Effort**: S
- **Source**: 2026-07-04 Fable 5 session；`~/projects/skills/` pack 建立時的自用豁免決定。

### Reviewer transport exits can erase an otherwise valid fail-closed verdict
- **Trigger**: Grok／GLM／Kimi／Qwen／Codex reviewer transport 再出現「內容可解析、process exit 或 framing 使 verdict 遺失」。
- **Context**: 為仍支援的 runner 建 exact residual fixtures；保留 process truth，但將已驗證的 verdict bytes 與 transport failure 分欄，禁止把 no-verdict 誤報成 review pass。
- **Effort**: M。
- **Source**: historical multi-runner incidents；2026-07-31 hygiene rewrite。

### `dispatch-review.sh` echo-hardening — derived/transformed delimiter (max-security variant)
- **Status**: PLANNED — D4 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-protocol-change deferral；runner reliability measurement is a gate inside D4, not a reason to leave the gap unscheduled.
- **Context**: v2.31.3 chose the plain-nonce-as-prefix + reject-guard hybrid (codex's design-debate alternative: give a nonce and require the model to TRANSFORM it into the accepted delimiter, so a pure prompt-echo can't reproduce the derived marker). D4 owns the per-engine reliability matrix and canonical derived-delimiter implementation; a runner that cannot satisfy the frozen framing contract fails closed rather than keeping a permissive parser.
- **Effort**: Fix (spike-gated)
- **Source**: 2026-07-03 cross-family design debate (codex gpt-5.5 vs grok), v2.31.3.



### Per-event opt-in hook multiplexer (perf) — avoid spawning gated-off opt-in hooks on every tool call
- **Status**: PLANNED — D6 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-touch deferral；benchmarking stays inside D6, but the known disabled-process spawn is scheduled now.
- **Context**: 現在共有 15 個 unique opt-in hooks、16 個 event registrations（`mcp-health` 同時註冊兩個 events）。每個 matching registration 即使 disabled 仍先 spawn `node` 再快速 gate-exit。D6 將以 single per-event multiplexer 讀 manifest/config、只派 enabled hooks，並把 before/after latency 與 process count 留作驗收證據。
- **Effort**: L
- **Source**: v2.26.2 design tradeoff (accepted, gpt-5.5 spec-reviewed).

### Domain-aware routing — consume the `work_domain` telemetry to route reviewer/implementer by diff domain
- **Trigger**: ALL remaining prerequisites are met (telemetry alone is NOT a trigger): (1) a **two-pass resolve** in `resolve-review-loop.sh` without breaking the single-shot JSON contract; (2) a **pre-impl planned-scope signal** for implementer routing; (3) **per-project per-domain calibration with n≥30** real samples; (4) an **inner-reviewer-family field** distinct from panel-only `cross_family_*` semantics.
- **Context**: `/l5` 現已把 resolved `reviewer_runner` 傳入 `dispatch-review.sh`，所以舊 prerequisite (1) 已完成；domain probe 仍只輸出 `work_domain`/`domain_source` telemetry，沒有 domain-conditioned roster 或 two-pass routing。維持 **measure-now-route-later**；`qc_panel`/`cross_family_*`/`--enforce` 不受 domain 影響。Plan: [`docs/plans/2026-06-26-domain-aware-roster.md`](plans/2026-06-26-domain-aware-roster.md).
- **Effort**: L (each prerequisite is its own sub-task; (1) alone is S–M).
- **Source**: 2026-06-26 domain-telemetry ship (Phase 4); the deferred KR4 of the plan.

### L1 block-mode override re-enable — needs a REAL isolation boundary (cgroup is NOT enough)
- **Trigger**: when a `/l5` block-mode project hits a legitimate `executed_set_shrink` that should be waivable, AND a real isolation boundary is available.
- **Context**: The override stays **DEFERRED**. A v2.25.8 attempt to unlock it on a `--containment cgroup-verified` attestation was **REVERTED as UNSAFE** (gpt-5.5 adversarial review 2026-06-26, two EMPIRICALLY-verified escapes): (1) a same-user worker can `systemd-run --user --scope` a **sibling cgroup** outside the dispatcher's scope, so cgroup reap+verify is not malicious-proof and `contained:true` can be a false attestation; (2) the `--l1-verdict-file` path was honored even when worker-reachable (warned, not enforced). Conclusion (vindicates the L1 spec's original deferral): **no local-only, same-user mechanism closes the forgery hole.** Closing it needs one of: a separate UID for the worker, a real sandbox (container/VM/firejail), or a blocked user systemd bus (`/run/user/$UID/bus`) so the worker can't create sibling scopes. THEN: enforce the verdict path is depth-0-created-after-containment-proof and outside repo/.git/worktree; collapse the dispatch `containment`+`contained` provenance into ONE unambiguous attestation enum (don't accept a free-form `--containment` string). The `--containment` flag is currently accepted-but-advisory (no unlock).
- **Effort**: L (isolation boundary + enforced verdict-path + attestation enum + empirical sibling-escape regression)
- **Source**: test-integrity-l1 (v2.25.7) + W1/W2/W3 ship (v2.25.8); gpt-5.5 review verdict in session 2026-06-26; spec §8.3 / §12.

### qc-panel refute pass — graduate from shadow to gating (calibration-gated)
- **Trigger**: `scripts/calibration.sh report` over accumulated refute-shadow samples shows the refute pass does **not** false-suppress critical/`MISSED:` findings (meets the existing graduation-criteria data block). Until then it stays shadow.
- **Context**: v2.24.0 shipped the refute pass as **shadow / non-gating** — it emits `refute_shadow` + rides into the calibration `--source` tag but never alters `verdict` (a refute pass that suppresses a true critical is worse than the bug it fixes). Graduation = wire the survived/refuted result into the authoritative verdict, but only after calibration proves it safe. ✅ The non-gating regression assertion landed 2026-06-24 (this ship): `hooks/tests/qc-panel.test.sh` Test 19 stubs a cross-family refute judge that REFUTES every real miss and asserts `verdict` stays `fail` + `survived_misses:[]` + non-empty `refuted_misses` — locking the invariant mechanically before any graduation can silently break it. **Remaining = the L graduation itself** (wire survived/refuted into the authoritative verdict), still calibration-gated.
- **Effort**: ~~S (the test) now~~ done + L (graduation) when the trigger fires.
- **Source**: 2026-06-24 v2.24.0 ship (`77214a1`) + depth-0 qc 🔵 (reviewer `a4162329`).

### `/l5` hetero-parallel width fan-out (machinery built, deliberately unwired)
- **Trigger**: a **concrete, repeated** need to fan a single batch out across multiple *heterogeneous* (agy/Gemini) workers in parallel — i.e. real `/l5` task-supply where the cost-arbitrage of a second engine actually pays, AND the base-correctness + engine-variance risks are acceptable for that workload.
- **Context**: Phase L shipped `/l4` homogeneous (Claude) batch fan-out. The deterministic rails for the hetero-parallel path **already exist** — `dispatch-batch.sh reap` is the SIGTERM-to-pgroup parallel-kill trap built for shell-dispatched workers (setsid-verified), and `dispatch-hetero.sh` is the single-unit hetero dispatcher. What's unbuilt is the loop that fans `dispatch-hetero.sh` across N units under `dispatch-batch.sh`'s verify/merge-back/reap. It was **cut at plan time** (the weakest leg: base-correctness × engine-variance × *rarest* task-supply — speculative on speculative). S0.a then confirmed wide task-supply is already thin even homogeneously, so this is one-day-to-wire-IF-needed, not a gap. `/l4` homogeneous is the value path.
- **Effort**: S (wire existing rails) — only if the trigger fires.
- **Source**: 2026-06-23 `docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md` scope-cut + Phase L ship (`577ba8d`).

### Generated `.opencode/agent-bodies/*.body.md` relative links break one level deep
- **Status**: PLANNED — D1 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-touch deferral；the generated relative link is already known broken.
- **Context**: 2026-06-02 link-check found `.opencode/agent-bodies/reviewer.body.md` inherits `../skills/quality-pipeline/references/code-review.md` from `agents/reviewer.md` — correct at `agents/` depth, but resolves to `.opencode/skills/...` (missing) from `.opencode/agent-bodies/`. Generated artifact; the link is informational and the body is consumed via OpenCode `{file:..}` inline, so low severity. Fix options: (a) sync script rewrites `../` → `../../` for links when generating bodies; (b) make the source links repo-root-relative; (c) accept. NOTE: the v2.7.x validate.sh link-check is scoped to `skills/` only, so this does NOT fail CI today.
- **Effort**: S (fiddly — link-rewriting in the sync script risks other links)
- **Source**: 2026-06-02 level-3 deep scan + validate.sh link-check enhancement

### Tree-engine graduation Board review
- **Status**: TRIGGERED/OVERDUE — 30-day deadline passed with only 2 samples；Board must extend or abort。
- **Trigger**: `~/.autopilot/calibration/samples.jsonl` reaches 50 reviewer-baseline samples OR 30 days after the first shadow run (2026-06-12), whichever comes first.
- **Context**: Amendment 6 — Board decides graduate / extend / abort based on `scripts/calibration.sh report` output. Silence is NOT extension. P6 adapter post-signoff activation is blocked on a `board_signoff` event recorded in the project tree (see `references/tree-contracts.md` §3.12 and `scripts/tree.js board-status`).
- **Effort**: Fix (Board review meeting; not a code task)
- **Source**: task-tree-engine P5 close-out (2026-06-12); R1 review round Fix M1.

### Leaf-level output compaction for dispatched implementer / qc shell commands (rtk-style)
- **Trigger**: next time a `/l4` / `/l5` foreman or a `quality-pipeline` / `qc-panel` sub-agent's context bloats from raw shell output (full `git diff`, full `pytest`/`vitest` runs, linter dumps) — i.e. a concrete in-the-wild "the leaf agent burned its budget on tool output" observation, OR a user ask to wire token compaction.
- **Context**: 2026-06-23 survey of two token-saving projects — **headroom** (`headroomlabs-ai/headroom`: ML/Rust compression *proxy*, 60-95%, wrong category — a whole product, not a pattern to re-port) and **rtk** (`rtk-ai/rtk`: single Rust binary, 60-90%, filters command output *before* the LLM sees it: failure-only test output, `git diff --stat`, per-class truncation caps (errors:20/list:20 + single `[N more]` marker), linter `--format=json` first, smart structural file truncation). The portable, native, stdin-free win is to bake **rtk's filtering discipline into autopilot's OWN leaf commands** — the implementer/qc shell calls — as compact-by-construction script wrappers (autopilot already does this for `diff-scope-report.sh` / `verify-preexisting.sh`; the gap is the noisy raw commands the dispatched agents still run). autopilot's structural lever (sub-agent context isolation — only the verdict returns to depth-0) is orthogonal and already in place; this is the葉節點 complement.
- **Two adoption paths, both with caveats (spiked 2026-06-23, CC 2.1.186)**:
  - **rtk-transparent (PreToolUse hook that rewrites `git status`→`rtk git status`)**: ✅ **WORKS on 2.1.186** (corrected 2026-06-23 — the earlier "broken" claim was wrong). rtk's `rtk-rewrite.sh` reads `INPUT=$(cat)` = **fd 0**, which is delivered; e2e-verified — a `git log -8` was transparently rewritten to `rtk git log -8` and the model received the compressed output. Gotchas: the hook subprocess needs `rtk` on PATH and `rtk-rewrite.sh` executable.
  - **rtk-CLI (explicit `rtk <cmd>` calls)**: also works; rtk **now installed** at `~/.local/bin/rtk` v0.42.4 (prebuilt musl, no cargo build needed).
- **⚠️ MEASURED ROI (don't oversell — `scripts/` transcript scan, 2026-06-23)**: across 46 autopilot sessions, rtk's **safe-addressable** slice (git log/status/ls/grep/test) is only **~13% of tool-output / ~11% of total context**, ≈ **3K tok/session** — and it's all cheap **input** (≈ noise in $ terms, esp. under prompt caching). rtk's headline "60-90%" is **per-command** (real: `git diff` measured 74%) but those commands are a small fraction of real context; the bulk is Read/Edit/Agent results rtk can't touch (or only lossily). rtk's diff compression is **lossy** → must NOT feed the **reviewer's** line-level diff. Real value is **context-window headroom in long `/l4`/`/l5` autonomous runs**, not $ savings.
- **Recommendation**: rtk is a **context-window tool for long autonomous runs, opt-in only** — not worth default-on for interactive sessions (ROI too thin). Prefer building rtk's *filtering discipline* (failure-only tests, `git diff --stat` for orientation) into autopilot's own script wrappers over a runtime dependency. **Never** route the reviewer's diff through it.
- **Effort**: S (per-command compact wrapper, e.g. a `git diff --stat`-first reviewer feed) — scope to the one command that actually bloats first, don't build the whole rtk surface speculatively.
- **Source**: 2026-06-23 `/next` follow-up — user-requested survey of headroom + rtk; two Explore-agent technical reports + same-session spike (rtk not installed, CC 2.1.186, intent `last_tool_source:"transcript"` confirms transcript-pivot ≠ stdin, zero live PreToolUse hooks).

### `verify_strength` as the third density input — decomposed into ordered precursors
- **Status**: PLANNED — D7 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — precursor (1) is shipped；owner decision admits scorer calibration and resolver consumption now instead of waiting for another density edit.
- **Context**: The `t2×medium` escape cliff showed that verification quality is invisible to review routing; the remaining work is the calibrated scorer (2), then its fail-safe routing input (3).
- **Effort**: L for precursor (2), then M for precursor (3).
- **Source**: `docs/plans/2026-07-08-observation-first-skills.md` § Non-goals / Scope C.

Full design: [`docs/plans/2026-07-09-verify-strength-precursors.md`](plans/2026-07-09-verify-strength-precursors.md). Evidence: the escape cliff where `t2×medium` verification produced 100% escapes — verification QUALITY is invisible to `resolve-review-loop.sh` routing.

- **✅ Precursor (1) — red-green validation instrument** — DELIVERED 2026-07-09 (v2.32.11): `scripts/verify-red-green.sh` proves a change's tests are RED at base+tests / GREEN at head (else they don't exercise the change). Isolated detached worktrees; verdict from real exit codes. This is the BACKLOG's named minimal precursor.
- **📋 PLANNED D7 (2) — real test-suite "verification strength" scorer** — a graded (`weak|medium|strong`) score for an ACTUAL project's suite guarding a change (NOT the pipeline-bench synthetic fixtures). Candidate signals: per-test red-green (precursor 1), mutation-survival / assertion density on the diff, changed-line coverage, oracle presence. Needs its own calibration corpus tying scores to real escape outcomes. **Depends on (1).** Effort L.
- **📋 PLANNED D7 (3) — `resolve-review-loop.sh` consumes `verify_strength`** — fold the (2) score into the existing risk/density machinery (weak suite ⇒ more review depth; strong ⇒ less). Must be additive (byte-identical prefix + appended keys, like `--domain`/`min_panel_size`) and fail-safe (unknown ⇒ weakest ⇒ most review). **Depends on (2)** + the trust-tiered-review policy. Effort M.
### M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
- **Trigger**: 下次把 `evals/orchestration/tasks/t15-cache-invalidation`、`t16-findings-triage`、`t17-purity-invariant` 用於對抗性 implementer 情境（`/l5`、`/l6` hetero 派遣、或任何候選碼不可信的場合）。
- **Context**: 這三個 oracle 的判分 python 與候選碼在**同一個 process** 內執行，候選模組 import 時可用 `sys._getframe()` 走訪呼叫端 frame 的 globals/locals，撈出判分器從未匯出的密鑰。opus 2026-07-09 對抗性重攻實測兩條可靠（5/5 PASS）exploit：N2（t15）——撈出真 `NONCE` 偽造 token 且從不呼叫注入的 `compute_fn`，fidelity 與 cache 軸皆假過；N2'（t17）——重同步 purity 檢查區塊的 `snapshot` 局部變數，一邊 mutate 一邊讓 `snapshot == recs` 恆真。R2 硬化（4 條 planted-file/env/stdout 攻擊）已修好且仍成立，但這條 in-process introspection 類別是**架構性**盲點，不是 R2 修復範圍。真正封死需要候選函式呼叫跑在與判分器分離的 subprocess/interpreter（process isolation），對映 `check-test-integrity.sh` L1 block-mode 在 CLAUDE.md 已記錄的同一結論（no local-only same-process mechanism 對抗同帳號候選碼是防偽的）。
- **Effort**: L（redesign，非修補）。
- **Source**: opus 對抗性重攻，2026-07-09。`docs/projects/_archive/2026-07-09-m3-band-tasks/report.md` § "Residual: in-process introspection"。

### Strict `/l5` provider-readiness CLI trust root
- **Status**: PLANNED — D4 in [`platform-capability-trigger-activation`](plans/2026-08-04-platform-capability-trigger-activation.md).
- **Trigger**: ADMITTED 2026-08-04 — code audit proves this is no longer waiting on an external authority surface：`AutopilotEngine` and campaign intake already accept constructor-owned `providerReadinessAuthority`／`qualificationProvider`, while the ordinary `bin/autopilot.js engine implement-review` constructor path simply does not inject them and deterministically emits `provider_readiness_authority_missing`。
- **Context**: D4 will build one repo-owned fixed bootstrap binding the exact live provider tuple, negative matrix, freshness and observation provenance, then inject it only through the constructor before spend。Serialized/disk receipts remain evidence rather than authority；missing/stale/mismatched/replayed evidence and provider-probe failure must produce zero dispatcher calls。Until D4 ships, lower-level execution must stay honestly labelled and cannot claim strict L5。
- **Effort**: L.
- **Source**: [backlog-actionable-successor closeout](projects/_archive/2026-08-02-backlog-actionable-successor/dev-info.md), 2026-08-03 effective-L4 execution；2026-08-04 CLI/Engine composition re-audit；[`platform-capability-trigger-activation`](plans/2026-08-04-platform-capability-trigger-activation.md) D4。

### First local runner capability semantics（availability/load，不是 quota）
- **Trigger**: 第一個 local runner（例如 ollama 類）接入 capability-state producer。
- **Context**: named endpoint identity 與獨立的 local-deployment availability/load observation schema 已實作；剩餘工作縮為第一個真實 local runner 的 observation→capability-state producer bridge。不得把現有 metered quota enum 套到 local source class。
- **Effort**: S。
- **Source**: 2026-07-14 status CLI design + 2026-07-31 code audit。

### broader shared-config containment / per-worktree isolation（2026-07-17, follow-up）

- **Trigger**: when a dispatched worker poisons a non-identity shared `.git/config` key
  (e.g. `core.hooksPath`, `credential.helper`) or when multi-worktree concurrent dispatch
  needs stronger isolation than emit-time restore.
- **Context**: v2.32.51 identity rail contains ONLY `user.name`/`user.email` (local scope).
  Other keys in the shared `.git/config` remain uncontained. Candidate directions: snapshot/
  restore a broader key denylist, or per-worktree config isolation via
  `extensions.worktreeConfig` so a worktree cannot write through to the shared config.
- **Accepted limitations of the current rail** (do not re-litigate as bugs of v2.32.51):
  1. Drift compare is **point-in-time** at emit — a worker that sets a bad identity, commits
     with it, then restores the original before exit is undetected on its own worktree commits.
  2. An **escaped descendant** could re-poison the shared config after emit-time restore
     (containment is teardown hygiene, not a malicious-worker boundary).
- **Effort**: L (design + isolation semantics).
- **Source**: 2026-07-17 U1b panel findings remediation on identity-containment port.

<!-- autopilot-follow-up:fd4e5ef9e4a86709fb80a378b69cc780160e2e9701d83472daf5f7a8fc16cd64 -->
### Durable merge execution crash recovery
- **Trigger**: When a caller-owned durable merge receipt directory and recovery authority are standardized.
- **Context**: A process crash after one ordered merge edge can lose the in-memory aggregate receipt; P3 intentionally omitted a WAL because its frozen contract supplied no storage-path authority.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0; p3-risk

<!-- autopilot-follow-up:9cc8a47d292bb3f8ad6d8182f7199566e000a2e99aefe54bb9af469652871b0d -->
### Bind dirty content continuity from preflight to execution
- **Trigger**: When merge preflight schema v2 is designed or a consumer requires cross-phase content-continuity proof.
- **Context**: P3 detects content drift after execution starts, but cannot prove preserved bytes are unchanged since P2 issuance because the P2 receipt binds path categories rather than content/index digests.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0; p3-risk

<!-- autopilot-follow-up:bedd809a7d1d5a413e90813c5902beba396099a1588e47494ba3cb9876d8bd7d -->
### Recover stale backlog admission locks safely
- **Trigger**: When a backlog admission is interrupted or the lock directory exists without a live owning admission process.
- **Context**: Backlog admission correctly fails closed on a held lock, but an uncatchable process crash can leave the lock directory behind and block all later admissions until manual recovery.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0; qwen-p4

<!-- autopilot-follow-up:7b5ad93159eca2090d4069fee65229da2c5e91b3aa5087e3fcff67a3f3c6d8c2 -->
### Controller helper API fail-closed hardening
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before these helpers are reused outside the current production Engine call sites or exposed to caller-supplied state/evidence.
- **Context**: Close the helper-level fail-open edges recorded as CED-N01, CED-N02, CED-N03, CED-N05, and CED-N06: require explicit spend projection, preserve/reject empty controller replacement, require repository authority, reject traversal internally, and make test evidence carry production-equivalent binding.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d1e3cafc6b25e4ccde534f237ecac97b66953f2c76b2d56df8a77993b916fd69 -->
### Boundary outcome and root dispatch semantics
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before boundary receipts drive automated recovery or parallel independent graph nodes under one root are enabled.
- **Context**: Derive or remove mutation_failed/unknown_status instead of hardcoding them, and decide whether root-wide nonterminal exclusion is intentional; if not, retain root CAS while scoping dispatch blockers to the exact graph node.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:ecc22ecefe311bf8a185548841308087b4c6c96cf2b73b3ca14471c005ba7bc5 -->
### Portable byte and Work Order lifecycle hardening
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before Mission paths may contain symlinks, generic Work Order imports are accepted, or reconciliation runs on restricted process-table platforms.
- **Context**: Unify symlink byte hashing with Git, reject/strip disposition_receipt on non-stale records, and convert PROCESS_TABLE_UNREADABLE into an explicit fail-closed Work Order classification.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d1d21b3988f6e89eff3964a1e5e56f12171fd4d3cf50b23634364d087380df26 -->
### Durable resume and review authority binding
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before automatic durable resume, reviewer roster rotation, seat retry, or more than one candidate per repair generation is enabled.
- **Context**: Make all durable stop payloads pass verbatim resume validation, bind full-diff barriers to the exact candidate and review kind, and include sealed reviewer roster/seat identities in full-diff and joint-review reuse keys.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:aed0cfc35dd07b4cabf1545ca4bdba4d0a308824eaa3b1631f3f6d9c9ce11811 -->
### Explicit findings identity authority
- **Status**: PLANNED — trigger satisfied；D2 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md). Helper 已 export，且仍以 `findingsIdentityOk = true` fail-open。
- **Trigger**: Before classifyMissingDisposition is reused or exported to any caller that may omit identity validation.
- **Context**: Remove the fail-open findingsIdentityOk default and require every classifyMissingDisposition call to pass an explicit identity verdict.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:42b943b1cd29c7de6d0b621337c605400ea73e33b531b47ee7d7b2dd04ccfc9f -->
### Mission graph and campaign capacity boundary hardening
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before graph hot reload/concurrent writers or caller-supplied non-default campaign capacities are supported.
- **Context**: Read Mission graph bytes once or bind the validation read to the inspected digest, and mirror max_owned_worktrees/temp_capacity_limit/max_prompt_bytes/max_finding_recurrence schema caps in the executable validator.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d574960cb87250d45554901630cdff86ddfd59f5d313a40e657bf7de3f7b7be3 -->
### Orphan leaf liveness and resource reconstruction
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before orphan adoption or resource inventory is used as closure/capacity authority after controller or worktree-creation crashes.
- **Context**: Persist and re-observe leaf process identity before orphan adoption; discover orphan branches and never-registered worktrees; mechanically re-derive active inventory rows.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:516726d963e606a0bf2ec621ad6962a0228863ff976a64a703be7bbd2d4a598d -->
### Terminal status and receipt trust boundary
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before external/legacy terminal receipts cross a trust boundary or the threat model expands beyond confused controllers.
- **Context**: Enforce the closed terminal_status enum at receipt validation and Work Order classification, resolve the unused attached disposition, and document integrity-hash versus producer-attestation guarantees under the confused-controller threat model.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:8f70c159902a5d75d701b775ac9378f53ec4e9380a2534cab6674bf06083d475 -->
### Shared sealed zero-diff validator
- **Status**: PLANNED — D2 in [`next-touch-debt-retirement`](plans/2026-08-03-next-touch-debt-retirement.md).
- **Trigger**: ADMITTED 2026-08-03 — owner decision retired the next-schema-change deferral；three duplicated production validators are sufficient present debt.
- **Context**: Move sealed zero-diff receipt validation into one deterministic shared helper consumed by shell, Engine, and runner boundaries.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b
