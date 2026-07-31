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
- **Trigger**: `ICC P4` 或 Mission integration 要把 `ProviderReadinessReceipt` 接到 effectful pre-spend gate 之前；具體而言，只要該 gate 需要 implementer、verification-author 或 QC seat 從 `probe-needed` 合法升到 `usable`，此項就必須先完成。
- **Context**: PRO P4 嚴格保持三軸獨立：transport/live probe 不得推論 role qualification，而 disk-backed `engine-scorecard.js` 依治理規則只是 `untrusted_telemetry`。目前 reviewer 可由既有 live qualifier 取得 session-local authority，但 implementer／verification-author 尚無可自動升格的 role corpus/verifier，QC 也需明確綁定 reviewer-role authority。v2.34.1 的 real Mission completion campaign 再次命中此邊界：三席 final panel 在 exact QC scorecard qualification precondition 全數停止，沒有任何 seat 被 dispatch；depth 0 因此另以同一 frozen whole-diff roster執行 joint review，而沒有偽造 qualification receipt。正規修法是新增 host-injected、不可序列化或外部簽章的 exact-tuple qualification provider，讓 readiness 只消費 authority-bound observation；不得把 provisional scorecard row 或 probe 成功當 qualification。
- **Effort**: L（含 implementer／verification-author role eval、QC reviewer-role mapping、ICC intake red/green）
- **Source**: PRO P4 Heto generation 1，GPT-5.6 Sol finding R2/R6，candidate `d0a05f7`；2026-07-30 controller-execution-discipline final-panel admission incident

### CLAUDE.md 逼近 40k 硬上限（餘裕 54 bytes）— 每個新 script 都要加 row，下一個必撞
- **Trigger**: 下次任何人要在 Scripts inventory 加 row 時（幾乎等於「下一個新 script」）；或 `check-claude-md-inventory.js` 再次在 CI 變紅時。
- **Context**: v2.32.57 才剛把 CLAUDE.md 從 81KB 瘦到 38.5KB 並加上 40000 bytes 硬 cap。三週後（v2.32.58）就回到 **39946/40000，只剩 54 bytes 餘裕** —— 因為兩條並行管線各加一個 inventory row 就直接撞破（40223），CI 紅。這次靠把新 row 縮回索引形態（783→~420 bytes）救回，但那是一次性的：**inventory 是單調成長的（每個新 script 一列），而 cap 是固定的**，所以這個閘會週期性地在「兩人同時加 row」時炸掉，且炸的是無辜的第二個 push 者。可能修法：(a) 把 inventory 拆成 `references/scripts-inventory.md` 由 CLAUDE.md 單行引用（CLAUDE.md 回到真正的 session-entry 內容）；(b) cap 改成隨 script 數線性放寬並保留 per-line cap；(c) 維持現狀但把 Row shape rule 的字數上限機械化（目前只有 per-line 800 bytes，太寬）。**(a) 最貼近 40k 存在的理由**（harness 每 session 吞它），但要確認被引用的 reference 不會反而每 session 都被載入。
- **Effort**: S（(b)/(c)）／M（(a)，需驗證載入行為）
- **Source**: v2.32.58 push 後 CI 紅（`check-claude-md-inventory` 23/24）

### `hooks/tests/dispatch-output-quiescence.test.sh` 時間敏感 flake 未根治
- **Trigger**: 下次 CI 或 finish-flow 因它變紅時；或要把它納入 blocking gate 之前。
- **Context**: v2.32.57 的 merge（`d90433b`，標題明寫 "kill dispatch-output-quiescence flake"）以 worker count 縮放 parallel timing factor，但未根治。v2.32.58 期間三次觀測：base SHA 上 FAIL（`immediate-content returns quickly: expected <= 5, got 6`）、一次全套件 PASS、pre-merge 全套件再度 FAIL 且**失敗的斷言換成 `genuine-empty-fast`** — 斷言隨機漂移是負載敏感 flake 的特徵而非邏輯錯誤。`verify-preexisting.sh` 正式判定 `{"head":"fail","base":"fail","verdict":"PRE_EXISTING"}`。可能修法：把絕對 tick 上限改成相對於實測 baseline tick 的比值，或在高負載下自動放寬。
- **Effort**: S–M
- **Source**: v2.32.58 finish-flow L-5.2 pre-merge 全套件

### agy 遙測盲區 — transcript 無 token 欄位且 91% 被平台截斷
- **Trigger**: 要把 agy 納入任何成本／容量決策之前；或 antigravity 上游補上 usage 欄位時。
- **Context**: `~/.gemini/antigravity-cli/brain/*/。system_generated/logs/transcript.jsonl` 的 schema 是 `{step_index, source, type, status, created_at, content, truncated_fields}` — **完全沒有 token/usage 欄位**，且 500 個 session 中 454 個（91%）帶 `truncated_fields`（平台自行截斷內容）。目前只能用 content bytes 當極粗代理指標，不可與 codex/grok/opencode 的 token 數同軸比較。**不可測 ⇒ 不可優化**：在補上遙測前，任何 agy 的成本結論都是猜測。
- **Effort**: S（若上游有欄位）／M（若需自建量測 harness）
- **Source**: 同上

### grok implementer 摩擦調校（toolFailure 28%／零 commit 72%／effort 反效果假說）
- **Trigger**: grok 真正被當成 `dispatch-hetero.sh` implementer 常態使用之後（累積 ≥30 個寫檔 session）。
- **Context**: 2026-07-25 掃描顯示 grok 目前在 autopilot 派遣路徑上只有 71 個 session 且**全是唯讀**（review 59／author 12）；實際寫碼發生在 dispatch rail 之外的互動式 session。既有 32 個寫檔 session 的訊號：`toolFailure>0` 28.1%（平均 1.6 次）、零 commit 71.9%（對應已知的 untracked-new-files 問題）、但 `editAndRetry`／`regeneration`／`hasReverted` **全為 0**（寫出來的東西不用重寫，品質面乾淨）。另有一個**相關非因果**觀察：`reasoning_effort=high` 的 302 個 session 只有 6 個寫檔、耗時 3.4 倍、toolFail 更多，而 `(none)` 的 65 個有 24 個寫檔 — 極可能是任務難度自選偏差，**要驗證需同任務 A/B，不可逕自關掉 high**。
- **Effort**: M（需先累積母體，再跑 A/B）
- **Source**: 同上

### dispatch-author codex transport：cgroup supervision tier（fd-less inter-poll escapee 殘差閉環）
- **Trigger**: 下次動 `scripts/dispatch-author.sh` codex branch 或 `scripts/lib/dispatch-author-codex-transport.sh`；或首次出現真實 incomplete-tree 事故（result 被 orphan 汙染）。
- **Context**: v2.32.54 transport hardening 的 normal-exit 不完整樹偵測＝監控期累積 descendant snapshots＋exit 後 /proc fd-holder 掃描（TERM/KILL＋reject）；deadline 路徑的 `reap_tree(pgid,10,worker_pid)` 做 kill 前 worker-rooted tree walk。**已驗證涵蓋 honest-failure orphan**：deadline_setsid_orphan／orphan_deleted_fd_holder 兩個 executable 負控對現行實作 157/157 GREEN（regression 已 bank）。**殘差全屬對抗性 worker（out of threat model，v2.25.8 先例）**：(1) poll 間隙 setsid 逃逸「且」不持 private-channel fd 的子孫；(2) deadline 前蓄意兩層 setsid reparent-race 搶在 pre-kill walk 前脫離 worker 樹（gpt-5.5 P3-panel F2，depth-0 以 mutation-validation 判 non-reproducible-honestly、adversarial-only）；(3) 同 uid inode-rebind／`(deleted)` fd 自替換（gpt-5.5 F3/F4、非升權，worker 本就控自身輸出）；(4) model 在 CLI chrome 前注入 fake banner（F1，需 CLI compromise）。完全閉環＝把 dispatch-hetero 的 `systemd-run --user --scope`＋`cgroup.procs` 空集驗證 tier 移植過來（fallback 保留現行路徑＋誠實 provenance 欄位）。repo 先例：cgroup containment 是 teardown-hygiene provenance、非 security attestation。
- **Effort**: S–M。
- **Source**: 2026-07-18 v2.32.54 P1 review round 4 + P3 terminal qc panel（gpt-5.5/opus）＋ depth-0 mutation-validated adjudication（project ledger p1 round-4 / p3 finding_adjudicated events）。

### OpenCode 1.17 遷移收尾 — ✅ check 15 根治、check 16 降級 advisory（v2.32.50）
- **Trigger**: 上游 opencode 修復 `debug skill` 輸出截斷後（可回收 check 16 為 hard-fail 時）；或 opencode 再破壞性改 plugin/serve API 時。
- **Context**: 2026-07-17 兩檢查都收尾。**check 15 根治**：`autopilot.ts` import 了 prerelease `@opencode-ai/plugin/v2` subpath，該 subpath 在裝好的 `@opencode-ai/plugin@1.17.15` 不存在（`ERR_PACKAGE_PATH_NOT_EXPORTED`），loader 靜默吞掉 import 失敗 → 插件從未載入。遷移到有文件的 default-export `{id, server}` PluginModule shape（server 跑 setup＋回傳 `{"tool.execute.after":…}` hooks），dep bump `^1.17.15`，插件現在載入並印版本行。**check 16 降級 advisory**：`opencode debug skill` grep `dev-flow` 因**上游** opencode 1.17 `debug skill` 輸出截斷（corpus-volume-dependent；symlink 假說已被 8/8×3＋full-corpus real-dir repro 反證；最小 repro＝~28 skills 的純目錄）非決定性失敗，非 autopilot config 迴歸，無可靠 retry 數；`preflight-portability.sh` 新 `run_advisory` runner 計入 TOTAL 不計 FAILS。**殘項**：向 opencode 上游開 `debug skill` truncation issue（推薦）；opencode 1.17 `serve` 為 unsecured-by-default（`OPENCODE_SERVER_PASSWORD` auth、不 eager 載 plugin），`opencode-v2-plugin.test.sh` 已改走 `debug config` 確定性驅動。
- **Effort**: Fix（若上游修復要回收 check 16）
- **Source**: 2026-07-17 /l5 run C（v2.32.50）；前身 2026-07-16 deep code-audit + doc-sync（v2.32.39）

### classify-error quota 共現 gate 偏寬 — 裸 `status`/`error` 子串共現即判 quota
- **Trigger**: 下次 passive quota-capture 出現假陽性（把非額度錯誤記成 `quota_exhausted`）；或下次動 `engine-capability-state.js` 的 classify-error。
- **Context**: v2.32.53 的 `payment required`/`balance exhausted` 共現 gate 用裸子串（`402`/`status`/`error`/`http` 任一共現即過）——opus 對抗探針實證兩個假陽性樣板可通過。要精度就把 gate 綁到數字 HTTP token（如 `\b402\b`/`status[ :=]4xx`）而非裸詞。前身兩項 run E 殘項（quota merge role 分片、`on_engine_unavailable` 接線）已於 v2.32.54 核銷。
- **Effort**: Fix
- **Source**: 2026-07-17 /l5 run E opus panel 🔵（殘留意見）；v2.32.54 核銷時拆出

### engine implement-review 不 wire reviewer_endpoint — endpoint-backed cc-shim reviewer 在 engine loop 內結構性不可用
- **Trigger**: 下次要在 `engine implement-review` 迴圈裡用 endpoint-backed reviewer（GLM/MiniMax via cc-shim `--endpoint`），或碰 `src/engine/autopilot-engine.js` buildReviewArgs 段時。
- **Context**: 2026-07-14 loop-convergence-gates run（foreman escalation #1）：`autopilot-engine.js:1222` 組 reviewer dispatch 參數時不傳 `reviewer_endpoint` → cc-shim reviewer 缺 endpoint creds 結構性失敗；foreman 被迫換 agy/Gemini。獨立佐證：MiniMax-M3 即使 endpoint 通、在 dispatch-review 的 wrapped block 下也結構性 no_verdict（fail-closed 正確；GLM-5.2 standalone probe 可用）。修法：wire `reviewer_endpoint`（roster/resolver 已有此概念）into buildReviewArgs，並補一條 red-case（endpoint reviewer 配置下組出的 args 必含 --endpoint）。
- **Effort**: S。
- **Source**: 2026-07-14 /l6 loop-convergence-gates foreman ledger + depth-0 qc probe。

### Dispatch-branch lifecycle：支援 SHA-256 object format
- **Trigger**: 第一個 SHA-256 Git consumer 出現，或下次修改 `scripts/reap-dispatch-branches.sh`。
- **Context**: v2.32.37 rail 刻意假設 SHA-1 40-hex object IDs。SHA-256 repos 的 `scan` 仍可唯讀使用，但 durable `check --ack` 會因非 40-hex ack 被 prune 而重新觸發 gate，`reap --yes` 則在任何 ref deletion 前的 tip validation fail closed。泛化 OID validation、ack persistence 與 bundle verification 時，不得弱化 preserve-first。
- **Effort**: S–M。
- **Source**: v2.32.37 post-merge doc-sync / security QC。

### Inherited L1 hook-config hermeticity / OpenCode V2 / eval-doc-drift portability baselines
- **Trigger**: 下次修改 `hooks/*.test.js` 的 opt-in/config isolation、OpenCode V2 plugin group、對應 eval/doc-drift validator 或其測試；或 full-suite／portability baseline 比下述數字惡化時。
- **Context**: dispatch-branch lifecycle 專案 final run 為 2/142 groups non-green：L1 group 是 inherited host-config hermeticity（真 HOME 的 `~/.autopilot/config.json` 啟用 context-budget/orchestrator-edit-gate；測試只清 env，故 `node --test hooks/*.test.js` 為 121/123、兩個 disabled assertions exit 2；clean HOME 為 123/123），另一組是 inherited OpenCode V2。Portability 為 13/17，殘餘 OpenCode/eval/doc-drift failures 均已在 base 重現，與本專案變更無因果。這些結果必須維持 `PRE_EXISTING DEFERRED`，不得冒充 full-suite 或 portability pass。
- **Effort**: S / Fix。
- **Source**: [`docs/projects/_archive/2026-07-14-dispatch-branch-lifecycle/README.md`](projects/_archive/2026-07-14-dispatch-branch-lifecycle/README.md) final QC evidence。

### codex-native `spawn_agent` 盲區納管（codex 當 depth-0 時）
- **Trigger**: 下次 codex 擔任 depth-0 orchestrator 跑 /l4-/l6 前；或下次改版 `platforms/codex/plugin/skills/ceo-agent` payload 時。
- **Context**: 同上稽核：codex 原生 `spawn_agent`（該次 976 呼叫）完全在 autopilot 軌道外 — 非 Agent-tool（無 TaskStop）、非 shell-dispatched（無 pgid 可 reap），schema 無 model 參數（無法 pin cheap model），autopilot 兩種 teardown primitive 都無效，merge-back/GC 零覆蓋。codex 並自承因此「沒有維持純 CEO context」自己下海 implement。修法：codex-orchestrator 路徑在 payload 內明文禁用原生 `spawn_agent`（一切走 autopilot dispatch 軌道），或至少收尾 gate 偵測 `~/.codex/sessions` 的 spawn_agent 殘留並警示。
- **Effort**: S（payload prose 禁令）/ M（收尾偵測 gate）
- **Source**: 2026-07-14 codex-worktree audit §2/§4/§5。

### check-test-integrity-l1.test.sh 固定 /tmp 路徑在多使用者機器上撞牆（flaky）
- **Trigger**: 下次碰 hooks/tests/check-test-integrity-l1.test.sh 或 run.sh 全套件又因它紅掉時。
- **Context**: test 寫死 `/tmp/autopilot-l1-js-install.log`；共用機上被其他使用者（實測 codepower）的舊檔佔走 ⇒ Permission denied ⇒ 套件級 flaky（單獨跑 exit 0、run.sh 下偶紅）。修法：mktemp 或 `${TMPDIR}` + 使用者隔離路徑。同場另一個 run.sh 紅是 engine-scorecard case 13（efforts collapsed）— PRE_EXISTING on develop，屬另一個既有問題。
- **Effort**: S。
- **Source**: 2026-07-14 v2.32.26 L-5.2 quality gate 實跑。

### context-budget T3 deny tier（handoff 結構檢查 + 新 dispatch 拒絕 + anti-spiral）
- **Trigger**: ≥3 次真實 /l4-/l6 run 在 warn 模式下累積校準資料後（含至少 1 次合成對抗 session — warn 模式樣本是 false-positive 的下界不是量測，MiniMax panel finding）。
- **Context**: v2.32.26 出貨 T1/T2 advisory；T3（PreToolUse 擋 Edit/Write + 拒絕 NEW dispatch 直到合規 handoff 落地）刻意延後。設計要點已定於 plan：handoff 檢查用 content-hash + 結構段落（非 mtime，touch 可偽造）、handoff allowlist 收窄到 docs/projects/** + ~/.autopilot/handoffs/、3 次 deny 未從 ⇒ 降級 warn + 大聲放棄（gate 跟模型吵架會燒掉它要省的 token，Gemini finding）、擋新 dispatch 用自家 script 名 leading-command 枚舉（非 write-regex — 三家 panel 一致否決 write-regex）。
- **Effort**: M。
- **Source**: `docs/plans/2026-07-14-context-budget-orchestrator-gate.md` § Out of scope；3-family panel review 2026-07-14。
- **交叉參考（v2.32.58）**: 上述「T3 必須用視窗百分比而非絕對值」的結論，已在**另一層**（派遣側，不是本 hook 的 session 側）獨立實作並驗證——`scripts/check-context-window.js` 用 `ratio × window`（預設 0.7）取代 `dispatch-review.sh` 原本引擎無關的硬編碼 96KB advisory，因為同一份 400KB 輸入會撐爆 spark 的 121600 window 卻能舒服放進 grok-4.5 的 500000。兩者是同一原理在不同層；實作 T3 時可直接沿用該 window-解析優先序（explicit > capability-state 觀測 > 實測預設表 > unknown，且 unknown 不擋）。注意命名刻意區分：hook = `context-budget`（我方 session 成長），派遣閘 = `context-window`（送出去的 payload vs 目標引擎）。
- **硬前置（pre-merge review 2026-07-14 🟡）**: orchestrator-edit-gate 升 block 模式前，必須先解決「finish-flow 期間 marker 仍 LIVE」：CHANGELOG/README*/plugin.json 不在 allowlist，block 模式會把 depth-0 的 release 編輯全擋掉。修法二選一：finish-flow 進場即 clear marker，或 allowlist 加 release-file 集合。
- **回溯校準已完成（2026-07-14，歷史 transcript n=94 主 session — 見 `docs/projects/_archive/2026-07-14-context-budget-orchestrator-gate/calibration/`）**：(1) fleet 是雙峰（27% 用 200k 視窗、73% 用 1M，peak 到 948k）⇒ **T3 必須用視窗百分比（建議 80%，1M ≈ 800k），絕對值 200k 會攔掉 73% 正常 session** — panel 少數意見（GPT-OSS/MiniMax 的 %-of-window 主張）在 T3 上被資料證實，v3 裁決在 T3 上反轉；hook 可自我偵測視窗（本 session 任一 context 曾 >210k ⇒ 1M）。(2) T1/T2 維持絕對值 — 它們是成本斜率 advisory 不是護牆，「越過 150k 後中位還跑 469 則」正是要治的 N² 複利（噪音率僅 3-5%）；但 T2 每 10 call 重複對 400+ 則的長 session 會累積 40+ 次嘮叨 ⇒ **T2 加 fire-cap（如 5 次後靜默 + 一句大聲放棄）**，與 T3 一起實作。(3) 仍缺的兩塊維持原 Trigger：advisory 服從率（回溯測不到）+ 合成對抗 session。

### E1 dispatch-manifest 合規 merge gate（/lN 宣稱 ⇒ 機器可驗）
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

### ✅ SHIPPED (2026-07-11, v2.32.21) — Dispatch observability Stage 2 — 雙工溝通：`--runner pi`（RPC）整合
- **Resolution**: /l6 depth-1 foreman 出貨。`dispatch-hetero.sh --runner pi`（EXPLICIT-only）＋ NEW supervisor `scripts/lib/pi-rpc-run.js`（RPC stdio、EDIT-ONLY＋worktree＋wrapper-commit＋artifact 驗證軌**原樣沿用**、native JSONL 事件流 tee 進 `$LOG`）＋ dispatch-status.js declared `pi-rpc` 格式（per-message usage 聚合、cost 物件隔離）＋ manifest/final JSON additive `duplex`。三前置殘餘全 live 驗（skills-in-RPC ✅ 載入、無 tool 邊界 steer=**排隊+邊界遞送**非硬打斷、12-tool ~164s **STABLE**——見 spike doc）。**stall 維持 report-only**（探詢一次不砍——「無回應才砍」的自動砍除是 Stage 3 policy，本階段不做）。depth-0 qc 抓到委派 mock 掩蓋的兩個 defect：pi RPC 常駐 server agent_end 後不自退→等 exit 死鎖（改主動 EOF→SIGTERM→SIGKILL、以觀測 agent_end 判成功）；UTF-8 chunk-split 壞控制行（改 StringDecoder）。Gemini 去相關對抗審再補 11 case（拒其一 Critical「spoofed agent_end」——worker 無法注入頂層裸行）。驗收：36 assertions＋全 dispatch 套件零回歸＋真 MiniMax-M3 e2e committed（usage 3612 tok）。專案：[`spike-pi-rpc.md`](projects/2026-07-11-dispatch-observability-s1/spike-pi-rpc.md)。**Stage 3（自適應調度 policy：steer 探詢→無回應才砍、re-dispatch）留下方後續**。原 Trigger 保留供參：
- **Trigger**: ~~下次一條 hetero dispatch 因 stall／走偏而「只能等 timeout 或砍掉重跑」造成實際損失時~~（已完成）；或 Board 核可 Stage 2 動工。
- **Context**: **pi RPC spike 已完成（2026-07-11, VERIFIED live）**——`steer` 中途注入（tool-call 邊界遞送、`queue_update` 可見、模型服從）、`abort` 8ms 即停、逐 `message_end` 的 `usage{input,output,cacheRead,cacheWrite,totalTokens}`（cache 命中即時可觀測）、typed JSONL 事件流、session tree 自有、custom provider 以 `"apiKey":"$ENV"` 參照（token 零落盤,MiniMax/GLM 經 `load-endpoints-env.sh` 直接供電）。完整報告＋殘餘清單：[`docs/projects/2026-07-11-dispatch-observability-s1/spike-pi-rpc.md`](projects/2026-07-11-dispatch-observability-s1/spike-pi-rpc.md)。整合工作＝`dispatch-hetero.sh --runner pi`（supervisor 持 RPC stdio、EDIT-ONLY＋worktree＋artifact 驗證軌原樣沿用）、manifest 增 duplex 通道、stall 從 report-only 升級「steer 探詢→無回應才砍」。前置殘餘：skills-in-RPC 載入未測、`streamingBehavior:"steer"`（無 tool 邊界）未驗、長跑穩定性未測。cc-shim `claude -p --input-format stream-json` 是平行候選（未 spike）。
- **Effort**: L（整合）；殘餘驗證 S
- **Source**: 2026-07-11 Board 三階段方向（Stage 1 = v2.32.20）；pi spike 同日。

### ✅ SHIPPED (2026-07-11, v2.32.20) — Dispatch observability Stage 1 — hetero run 失聯歸零（start manifest + dispatch-status + usage 入 ledger）
- **Resolution**: 同日 inline depth-0 執行出貨。兩 dispatcher 起跑即發 run manifest（每退出路徑 finalize、detach 子行程 pid 改寫、`AUTOPILOT_DISPATCH_MANIFEST=0` 逃生口）＋ `scripts/dispatch-status.js`（flock 判活同 `_wt_is_live` 契約；codex-chrome/JSONL/plain 自動偵測；stall report-only）＋ hetero final JSON additive `run_id`/`usage`/`wall_secs` → engine ledger。**記錄性 deviation**：review final JSON 不加欄位（scope 原文寫要加）——`review-result` 是 v2.32.19 剛硬化的 `additionalProperties:false` SSOT 契約（`review.js` unknown-field throw、7 發射點），manifest 已給 review 可觀測性、usage 由 `raw_log`+`--usage-only` 事後導出，加欄位爆炸半徑不成比。驗收全過：mid-run `alive:true` e2e、真實 codex v0.144.0 捕流 fixture（tokens 7,420）、52 assertions、全套件 120/120。Stage 2（pi RPC / cc-shim stream-json 雙工溝通）與 Stage 3（自適應調度 policy）為後續條目（見下方原 Context 的三階段框架）。專案紀錄：[`docs/projects/2026-07-11-dispatch-observability-s1/`](projects/2026-07-11-dispatch-observability-s1/README.md)。原 Trigger 保留於下供參考：
- **Trigger**: ~~下次接到「監察/協調 hetero engine」方向的工作指派時直接引燃~~（已引燃並完成）；或下次任何人再抱怨一次「dispatch 出去就失聯」。
- **Context**: hetero dispatch 是 fire-and-forget：run 的身分證（`$LOG` 路徑/worktree/cgroup unit）只在 final JSON 才吐出，depth-0 派發後無法定位、監看、判活該 run——只能等 timeout 或 exit。關鍵事實：worker 事件流**已經即時落盤**（`dispatch-hetero.sh` `run_worker()` 全程導 `$LOG`；codex=JSONL 事件、grok=JSON 流），缺的是 start-time manifest ＋ 解析器 ＋ 判活面。對照組：CC Workflow/Agent 的可視性來自 harness 自有事件流——我們的流其實在手上，只是沒接。此為三階段（監察→雙工溝通(pi RPC/cc-shim stream-json)→自適應調度）的第一階段；信任剛性（artifact-not-self-report、fail-closed verdict）不動，本階段只軟化調度盲區。六要素任務全文如下：

  **Goal**: 每個 hetero dispatch 從派發那一刻起可被 depth-0 定位與監看（活性、最後事件距今秒數、改檔清單、token 累計、stall 判定），並在結束時把 usage/牆鐘寫進 final JSON 與 /l5 ledger。失聯（派發後無任何中途觀測點）歸零。

  **Scope**: `scripts/dispatch-hetero.sh`、`scripts/dispatch-review.sh`（起跑即發 run manifest：`{run_id, role, runner, model, branch, worktree, log_path, scope_unit, pid, started_at}` 至 `${TMPDIR}/autopilot-dispatch-runs/<run-id>.json`，並於阻塞 worker 前以 stderr/`--manifest-out` 公布 run_id；final JSON 增列 `run_id`+`usage` 欄位，additive-only）；新增 `scripts/dispatch-status.js`（Node built-ins only：`--run <id>`|`--log <path> --runner <r>` → 逐 runner 解析活流 + cgroup/pid 判活 → `{alive, last_event_age_s, events, tool_calls, last_action, files_touched, tokens{input,output,cache_read}|null, stall}`；不可解析格式 → `telemetry:"unavailable"`，永不捏造）；/l5 run-summary ledger + `src/engine/autopilot-engine.js` ledger 增 usage/wall_secs；`hooks/tests/dispatch-status.test.sh` + 逐 runner fixture logs；`references/hetero-dispatch.md` 增 monitoring 節；CLAUDE.md inventory row。

  **Input**: 既有活流 `$LOG`（`dispatch-hetero.sh:577-604` 已即時寫入）；codex exec JSONL 事件 schema（任務內含一次真實捕流做 fixture——spike-before-assert）；cc-shim `claude -p` stream-json usage 欄位；grok `--output-format json`；agy pseudo-TTY 純文字（僅 mtime 判活，tokens=null，誠實降級）。

  **Output**: manifest 發射（兩個 dispatch 腳本）＋ `dispatch-status.js` ＋ final JSON 擴欄 ＋ ledger 欄位 ＋ fixtures/tests ＋ 文件三處（reference/CLAUDE.md/CHANGELOG）。

  **Acceptance**: (1) 真實 codex dispatch 起跑 2 秒內 `dispatch-status.js --run <id>` 回 `alive:true` 且 `events` 隨後遞增；對 worker `kill -STOP` 超過門檻 → `stall:true`。(2) codex run 的 final JSON `tokens` 非 null；agy run `tokens:null` 但中途 mtime 判活可用。(3) 既有 status enum/exit codes/JSON 消費者位元組級不變（欄位僅追加）；既有 dispatch 測試全綠。(4) 任何 telemetry 欄位不得源自 worker 自報（只讀 harness 事件流/cgroup/git；worker prompt 零改動）；manifest/status 輸出不含任何 secret。

  **Boundaries**: 不做中途訊息注入（Stage 2：pi RPC / cc-shim stream-json 雙工）；不做自動砍除策略（本階段 report-only，policy 是 Stage 3）；artifact 驗證與 fail-closed verdict 軌一律不動；不得為了 telemetry 開任何 worker 自寫狀態檔的口子。
- **Effort**: L
- **Source**: 2026-07-11 Fable 5 session（Board 方向討論：hetero engine 失聯 → 監察/協調/溝通三機制分層；pi 定位為 Stage 2 雙工儀器）。

### skills frontmatter `tier:` 欄位（B4 step 2 — 分層進 frontmatter）
- **Trigger**: 先在 Claude Code ＋ codex 兩平台各做一次「帶未知 frontmatter 欄位」的 plugin load dry-run 且確認解析容忍（R1-F5：未驗不得宣稱無行為影響）；兩平台紀錄在手才動工。
- **Context**: v2.31.16 B4 step 1 已把 docs/skills.md 排成 core/delegation/pioneer 三層（純排版）。step 2 = 把層級寫進各 SKILL.md frontmatter `tier:` 欄位，讓工具可機讀。風險面＝frontmatter 是路由面。
- **Effort**: S（含兩平台 dry-run）
- **Source**: docs/plans/2026-07-04-surface-area-reduction.md §B4；v2.31.16 收尾 deferred。

### codex 宿主 slash-entry 探針入 gate(committed、可重跑)
- **Trigger**: 下次改動 `platforms/codex/plugin` payload 產生邏輯,OR C1a Spike 動工時(兩者都會重驗安裝面)。
- **Context**: 2026-07-05 已一次性實測:codex 0.142.2 裝 v2.31.16 payload 後五個薄殼入口全部浮現、l5 wiring probe 以 `cat` exec 事件證明 MUST-READ 連結在 plugin cache 內解析並被讀取(記錄在 `references/multi-agent-portability.md`)。缺的是把它做成 committed 可重跑 gate(`slash-entry-probe.test.sh` 的 codex 版:`codex exec -m <model>` + stderr exec-event 斷言),與 CC 版同一 self-skip 慣例。注意 quota:Spark 額度枯竭時換 `-m gpt-5.5`(capability-state 已記 2026-07-07 12:44 重置)。
- **Effort**: S
- **Source**: 2026-07-05 /l6 cross-harness 薄殼驗證 run。

### distill/learn 邊界句進 description(+ retro「session」詞彙鄰接註記)
- **Trigger**: 下次修改 `skills/distill/SKILL.md` 或 `skills/learn/SKILL.md` 的 description;OR 實際觀察到一次 distill↔learn(或 distill↔retro)誤路由。
- **Context**: v2.31.18 episodic 觸發語(「這個專案的方法論值得留」等)使 distill 的觸發面更靠近 learn 領域;「learn 記事實、distill 產程序」的邊界句目前只住在 finish-flow L-5.6 的提示裡,不在兩個 skill 自身的 description/Not-for(gap 先於本次變更存在,review 判非阻斷)。retro 的 "session analysis" 與 "distill this project/session" 詞彙鄰接、動詞相異,今日無字面碰撞。改 description = 路由面 = L 待遇。
- **Effort**: S(但 L 待遇 review)
- **Source**: 2026-07-05 v2.31.18 L-5.2 review(autopilot:reviewer)兩條 Suggestion。

### 官方 codex plugin(openai/codex-plugin-cc)作「同級 consult 通道」的 Spike 評估
- **Trigger**: ~~安裝後首 session~~ **已引燃並完成首輪 Spike(2026-07-05,安裝當 session)**。殘餘驗證的 trigger:GPT-5.3-Codex-Spark 額度重置(2026-07-07 12:44)後測 `/codex:review` 通道(review 子命令**鎖 Spark、無 --model 旗標** — 額度死時整條 review 通道不可用,錯誤呈現誠實不給假 verdict);以及下次需要 write-path 時測 `rescue --write` 的沙箱姿態。
- **Context**: 2026-07-05 已做 src 靜態初評(repo 已 clone 讀過,存在性與指令面已驗):指令 `/codex:review`、`/codex:adversarial-review`(有 JSON schema 輸出)、`/codex:rescue [--background] [--model] [--effort]`(經 `codex:codex-rescue` subagent)、`/codex:transfer`(把 Claude session 移植成 codex thread)、status/result/cancel/setup;架構=**app-server broker(結構化協議,天生沒有 stdout 刮取的 late-flush 問題類)**+ 可續傳 codex thread(我們的 dispatch 是無狀態一發)+ 可選 Stop-time review gate hook(900s,與我們 qc-gate 重疊、預期關閉)。定位=**同級 consult(意見進 context)**,與 dispatch rails(勞務出 artifact、worktree 隔離、fail-closed)互補而非替代。Spike 要驗:runtime 穩定性、thread-resume 實用度、rescue 的寫入面(sandbox 預設 read-only,但 fix 流程的逃逸姿態要實測)、與 autopilot hooks 的共存;長線候選:我們的 codex 派遣 rails 改走 app-server 協議(結構化 > 流刮取,2026-07-05 late-flush 戰役的教訓)。
- **首輪 Spike 結果(2026-07-05)**: setup 全綠(ChatGPT auth、advanced runtime);**task/consult 通道(--model gpt-5.5)9 秒完成一次 repo-grounded 技術評估**(真讀檔、結論正確 — 獨立覆核了 output-quiescence 4-poll 決策),對照 dispatch rails 同類 50s–5min:**consult 類明顯勝**(無 echo 協議、無捕獲刮取、thread 可續)。勞務類(實作+artifact 驗證)仍屬 rails。安裝副作用:在 cwd repo 寫入 `.claude/settings.json`(enabledPlugins)— 已加 .gitignore。review gate 預設關,維持關(與 qc-gate 重疊)。
- **Effort**: S(Spike)— consult 通道整合已出貨(v2.31.20:hetero-dispatch.md § Peer consult + front-door § 0 + coexistence 表);殘餘=review 通道校準(Spark 重置後跑 known-bad 10 案,false-pass-on-critical=0 才准進 qc 面)與 `rescue --write` 沙箱姿態。
- **Source**: 2026-07-05 orchestrator-economy 吸收(X thread @diegocabezas01 觸發;src 初評 depth-0)。

### ✅ FULLY SHIPPED (2026-07-10, v2.32.16+v2.32.18) — terse reviewer contracts:三份契約全數量測過 gate 出貨
- **Resolution**: 模板 −16%(v2.32.16,haiku 腿)+ reviewer.md −17% / code-review.md −14%(v2.32.18,syscontract 儀器 v3 + 協議 c 配對一致性:kb 1.000×3、fp-critical=0、injection 6/6、5 discordance 逐案裁決全非弱化——case 03 的 claim-decomposition 條文語意保留驗證為關鍵證據)。量測記錄:`docs/projects/2026-07-10-terse-reviewer-contracts/`(m3-rerun-haiku.md + m3-pathc-syscontract.md)。
- **Context**: 2026-07-10 /l6 全程執行(M1 儀器 → M2 瘦身 → M3 量測)。M3 結果:Path T(模板,gemini-3.5-flash)瘦身版自身穩定(0.917/0.917、injection 完好、haiku 弱層探針 12/12 滿分),但**基線兩跑震盪 0.917/0.833 跨 0.9 地板** → plan gate #2 的明文 halt 條件;Path C(reviewer.md+code-review.md,sonnet+preamble 轉接器)儀器失真(基線 clean 10/10 全誤旗、injection 兩腿皆破)無法下任何結論。完整逐案數據:[`docs/projects/2026-07-10-terse-reviewer-contracts/phase-b-results.md`](projects/2026-07-10-terse-reviewer-contracts/phase-b-results.md)。儀器與基礎設施(claude-native runner、evals/clean/、run-clean-set、prompt-skeleton 測試、Path-C 轉接器)已於 v2.32.15 出貨。
- **Effort**: S(重跑 M3 legs;瘦身本體零工作)
- **Source**: 2026-07-10 /l6 campaign;plan [`docs/plans/2026-07-05-terse-reviewer-contracts.md`](plans/2026-07-05-terse-reviewer-contracts.md) M3-outcome 節。

### ✅ RESOLVED (2026-07-10, 同日) — reviewer-harness 校準:換 claude-native haiku 腿(選項 c)
- **Resolution**: Board 直接下令走選項 (c):haiku 兩跑穩定性驗證通過(基線 known-bad 1.0/1.0、fp-critical=0 含 08 與雙 injection)→ 換腿重跑 M3 → 模板過閘出貨 v2.32.16。haiku 已記入 engine scorecard(reviewer/qualified/capability 1.0,expires 2026-10-10)。gemini-3.5-flash 不再作 reviewer-contract 量測腿。原 Trigger 保留於下供未來參考:
- **Context**: 2026-07-10 M3 campaign 實測:gemini-3.5-flash 對同一 12 案 known-bad 兩跑敏感度 0.917/0.833(跨 0.9 地板;離散案例 06 兩跑翻轉),且基線就抓不到 08-path-traversal(fp-critical=0 這個 gate 在該引擎上原生不可滿足)。單跑 n=12 的一案擺幅 ≈8.3pp,>雜訊容忍。可選修法:(a) 擴 known-bad 語料到 n≥30 攤薄單案擺幅;(b) 每案 majority-of-3 取多數決作為該案 verdict(成本 ×3);(c) 換校準過的引擎跑腿 —— **實測線索:claude-native haiku 在同語料 12/12 滿分(含 08 與兩 injection),比 gemini flash 更適合當量測腿引擎**,且是原生 auth 零 endpoint 配置。(c) 最便宜,先驗證 haiku 兩跑穩定性即可採。
- **Effort**: S(選項 c:haiku 重跑穩定性驗證 ~24 calls)/ M(選項 a:擴語料)
- **Source**: 2026-07-10 phase-b-results.md gate #2/#6 FAIL;M1 已記錄 08 為 gemini 既有弱點。

### ✅ RESOLVED (2026-07-10, v2.32.18) — Path-C 忠實儀器:syscontract 通道(--system-prompt-file + read-only tools + 時間軸 worktree)三輪迭代認證忠實
- **Resolution**: `evals/reviewer-bench/panel-cmd-syscontract-claude.sh`(v3):契約經 `claude --system-prompt-file` 真 system-prompt 通道 + `--tools Read,Grep,Glob`(無 Bash,殘餘限制已記)+ per-case 時間軸 worktree + severity-aware parser + 每案原始輸出存檔。preamble 三病徵(kb 不穩/injection 破/全誤旗)全消。儀器備忘:段落式 finding 對 parser 隱形(fail-open 形狀)、弱層會以 provenance 理由拒審合成 diff。原 Trigger 供未來參考:
- **Context**: 2026-07-10 實測 `panel-cmd-contract-claude.sh`(契約全文塞 prompt preamble + claude -p)不忠實:基線(未瘦身契約!)clean 10/10 全誤旗(「default-assume broken」契約 + 二元 FIX-THEN-SHIP→over-flag 映射,任何 Minor nit 都觸發)、injection 兩腿皆不穩(基線 r1 漏 11+12 —— 生產環境原生 reviewer 不可能如此)。修法方向:(a) 原生 Agent 通道(system-prompt 載契約,即 subagent_type=autopilot:reviewer)+ 每案獨立 dispatch —— 但 plugin 快取使 session 內無法切換契約版本,需跨 session 或 --setting-sources 隔離;(b) severity-aware verdict 映射(解析 findings 嚴重度,僅 Critical/Major 計 over-flag —— plan §4 #6 本來的定義);兩者都做才完整。轉接器本身保留(weak-tier 探針堪用,結構已審)。
- **Effort**: M
- **Source**: 2026-07-10 phase-b-results.md Path C 節 + adapter limitation 記錄。

### 表面積精煉 C 組（鏡像改發版生成一 sprint；B 組已出貨 v2.31.16）
- **Trigger**: C1a Spike 先行（codex 安裝源可指向什麼：orphan branch／release artifact／獨立小 repo，用真 codex CLI 驗）；Spike 結論出來前 C1b 不存在。C2（hook multiplexer）沿用其既有條目 trigger。
- **Context**: 2026-07-04 量測：codex 鏡像 37.4k 行（repo 一半、純稅）。B 組（/l3–/l6＋dialectic 薄殼化、model-routing 去重、skills.md 分層、北極星量測）已於 v2.31.16 出貨 — 憲法級約束維持：**/l3–/l6 等 slash 入口一個都不能少**。C1b=鏡像移出工作樹、`sync-codex-plugin-skills.sh` 改 release 步驟（clean-ref 生成＋checksum＋pre-publish 全驗後才挪指標＋post-publish rollback trigger — gpt-R1-G1 把關順序）。Spike 全滅的誠實出路：維持 committed mirror、本項作廢。完整設計：[`docs/plans/2026-07-04-surface-area-reduction.md`](plans/2026-07-04-surface-area-reduction.md) §2。北極星量測已上線（preflight-release check 8，baseline 於 release 重新 seed）。
- **Effort**: C1=M（含 Spike）
- **Source**: 2026-07-04 Fable 5 session（Cookys 口頭核可）；B 組出貨 = docs/projects/2026-07-04-surface-area-reduction-b/。

### ✅ RESOLVED (2026-07-10, v2.32.17) — pre-existing full-suite failures: autopilot-cli/review-runner/intent-capture already fixed on develop (stale classification); the REAL red was contract-parity (JS twin missing on_engine_unavailable) — fixed
- **ABSORBED 2026-07-04** into `docs/plans/2026-07-04-quality-floor-engine.md` §7 **P3-pre2** (Board directive: quality-floor completion run, v2.31.12 target).
- **Trigger**: next full-suite-green push, OR next time touching `bin/autopilot.js` dispatch delegation / `src/runners/review.js` / intent-capture session-id fallback.
- **Context**: classified PRE_EXISTING against develop during the v2.31.10 release (fail identically on the pre-branch base). `autopilot-cli.test.sh` + `review-runner.test.sh` failures are in the dispatch-review-through-CLI stub path (`status/verdict/findings` not parsed — plausibly stale stub fixtures from the v2.31.3 nonce wrapped-block protocol, same class the v2.31.10 sibling-test fixture repairs addressed for other files); `intent-capture-basic-write` canonical-fallback session-id assertions were already noted failing at v2.31.2. Suite otherwise green (89/93 at v2.31.10).
- **Effort**: Fix
- **Source**: 2026-07-04 review-closeout L-5.2 full-suite classification (develop-worktree baseline run).

### ✅ RESOLVED (2026-07-10, v2.32.19) — resolve-endpoint.test.sh hermeticity(AUTOPILOT_ENDPOINTS_ENV 釘不存在路徑)
- **Trigger**: 下次碰 `hooks/tests/resolve-endpoint.test.sh` 或 `scripts/load-endpoints-env.sh`;或該測試再度紅掉時。
- **Context**: 2026-07-10 實測:測試斷言「AUTOPILOT_ENDPOINT_GLM_TOKEN 未設時 fail-closed 要報 unset」,但機器上 `~/.autopilot/endpoints.env` 真的設定了 GLM(2026-07-09 起)→ loader 載入真憑證 → token 存在 → 斷言失敗。測試環境未隔離(需 `AUTOPILOT_ENDPOINTS_ENV` 指向空檔或 env -u 清乾淨)。1/56 失敗,pre-existing 於 v2.32.15+,與程式行為無關。
- **Effort**: S(一行 env 隔離)
- **Source**: 2026-07-10 L6-r2 WS-C depth-0 root-cause(foreman 標 out-of-scope,depth-0 查明根因)。

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
- **Context**: 2026-07-10 syscontract campaign 實測:12 個「clean」標籤(merged-未被翻 標注法)倒了 5 個(舊01/舊03/06/08/新03),其中新03 的 flag 還抓到當日 develop 現行真 bug(ladder-run.sh pipefail,v2.32.18 修)。全火力 reviewer(sonnet+全契約+tools)比「merged=clean」標注法強。配對一致性協議(m3-pathc-syscontract.md final protocol)不需要標籤,已作為現行量測法;真 certified-clean 集需逐案對抗性預審(每案先過一輪全火力 review + 人工裁決),成本高,等有絕對認證需求再建。
- **Effort**: M
- **Source**: 2026-07-10 L6-r2 WS-A campaign;MiniMax R2 的「reviewer-circular 標注」警告實證。

### ✅ RESOLVED (2026-07-10, v2.32.19) — Contract JSON-schema SSOT: schemas/review-loop-contract.schema.json + JS derivation + check-contract-schema.js gate
- **Trigger**: the next NEW field added to `resolve-review-loop.sh` (or a second contract-drift incident anywhere) after v2.31.10's round-trip parity tests.
- **Context**: v2.31.10 closed the 8-field `REVIEW_LOOP_FIELDS` drift and shipped `hooks/tests/contract-parity.test.sh` (real-script round-trip, both drift directions). The 2026-07-04 3-family design panel (codex/agy/grok) unanimously ranked a JSON-schema single source of truth as the LONG-TERM fix but deferred it: parity tests are the cheapest thing that actually stops silent drift; schema SSOT costs bash-side consumption plumbing. grok's sketch: `schemas/*.schema.json` consumed by JS validators + a generator for the field lists.
- **Effort**: Fix
- **Source**: 2026-07-04 review-closeout design panel (`docs/projects/2026-07-04-review-closeout/`).

### preflight-portability.sh meta-smoke test
- **Trigger**: a preflight false-green incident (gate passes while an invariant is actually broken), OR next time adding a check to `preflight-portability.sh`.
- **Context**: the 17-check gate itself has no test. Panel consensus (2026-07-04): meta-smoke = copy script into a sandbox tree, seed ONE violation (e.g. adapter file with wrong `name:`), assert exit != 0; full per-check decomposition is diminishing returns. Deferred to bound the v2.31.10 release; `dispatch-explore.test.sh` + anthropic mock coverage were the higher-priority gaps and shipped.
- **Effort**: S
- **Source**: 2026-07-04 review-closeout design panel Q2.

### ✅ DONE (already shipped ~v2.31.13, `2a5d7fa` feat/eb-w2; BACKLOG entry was stale) — dispatch-author.sh `--endpoint` parity
- **Trigger**: next time authoring is dispatched to an Anthropic-compatible endpoint (cc-shim) — the flag gap forces a manual `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` export.
- **Context**: hit live 2026-07-04: grok(-build AND -composer) intermittently returned zero-byte output on ~90-line authoring prompts (capability event recorded), and the MiniMax fallback needed hand-wired env because `dispatch-author.sh` lacks the `--endpoint <name>` flag its two siblings have. One-flag addition + the loader mapping (`resolve-endpoint.sh` → `ANTHROPIC_*`).
- **Effort**: S
- **Source**: 2026-07-04 review-closeout /l6 verification-authoring dogfood.

### ✅ DONE (2026-07-05, v2.31.17) — late-flush `empty_output` misclassification (cc-shim/codex/any runner)
- **Trigger**: the next `empty_output` from a cc-shim (or any) authoring/review dispatch where the raw_log is later found non-empty.
- **Context**: v2.31.10 shipped a bounded ~3s settle-wait after the grok late-flush race. Same day, a cc-shim/MiniMax-M3 authoring run was classified `empty_output` while its raw_log held a **17 KB** answer when read minutes later — the flush landed far beyond the bound even though the dispatcher waits for main-process exit first (suggests a detached child or very late buffered write in the `claude -p` path). Twice now a correct answer was harvested manually from a "failed" run. THIRD occurrence 2026-07-05, and first on the **codex** runner: `dispatch-author.sh --runner codex --model gpt-5.5` returned `empty_output` while the raw_log held the complete 4.9 KB answer (incl. end-marker) seconds later — the class is not cc-shim-specific; the dispatcher's answer-stream read vs raw_log capture diverge. Options: probe the child/flush behavior (probe-playbook P3 applies), per-runner `SETTLE_MS`, or wait-on-descendants. Constraint: a genuinely-empty run (also observed same day, grok-build) must STILL classify empty — don't blur the two cases. **RESOLVED v2.31.17**: `scripts/lib/output-quiescence.sh` content-driven wait (size-stable ~1s / empty-grace 10s / deadline 60s; fd-holder approach falsified — sandboxed codex worker invisible to /proc+pgrep); honest-empty negative control in `hooks/tests/dispatch-output-quiescence.test.sh`.
- **Effort**: Fix
- **Source**: 2026-07-04 quality-floor-engine critique round (MiniMax critique harvested post-hoc from an "empty" run).

### Per-event opt-in hook multiplexer — REAFFIRMED deferred (see existing entry below)
- **Trigger**: (unchanged; see the original entry) — reaffirmed by the 2026-07-04 3-family panel: all three families independently said "not now"; the v2.31.10 tail-window read removed the O(n²) pain that was the strongest argument for doing it early. codex's design note for whenever it fires: a shared offset-cache is NOT a safe substitute (one hook advancing a shared cursor makes sibling hooks miss events — it degenerates into the multiplexer anyway).
- **Source**: 2026-07-04 review-closeout design panel Q3.
### distill 情節模式（episodic mode）＋ finish-flow/next 定期呼叫整合
- **Trigger**: next time touching `skills/distill/`；OR 下一個 L 專案收尾時發現「這套流程值得留但沒有機制接住」。
- **Context**: 首次 /distill 全量掃描（2026-07-04）實證頻率模式的兩個結構盲區：單次深方法論（≥3× 門檻永不提案）與複合命令儀式（tokenizer 只取首 token）。同期情節式蒸餾實戰（五個 skill＋RED 驗證）證明互補路徑有效。完整設計（含可直接落地的 Step 1E/2E 草稿、finish-flow L-5.6 與 /next B 級的各一行整合、驗收清單）：[`docs/plans/2026-07-04-distill-episodic-mode.md`](plans/2026-07-04-distill-episodic-mode.md)。雙模式共用 Step 3–5 管線，不加新 skill → PATCH。
- **Effort**: S–M
- **Source**: 2026-07-04 Fable 5 session；plan R0。

### distill-scan 校準：friction bucket 混入非使用者文本 ＋ 複合命令儀式盲點
- **Trigger**: next time touching `scripts/distill-scan.js`，OR 下一輪 /distill 再次觀察到同類噪音。
- **Context**: 2026-07-04 首次全量掃描（761 sessions）發現兩個校準問題：(1) **friction bucket 噪音** —— 「recurring-correction candidates」樣本混入大量非使用者更正文本：`<teammate-message>` 轉發、dispatch prompt（「OUTPUT ONLY RAW JSON…」「Review this change for security…」）、session-continuation 摘要 —— `--real-only` 沒把這些注入類內容濾掉，稀釋了真實 friction 訊號；建議在抽取層排除 teammate-message 區塊/已知 dispatch-prompt 模板/continuation 標頭。(2) **複合命令儀式盲點** —— n-gram 對「單次 Bash 呼叫內的多步 pipeline」不可見：同 session 實測跑了 ≥8 次的「rewrap→encrypt→push」發布儀式完全沒出現在 trigram/bigram（每次都是一個大複合命令，tokenizer 只取首 token）；若複合命令內部的 `&&`/`;` 步驟能拆進 n-gram 流，這類儀式才可被挖掘。兩者都不影響現有計數正確性，是召回率問題。
- **Effort**: S（friction 過濾）＋ S–M（複合命令拆解，注意別把 heredoc 內容誤拆）
- **Source**: 2026-07-04 Fable 5 session 首次 /distill 全量掃描實測。


### distill Step 4.5 — 高風險產出加 RED-phase 品質環（skill 產出後的「弱模型會不會照做」驗收）
- **Trigger**: next time touching `skills/distill/` 流程段（Step 4/5 附近），OR 任何一個 distilled skill 在別的模型/機器上被回報「沒照做」。
- **Context**: distill 產出 skill 後只有 `validate.sh`（結構驗證），沒有行為驗收 —— 但 2026-07-04 的三格矩陣實測證明：紀律型規則會被弱模型 rationalize（haiku 密碼落檔 ×4 且自評全過），**模型升級不修紀律只讓違規更優雅**（sonnet 改藏 `.password.txt`），唯有枚舉式禁令補丁能讓重測轉綠。方法論已蒸餾成獨立 skill：`~/projects/skills/skill-red-testing/SKILL.md`（六步閉環：rubric 先行 → 弱模型跑真任務 → 驗屍產出物不信自述 → 枚舉式補丁＋出處標注 → 重測 → RED-LOG）；實測數據在同 pack `RED-LOG.md`。建議落點：distill Step 4.5「(可選) 對高風險/要分享的產出跑一輪 RED」——用 headless `claude -p --model haiku`（已實測 `~/.claude/skills/` 在 headless 會載入）或 Agent tool model 覆寫，成本一次一杯 haiku。
- **Effort**: S（流程文件一節＋一個建議 prompt 模板；不需新腳本 —— 或 M 若要把 rubric 生成也腳本化）
- **Source**: 2026-07-04 Fable 5 session（skill pack RED-phase 三格矩陣）；`~/projects/skills/RED-LOG.md`。

### distill identifier lint 開放給外部 skill pack 使用（單獨入口）
- **Trigger**: 下次要**公開分享**任何手寫個人 skill pack（如 `~/projects/skills/`）之前；OR next time touching distill 的 lint 程式碼。
- **Context**: distill 的 identifier lint（email/IPv4/`/home/<user>/`/FQDN/key-shapes ＋ `~/.autopilot/distill/identifiers.deny`）目前只在 distill 流程內部可用。手寫的個人 pack（本次的 teaching-materials 等五個 skill 走 self-use 豁免，含使用者自己的路徑/帳號）在公開分享前需要同一道 lint，但沒有獨立入口可呼叫。建議：把 lint 抽成可獨立執行的入口（`--path <dir>` 掃任意 skill 目錄），distill 內部改為呼叫同一入口 —— 一份實作兩處使用。
- **Effort**: S
- **Source**: 2026-07-04 Fable 5 session；`~/projects/skills/` pack 建立時的自用豁免決定。

### `autopilot endpoints test <name>` — live auth-roundtrip probe
- **Trigger**: next time hardening the `endpoints` CLI, OR a user asks "is my GLM/MiniMax token actually working" and `doctor` (which only checks presence + perms, no network) isn't enough.
- **Context**: the v2.31.8 `endpoints` CLI shipped `init`/`list`/`which`/`set`/`doctor`; the 3-family design panel marked `test <name>` (a tiny live `/v1/messages` roundtrip that verifies auth + prints latency) as **optional** and it was deferred to bound scope (network + real-creds + host-dependent). `doctor` covers "is it configured" but not "does the token authenticate". Reuse `dispatch-anthropic-review.js`'s HTTP client (env-only auth, redacted logs, timeout/body-cap) for a read-only probe; must never print the token; opt-in / no-network-by-default posture like `probe-engine-capability.sh --safe`.
- **Effort**: S
- **Source**: 2026-07-03 endpoints-cli 3-family hetero design panel (codex/agy/grok) + `docs/projects/2026-07-03-endpoints-cli/`.

### Overlay repo-keying refinements (path-fallback stability / rename handling)
- **Trigger**: a user reports a per-repo overlay "stopped applying" after moving/re-cloning a repo, OR when adding overlay support to a non-git workflow.
- **Context**: v2.31.8 keys the opt-in overlay on the normalized git remote (stable across clones) with a **toplevel-path cksum fallback** when there's no remote. The path fallback is per-checkout-location — moving the working tree changes the key, so the overlay silently stops applying. Acceptable for v1 (remote is the common case) but document/handle: a `endpoints which` note when the active key came from the path fallback, and/or an `endpoints set --repo` warning when no remote exists.
- **Effort**: S
- **Source**: 2026-07-03 endpoints-cli design (self-flagged blind spot).


### ✅ DONE (2026-07-03, v2.31.3) — `dispatch-review.sh` prompt-echo pollution
- **Resolution**: Shipped the fresh-nonce wrapped-block protocol for the codex/agy/grok/cc-shim runners (nonce verified absent-from-diff; marker as absolute output prefix defeats whole-prompt echo; single-block extraction; reject-guard on diff/template leakage; 16 KB oversize cap; trailing-after-END + multiple-block + missing-END ⇒ no_verdict; exactly-one-anchored-VERDICT; pre-dispatch size-guard warning). Design via a cross-family debate (codex+grok+depth-0); implemented via `/l5` hetero-impl (gpt-5.3-codex-spark, 3 rounds) + decorrelated gpt-5.5 review (3 rounds, SHIP-AS-IS) + a depth-0 independent adversarial harness. anthropic-compatible deliberately out of scope (see follow-up below). Commit: squash-merge of `b945f38` chain.

### Reviewer response/runner exits cause fail-closed verdict loss（Grok / GLM / Kimi / Qwen / Codex）
- **Trigger**: next time touching `dispatch-review.sh`, `dispatch-author.sh`, `dispatch-plan-review.js`, response parsing, or runner transports; or before promoting any affected engine to a required strict seat.
- **Context**: Multiple engines emit semantically valid verdicts that strict parsers or runner exits must reject. Grok 4.5 high has reproduced a prose preamble across three projects; task-convergence review added GLM-5.2 wrapping `READY` JSON in a Markdown fence and official Kimi K3 prefixing its object with one bullet. A later Qoder run emitted exact `{"verdict":"READY","findings":[]}` but exited 1 in scratch space; Codex CLI 0.145 rejected dispatch-author's scratch directory as untrusted; a `cc-shim` MiniMax run returned empty exit 1, while direct MiniMax needed a 60k author-token cap to avoid `stop/length`; an agy Gemini smoke timed out after three minutes. Preserve prompt-echo protection and fail-closed behavior. Investigate runner-native structured output where available (Grok `--json-schema`), explicit exit/result reconciliation, Codex's trusted-directory invocation contract, runner-specific no-preamble/fence probes, and safe anchored extraction with adversarial echo/multiple-object/trailing-content fixtures. Do not accept arbitrary first/last braces or relabel a failed transport as a pass. **Related but separate (do not collapse)**: QC panel-size degradation under a declared multi-seat roster is tracked under “QC panel count degradation vs declared min_panel_size” — parser fail-closed must not silently shrink a configured panel without a disclosed degradation receipt.
- **Effort**: Fix
- **Source**: `docs/projects/_archive/2026-07-14-dispatch-branch-lifecycle/README.md`; `docs/projects/_archive/2026-07-26-capability-adaptive-profiles/README.md`; `docs/plans/2026-07-26-plan-review-session-controller.md`; `docs/plans/2026-07-26-task-convergence-contract.review.md`.

### ✅ DONE (2026-07-03, v2.31.4) — `anthropic-compatible` reviewer under the nonce wrapped-block protocol
- **Resolution**: Shipped the **raw passthrough** design (the one the reverted v2.31.3 inline client should have been): `dispatch-anthropic-review.js` gains `--raw` + `--prompt-file` as pure transport (sends the shell's pre-built wrapped prompt, keeps its redaction/timeout/body-cap, emits only the raw model response, no parse; the two flags are mutually bound so the only prompt-file path is the raw passthrough, legacy `--diff-file` standalone path byte-identical), and `dispatch-review.sh` routes anthropic through the shared nonce parser (no early exec, no inline HTTP client — single anthropic HTTP path). `/l5` hetero-impl (gpt-5.3-codex-spark, one clean round) + decorrelated gpt-5.5 (SHIP-AS-IS; two over-flagged findings — non-reachable "token leak" + "vacuous redaction test" — verified against the code and dismissed) + depth-0 loopback harness + a `--prompt-file`-requires-`--raw` guard added at depth-0. Hermetic loopback test covers valid/echo/leak/malformed/max_tokens/oversize/timeout/non-zero-exit.
- **Trigger**: (closed) was — next time hardening `dispatch-review.sh` / `dispatch-anthropic-review.js`.
- **Effort**: Fix (done)
- **Source**: 2026-07-03 v2.31.4 `/l5`.

### `dispatch-review.sh` echo-hardening — derived/transformed delimiter (max-security variant)
- **Trigger**: next time the nonce wrapped-block protocol is revisited, OR if an engine is observed echoing the whole prompt INCLUDING the nonce markers AND starting its output with the marker (defeating the prefix check).
- **Context**: v2.31.3 chose the plain-nonce-as-prefix + reject-guard hybrid (codex's design-debate alternative: give a nonce and require the model to TRANSFORM it into the accepted delimiter, so a pure prompt-echo can't reproduce the derived marker). The transform variant is max-security but risks FALSE-NEGATIVES on weaker engines that flub the transform (a correct review lost to a parse miss) — deferred pending a per-engine transform-reliability spike. Only adopt if the spike shows the target engines compute the transform reliably.
- **Effort**: Fix (spike-gated)
- **Source**: 2026-07-03 cross-family design debate (codex gpt-5.5 vs grok), v2.31.3.



### ✅ DONE (2026-07-02, v2.30.2) — `engine implement-review` codex-flag misclassification
- **Resolution**: Root-caused as PATH ambiguity — the engine runs under nvm's node whose $PATH prepends the nvm bin, where a stale npm-global `@openai/codex` 0.130.0 preceded `~/.local/bin/codex` 0.142.2 and lacks `--dangerously-bypass-hook-trust`. dispatch-hetero.sh now feature-detects the flag in the precondition (fail-loud `precondition_failed` naming path+version) + adds a `--codex-bin` seam; the stale npm codex was removed on the affected machine. e2e verified (`engine implement-review` → `committed` → `converged`). +4 test assertions.
- **Trigger**: next time using `bin/autopilot.js engine implement-review` with a codex implementer (blocks the whole `/l5`/`/l6` engine impl path); fix before relying on the engine CLI for hetero impl.
- **Context**: Via the engine wrapper (`src/runners/implementer.js` `dispatchImplement` → `spawnSync(dispatch-hetero.sh, args, {env:process.env, shell:false, stdio:['ignore','pipe','pipe']})`), codex reproducibly exits 2 with `error: unexpected argument '--dangerously-bypass-hook-trust' found` (agent_log 267 bytes) → dispatch-hetero misclassifies as `question_suspected` (~274ms, files_changed 0). But running `scripts/dispatch-hetero.sh --runner auto --model gpt-5.3-codex-spark ...` DIRECTLY with the same args works (`committed`); the verbatim codex command line works; the flag is accepted by codex 0.142.2 both interactively AND under `systemd-run --user --scope`. So the defect is in the engine-wrapper invocation layer (env/stdio/cwd difference or a codex auto-update state triggered only on that path), NOT dispatch-hetero, NOT codex, NOT the command. NOT fully root-caused. Workaround used 2026-07-02: bypass the engine, dispatch impl via `dispatch-hetero.sh` directly + run the gpt-5.5 review loop at depth-0 manually.
- **Effort**: Fix
- **Source**: 2026-07-02 `/l5` dogfood on the endpoint-credential-resolver project (`docs/projects/_archive/2026-07-02-endpoint-credential-resolver/`); two engine runs failed identically, direct dispatch + verbatim replication + systemd-run all pass.


### ✅ DONE (2026-07-02, v2.29.0) — Pre-existing full-suite failures repaired
- **Resolution**: The four residual full-suite failures from the v2.28.1/v2.29.0 train are fixed. `check-optin-changelog.test.sh` now configures repo-local git identity in its ambiguous-history sandbox; `check-test-integrity.test.sh` keeps L0 coverage isolated with `--no-l1`; `check-test-integrity-l1.test.sh` uses a hermetic fake pytest reporter so host-level pytest is not required; and `dispatch-hetero.test.sh` now covers codex wrapper-commit success including author-only identity environments. `bash hooks/tests/run.sh` is green (`82/82` test files).
- **Source**: `f9d1590` merge + archived project `docs/projects/_archive/2026-07-02-full-suite-green/README.md`; original source was v2.28.1 finish-flow quality gate (`708e911` merge), full suite 78/82 with pre-existing classification.

### ✅ DONE (2026-07-02, v2.29.0) — Engine integration follow-up hardening from external architecture review
- **Resolution**: Shipped F1-F4 plus feasible ride-alongs F5-F9/S1/S2/S5. `engine implement-review` now fails closed on unknown/unqualified reviewers by default, Codex package payload drift is gated by `sync-codex-plugin-skills.sh --check` in pre-commit/preflight, release metadata is retargeted to `v2.29.0`, and the engine layer/front-door docs are updated. S3/S4/S6/S7 remain deferred as non-ship-blocking runtime semantics, not backlog-triggered active work.
- **Source**: `ce3d79e` merge + `2b895d2` post-merge doc-sync correction; archived project `docs/projects/_archive/2026-07-02-engine-hardening/README.md`.

### ✅ DONE (2026-07-01, v2.28.0) — `/l6` — full-dispatch CEO front-door
- **Resolution**: `/l6` was shipped as the 26th skill. Recurrence was proven by cross-session manual usage + token-conservation need (not one session). The prerequisite dispatch-hetero fix shipped in v2.27.1. The entry no longer gates anything.

### ✅ DONE (2026-07-02, v2.29.0) — `dispatch-hetero.sh` wrapper commit captures net-new files
- **Resolution**: The wrapper-commit fallback stages with `git add -A`, so codex edit-only runs that create net-new files produce a clean `committed` outcome instead of `dirty`/manual harvest. The v2.29.0 follow-up also hardened the same path for repos without configured author/committer identity by adding deterministic fallback identity only when either `GIT_AUTHOR_IDENT` or `GIT_COMMITTER_IDENT` is unavailable. Covered by `hooks/tests/dispatch-hetero.test.sh` (`51` assertions).
- **Source**: `f9d1590` merge + archived project `docs/projects/_archive/2026-07-02-full-suite-green/README.md`; original source was the 2026-06-30 engine-lifecycle full-dispatch build.

### Eval plugin-arm context isolation — guard the baseline against silent self-contamination
- **ABSORBED 2026-07-04** into `docs/plans/2026-07-04-quality-floor-engine.md` §7 **P3-pre** (Board directive waived the original trigger — the P3 orchestration eval IS the lift measurement this entry was waiting for).
- **Trigger**: the first time autopilot runs an **A/B "with-skill vs without-skill" lift measurement** (i.e. an eval arm that loads the plugin vs a baseline arm that must NOT) — e.g. proving a skill/prompt actually helps, or wiring an eval into a CI quality gate. NOT before then (today's `run-eval-batch.sh` measures trigger isolation, not lift).
- **Context**: 2026-06-27 study of `DietrichGebert/ponytail`'s benchmark harness surfaced an **insidious** methodology trap it hit and fixed (`benchmarks/results/2026-06-18-agentic.md`): its plugin fires on `SessionStart`, so an earlier agentic run let the hook fire on **every** arm — the baseline was secretly running the skill, the measured gap collapsed to ~4%, and they nearly published it. Autopilot's evals are also plugin-based (`SessionStart`/hooks), so the same baseline contamination would bite a lift measurement. Fix pattern: per-arm isolated process with explicit plugin scoping (ponytail used `claude -p --setting-sources project,local --plugin-dir ./arms/<arm>`), plus a `--selftest` that logs which plugins each arm loaded and **fails if the baseline arm loaded any**. Strongest single transferable idea from the study; high保險 value because it's invisible, only shows at high n, and invalidates the whole benchmark if missed.
- **Effort**: S–M (isolation flags + a selftest assertion) — only when the lift-measurement trigger fires.
- **Source**: 2026-06-27 ponytail benchmark-harness study (this session); ponytail `benchmarks/results/2026-06-18-agentic.md` contamination note + `agentic/README.md` isolation flags.

### Deliberately-minimal baseline arm — prove skill lift, not just trigger precision
- **ABSORBED 2026-07-04** into `docs/plans/2026-07-04-quality-floor-engine.md` §7 P3 design (the OFF arm with neutral-padding control doubles as the minimal baseline).
- **Trigger**: same as the entry above (a lift measurement) AND a concrete question of "does this skill/prompt actually add value vs a naive baseline" that the current harness can't answer.
- **Context**: ponytail's `benchmarks/arms/` runs a three-arm A/B — `baseline` (bare model), `caveman` (a deliberately-minimal prose-compression skill), and `ponytail` (the skill under test) — so a win can be attributed to the *specific ruleset* rather than to terseness or chattiness alone (`benchmarks/results/2026-06-12-caveman-vs-ponytail.md`). Autopilot's `run-eval-batch.sh` measures a skill's trigger precision **in isolation** but has **no no-skill / naive baseline arm**, so it can't show additive value. Pair with the isolation entry above (a baseline arm is only meaningful if it's truly uncontaminated). Lower priority than isolation — the contamination bug is a correctness footgun, this is a measurement-completeness nice-to-have.
- **Effort**: M (a baseline arm + a small results convention) — trigger-gated.
- **Source**: 2026-06-27 ponytail benchmark-harness study (this session). Note: the **dated human-facing results-report** convention (Limitations + Reproduce sections) was the 3rd candidate — judged too light to track; fold opportunistically if the above two ever ship.

### ✅ DONE (2026-06-27, v2.26.2) — Migrate the remaining 12 Tier-B opt-in hooks off the `${CLAUDE_PLUGIN_ROOT}`-in-settings.json route
- **Resolution (v2.26.2)**: all 12 opt-in hooks now wired in `hooks.json` (where `${CLAUDE_PLUGIN_ROOT}` resolves + auto-tracks updates) behind a default-OFF runtime gate (`hooks/_shared/opt-in.js` — `~/.autopilot/config.json {"hooks":{"<stem>":true}}` or `AUTOPILOT_HOOK_<STEM>=1`, fail-safe → never blocks a tool call when disabled). `hooks/opt-in-manifest.json` is the new opt-in SSOT; `check-hook-inventory.js` derives opt-in from it (counts unchanged 10/12/0). `settings.example.json` `hooks-opt-in-examples` removed (route was unusable). **Follow-up BACKLOG**: per-event multiplexer to avoid spawning gated-off opt-in hooks on every tool call (see entry below).
- **Source**: v2.26.1 (`f77bbb7`) surfaced it; resolved in v2.26.2.

### Per-event opt-in hook multiplexer (perf) — avoid spawning gated-off opt-in hooks on every tool call
- **Trigger**: tool-call latency telemetry shows the gated-off opt-in hooks' `node` startup is material (heavy-session cumulative), OR next time touching hook wiring perf.
- **Context**: v2.26.2 wires all 12 opt-in hooks in `hooks.json`, so each spawns `node` (then gate-exits ~immediately) on every matching tool call for ALL users even when disabled — in line with existing default-on hooks but additive (5 PreToolUse + 4 Stop + 3 PostToolUse). The only update-stable wiring is `hooks.json` (token must resolve), so the spawn is unavoidable without a single per-event multiplexer hook that reads the manifest + config once and dispatches only the enabled opt-in hooks.
- **Effort**: L
- **Source**: v2.26.2 design tradeoff (accepted, gpt-5.5 spec-reviewed).

### ✅ DONE (2026-06-27, v2.26.3) — update-checker release-hygiene gate: require a CHANGELOG `opt-in` mention when the opt-in set changes
- **Resolution**: `scripts/check-optin-changelog.js` (new, pure Node) wired as `preflight-release.sh` check #6. When the `hooks/opt-in-manifest.json` opt-in set changes vs the previous release, the current version's CHANGELOG section must contain the literal `opt-in` AND name every added/removed stem **alongside** `opt-in` (per-list-item co-location + word-boundary match — a mention in a Rollback note / neighbouring bullet does not count). **Baseline diff solved tag-free** (the deferred "non-trivial" part): walks first-parent `.claude-plugin/plugin.json` history to the `boundary^` of the current version's run — robust to a manifest change decoupled from the bump commit and to non-monotonic/revert histories (→ ambiguous, fail-closed, `--base-ref` remedy). No-baseline is **fail-closed** except the legitimate pre-v2.26.2 bootstrap (`--allow-no-baseline` escape hatch). CommonMark-aware section scan (fenced/comment masking, `(?=\s|$)` version boundary so `v2.26.3`≠`v2.26.30`/`-alpha`, 0–3-space ATX). 41 test assertions. **Process**: `/l5` dogfood — gpt-5.5 xhigh spec-review (6 findings) → `gpt-5.3-codex-spark` hetero impl → depth-0 independent harness + 4-round decorrelated gpt-5.5 impl-review (R1 4 / R2 2 / R3 2 → SHIP-AS-IS); the decorrelated reviewer caught false-pass holes the impl's own green + the depth-0 harness both missed.
- **Source**: 2026-06-27 update-checker `/l5` spec-review R1-🟡 #6 (deferred from v2.25.16); resolved in v2.26.3.
- **Source**: 2026-06-27 update-checker `/l5` spec-review R1-🟡 #6 (deferred from the ship).

### Domain-aware routing — consume the `work_domain` telemetry to route reviewer/implementer by diff domain
- **Trigger**: ALL of these prerequisites are met (telemetry alone is NOT a trigger — the v2.25.x measurement layer ships first, on purpose): (1) `/l5` honors `reviewer_runner` via `dispatch-review.sh` so a non-`codex` (e.g. `gemini-flash`) reviewer can actually be dispatched — today `/l5` hardcodes `codex exec`; (2) a **two-pass resolve** in `resolve-review-loop.sh` (resolve once to learn the domain, then re-resolve the roster conditioned on it) without breaking the single-shot JSON contract; (3) a **pre-impl planned-scope signal** for *implementer* routing — a post-impl diff-probe can't choose the implementer before the work exists (R2); (4) **per-project per-domain calibration with n≥30** real samples (current evidence is one `llm-playground` exam, n=15 backend-cli — far too thin to crown a per-domain engine); (5) an **inner-reviewer-family field** distinct from the panel-only `cross_family_*` semantics (those gate the depth-0 qc_panel vs the implementer, NOT the inner per-round reviewer's family).
- **Context**: 2026-06-26 dogfood found best-model is **domain-dependent** (`gemini-3.5-flash` leads Rust 54% of that exam; `opus-4.8` matches-or-leads backend-cli, autopilot's own shape) — but the evidence is thin and the routing target (`gemini` reviewer) isn't plumbed. The 5-round gpt-5.5 loop converged the whole plan to **measure-now-route-later**: ship `probe-diff-domain.sh` + the resolver's `work_domain`/`domain_source` telemetry keys + the `/l5` ledger column (done), defer ALL routing here. `qc_panel`/`cross_family_*`/`--enforce` stay untouched by domain. Plan: [`docs/plans/2026-06-26-domain-aware-roster.md`](plans/2026-06-26-domain-aware-roster.md).
- **Effort**: L (each prerequisite is its own sub-task; (1) alone is S–M).
- **Source**: 2026-06-26 domain-telemetry ship (Phase 4); the deferred KR4 of the plan.

### Engine-routing axis — evidence bar for ANY model→worktype default (domain AND lifecycle-phase BOTH survey-refuted)
- **Trigger**: before hardcoding ANY `domain→engine` OR `phase→engine` default (i.e. a prerequisite that gates the "Domain-aware routing" entry above AND any future "route plan/test/review/debug to model X" idea). Fires whenever someone proposes a static model→worktype table.
- **Context**: 2026-06-29 two-round dual-agent survey (researcher + skeptic, each axis) found **no decisive quantifiable evidence** for routing engines by **domain** (frontend/backend/…) OR by **lifecycle phase** (plan/implement/test/review/debug). Domain axis: the "Gemini Flash → frontend/aesthetics" claim is REFUTED on functional frontend (WebDev Arena 391K votes, Flash #14 @1506, −148 vs Claude Opus leader) and UNPROVEN on taste (Design Arena JS-gated, unmeasurable); arenas measure style not substance (platform's own Style-Control admission); frontend's hard part (a11y/state/correctness) is where ALL frontier models fail and arenas can't see. Phase axis: a single general-capability factor explains **~75% of cross-task variance** (10 benchmarks × 156 models, arXiv 2603.02540 — caveat: loadings from abstract snippet, spot-check before quoting) ⇒ per-phase rankings ≈ overall capability tier ("phase specialty wearing a capability-tier costume"); SE phases either collapse to the Claude family (implement; review-by-noise +0.009) or have NO clean benchmark (plan-decomposition / test-gen / debug). The ONLY "different leader, real margin" splits are NOT SE phases — they're capability-axis: LLM-judge/verify (o3-mini +16pp JudgeBench) and adversarial browse (GPT-5.5 BrowseComp 0.901). **Conclusion: the three DEFENSIBLE, evidence-backed routing keys are all RELATIVE (survive model churn): capability-tier (hard→strongest-available), decorrelation (verify/review→different family — self-preference/family-bias is the real signal, NOT "best judge"), cost (cheap-enough work). Keep domain telemetry-only (`probe-diff-domain.sh` posture is vindicated); never key engine selection on absolute vendor names.** Adoption bar for overriding this = the 5 skeptic thresholds: oracle-graded not preference-graded; decontaminated + hard-tail; margin > harness noise (~10-20pp); decorrelation-preserving (no lane collapses to one vendor family); carries an expiry + telemetry loop.
- **Effort**: n/a (this is a STANDING EVIDENCE BAR, not a build task — it gates the entries above; don't re-litigate without new oracle-graded data).
- **Source**: 2026-06-29 two-round `/survey` (domain axis + phase axis), dual-agent researcher+skeptic; memory [[project_routing-axis-evidence]]. Reinforces [[trust-tiered-review-policy]] design conclusion #1/#3.

### `dispatch-review.sh` agy path — harden isolation if agy ships a read-only sandbox
- **Trigger**: Antigravity CLI adds a read-only / sandboxed `-p` mode (analogous to `codex exec --sandbox read-only`), OR a concrete incident where the agy reviewer path writes somewhere it shouldn't.
- **Context**: `dispatch-review.sh` runs the codex reviewer under `--sandbox read-only` (hard sandbox), but agy has **no upstream read-only mode** — its isolation rests on (a) being dispatched from a throwaway scratch cwd and (b) agy ignoring process cwd anyway, NOT a hard sandbox. A malicious diff (untrusted, in the prompt) could in principle drive agy to write its own scratch dir / `~/.gemini`, never the repo worktree, but it's not a true sandbox. Accepted residual at v2.25.9 ship (depth-0 review round-2). When agy ships a read-only mode, switch the agy branch to it and tighten the header claim.
- **Effort**: S (swap the flag + test) — only when the upstream mode exists.
- **Source**: 2026-06-26 cross-family-qc-panel (v2.25.9) depth-0 pre-merge review residual.

### ✅ DONE (2026-06-26, v2.25.9) — `agy` restored as a `/l5` implementer (anchor fix) + read-only reviewer
- **Resolution**: the "agy can't write to the worktree" blocker was NOT a fundamental vendor wall — it was a **relative-path prompt** interacting with agy ignoring process cwd (#231/#133/#253). Fix: `dispatch-hetero.sh` now PREPENDS an **absolute-worktree anchor** to the agy directive ("Your ABSOLUTE working directory is: <wt>" + scratch/project prohibition), so agy edits in place. **Verified**: bare agy 3/3 single-file; real `dispatch-hetero.sh --runner agy` returns `committed` on single- AND multi-file relative-path prompts; **3 concurrent `agy -p` ran 3/3** (concurrency-safe, projects.json intact). So `implementer_runner: agy` is viable again. Also shipped: agy as a **read-only qc-panel reviewer** (diff-as-text-in-prompt + `script -qec` pseudo-TTY capture, empty→fail-closed) — verified catching a planted `[::1]` bug. Caveats retained: agy stays EDIT-ONLY (run_command 10s cap → no mid-turn build/test; harness commits, panel verifies); Docker headless auth still broken (#223/#479) → run agy on an interactively-authed host (we don't containerize).
- **Earlier (now-superseded) verdict** was "keep codex, don't chase agy" — an over-correction from a single neutral-repo bench whose prompt used relative paths. The bench/issue research was accurate as journey; the conclusion is superseded for the implementer role.
- **Source**: 2026-06-26 cross-family-qc-panel project (v2.25.9); GitHub-API-verified issues `google-antigravity/antigravity-cli` #231/#133/#253/#306/#76/#408/#223/#479; memory [[project_agy-writes-install-dir]].

### L1 block-mode override re-enable — needs a REAL isolation boundary (cgroup is NOT enough)
- **Trigger**: when a `/l5` block-mode project hits a legitimate `executed_set_shrink` that should be waivable, AND a real isolation boundary is available.
- **Context**: The override stays **DEFERRED**. A v2.25.8 attempt to unlock it on a `--containment cgroup-verified` attestation was **REVERTED as UNSAFE** (gpt-5.5 adversarial review 2026-06-26, two EMPIRICALLY-verified escapes): (1) a same-user worker can `systemd-run --user --scope` a **sibling cgroup** outside the dispatcher's scope, so cgroup reap+verify is not malicious-proof and `contained:true` can be a false attestation; (2) the `--l1-verdict-file` path was honored even when worker-reachable (warned, not enforced). Conclusion (vindicates the L1 spec's original deferral): **no local-only, same-user mechanism closes the forgery hole.** Closing it needs one of: a separate UID for the worker, a real sandbox (container/VM/firejail), or a blocked user systemd bus (`/run/user/$UID/bus`) so the worker can't create sibling scopes. THEN: enforce the verdict path is depth-0-created-after-containment-proof and outside repo/.git/worktree; collapse the dispatch `containment`+`contained` provenance into ONE unambiguous attestation enum (don't accept a free-form `--containment` string). The `--containment` flag is currently accepted-but-advisory (no unlock).
- **Effort**: L (isolation boundary + enforced verdict-path + attestation enum + empirical sibling-escape regression)
- **Source**: test-integrity-l1 (v2.25.7) + W1/W2/W3 ship (v2.25.8); gpt-5.5 review verdict in session 2026-06-26; spec §8.3 / §12.

### ✅ DONE (2026-06-26, v2.25.8) — `dispatch-hetero.sh` codex-trigger + `--effort` + best-effort containment; review-loop automation
- **codex-trigger + effort** (W1): `--runner auto|codex|agy` (auto matches `*gpt*`/`*codex*`, fixing the `*gpt-5.5*`-only bug that sent `gpt-5.3-codex-spark` to the repo-corrupting agy branch) + `--effort` (was hardcoded `xhigh`). DONE + 39 dispatch-hetero assertions.
- **best-effort containment** (W2): worker runs in a `systemd-run --user --scope` cgroup, reaped on all exit paths + verified empty → `containment`/`contained` provenance. SHIPPED AS TEARDOWN HYGIENE ONLY (reaps setsid escapes); NOT a security boundary (see the deferred entry above for why the override unlock was reverted).
- **review-loop automation** (W3): `project-config-template/review-loop-config.md` + `scripts/resolve-review-loop.sh` (engine roster + loop policy as DATA) consumed by `/l5` — the decorrelated `reviewer_engine` (default gpt-5.5) replaces homogeneous-Claude review; `cp …/review-loop-config.md .claude/` then `/l5 <goal>`. DONE + 16 resolver assertions. Full proposal: `docs/projects/_archive/2026-06-26-test-integrity-l1/hetero-review-loop-automation-proposal.md`.

### ✅ DONE (2026-06-24, this ship) — `check-redispatch-prompt.sh` had no test (pre-existing gap)
- **Resolution**: added `hooks/tests/check-redispatch-prompt.test.sh` (21 assertions, auto-discovered by `run.sh`) mirroring the `check-dispatch-suppression.test.sh` sibling — **single-trigger** positives (each leaky marker independently guarded, so a regression in one detector can't hide behind a co-occurring marker), honest-prompt negatives, and the 0/1/2 usage contract. Also added a minimal `-h|--help` block to the script so it conforms to the CLAUDE.md inventory invariant "All scripts respond to `--help`" (it previously fell through to exit 2). Pre-commit reviewer verified the guards are non-tautological.
- **Trigger** (original): next time `check-redispatch-prompt.sh`'s patterns are edited, OR an idle batch to close test-coverage gaps.
- **Context** (original): surfaced by the v2.25.0 Ops dialectic — the round-2+ leaky-phrase linter shipped with **zero test coverage** (its sibling `check-dispatch-suppression.sh` got a 16-assertion test). Editing its regex was unprotected.
- **Effort**: S (done).
- **Source**: 2026-06-24 v2.25.0 ship (`05d02e4`) Ops review.

### Depth-0 loop hardening — content-fingerprint no-progress + hook backpressure (from loop-engineering study)
- **Trigger (a)** content-fingerprint: a real case where a foreman/dispatch loop **runs busy but makes no actual progress** (same diff / same verdict across rounds) and the **round cap (3)** lets it burn most of a budget before tripping — i.e. the crude round cap proves too loose. **Trigger (b)** backpressure: only if the `/loop` + event-driven harness integration ([[project_harness-integration-direction]]) is actually built out into an event/webhook-fed loop.
- **Context**: 2026-06-24 study of `maxmilian/loop-engineering` found autopilot already embodies all 7 of its loop principles (verify-by-artifact, machine-checkable done, budget/escalation exits, filesystem-as-memory via `tree.js`, semi-autonomous DOA gate). The ONE grdually-coarse spot: autopilot's depth-0 has a **wall-clock stall detector** (hung foreman trips the clock, `level-front-door.md:207`) + round cap + WTF cap, but no **loop-fingerprinting** (content/state unchanged across N cycles ⇒ break EARLY, before the round cap). And hook **rate-limiting/backpressure** (webhook-storm guard) is a non-gap today (tool-event + self-paced triggers) that becomes relevant only if event-driven `/loop` deepens.
- **Effort**: S (fingerprint = compare round-N diff/verdict hash to round-N-1, break on match) / S (backpressure, when/if relevant).
- **Source**: 2026-06-24 `maxmilian/loop-engineering` study (see [[project_loop-engineering-mirror]] memory).

### agent-skills study — rejected items (don't re-litigate)
- **Trigger**: a CONCRETE incident matching one of the rejected items below (not "it seemed like a good idea again").
- **Context**: 2026-06-24 study of `addyosmani/agent-skills` → 2-round Architect/Ops/Skeptic dialectic. Shipped 3 inline edits (E1 doubt-theater self-audit → `blind-dispatch.md`; E2 LLM-Top-10 → `reviewer.md` security axis; E3 metric-honesty → `profiling`). **Rejected** (full reasoning in `docs/plans/2026-06-24-agent-skills-learnings.md`): **C1 WebFetch revalidation cache** — zero observed re-fetch pain in the repo, extra HEAD-per-miss, cached body is a model-post-processed reading (304 revalidates bytes not the rendering), AND whether a PreToolUse WebFetch hook can even *return* a substitute result is UNVERIFIED (spike first if ever revisited). **C3a dead-cross-skill-ref detector** — the `→ skill` arrow collides with prose (`→ add`/`→ execute`...), FP-catastrophic; revisit ONLY after migrating cross-refs to a strict `[[skill:x]]` syntax. **C4 security persona** — would reverse the recorded `reviewer.md:70` decision (deep security delegated to native `/security-review`); only the LLM-Top-10 content was the real gap, landed as E2. **C2 doubt-driven skill** — CLAIM-stripping already shipped in `blind-dispatch.md` + the v2.24.0 refute pass; only the doubt-theater signal was missing, landed as E1. **O6 dual-env-var hook fallback** — genuine but solves a non-biting dogfood-path problem. Other O-tier net-new skills violate `skill-refactor-rules`.
- **Effort**: varies (each gated by its own trigger).
- **Source**: 2026-06-24 `docs/plans/2026-06-24-agent-skills-learnings.md` dialectic.

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

### ✅ DONE (2026-06-22, `e96998d` via /l4 dogfood) — subagent-driven-development: explicit BLOCKED / incomplete-return handling
- **Resolution**: `skills/team/references/team-tactics.md` gained a `## Dispatched-Subagent Return Contract` section — 4-value status enum (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED) + orchestrator action per status, BLOCKED→re-scope/escalate explicit. No separate spec-reviewer rebuilt (reviewer.md already covers spec-compliance, as the original note required). Landed as the `/l4` dogfood payload for `ceo-fleet-autonomy`.
- **Trigger**: next time a dispatched implementer subagent returns **incomplete / blocked** (NEEDS_CONTEXT, partial, gave up) and the orchestrator mishandles it (proceeds as if done, or stalls silently).
- **Context**: From the superpowers-parity survey (2026-06-04). superpowers' `subagent-driven-development` has (a) a two-stage **spec-compliance → code-quality** review ORDER and (b) explicit dispatched-subagent return-status handling (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED). Light design found (a) is **already covered** — `agents/reviewer.md` v2.12.1/v2.12.3 folded claim-completeness / "claimed but missing: decompose / claim-scope = unit of done" into the reviewer, which IS spec-compliance within `quality-pipeline`. The residue is (b): a documented status-enum + escalation for incomplete implementer returns, landing in `skills/team/references/team-tactics.md`. Today this works ad-hoc (the orchestrator sees an incomplete return and re-dispatches); formalizing is nice-to-have, not biting.
- **Proposed**: add a short "dispatched-subagent return contract" to team-tactics (status enum + BLOCKED→re-scope/escalate path). Do NOT rebuild a separate spec-reviewer (reviewer already does it).
- **Effort**: S
- **Source**: 2026-06-04 superpowers-parity inventory + research-to-ship light design (CEO-deferred: no biting value for self-use yet).

### writing-skills: RED-phase pressure-testing for behavior-shaping skills
- **Trigger**: when autopilot starts **publishing skills broadly** (beyond self-use / the distill pack), OR a distilled/authored skill ships and then visibly fails to shape behavior (agents rationalize around it).
- **Context**: superpowers' `writing-skills` applies TDD to skill docs — a RED phase (run a pressure scenario WITHOUT the skill, watch the agent rationalize, then write the skill to close those exact loopholes) + rationalization tables + Cialdini-grounded rules. Light design (2026-06-04) found this is **calibrated for public shared codebases (94% PR rejection)** and **overkill for self-use**; it's also coupled to `distill` maturity. The cheap high-leverage bit — the **CSO description principle** (description states triggering conditions only, never a workflow summary) — is **already autopilot practice** (see `brainstorm` / `research-to-ship` descriptions). So the genuine remaining delta is only the RED-phase apparatus, which is deferred.
- **Proposed**: if/when publishing, add a RED-phase intake gate to `distill` Step 3 (pressure-scenario baseline → write → loophole-close). Until then, keep CSO-only.
- **Effort**: M (distill-coupled)
- **Source**: 2026-06-04 superpowers writing-skills study + research-to-ship light design (CEO-deferred: self-use doesn't warrant the apparatus).

### `/compact` slash-command silent miss documentation
- **Trigger**: 任何 user 想用 `/compact` 測 state-checkpoint hook 時 — 必須先讀本條
- **Context**: 2026-05-14 method-B testing 發現：Claude Code 的 `/compact` slash command 觸發 PreCompact hook 時**不 pipe JSON payload**，而是讓 hook 撞 ENXIO on `/dev/stdin`。Auto-compact (~150K-token threshold) DOES pipe payload — 兩條路徑不對稱。
- v2.7.2 fix: state-checkpoint.js ENXIO 改 graceful skip (log `no_payload_skip` 而非 `catastrophic`)，所以未來不會 misleading log。但**根本性質仍在**：`/compact` 無法測 state-checkpoint 抽取邏輯，只能驗 hook reachable
- **Future action options**:
  - (a) 在 `hooks/README.md` 加 note「`/compact` ≠ real PreCompact for testing」
  - (b) 跟 Claude Code 反饋此 slash-command 應該 pipe consistent payload
  - (c) state-checkpoint 用 fallback（無 stdin 時自行 spawn `claude --transcript-path-query` 或讀 `~/.claude/projects/$CWD_HASH/*.jsonl` 最新檔）
- **Effort**: (a) S; (b) external — out of scope; (c) M, 但複雜度未必值得
- **Source**: 2026-05-14 v2.7.2 method-B verification — user diagnostic report

### PostToolUse dispatch dies after `/clear` — process restart required（verified）
- **Trigger**: 下次有 user 回報 intent-capture / audit-log / reload-watch 在 long-running session 沒更新；或 Claude Code 升級 release notes 提到 hook dispatch 變更
- **Context**: 2026-05-14 三階段觀察，verified via fresh-process test：
  - **Phase 1**: post-`/reload-plugins` intent-capture 跑 ~20 次 burst 後 stagnate 9+ 分鐘
  - **Phase 2 (post-`/clear` 同 session)**: 全部 PostToolUse hooks 不 fire（intent count, reload-watch mtime, audit-log 全凍）。`/reload-plugins` reload 11 hooks 但 **不 re-init dispatch**
  - **Phase 3 (fresh `claude` process 驗證)**: PostToolUse `.*` matcher **復活** — intent count 10→11、mtime 變新。**確認**：`/clear` + `/reload-plugins` 不 re-init PostToolUse dispatch、fresh process boot 才會
- **Verified hypothesis**: Claude Code PostToolUse dispatch table 跟 process boot 綁定一次性 init
- **Workaround**: 完整 exit + relaunch `claude`（不是 `/clear`、不是 `/reload-plugins`）
- **Impact**: v2.7.2 cross-session intent recovery 在 long-running session post-/clear 失效；user 不會察覺到 hooks 已 dead
- **Next step options**:
  - (a) **detect (SPIKE-GATED — do NOT write code first)** — auto-detect at SessionStart and prompt restart. **v2.8.1 dialectic (5/6) ruled the naive heuristic NON-FUNCTIONAL**, not merely risky: (1) the intent file is keyed by `sha1(realpath(cwd))`, *not* session_id; (2) SessionStart runs at boot *before* the new session's first PostToolUse writes the new session_id, so the file still shows the prior id — indistinguishable from a dead-dispatch `/clear`; (3) dispatch dies *mid*-session but SessionStart only fires at the *next* entry (already a fresh live process); (4) `intent.tool_count` is written by the very hook that's dead → invalid liveness oracle. **Required spike before any (a) code**: empirically verify what `CLAUDE_CODE_SESSION_ID` does across `startup` / `clear` / `compact` (same vs new value, and write-ordering vs SessionStart) in a fresh `claude`. Only if a clean discriminator exists is (a) buildable.
  - (b) upstream report 給 Claude Code（PostToolUse re-init on `/clear` matcher dispatch）
  - (c) ✅ **DONE v2.8.1** — `hooks/README.md` "Is my PostToolUse dispatch dead?" section: deterministic manual check (run a Bash tool → did `bash-commands.log` gain a line?) + recovery (full restart).
- **Effort**: (a) spike ~15min + M if buildable; (b) external; (c) ✅ done
- **Source**: 2026-05-14 v2.7.2 post-`/clear` diagnostic + fresh-process verification; 2026-06-02 v2.8.1 hook-followups dialectic (KR2 deferred → docs-only)

### Claude Code tool-event hooks get NO stdin pipe — event-type-specific, not version regression
- **⚠️ CORRECTED 2026-06-23 (v2.23.0)**: the diagnosis was **too broad**. It is only the **`/dev/stdin` PATH open** that throws ENXIO — the payload **IS** delivered on **fd 0**. Reading fd 0 directly (`fs.readFileSync(0, 'utf8')`) recovers it; verified e2e on **2.1.186** (probe hook saw the JSON; a real PreToolUse hook returning exit 2 blocked the tool). The official-docs `jq '.tool_input.command'` example fails because it reads via a path/`/dev/stdin`-style open, not because stdin is absent — `INPUT=$(cat)` (fd 0) works (rtk's hook proves this). Net: PreToolUse hooks are **not** unrecoverable; they just must read fd 0. The 3 blockers were re-enabled (opt-in) in v2.23.0 on this basis. Everything below is the original (over-broad) finding, kept for history.
- **Trigger**: 立即（影響所有 PreToolUse / PostToolUse hooks since hooks were authored）
- **Context**: 2026-05-14 兩輪 fresh-claude transcript 驗證收斂：
  - **Round 1 (2.1.141)**: 11 tool-event hook fires 全 ENXIO opening `/dev/stdin`
    - transcript `76a7e1b6-...jsonl`
    - PostToolUse:Bash × 4 + PreToolUse:Bash × 3 + PreToolUse:Read × 2 全部 ENXIO
    - SessionStart + Stop 正常
  - **Round 2 (2.1.129 downgrade test)**: 同 transcript 結構 `7bd61ac4-...jsonl`，**同 ENXIO**，`~/.claude/bash-commands.log` mtime 沒動
  - **2.1.128 binary strings**: 無 `EPIPE.*hook` markers（同 2.1.129），同類 issue 推斷一致
  - **Round 3 (2.1.159, 2026-06-01 `/next` probe)**: **仍 broken**。`~/.autopilot/intent/<cwd-hash>.json` 顯示 `last_tool: <unknown>` 但 `tool_count_session: 41` — PostToolUse 這 session fire 41 次、stdin 仍未 pipe（讀不到 tool_name）。確認 bug 跨 2.1.128→2.1.159 持續存在、Anthropic 尚未修。
- **Final root cause**: 不是版本 regression — 是 **Claude Code 的 hook stdin pipe 對 PreToolUse / PostToolUse event 從來沒運作**（at least on Linux + this Bun-spawned Node 環境）。SessionStart 跟 PreCompact 用不同 spawn path 所以 work
- **Critical implication**: Anthropic docs 內附 example `jq -r '.tool_input.command' >> ~/.claude/bash-log.txt`（給 PreToolUse Bash logging）**也是 broken** — 不只我們 hooks 受影響、官方 docs example 也跑不動
- **Impact** (all silent due to fail-open hook convention):
  - 所有依賴 `tool_input` / `tool_response` 的 hook 都 broken（audit-log, failure-escalation, large-file-warner, suggest-compact, design-quality, ...）
  - intent-capture 仍 write file 但 `last_tool: <unknown>` — v2.7.2 cross-session resume degraded
  - `~/.claude/bash-commands.log` 從未存在（audit-log silent-skip）
  - autopilot tool-event hooks 從未 e2e tested via real Claude Code dispatch（過去只 heredoc synthetic 測 script 本身）
- **Workaround paths** (next-step decision):
  1. ~~Downgrade~~ **RULED OUT** by Round 2 test
  2. **Upstream comment**（updated 2026-05-14 post web-research）：**comment on existing open issue `#6305`** 而非 file 新 — Anthropic close 同類 issue "not planned" 多次（#9567, #6403, #38162）、新 issue 預期低 ROI。#6305 reporter 已給 macOS 範例、加 Linux ENXIO + 2.1.139 changelog correlation + binary strings diff 補強
  3. **Hook design pivot** ✅ DONE in v2.8.0 (project `2026-06-02-hook-transcript-pivot`): PostToolUse hooks read transcript JSONL via `transcript-reader-lib.js`. Re-enabled: intent-capture `last_tool`, audit-log, log-error, failure-escalation. PreToolUse (large-file-warner, branch-protection, commit-secret-scan) **permanently unrecoverable** by this approach (tool hasn't run). **Remaining follow-up** (not done): suggest-compact (PostToolUse Write|Edit — recoverable, deferred), cost-tracker + session-summary (Stop events, env-driven — separate verification, NOT tool-event-stdin).
  4. **Disable broken hooks** ✅ DONE in `c5e5a4c` (v2.7.4)
- **Web research (2026-05-14)**:
  - **同 class issue 出現多次跨多平台**：macOS（#9567, #6403, #6305）、Windows（#17424, #36156, #46601）、Linux（我們確認 + 暗示 in #38162 inverted-async-bug）
  - **Anthropic 不修紀錄**：#9567, #6403 closed not planned 無回應；#6305 仍 open 無回應
  - **changelog smoking gun**：v2.1.139 `Fixed a bug where a hook writing to the terminal could corrupt an on-screen interactive prompt; hooks now run without terminal access` — 拔 hook terminal access 後 `/dev/stdin` open 拋 ENXIO；但 2.1.129 (pre-2.1.139) 也 ENXIO 表示 bug 比這次改動更早
  - **`ruvnet/ruflo #1172` 反證**：claude-flow 在 2.1.45–47 Linux Node v22 **正常** stdin → 退化發生於 2.1.47 → 2.1.128 區間（autopilot intent file 史上 `last_tool: <unknown>` 對應）
  - **官方 docs example `jq -r '.tool_input.command'` broken** — 強化 case
- **Effort**: (2) comment on #6305 ~30min；(3) L-size ~6-10hr
- **Recommendation**: 等 1-2 週看 (2) comment 有沒有回應；若無、(3) hook design pivot 排上 next L-size
- **Source**: 2026-05-14 fresh-claude transcripts `76a7e1b6-...` (2.1.141) + `7bd61ac4-...` (2.1.129)；binary strings diff 2.1.128/129/141；Claude Code official changelog v2.1.139；GitHub issues #6305, #9567, #6403, #38162, ruvnet/ruflo #1172

### ✅ DONE (2026-06-24, v2.25.2) — Re-enable v2.7.4 disabled hooks: cost-tracker was the last one
- **Resolution (2026-06-24, v2.25.2, `aff3b8b`)**: ✅ `cost-tracker` re-enabled opt-in via the transcript-sum rewrite. Reads `transcript_path` from the Stop payload, sums per-turn `message.usage` from the transcript, with a per-session cursor (`~/.claude/metrics/.cursors/<session>.json`) to avoid a per-turn double-count — **the Stop hook fires once per assistant turn and the transcript is cumulative**, so summing the whole transcript every Stop would over-count; the cursor logs only NEW turns each Stop. Cache-aware cost (read 0.1× / write 1.25× input). New `cost-tracker-lib.js` (pure) + `cost-tracker.test.js` (10 unit tests) + e2e vs a 287-turn transcript. **Hook tally disabled 1→0 — zero disabled hooks.** Closes this entire entry.
- **Status (2026-06-23, post-v2.23.0)**: ✅ the **PostToolUse tool-event** hooks were re-enabled by the **transcript pivot** (`log-error`/`audit-log`/`failure-escalation` v2.8.0, `suggest-compact` v2.8.1). ✅ the **3 PreToolUse blockers** (`large-file-warner`, `branch-protection`, `commit-secret-scan`) were re-enabled **opt-in in v2.23.0** — NOT by waiting for upstream, but by the **fd-0 read fix** (the "permanently unrecoverable" claim was wrong: only the `/dev/stdin` PATH is broken, fd 0 works — see the corrected stdin entry above). e2e-verified on 2.1.186 + `reenabled-blockers.test.sh`. **Remaining (now all done):**
  - **Stop-event hooks** (`cost-tracker`, `session-summary`): verified 2026-06-23 (v2.23.0) — fd 0 works for Stop too (`/dev/stdin` still ENXIOs). ✅ `session-summary` re-enabled opt-in (it only needs git+env; fd-0 read fix). ✅ `cost-tracker` re-enabled v2.25.2 — the blocker was NOT stdin: the **2.1.186 Stop payload carries no `usage`/`model` field**, so the transcript-sum rewrite (above) was needed.
- **Trigger** (任一觸發即跑驗證、全綠才 re-enable — applies to the PreToolUse blockers):
  1. Claude Code release notes 提到 hook stdin / PreToolUse / PostToolUse fix
  2. autopilot user 在 issue / discussion 報「audit-log 突然有 entries」「branch-protection 真的 block 了」
  3. 距 v2.7.4 ship 過 30 天且想主動 re-test（避免無限拖延）
  4. 跑 path (3) transcript-file pivot 前先做這個 verification — 確認還是 broken 才值得寫 L-size code
- **Verification recipe**:
  1. `cd ~/projects/autopilot && scripts/toggle-payload-capture.js enable`
  2. 新 terminal 跑：`AUTOPILOT_CAPTURE_PAYLOAD=1 claude`（用 current version OR 指定 binary path）
  3. 在 fresh claude 跑 `echo TEST_$(date +%s)` + read a small file + exit
  4. `ls ~/.autopilot/payloads/` — **要看到 4 個檔（pre-bash + post-bash + pre-read + post-star）**且 stdin_parsed 不是 null
  5. 同 transcript（最新 jsonl in `~/.claude/projects/-home-cookys-projects-*/`）grep `"stderr":"[^"]*ENXIO"` 必須 **0 hits**
  6. `scripts/toggle-payload-capture.js disable`
- **Re-enable order** — remaining only (the 6 log-only PostToolUse hooks are DONE via v2.8.0/v2.8.1):
  1. **Stop-event hooks** (separate verification, NOT #6305): `cost-tracker` → `session-summary`. Re-enable each, fresh claude, confirm artifact (`~/.claude/metrics/costs.jsonl` row, `~/.claude/sessions/{date}-{sid}.md`).
  2. **PreToolUse blockers**（最後，gated on upstream stdin fix）: `large-file-warner` → `branch-protection` → `commit-secret-scan`
     - 每個都試一個 **正常操作不被誤 block**（read small file、commit secret-clean code、push to feature branch）
     - 再試一個 **應該 block 的操作** 驗真的 block（read 5MB 檔、push to main、commit with 假 API key）
- **Effort**: PreToolUse re-probe ~15min；2 Stop hooks 重 wire + smoke ~20min；3 blockers 重 wire + 雙向 smoke ~45min
- **Rollback**: 任何 re-enable 後出現問題 → `git revert <re-enable-commit>` + `/reload-plugins` OR 直接 edit hooks.json 拔回前一狀態
- **Don't forget**: re-enable 完同步 CHANGELOG + `hooks/README.md` 對應 section
- **Source**: 2026-05-14 v2.7.4 disable batch ship（`c5e5a4c`）；2026-06-02 v2.8.0 transcript pivot + v2.8.1 suggest-compact re-enable

### Investigate `/reload-plugins` hook count discrepancy
- **Trigger**: 下次有人寫 reload-watch 邏輯時，或 Claude Code update 改 hook reload semantics
- **Context**: 2026-05-14 v2.7.2 post-reload 觀察 `/reload-plugins` 回報「11 hooks」但 hooks.json 實際 13 entries (1 PreCompact + 1 SessionStart + 3 PreToolUse + 6 PostToolUse + 2 Stop)。差 2 — 可能忽略 SessionStart 或 PreCompact runtime hook count。Live functionality OK（intent-capture 確認 firing post-reload）
- **Effort**: S（看 Claude Code source / docs 確認 count semantics）
- **Source**: 2026-05-14 v2.7.2 post-ship reload verification

### Generated `.opencode/agent-bodies/*.body.md` relative links break one level deep
- **Trigger**: next time `scripts/sync-agent-bodies.sh` is touched, OR an OpenCode agent reports a dangling `code-review.md` link
- **Context**: 2026-06-02 link-check found `.opencode/agent-bodies/reviewer.body.md` inherits `../skills/quality-pipeline/references/code-review.md` from `agents/reviewer.md` — correct at `agents/` depth, but resolves to `.opencode/skills/...` (missing) from `.opencode/agent-bodies/`. Generated artifact; the link is informational and the body is consumed via OpenCode `{file:..}` inline, so low severity. Fix options: (a) sync script rewrites `../` → `../../` for links when generating bodies; (b) make the source links repo-root-relative; (c) accept. NOTE: the v2.7.x validate.sh link-check is scoped to `skills/` only, so this does NOT fail CI today.
- **Effort**: S (fiddly — link-rewriting in the sync script risks other links)
- **Source**: 2026-06-02 level-3 deep scan + validate.sh link-check enhancement

### ✅ DONE (2026-07-02, superseded by v2.25.8–v2.29.0) — hetero-dispatch skill wrapper (and/or dispatch-config Implementer chain)
- **Resolution**: the recurrence trigger long ago fired (~95 hetero-dispatch-related commits since), but no one closed this entry because the wrapper landed under different names than originally imagined. What this entry asked for now exists: **when-to-use routing** → `skills/l5/SKILL.md` + `skills/l6/SKILL.md` descriptions (front-door trigger phrases); **forcing-function review-before-merge** → `/l5`'s mandatory decorrelated-reviewer loop + depth-0 qc-gate (`level-front-door.md`); **engine-choice routing logic** → `scripts/resolve-review-loop.sh` reading `.claude/review-loop-config.md` for `implementer_runner`/`reviewer_runner` per project — a superset of the speculative "`dispatch-config.md` Implementer chain + `resolve-dispatch.sh` runner field" (that exact shape wasn't built; the review-loop-config shape was, and covers the same need). `skills/engine-onboarding/SKILL.md` additionally covers qualifying a new engine into a role. Found stale during a 2026-07-02 `/next --deep` backlog audit (0 unresolved TODOs, 0 cold zones repo-wide — this was the only stale entry surfaced).
- **Source**: 2026-06-11 hetero-dispatch spike + first production use (`a83c04a`); CEO decision to ship script-first.

### Tree-engine graduation Board review
- **Trigger**: `~/.autopilot/calibration/samples.jsonl` reaches 50 reviewer-baseline samples OR 30 days after the first shadow run (2026-06-12), whichever comes first.
- **Context**: Amendment 6 — Board decides graduate / extend / abort based on `scripts/calibration.sh report` output. Silence is NOT extension. P6 adapter post-signoff activation is blocked on a `board_signoff` event recorded in the project tree (see `references/tree-contracts.md` §3.12 and `scripts/tree.js board-status`).
- **Effort**: Fix (Board review meeting; not a code task)
- **Source**: task-tree-engine P5 close-out (2026-06-12); R1 review round Fix M1.

### ✅ DONE (2026-06-22, `b274439` via /l5 hetero dogfood) — resolve-doa.sh override-row preset-column injection (sibling of v2.17.0 fix)
- **Resolution**: `scripts/resolve-doa.sh` gained `valid_token() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]; }` (byte-identical to the `resolve-dispatch.sh` sibling), guarding the override `preset_val` before `emit_preset_json` — invalid token → stderr warning + fall-through to defaults. Implemented by **Gemini 3.5 Flash (High)** via `dispatch-hetero.sh` and passed an adversarial depth-0 qc (injection/quoting/condition-sense all verified). Landed as the `/l5` dogfood payload for `ceo-fleet-autonomy`.
- **Trigger**: next time `scripts/resolve-doa.sh` is touched for any reason.
- **Context**: v2.17.0 review found override-config column values flow into printf-built JSON in both resolve-* scripts. resolve-dispatch.sh got allowlist validation on extracted model/mode (warn + fall back to defaults); resolve-doa.sh has the same vector on its Preset column — though its `emit_preset_json` maps unknown presets to fail-closed, the `role`/`tier` echo-back fields are sanitized at entry, so exploitability is lower still. Verify and, if needed, apply the same `valid_token` pattern for symmetry.
- **Effort**: S
- **Source**: 2026-06-12 tree-role-dispatch pre-merge review (🔵 Suggestion 2).
- **2026-06-15 note**: `resolve-doa.sh` was touched by the cwd-config-resolution fix (`fix/resolve-doa-cwd-project-config`). The Preset-column vector was re-reviewed and **consciously deferred** — the new code only changed config-path resolution (`$PWD` is never used as a regex/pattern), and the unknown-preset → fail-closed mapping still holds, so risk is unchanged and low. Allowlist symmetry remains open.

### agy install symlinked-dest self-copy truncation — guard install script + upstream report
- **Trigger**: before the next `agy plugin install` of autopilot anywhere in the fleet (until the guard ships, manually check `ls -la ~/.gemini/config/plugins/` for symlinks first), OR next S-size hardening slot.
- **Context**: 2026-06-11 incident, **mechanism CONFIRMED by sandboxed repro same day** (repro spike ✅ done): `agy plugin install` follows a symlinked destination `~/.gemini/config/plugins/<name>` and self-copies — open+truncate "dest" (= source through the symlink), read back empty, write 0 bytes, file after file. Sandbox: symlinked dest → 1497 files zeroed + `.git/HEAD` destroyed. Incident = legacy symlink from the 5/29 agy-1.0.1 era; the first (failed) install truncated 55 files before dying on read-only `.git` object `008efd…` (same object in sandbox — deterministic walk); uninstall/reinstall exonerated (all 4 sandbox control phases clean). Hazard + guards documented in `references/multi-agent-portability.md` § agy spike.
- **Remaining**: (c) upstream report to Antigravity — 3-line deterministic repro (clone, `ln -s` dest, install), verified on 1.0.5 AND 1.0.7 (latest). **Intentionality research (2026-06-11)**: plugins-dir symlinks are plausibly THEIR OWN plumbing (1.0.1 installed to a private app-data dir, 1.0.2 moved to `~/.gemini/config/` — our legacy symlink dates from exactly that 1.0.1-era install; community docs also describe the IDE symlinking `antigravity-ide/plugins/` → `config/plugins/`), which makes the kill condition reachable WITHOUT user error — lead with that in the report. The destructive follow itself is clearly unintentional: undocumented, no changelog entry, inconsistent with their security posture (IDE refuses to follow symlinked skills, vercel-labs/skills#633) and with their own bug taxonomy (1.0.5 fixed "settings silently wiped out"). No existing issue covers it (searched; only #327, an unrelated macOS `/var` resolution bug) — we would be first reporters.
- **Done**: (b) ✅ v2.15.1 — preflight guards in `install-antigravity.sh`/`.ps1` (symlink refuse never bypassable; dirty/unpushed/non-git behind `--skip-git-checks`; 16-assertion test).
- **Effort**: (c) S (report writing; needs user's go on identity/account)
- **Source**: 2026-06-11 incident + same-day sandboxed repro spike (H1/H2/H3 refuted, H6 symlink-dest confirmed).

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
Full design: [`docs/plans/2026-07-09-verify-strength-precursors.md`](plans/2026-07-09-verify-strength-precursors.md). Evidence: the escape cliff where `t2×medium` verification produced 100% escapes — verification QUALITY is invisible to `resolve-review-loop.sh` routing.

- **✅ Precursor (1) — red-green validation instrument** — DELIVERED 2026-07-09 (v2.32.11): `scripts/verify-red-green.sh` proves a change's tests are RED at base+tests / GREEN at head (else they don't exercise the change). Isolated detached worktrees; verdict from real exit codes. This is the BACKLOG's named minimal precursor.
- **🔜 (2) — real test-suite "verification strength" scorer** — a graded (`weak|medium|strong`) score for an ACTUAL project's suite guarding a change (NOT the pipeline-bench synthetic fixtures). Candidate signals: per-test red-green (precursor 1), mutation-survival / assertion density on the diff, changed-line coverage, oracle presence. Needs its own calibration corpus tying scores to real escape outcomes. **Depends on (1).** Effort L.
- **🔜 (3) — `resolve-review-loop.sh` consumes `verify_strength`** — fold the (2) score into the existing risk/density machinery (weak suite ⇒ more review depth; strong ⇒ less). Must be additive (byte-identical prefix + appended keys, like `--domain`/`min_panel_size`) and fail-safe (unknown ⇒ weakest ⇒ most review). **Depends on (2)** + the trust-tiered-review policy. Effort M.
- **Trigger** (for 2/3): after precursor (1) is in use and a strength-scoring instrument can be calibrated, OR next time changing `resolve-review-loop.sh` density/risk inputs.
- **Source**: `docs/plans/2026-07-08-observation-first-skills.md` § Non-goals / Scope C.

### ✅ DONE (2026-07-08, v2.32.9) — resolver `min_panel_size` emission (family-agnostic)
- **Resolution**: `resolve-review-loop.sh` now emits a standalone integer `min_panel_size` (config key `min_panel_size`, default 3, fail-safe on garbage/`0`/negative), `--field`-accessible, appended as the last data key (byte-identical pre-existing keys); Node twin validates it (`REVIEW_LOOP_FIELDS` + `Number.isInteger && >= 1`). Emitted SEPARATELY from `required_review_families` (lens diversity ≠ family decorrelation; same-family lenses can share blind spots). The five consumer prose-floor sites (`l4` SKILL, `level-front-door.md` ×3, `quality-pipeline/references/code-review.md`) now read「must not drop below the resolver's `min_panel_size`」instead of「until `min_panel_size` exists」. Guarded by 12 new `hooks/tests/resolve-review-loop.test.sh` assertions (default / override / garbage-and-below-floor fail-safe / `--field` / independence-from-families / density-on emission / schema-lock) + the resolver schema-lock test extended.
- **Trigger** (original): next time changing `resolve-review-loop.sh` panel emission/enforcement, OR before removing the homogeneous ≥3-lens prose floor.
- **Source**: `docs/plans/2026-07-08-observation-first-skills.md` § Non-goals / Scope C.

---

## Resolved (kept briefly for traceability; prune when stale)

- **README.zh-TW.md staleness + no drift guard** — ✅ RESOLVED 2026-06-22 in three passes: (1) skill count 6× "16"→"20" + hook badge/Tier-B; (2) full structural sweep — backfilled the gutted Install section (5 platform subsections), Hooks Secret-Detection + Override, and consolidated the split/duplicated Inspired By (added task-tree entry, removed the fired deferral note); (3) shipped `scripts/check-readme-parity.js` (preflight #15) asserting every shields.io badge value matches EN + `##`/`###` section-count parity. The guard immediately caught a stale zh version badge (2.7.0 vs 2.19.1) the manual sweeps had missed. Period-accurate historical prose numbers (e.g. "v2.5 新增 14 個 hook") are out of scope by design.

- **hook inventory reconciliation (4 inconsistent sources) + "Hook tally is stale (12 default-on)"** — ✅ RESOLVED 2026-06-22 (these were two entries, 2026-06-22 + 2026-06-02, describing the **same** drift; folded into one fix). Established a single source of truth: `scripts/check-hook-inventory.js` derives the canonical tally from real wiring — **8 default-on** (`hooks.json`) + **7 opt-in** (`settings.example.json` `hooks-opt-in-examples`) + **5 disabled** (`hooks/*.{js,sh}` wired nowhere = v2.7.4 batch) = **20 total**. The 4 canonical descriptions (`.claude-plugin/plugin.json`, root `plugin.json`, `marketplace.json`, `CLAUDE.md`) now read `20 hooks (8 default-on, 7 opt-in, 5 disabled)`; README.md + README.zh-TW.md + hooks/README.md tier tables rebuilt to correct **membership** (they had listed the 5 disabled hooks as Tier-A default-on while omitting the 5 actually-wired — a count-only check would have missed it). `check-hook-inventory.js --check` asserts counts AND per-tier membership, wired into `preflight-portability.sh` (#11). `sync-version.js` was de-coupled from hook-count ownership (3-tier-aware fragment mirror; `--disabled-count`; README hooks badge + hooks/README ceded to the new script); its 6-test suite + AGENTS.md updated. Historical counts (README "v2.5 added 14 hooks", devteam-absorb narrative) deliberately left as period-accurate. Residual: zh-TW skill-count "16" (separate drift, new backlog entry above).

- **`.opencode/skills/` stale mirror** — ✅ RESOLVED v2.17.2 by **deletion, not a sync script**. The 2026-06-12 entry mischaracterized it as a mirror needing sync; investigation found `.opencode/skills/*` was a `bf0c637` (2026-05-22) leftover the portability-correction plan already decided to remove (`docs/plans/2026-05-22-multi-agent-portability-correction.md` step 24: "把 `.opencode/skills/*` 整個目錄移除", rationale §I1 "多一條 = 多一條 drift surface"). OpenCode discovers all 19 skills via the `.agents/skills/ → ../skills` symlink — confirmed live by `preflight-portability.sh` check #11 (`opencode debug skill`) post-deletion. Building a sync script would have perpetuated the duplication the architecture was designed to avoid. Date 2026-06-15.

- **resolve-dispatch.sh tree-role integration** — ✅ shipped v2.17.0 (project `docs/projects/2026-06-12-tree-role-dispatch/`): `--tree` context flag (role vocabulary shared with `resolve-doa.sh`), `manager` refusal exit 3, `tree:<role>` override rows, sanitization + env seam parity with resolve-doa. Date 2026-06-12.

- **agents/_bodies/*.body.md surface as dispatchable agents with NO tool allowlist** — ✅ fixed by relocating bodies out of the CC agent scan path, date 2026-06-11.
- **Nested subagent (depth=5) integration** — ✅ shipped v2.14.0 (project `docs/projects/2026-06-11-nested-dispatch-integration/`). Both triggers fired 2026-06-11: CC v2.1.172 changelog ("Sub-agents can now spawn their own sub-agents (up to 5 levels deep)") + nest-probe green (explicit grant honored; children get `Agent` not `Task`; v2.1.170 negatives were server-side rollout lag). Landed with two upgrades over the original proposal: blind-dispatch rule is **context-indexed** ("verdict dispatch only from depth 0" — closes the fixer→verify-my-fix hole), and depth ≤ 2 policy has a single canonical home (`agents/README.md` § Orchestration). See CHANGELOG v2.14.0.

### ✅ DONE (2026-06-24, v2.25.1) — sync-version.js: omitting `--disabled-count` silently dropped the "N disabled" hook fragment
- **Resolution**: `scripts/sync-version.js` now backfills omitted `--opt-in-count` / `--disabled-count` from the canonical description's CURRENT values (new `readCanonicalCounts()`); the historical literals (7 / 0) apply only when canonical is unparseable. A bump that only changes `--version` can no longer clobber the disabled tier. Guarded by `hooks/tests/sync-version-preserve-counts.test.sh` (9 assertions: preserved-on-omit, explicit-flag-still-overrides, mirror parity). The v2.25.1 bump itself dogfooded it (omitted both flags; `11 opt-in, 1 disabled` survived).
- **Trigger** (original): next version bump via `scripts/sync-version.js`, or next time the hook description format changes.
- **Context** (original): `disabledCount` defaulted to `0` when `--disabled-count` was omitted, so a bump that forgot the flag rewrote "H hooks (D default-on, O opt-in, X disabled)" → "H hooks (D' default-on, O opt-in)" — silently clobbering the `disabled` tally and miscomputing default-on. Hit 2026-06-22 during the v2.20.0 bump; worked around by hand-editing the mirrors.
- **Effort**: Fix (S) — done.
- **Source**: retro 2026-06-22 (codeforge doc-drift-system session); workaround in autopilot v2.20.0 bump.

### OS-sandboxed hetero reviewer (hard isolation on untrusted diffs)
- **Trigger**: reviewing genuinely-untrusted diffs (external PRs / supply-chain) through a hetero reviewer, OR a review host gets `bwrap` installed.
- **Context**: `dispatch-review.sh --runner cc-shim|grok|agy` reviews an UNTRUSTED diff (prompt-injection surface) but none is a hard OS sandbox. cc-shim minimizes surface (`--tools ""` all tools off + `--setting-sources project` + `--strict-mcp-config` + `HOME`/scratch cwd + no skip-permissions; adversarially verified no tool-execution on an injection diff) but is NOT sandboxed. The only OS-sandboxed reviewer is `codex --sandbox read-only`, real ONLY with **bubblewrap (bwrap)** installed — absent on the current host, so codex degrades to bypass too. Surfaced by a gpt-5.5 review loop (v2.26.10) correctly noting surface-reduction ≠ OS sandbox. Same class as the test-integrity-L1 deferral (no local-only mechanism is malicious-proof without a real isolation boundary).
- **Options**: (a) install `bwrap` on review hosts → codex becomes the hard-isolation reviewer (cheapest); (b) review untrusted diffs on a disposable/sandboxed host or container; (c) a `bwrap`/landlock-gated reviewer wrapper for cc-shim/grok. Until then docs cap the claim at "best-effort surface reduction, not a hard sandbox."
- **Effort**: L (mostly ops/packaging).
- **Source**: gpt-5.5 cc-shim-reviewer hardening loop, 2026-06-30 (v2.26.10).

Shipped items are tracked in [`CHANGELOG.md`](../CHANGELOG.md) (source of truth). Last pruned 2026-06-02: v2.7.5 test-suite + v2.7.6 hook-polish items A/B/C.

### cross_family_satisfied 是 boolean,無法表達 required_review_families=2 的「≥2 個相異家族」語意

> 來源:v2.32.0 qc panel(gpt-5.5)。**Pre-existing**(v2.25.11 risk-tier 起 required=2 與 boolean satisfied 即共存),非 density-scaling diff 引入;density scaling 沿用同一合約。
- 現況:`CROSS_FAMILY_SATISFIED` 只表達「panel 有 ≥1 家族異於 implementer」;`required_review_families=2` 時,單一相異家族也會 satisfied=true,`--enforce` 不會擋。
- 修法方向:改為計數制 — `families_distinct >= required_review_families` 才 satisfied;`--enforce` 同步。注意 KR:預設輸出 byte-compat(欄位值語意變更需 CHANGELOG 明示)。
- 觸發:下次碰 `resolve-review-loop.sh` 的 enforce/panel 邏輯時;或高風險 diff 實際依賴 required=2 語意時。
- ✅ RESOLVED 2026-07-05 — counting semantics implemented (this commit); entry retained for history.

### 🔬 foreman↔depth-0 協調：liveness query + ownership lease + 插隊/steer 通道（l6-resilience R6-research）
- **部分結案 (v2.32.27)**: 缺口 (1) liveness/state query 的「感知」半邊由 `scripts/watch-foreman.js` 落地（ledger stage/heartbeat + leaf manifest 合流事件；QUIET/STALL 皆 report-only、內嵌「別搶 stage」守則；front-door § Live sensing 儀式化：派遣前指定 ledger 路徑、foreman 心跳義務、depth-0 Monitor）。仍開放：{working/waiting/blocked/dead} 的**可靠分辨**（心跳靜默仍是模糊訊號）、(2) ownership lease 結構性防撞、(3) 插隊/steer 通道。
- **再部分結案 (v2.32.32-33, 2026-07-15 /l5 兩連 ship)**: 缺口 (1) 的葉歸屬升級為譜系真相（v2.32.32 dispatch lineage：manifest `parent_run_id`/`root_run_id`/`depth` + env 契約 + `watch-foreman.js --root` 零交叉歸屬 + `autopilot status runs --tree`；時間窗啟發式僅剩無譜系舊 manifest 的誠實退路,標 `attribution=time-window`）。缺口 (3) 以 **advisory 層級** land（v2.32.33 directive channel：`run-ledger.sh directive-send/poll/ack` generation+nonce 圍籬、pi-rpc supervisor mid-run steer 遞送＋供應方 ack、CC foreman stage 邊界 poll 儀式、batch runner 誠實標不可達；queue-and-deliver-at-boundary、絕不奪權）。仍開放：{working/waiting/blocked/dead} 可靠分辨、(2) ownership lease 結構性防撞、Stage 3 自適應調度 policy（steer 探詢→無回應才砍、re-dispatch — directive 通道是其遞送底座,policy 本身未做）。
- **Trigger**: 下次多 foreman 並行 /l6 campaign；或 R0 ledger（run-ledger.sh）已 land 可當協調底座時。
- **Context**: 2026-07-08 l6-resilience 實作 campaign 實痛——depth-0 把 foreman **回合間的正常驗證**誤判成 stall → 跳進去搶做同一 handler → two-cooks 撞 shared `.git`/worktree → 再加 depth-0↔foreman 訊息交錯（crossed messages）對 R5 擁有權誤解、差點互等死鎖。根因＝foreman↔depth-0 缺可靠協調機制。
- **缺口三塊**:
  - (1) **Liveness/state query**：廉價可靠分辨 {working-between-turns / waiting-on-detached-child / blocked-needs-input / dead}。現 `idle_notification` 太粗（"available" 歧義）、`ps`/`git` 輪詢會誤判（正是本次誤判來源）。
  - (2) **Ownership lease 結構性防 two-cooks**：depth-0 與 foreman 不得同時動同一 artifact。**R0 ledger 的 lease/generation/nonce 是現成底座** → R6 建在 R0 上：depth-0 讀 ledger 看 stage 活性（非 ps 輪詢）、owner lease-gated，搶同 stage 結構上不可能。
  - (3) **Interrupt/steer 通道 + 訊息排序**：foreman 在**工作中**（非只回合間）檢查的優先「插隊」通道，或寫進 ledger 的 directive；並處理 crossed-message（明確「誰現在擁有這決定」的 handshake / lease token）。
- **副產物守則**（已可先用）: 多 agent 看似停頓，先查是不是正常回合間工作（ledger/log/ps 交叉），**別急著接手**——本次 foreman 全程能幹（診斷比 depth-0 深、主動協調），撞車全因 depth-0 觀測不足 + 反應過快。
- **Effort**: L（research→design→impl；與 R0-R5 同 plan `docs/plans/2026-07-08-l6-resilience-improvements.md`，建議收為該 plan 的 R6）。
- **Source**: l6-resilience R1–R5 dogfood campaign 協調事故，2026-07-08。fix-pass 輪（同日）再添 4 例：foreman 收到 depth-0 指示後未起跑即 idle ×2（需顯式「立即動工」nudge）、完成回報與 depth-0 指示 crossed-messages ×2（雙方快照互相過期）——強化本條 priority。

### ✅ DONE (2026-07-08, develop `c35dc88`) — l6-resilience R0-R5 + fix pass merged
- **Resolution**: fix pass 於 `fix/l6-fixpass` 完成後 merge develop。原 4 Critical/6 Major 全修；re-qc（gpt-5.5/gemini-flash/sonnet 跨家族 panel＋depth-0 親驗，涵蓋全 6 支含 R1）再揪出並修復：run-ledger 5 組重複函式定義（stale 早期版僅靠 bash 後定義蓋前碰巧未生效）、`command_init` 無鎖截斷、**M1 TOCTOU 實際未修**（原 harness 過關靠 generation fencing 巧合）、`stale_ignored` marker 世代污染（修＝generation-scoped 三步驟解析＋確定性重現 test；fix round 的鎖內 re-read 自身引入、engine verify 輪抓到）、stage-acquire 鎖外算 gen、engine fallback Map 無界、resilience test 空洞斷言、setsid 缺失 fallback、classify a/b 連續 strip 過剝、detach stderr sidecar、`PACKED_PROMPT_TEMP` detach 交棒、R4 doc 錯用無網路 `endpoints doctor`（改 `endpoints test`）、裝飾性 `risk_family_decorrelation_always_on` key（實際強制力在 engine `ensureDistinctReviewFamily`）。驗收＝depth-0 親跑 108/110（2 失敗與乾淨 develop baseline 一致）＋concurrency test 15 連跑綠。R1 detach 測試（真 kill -9＋heartbeat＋resume）被 panel 評為全 diff 驗證最扎實部分。

### M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
- **Trigger**: 下次把 `evals/orchestration/tasks/t15-cache-invalidation`、`t16-findings-triage`、`t17-purity-invariant` 用於對抗性 implementer 情境（`/l5`、`/l6` hetero 派遣、或任何候選碼不可信的場合）。
- **Context**: 這三個 oracle 的判分 python 與候選碼在**同一個 process** 內執行，候選模組 import 時可用 `sys._getframe()` 走訪呼叫端 frame 的 globals/locals，撈出判分器從未匯出的密鑰。opus 2026-07-09 對抗性重攻實測兩條可靠（5/5 PASS）exploit：N2（t15）——撈出真 `NONCE` 偽造 token 且從不呼叫注入的 `compute_fn`，fidelity 與 cache 軸皆假過；N2'（t17）——重同步 purity 檢查區塊的 `snapshot` 局部變數，一邊 mutate 一邊讓 `snapshot == recs` 恆真。R2 硬化（4 條 planted-file/env/stdout 攻擊）已修好且仍成立，但這條 in-process introspection 類別是**架構性**盲點，不是 R2 修復範圍。真正封死需要候選函式呼叫跑在與判分器分離的 subprocess/interpreter（process isolation），對映 `check-test-integrity.sh` L1 block-mode 在 CLAUDE.md 已記錄的同一結論（no local-only same-process mechanism 對抗同帳號候選碼是防偽的）。
- **Effort**: L（redesign，非修補）。
- **Source**: opus 對抗性重攻，2026-07-09。`docs/projects/2026-07-09-m3-band-tasks/report.md` § "Residual: in-process introspection"。

### 單輪任務對 M3 判別是死路 — 要量 pack/procedure lift 需轉向 long-horizon
- **Trigger**: 下次想造「更難」的單輪任務去判別 MiniMax-M3（或同量級模型），或想量測 pack/procedure 在 M3 頻帶的行為差異時。
- **Context**: t15-t17（兩軸判別任務，含 fidelity/decoy 雙軸設計，專為在 M3 頻帶內找 headroom 而建）校準結果 M3 全數天花板 —— n=3/cell，3 任務 × 2 arm × 3 軸，**18/18 全過**，含各任務刻意設計來誘使 M3 抄捷徑的軸（disable-cache / over-fix-decoy / mutate-under-pressure）。ON（pack）與 OFF 亦無可測差異。與 t1-t13 同命運。這重申 2026-07-06 archive 的結論：M3 的判別訊號（若存在）在 long-horizon（t14 型）任務，不是再加單輪任務難度。
- **Options**: (a) 直接轉向擴充 t14 型 long-horizon 任務的判別力；(b) 若仍要單輪任務，需要質變的難度設計（非本次「兩軸」思路的漸進強化）；(c) 接受 M3 在單輪任務上已無 pack/procedure 可測 lift，把校準資源移往其他頻帶或其他量測維度。
- **Effort**: M。
- **Source**: `docs/projects/2026-07-09-m3-band-tasks/report.md` § Results，2026-07-09。

### verification-authoring rails 三件小缺陷（author 唯讀契約／leakage 誤判／polarity tripwire）
- **Trigger**: 下次碰 dispatch-author.sh / dispatch-review.sh，或再用「先寫 buggy-behavior 斷言、修復後翻極性」的 harness 授權流程時。
- **Context**: (1) `dispatch-author.sh` agy runner 於失敗嘗試時直接寫雜檔進目標 worktree，違反自身文件宣稱的 no-repo-mutation 契約；(2) `dispatch-review.sh` 的 prompt-leakage 偵測把格式正確的 VERDICT/FINDINGS 回覆誤判為 leakage（raw_log 乾淨，需人工繞過）；(3) 「pre-authorized polarity flip」慣例無結構性 tripwire（如 grep-檢查的 marker）強制翻轉發生於 ship 前——本次靠 foreman 自律完成（`bd1a96d`）。均為 2026-07-08 campaign 實測。
- **Effort**: S 每件。
- **Source**: l6-resilience campaign deviations ledger，2026-07-08。

### capability-state quota 身分缺 endpoint 維度＋local runner 語意未定
- **Trigger**: 第一次要記錄 metered endpoint（MiniMax/GLM via cc-shim / anthropic-compatible）的 quota 觀測時；或第一個 local runner（ollama 類/pi 指本機）接線時。
- **Context**: 2026-07-14 status CLI 設計檢討（cookys 指出 hetero 引擎多來源）：quota 的錢包身分依來源類別不同——訂閱=vendor 池（runner+model 夠用）；**metered endpoint=錢包在 NAMED ENDPOINT**（同 model 走不同 endpoint 是不同錢包，store 事件目前無 `endpoint` 欄→身分歧義）；**local=根本沒有額度概念**（該記 availability/load）。顯示層已修（v2.32.30 source-class 分組＋各類正確措辭＋metered 標明歧義），store 端待做：(a) capability 事件加 optional `endpoint` 欄並進 merge 身分（比照 scorecard effort/model 的 tuple 擴充經驗——注意 R7 教訓：身分鍵要保留既有維度只加不減）；(b) local 類的 capability shape（availability 而非 quota enum）。**別提前建**：等 producer 出現才加，避免無人寫入的 schema 面。部分供應商可能有餘額查詢 API（如 MiniMax）——未驗證，接線前先 Spike。
- **Effort**: S（endpoint 欄）＋S（local shape）。
- **Source**: 2026-07-14 status-cli 設計討論。

### ✅ DONE (v2.32.25) — engine in-loop 去相關 review 對預設 roster（openai×openai）結構性死路
- **Trigger**: 下次調 review-loop 預設 roster、改 `modelFamilyOfEngine`、或發現 /l5 run 的收斂全靠 verify-first 而 review round 一直 `reviewer_family` blocked 時。
- **Context**: 2026-07-13 /l5 e2e 實測發現（非本次 tier 引入，是既存結構）：`ensureDistinctReviewFamily` 把 gpt-5.5 / gpt-5.6-sol / gpt-5.3-codex-spark 全映成 `openai`（regex `(gpt|codex|o1|o3|o4)`），而預設 roster 的 implementer（codex-spark）與 reviewer（gpt-5.5）同家族 → engine `implement-review` 的 in-loop review **永遠**在 `reviewer_family` 閘被擋，收斂實質上只靠 verify-first；低風險 tier（sol，亦 openai）同樣過不了這關。深層問題：家族去相關要求與「reviewer 選同 vendor 最強模型」的 roster 選擇互斥——真去相關的 in-loop reviewer 得選 MiniMax/GLM/gemini/claude 家族（claude-haiku 已 qualified，但 tier 設計是同 runner，claude-native ≠ codex → 單一 `reviewer_runner` 欄位的限制也一起浮出）。候選修法：(a) roster 預設改跨家族 reviewer；(b) tier 欄位補 `reviewer_runner_low_risk`；(c) family gate 對 low-risk 降為 warn。需要設計討論，不宜順手改。
- **Effort**: M（含設計）。
- **Source**: 2026-07-13 /l5 low-risk tier e2e（foreman ledger `reviewer_family: blocked` + depth-0 verify）。

### ✅ DONE (v2.32.25) — reviewer_qualified 資格檢查未覆蓋 low-risk tier 代換後的 reviewer
- **Trigger**: 下次碰 resolve-review-loop.sh 的 --check-scorecard 段或 engine reviewDiff 的 reviewer_qualification 閘，或 low-risk tier 引擎的 scorecard 過期（gpt-5.6-sol 2026-10-11）時。
- **Context**: v2.32.23 e2e 實測前發現：`reviewer_qualified` 由 resolver 對 `reviewer_engine`（incumbent）計算；`reviewDiff` 的 overlay 代換發生在其後，代換進來的 `reviewer_engine_low_risk` 引擎不受 fail-closed 資格閘覆蓋（若 sol row 缺席/過期，閘不會擋）。目前緩解：sol 已有正確 id 的 qualified row（event 59）。正規修法候選：(a) resolver 在兩鍵皆設時對 low-risk 引擎也查 scorecard，emit `reviewer_qualified_low_risk`；(b) 或 reviewDiff 代換後以 effective engine 重查。附帶：scorecard row 的 engine id 慣例應等於 roster 欄位值（`gpt-5.6-sol`，不含 effort 後綴——effort 不是 identity 維度）；首登記的 `gpt-5.6-sol-high` row 為 id 慣例錯誤示範，留存無害。
- **Effort**: S。
- **Source**: 2026-07-13 /l5 low-risk tier e2e 前置檢查。

### codex spawn_agent model 欄位被鎖 — 追蹤上游、解鎖後撤 opt-in 文件
- **Trigger**: codex CLI 升版（`codex --version` 變動）、codex-host user 回報 spawn 400、或 openai/codex #31814 / #31097 / #26868 有 maintainer 回應／關聯 PR 時。
- **Context**: 2026-07-13 Spike（0.144.0 + gpt-5.6-sol，rollout-artifact 驗證）：`spawn_agent` 預設 schema 只有 3 欄（`model` 被 `hide_spawn_agent_metadata=true` 拔掉＋伺服器端 reserved `collaboration.*` schema 鎖死——只翻 flag 每 turn 400）；官方 `~/.codex/agents/*.toml` 的 `model` 欄在 0.144.0 被無視（child 繼承父模型，#26868 類仍活；另 agent 名限 `[a-z0-9_]`）；唯一實測可用解 = 兩行 opt-in（`hide_spawn_agent_metadata=false` + `tool_namespace="agents"`，缺一不可）。已系統性記載：`references/multi-agent-portability.md` § spawn_agent MODEL routing（Spike 證據）＋ `platforms/codex/README.md` § Subagent model routing（user opt-in 指南，autopilot 絕不代改 user config）。重驗探針：一句 `codex exec` 要模型印出 spawn_agent 參數 schema（3 欄=仍鎖、7 欄=已開）。上游解鎖（官方 TOML model 生效或預設曝欄位）後：更新兩處文件、撤 opt-in 建議。
- **Effort**: S（重驗＋文件更新）。
- **Source**: 2026-07-13 spawn_agent 深挖（4 探針實測＋`multi_agents_spec.rs` 原始碼對照）；使用者要求系統性正規解（非單機 config 結案）。

### dispatch 大型 calibration/eval scratch 改走非配額路徑（usrquota 事故殘項 d）
- **Trigger**: 下次跑 `calibration.sh` / swe-calibrate 類大型 clone 校準，或 `/tmp` per-user 用量再度異常成長時。
- **Context**: 2026-07-13 /tmp usrquota 撐爆事故（cookys 名下 ~21.3 GiB → EDQUOT → 整台機器 Claude Code Bash 假死；`df -h` 全域量誤導，probe 法=直接寫檔看 "disk quota exceeded"）。四個修法中 (a) 各 dispatch 腳本啟動 prune 自家過期 log/scratch（`scripts/lib/prune-tmp-residue.sh`）、(b) manifest reaper（`dispatch-status.js --reap`）、(c) hooks/tests 全域 TMPDIR 重導＋trap 鏈修復 —— **均已於 v2.32.22 出貨**。剩 (d)：`swe-calibrate-*`（44 個 ×~110M）這類大型校準 clone 仍寫 `${TMPDIR}`，單體大、非逐日累積，mtime prune 不合適；候選 = 改預設寫 `~/.autopilot/scratch/`（非配額路徑）+ 完跑即清。附帶教訓（已入 memory）：清理腳本的排除清單必須套用到**所有** phase——dirty-skip 的 worktree 曾被後續 glob 撈走刪掉。
- **Effort**: S。
- **Source**: 2026-07-13 session 實地診斷＋v2.32.22 fix/tmp-residue-retention。

## dispatch worker git-identity containment（2026-07-16, Test Bot 事故）— ✅ SHIPPED v2.32.51

RESOLVED 2026-07-17（ported onto develop as v2.32.51）：dispatch-hetero.sh / dispatch-author.sh 快照消費
repo 的 user.name/user.email，drift ⇒ 用 `git -C <repo-root>` 還原 + 結果 JSON 加 `identity_drift:true`
+ 大聲警告（不回顯值）。Implemented by grok-4.5 under the strict-contract dispatch rail; ported
onto v2.32.48 by grok-4.5.

## identity rail on dispatch-author non-strict path（2026-07-17, 低優先）

- MiniMax aggregate review 指出：dispatch-author.sh 的 identity 快照/還原 gated on REPO_ROOT，
  而 REPO_ROOT 只在 --strict-contract/--strict-roster 設；非 strict 的 explicit-CLI author 派遣
  REPO_ROOT 空 ⇒ identity rail 靜默停用。**非 regression**（原本無 rail）、**非事故面**（author
  是 read-only rail：scratch cwd、不建 worktree、不 commit，worker 改不到消費 repo config；
  Test Bot 事故發生在 hetero write 路徑）。完整性 follow-up：讓 author 非 strict 路徑也 fallback
  到 `git rev-parse --show-toplevel` 取 repo-root。
- detach path 已查核為正確（IDENTITY_REPO_ROOT 在 dispatch_detached_run 的 declare -p 序列化
  列表、snapshot 在 detach fork 前的 parent main flow、值傳入 child）——碼序＋序列化＋對抗實證
  三證，但尚無端到端 detach drift 實測（目前無呼叫者傳 ledger coords，低風險）。

## broader shared-config containment / per-worktree isolation（2026-07-17, follow-up）

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

## dispatch-hetero strict postcheck emits empty status（2026-07-17, /l6 identity-port 兩次重現）

- **Symptom**: strict-contract + detach 座標（--ledger/--run-id/--stage）下，worker 正常
  committed、boundary/acceptance 在 depth-0 重跑全綠，但 result JSON `status:""` + exit file=1、
  `error:null`、無 `boundary`/`acceptance` 欄位。同一 session 兩個 run 皆重現
  （u1-identity-port-1784269379、u1b-identity-fix-1784270435）。
- **Evidence**: depth-0 以相同 range 重跑 `check-disjointness validate`（disjoint:true）與全部
  5 條 acceptance argv（oracle PASS 12、hetero-contract PASS 52、sync/parity/payload check 全 0）。
- **Suspects**: detached child 內 run_strict_contract_postchecks 的失敗路徑未設
  STRICT_POSTCHECK_STATUS 即 return？或 acceptance 巢狀 dispatch（oracle 測試本身跑
  dispatch-hetero）與 detach env 交互。需最小重現 + 修復；修復前 strict+detach 的空 status
  一律視為「需 depth-0 重驗」而非失敗定論。
- **Effort**: M。**Source**: 2026-07-17 /l6 identity-port run notes。

## agy 模型名稱漂移：`gemini-flash` 不再被接受（2026-07-17）

- **Symptom**: `dispatch-review.sh --runner agy --model gemini-flash` → agy 0.2.x 印模型選單、
  no_verdict。現行合法值為顯示字串（如 `Gemini 3.5 Flash (High)`）。
- **Impact**: `review-loop-config.md` qc_panel 的 `gemini-flash` 席位、所有硬寫 gemini-flash 的
  呼叫點會 fail-closed（no_verdict）。本輪 workaround：手動改傳完整字串（verified 可 review）。
- **Fix direction**: 在 dispatch-review/roster resolver 加 engine-id→agy 顯示名映射，或改
  config 值 + 更新 references/model-routing.md；加一條 agy 模型名 probe 到 harness-maintenance。
- **Effort**: S。**Source**: 2026-07-17 /l6 QC panel gemini 席 no_verdict 診斷。

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
- **Trigger**: Before these helpers are reused outside the current production Engine call sites or exposed to caller-supplied state/evidence.
- **Context**: Close the helper-level fail-open edges recorded as CED-N01, CED-N02, CED-N03, CED-N05, and CED-N06: require explicit spend projection, preserve/reject empty controller replacement, require repository authority, reject traversal internally, and make test evidence carry production-equivalent binding.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d1e3cafc6b25e4ccde534f237ecac97b66953f2c76b2d56df8a77993b916fd69 -->
### Boundary outcome and root dispatch semantics
- **Trigger**: Before boundary receipts drive automated recovery or parallel independent graph nodes under one root are enabled.
- **Context**: Derive or remove mutation_failed/unknown_status instead of hardcoding them, and decide whether root-wide nonterminal exclusion is intentional; if not, retain root CAS while scoping dispatch blockers to the exact graph node.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:ecc22ecefe311bf8a185548841308087b4c6c96cf2b73b3ca14471c005ba7bc5 -->
### Portable byte and Work Order lifecycle hardening
- **Trigger**: Before Mission paths may contain symlinks, generic Work Order imports are accepted, or reconciliation runs on restricted process-table platforms.
- **Context**: Unify symlink byte hashing with Git, reject/strip disposition_receipt on non-stale records, and convert PROCESS_TABLE_UNREADABLE into an explicit fail-closed Work Order classification.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d1d21b3988f6e89eff3964a1e5e56f12171fd4d3cf50b23634364d087380df26 -->
### Durable resume and review authority binding
- **Trigger**: Before automatic durable resume, reviewer roster rotation, seat retry, or more than one candidate per repair generation is enabled.
- **Context**: Make all durable stop payloads pass verbatim resume validation, bind full-diff barriers to the exact candidate and review kind, and include sealed reviewer roster/seat identities in full-diff and joint-review reuse keys.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:aed0cfc35dd07b4cabf1545ca4bdba4d0a308824eaa3b1631f3f6d9c9ce11811 -->
### Explicit findings identity authority
- **Trigger**: Before classifyMissingDisposition is reused or exported to any caller that may omit identity validation.
- **Context**: Remove the fail-open findingsIdentityOk default and require every classifyMissingDisposition call to pass an explicit identity verdict.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:42b943b1cd29c7de6d0b621337c605400ea73e33b531b47ee7d7b2dd04ccfc9f -->
### Mission graph and campaign capacity boundary hardening
- **Trigger**: Before graph hot reload/concurrent writers or caller-supplied non-default campaign capacities are supported.
- **Context**: Read Mission graph bytes once or bind the validation read to the inspected digest, and mirror max_owned_worktrees/temp_capacity_limit/max_prompt_bytes/max_finding_recurrence schema caps in the executable validator.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d574960cb87250d45554901630cdff86ddfd59f5d313a40e657bf7de3f7b7be3 -->
### Orphan leaf liveness and resource reconstruction
- **Trigger**: Before orphan adoption or resource inventory is used as closure/capacity authority after controller or worktree-creation crashes.
- **Context**: Persist and re-observe leaf process identity before orphan adoption; discover orphan branches and never-registered worktrees; mechanically re-derive active inventory rows.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:516726d963e606a0bf2ec621ad6962a0228863ff976a64a703be7bbd2d4a598d -->
### Terminal status and receipt trust boundary
- **Trigger**: Before external/legacy terminal receipts cross a trust boundary or the threat model expands beyond confused controllers.
- **Context**: Enforce the closed terminal_status enum at receipt validation and Work Order classification, resolve the unused attached disposition, and document integrity-hash versus producer-attestation guarantees under the confused-controller threat model.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:8f70c159902a5d75d701b775ac9378f53ec4e9380a2534cab6674bf06083d475 -->
### Shared sealed zero-diff validator
- **Trigger**: When the zero-diff schema next changes or a fourth production consumer is introduced.
- **Context**: Move sealed zero-diff receipt validation into one deterministic shared helper consumed by shell, Engine, and runner boundaries.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b
