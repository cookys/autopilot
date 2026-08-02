# autopilot — BACKLOG

Trigger-conditioned future work. Each entry must have:
- **Trigger**：what must be true / observed before this fires
- **Context**：one-line problem statement
- **Effort**：S / Fix / L estimate
- **Source**：commit / review-round / retro that surfaced it

Entries without a trigger are rejected (per `skills/quality-pipeline/references/code-review.md` backlog spec).

**Discovery**: when starting any work, `grep <topic>` here. Plan-doc-as-roadmap (`docs/plans/2026-05-14-retro-roundup.md`) post-archive 後遷移 entries 也都歸這裡。

---

### Codex payload install-time generation（C-Spike ✅ SPIKE-PASS 2026-07-17，think-tank P6 裁決）
- **Trigger**: 下一個 symlink-hostile 平台要接入之前；或 payload 鏡像 churn 噪音升級為 blocking；或有 live Codex 環境可跑 `codex exec` e2e 時（quota 7/23 復位後）
- **Context**: think-tank（Architect C-conditional / Ops A-high / QA A-high）一致否決 release-time payload branch（B）於現階段；Architect 路線＝驗證 Codex plugin loader 能否吃 install 時才由 `sync-codex-plugin-skills.sh` 生成的 git-ignored 目錄。**SPIKE-PASS 2026-07-17**：codex loader end-to-end 接受 install 時生成的 payload（marketplace add + plugin add → `installed:true`/`enabled:true`），且 sync 腳本零 git 依賴。**遷移 L 的殘餘前置**：(1) `codex exec` e2e 信心（blocked on quota until 7/23）；(2) `marketplace upgrade` live re-read 語意未測；(3) 需要一個 install-time hook 設計（何時觸發生成）。三者到位即可退役 committed mirror＋其 drift gates；否則 A 維持。
- **Effort**: S（剩餘 Spike）＋L（若遷移）
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）；SPIKE-PASS 2026-07-17

### Release-time payload branch（B）重啟條件
- **Trigger**: CI 連續數週綠＋真實 tag/release 節奏存在（非每 push 即 shippable）＋ C-Spike 已否決 install-time 路線
- **Context**: B 需要從零建 tag→CI→push-credential 基建；於多 PATCH/日的節奏下，每個 Codex 可見修復多四個失敗點；QA 判 test-signal 時點最差（user install 時才爆）
- **Effort**: L
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）


## Format example

```markdown
### <Topic title>
- **Trigger**: <observable condition; e.g. "next time touching X" / "after sample N of behavior Y" / "performance degrades below threshold Z">
- **Context**: <one-line problem>
- **Effort**: S | Fix | L (estimate)
- **Source**: <commit SHA / review-round / retro / plan ref>
```

---

## Active entries

### Skill-transport payoff A/B — implementer arm Phase 2 closure
- **Status**: TRIGGERED — reviewer arm shipped; frozen plan says Phase 2 runs regardless, but no backlog ticket existed。
- **Trigger**: 現在；在下次 skill transport/default decision 前，執行 implementer arm or record an explicit won’t-do decision。
- **Context**: Reviewer arm refuted transport payoff for reviewer seats；implementer H1 remains unmeasured, so the plan cannot be treated as wholly closed。
- **Effort**: M。
- **Source**: `docs/plans/2026-07-15-skill-transport-payoff-ab.md` review log。

### Fable skills absorption plan — Board triage
- **Status**: UNDECIDED — genuine orphan plan found during exhaustive 111-plan audit。
- **Trigger**: Before implementing any of its P1–P4 methodology changes, or when selecting the next behavior-rule improvement。
- **Context**: Do not silently archive or imply approval. Recommended order if reopened: P2 scope-rationalization checklist → P4 written/runs/verified claim ladder → P3 native-code review；P1 pressure-scenario guidance overlaps existing trigger-gated work。
- **Effort**: Board decision (then S per selected slice)。
- **Source**: `docs/plans/2026-07-08-fable-skills-absorption.md`。

### Foreman↔depth-0 coordination R6 — reliable state, ownership lease, and adaptive recovery
- **Trigger**: The next multi-foreman `/l6` campaign, or the next incident where a quiet worker is mistaken for dead / two controllers touch the same stage / a stalled dispatch must be killed and re-dispatched.
- **Context**: Lineage, heartbeats, status watching, and the advisory directive channel are shipped, but they still cannot reliably distinguish `{working, waiting, blocked, dead}`. Ownership is not structurally lease-gated across foreman and depth-0, and Stage 3 policy remains open: `steer` inquiry → bounded wait → kill only on verified non-response → authorized re-dispatch. Build on the existing ledger generation/nonce and directive channel; do not infer ownership from polling or silently seize an active stage.
- **Effort**: L.
- **Source**: `docs/plans/2026-07-08-l6-resilience-improvements.md` R6; 2026-07-08 campaign collisions; dispatch-observability Stage 3 residual.

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
- **Trigger**: A third enum-drift incident, or the next change that cannot be covered confidently by the existing schema↔shell declared-set gate plus resolver tests.
- **Context**: The contract-schema SSOT checks declared enum parity, while generic resolver tests cover invalid→default behavior. A per-field behavioral gate would drive one invalid value through every enum field and assert its fallback; it remains deferred until recurrence justifies the bash-plumbing cost.
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
- **Trigger**: an accepted live Codex hook probe proves the production event name, payload schema, registration path, ordering, and failure behavior for the supported Codex release; or Codex publishes an official hook-adapter contract covering those facts.
- **Context**: v2.34.1 ships the host-neutral checkpoint/rehydration gate and a `PostCompact`-ready adapter contract, but deliberately does not register a production Codex hook from an unaccepted local probe. Once the trigger fires, wire only the verified adapter, add a live replay proving the first effectful post-compact action is blocked until reconciliation, and update the Codex package boundary without importing Claude hook assumptions.
- **Effort**: M
- **Source**: controller-execution-discipline v2.34.1 boundary; preserved user-owned Codex hook-probe workspace

### Readiness gate 的 session-local qualification provider
- **Status**: SHIPPED — backlog-convergence Track 3；host-injected exact-role authority is required pre-spend。
- **Trigger**: `ICC P4` 或 Mission integration 要把 `ProviderReadinessReceipt` 接到 effectful pre-spend gate 之前；具體而言，只要該 gate 需要 implementer、verification-author 或 QC seat 從 `probe-needed` 合法升到 `usable`，此項就必須先完成。
- **Context**: PRO P4 嚴格保持三軸獨立：transport/live probe 不得推論 role qualification，而 disk-backed `engine-scorecard.js` 依治理規則只是 `untrusted_telemetry`。目前 reviewer 可由既有 live qualifier 取得 session-local authority，但 implementer／verification-author 尚無可自動升格的 role corpus/verifier，QC 也需明確綁定 reviewer-role authority。v2.34.1 的 real Mission completion campaign 再次命中此邊界：三席 final panel 在 exact QC scorecard qualification precondition 全數停止，沒有任何 seat 被 dispatch；depth 0 因此另以同一 frozen whole-diff roster執行 joint review，而沒有偽造 qualification receipt。正規修法是新增 host-injected、不可序列化或外部簽章的 exact-tuple qualification provider，讓 readiness 只消費 authority-bound observation；不得把 provisional scorecard row 或 probe 成功當 qualification。
- **Effort**: L（含 implementer／verification-author role eval、QC reviewer-role mapping、ICC intake red/green）
- **Source**: PRO P4 Heto generation 1，GPT-5.6 Sol finding R2/R6，candidate `d0a05f7`；2026-07-30 controller-execution-discipline final-panel admission incident

### CLAUDE.md 逼近 40k 硬上限（目前僅餘 6 bytes）
- **Trigger**: 下一個需要新增或擴寫 `CLAUDE.md` inventory row 的變更。
- **Context**: 2026-08-01 實測 `CLAUDE.md` 為 39,994/40,000 bytes；inventory gate 目前仍綠，但任何正常新增都會撞上限。先把可搬的沿革／細節移到正主 reference，再新增 row。
- **Effort**: S。
- **Source**: 2026-07-31 backlog hygiene audit。

### `hooks/tests/dispatch-output-quiescence.test.sh` 時間敏感 flake 未根治
- **Trigger**: 下次 CI 或 finish-flow 因它變紅時；或要把它納入 blocking gate 之前。
- **Context**: v2.32.57 的 merge（`d90433b`，標題明寫 "kill dispatch-output-quiescence flake"）以 worker count 縮放 parallel timing factor，但未根治。v2.32.58 期間三次觀測：base SHA 上 FAIL（`immediate-content returns quickly: expected <= 5, got 6`）、一次全套件 PASS、pre-merge 全套件再度 FAIL 且**失敗的斷言換成 `genuine-empty-fast`** — 斷言隨機漂移是負載敏感 flake 的特徵而非邏輯錯誤。`verify-preexisting.sh` 正式判定 `{"head":"fail","base":"fail","verdict":"PRE_EXISTING"}`。可能修法：把絕對 tick 上限改成相對於實測 baseline tick 的比值，或在高負載下自動放寬。
- **Effort**: S–M
- **Source**: v2.32.58 finish-flow L-5.2 pre-merge 全套件

### agy 遙測盲區 — transcript 無 token 欄位且 91% 被平台截斷
- **Trigger**: 要把 agy 納入任何成本／容量決策之前；或 antigravity 上游補上 usage 欄位時。
- **Context**: `~/.gemini/antigravity-cli/brain/*/。system_generated/logs/transcript.jsonl` 的 schema 是 `{step_index, source, type, status, created_at, content, truncated_fields}` — **完全沒有 token/usage 欄位**，且 500 個 session 中 454 個（91%）帶 `truncated_fields`（平台自行截斷內容）。目前只能用 content bytes 當極粗代理指標，不可與 codex/grok/opencode 的 token 數同軸比較。**不可測 ⇒ 不可優化**：在補上遙測前，任何 agy 的成本結論都是猜測。
- **Effort**: S（若上游有欄位）／M（若需自建量測 harness）
- **Source**: 2026-07-25 context-window telemetry audit recorded by `9bc10591`。

### grok implementer 摩擦調校（toolFailure 28%／零 commit 72%／effort 反效果假說）
- **Trigger**: grok 真正被當成 `dispatch-hetero.sh` implementer 常態使用之後（累積 ≥30 個寫檔 session）。
- **Context**: 2026-07-25 掃描顯示 grok 目前在 autopilot 派遣路徑上只有 71 個 session 且**全是唯讀**（review 59／author 12）；實際寫碼發生在 dispatch rail 之外的互動式 session。既有 32 個寫檔 session 的訊號：`toolFailure>0` 28.1%（平均 1.6 次）、零 commit 71.9%（對應已知的 untracked-new-files 問題）、但 `editAndRetry`／`regeneration`／`hasReverted` **全為 0**（寫出來的東西不用重寫，品質面乾淨）。另有一個**相關非因果**觀察：`reasoning_effort=high` 的 302 個 session 只有 6 個寫檔、耗時 3.4 倍、toolFail 更多，而 `(none)` 的 65 個有 24 個寫檔 — 極可能是任務難度自選偏差，**要驗證需同任務 A/B，不可逕自關掉 high**。
- **Effort**: M（需先累積母體，再跑 A/B）
- **Source**: 2026-07-25 context-window telemetry audit recorded by `9bc10591`。

### dispatch-author codex transport：cgroup supervision tier（fd-less inter-poll escapee 殘差閉環）
- **Trigger**: 下次動 `scripts/dispatch-author.sh` codex branch 或 `scripts/lib/dispatch-author-codex-transport.sh`；或首次出現真實 incomplete-tree 事故（result 被 orphan 汙染）。
- **Context**: v2.32.54 transport hardening 的 normal-exit 不完整樹偵測＝監控期累積 descendant snapshots＋exit 後 /proc fd-holder 掃描（TERM/KILL＋reject）；deadline 路徑的 `reap_tree(pgid,10,worker_pid)` 做 kill 前 worker-rooted tree walk。**已驗證涵蓋 honest-failure orphan**：deadline_setsid_orphan／orphan_deleted_fd_holder 兩個 executable 負控對現行實作 157/157 GREEN（regression 已 bank）。**殘差全屬對抗性 worker（out of threat model，v2.25.8 先例）**：(1) poll 間隙 setsid 逃逸「且」不持 private-channel fd 的子孫；(2) deadline 前蓄意兩層 setsid reparent-race 搶在 pre-kill walk 前脫離 worker 樹（gpt-5.5 P3-panel F2，depth-0 以 mutation-validation 判 non-reproducible-honestly、adversarial-only）；(3) 同 uid inode-rebind／`(deleted)` fd 自替換（gpt-5.5 F3/F4、非升權，worker 本就控自身輸出）；(4) model 在 CLI chrome 前注入 fake banner（F1，需 CLI compromise）。完全閉環＝把 dispatch-hetero 的 `systemd-run --user --scope`＋`cgroup.procs` 空集驗證 tier 移植過來（fallback 保留現行路徑＋誠實 provenance 欄位）。repo 先例：cgroup containment 是 teardown-hygiene provenance、非 security attestation。
- **Effort**: S–M。
- **Source**: 2026-07-18 v2.32.54 P1 review round 4 + P3 terminal qc panel（gpt-5.5/opus）＋ depth-0 mutation-validated adjudication（project ledger p1 round-4 / p3 finding_adjudicated events）。

### classify-error quota 共現 gate 偏寬 — 裸 `status`/`error` 子串共現即判 quota
- **Trigger**: 下次 passive quota-capture 出現假陽性（把非額度錯誤記成 `quota_exhausted`）；或下次動 `engine-capability-state.js` 的 classify-error。
- **Context**: v2.32.53 的 `payment required`/`balance exhausted` 共現 gate 用裸子串（`402`/`status`/`error`/`http` 任一共現即過）——opus 對抗探針實證兩個假陽性樣板可通過。要精度就把 gate 綁到數字 HTTP token（如 `\b402\b`/`status[ :=]4xx`）而非裸詞。前身兩項 run E 殘項（quota merge role 分片、`on_engine_unavailable` 接線）已於 v2.32.54 核銷。
- **Effort**: Fix
- **Source**: 2026-07-17 /l5 run E opus panel 🔵（殘留意見）；v2.32.54 核銷時拆出

### Dispatch-branch lifecycle — SHA-256 `check --ack` residual
- **Trigger**: 第一個 SHA-256 object-format repository 要使用 manual `check --ack`／restore acknowledgment。
- **Context**: inventory、reap 與 restore tests 已支援 SHA-256；剩餘缺口是 acknowledgment validator 仍只接受 40-hex SHA-1。
- **Effort**: S。
- **Source**: 2026-07-31 code/backlog audit。

### Orchestrator edit-gate hermetic baseline
- **Trigger**: 下次修改 orchestrator edit gate，或在不同 HOME／CI host 重跑其 baseline。
- **Context**: 舊條目中的 context-budget HOME、OpenCode migration 與 eval-doc claims 均已修復；目前只剩 orchestrator edit-gate test 仍繼承真實 HOME，需建立 fresh hermetic baseline。
- **Effort**: S。
- **Source**: 2026-07-31 exhaustive backlog audit；targeted gate test目前 20 assertions green。

### codex-native `spawn_agent` lifecycle / teardown 盲區納管（codex 當 depth-0 時）
- **Status**: SHIPPED — backlog-convergence Track 2；native child disposition is explicit and shell reaping is not claimed。
- **Trigger**: 下次 codex 擔任 depth-0 orchestrator 跑 /l4-/l6 前；或下次改版 `platforms/codex/plugin/skills/ceo-agent` payload 時。
- **Context**: 2026-07-14 稽核時的 Codex 0.144 原生 `spawn_agent`（該次 976 呼叫）完全在 autopilot 軌道外；當時 schema 也無 `model` 參數。Codex 0.146 已顯示 `model` 與 `effort`，所以 model pinning 不再是本條的已證缺口。仍未解的是 lifecycle/teardown：它不是 Agent-tool（無 TaskStop）、不是 shell-dispatched（無 pgid 可 reap），且 merge-back/GC 零覆蓋。修法：先完成 0.146 fresh spawn probe，再決定要求 Codex orchestrator 全走 autopilot dispatch 軌道，或在 finish gate 偵測未終止的 native children / session 殘留。
- **Effort**: S（payload prose 禁令）/ M（收尾偵測 gate）
- **Source**: 2026-07-14 codex-worktree audit §2/§4/§5。

### context-budget T3 deny tier — calibration and obedience evidence
- **Trigger**: 有可持久化的 context calibration／handoff obedience receipts，或再次觀察到 T3 後新派遣造成 spiral。
- **Context**: 先前 finish-flow marker blocker 已解；真正未完成的是用 session evidence 校準 deny threshold、handoff structure 與 anti-spiral policy，不能只靠靜態 token 比例。
- **Effort**: M。
- **Source**: context-budget follow-up audit。

### E1 dispatch-manifest 合規 merge gate（/lN 宣稱 ⇒ 機器可驗）
- **Status**: SHIPPED — backlog-convergence Track 1；controller Work Order provenance is the merge backstop。
- **Trigger**: 下次發現 depth-0 繞過 dispatch 路徑手做實作（如 2026-07-14 研究中 92d8784a 用裸 codex exec 繞 dispatch-hetero、user 質問才自白），或 orchestrator-edit-gate 進 block 模式時（Bash 寫檔是它宣告的盲區，E1 是 backstop）。
- **Context**: merge 時驗「product commits 是否可溯源到 dispatch run manifests」（`${TMPDIR}/autopilot-dispatch-runs/*.manifest.json` 已存在）+ depth-0 Edit 計數；不符 ⇒ 擋 merge（qc-gate 同級）。A1 是事前預防（honest-agent 級），E1 是事後偵測 — 兩者合起來才閉環。
- **Effort**: M。
- **Source**: 2026-07-14 transcript 研究 S3（協議合規無 gate、adjudicate-findings 零呼叫）；plan § Declared limits。**追加證據（2026-07-14 codex-worktree audit）**：codex 當 depth-0 時自承下海 implement + 用原生 `spawn_agent`（976 次）完全繞過 dispatch 軌道 — 又一筆「協議合規純靠模型自覺、無機器可驗」的 S3 實例。

### B1/B2 review 路徑效率（diff-only 強制 + delta re-review）
- **Trigger**: 下次任何 /l5 /l6 run 的 review dispatch 出現 repo 爬讀（review session token 中位數異常）或 marathon loop（>5 輪）時；或 Board 排程。
- **Context**: 2026-07-14 研究：45% 的 codex review session 爬整個 repo（中位 698K token vs diff-only 27K，26 倍，佔全部 codex token 27%）；r23 案例每輪全量重餵 spec（160-230K 字元 × 60+ 次審查，零 delta）。對策草案：dispatch-review 各 runner 禁探索（codex --sandbox read-only 已有，加 no-tools 級收緊 + 違規 fail-closed）；round 2+ 只餵「上輪 findings + delta diff」（`diff-since-last-round.sh` 已存在，缺 reviewer-safe 輸出格式 — 現有輸出是 dispatcher-only，直接餵會洩 round-cycle meta-signal）。效益量級：codex token -27%、marathon 每輪成本降一個數量級。
- **Effort**: L（需獨立 plan + panel review）。
- **Source**: 2026-07-14 評估報告 §Q2；quant-codex-cookys-report。
- **範圍修正（2026-07-14 回溯校準，calib-codex）**：「delta re-dispatch」只對 **review 側**成立（dispatch-review 每輪重餵整份 spec/diff 是 prompt 構造問題，delta 有效）；**implementer 側被資料推翻** — codex re-dispatch 起始 prompt 各輪 flat 17-20k、斜率 ≈ 0（無狀態 fresh prompt，本來就不累積），早前把 financial-order-r7 的 9.28M 歸因累積 prompt 是誤判，真實量是 session 內 agentic context 成長。implementer 側的真壓力點：預設 spark 視窗只有 121,600，44% dispatch 吃到 ≥90% — lever 是縮 dispatch scope 或把大 context 單元路由到 258k/353k 引擎（視窗相對門檻 75% warn / 90% hard），不是壓 prompt。

### `dispatch-review.sh` runner-aware reviewer output-token budget (`--max-tokens`)
- **Status**: TRIGGERED — user requested the capability to be tracked; implementation intentionally deferred。
- **Trigger**: 下一次需要限制 reviewer 回覆的 output-token 上限，或再次為 `scripts/dispatch-review.sh` 增加 runner CLI/API 參數時；先完成各 runner 的參數映射與 unsupported 行為定義，再接線。
- **Context**: `dispatch-review.sh` 目前只接受 `--effort`、`--timeout` 等選項，沒有 `--max-tokens`；現有 context-window gate 只限制送入的 diff/spec/pack 大小，不是 output budget。Codex、agy、Grok、cc-shim、Anthropic-compatible、Claude-native、Qoder 的 token 參數語意不保證同名，不能把一個 generic flag 盲目轉發；需建立 canonical budget contract、runner-specific mapping、fail-closed unsupported path 與 fixture coverage。此項與 B1/B2 的 prompt/delta 效率工作相關但不重複。
- **Effort**: M。
- **Source**: 2026-08-01 user report；`scripts/dispatch-review.sh` usage/parser audit（lines 33–37、119–136）。

### skills frontmatter `tier:` 欄位（B4 step 2 — 分層進 frontmatter）
- **Trigger**: 先在 Claude Code ＋ codex 兩平台各做一次「帶未知 frontmatter 欄位」的 plugin load dry-run 且確認解析容忍（R1-F5：未驗不得宣稱無行為影響）；兩平台紀錄在手才動工。
- **Context**: v2.31.16 B4 step 1 已把 docs/skills.md 排成 core/delegation/pioneer 三層（純排版）。step 2 = 把層級寫進各 SKILL.md frontmatter `tier:` 欄位，讓工具可機讀。風險面＝frontmatter 是路由面。
- **Effort**: S（含兩平台 dry-run）
- **Source**: docs/plans/2026-07-04-surface-area-reduction.md §B4；v2.31.16 收尾 deferred。

### codex 宿主 slash-entry 探針入 gate(committed、可重跑)
- **Status**: SHIPPED — backlog-convergence Track 2；committed opt-in live probe is rerunnable。
- **Trigger**: 下次改動 `platforms/codex/plugin` payload 產生邏輯,OR C1a Spike 動工時(兩者都會重驗安裝面)。
- **Context**: 2026-07-05 已一次性實測:codex 0.142.2 裝 v2.31.16 payload 後五個薄殼入口全部浮現、l5 wiring probe 以 `cat` exec 事件證明 MUST-READ 連結在 plugin cache 內解析並被讀取(記錄在 `references/multi-agent-portability.md`)。缺的是把它做成 committed 可重跑 gate(`slash-entry-probe.test.sh` 的 codex 版:`codex exec -m <model>` + stderr exec-event 斷言),與 CC 版同一 self-skip 慣例。注意 quota:Spark 額度枯竭時換 `-m gpt-5.5`(capability-state 已記 2026-07-07 12:44 重置)。
- **Effort**: S
- **Source**: 2026-07-05 /l6 cross-harness 薄殼驗證 run。

### distill/learn 邊界句進 description(+ retro「session」詞彙鄰接註記)
- **Trigger**: 下次修改 `skills/distill/SKILL.md` 或 `skills/learn/SKILL.md` 的 description;OR 實際觀察到一次 distill↔learn(或 distill↔retro)誤路由。
- **Context**: v2.31.18 episodic 觸發語(「這個專案的方法論值得留」等)使 distill 的觸發面更靠近 learn 領域;「learn 記事實、distill 產程序」的邊界句目前只住在 finish-flow L-5.6 的提示裡,不在兩個 skill 自身的 description/Not-for(gap 先於本次變更存在,review 判非阻斷)。retro 的 "session analysis" 與 "distill this project/session" 詞彙鄰接、動詞相異,今日無字面碰撞。改 description = 路由面 = L 待遇。
- **Effort**: S(但 L 待遇 review)
- **Source**: 2026-07-05 v2.31.18 L-5.2 review(autopilot:reviewer)兩條 Suggestion。

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
- **Context**: 2026-07-10 syscontract campaign 實測:12 個「clean」標籤(merged-未被翻 標注法)倒了 5 個(舊01/舊03/06/08/新03),其中新03 的 flag 還抓到當日 develop 現行真 bug(ladder-run.sh pipefail,v2.32.18 修)。全火力 reviewer(sonnet+全契約+tools)比「merged=clean」標注法強。配對一致性協議(m3-pathc-syscontract.md final protocol)不需要標籤,已作為現行量測法;真 certified-clean 集需逐案對抗性預審(每案先過一輪全火力 review + 人工裁決),成本高,等有絕對認證需求再建。
- **Effort**: M
- **Source**: 2026-07-10 L6-r2 WS-A campaign;MiniMax R2 的「reviewer-circular 標注」警告實證。

### preflight-portability.sh meta-smoke test
- **Status**: SHIPPED — backlog-convergence Track 2；clean/planted-failure cases run in a sandbox tree。
- **Trigger**: a preflight false-green incident (gate passes while an invariant is actually broken), OR next time adding a check to `preflight-portability.sh`.
- **Context**: the 17-check gate itself has no test. Panel consensus (2026-07-04): meta-smoke = copy script into a sandbox tree, seed ONE violation (e.g. adapter file with wrong `name:`), assert exit != 0; full per-check decomposition is diminishing returns. Deferred to bound the v2.31.10 release; `dispatch-explore.test.sh` + anthropic mock coverage were the higher-priority gaps and shipped.
- **Effort**: S
- **Source**: 2026-07-04 review-closeout design panel Q2.

### distill-scan 校準：friction bucket 混入非使用者文本 ＋ 複合命令儀式盲點
- **Trigger**: next time touching `scripts/distill-scan.js`，OR 下一輪 /distill 再次觀察到同類噪音。
- **Context**: 2026-07-04 首次全量掃描（761 sessions）發現兩個校準問題：(1) **friction bucket 噪音** —— 「recurring-correction candidates」樣本混入大量非使用者更正文本：`<teammate-message>` 轉發、dispatch prompt（「OUTPUT ONLY RAW JSON…」「Review this change for security…」）、session-continuation 摘要 —— `--real-only` 沒把這些注入類內容濾掉，稀釋了真實 friction 訊號；建議在抽取層排除 teammate-message 區塊/已知 dispatch-prompt 模板/continuation 標頭。(2) **複合命令儀式盲點** —— n-gram 對「單次 Bash 呼叫內的多步 pipeline」不可見：同 session 實測跑了 ≥8 次的「rewrap→encrypt→push」發布儀式完全沒出現在 trigram/bigram（每次都是一個大複合命令，tokenizer 只取首 token）；若複合命令內部的 `&&`/`;` 步驟能拆進 n-gram 流，這類儀式才可被挖掘。兩者都不影響現有計數正確性，是召回率問題。
- **Effort**: S（friction 過濾）＋ S–M（複合命令拆解，注意別把 heredoc 內容誤拆）
- **Source**: 2026-07-04 Fable 5 session 首次 /distill 全量掃描實測。


### distill identifier lint 開放給外部 skill pack 使用（單獨入口）
- **Trigger**: 下次要**公開分享**任何手寫個人 skill pack（如 `~/projects/skills/`）之前；OR next time touching distill 的 lint 程式碼。
- **Context**: distill 的 identifier lint（email/IPv4/`/home/<user>/`/FQDN/key-shapes ＋ `~/.autopilot/distill/identifiers.deny`）目前只在 distill 流程內部可用。手寫的個人 pack（本次的 teaching-materials 等五個 skill 走 self-use 豁免，含使用者自己的路徑/帳號）在公開分享前需要同一道 lint，但沒有獨立入口可呼叫。建議：把 lint 抽成可獨立執行的入口（`--path <dir>` 掃任意 skill 目錄），distill 內部改為呼叫同一入口 —— 一份實作兩處使用。
- **Effort**: S
- **Source**: 2026-07-04 Fable 5 session；`~/projects/skills/` pack 建立時的自用豁免決定。

### Reviewer transport exits can erase an otherwise valid fail-closed verdict
- **Trigger**: Grok／GLM／Kimi／Qwen／Codex reviewer transport 再出現「內容可解析、process exit 或 framing 使 verdict 遺失」。
- **Context**: 為仍支援的 runner 建 exact residual fixtures；保留 process truth，但將已驗證的 verdict bytes 與 transport failure 分欄，禁止把 no-verdict 誤報成 review pass。
- **Effort**: M。
- **Source**: historical multi-runner incidents；2026-07-31 hygiene rewrite。

### `dispatch-review.sh` echo-hardening — derived/transformed delimiter (max-security variant)
- **Trigger**: next time the nonce wrapped-block protocol is revisited, OR if an engine is observed echoing the whole prompt INCLUDING the nonce markers AND starting its output with the marker (defeating the prefix check).
- **Context**: v2.31.3 chose the plain-nonce-as-prefix + reject-guard hybrid (codex's design-debate alternative: give a nonce and require the model to TRANSFORM it into the accepted delimiter, so a pure prompt-echo can't reproduce the derived marker). The transform variant is max-security but risks FALSE-NEGATIVES on weaker engines that flub the transform (a correct review lost to a parse miss) — deferred pending a per-engine transform-reliability spike. Only adopt if the spike shows the target engines compute the transform reliably.
- **Effort**: Fix (spike-gated)
- **Source**: 2026-07-03 cross-family design debate (codex gpt-5.5 vs grok), v2.31.3.



### Per-event opt-in hook multiplexer (perf) — avoid spawning gated-off opt-in hooks on every tool call
- **Trigger**: tool-call latency telemetry shows the gated-off opt-in hooks' `node` startup is material (heavy-session cumulative), OR next time touching hook wiring perf.
- **Context**: v2.26.2 wires all 12 opt-in hooks in `hooks.json`, so each spawns `node` (then gate-exits ~immediately) on every matching tool call for ALL users even when disabled — in line with existing default-on hooks but additive (5 PreToolUse + 4 Stop + 3 PostToolUse). The only update-stable wiring is `hooks.json` (token must resolve), so the spawn is unavoidable without a single per-event multiplexer hook that reads the manifest + config once and dispatches only the enabled opt-in hooks.
- **Effort**: L
- **Source**: v2.26.2 design tradeoff (accepted, gpt-5.5 spec-reviewed).

### Domain-aware routing — consume the `work_domain` telemetry to route reviewer/implementer by diff domain
- **Trigger**: ALL of these prerequisites are met (telemetry alone is NOT a trigger — the v2.25.x measurement layer ships first, on purpose): (1) `/l5` honors `reviewer_runner` via `dispatch-review.sh` so a non-`codex` (e.g. `gemini-flash`) reviewer can actually be dispatched — today `/l5` hardcodes `codex exec`; (2) a **two-pass resolve** in `resolve-review-loop.sh` (resolve once to learn the domain, then re-resolve the roster conditioned on it) without breaking the single-shot JSON contract; (3) a **pre-impl planned-scope signal** for *implementer* routing — a post-impl diff-probe can't choose the implementer before the work exists (R2); (4) **per-project per-domain calibration with n≥30** real samples (current evidence is one `llm-playground` exam, n=15 backend-cli — far too thin to crown a per-domain engine); (5) an **inner-reviewer-family field** distinct from the panel-only `cross_family_*` semantics (those gate the depth-0 qc_panel vs the implementer, NOT the inner per-round reviewer's family).
- **Context**: 2026-06-26 dogfood found best-model is **domain-dependent** (`gemini-3.5-flash` leads Rust 54% of that exam; `opus-4.8` matches-or-leads backend-cli, autopilot's own shape) — but the evidence is thin and the routing target (`gemini` reviewer) isn't plumbed. The 5-round gpt-5.5 loop converged the whole plan to **measure-now-route-later**: ship `probe-diff-domain.sh` + the resolver's `work_domain`/`domain_source` telemetry keys + the `/l5` ledger column (done), defer ALL routing here. `qc_panel`/`cross_family_*`/`--enforce` stay untouched by domain. Plan: [`docs/plans/2026-06-26-domain-aware-roster.md`](plans/2026-06-26-domain-aware-roster.md).
- **Effort**: L (each prerequisite is its own sub-task; (1) alone is S–M).
- **Source**: 2026-06-26 domain-telemetry ship (Phase 4); the deferred KR4 of the plan.

### agy reviewer/author hard isolation
- **Status**: SHIPPED — backlog-convergence Track 2；bwrap filesystem/process isolation is fail-closed。
- **Trigger**: 現在；在下一次 agy reviewer／verification-author production dispatch 前完成 probe 與接線。
- **Context**: 合併原 reviewer sandbox、OS-sandboxed hetero reviewer，以及 verification-author no-repo-mutation 缺口。先實測 agy `--sandbox` 的 filesystem/process 邊界，再 wire reviewer + author rails；Codex/bwrap 可作獨立對照。L1 override 是否解鎖仍是後續獨立裁決。
- **Effort**: M。
- **Source**: v2.25.9 residual + 2026-07-08 campaign deviation + 2026-07-31 live capability audit。

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
- **Trigger**: next time `scripts/sync-agent-bodies.sh` is touched, OR an OpenCode agent reports a dangling `code-review.md` link
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
- **Trigger**: After precursor (1) is in use and a strength-scoring instrument can be calibrated, or next time changing `resolve-review-loop.sh` density/risk inputs.
- **Context**: The `t2×medium` escape cliff showed that verification quality is invisible to review routing; the remaining work is the calibrated scorer (2), then its fail-safe routing input (3).
- **Effort**: L for precursor (2), then M for precursor (3).
- **Source**: `docs/plans/2026-07-08-observation-first-skills.md` § Non-goals / Scope C.

Full design: [`docs/plans/2026-07-09-verify-strength-precursors.md`](plans/2026-07-09-verify-strength-precursors.md). Evidence: the escape cliff where `t2×medium` verification produced 100% escapes — verification QUALITY is invisible to `resolve-review-loop.sh` routing.

- **✅ Precursor (1) — red-green validation instrument** — DELIVERED 2026-07-09 (v2.32.11): `scripts/verify-red-green.sh` proves a change's tests are RED at base+tests / GREEN at head (else they don't exercise the change). Isolated detached worktrees; verdict from real exit codes. This is the BACKLOG's named minimal precursor.
- **🔜 (2) — real test-suite "verification strength" scorer** — a graded (`weak|medium|strong`) score for an ACTUAL project's suite guarding a change (NOT the pipeline-bench synthetic fixtures). Candidate signals: per-test red-green (precursor 1), mutation-survival / assertion density on the diff, changed-line coverage, oracle presence. Needs its own calibration corpus tying scores to real escape outcomes. **Depends on (1).** Effort L.
- **🔜 (3) — `resolve-review-loop.sh` consumes `verify_strength`** — fold the (2) score into the existing risk/density machinery (weak suite ⇒ more review depth; strong ⇒ less). Must be additive (byte-identical prefix + appended keys, like `--domain`/`min_panel_size`) and fail-safe (unknown ⇒ weakest ⇒ most review). **Depends on (2)** + the trust-tiered-review policy. Effort M.
### M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
- **Trigger**: 下次把 `evals/orchestration/tasks/t15-cache-invalidation`、`t16-findings-triage`、`t17-purity-invariant` 用於對抗性 implementer 情境（`/l5`、`/l6` hetero 派遣、或任何候選碼不可信的場合）。
- **Context**: 這三個 oracle 的判分 python 與候選碼在**同一個 process** 內執行，候選模組 import 時可用 `sys._getframe()` 走訪呼叫端 frame 的 globals/locals，撈出判分器從未匯出的密鑰。opus 2026-07-09 對抗性重攻實測兩條可靠（5/5 PASS）exploit：N2（t15）——撈出真 `NONCE` 偽造 token 且從不呼叫注入的 `compute_fn`，fidelity 與 cache 軸皆假過；N2'（t17）——重同步 purity 檢查區塊的 `snapshot` 局部變數，一邊 mutate 一邊讓 `snapshot == recs` 恆真。R2 硬化（4 條 planted-file/env/stdout 攻擊）已修好且仍成立，但這條 in-process introspection 類別是**架構性**盲點，不是 R2 修復範圍。真正封死需要候選函式呼叫跑在與判分器分離的 subprocess/interpreter（process isolation），對映 `check-test-integrity.sh` L1 block-mode 在 CLAUDE.md 已記錄的同一結論（no local-only same-process mechanism 對抗同帳號候選碼是防偽的）。
- **Effort**: L（redesign，非修補）。
- **Source**: opus 對抗性重攻，2026-07-09。`docs/projects/_archive/2026-07-09-m3-band-tasks/report.md` § "Residual: in-process introspection"。

### Review-response leakage false reject + RED/green polarity tripwire
- **Trigger**: 下次修改 `dispatch-author.sh`／`dispatch-review.sh`，或再次使用預授權 polarity flip 的 verification-author workflow。
- **Context**: 保留兩個未閉環缺口：(1) 格式正確的 VERDICT/FINDINGS 不應被 prompt-leakage detector 誤拒；(2) buggy-behavior assertion 在 ship 前必須有機械 marker 證明已翻成正極性。agy author isolation 已合併到「agy reviewer/author hard isolation」。
- **Effort**: S + S。
- **Source**: 2026-07-08 l6-resilience deviations ledger。

### First local runner capability semantics（availability/load，不是 quota）
- **Trigger**: 第一個 local runner（例如 ollama 類）接入 capability-state producer。
- **Context**: named endpoint identity 已實作；剩餘設計只針對 local source class，需以 availability/load shape 表達，不能套用 metered quota enum。
- **Effort**: S。
- **Source**: 2026-07-14 status CLI design + 2026-07-31 code audit。

### Codex 0.146 native `spawn_agent` schema/docs reconciliation
- **Status**: SHIPPED — backlog-convergence Track 2；0.146 schema and lifecycle evidence recorded。
- **Trigger**: 現在；完成 fresh minimal spawn probe 後修正兩份仍描述 0.144 鎖欄位的文件。
- **Context**: 0.144 時代的兩行 opt-in 說明已過時；重驗 default schema、agent TOML inheritance 與 child model identity，再同步 canonical/Codex docs。不要在 probe 完成前宣稱所有 routing 問題都已解。
- **Effort**: S。
- **Source**: 2026-07-31 local Codex 0.146 schema audit。

### identity rail on dispatch-author non-strict path（2026-07-17, 低優先）
- **Status**: SHIPPED — backlog-convergence Track 2；non-strict Git root resolution activates identity containment。
- **Trigger**: Before the next non-strict explicit-CLI author dispatch that relies on identity containment, or next touch of `scripts/dispatch-author.sh` identity setup.
- **Context**: `REPO_ROOT` is populated only for strict contract/roster paths, so the non-strict explicit author path silently skips the identity snapshot/restore rail; fall back to `git rev-parse --show-toplevel` without changing the read-only author threat model.
- **Effort**: S。
- **Source**: 2026-07-17 MiniMax aggregate review of the identity-containment port。
- **Evidence note**: detach path 已查核為正確（IDENTITY_REPO_ROOT 在 dispatch_detached_run 的 declare -p 序列化
  列表、snapshot 在 detach fork 前的 parent main flow、值傳入 child）——碼序＋序列化＋對抗實證
  三證，但尚無端到端 detach drift 實測（目前無呼叫者傳 ledger coords，低風險）。

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

### agy generic model alias normalization（`gemini-flash`）
- **Status**: SHIPPED — backlog-convergence Track 2；generic alias resolves against current canonical model inventory before spend。
- **Trigger**: 下一次 agy QC／author roster resolution 前。
- **Context**: agy 1.1.8 `models` 已列 canonical slugs；真正缺口是 autopilot 的 generic alias（如 `gemini-flash`）到當前 slug 的 normalization 與 live probe，不應硬寫 UI display string。
- **Effort**: S。
- **Source**: 2026-07-17 incident + 2026-07-31 live CLI audit。

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
- **Status**: OPEN — retained post-merge follow-up; no active implementation worktree。
- **Trigger**: Before these helpers are reused outside the current production Engine call sites or exposed to caller-supplied state/evidence.
- **Context**: Close the helper-level fail-open edges recorded as CED-N01, CED-N02, CED-N03, CED-N05, and CED-N06: require explicit spend projection, preserve/reject empty controller replacement, require repository authority, reject traversal internally, and make test evidence carry production-equivalent binding.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d1e3cafc6b25e4ccde534f237ecac97b66953f2c76b2d56df8a77993b916fd69 -->
### Boundary outcome and root dispatch semantics
- **Status**: OPEN — retained post-merge follow-up; no active implementation worktree。
- **Trigger**: Before boundary receipts drive automated recovery or parallel independent graph nodes under one root are enabled.
- **Context**: Derive or remove mutation_failed/unknown_status instead of hardcoding them, and decide whether root-wide nonterminal exclusion is intentional; if not, retain root CAS while scoping dispatch blockers to the exact graph node.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:ecc22ecefe311bf8a185548841308087b4c6c96cf2b73b3ca14471c005ba7bc5 -->
### Portable byte and Work Order lifecycle hardening
- **Status**: OPEN — retained post-merge follow-up; no active implementation worktree。
- **Trigger**: Before Mission paths may contain symlinks, generic Work Order imports are accepted, or reconciliation runs on restricted process-table platforms.
- **Context**: Unify symlink byte hashing with Git, reject/strip disposition_receipt on non-stale records, and convert PROCESS_TABLE_UNREADABLE into an explicit fail-closed Work Order classification.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d1d21b3988f6e89eff3964a1e5e56f12171fd4d3cf50b23634364d087380df26 -->
### Durable resume and review authority binding
- **Status**: OPEN — retained post-merge follow-up; no active implementation worktree。
- **Trigger**: Before automatic durable resume, reviewer roster rotation, seat retry, or more than one candidate per repair generation is enabled.
- **Context**: Make all durable stop payloads pass verbatim resume validation, bind full-diff barriers to the exact candidate and review kind, and include sealed reviewer roster/seat identities in full-diff and joint-review reuse keys.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:aed0cfc35dd07b4cabf1545ca4bdba4d0a308824eaa3b1631f3f6d9c9ce11811 -->
### Explicit findings identity authority
- **Status**: OPEN — retained post-merge follow-up; no active implementation worktree。
- **Trigger**: Before classifyMissingDisposition is reused or exported to any caller that may omit identity validation.
- **Context**: Remove the fail-open findingsIdentityOk default and require every classifyMissingDisposition call to pass an explicit identity verdict.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:42b943b1cd29c7de6d0b621337c605400ea73e33b531b47ee7d7b2dd04ccfc9f -->
### Mission graph and campaign capacity boundary hardening
- **Status**: OPEN — retained post-merge follow-up; no active implementation worktree。
- **Trigger**: Before graph hot reload/concurrent writers or caller-supplied non-default campaign capacities are supported.
- **Context**: Read Mission graph bytes once or bind the validation read to the inspected digest, and mirror max_owned_worktrees/temp_capacity_limit/max_prompt_bytes/max_finding_recurrence schema caps in the executable validator.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d574960cb87250d45554901630cdff86ddfd59f5d313a40e657bf7de3f7b7be3 -->
### Orphan leaf liveness and resource reconstruction
- **Status**: OPEN — retained post-merge follow-up; no active implementation worktree。
- **Trigger**: Before orphan adoption or resource inventory is used as closure/capacity authority after controller or worktree-creation crashes.
- **Context**: Persist and re-observe leaf process identity before orphan adoption; discover orphan branches and never-registered worktrees; mechanically re-derive active inventory rows.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:516726d963e606a0bf2ec621ad6962a0228863ff976a64a703be7bbd2d4a598d -->
### Terminal status and receipt trust boundary
- **Status**: OPEN — retained post-merge follow-up; no active implementation worktree。
- **Trigger**: Before external/legacy terminal receipts cross a trust boundary or the threat model expands beyond confused controllers.
- **Context**: Enforce the closed terminal_status enum at receipt validation and Work Order classification, resolve the unused attached disposition, and document integrity-hash versus producer-attestation guarantees under the confused-controller threat model.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

### Legacy ready Mission terminals lack exact controller Work Orders
- **Status**: SHIPPED — backlog-convergence Track 1；read-only reconciliation retires validated foreign-graph history without synthetic Work Orders。
- **Trigger**: Before the next production `mission-routing-admission` use in this repository, or any attempt to migrate, reuse, or retire the legacy B/C terminal state.
- **Context**: `node scripts/mission-routing-admission.js --repo-root . --level l3` exits 2 because the canonical ready, possibly-effectful B/C journals bind ICC roots `campaign-v1-80c477b59fa440d324cc2b98032e101a9a630cc6c5c60057a062e7c1393f3e50` and `campaign-v1-28cf3f20d7676a2a9dad182a8c28c3b52f92e720fada00bf35038bcf6e090773`, but `.git/autopilot/work-orders/` has no exact controller Work Order for either root. Add an authority-preserving migration/reconciliation disposition that validates canonical state, journal, and accepted Git history, then explicitly binds or retires the legacy terminals without replay; never synthesize/backdate Work Orders, mutate existing receipts, or relabel ready history.
- **Effort**: M。
- **Source**: B/C merge `9f26e082`; canonical claims `claim-v1-e77cd11c6474fe45a5917965818e27d53bf38be5bfcd48987d5abd2712a3e232` and `claim-v1-5722fe1082e7bedb1ce459f4ac1863d888f4aafcfa230a69a0eb1ebc3682fd01`; 2026-08-01 production admission reproduction。

### Dispatch/session tests inherit production Mission authority state
- **Status**: SHIPPED — backlog-convergence Track 1；explicit hermetic authority-store injection prevents production-state inheritance。
- **Trigger**: Before requiring a green full suite while this repository has an active/terminal Mission registry, or the next change to dispatch/session-mode test setup.
- **Context**: Six tests launch dispatch or session flows against the real repo and inherit `.git/autopilot` durable evidence: `context-window`, `dispatch-author-claude-native`, `dispatch-author-session-mode`, `mission-routing-admission`, `session-mode`, and `status-finish-followup`. The legacy ready terminals then fail admission for missing exact controller Work Orders before the fixture's intended assertion. At HEAD `3c54031c`, the first two pass 52/52 and 7/7 in a clean shared clone, proving checkout-local authority-state coupling. Make non-Mission tests use an isolated Git common dir/authority store; make Mission tests seed the exact state they assert. Never delete or bypass production evidence to make tests green.
- **Effort**: M.
- **Source**: 2026-08-01 full-suite Summary (7/259 files failed), solo reproduction, and clean-clone controls; sibling timing-only failure remains tracked separately under `dispatch-output-quiescence`.

<!-- autopilot-follow-up:8f70c159902a5d75d701b775ac9378f53ec4e9380a2534cab6674bf06083d475 -->
### Shared sealed zero-diff validator
- **Status**: DEFERRED — P3；schema/fourth-consumer trigger not met。
- **Trigger**: When the zero-diff schema next changes or a fourth production consumer is introduced.
- **Context**: Move sealed zero-diff receipt validation into one deterministic shared helper consumed by shell, Engine, and runner boundaries.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b
