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

## Audit snapshot（2026-08-28，post lifecycle-hygiene sweep）

- **65 real entries**：2 個 Board decisions、63 個 trigger 尚未成立的 conditional work；`<Topic title>` 範例不計入。
- Platform capability trigger activation 的 D1 closed claims、D2 agy structured usage、D3 Codex production recovery 與 D4 strict-L5 trust root 已由 depth 0 驗證完成，依 lifecycle hygiene 從 backlog 刪除而非保留完成態條目。
- 14 個 technical gaps（A01–A14）已由 [`next-touch-debt-retirement`](projects/_archive/2026-08-03-next-touch-debt-retirement/README.md) D1–D8 核銷並自本檔刪除。
- 14 個 struck-through RESOLVED/SHIPPED entries（2026-08-18 至 2026-08-27 累積）依同一 lifecycle hygiene 規則從本檔刪除（history 留在 CHANGELOG／git）；一個混合條目（`Contract-first escalation and local-repair gates`）因 class (a) 仍未出貨而保留。
- 63 個 conditional entries 主要是四類：等待仍未出現的外部平台／runner contract、等待 telemetry／事故樣本達門檻、等待新 runner／consumer，以及未來擴大 threat model／自動復原範圍才需要的 hardening。

---

### Apply two-tier + pooled verdict to reviewer/implementer/owner/verification_author/brain
- **Trigger**: a role's own eval corpus + scorecard-first ON/OFF evidence exists — a frozen, sealed
  case corpus for that role plus an OC characterization against it, produced the same way
  `docs/plans/2026-08-28-consult-discuss-qualification.md` + `docs/plans/2026-08-29-qualification-verdict-stability.md`
  D6 produced one for consult/discuss.
- **Context**: `foldPooledVerdict`, `(VERDICT_Z, VERDICT_TAU)`, and the D3 error-class → tier map
  (`scripts/engine-qualify.js`) are already written role-agnostic — they consume only per-case
  outcomes and a role's tier map — but `reviewer`/`implementer`/`owner`/`verification_author`/`brain`
  keep their existing single-administration verdicts (KR7, `docs/plans/2026-08-29-qualification-verdict-stability.md`).
  Switching any of them without that role's own eval evidence first would repeat exactly the mistake
  this plan corrected for consult/discuss (成績單前置 — CLAUDE.md). See
  `docs/plans/evidence/2026-08-29-verdict-stability/OC-CHARACTERIZATION.md` § "Generalization seam
  (deferred)" for the full reasoning.
- **Effort**: L
- **Source**: `docs/plans/2026-08-29-qualification-verdict-stability.md` D8

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
### `dispatch-review` raw-log deviation 採信判準必要但不充分 —— 回音的 prompt 樣板可冒充 verdict
- **Trigger**: 下一次 depth-0 依 P5 判準（2026-07-31）以 raw-log deviation 採信一個 `no_verdict` 席次時；或為 `dispatch-review.sh` 加任何 verdict 解析路徑時。
- **Context**: P5 立的採信條件是「verdict block 完整、nonce 匹配、block 閉合」。2026-08-08 codepower 的 qc panel 出現一個**同時滿足這三條、但內容是被回音的 prompt 樣板**的案例：`gpt-5.6-sol@codex` 在額度耗盡前只吐出 `VERDICT: SHIP-AS-IS or FIX-THEN-SHIP` / `FINDINGS: one finding per line, or the single word none` —— 那是提示裡的格式說明，不是答案；nonce 之所以兩端匹配，是因為 nonce 本來就寫在 prompt 裡。259 bytes、閉合、匹配，depth-0 差一步就把空回讀成 SHIP。三條判準無法區分「模型回答了」與「模型把題目抄回來了」。**建議補第四條：block 內容必須與 prompt 樣板實質不同**（例如樣板行的字面比對、或要求 FINDINGS 之外至少一個非樣板 token）。同一 run 另有一個相鄰案例可作對照：`MiniMax-M3` 的 block 內容是真的（4 條具體 MUST-FIX），只因多印一行未填的 `NO-FINDING-PROOF:` 樣板而被 parser 判 `no_verdict` —— **一個該擋沒擋、一個不該擋卻擋了**，兩者都指向「以樣板殘留為訊號」這個維度尚未被建模。
- **Effort**: S
- **Source**: codepower `f65f29a7` qc panel 裁決 §4b；raw log `/tmp/dispatch-review-log-WPI98b`（sol）與 `-WO5A1B`（MiniMax）
### Contract-first escalation and local-repair gates — P6D incident follow-up
- **Trigger**: An owner-approved corrective project is opened from the 2026-08-21 P6D incident record; before that project may claim completion, all three controls must have planted negative cases that demonstrate they can block (a) unjustified heavy dispatch for an acceptance-oracle task, (b) a staged manifest outside the declared allowlist, and (c) successor/pipeline escalation before one local artifact-repair attempt.
- **Context**: A bounded six-file/three-command consumer task was routed through strict L5 Mission governance. Its first candidate passed every functional verification but included two dependency symlinks; Codex then replaced a minute-scale amend with terminalization, successor adoption, governance churn, and full rerun. Fable 5 ruled this was two decision failures rather than a Git-only mistake. The corrective project should implement the smallest enforceable protocol from the incident: dispatch justification when a complete acceptance oracle already exists; pre-commit staged-manifest comparison against a machine-readable task allowlist; and a failure-response state machine that requires one local artifact repair before workflow-level expansion. Status-report budgeting is a controller interaction rule and must not be inflated into unrelated product machinery without separate evidence. Do not encode P6D's six paths or a blanket symlink ban as global policy.
- **Effort**: L (dispatch admission + commit manifest gate + failure-response transition contract + negative controls)
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026-08-21-p6d-orchestration-incident/README.md), including the quoted Fable 5 independent judgment.

### Foreman model is hardcoded as `opus` in /l4–/l6 prose; routing config already overrides it

- **Trigger**: any consuming project sets `tree:sub-orchestrator` in `.claude/model-routing-config.md`
  (revival.3d did on 2026-08-28: `sub-orchestrator → sonnet`, `judge → haiku`), or a cost audit shows
  the foreman dominating spend.
- **Context**: `skills/l6/SKILL.md`, `skills/ceo-agent/references/level-front-door.md` (§"Dispatching
  the foreman", Amendment 11 note) and `skills/l4/SKILL.md` state "foreman / sub-orchestrator = `opus`"
  as a rule, while `scripts/resolve-dispatch.sh --tree --role sub-orchestrator` correctly honours the
  project override (`source:"project"`). Evidence from revival.3d session `5ca9b104` (grok cost split,
  one day, ~25 lines): opus foremen 7,929 turns ≈ $1,081 (62% of spend), sonnet leaves 23%, the
  Fable depth-0 16%. Foreman work was ≥90% protocol execution (dispatch leaf, run probe, wait, run
  gates, write run doc); the 3–5 judgment points per line were criteria-driven and caught by
  pre-registered criteria, not by model tier. Owner decision: "smart at decision points, not in the
  supervision loop" — foreman = cheapest model that follows the protocol, judge reads the four-state
  criteria table, only BLOCKED escalates to depth-0.
  Three things to fix: (1) reword the three docs so `opus` is the *default* not the *rule*, and
  point to the routing override; (2) `hooks/dispatch-model-guard` (opt-in, Tier B) must read
  `resolve-dispatch.sh` output rather than assert `opus` for `sub-orchestrator`, else enabling it
  will reject a legitimate `sonnet` foreman; (3) offer a deterministic foreman shape — a Workflow
  script (`implement → verify-author → gates → harness → criteria table → escalate on BLOCKED`) —
  as the documented alternative to a model-driven foreman loop, since most foreman turns are
  deterministic.
- **Effort**: S (docs + hook read path) · L for (3) if shipped as a bundled workflow
- **Source**: revival.3d `15edf5e7` (routing override), `NOTE-FOR-FABLE-QUOTA.md` (grok cost split),
  revival.3d `docs/governance/dispatch.md`


### `probe-runner-coverage` parallel-only flake — fork-pressure suspected, residue ruled out

- **Trigger**: next time it reds in a `--parallel` run (it passes standalone).
- **Context**: 2026-08-28 suite-reaper reproduction split the old diagnosis — the residue leak
  was real (deterministic ~7+2+6 entries/run, now reaped by
  `hooks/tests/lib/suite-residue-reap.sh`), but seeding 110+ stale entries did NOT move the
  failure count (clean 4/283 vs seeded 3/283, no `/tmp` quota pressure on this host: 858G free,
  2% inodes); the one recurring flaky file was `probe-runner-coverage`, which failed on the
  CLEAN run — a pure file-parsing test, so residue cannot be its cause; 32-way fork pressure is
  the live suspect.
- **Effort**: Fix.
- **Source**: fix/suite-residue-reaper QC round, depth-0 panel + foreman reproduction logs, 2026-08-28.

### Suite reaper — symlinked-TMPDIR hosts fall back to rm -rf (git-worktree-remove path never engages)

- **Trigger**: first report of dangling `.git/worktrees` entries on a host with symlinked `/tmp`
  (e.g. macOS).
- **Context**: `_wt_is_registered_path` exact-string-compares realpath'd entry vs git's raw
  recorded path, so on symlinked TMPDIR the git remove path silently never engages (same
  behavior as pre-fix, not unsafe, just incomplete).
- **Effort**: S.
- **Source**: depth-0 qc panel 🔵, 2026-08-28.


### Implementer suite hardening backlog (pre-merge review round-1 cut list)
- **Trigger**: 下一次動 `evals/impl-eval-*`/`runImplQualification` 時捎帶;或第三場正式施測之前(屆時 Stage-0 機械化與 live-rail smoke 應先落);或 reviewer 再報同類。
- **Context**: v2.34.34 round-1 review 裁 CUT 的殘項(五個 MUST-FIX 已修:partial-corpus fail-open 雙層拒收、preflight prose-justification、dispatcher_called ETIMEDOUT 歸因、HELP、Stage-0 明文 operator-run):(1) **Stage-0 probe 機械化**(qualifier 內建 receipt writer + frozen-token literal containment + attempt cap 消費;現為 operator-run,程序在 engine-onboarding SKILL.md);(2) §7 未落 fixture 列:runner-config-editor、malicious-git-config(現為 neutralized-not-labeled——`repoHygieneViolations` 不掃 repo-local config)、replacement-ref、add-then-revert canary、dirty-worktree、question-staller、quota-phrase+exit1、parser/output-bomb、runner-crash;(3) §2 live-rail smoke(真 rail + `--runner-bin` deterministic engine + 兩紅控);(4) §6 consumer matrix (b)-(f)(凍結舊 validator 拒新 row 的負向、qualityOf T0 斷言、dispatch-contract/review-loop 分支、非 N/N 控制);(5) capability-evidence.test.sh 的 impl_dispatch 單元覆蓋;(6) TTL 30/31/90/91 邊界測試;(7) `--trials` 精確斷言;(8) cosmetics:`corpus_version` 重複字面(已凍進 event 143 rows)、dead `wrapDispatchBin`、no_verdict stub 上 stdout。
- **Effort**: M(合併一輪)。
- **Source**: autopilot:reviewer pre-merge round-1,2026-08-22;`docs/plans/2026-08-22-implementer-qualification-suite.md` §6-§8。

### agy output envelope invalid on create-a-new-file responses (blocks agy implementer qualification)
- **Trigger**: 下一次要考 agy 家族 implementer 時;或 agy 更新後 changelog/實測顯示 envelope 修復;或第二個非考級場景撞到 `agy native JSON envelope invalid`。
- **Context**: 2026-08-22 implementer 施測(agy 1.1.17):flash-high 6 案、pro(event 147)2 案、flash-medium(event 152)6 案 envelope FAIL + 2 案 stall——envelope 失敗案**全部**是建新檔任務且同簽名(family-wide、發生率隨 tier 降:medium 6/8+2 stall、high 6/8、pro 2/8);編輯既有檔的家族全過。六案 raw log 皆為 `agy native JSON envelope invalid — response and usage NOT parsed`——wrapper commit 已落(scored_sha 存在)但 agy 輸出信封壞損,rail fail-closed nonzero 路徑觸發。FAIL row(scorecard event 144)依凍結 taxonomy 常駐;修復後屬 fresh evaluation。修向在 agy 上游或 dispatch-hetero 的 agy envelope 解析側,先重現最小案例再動。
- **Effort**: Fix(重現+定位)/ 上游依賴。
- **Source**: `docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify/README.md`。

### `validate-json-schema.js` 拒絕所有非整數數字 —— 任何帶小數的 JSON 文件都驗不了
- **Trigger**: 下一個要 schema 驗證的 artifact 帶浮點數;或下一次動 `scripts/validate-json-schema.js` 的 `parseNumber`/`assertJsonValue`。
- **Context**: `parseNumber`(`validate-json-schema.js:161`)在 **schema 求值之前**的 document preflight 就把任何含 `.`/`e`/`E` 的數字字面量判為 `UNSUPPORTED_JSON_NUMBER`(exit 2),與 schema 內容無關;`assertJsonValue:71` 同樣要求 `Number.isSafeInteger`。這是刻意的 lossless round-trip 保守設計,但代價是**任何帶比例、分數、機率的 artifact 都無法被這支 validator 驗證**。v2.34.36 撞上:`references/official-qualification-defaults.json` 的 `capability_score` 是 `cases_passed/cases_total`(0.75、0.9166666666666666、0.9583333333333334、0.6666666666666666、0.9761904761904762 五筆,經機械掃描確認是整份 artifact 唯一的非整數)。當前作法是 `build-qualification-defaults.js` 把那些欄位正規化成 0 之後才送驗(schema 對該欄位只約束 number-or-null,披露區塊完全不受影響),並在 `references/qualification-defaults.md` 明寫這道限制 —— 不是修好,是**明說**。順帶發現:`schemas/hook-event.schema.json` 自己也不通過這支 validator(它用了不在 `SUPPORTED_KEYWORDS` 裡的 `description`)。
- **Effort**: S(接受有限精度浮點,或加一個明確的 `--allow-non-integer-numbers` 開關;要帶 planted negative 證明 lossless 保證沒被整體放掉)。
- **Source**: 2026-08-23 official-qualification-defaults 施工實測(run `official-defaults-l4`)。

### v2.34.37 first-pass review 的 cut list —— 六個「不是錯,但名字比保證大」的小項
- **Panel addendum(2026-08-23,depth-0 qc panel MiniMax-M3,verified)**:(7) `instant2` fixture 以 opaque 重錨構造 evidence(刪派生欄→`compileCapabilityEvidence`→手寫 `event_id:1`+重生 `transcript_hash`)——若日後 producer/anchor 契約收緊,該測會「錯因轉紅」;修向:改走 production `record` 同一 canonicalizer,或明文標注 seam 依賴 producer-hash 契約。(8) `instant2` 的 fixture 選取 filter 不驗 `engine/runner/role` 與 seat-hash 對齊——選錯來源列會報 opaque `RECORD_FAILED:` 而非清楚語意;修向:filter 收緊+shell 斷言對齊。
- **Trigger**: 下一次動這六處任一 —— `hooks/tests/external-lifecycle-witness.test.sh` 的 `stop_bounded` 斷言、`hooks/tests/calendar-teeth-negative.test.sh` 的 `instant3`/`instant4`、`scripts/engine-qualify.js` 的 `wall_truncated` 欄位、`scripts/engine-scorecard.js` 的 `startOfUtcDayMsOf`/`nowArgToMs`;或有 consumer 開始讀 `wall_truncated` 這個名字。
- **Context**: v2.34.37 first-pass review(autopilot:reviewer,opus)判 Low risk、無 🔴 無 🟠,兩枚 MUST-FIX 皆為文件用語已當場修掉。剩下六項刻意不在該刀處理,逐條記下以免被吞:(1) `measureBoundedStop` 的死 conjunct 已在該刀移除,但由此使 `stop_bounded` 與 `concurrent_stop_resolved` 成為**同一個 boolean、被斷言兩次**(`:920`/`:921`)—— 刪掉重複那條要先確認沒有別的讀者。(2) `instant3`/`instant4` 是對字面識別字 `todayMsUtc()` 的 awk grep,但 PASS 字串宣稱的是語義性質(「任何 UTC 午夜截斷都不存在」);換個名字寫回截斷仍會綠 —— 這是 evidence-discipline 的 shadow 形狀,行為面由 `instant1`/`instant2` 兜住,`instant4` 其實與 `sync-codex-plugin-skills.sh --check` 的 byte-parity 閘重複。(3) `wall_truncated` 在**計數 seam** 觸發時也為 true,名字比事實大;生產路徑上 seam 從 CLI 不可達,所以今天 `wall_truncated ⇔ 真的撞牆`,但改名 `truncated` 或加 `truncation_cause` 才誠實。(4) `startOfUtcDayMsOf` 用 `Number.isFinite` 守門,但 `new Date(ms).toISOString()` 對 ±8.64e15 之外的有限值會丟 `RangeError`;今天不可達(`toDateMs` 先擋、`Date.now()` 在範圍內),多一個 caller 就要改成 `Math.abs(ms) <= 8.64e15`。(5) `nowArgToMs` 的 `required = true` 分支在這刀之後**沒有任何呼叫點**,是死參數。(6) witness 測試失敗路徑的 `await Promise.all([firstStop, secondStop])` 沒有 timeout,真的掛住會讓整份 suite 卡死而不是印出 `stop_bounded=false` —— 與改動前形狀相同,非本刀造成。
- **Effort**: S(六項各自獨立,可隨手撿)。
- **Source**: 2026-08-23 v2.34.37 first-pass pre-merge review(autopilot:reviewer);run `fix-bundle-l4`。

### `engine-qualify-impl.test.js` 單次無法重現的紅(1/24 solo,訊息未捕獲)
- **Trigger**: 下一次它在 full-suite / CI 或 solo 跑紅(歸因半件)。**保存半件已做(2026-08-23)**:`hooks/tests/run.sh` L1 現在把 `node --test` 全輸出 tee 進 `/tmp/autopilot-l1-unit.*`,紅了保留並印路徑、綠了即刪(planted red 驗證訊息確實落檔)。solo 迴圈仍須自帶 `2>&1 | tee`——run.sh 管不到 ad-hoc 跑法。
- **Context**: 2026-08-23 v2.34.37 收尾期間,`node --test scripts/engine-qualify-impl.test.js` 在約 24 次 solo 連跑中出現**一次** `pass 0 / fail 1`;當時的 harness 只 grep 摘要行、沒有保留 log,`AssertionError` 的 message 因此**遺失**,無法歸因。事後立刻以保留 log 的 harness 連跑 10 次 + 另外多輪 solo 3 跑,全綠,兩次 `hooks/tests/run.sh --parallel 8` 全 275 檔綠。所以:**已知有一次紅、未知原因**,不宣稱已修、也不宣稱是 flake。可疑面向:同檔仍有 `testWallSecondsOverride: 0` 的零牆 fixture、以及 live-rail 派工會起真子行程(`impl-qualify-live-*` 暫存目錄、`fake-dispatcher` wrapper),機器極度吃緊時子行程失敗會以什麼形狀冒出來沒有被觀察過。修向:先把該測試的失敗輸出常態保存(`node --test` 的 stdout 全存進 artifact),再談歸因 —— 這正是「紅字部分為雜訊就不再被讀」那族危害的入口。
- **Effort**: S(先加保存,再看下一次紅)。
- **Source**: 2026-08-23 v2.34.37 收尾實測(run `fix-bundle-l4`),foreman 直接觀察。

### Brain-seat sittings in the shipped qualification defaults (v2 artifact)
- **Trigger**: a consuming repo asks to adopt an owner/brain seat without self-qualifying; or the Board schedules the fourth brain sitting and it PASSES (a passing sitting is the first brain row worth shipping as a default).
- **Context**: v2.34.36 ships official defaults for `implementer` / `reviewer` / `verification_author` — all scorecard rows. Brain-seat sittings are NOT scorecard rows: they are atomic `owner-brain-seat-v1` records in the capability store with their own semantics (forced `brain-seat` scope, no expiry, 3-strike revocation via `engine-capability-state.js brain-status`). Packaging them means a second record shape in the artifact + a second adoption path in `adopt-qualification-defaults.js`, and today all three recorded sittings FAILED (events 3/4/6), so there is nothing routing-useful to ship. Recorded as a deferral with a reason rather than forced into the v1 shape: `references/official-qualification-defaults.recipe.json` `excluded[]`.
- **Effort**: S(第二種 record shape + 採用路徑)。
- **Source**: v2.34.36 official-qualification-defaults ship;`references/qualification-defaults.md` § "What this does NOT do"。

### Durable repair-lock — 解鎖路徑先行,鎖才准回來(P6D KR3 的第二階段)
- **Trigger**: 無狀態拒絕被實測繞過(terminalization 之外的路徑把 BOUNDARY_REJECTED campaign 排水/succession 掉而未修復 —— 例如 host 直驅 reducer 的 no_effect_release);或 engine_terminal_evidence 欄位在真實終局分類點被接線(目前是死欄位)。
- **Context**: v2.34.32 原出貨 durable claim-bound repair lock + 四 Mission 後盾,pre-merge review 兩枚 🔴 殺掉:解鎖路僅存於 mission-v2 ready/follow_up 排水(legacy receipt 永無解)、bypass enum 欄位無生產寫入者(死碼)、projection roundtrip 不攜帶 lock(PROJECTION_HASH_MISMATCH 毒工件)、no_effect_release 一發繞過全部後盾、finalize-abort 冪等被打破。重來的入場條件(缺一不可):(1) engine-derived terminal evidence 在真實分類點接線且**能清除既有鎖**;(2) legacy receipt 顯式處理;(3) buildProjection/restoreProjection 條件式攜帶 + roundtrip fixture;(4) no_effect_release 拒絕帶鎖 claim(與 (1) 同時);(5) 鎖寫入前置(claim 非 terminal/released、mission 非 terminal)+ CLI 冪等分支順序;(6) 帶鎖 mission 可經 enum 抵達終局的 planted 測試。證據:reviewer 報告(probe-roundtrip/hashcompat/lockwrite/escape/idem 五腳本,project archive)。
- **Effort**: L(設計 + 六前置 + 測試)
- **Source**: 2026-08-21 pre-merge review(autopilot:reviewer);`docs/projects/_archive/2026-08-21-p6d-corrective-gates/`(歸檔後)。

### ~~Contract-first escalation and local-repair gates~~ — 2/3 classes SHIPPED v2.34.32; class (a) REMAINS OPEN
- **Trigger**(殘餘,class (a) 專屬): a mechanically valid oracle-completeness predicate exists — G1/G2 review refuted the R0 predicate ("output_paths+verify cmds" is EVERY Mission contract's shape); candidates recorded in plan §1: `required_change_paths` equality, or opt-in `complete_deliverable` flag + closed-enum unverifiable-property justification. KR1 must NOT ship (even as shadow) until then.
- **Context**: 原三控制中兩個已出貨且各有 planted negative + dead-gate mutation kill:(c) repair ladder(`src/engine/repair-ladder.js`,無狀態形:terminalize 邊單點拒絕;零 delta 轉終局被拒)與 (b) pre-commit manifest gate(`check-disjointness --staged` + dispatch-hetero wrapper staging 攔截;P6D 雙 symlink planted red)。(a) unjustified heavy dispatch 未出貨——G2 terminal 裁決 KR1 連 shadow 都砍(對已否證述詞做 shadow 產生不可解讀資料)。report budget 依事故記錄邊界維持非產品。
- **Effort**: M(class (a) 述詞設計 + enforce campaign,需新 plan + review)
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026-08-21-p6d-orchestration-incident/README.md);plan `docs/plans/2026-08-21-p6d-corrective-gates.md`(R2' FROZEN)+ 兩代 review 證據。
### Skill contract-card rewrites under 成績單前置（G2 MiniMax R8）
- **Status**: dev-flow leg RESOLVED-NO-SWAP（2026-08-18,[plan](plans/2026-08-18-dev-flow-contract-card.md)）— 儀器（evals/skill-onoff）、規格（references/skill-contract-card.md）、P4 baseline 機制已出貨;primary block 63 runs 機械裁決 **INSTRUMENT-INVALID（V2 vacuous,1/5 家族承重）**,card 不出貨（見下方「dev-flow card re-attempt」row）。quality-pipeline leg 留本 row,前置改為:skill-onoff 儀器修復並通過 V2。
- **Trigger**: 四層 redesign 的 Policy 層設計定案,且目標 skill 有 eval ON/OFF 證據（成績單前置）
- **Context**: 童子軍規則的漸近線——把重量級 skills（dev-flow、quality-pipeline 候選）改寫為 contract-card shape（trigger/inputs/decision-table/engine-pointers）。未評測前不得重寫。
- **Effort**: L
- **Source**: G2 review finding（MiniMax R8, 2026-08-16）;strategy thread 2026-08-16

### dev-flow card re-attempt — instrument repair first (V2-vacuous verdict 2026-08-18)
- **Trigger**: A new evidence campaign budget is approved AND the skill-onoff task set is repaired so ≥4 of 5 families are load-bearing (per the frozen V2 rule). Repair directions from the data: harder tasks where sonnet's base rate drops (F1/F5 ceilinged: OFF 6/9, 5/6); an observable for F6/F4 that survives headless (or multi-turn runs); consider a weaker-model primary block. **The old F6 marker is now invalid** — P7 (2026-08-18) scoped the quality-gate rule by size, so a Fix-size task legitimately satisfies it with lint+test; a marker still requiring `Skill(quality-pipeline)` would measure a claim the body no longer makes.
- **Context**: The 499-line card draft is digest-frozen at `evals/skill-onoff/packs/dev-flow-card/` and was NON-INFERIOR on the only load-bearing family (F3 branch discipline: FULL 9/9, CARD 9/9, OFF 0/9 — total discrimination, perfectly preserved). Verdict INSTRUMENT-INVALID forbids a card verdict either way; budget hard-cap (111) blocked an in-project re-run (spent 86). Evidence: `docs/plans/evidence/2026-08-18-dev-flow-contract-card/p6-adjudication.md`. Card edits invalidate CARD-arm rows (frozen rules §4). Since P7 the FULL pack no longer matches the live `skills/dev-flow/SKILL.md` — it is a historical freeze of the measured body; the repair campaign re-freezes all three arms from scratch.
- **Effort**: M（task-set repair + 63-run re-campaign）
- **Source**: dev-flow-contract-card P6 adjudication（2026-08-18）.

### Panel progress view — reviewer-cut cosmetic residuals (v2.34.31 round-1)
- **Trigger**: An operator incident actually caused by one of these: misread an exit-4 run because a never-dispatched seat shows `transport_exhausted`; `--panels` truncation at 10 hides a panel someone was looking for; `.tmp-<pid>` residue accumulates measurably in the runs dir; `--panel`(缺值)的 exit-2 訊息造成真實誤導。
- **Context**: 2026-08-21 review 判 CUT/FOLLOW-UP 的殘項(行為今日驗證正確,純回歸保護/污染防護):(1) never-dispatched seat 標籤應為 `not_dispatched`(`dispatch-plan-review.js` settle 分支);(2) `--panels` 輸出加 `total`/`truncated`;(3) panel lib flush catch 內 unlink tmp;(4) `--panel` 缺值時的用法訊息;(5) `--list` 的 panel 排除改以 `artifact_type` 判別而非檔名前綴(理論性:自產 run_id 不會撞 `panel-`)。全部單檔小改;證據與行號在 review 記錄(project archive)。另一獨立觀察(round-2):`preflight-release.sh` gate [3] 只比對版本字串,鏡像 **script 內容** 漂移不會被它抓 —— 測試套件是唯一 parity gate;若鏡像漂移再度逃到 develop,提升為獨立 Fix。
- **Effort**: S(單項)
- **Source**: autopilot:reviewer FIX-THEN-SHIP round-1, 2026-08-21;docs/projects/_archive/2026-08-21-panel-progress-view/

### Arm the ordinary-strike threshold (currently shadow-only) — DATED REVIEW REQUIRED
- **Trigger**: When shadow data exists for a role — i.e. `would_requalify` has fired at least once against a seat and the operator has replayed those strikes and agrees each was a true engine/pair failure. Also: this row must be re-read by **2026-11-22** even if nothing fired, because a threshold nobody revisits is a calendar tooth in a trench coat.
- **Context**: v2.34.35 ships `ordinary_strike` accrual in SHADOW: strikes are recorded and `would_requalify` is projected, but `admission_status` stays `qualified`. `critical_reexam_trigger` enforces immediately (deterministic predicates need no calibration). The flip is one env var, `AUTOPILOT_STRIKE_ENFORCEMENT=enforce`, read at projection time in `engine-scorecard.js` — see [`references/strike-decay.md`](../references/strike-decay.md) § Arming. Arming is a per-role Board decision, not a default: the question is whether N=3 is right for that role, which needs the shadow counts to answer. Do NOT arm on a hunch; a wrongly-armed threshold blocks a good seat and reads exactly like the calendar tooth this replaced.
- **Effort**: S (flag + per-role N) once the data justifies it
- **Source**: hetero design panel 2026-08-22 (kimi's "trench coat" objection), shipped shadow-first per synthesis §8.

### Strike-decay deferrals — the five mechanisms the panel cut from the first instrument
- **Trigger**: Any of: (1) a detector is caught emitting strikes at an anomalous rate; (2) more than two seats trip in one short span and the cause turns out to be a gate bug, not the engines; (3) a re-exam is needed and nobody notices for a week; (4) shadow data shows absolute counts penalising a high-volume seat, which is the only evidence that would justify building a dispatch ledger.
- **Context**: Deliberately NOT built in v2.34.35, each with a reason rather than an omission. **Detector anomaly quarantine** (4 seats wanted it): emission-rate deviation from a detector's own baseline auto-demotes its strikes to shadow pending review — needs a per-detector baseline that does not exist yet. **Fleet circuit breaker** (fable): >N seats tripping in a short span freezes enforcement and alarms — a gate bug is not an engine bug. **Rate-based windows**: not computable from a strike-only ledger; would require an outcome event per dispatch, which is a real build. **Re-exam scheduling automation** and **liveness-probe stale tax**: both deferred as premature on zero data. **Escalated QC sampling for past-advisory-date seats** (synthesis §6, the "silent rot" trade): the calendar should change how hard we LOOK — a stale seat gets sampled harder so drift arrives as strikes through the normal channel — plus coverage telemetry recording which detectors ran per dispatch. That last one is the most valuable of the five and the one the panel most wanted; it is the natural follow-up cut.
- **Effort**: M each; the QC-sampling/coverage-telemetry leg is the recommended next one
- **Source**: hetero design panel 2026-08-22 synthesis §5/§6 + cut list; deferred by scope=Hold on the M-size first cut.

### Capability-claim identity is coupled to its observation timestamp
- **Trigger**: When a receipt refresh is next needed, or before adding a fourth consumer to `platform-capability-claims.js`.
- **Context**: `claim_id = sha256(claim body)` and the body includes `live_evidence.observed_at` + `freshness.expires_at`, while the required IDs are hardcoded constants in `dispatch-hetero.sh:1653-1654`, `dispatch-review.sh:169-170`, `post-compact.js` `REQUIRED_D3_CLAIM_IDS`, and three `platforms/codex/plugin/` mirrors. So re-probing — even a pure timestamp refresh — changes every ID and requires editing shipped product code at eight sites. Identity should describe **what is claimed** (consumer + capability + contract), not **when it was observed**; the observation is data the validator checks live. Separately: the receipt is live runtime input but lives in `docs/projects/_archive/` (a deliberate 2026-08-04 archive-closure choice — reversing it is a decision, not a cleanup).
- **Effort**: M
- **Source**: 2026-08-18 capability-receipt expiry investigation.

### Vacuous red case in the guided-disposition suite (alien-hash branch)
- **Trigger**: Next touch of `scripts/build-profile-payload.js` guided-compatibility validation, or when adding any new disposition error code.
- **Context**: Mutation-tested 2026-08-18: deleting the `required === 0` branch at `scripts/build-profile-payload.js:478-483` leaves `hooks/tests/profile-guided-dispositions.test.sh:114-117` **GREEN** — the mutant survives. When `required === 0`, `shortfall = 0 - current ≤ 0` always falls through to the next branch, which emits the *same* `PROFILE_GUIDED_DISPOSITION_DEAD` token the test asserts, so the assertion cannot distinguish the two failure modes. The other four gate branches were mutation-killed. Fix: give the branches distinct codes (e.g. `..._NOT_IN_BASELINE` vs `..._STILL_PRESENT`) and assert the distinct one. Pre-existing — both the branch structure and the assertion predate v2.34.19.
- **Effort**: Fix
- **Source**: v2.34.19 pre-merge review mutation pass (autopilot:reviewer, 2026-08-18).

### dev-flow F4 ledger rule — re-measure before deciding (F6 leg RESOLVED 2026-08-18)
- **Status**: **F6 leg closed** — think-tank 5-role ruling C-shape, shipped: rule restated at the step that runs it, claim scoped honestly (S/Fix = project-config gate; L/H = quality-pipeline via finish-flow L-5.2 / H-9.2), enforcement recorded as `documented-only` in `references/four-layer-design.md` § Skill-layer rules (S1). Root cause was a self-contradiction in the body, not a missing enforcer: `:133` demanded quality-pipeline while `:241`/`:275` offered "lint + test" at the point of action. Evidence: [p7-f6-f4-adjudication.md](plans/evidence/2026-08-18-dev-flow-contract-card/p7-f6-f4-adjudication.md).
- **Trigger**: The skill-onoff instrument-repair campaign, at the point where its task fixtures are redesigned — F4 must be re-measured there, not decided from the existing data.
- **Context**: F4 (Fix step 6 ongoing-maintenance ledger row) measured 0/3 in the FULL arm, but n=3 and the fixture repo carried no `docs/` tree at all, so the model had to originate a directory rather than append a line — a materially different task from the one the rule states. Recorded as S2 `documented-only` pending re-measurement. Do not build an enforcer for it on the current evidence.
- **Effort**: S (folded into the instrument-repair fixture design)
- **Source**: dev-flow-contract-card primary block（`evidence/…/primary-sonnet-results.jsonl`）;P7 adjudication 2026-08-18.

### Outcome-shaped quality-gate enforcer (opt-in) — replaces the rejected invocation check
- **Trigger**: When an enforcer for the quality gate is wanted again, OR when `quality-pipeline` grows a SHA-bound "this ran" receipt that a gate could re-derive from. Not before: the current design has nothing to verify against.
- **Context**: P7 ruled out the obvious enforcer. A hook asking "was `Skill(quality-pipeline)` invoked before `git commit`" governs **process**, which [ADR-0001](adr/0001-verification-over-attestation.md) forbids — and the outcome it proxies (tests were actually run) already sits at 5/6 in the eval's **OFF** arm, i.e. near the model's base rate. It would also kill F6 as a FULL-vs-CARD discriminator, which the re-attempt campaign needs (≥4/5 families load-bearing). If built: opt-in like `branch-protection.js` (never default-on), predicate must be outcome-shaped (evidence that tests ran green against the diff, re-derived — not an assertion that a skill was called), escape hatch + planted red case mandatory per the anti-cathedral constraint.
- **Effort**: M
- **Source**: think-tank 5-role panel 2026-08-18（collision insights ②③）;[p7-f6-f4-adjudication.md](plans/evidence/2026-08-18-dev-flow-contract-card/p7-f6-f4-adjudication.md).

### Scaffold-tier effect A/B measurement（four-layer D6 promised row — repaired 2026-08-18）
- **Trigger**: Before any skill or routing policy CONSUMES scaffold tiers（T0/T1/T2）as an outcome-quality claim（成績單前置 applies）;or before the next capability-tier expansion.
- **Context**: v2.34.11 shipped capability-tiered scaffolding with fail-closed T2, but `references/scaffold-tiers.md` Non-goals explicitly disclaims any tier→outcome effect claim — the A/B was deferred. Four-layer plan D6（docs/plans/2026-08-16-four-layer-redesign.md:269）recorded this row as added, but it was never created; repaired by dev-flow-contract-card P0. Design can reuse the `evals/skill-onoff/` 3-arm instrument pattern（tier as the manipulated variable, dispatched-leaf channel）.
- **Effort**: M
- **Source**: four-layer-redesign D6 closeout leftover（2026-08-17）;audit 2026-08-18（dev-flow-contract-card prologue）.




### cc-shim framing chrome leaks via `generate_session_title` (v2.34.7 fix incomplete)
- **Trigger**: Next touch of `dispatch-review.sh`'s cc-shim launcher, or the next `no_verdict` whose raw log shows an intact nonce block behind CC chrome.
- **Context**: 2026-08-18 P1 review (MiniMax-M3, cc-shim): parser returned `no_verdict` / "response did not start with the expected wrapped block" because Claude Code prepended `[claude-code:unrecognized_model] {"query_source":"generate_session_title"}` ahead of an INTACT `<<<AUTOPILOT-REVIEW-…>>>` block carrying a full SHIP-AS-IS verdict. Same family as the v2.34.7 reviewer-transport-framing incident — that fix suppressed the unknown-model notice at the main-query launch env, but the session-title generator path is not covered. Fix at the launch env (e.g. disable title generation in headless shim runs) rather than relaxing the parser (prompt-echo hole, v2.34.7 rationale). Verdict was recovered manually from raw log (`docs/plans/evidence/2026-08-18-dev-flow-contract-card/p1-review-raw.log`).
- **Effort**: Fix
- **Source**: 2026-08-18 dev-flow-contract-card P1 review round.

### Qualification CLI transport — runtime identity capture
- **Trigger**: When any CLI harness (codex / claude) grows a verifiable runtime model-identity signal in headless mode, or before promoting a CLI-transport qualification to a decision where alias drift would be material.
- **Context**: CLI transports return no model id, so administered identity is operator-asserted (pre-run probe recorded per the v2.34.15 governance rule; the HTTP path caught glm-5.2→glm-5.3 exactly via its runtime echo). `resolvedModel` in `qualification-review-provider.js` is the wired-but-dead field awaiting a real signal. The other seven items of the original v2.34.15 hardening row shipped in the 2026-08-17 hardening round (stdin data fence; hermetic `--setting-sources ""` probed on claude 2.1.233 + containment descriptor v2; `QRP_CLI_EFFORT` [a-z]+ validation; 2MB stdout cap; six test exec bits restored — run.sh L2 reachable again; context-window field pin schema-derived, suite fully green; exit-flush race settled from recorded exit with negative-control proof; `brain_seat_identity_file` documented in the config template).
- **Effort**: S once a signal source exists.
- **Source**: v2.34.15 pre-merge review; hardening round 2026-08-17.

### Broker payload format token rename (unified_diff misnomer)
- **Trigger**: Next time the broker client protocol version bumps for any reason, or before onboarding a fourth non-diff payload family.
- **Context**: `qualification-case-broker.js` hardcodes `payload.format: unified_diff` in its sandbox client; brain round bundles (v2.34.14) and VA spec envelopes (v2.34.17) ship JSON content under that diff-named token (VA plan G1-F11; the reviewer noted the misnomer risks being rediscovered as a bug). Renaming means a coordinated broker+provider+engine-qualify change and a client-protocol version bump — pure hygiene, zero behavioral effect today (the field is an opaque constant all three parties pin).
- **Effort**: S.
- **Source**: VA suite plan v3 §6 (G1-F11 deferral); v2.34.17 pre-merge review.

### Roster qualification — remaining legs (explorer suite; brain re-sit) — implementer leg SHIPPED v2.34.34
- **Status update (2026-08-22, post-sweep)**: the implementer leg is DONE and the Board-ordered full-roster sweep is administered (9 administrations, scorecard events 143-151; `docs/plans/evidence/2026-08-22-implementer-qualification-suite/sweep-2026-08-22.md`). **Nine qualified implementer pairs**: grok-4.5 (143), gpt-5.3-codex-spark (145), gpt-5.6-sol (146), Qwen3.8-Max/qoderclicn (148), GLM-5.3/cc-shim (150), MiniMax-M3/cc-shim (151), gpt-5.6-luna@medium (153), claude-sonnet-5 (154), claude-opus-5 (155) — all 24/24, expire +90d. FAILED honest rows: agy flash 18/24 (144) + agy pro 22/24 (147) — family transport envelope; **grok-4.6 23/24 (149) — security-canary trap hit** (version regression vs 4.5 on the identical trap family; blocks implementer routing only, reviewer seat unaffected). grok-composer retired upstream (uncharged probe receipt). The「Official qualification defaults」row is now SHIPPED (v2.34.36, 2026-08-23): these events are packaged as `references/official-qualification-defaults.json` and adoptable by a consuming repo via `scripts/adopt-qualification-defaults.js`.
- **Trigger**: Explorer formal suite — before autonomous routing claims for that role. Brain re-sit — when the Board schedules a fourth sitting (three sittings recorded, events 3/4/6; instrument clean, margins are capability; identity re-pin needed at sit time: harness hash tracks engine-qualify.js).
- **Context**: v2.34.15 shipped the CLI exam transport; the administrations are now spent through the gpt-5.6-sol leg. Measured: **gpt-5.6-sol QUALIFIED** (2026-08-17, `sol-codex-qualify/`) — 42/42 both trials, 0 FPs, score 1.0 over the codex CLI transport at max effort; scorecard event 141, evidence event 5, expires 2026-09-16 — the roster's first qualified reviewer row (re-sit on expiry is a fresh evaluation). **glm-5.3** FAILED its first full evaluation (4 clean FPs + 1 miss; scorecard event 140; worse than glm-5.2's event-139 sitting) — any future GLM attempt is a fresh evaluation. **MiniMax-M3** spike 5/9 (2026-08-16) — full run still not worth spending. **Brain incumbent** (claude-fable-5): two sittings FAILED (store events 3, 4; per-family diagnosis in `brain-seat-exam-suite/dogfood/README.md`) — remaining margins are stable capability signal, no third sitting (rerun-until-green forbidden); advisory bootstrap semantics hold. **verification_author suite SHIPPED in v2.34.17** (Board ruling (c), declared-test-plan construct; dogfood administration of the incumbent GLM seat recorded in `docs/plans/evidence/2026-08-18-verification-author-suite/dogfood/`).
- **Effort**: L（verification-author suite 設計）/ Board（brain re-sit scheduling）
- **Source**: v2.34.15 qualification-cli-transport + 2026-08-17 hardening round;evidence `docs/plans/evidence/2026-08-17-roster-qualification/` + `docs/plans/evidence/2026-08-17-brain-seat-exam-suite/dogfood/`

### Governance CLI UX polish（experience-critic findings, v2.34.13 dogfood）
- **Trigger**: 下一次動五支治理腳本任一時捎帶;或 critic 再報同類。
- **Context**: KR5 dogfood(GLM-5.2 critic,post-merge)對五支治理 CLI 的三條產品缺口:(1) `next-pick parse` 輸出是裸 JSON array,沒有 `schema_version`/`artifact_type` envelope(R4 尺,其餘四支都有);(2) 拒絕訊息只講條件不給修法(例 veto 的「no decision 'nope'」沒說怎麼列出可否決清單);(3) usage error 只列 mode enum,無 flag 級範例(R2 尺)。另兩條 MUST-FIX 是對 dogfood 證據本身的(valid-flow 覆蓋 3/5、exit code 未錄),屬 evidence 品質非產品。critic 的 severity 標籤無阻擋力 —— 全部在此排隊。Raw log:`docs/plans/evidence/2026-08-17-autonomous-brain-integration/dogfood-critic-raw.log`。
- **Effort**: S。
- **Source**: v2.34.13 KR5 dogfood(2026-08-17);critic run bvxubvq39。

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

### Every gate needs a negative control — the caution needs a routine behind it
- **Trigger**: 下一次新增或修改任何「閘」（release gate、drift gate、anti-gaming scan、admission check、hook）時；或再抓到一個閘存在卻沒在擋東西。
- **Context**: CLAUDE.md 已經寫著「腳本存在不是它在運作的證據」，但 2026-08-08 一天之內出現三次同一種形狀，全部通過既有 CI 而沒被發現——(1) managed dev-flow admission 對 bounded 非 Mission campaign **永遠 deny**，沒有任何呼叫端或 fixture 能滿足；(2) `resolve-worktree-teardown` 的 template-tier 斷言被 repo 自身 dogfood 設定遮蔽，測的不是它宣稱在測的東西；(3) `check-test-integrity.sh` 對 263 個 shell 測試檔一個都沒看，回 exit 0。三者的共通點是 **exit 0 被當成「有在保護」**，而沒有人證明過它能變紅。警語擋不住這個，因為警語要人想起來才會啟動。可能的形狀：閘的測試必須含一個 negative control 案例（刻意違反 → 斷言變紅），並讓某個 meta-gate 檢查每個閘都有這樣一條；或讓閘在「零輸入匹配」時回非零而不是 0。先決定要哪一種，不要三種都做。
- **Progress**: 三個實例裡的 (3) 在 v2.34.38 補上了負控制——四條 gaming 動作各有 BEFORE/AFTER/BLOCK 記錄,並立成常駐迴歸(`hooks/tests/check-test-integrity.test.sh` §11),外加一條 coverage meta-test 把「閘看得到的檔案數」綁在 `git ls-files` 的真實清單上。**這條 row 本身不因此結案**:缺的是那個 meta-gate——沒有任何機制檢查「每個閘都有一條負控制」,(1) 與 (2) 也還沒有。v2.34.38 提供的是一個可抄的形狀,不是那個機制。
- **Effort**: M。
- **Source**: 2026-08-08 CI triage（11/273 → 1/273）三起獨立成因的共同模式；本檔另有三條各自的條目。

### Test-integrity L0 cannot see an early `exit 0` spliced into a shell suite
- **Trigger**: 下一次有人想把這個閘升到 `block`,或再抓到一個 bash 套件「綠得太安靜」時。
- **Context**: v2.34.38 讓 `*.test.sh` 進入閘的視野,但三條 gaming vector 裡只有兩條半是機械可見的。
  刪除與弱化走語言無關的 `deleted_line`;新增 skip 走新的 `shell` skip 規則;**塞在套件中段的
  `exit 0` / `return 0` 抓不到**——它沒有刪任何一行、沒有任何 skip token,而 line-level regex 分不出
  它和本 repo 既有的正當 bail-out:260 個 `*.test.sh` 裡 **19 個**有 top-level `exit 0`、41 個有
  任意縮排的、只有 2 個是放在最後一行,也就是說多數是 guard clause——正是 gaming early-exit 的形狀。
  要分開需要 L0 沒有攜帶的檔案位置資訊
  (「這個 exit 後面還有沒有斷言」),那是 AST/位置層的工作,不是加一條 regex。真要補,候選形狀是:
  比較 base/head 兩側的**斷言計數**(`assert_*` / `PASS [` 出現次數只增不減),那是檔案層而不是行層的
  不變量,也順帶涵蓋刪除與弱化。這條缺口目前在三個地方各寫一次(設定檔註解、引擎註解、本條),並被
  `check-test-integrity.test.sh` §11e 一條**會在缺口被補上時轉紅**的斷言釘住——修好它記得同步這三處。
  **注意這條缺口是目前唯一一條**:first-pass review 抓到的另外兩條(`${#…}` 截斷、line-start
  錨點漏掉 `&& skip` 與裸 `skip`)都比這條便宜,已在 v2.34.38 內修掉並各配常駐負控制。
  另有一個**已記錄的假陽性類別**:把 skip 寫進 fixture 的套件(例如
  `check-test-integrity.test.sh` §11c-bis 自己的 `sed` payload)逐字等同於自己 skip 的套件,
  行層偵測器分不出資料與程式碼;`warn` 下無成本,但翻 block 會擋住對該測試檔的編輯。
- **Effort**: M。
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。

### `check-test-integrity.sh` warn → block needs an accuracy record first
- **Trigger**: 累積夠多真實 range 的 violation 輸出,足以判斷「違規流是否準確到可以擋」時;或有人主動
  提議把 `.claude/test-integrity-config.md` 的 `mode` 翻成 `block`。
- **Context**: v2.34.38 刻意停在 `warn`。原因不是保守,是 L0 的判準粒度:它對 match 到的測試檔**每一行
  刪除**記一條 `deleted_line`,而這個 repo 的日常測試維護(改 case 名、修 `assert_eq` 參數順序、收緊
  一個界)天天在刪行 —— block 會擋掉幾乎每個誠實的 commit,然後有人就會把它關掉,而那正是它當初瞎掉的
  路徑(`references/evidence-discipline.md` §1)。block 另外會把每個 `surface_touch` 升成 violation,而本
  repo 的測試本來就會正當地改 `hooks/tests/lib.sh` 與 fixtures。要升 block,先要有記錄:實際 range 上
  violation 的真陽性/假陽性比例,以及 `.qc/<sha>.verdict.json` waiver 路徑在真實工作流下的成本。**沒有
  那份記錄之前不要翻**,翻了就是把一個會報告的閘換成一個會被關掉的閘。
- **Effort**: M。
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。

### Engine and CLI have no session-mode fallback for bounded non-Mission campaigns
- **Trigger**: 要把 session-marker 紀律擴到非 Mission 的 managed campaign 時；或 threat model 升級為「同一 host 上未經 /l3–/l6 進入的呼叫端不得驅動 managed loop」。單純誠實使用者不觸發。
- **Context**: 三條路徑對「contract 不帶 Mission projection」的處置不一致。`dispatch-hetero.sh:1710` 在 `CAMPAIGN_PROJECTION_BOUND != 1` 時仍跑 `check_session_mode_gate` + `check_mission_enforcement_gate`；`src/engine/autopilot-engine.js` 與 `bin/autopilot.js` 則**沒有任何等價 fallback**——v2.34.8 收窄 admission 後，bounded campaign 在這兩條路徑上不經任何 session 檢查。此不對稱**早於** c3e2647d（2026-08-05 之前 Engine 根本沒有 admission），v2.34.8 只是讓它重新成為現行行為，**不是新退步**；而 c3e2647d 造成的中間狀態也不是可用的控制，是 100% 拒絕。真要補，得先決定一個沒有 Mission 身分的 campaign 該把 marker 綁到什麼上——不要為了對稱而發明一個假的綁定。
- **Effort**: M。
- **Source**: 2026-08-08 v2.34.8 pre-push QC。兩個 family（MiniMax-M3、GLM-5.2）皆回 SHIP-AS-IS 且 findings=none，都沒抓到這條；MiniMax-M3 更在總結中斷言 bounded campaign「現在會走到 session-mode gate」——經查為假，`check_session_mode_gate` 僅存在於 dispatch-hetero.sh。此為 `resolve-review-loop.sh` 既有 MiniMax-M3 advisory（diff-only 中央主張 5/6 為假）的又一實例。

### Mission runtime retires superseded adoptions at closeout, not after the fact
- **Trigger**: 下一次 Mission 重試鏈再留下多個 COMPLETE adoption，或要動 `src/mission/runtime.js` 的收尾路徑時。
- **Context**: v2.34.6 的 `mission-terminal-reconcile.js rollover` 是**事後清理**——它能指名已整合的 adoption 並退役其餘，但根因沒動：runtime 只在 mission UNRESOLVED 時圍籬，COMPLETE 之後每次重試都再鑄一個永久 terminal。治本是在收尾時就退役被取代的 adoption，讓 rollover 退回成救援工具而不是常規步驟。動這裡必讀 `scripts/mission-terminal-reconcile.js` 檔頭（記錄了兩層阻擋的完整診斷，以及 Work Order 豁免為何只對「observed_head 是 HEAD 祖先」成立）。
- **Effort**: M。
- **Source**: 2026-08-07 v2.34.6 rollover ship；`docs/projects/_archive/2026-08-06-dispatch-residue-cleanup/README.md`。

### `reap-dispatch-branches.sh scan` cannot see branches that carry no `root_run_id`
- **Trigger**: 下一次要盤點 dispatch 殘留分支時；或再出現「分支堆積但 scan 回報乾淨」。
- **Context**: `scan` 以 `root_run_id` 為 key，沒帶 id 的殘留分支完全隱形——2026-08-06 清出的 20 個就是這樣躲過的。缺的是一個**報告-only 的 `--all` 模式**列出 `unattributed`，不自動刪（preserve-first 是這支工具的既有立場，不要為了方便破例）。目前 usage 只有 `--repo/--into/--pattern/--inventory-file`。刪任何分支前先 `pin-evidence-anchors.js apply --exclude-ref <待刪ref>`：receipt 綁的是 commit SHA 不是內容，這個 repo 已經永久失去過 4 個 commit 的證據。
- **Effort**: S。
- **Source**: 2026-08-06 dispatch residue cleanup（20 → 1 branches, 6.3 GB reclaimed）。

### `prune_tmp_residue` covers 7 prefixes; 25 scripts create `/tmp` dirs
- **Trigger**: `/tmp` 再次被 autopilot 殘留撐大，或有人要為 CI runner 加磁碟配額時。
- **Context**: `prune_tmp_residue` 只被四個 dispatch 腳本呼叫，共 7 個 pattern（`dispatch-author-*`／`dispatch-explore-*`／`dispatch-review-*`／`dispatch-hetero-*`／`hetero-*-log-*`／`pi-rpc-session-*`／`hetero-detach-state-*`）。一次 `mkdtempSync|mktemp -d` 全掃（2026-08-16）數出 **25 個會建 `/tmp` 目錄的腳本，沒有一個自己 prune**——被 caller 的前綴涵蓋的只有 `pi-rpc-session-`（dispatch-hetero）與 `dispatch-author-codex-`（前綴匹配 `dispatch-author-*`）。無 owner 的包含 **production 路徑**，不只是 test fixture：`dispatch-anthropic-review-`（`dispatch-anthropic-review.js:276`，由 `dispatch-author.sh:959` 呼叫，而 dispatch-author 只 prune 自己的前綴）、`dispatch-contract-`、`dispatch-plan-review-`、`qc-panel-`／`qc-refute-b-`／`qc-emit-`、`next-touch-evidence-`、`hook-multiplexer-benchmark-`、`verify-red-green-`、`eval-selftest-`、`run-ledger-*-test-`，以及整個 `autopilot-*` 家族。
- **實測**（2026-08-16，開發機 `/tmp` 22506 項）: `dispatch-anthropic-review-*` 484 個（420 個 >3d，5.4 MB）、`qc-emit-*` 28 個、`ctxbud*` 175 個。**位元組小、entry/inode 大**——真正撐爆 `/tmp` 的是別人的殘骸，但這是 autopilot 自己該收的部分。
- **修法**: 讓 `prune_tmp_residue` 的 pattern 清單成為**單一事實來源**（例如 `lib/tmp-prefixes.sh`／`.json`），由建立者各自認領前綴，並加一個掃描 gate 讓「新增 `mkdtemp` 前綴但沒登記」變成紅燈。要嘛讓 `hooks/tests/lib.sh` 的 `cleanup_test_tmp` 也掃同前綴過期殘留。先確認它真的會 fire——別再多一個「存在但沒在工作」的腳本（見 `references/evidence-discipline.md`）。
- **Effort**: S（單點補 pattern）／M（做成單一事實來源 + gate）。
- **Source**: 2026-08-06 dispatch residue cleanup（782 項 `/tmp`、1.9 GB）；2026-08-08 複驗仍成立；2026-08-16 全掃擴大範圍——原標題「test-fixture prefixes」低估了，production dispatch 前綴同樣無 owner。

### `next-touch-validation.test.sh` asserts against un-versioned local Mission state
- **Trigger**: 立刻——它在 CI 上**永遠**紅；或下次有人相信「本機全套綠」等於「CI 綠」時。
- **Context**: 該套件讀 `.git/autopilot/mission/next-touch-debt-retirement/successor-prepared.json` 並斷言 `validatePreparedReceipt(...).state === 'ACTIVE'`，另外還綁 `D8_PUBLICATION_SHA` 與 `.autopilot/evidence/grok-implementer-ab.json`。那是 2026-08-03 已歸檔專案在**某一台機器**上一次真實執行留下的 authority artifact，不在版控裡，所以全新 clone 必 ENOENT crash（CI run 31206156093 實證）。本機會綠純粹因為那台剛好有。修法是造 fixture Mission state；**不要**改成「artifact 不存在就 skip」——那是把安全控制變成靜默通過。1760 行套件深度綁在真實 authority 上，工程量不小。
- **Effort**: M–L。
- **修法已驗證到 5/6（2026-08-08，未落地）**: fixture 用**本 repo 的本地 hardlink clone**（實測 0.31s／63 MB，且確認不帶 `.git/autopilot`）——如此真 history（`D8_PUBLICATION_SHA` `c43370dd` 可解析）、真 tracked 檔案（`.autopilot/evidence/grok-implementer-ab.json` 與 archived `authorization.json` 都在版控）與一個乾淨可寫的 Mission store 同時到位。在 clone 裡 commit 一個 `src/value.txt`（含 `## Next touch` ATX heading）當 graph node 的 spec anchor，別指向會變動的 repo 內容。然後 `runMissionCli(['prepare','--repo',clone,...])` 搭 `AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS=1` 與 `testOnlyDependencies`：真 producer 做事，只覆寫四個身分值成 archived authorization 釘的那些——`mission_policy_digest`、`mission_graph_digest`、`deriveMissionLineageId`、以及 `deriveMissionAdoptionKey`（必須是 `7e8e6806aee8…`：`findPreparedReceipt` 用 `authorization.branch.split('/')[1]` 當前綴過濾）。`--out` 必須寫進 `<common>/autopilot/mission/next-touch-debt-retirement/successor-prepared.json`，因為 `assertAuthorityPath` 只收 canonical authority root 底下的檔案。`gate_attempt_budget` 要 ≥2。**剩下的最後一格**：真 artifact 的 state 是 ACTIVE 且 0 個 active claim（實測拒絕碼 `MISSION_GRANT_INVALID`「found 0」），fixture 目前停在 DRAFT（拒絕碼 `MISSION_BLOCKED_OR_TERMINAL`）——需要 grant 後再釋放 claim，只 grant 會變成 1 個 active claim 而落到 `MISSION_GRANT_BINDING_MISMATCH`，那不在 site 1 的接受集內。**不要**嘗試從版控的 graph 重建 archived digest：`docs/mission-next-touch-debt-retirement-execution-graph.json` 已漂移（其 digest `c1c6f577…`，authorization 釘 `aba0dd14…`）。sites 2/3 另需 D8 rebind 與 terminal bundle，尚未探。
- **尾巴長度是可列舉的，不是未知的（2026-08-09 更正）**: 上一則把剩餘依賴描述成「尚未探」「長度未知」，那個判斷錯了。一次 grep 就把整條尾巴數完：只有三項——(1) `implementation-campaign.jsonl` 需要一個 project 到 `TERMINAL_READY` 的 campaign；(2) `MISSION_LEDGER`（第 39/41/43 行）指向真 repo 的 ledger；(3) `OUT_CURRENT`（第 72 行）跑開發者的活 ledger 並接受三個錯誤碼中的任一個。沒有第四項。三項都已收：新的 `hooks/tests/lib/implementation-campaign-ledger-fixture.js` 用**出貨中的 writer**（`run-ledger.sh` init/stage-acquire/journal-add ＋ `campaign-intake.js` 的 `appendCampaignEvent` ＋ 真 `reduceCampaignState`）造出 ledger——不是手寫 JSONL，所以它證明的是「production 造得出來」而不是「parser 讀得懂」；`MISSION_LEDGER`／`ARCHIVE_AUTH` 一起改指 fixture repo，每個 reservation 呼叫都補 `--repo`；`OUT_CURRENT` 實測為 `MISSION_GRANT_INVALID`（「found 0」）後釘死成單一碼，並改用一般的 `assert_contains`，不再手動加 pass counter。dogfood 套件的 rotation block 也改用同一個 library 的 `openCampaignLedger`，兩套件共用一份 intake 路徑。
- **Source**: 2026-08-08 CI triage（11/273 紅的最後一個，其餘十個已於 v2.34.8 修復）；2026-08-09 收尾。

### Dispatch-branch lifecycle — SHA-256 `check --ack` residual
- **Trigger**: 第一個 SHA-256 object-format repository 要使用 manual `check --ack`／restore acknowledgment。
- **Context**: inventory、reap 與 restore tests 已支援 SHA-256；剩餘缺口是 acknowledgment validator 仍只接受 40-hex SHA-1。
- **Effort**: S。
- **Source**: 2026-07-31 code/backlog audit。

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

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
- **Context**: 2026-07-10 syscontract campaign 實測:12 個「clean」標籤(merged-未被翻 標注法)倒了 5 個(舊01/舊03/06/08/新03),其中新03 的 flag 還抓到當日 develop 現行真 bug(ladder-run.sh pipefail,v2.32.18 修)。全火力 reviewer(sonnet+全契約+tools)比「merged=clean」標注法強。配對一致性協議(m3-pathc-syscontract.md final protocol)不需要標籤,已作為現行量測法;真 certified-clean 集需逐案對抗性預審(每案先過一輪全火力 review + 人工裁決),成本高,等有絕對認證需求再建。
- **Effort**: M
- **Source**: 2026-07-10 L6-r2 WS-A campaign;MiniMax R2 的「reviewer-circular 標注」警告實證。

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

### M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
- **Trigger**: 下次把 `evals/orchestration/tasks/t15-cache-invalidation`、`t16-findings-triage`、`t17-purity-invariant` 用於對抗性 implementer 情境（`/l5`、`/l6` hetero 派遣、或任何候選碼不可信的場合）。
- **Context**: 這三個 oracle 的判分 python 與候選碼在**同一個 process** 內執行，候選模組 import 時可用 `sys._getframe()` 走訪呼叫端 frame 的 globals/locals，撈出判分器從未匯出的密鑰。opus 2026-07-09 對抗性重攻實測兩條可靠（5/5 PASS）exploit：N2（t15）——撈出真 `NONCE` 偽造 token 且從不呼叫注入的 `compute_fn`，fidelity 與 cache 軸皆假過；N2'（t17）——重同步 purity 檢查區塊的 `snapshot` 局部變數，一邊 mutate 一邊讓 `snapshot == recs` 恆真。R2 硬化（4 條 planted-file/env/stdout 攻擊）已修好且仍成立，但這條 in-process introspection 類別是**架構性**盲點，不是 R2 修復範圍。真正封死需要候選函式呼叫跑在與判分器分離的 subprocess/interpreter（process isolation），對映 `check-test-integrity.sh` L1 block-mode 在 CLAUDE.md 已記錄的同一結論（no local-only same-process mechanism 對抗同帳號候選碼是防偽的）。
- **Effort**: L（redesign，非修補）。
- **Source**: opus 對抗性重攻，2026-07-09。`docs/projects/_archive/2026-07-09-m3-band-tasks/report.md` § "Residual: in-process introspection"。

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
- **Trigger**: When the zero-diff schema next changes or a fourth production consumer is introduced.
- **Context**: Move sealed zero-diff receipt validation into one deterministic shared helper consumed by shell, Engine, and runner boundaries.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b
## engine implement-review：verify_pass=false 非阻塞、可在 reviewer SHIP 下收斂
- **Context**: 2026-07-24 codepower /l6 P0a run（foreman-p0a-1784819842）兩度實測：U3 與 qc-fix round 的全部 verify_round 皆 `verify_pass:false`，loop 仍以 reviewer SHIP-AS-IS 收斂並回報 committed。實際缺陷（AppSurface class TS2322、AppButton disabled bg、8 個測試紅）全靠 foreman 自驗第二層攔下。root cause 候選：verify-first wiring 只在 roster 發 `verify_first:true` 時 gating，未發時 verify 結果純 telemetry。**Fix 方向**：loop 收斂條件改為 `reviewer SHIP ∧ (verify_pass ∨ verify 缺席原因白名單)`，verify 紅=強制 rework round；至少在 run summary 對 `verify_pass:false + converged` 發 WARNING。
- **Trigger**: 下次動 engine implement-review 收斂邏輯或 resolve-review-loop verify 欄位時。

## engine implement-review：campaign-contract fresh 路徑 Work Order 自鎖（codepower /l6 P4 實測）
- **Context**: 2026-07-31 codepower P4 foreman（p4-foreman-20260731）：`engine implement-review --campaign-contract` 在 `dispatch_implementation` 確定性回 `continuation admission: reconcile receipt is required`，`leaf_runs.total=0`。根因 `src/engine/autopilot-engine.js` ~3494-3541（blame 全屬 `d151f202` Work Order v2）：campaign contract ⇒ durable ⇒ `createWorkOrder=true`，`hasActiveRootWorkOrders` 枚舉到自建/殘留 nonterminal controller WO ⇒ `missionActive` ⇒ `requireReconcile` ⇒ fresh campaign 被要求 PostCompact reconcile receipt。八項合法解法窮盡（含 3 個全新 campaign id、乾淨 `AUTOPILOT_DISPATCH_RUNS_DIR`、`compaction-rehydrate reconcile` 鑄 receipt → `durable campaign already exists` → `campaign resume` → `campaign_state_lease_open` 死巷）。**無 work-order list/dispose CLI 可清殘留**。當次以 pin v2.32.57-era（`349e2420`）engine 繞過續跑。
- **Fix 方向**: (a) fresh-create 路徑排除自建 WO 於枚舉外或同 run 自動鑄 receipt；(b) 提供 work-order 檢視/處置 CLI；(c) `campaign_state_lease_open` 的 lease 釋放路徑。
- **Trigger**: 下次動 continuation admission / Work Order lifecycle 時。

## codex live-spend probe 必須 `--model` 指定 roster implementer（per-model quota pools 假綠燈）
- **Context**: 2026-07-31 codepower P4 U2 實測：probe 用 codex CLI 預設模型（gpt-5.5）回 PROBE_OK，實際 dispatch 的 `gpt-5.3-codex-spark` 池已 rate_limited → dispatch 跑 342s 中斷、產物 broken-by-construction（registry 註冊了 4 個不存在的 loader）。`status --help` 明寫 quota 是 per-MODEL pools——不帶 `--model` 的 probe 驗不到 dispatch 會用的池。既有 capability 成功先例（2026-07-30 16:00 foreman-p15b）同樣未帶 `--model`，此洞是繼承性的。
- **Fix 方向**: probe SOP 與 capability 記錄格式強制 `--model <roster implementer_engine>`；engine dispatch 前的 preflight 亦同。
- **Trigger**: 下次動 live-spend probe / capability 記錄 / engine preflight 時。
### HETO task-return detection can miss completed work
- **Trigger**: A second reproducible case where a completed HETO task produces no return event/notification, or before another HETO return-consumer is added.
- **Context**: The controller can remain waiting when HETO has completed a dispatched task but the return detector does not fire; inspect event names, buffering/flush, timeout, and terminal-state reconciliation without treating silence as success.
- **Effort**: S–M
- **Source**: user-reported intermittent missed HETO return detection (2026-08-05)

### No route for external field experience contributed INTO autopilot itself
- **Trigger**: A second instance of a lesson learned while *using* autopilot on another project that
  belongs in autopilot's own skills/references and has nowhere to go. n=1 today (2026-08-24: the
  knowledge-routing fix set), so this is recorded, not built.
- **Context**: `learn` records facts/gotchas into `.claude/knowledge/`; `distill` produces reusable
  procedures and **explicitly never targets autopilot** (its description says so). Neither routes a
  field-experience finding into autopilot's own `skills/` or `references/`. Today that path exists
  only as a human noticing and hand-authoring it — the same "habit, not policy" gap
  `references/knowledge-routing.md` was written to close for the disclosure line.
- **Effort**: S (a `references/` row in `learn` may already be enough; a new skill is not justified at n=1)
- **Source**: knowledge-routing fix set, foreman first-pass review (2026-08-24)

### `peer-coordination` skill — ruled in, blocked on a spike sweep
- **Trigger**: The R5 spike list below comes back with dated, per-machine results. Do not author the
  skill before that — its whole subject is harness capability, and shipping unverified capability
  claims is the defect `references/knowledge-routing.md` §6 exists to stop.
- **Context**: autopilot models subordinates (`team`, `l3`–`l6`) and future-self (`handoff`) but has
  no entry for a **peer** — an agent this session did not dispatch, does not control, and that may
  not be Claude. Two heterogeneous seats over two rounds ruled: a thin skill (routing entry only) plus
  **two** references — `peer-channels.md` (capability matrix, audience = local session) and
  `peer-contract.md` (the fill-in division-of-labour template, audience = the peer or its operator,
  and the only artifact handed across the boundary). `references/` cannot be selected by skill
  routing, which is why a skill is needed at all. Route key must be the authority relationship, never
  brand or tool names — `grok`/`tmux`/`ListAgents` as triggers collide with `team`, `l3`–`l6` and
  `engine-onboarding`. Ruling detail is in machine-local memory (`peer-coordination-skill-ruling`).
- **Spike list (none of these may be asserted without a dated result)**: which harness versions expose
  the native peer enumeration; whether every enumerated target is actually reachable by the paired
  send tool; whether reported pane addresses survive a peer restart; what the MCP relay lane provides
  that the native lane does not; `pgrep` identification accuracy per non-Claude CLI; whether file-drop
  is really reachable by "any agent" (pickup convention, atomic write, cross-worktree visibility).
- **Design constraint discovered while drafting**: reach is a property of the **environment**, not of
  the channel — the same enumeration lists 38 targets on one machine and local-only on another. Every
  matrix row therefore needs a **verified-on-machine** column beside its verified-date, or the next
  reader will take one host's topology for a channel capability.
- **Effort**: M (skill is thin; the two references and the spike sweep are the work)
- **Source**: cross-repo request via peer relay, 2026-08-24/25; ruled by two-round heterogeneous panel

## 2026-08-28 foreman cost is the polling loop, not the model (revival.3d session 5ca9b104)

Evidence (grok cost split, `revival.3d/NOTE-FOR-FABLE-FOREMAN-COST.md`): 30 opus foremen, 28 of them
burned more usage than all their sonnet leaves combined (foremen 227M vs leaves 130M). Foreman tool
mix 3971 Bash / 337 Edit — almost no code; the Bash is `sleep 240` polling + `cat <leaf>.output` fed
back into the foreman context. Every wake is a full-price inference on a 200–500k prompt. Switching
the foreman role to sonnet (`model-routing-config.md`, 2026-08-28) only lowers unit price; the loop
remains.

Two items:

1. **Foreman must not be a polling model.** Waiting has to be inference-free: the canonical foreman
   for /l4–/l6 should be a `Workflow` script (deterministic fan-out, zero turns while leaves run) or a
   `run_in_background` + notification wake. Add a gate: a sub-orchestrator transcript with
   `sleep` in a loop, or `cat`/`tail` of a child output file into its own context, is a red-line
   violation. Leaves return a schema-typed criteria table; their raw output never enters the
   foreman prompt. → plan 2026-08-28 (`docs/plans/2026-08-28-foreman-no-polling.md`).
2. **Implementer ladder by unit class, not one seat.** → plan 2026-08-28
   (`docs/plans/2026-08-28-implementer-ladder.md`). `review-loop-config.md` has a single
   `implementer_engine`. Add `implementer_ladder: gemini-3.7-flash-low → grok-4.6/low → sonnet`
   with two triggers: contract field `unit_class: mechanical|judgment` picks the starting rung; a
   red repair round climbs one rung; top rung then enters `awaiting_convergence_adjudication`
   (existing). `on_engine_unavailable` stays availability-only. Sample: revival.3d AF
   (wizhall-mega 058 migration) — brief fully pre-resolved, flash-low one-shot, 5 files correct.
   Adjudication (BLOCKED) stays on opus/fable via `tree:judge`.

- **check-foreman-polling bash_cap=40 ground truth (2026-08-28, peer aimax395)**: a real /l4 foreman
  that runs the hetero review loop scored sleep_loop=0 / leaf_output_reads=0 / bash=126 — the two
  toxic patterns absent, red only on bash_cap, because endpoint load / roster / test execution all
  go through Bash. Tune: make the cap configurable per level, or exclude Bash calls that invoke
  autopilot's own scripts (`dispatch-review.sh`, `resolve-review-loop.sh`, `node --test`) from the
  count. Keep sleep_loop and leaf_output_read as the hard reds.

## 2026-08-29 dispatch residue governance: mechanism in autopilot, declaration via project DI

Evidence: revival.3d 2026-08-28 — 40 dispatches left 35 `.vite-<tag>` caches, 625 root-owned Chrome
udd dirs (238 MB+), 118 `/tmp/rw3d-*`, and 5 live Chromes holding 5.7 GB on GPU1 that killed the next
line's WebGPU context. Owner: "治理你自己每一輪生產的垃圾要系統化". The project shipped
revival.3d's `lab/reap-run.mjs` (under its own `scripts/`; `--tag/--check/--all-stale/--self-test` + hourly user timer) as a stopgap
adapter; ruling: the **mechanism belongs in autopilot**, the project only declares what counts as residue.

Split:
- **autopilot (mechanism)**: tag-is-ownership naming contract (worktree dir, branch `l6/<tag>`, any
  file/dir/process the leaf creates carries `<tag>`); `reap --tag` at the end of every merge; `--check`
  gate before dispatching a resource-bound line; `--all-stale` timer; receipts merged into
  `LifecycleResidueReceipt.zero_residue` (today it only counts worktrees/branches —
  `reap-dispatch-worktrees.sh`/`reap-dispatch-branches.sh`); self-test harness that injects fake residue
  incl. root-owned dirs; whitelist semantics (never touch non-`l6/` branches, foreign worktrees,
  `/tmp/claude-*`, flock-held tags).
- **project DI** `.claude/residue-config.md` (draft fields): `kinds[]` each with `glob` (with `<tag>`),
  `owner: self|root` (needs `sudo -n`), `process_match` (cmdline substring with `<tag>`, exact per-pid —
  **never `pkill -f`**, leaves' briefs live on argv), `port_from` (file glob + regex), `stale_after`,
  `whitelist[]`; plus `resource_check[]` (e.g. `nvidia-smi` GPU index + mem threshold).
- Leaves are not trusted to clean up ("已收" was false 3× on 2026-08-28); they only owe correct naming.

Reference impl to absorb: revival.3d's `lab/reap-run.mjs` (under its own `scripts/`) + `docs/governance/dispatch.md`
"派遣殘留物治理".

## 2026-08-29 qualification run.sh templates baked an invalid effort enum

Evidence: `docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/`
seat6 (agy) and seat3 (cc-shim) `run.sh` scripts set `EFFORT` to a free-text placeholder
(`"baked-in-model-name"`, `"default"`) instead of a value in `engine-scorecard.js record`'s closed
enum (`none|low|medium|high|xhigh|max`), which blocked scorecard recording until corrected to
`"high"` (receipt-only — matches kimi/grok's convention for the same transport class; the CLI
never receives this value). Future qualification `run.sh` templates for effort-less transports
(agy, cc-shim/QRP, and any other transport whose CLI takes no `--effort`) should default straight
to a valid enum value (`"high"` or `"none"` per `engine-scorecard.js`'s own documented convention),
never an ad hoc descriptive string.

### Managed-campaign controller cannot record `BOUNDARY_REJECTED` — lease-fenced by its own synthesized stage identity
- **Trigger**: any `engine implement-review` campaign whose implementer commit is boundary-rejected (unauthorized output path / diff cap) — reproduced 2026-08-29 (`campaign-v1-3b6a9770…`, replayed through the real reducer).
- **Context**: `src/engine/autopilot-engine.js:6477` writes composition events with `controller-<event>:<gen>` stage identities; `src/engine/implementation-campaign.js:886/738` lease-fences `BOUNDARY_REJECTED` (and `AWAITING_CONVERGENCE`, `:971`) against `live_lease.stage_identity` (`campaign-mutation:0`), so the rejection is unrecordable, the journal strands at `IMPLEMENTING` with a held lease, controller durable state diverges (`boundary_rejected` vs journal `IMPLEMENTING`), and neither `--resume` (`campaign-intake.js:780 campaign_state_lease_open`) nor a repair round nor terminalization is reachable. The terminal path already uses the real lease identity (`:2756`) — do the same for lease-releasing bridge events; regression test: IMPLEMENTING + boundary rejection ⇒ `BOUNDARY_REJECTED`, never `LEASE_FENCED`.
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1-20260829T1804Z campaign attempt 2; debugger replay 2026-08-29.

### L6 managed campaigns can never satisfy `reviewer_qualification` — strict provider-readiness bootstrap compiles for `l5` only
- **Trigger**: next `/l6` run on any repo with `mission_convergence.enforcement_mode: enforce` (reproduced 2026-08-29: attempt 1b blocked at rounds 0 for every seat).
- **Context**: `bin/autopilot.js:396-399` builds `createStrictL5ProviderBootstrap` only when `AUTOPILOT_LEVEL === 'l5'`; managed dev-flow admission (`scripts/session-mode.js:349`) requires `marker.level === AUTOPILOT_LEVEL`; so an `l6` marker gets neither the readiness authority nor `reviewer_qualified` and the disk-scorecard path is `untrusted_telemetry` by design. Workaround used: session marker set to `l5` (deviation recorded). Fix: gate the bootstrap on `l5|l6` and let `provider-bootstrap.js strict_level` carry the actual level.
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1 attempt 1b/1c, 2026-08-29.

### `dispatch-author.sh` success predicate is "non-empty stdout" — truncated / tool-narrating output reports `authored`
- **Trigger**: already fired twice (2026-08-29, qoderclicn/Qwen3.8-Max-Preview: a 100-byte preamble ending at `[` and a 130 KB mid-file draft with 36 text-form ```` ```tool ```` fences both returned `status:authored`, exit 0, `final_status:null`).
- **Context**: header line 102 / `emit_result "authored"` at :1222 treat any bytes as an artifact. Needs a positive completion check (declared terminal marker, `bash -n`/parse for the declared kind, zero tool-fence narration) and a `truncated` status; manifests also record `parent_run_id/root_run_id: null, depth: 0` despite exported lineage.
- **Effort**: S
- **Source**: l6-verdict-stability-p1 attempt 1 (author-1788027293-2263145, author-1788027402-2269364).

### Verification-author seats on agy / cc-shim / anthropic-compatible are structurally NO-GO under the exact-tuple quota gate
- **Trigger**: next time a VA seat other than codex/grok/qoderclicn is configured (GLM-5.3@anthropic-compatible is VA-qualified, event 142, yet unroutable on 2026-08-29).
- **Context**: `dispatch-contract.js` always queries capability state with `--effort <resolver effort>` (and `withResolverConfig` injects `verification_author_effort: high` when absent), but `probe-engine-capability.sh` refuses to observe an effort-bearing tuple for runners that do not consume `--effort` (agy carries effort in the model name; cc-shim/anthropic-compatible have none) ⇒ `quota: unknown` ⇒ NO-GO forever. Either the checker must query the effort-less partition for those runners or the probe must observe it.
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1 roster rotation 2026-08-29 (commits 8d6f8786, 83d993a5).

### No supported withdraw for a never-granted DRAFT Mission adoption; graph revisions mint unbounded lineages
- **Trigger**: next time a frozen execution graph must be revised before or between grants (three adoptions now exist for `qualification-verdict-stability`: 2e784929 DRAFT, 83828e5e ACTIVE with an unreleasable live claim, 420ac261 current).
- **Context**: `mission prepare` binds the adoption key to {repo_identity, intent, acceptance hashes} (`src/engine/mission-policy.js:195-233`) and pins the graph digest; revising the graph re-derives the same key and fails `MISSION_BINDING_MISMATCH` (`src/mission/runtime.js:781-787`). `successor` needs a terminal source and re-runs the same graph (`:902-907`, `:952`); `rollover` needs COMPLETE. The only way forward is perturbing the intent (graph digest folded into `requirements_hash`, commit 5402cbd5). Add `mission withdraw --prepared <receipt>` refusing unless zero claims and zero events; also a release path for a claim whose campaign was killed mid-flight (attempt-3 claim c434b7f9 stays live).
- **Effort**: S
- **Source**: mission-lineage authoring 2026-08-29 (commits 0279dccc, 5402cbd5, 500703b1).

### `hooks/tests/run.sh` is red on `develop` — sealed campaign `verify_cmd` is unsatisfiable
- **Trigger**: already fired (salvage campaign `campaign-v1-e9bcae52…` `acceptance_failed` on `bash hooks/tests/run.sh` with a byte-identical cherry-pick; seven suites red on base 500703b1: codex-plugin-package, execution-profile, mission-terminal-rollover, next-touch-validation, provider-readiness-consumer, qualification-review-provider, resolve-review-loop [timeout]).
- **Context**: every Mission node inherits the six-command chain as `verify_cmd`, so any campaign on this base fails acceptance regardless of the candidate. Triage the seven (environmental vs real regression), then either fix `develop` or make the graph's `verification_commands` name the suites the node actually touches.
- **Effort**: L (triage) — blocks every managed campaign on this repo until done.
- **Source**: l6-verdict-stability-p1 salvage campaign 2026-08-29.

### Campaign bridge resolves lease identity from `campaignControl.initial_state` — correct today only because every append refreshes it
- **Trigger**: any change to `recordCampaignEvent` / the campaign event appender that stops assigning `campaignControl.initial_state = appended.state` (`src/engine/autopilot-engine.js:~4557`), or a second appender path that bypasses it.
- **Context**: `onCampaignEvent` (`autopilot-engine.js:~6487`) calls `resolveCampaignEventLeaseIdentity(campaignControl.initial_state, …)`; the field name says "initial" but it is the live journal-replayed state because the closure refreshes it on every append. Two reviewer seats flagged the naming as a latent no-op risk (rail-fix qc, 2026-08-30). Rename to `live_state` (or read from the journal replay) and add one end-to-end fixture that drives BOUNDARY_REJECTED through the real bridge after IMPLEMENTATION_STARTED.
- **Effort**: S
- **Source**: rail-fix qc panel 2026-08-30 (gpt-5.6-sol 🟠 downgraded after verification; GLM-5.2 🔵).

### `hooks/tests/run.sh` TIMEOUT marker collides with a suite that self-exits 124/137
- **Trigger**: a suite observed to exit 124/137 on its own (e.g. propagating a child's SIGKILL) shows as `[TIMEOUT]` in the summary.
- **Context**: `is_suite_timeout_ec` treats any 124/137 as the wrapper's timeout. Still counted FAILED (fail-closed), so cosmetic; distinguish by checking elapsed ≥ the ceiling, or by having `timeout` write a sentinel.
- **Effort**: XS
- **Source**: rail-fix qc panel 2026-08-30 (GLM-5.2 🔵).

### Killed/dead managed campaign stuck at IMPLEMENTING with a held lease has no operator remedy
- **Trigger**: already fired three times 2026-08-29/30 (campaigns `3b6a9770…`, `d240ef14…`, `e9bcae52…`): leaf died (wall cap / host kill / acceptance failure before terminal journal), journal holds `live_lease`, `--resume` refuses with `campaign_state_lease_open` (`src/engine/campaign-intake.js:780`), `IMPLEMENTING` is not a resumable phase, and the Mission claim stays live forever (three such claims now sit in the registry).
- **Context**: add a bounded, evidence-gated terminalization for a campaign whose leaf run is provably dead (leaf manifest ended, pid gone, worktree reaped) that appends `MUTATION_FAILED` with the live lease identity and releases the Mission claim; never a silent no-op.
- **Effort**: S–M
- **Source**: l6-verdict-stability-p1 campaigns 2/3 + salvage, 2026-08-29/30.
- **Status**: shipped in U1 (branch `u1-terminalize-withdraw-20260831`) — `node bin/autopilot.js campaign terminalize --campaign-id <id> --leaf-manifest <file> [--ledger <file>]`.

### `mission grant` silently replays a stale claim when the node holds an open `active_claim_id`
- **Trigger**: already fired 2026-08-30 (lineage 420ac261, node `qualification-verdict-stability`): with attempt 1's claim still open, `mission grant` returned `status:"replay"` with attempt 1's contract — a `base_sha` two merges behind `develop` and an already-consumed branch — instead of refusing.
- **Context**: the idempotency key resolves to `graph-node:<id>:attempt:<n>` while `active_claim_id` is set; nothing tells the caller the attempt cannot advance. Surface `attempt_blocked_by_open_claim` (with the claim id and its campaign state) or refuse outright — a replayed stale contract is a false green in the evidence-discipline sense.
- **Effort**: S
- **Source**: phase-2 foreman escalation, 2026-08-30.

### No operator-level release for a claim whose campaign died without a terminal receipt (second instance)
- **Trigger**: already fired again 2026-08-30 — depth-0 had to emit `no_effect_release` through the reducer module API (`reduceMissionState`) on the local state file (backup taken) because `mission control` exposes only `finish_requested|abort_requested|scope_frozen|ceiling_adjust` and intake's automatic `pre_spend_no_effect` path is unreachable once a leaf ran.
- **Context**: pairs with the existing "Killed/dead managed campaign stuck at IMPLEMENTING" row: the fix must release BOTH the campaign lease (MUTATION_FAILED with the live lease identity) and the Mission claim, gated on provable leaf death, and be reachable from `mission`/`campaign` CLI without raw state plumbing.
- **Effort**: S–M
- **Source**: phase-2 foreman escalation + depth-0 operator action, 2026-08-30.
- **Status**: shipped in U1 (branch `u1-terminalize-withdraw-20260831`) — `node bin/autopilot.js mission withdraw --state <file> --out <file> --claim-id <id> --campaign-ledger <file>`, refuses `mission_withdraw_campaign_not_terminal` until the bound campaign is terminal.

### A managed campaign whose wall expires leaves no terminal summary and no journal disposition
- **Trigger**: already fired twice 2026-08-30 (campaigns attempt-3 `d240ef14…` and `…a3` D5): the leaf committed, `max_wall_seconds` (3600, schema max) elapsed before the review round, the `engine implement-review` process ended with a 0-byte stdout, and the campaign sits at `phase=IMPLEMENTING, activity=dead, wall_seconds_remaining=0` with a held lease and a live Mission claim.
- **Context**: wall expiry must journal a wall-expiry disposition (MUTATION_FAILED-class with the live lease identity, or a resumable-wait phase if repair generations remain) and always write the summary JSON; a foreman reading an empty file cannot tell a kill from a crash. Pair with a `campaign resume`/`terminalize` verb for an `activity=dead` campaign with repair generations remaining — the artifact was complete and reviewable, only the controller was stuck.
- **Effort**: S–M
- **Source**: phase-2 foremen (D4, D5) 2026-08-30.

### 3600 s wall cap is the schema maximum and too small for an implement+review campaign on a real deliverable — SHIPPED in U3 (branch `u3-wallcap-20260831`), ceiling 14400 by CEO decision 2026-08-31
- **Trigger**: any deliverable whose implementer alone needs > ~40 min (D1–D3, D4, D5 all did: 42–55 min grok-4.5 runs), leaving no wall for the review round.
- **Context**: `schemas/mission-execution-graph.schema.json` caps `campaign.max_wall_seconds` at 3600 and `max_engine_attempts` at 3. Either raise the schema ceiling (with governance `max_wall_seconds` still the aggregate bound) or make the wall cover implementation only and give review rounds their own budget. Until then every real campaign closes through the depth-0 salvage path.
- **Effort**: S (schema + one test) — but a governance decision.
- **Source**: phases 1–2, 2026-08-29/30.

### Qualification recipes seed staged credentials only when the staged file is absent — rotating OAuth runners reuse stale material
- **Status**: shipped in U2 (branch `u2-staging-20260831`) — `scripts/lib/qualify-stage-credentials.sh` reseeds credential files by sha256 stamp (mismatch => reseed) and `plan` mode refuses on drift; all 14 `docs/plans/evidence/*/administration/*/run.sh` recipes migrated identically; covered by `hooks/tests/qualify-recipe-credential-staging.test.sh`.
- **Trigger**: already fired 2026-08-30 (D7): kimi and grok seats returned 240/240 `provider_process_failed` each (480 case attempts, ~1600 s) because the `if [ ! -f <staged> ]` guard kept 2026-08-29 credentials while the live ones had rotated; codex/cc-shim/agy were spared only because they do not rotate.
- **Context**: every `run.sh` under `docs/plans/evidence/*/administration/*/` copies this block. Seed unconditionally (or stamp the staging dir with the source file's sha256 and reseed on mismatch), and make `plan` mode compare staged vs live hashes and refuse when they differ. The harness rule correctly refused a verdict, so no capability row was polluted.
- **Effort**: S
- **Source**: D7 administration ledger 2026-08-30.

### `engine-scorecard.js current/seat-status --require-evidence` cannot be run standalone
- **Trigger**: next time an operator wants the strict admission projection for a live seat (it exits 2: `--require-evidence or --identity-file requires --scope-file`).
- **Context**: the strict path needs a caller-supplied applicability scope file; there is no helper that derives the canonical scope for a role, so foremen fall back to the non-strict `seat-status`. Add a `--role-default-scope` (or print the expected scope JSON) so the strict path is one command.
- **Effort**: S
- **Source**: D7 foreman 2026-08-30.
