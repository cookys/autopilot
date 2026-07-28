# Plan — Mission Convergence Supervisor（任務收斂監督器）

> **Status**: depth-0 READY after capped heterogeneous review and same-hash supplemental union; no generation 3 opened
> **Owner**: Autopilot CEO / Owner Kernel
> **Implementation branch**: `feat/mission-convergence-supervisor`（開始實作時才建立）
> **Frame**: 只處理跨 campaign、agent、model、session 的 Mission 收斂；不重做 campaign、provider、worktree、plan-review、transcript、merge 或 finish controller
> **Review cap**: 同一 frozen plan + rubric 最多 2 generations；generation 2 只能修 generation 1 admitted blockers

## 0. Context / thesis

最近同一條 Codex session 有 54 個 completed tasks。46 個一小時內任務的中位數是
1.81 分鐘，但最長三個任務合計佔 completed-task wall time 76.0%、tool calls 71.2%、
compactions 75.2%、patch events 84.7% 與 processed input tokens 76.7%。這是少數
Mission 缺少總煞車造成的長尾，不是所有模型普遍變慢。

三個事故形狀：

| 事故 | 觀察 | Mission-level 缺口 |
|---|---|---|
| 28.20h / 5,490 tools / 59 compactions / 38 dispatches | 每個 leaf、review 或 phase 都可局部合理地再跑一次 | 換 agent、model、reviewer、session 或 successor 後，沒有共同 aggregate budget |
| 12.47h / 2,437 tools / 593 patches | 使用者兩次要求停止擴張，assistant 仍持續新增工作 | 自然語言的「收尾」沒有變成可執行的 closure state |
| 4.30h / 約 192 分鐘 matched wait | product Mission 內臨時修 provider、quota、qualification 與 transport | readiness maintenance 沒有被隔離成另一個 Mission |

Direct/no-agent 任務也曾跑到 2.60h / 716 tools，因此拿掉 delegation 不能解決問題。
本案的 thesis 是：

1. Autopilot 保留一個 repo，強弱模型透過 capability/guidance profile 共存。
2. 強模型可以自由選擇解法；外部 contract 只限制 intent、authority、evidence、
   aggregate resources 與 terminal conditions。
3. 一個長期無人職守 goal 是 **Mission**；一次可驗收的 delivery slice 是既有
   **Implementation Campaign**。
4. Mission supervisor 只發 parent grant、累計跨 campaign 消耗、接受使用者控制，
   並產生 Mission terminal receipt。它不執行 campaign 內部工作。

Production transcript discovery、privacy 與 normalized events 由
`2026-07-26-cross-harness-transcript-retro.md` 擁有。本案只提交去識別 synthetic
fixtures，不提交原始 transcript，也不造第二個 adapter。

## 1. Objective / Key Results

**Objective**：CEO / L3-L6 可以長期無人職守地推進多個 bounded campaigns，但不能
藉換 runner、agent、session、reviewer 或 successor 重置整個任務的授權與預算。

- **KR1 — Mission lineage**：同 intent + unresolved acceptance 的 successor chain
  共用 `mission_lineage_id`。建立新 session、root run、branch 或模型不會產生新預算。
- **KR2 — Aggregate ceiling**：project default 在 intake 凍結；task 只在使用者或
  DOA-authorized control 明示時覆寫。Campaign grant 的 reservation 總和不得超過
  Mission remaining；增加 planned units 不會增加 authorized ceiling。
- **KR3 — Parent grant**：每個 Implementation Campaign 開始前必須消費一個 immutable
  `MissionCampaignGrant`。Grant 綁定 parent、campaign contract digest、acceptance IDs
  與 resource reservation；未綁、重放、過期或超額 grant 在 model spend 前被拒。
- **KR4 — Mission progress**：supervisor 只在 campaign terminal receipt、verified
  blocker 或 acceptance delta 上更新進度。Tool activity、文字更新、churn 或換 reviewer
  不是進度；連續兩個 campaign boundaries 沒有可驗證 delta 時進入 `CLOSING|BLOCKED`。
- **KR5 — Authenticated closure**：acceptance green、75% authorized resource use、
  `finish_requested` 或 `scope_frozen` 進入 `CLOSING`；`abort_requested` 進入
  `ABORTING`。Control event 有 authority、sequence 與 receipt，舊 grant 不能繼續開工。
- **KR6 — Receipt composition**：Mission terminal 只聚合 campaign、provider readiness、
  lifecycle 與 acceptance receipts；它不重新判定 finding、test、worktree 或 merge。
  `mission_terminal=true` 不等於 `can_close=true`，後者只由 L6 status/merge controller 決定。
- **KR7 — User-level disclosure**：terminal receipt 包含 `undelegated_decisions[]`，
  列出模型替使用者做的非明示決策、理由、替代方案與影響；不新增一般結果審核 gate。
- **KR8 — Honest enforcement**：先 shadow replay，再只對實測可阻擋的 current-Codex /
  engine-controlled path enforce。未 shipped 或未驗證的 harness/receipt 軸維持
  `unknown|shadow`，不得報成零或已 enforcement。

## 2. Portfolio ownership contract

這一節是本組計畫的唯一 ownership map。Sibling plan 可增加自己的內部細節，但不得
取得此表分配給另一 controller 的 terminal 或 mutation authority。

| Controller / artifact | Sole authority | Produces | Explicitly does not own |
|---|---|---|---|
| **Mission Convergence Supervisor（本案）** | lineage、aggregate ceiling、campaign parent grant、authenticated Mission control、Mission terminal | `MissionCampaignGrant`, `MissionProjection`, `MissionTerminalReceipt` | campaign generation、finding/test、provider probe、worktree cleanup、merge、`can_close` |
| **Implementation Campaign Controller（ICC）** | 一個 Work Unit 的 contract、generation、mutation、finding disposition、verification receipt、campaign terminal | `CampaignReceipt`, immutable candidate/test receipts | Mission ceiling、provider truth、resource cleanup、task-level `DONE` |
| **Provider Readiness Orchestrator（PRO）** | exact tuple readiness 三軸與 bounded probe | `ProviderReadinessReceipt` | campaign dispatch ordering、generation、fallback scope policy、Mission maintenance |
| **Worktree Lifecycle Budget（WLB）** | dispatch-owned worktree occupancy、marker/journal、safe reap、exact branch inventory | `LifecycleResidueReceipt` | review generation、campaign budget、finish marker、`can_close` |
| **L6 Status / Merge（LSM）** | task-level status、merge manifest/execution、`can_merge`、`can_close`、finish marker | `TaskStatusReceipt`, `MergeReceipt` | campaign mutation、provider probing、worktree ownership inference |
| **Plan Review Session（PRS）** | pre-code plan-review attempts/generations/finding ledger | `PlanReviewReceipt` | product campaign repair generations |
| **Cross-Harness Transcript Retro（CTR）** | post-hoc adapters、normalized telemetry、coverage/calibration | normalized events/reports | live mutation or terminal authority |
| **Review Scope Stop-Loss（RSS，已 shipped）** | finding relevance、registry completeness、full-diff repair growth | admission/scope receipts | Mission/campaign scheduling |
| **Shared runner transport primitive（由 ICC 先行落地）** | exit/timeout/quota/unavailable classification、request binding、private raw reference | `RunnerTransportEnvelope` | semantic JSON extraction、finding/readiness/plan verdict authority |

Current portfolio members after depth-0 union correction:

| Plan | Plan SHA-256 | Rubric SHA-256 / state |
|---|---|---|
| ICC | `56bc3169e4757e9a115588f521ce5dfc01cf5b7adbe2b5e7182f098eb51cb842` | `62062f8d3f147970ee8b841589716d3309e0cbfecb215a57e44230e5aabff701` |
| WLB | `1941818fb62c8ba81a637508730fde4b02cc14f59e5fbc80681e16d4456411d1` | `73836a68f3b48958abf8ea940dd0f48378a8f9c09ccf4a3a22ff2c549a8adbe8` |
| LSM | `5c40c8633f10a3e2821cc3a6b9c6fa04343f25167ca97a84a9515ca0a73407ed` | `77f17dff39be90e1cac5b0345957e948a2951b1e18de3a310c700bfda09709ac` |
| PRO | `e41fdbf6bd6ce19c7d6b93076c0476f1590652019245c55bb14639d6935e2c11` | `6f18af4bce669ff1b56313593a832886489435dfd45b2ba95b6f38c612d53768` |
| PRS | `fba46e24c47bd16a778967efa3081755dd65dbf4df21743d1a25f929a58b66ba` | `e518a66e34cc94c63e68fa9df3291f0ca844a00e16f2f4f1f34ef48c74753ad6` |
| CTR | `4e2562185dd2a9be3673ff0bcc2036286a83a42548c83fbedb376cf887f1f0fb` | `3b19a4637b6e313e33769d62250d1b897d5827963c7ec50d8d053fc44a0ca9b9` |
| RSS | `7fbb21ddc31ec8c1d1c2b028dad4a6cf4032b0ce26a5e1d4c8d294778392d29b` | shipped v2.32.60 |

### 2.1 Canonical effectful intake

只有 ICC 擁有 effectful `engine implement-review` intake composition。順序固定為：

1. Mission atomic `grant_claim` 驗 binding/authority/sequence/closure/remaining 並 reserve；
2. ICC 驗 sealed campaign contract/digest/base/scope/profile budget；
3. consume exact-tuple readiness receipt（PRO）；
4. run existing context-window gate；
5. acquire worktree occupancy admission（WLB）；
6. ICC claim campaign generation and spawn。

Mission 只擁有 grant binding/sequence/idempotency rejection；ICC 只擁有 contract
digest/seal/base/scope/profile 與 composed intake rejection。Step 1 失敗時不 reserve 且
不進 step 2。Step 2–5 任一失敗時，該 owner 產生自己的 rejection，ICC 再發
content-bound `PreSpendNoEffectReceipt`；Mission 原子移除完整 reservation，actual usage
維持零。沒有 controller 可把另一 owner 的 rejection 重新標成 ready。

PRO、WLB 與本案不得各自在 `src/engine/autopilot-engine.js` 實作另一個 preflight。
ICC 建立唯一 composition point；siblings 只輸出 versioned pure modules/receipts。

### 2.2 Identity and budget boundaries

| ID | Owner | Rule |
|---|---|---|
| `mission_lineage_id` | Mission supervisor | 同 intent + unresolved acceptance 的 successor chain；Owner Kernel 只保存 task-authority/provenance binding |
| `task_authority_id` | Owner Kernel | 凍結 intent、acceptance、red lines、project/task policy |
| `root_run_id` | runtime resource lineage | 一次 runtime owner；不能改綁到新 task authority |
| `campaign_id` / `unit_id` | ICC | 一個 sealed Work Unit；一對一綁 Mission grant |
| `loop_id` / campaign generation | ICC | Campaign 內修復計數；WLB 只保存它作 resource provenance |
| `logical_plan_id` / plan generation | PRS | pre-code plan review；不增加 product Mission budget |
| leaf `run_id` / attempt / seat | dispatch transport | provenance only；不能重置任何 parent clock |

Budget accounting 對每個 resource axis 分別成立，不把不同單位加成一個假 scalar：

```text
for each axis in {
  campaigns, wall_seconds, tool_calls, engine_attempts, external_wait_seconds,
  canonical_changed_files, output_bytes
}:
  authorized_ceiling[axis] = authenticated_task_override ?? frozen_project_default
  reserved_active[axis]    = sum(full nonterminal campaign reservations)
  durable_consumed[axis]   = terminal-reconciled actual usage only

  remaining[axis]       = authorized_ceiling[axis]
                        - durable_consumed[axis]
                        - reserved_active[axis]
  remaining[axis]      >= 0
  campaign_grant[axis]  <= Mission remaining[axis] and ICC profile ceiling[axis]
```

Active `actual_usage` 是 reservation 內的 monotonic telemetry，不進 admission equation；
ICC 在每個 effect 前 hard-check `active_actual <= reservation`，wall/wait 用 deadline
timer。任何 receipt 報 `actual_usage > reservation` 立即
`BLOCKED/accounting_breach`，仍將完整 actual charge 到 lineage，禁止新 grant，不能截斷
成 ceiling 以隱藏 overspend。

Successor Mission inherits every `durable_consumed` axis plus only unresolved full reservations
whose campaign is nonterminal。Closure utilization uses observed usage：
`max(known_enforced((durable_consumed + sum(active_actual)) / authorized_ceiling))`；active actual
消失時，terminal reconciliation 同額進 durable，所以 ratio 不跳回。達
`closure_ratio` 進 `CLOSING`。Required axis unknown 時不能用 ratio enforce，也不能當零；
projection 明列 unknown，直到 evidence 可用或 Mission `BLOCKED/required_counter_unknown`。

Agent-generated override 只能收緊 ceiling。只有 authenticated user/DOA override 可以放寬，
且任何收緊或放寬都必須先記錄
`ceiling_adjust{old,new,reason,authority,sequence,recorded_at}` control receipt。Agent
tightening 不是靜默 provenance；它同樣接受 stale-sequence pre-effect check。換模型、
branch 或新建 unit 不是 override。

### 2.3 Shared transport boundary

Runner/transport layer只產生共同 mechanical envelope：

```json
{
  "transport_status": "ok|timeout|quota|invalid|unavailable",
  "identity": {"runner": "...", "model": "...", "endpoint": null},
  "request_binding": "...",
  "raw_private_ref": "..."
}
```

`RunnerTransportEnvelope` 由 ICC Phase 3 先行落地成共用 primitive；PRS、PRO 與其他
controller 唯讀消費，不得再造 exit/timeout/raw-reference envelope。它完全不解析 JSON。

各 controller 只 canonicalize 自己的 semantic payload：ICC owns product-review
normalization；PRS owns plan-review normalization；PRO owns probe/readiness observation
validation。同一 raw artifact 綁定唯一 request purpose/controller，不能跨 controller
重播。Raw malformed、preamble、fenced、multiple-object 或 ambiguous output 沒有
finding/mutation authority。Controller-specific deterministic normalizer 只有在恰好一個
完整、無歧義、重新通過該 controller schema/binding 的 object 時，才能產生 canonical
artifact；不能用 first/last brace 猜結果，也不能再輸出第二份 transport truth。

## 3. Mission contract

### 3.1 Project default and task override

在既有 `.claude/owner-kernel-governance.json` 增加 versioned `mission_convergence`：

```json
{
  "mission_convergence": {
    "enforcement_mode": "shadow",
    "max_campaigns": 8,
    "max_wall_seconds": 28800,
    "max_tool_calls": 2400,
    "max_engine_attempts": 24,
    "max_external_wait_seconds": 7200,
    "max_canonical_changed_files": 120,
    "max_output_bytes": 67108864,
    "closure_ratio": 0.75,
    "max_stagnant_campaigns": 2
  }
}
```

`enforcement_mode` 只允許 `shadow|enforce`；default 是 `shadow`。Invalid value fail closed
to a config error，不自動升級。P0 另記錄
`codex_enforcement_outcome=block-capable|wrapper-required|unenforceable-now`；只有前兩者可把
設定切到 `enforce`。

這些是 Mission aggregate ceilings，不是 Work Unit defaults。Wall/files/churn/repair
generation 等 Campaign cap 只存在 ICC contract，且必須小於 Mission grant。

TaskAuthorityEnvelope 凍結 effective values 與 provenance：
`project-default | authenticated-task-override | agent-tightening`。Partial/unknown/
wrong-type config fail closed；舊 project 沒有 section 時保持 `off` 相容，不能假裝
已 enforcement。

### 3.2 State machine

```text
DRAFT
  -> ACTIVE
  -> CLOSING
       -> COMPLETE
       -> BLOCKED
  -> ABORTING
       -> ABORTED
```

- `ACTIVE` 才能發新 campaign grant。
- `CLOSING` 可完成已授權的 frozen acceptance、blocker repair、targeted verification、
  required docs/version 與 receipt production；禁止新 acceptance、research、provider
  maintenance、optional cleanup 或額外 panel。每個 effect 必須攜帶 supervisor 發出的
  `ClosureAllowlistReceipt{effect_class,acceptance_or_blocker_id,control_sequence,expires_at}`；
  無 receipt 的 non-acceptance work fail closed。
- `BLOCKED` 是 terminal and visible；不得 busy-wait。外部狀態改變或 authenticated
  override 要建立 sequenced successor transition，不能刪 ledger 重來。
- `COMPLETE` 表示 Mission acceptance terminal，不表示 worktree/merge/push 已 clean。
  LSM 必須再聚合 lifecycle/merge/push 才能給 `can_close=true`。

### 3.3 Grants and receipts

`MissionCampaignGrant` 至少綁：

- canonical repo identity、`mission_lineage_id`、`task_authority_id`、`root_run_id`；
- `campaign_id`、campaign contract digest、base SHA、acceptance IDs；
- reserved resource ceilings、issued sequence、expiry、idempotency key；
- Mission policy digest 與 current closure state。

ICC 在自己的 contract validation 前先送
`claim_request{mission_grant_ref,campaign_id,contract_digest,base_sha,control_sequence,
idempotency_key}`。Mission 只比較 request 與已發 grant 的 binding、authority、
sequence、closure 與 remaining；不判斷 contract seal/base 是否有效。只有
`src/engine/mission-convergence.js` 可原子 reserve 並回
`grant_claimed{claim_id,reservation,...}|grant_rejected{reason,...}`。ICC 必須消費
`grant_claimed` 才能繼續自己的 contract/readiness/context/WLB checks。

`grant_claimed` 是 single-use。Resume 只重用原 `claim_id`，不重新 reserve；
conflicting idempotency key fail closed。若後續 pre-spawn check 拒絕，ICC 的
`PreSpendNoEffectReceipt` 綁 claim、owning rejection receipt 與 `actual_usage=0`，
Mission 原子釋放全額 reservation。正常 `CampaignReceipt` 必須回傳每 axis 的
`actual_usage`、`reservation_consumed` 與 `reservation_freed`，且
`actual_usage=reservation_consumed <= original reservation`；Mission terminal
reconciliation 一次完成：

```text
reserved_active -= original reservation
durable_consumed += actual_usage
reservation_freed = original reservation - actual_usage
actual_usage + reservation_freed = original reservation
```

Active actual telemetry 從未加入 `durable_consumed`，所以 terminal 不需先 subtract。
若 receipt 報 overspend，等式 fail；supervisor 仍以 observed actual 做單次 conservative
charge，轉 `BLOCKED/accounting_breach`，且不發新 grant。

已 terminal/released claim 不能重新 claim。Successor 只攜帶 nonterminal claim；
terminal claim 的 actual usage 已進 lineage，freed 部分不再佔 reservation。
Mission supervisor 只驗 binding、monotonic accounting 與 receipt digest，不能重做
ICC finding/test/contract judgment。

`MissionTerminalReceipt` 包含：

- frozen intent/acceptance/policy hashes；
- lineage total、campaign grants/receipts、known/unknown counters；
- terminal state/reason、open blockers、deferred backlog candidates；
- `undelegated_decisions[]`；
- sibling receipt refs、states 與 content digests；
- `mission_terminal`，但不含自行計算的 `can_merge|can_close`。

每個 `undelegated_decisions[]` entry 必須有
`decision,reason,alternatives,impact,evidence_ref_digest,evidence_state`，其中
`evidence_state=known|unknown`；unknown 不得被文字推論成 verified。

### 3.4 Authenticated controls

`AuthenticatedControlAdapter` 是 host-injected、model 不可偽造的 boundary。它把已驗證的
host user action 轉成
`{mission_lineage_id,action,authority,sequence,issued_at,reason}`；聊天文字本身沒有
authority。Current-Codex wrapper/hook 只有在 P0 execution probe 證明 identity 與
blocking semantics 後才能實作 adapter；其他 harness 維持 `unknown|shadow`。

Control events：

- `ceiling_adjust`：記錄 old/new ceiling；agent 只能 tighten，authenticated user/DOA
  才能 loosen。
- `scope_frozen`：禁止增加 acceptance/scope，進入 `CLOSING`。
- `finish_requested`：停止發新 campaign grant，現有 effect到安全 checkpoint後取消或
  完成 closure allowlist。
- `abort_requested`：撤銷未消耗 grant，取消 active effects，進入 `ABORTING`。

每次 effect 前與 campaign boundary 都要比對最新 sequence。舊 sequence 的 dispatch
不能建立新 worktree、runner 或 review。

### 3.5 Progress, projection, and context

Mission checkpoint 只在 campaign terminal/control/verified blocker event 更新：

```text
progress = acceptance_satisfied_delta
         + verified_blocker_resolved_delta
         + scope_debt_reduced_delta
```

Churn、tool count、commit count、reviewer數量與文字自評只作成本 telemetry。Unknown
counter 保持 unknown。第二個相鄰 zero-delta campaign terminal 時：若全部 acceptance
已滿足則 `COMPLETE`；否則直接 `BLOCKED/stagnation`，不使用模型判斷「是否仍可能」。
第三個 campaign grant 一律拒絕；只有 authenticated successor/override 可重新開路。

每個 campaign boundary 產生 schema-validated、content-addressed `MissionProjection`。
下一個 Work Unit 使用 fresh root context，只注入 frozen intent、remaining acceptance、
red lines、remaining budget、current blockers、decision log，以及每個 source receipt 的
`{type,id,digest,state}`；不重播完整 transcript/tool output。Projection 必須包含足以
重算同一 Mission state hash 的 ordered event head，verified blocker 只帶 digest-bound
minimal evidence summary，不帶未授權 raw model output。

## 4. File-structure map

| File / surface | Responsibility |
|---|---|
| `schemas/mission-convergence-contract.schema.json` | Mission policy、lineage、control 與 parent-grant contract |
| `schemas/mission-convergence-receipt.schema.json` | Grant claim/no-effect release/reconciliation、closure-allowlist 與 terminal receipt schemas |
| `schemas/mission-projection.schema.json` | Fresh-context projection、ordered state head and digest-bound source refs |
| `src/engine/mission-convergence.js` | Pure reducer、budget math、grant/receipt/control validation；不 spawn |
| `src/engine/authenticated-control.js` | Host-injected control adapter interface and sequenced event validation |
| `scripts/mission-convergence-check.js` | `init|grant|consume|control|check|receipt` deterministic CLI |
| `scripts/owner-kernel.js` / Owner Kernel modules | Freeze project default/task override and store task-authority/provenance binding; no lineage, Mission-control, or grant decision authority |
| `schemas/task-authority-envelope.schema.json` | Additive Mission policy digest/lineage fields |
| `project-config-template/governance-config.md` | Project default once; task override semantics |
| `src/engine/implementation-campaign.js` and campaign checker | ICC-owned consumption of versioned Mission grant; no second Mission reducer |
| `src/mission/cli.js` | Per-plan machine-oriented `mission` subcommand tree; no task `DONE` status |
| `bin/autopilot.js` | One deferred import/route to `src/mission/cli.js` in P2 only, after ICC Phase 3 merges; no policy |
| `skills/ceo-agent/`, `skills/l3/`–`skills/l6/` | Route campaigns through grants; project unsupported axes honestly |
| `hooks/tests/mission-convergence*.test.sh` | Reducer, lineage, controls, replay, integration and enforcement fixtures |
| `platforms/codex/plugin/**` | Generated mirror only |

This plan does **not** modify `skills/finish-flow/SKILL.md`, worktree reapers, provider probes,
task-status/merge modules, transcript adapters, plan-review state, finding adjudication or
test-receipt implementation.

Remaining shared files are additive integration surfaces, not shared decision ownership:

| Shared surface | Sequencing rule |
|---|---|
| `bin/autopilot.js` | Each plan owns a separate subcommand module; the root receives only a deferred import/route. Mission registration waits for ICC Phase 3 and rebases once. |
| `src/status/cli.js` | PRO owns `readiness`; LSM owns `task`. Neither reads or rewrites the other's predicates. |
| `schemas/lifecycle-residue-receipt.schema.json` | WLB authors/version-controls it; LSM imports and validates it read-only. |
| `platforms/codex/plugin/**` | Generated once from the final canonical tree; never independently edited by a plan. |

## 5. Implementation phases

### P0 — Integration oracle and enforcement probe（S）

1. Build these sanitized deterministic fixtures and healthy controls:

   | Fixture | Frozen test ceiling/control | Expected terminal before observed runaway |
   |---|---|---|
   | successor/model/branch reset | `max_tool_calls=100`; lineage consumed 99, successor requests 2 | second call rejected as `BLOCKED/resource_ceiling:tool_calls`; identity change leaves 1 remaining |
   | direct/no-agent stagnation | unresolved acceptance + `max_stagnant_campaigns=2`; two terminal receipts have zero acceptance/blocker/scope-debt delta | second receipt transitions directly to `BLOCKED/stagnation`; third grant rejected |
   | ignored user finish | authenticated `finish_requested` sequence 7 while dispatch carries sequence 6 | `CLOSING/control_sequence_stale`; zero new runner/worktree/review |
   | provider maintenance leakage | required PRO seat receipt is `blocked`; proposed work is transport/qualification repair | ICC emits `PRESPEND_REJECTED/provider_readiness`, Mission consumes no-effect release without rejudging PRO; separate maintenance-Mission candidate only |
   | closure ratio | tool axis `75/100` with other enforced axes below 0.75 | enter `CLOSING/resource_ratio:tool_calls`; unknown required axis cannot trigger or pass enforcement |
   | invalid review authority | ICC receipt references raw-only review with no canonical semantic digest | zero Mission progress and no new grant authority |

2. Add a deterministic cross-plan ownership check that fails when two active plans claim the same
   authority (`campaign_generation`, `provider_readiness`, `worktree_lifecycle`,
   `task_can_close`, `plan_review`, `transcript_adapter`, `runner_transport_envelope`).
3. Probe the current Codex plugin/host execution boundary with a harmless blocked fixture. Record
   exactly one disposition:
   `codex_enforcement_outcome=block-capable|wrapper-required|unenforceable-now`。If a hook cannot
   truly block, freeze the wrapper path; if neither boundary works, remain shadow and stop research.

**Acceptance**：incident fixtures fail on current behavior for the intended Mission-level reason；
ownership checker passes this consolidated portfolio；Codex enforcement branch is chosen from an
execution artifact, not documentation inference；P2 may not start without the recorded disposition。

### P1 — Mission schema, reducer, and shadow ledger（L）

**Hard size cap**：one L Work Unit and one independently mergeable PR. It contains only pure
Mission schemas/reducer/control/projection plus shadow wiring; no engine effect or root CLI
registration。

1. Implement schemas, config resolution, lineage binding, per-axis reservation/consumption math,
   single-use atomic claim, pre-spawn no-effect release, terminal reconciliation, idempotent resume
   and successor inheritance.
2. Implement state/control transitions, `AuthenticatedControlAdapter`,
   `ClosureAllowlistReceipt`, and compact projection.
3. Extend TaskAuthorityEnvelope/Owner Kernel only with content-addressed Mission fields; preserve
   existing authority, task tree and action contracts.
4. Run incident replays in `shadow`; compare would-block events with healthy controls and calibrate
   seed ceilings only by explicit config revision.

**Acceptance**：model/runner/session/branch/successor cannot reset remaining；agent override cannot
loosen；authenticated task override is auditable；old configs stay off-compatible；no effect is
blocked during shadow；resume reuses one claim without double reserve；terminal reconciliation
consumes/releases the original reservation exactly once；fresh root context reaches the same state
hash using projection alone。

### P2 — ICC binding and current-Codex enforcement（L）

**Hard size cap**：one L Work Unit and one independently mergeable PR. This phase may touch only the
Mission/ICC adapter, current-Codex adapter or wrapper, Mission CLI module/root registration, CEO
routing/tests, and generated mirrors. LSM implementation remains a later separate plan.

**Prerequisites**：ICC Phase 3, including `RunnerTransportEnvelope`, is merged；P0 has a recorded
Codex enforcement disposition；P1 schemas/reducer are merged。

1. ICC claims the Mission grant first, then runs its own contract, PRO readiness, context and WLB
   occupancy checks before generation/spend；every pre-spawn rejection emits a bound no-effect
   release；all `/l5`, `/l6` and canonical
   `engine implement-review` paths use this one composition point.
2. Wire campaign terminal receipts back to Mission usage/progress; missing or mismatched receipt
   fails closed without re-running ICC judgment.
3. Wire CEO lifecycle and authenticated `finish|scope-freeze|abort`; prove stale dispatches stop.
4. Use the P0-selected current-Codex blocking adapter or explicit wrapper. Engine-controlled paths
   may enforce only for `block-capable|wrapper-required`；`unenforceable-now` and unsupported
   harnesses remain shadow/backlog. Ship a rollback test proving
   `mission_convergence.enforcement_mode=shadow` blocks no live mutation.
5. Publish the versioned Mission receipt/projection interface for later LSM consumption. Do not
   implement LSM here. LSM remains the only human `DONE|NOT DONE`,
   `can_merge`, `can_close` and finish-marker authority.
6. Dogfood a multi-campaign fixture, run scoped/full quality gates once on the frozen candidate,
   and keep one-setting rollback to `shadow`.

**Acceptance**：all P0 incident fixtures terminate before their measured runaway region；normal
multi-campaign delivery completes；user control prevents new effects；Mission complete with residue
is represented as `mission_terminal=true` but cannot itself claim task closeout；grant vs contract
rejection provenance is unique；no sibling controller was reimplemented。

## 6. Dependency and delivery order

```text
already shipped:
  RSS finding/scope stop-loss

1. ICC through Phase 3 (campaign controller + verification receipt + shared runner envelope)
2. PRO readiness core ─┐
   WLB lifecycle core ─┼─ independent receipt producers
3. Mission P0 → P1
4. Mission P2            binds only after ICC Phase 3; publishes Mission receipt interface
5. LSM closeout          starts only after Mission P2; consumes Mission + ICC + WLB + merge/push

independent:
  PRS pre-code plan review
  CTR post-hoc transcript retro
  PRO native Kimi transport (optional follow-up; does not block readiness core)
```

Changed plan/rubric hashes invalidate their earlier READY provenance. Implementation begins only
after this ownership-consolidated revision receives a new bounded portfolio review.

## 7. Test / validation strategy

- Schema/config：missing、partial、unknown、agent loosening、authenticated override。
- Identity：model/runner/reviewer/session/PID/branch/successor cannot reset lineage usage。
- Reservation：concurrent claims、resume adoption、double spend、unused release、parent overflow。
- Rejection ownership：Mission binding/sequence vs ICC contract/PRO/context/WLB；claim failure creates
  no reservation and later pre-spawn rejection releases the full reservation exactly once。
- State：ACTIVE/CLOSING/BLOCKED/ABORTING terminal edges and stale sequence rejection。
- Progress：real acceptance delta、verified blocker、churn-only、two stagnant campaigns。
- Composition：fixed intake order and one owner per authority。
- Receipts：binding/digest drift、unknown sibling evidence、Mission terminal vs `can_close`。
- Controls：finish/scope-freeze/abort during active dispatch and after compaction。
- Ceiling controls：agent tightening、authenticated loosening、stale sequence、auditable old/new。
- Closure allowlist：required closure effect receipt、expired/stale/mismatched effect rejection。
- Context：digest-bound source refs and fresh projection resume to identical state hash。
- Rollout：three-state Codex disposition、shadow false-positive corpus、current Codex blocking proof、
  one-setting rollback and shadow-never-blocks fixture。
- Parity：canonical/Codex mirror and existing Owner Kernel/campaign/status tests。

Final commands include:

```bash
bash hooks/tests/mission-convergence.test.sh
bash hooks/tests/mission-convergence-integration.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/status-task.test.sh
bash scripts/validate.sh
bash scripts/check-canonical-invariants.sh
bash scripts/sync-codex-plugin-skills.sh --check
git diff --check
```

## 8. Risks + inversion

| Failure guarantee | Mitigation |
|---|---|
| Mission supervisor reimplements ICC | Parent grant/aggregate only; campaign internals are explicit out-of-scope |
| WLB also counts review generations | ICC is sole generation owner; WLB records IDs only as provenance |
| Three plans wire engine intake independently | ICC owns one ordered composition point; siblings export pure receipts |
| Mission terminal is called task clean | LSM alone computes `can_close`; false-clean fixture is mandatory |
| Adding units increases total budget | Atomic reservation under a frozen authorized ceiling |
| Successor/session/model resets usage | Durable `mission_lineage_id` inheritance |
| User says stop but old work continues | Authenticated sequenced control + pre-effect stale check |
| Tool/churn narration counts as progress | Only acceptance/blocker/scope-debt deltas |
| Missing telemetry becomes zero | `known value | unknown`; required unknown cannot enforce/close |
| Provider trouble becomes product work | Consume PRO receipt; maintenance is a separate Mission |
| Strong model is over-prompted | Guidance profile controls prompts; invariant enforcement stays outside model |
| Another mega-project forms during implementation | Three bounded phases; discoveries outside frozen rubric go to backlog |

## 9. Out of scope

- Capability-profile scoring, Artificial Analysis routing, model onboarding or repo split.
- ICC generation/finding/test implementation.
- Provider probes, fallback qualification or native Kimi transport.
- Worktree marker/journal/reaper/branch disposition.
- Task status, merge execution, push, `can_close` or `finish-flow` marker clearing.
- Plan-review controller or transcript adapters.
- Exact dollar/token billing when providers do not expose trustworthy telemetry.
- Universal Claude Code/OpenCode/Antigravity enforcement without execution evidence.
- Long-running daemon, scheduler, web dashboard or remote-control service.

## 10. Review log

- **R0 / 2026-07-26**：authored from transcript tail analysis and existing convergence primitives.
- **R0.1**：added direct/no-agent evidence, successor reset, invalid-output authority, authenticated
  controls, immutable evidence and provider-maintenance boundary.
- **R0.2**：pulled seven external plans at `origin/develop@bfc064a` and initially described them as
  sibling ownership.
- **R0.3 ownership audit / 2026-07-26**：KR-by-KR comparison found only 3/12 prior KRs fully unique,
  5 highly duplicated and 4 mixed. This revision removes campaign generation/test/finding,
  provider, lifecycle, task-status/merge and finish authority from TCC; deletes WLB generation
  ownership; makes ICC the sole effectful intake; makes LSM the sole `can_close` owner.
- **R0.4 transport-advisory correction / 2026-07-26**：`cc-shim` and direct MiniMax tickets ended
  transport STOP. Their non-authoritative advice still exposed three verified gaps: sole Mission
  grant-claim authority, sequenced ceiling receipts, and mechanical transport vs purpose-bound
  semantic validation. Rollback is now `mission_convergence.enforcement_mode`.
- **R1 authoritative portfolio review / 2026-07-26**：ticket
  `mission-convergence-portfolio-20260726-r4`, generation 1, plan
  `49832383732a063f1fb9c548bf4868e3606fbcfde5509f6cb403a54fcfbbeb92`, rubric
  `e9dcffa05c2f9e0a96d59ce1a655b4c0cc2dbfe0b1428817b291fa98d6260e48`。
  GLM-5.2 returned strict `READY`; MiniMax-M3 returned `STOP`; controller verdict
  `CONDITIONAL` with 8 admitted blockers and exactly one authorized repair generation. R2 repairs
  only those findings: explicit incident oracles, ICC-Phase-3 sequencing, single-use reservation
  reconciliation, authenticated control/closure receipts, explicit rejection ownership,
  digest-complete projection, evidence-gated enforcement, and phase/LSM ordering。
- **R2 bounded re-review + supplemental union / 2026-07-26**：generation 2 formally returned
  MiniMax `READY` + GLM `READY`, zero findings, for plan `d091898a…`; the controller became
  terminal and no generation 3 is legal. Same-hash supplemental seats then returned:
  Qwen `READY` (2 non-blocking clarifications), Kimi `READY` (2 non-blocking, including active
  reservation double-count), Grok `STOP` (that accounting defect blocking), and
  gpt-5.6-sol `STOP` (stagnation terminal ambiguity, provider-rejection owner, the same accounting
  defect, and grant-claim order). Depth-0 admitted the four independently verifiable blockers and
  applied one union correction: deterministic `BLOCKED/stagnation`; ICC-owned PRO rejection;
  terminal-only durable consumption with active telemetry inside full reservations; Mission atomic
  claim before ICC/PRO/context/WLB with exact no-effect release. Owner Kernel is now explicitly a
  provenance host, not a second lineage authority. No reviewer was dispatched on the correction.

Historical reviews do not authorize this revision:

- Original bounded ticket `task-convergence-contract-20260726` ended mechanical `STOP` because
  Grok emitted a prose preamble; MiniMax returned strict `READY`; admitted blockers = 0.
- One-time GLM/Qwen/Kimi supplemental panel ended mechanical `STOP` because GLM fenced JSON and
  Kimi prefixed its object; Qwen returned strict `READY`; admitted blockers = 0.
- Those reviews used older plan/rubric hashes and remain provenance only. The consolidated plan
  receives a fresh ticket without pretending it is generation 2 of either historical session.
