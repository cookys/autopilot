# P6D corrective gates — 三個機械閘,取代靠判斷的自律

## Project Goal
> **Final goal**: P6D 事故的三個失效類各有一個機械閘,且各自帶 planted negative case 證明擋得住。
> **Success criteria**: KR1-KR5(見 plan);BACKLOG 完成條件逐字滿足(三閘 planted red 皆 demonstrated)。
> **Scope boundary**: 含三閘 + 佈線 + 負控;不含 report budget 產品化、Mission scheduler、P6D 特例入策(六路徑/symlink 禁令)。

## Coverage ledger(plan §4)
P0 contract-first 閘 / P1 commit manifest 閘 / P2 repair ladder / P3 docs+release。

## Progress
| Item | Status |
|---|---|
| Admitted deliverable: three mechanical gates + negative controls (P0-P3) | plan under review |

Plan: ../../plans/2026-08-21-p6d-corrective-gates.md

## P0(a) — Frozen call-edge matrix(2026-08-21 audit,coding 前凍結)

| Edge | file:function | 角色 |
|---|---|---|
| **S successor** | `src/mission/runtime.js` `prepareMissionRuntimeSuccessor`(~:888;identity ~:873)| **THE 擴張邊** —— P6D 走的 `mission successor`;既有前置(terminal source、canonical ABORTED、inherit flag)之後插 KR3 述詞 |
| **A abort** | `mission finalize-abort` handler(runtime.js)+ `mission-convergence.js:1110` canonical ABORTED terminal | 正式 terminalization 邊 |
| **E engine-internal** | `autopilot-engine.js` `terminalizeControllerWorkOrder` :5972(呼叫點 :7511 sealed_zero_diff / :7720 campaign_non_success / :8035 terminal_ready)| **engine-derived 結果 —— enum 側,不設閘**(deadline/round 耗盡等機器狀態)|
| **Gate-fail 證據** | `controller-execution.js` `classifyBoundaryRejected` :719 → campaign durable state `phase=BOUNDARY_REJECTED` `{candidate_ref, boundary_code, boundary_reason, possibly_effectful}` | 收據的 compared-against 狀態 |
| **合法修復路(必須保持暢通)** | `campaign-intake.js` :767-814 durable-wait 同 campaign resume(no_op adoption 保 candidate)| ladder 指向的「便宜本地修復」正道 |
| **Terminal 詞彙** | `CAMPAIGN_STATES`(implementation-campaign.js:8)、terminalStatus {success, failed, aborted, terminal_follow_up}、mission `TERMINAL_STATES` | bypass enum 對映基底 |

P0(b) 殘餘:mission↔campaign identity 連結(`mission-campaign-identity.js`)確認 successor/abort 邊上可讀 campaign durable state → 述詞函式 + 兩邊佈線 + planted red/green/bypass + in-situ caller tests。

## P1 — KR2 GO checkpoint(2026-08-21,CEO 依 R2' 記錄)

**裁決:GO,範圍鎖定 wrapper-owned staging。**

- **可達性事實**(推翻 NO-GO 傾向的關鍵):staging 動作屬 hetero 引擎自主行程,原以為
  行動點不可達;但 `dispatch-hetero.sh` 的 edit-only 捕獲路徑自己 `git add -A`(:3013)——
  正是 P6D「broad staging」的形狀,且 `STRICT_SCOPE_ALLOW_PATHS` 同作用域。
- **等價性(G2 CG3 入場條件)**:不造第二個比對器 —— `check-disjointness.sh` 增 `--staged`
  輸入模式(同一 matcher,兩種輸入),corpus 六案(全子集/部分子集/P6D 雙 symlink/rename
  出界/允許刪除/deny hit)staged vs post-commit verdict 全一致
  (`hooks/tests/p6d-gates-manifest.test.sh` part 1)。
- **rename 語意**:`git diff --name-only` 天然 collapse 至新路徑 = R2' 凍結的
  rename=delete+add;比對器既有行為,零新語意。
- **自 commit 引擎**:不經 wrapper staging → post-commit 閘維持其權威後盾(corpus 同時
  釘住其行為)。

## P0(a) 矩陣處置附記(2026-08-21,R2/R3 後)
successor/abort 邊與 mission 後盾佈線隨 durable lock 一併退場(pre-merge review 兩枚 🔴:
解鎖路不可達 = 永久死鎖)。KR3 現為 terminalize 邊單點無狀態拒絕;矩陣保留為凍結稽核
工件,不回寫。lock 重入條件見 BACKLOG「Durable repair-lock」。
