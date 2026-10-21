# 可發現性盤點：engine 組

範圍：CLAUDE.md「Routing & config resolution」17 項、「Engine capability & qualification」35 項、「Execution profiles」4 項（共 56 支腳本，含 lib/），加 `bin/autopilot.js` 全部子命令與 `src/` 對外 CLI 入口。
方法：對每支腳本逐一 grep `skills agents AGENTS.md references`（入口）、`hooks src bin`、`scripts`（呼叫端），排除 tests、`platforms/`（codex 鏡像）、`.claude/worktrees/`。再讀檔頭／usage 確認它做什麼。

## 白話總結

56 支腳本分類：A 自動 6、B 入口有教 28、C 只有事後提醒 0、D 找不到 4、E 不需 agent 14、F 死碼嫌疑 4。
另外 `bin/autopilot.js` 子命令族另算（見主表 #1、#2、#4、#7）。

好消息：`skills/engine-onboarding` 與 `skills/harness-maintenance` 點名的 24 支腳本全部存在，flag 與腳本 usage 對得上（`harness report --stale-after/--required-level/--format warning` 對 `src/harness/cli.js:15`）。`resolve-dispatch.sh`、`engine-scorecard.js`、`resolve-review-loop.sh` 都有入口叫 agent 先查（`dev-flow/SKILL.md:302-311`、`dev-flow/references/model-routing.md:127-132`，另有 `hooks/dispatch-model-guard.js` 擋）。

壞消息，最嚴重 3 項：
1. **`autopilot status`（總覽／quota／roster／readiness）與 `autopilot endpoints list/which/doctor` 沒有任何入口叫 agent 先查。** 這兩組正是「派工前先看席位能不能用、額度還剩多少、endpoint 通不通」的工具，入口零命中。agent 只能憑記憶或撞牆才知道。memory 裡有「dispatch-review 派工前置：先查 roster」，但沒進 repo。
2. **`autopilot campaign inspect|status|resume|terminalize` 與 `engine review-candidate` 入口零命中。** campaign 停車後怎麼查、怎麼恢復、怎麼收尾，agent 沒處學；`review-candidate`（審外部產生的 base..head，零 writer 花費）只有人類文件 `docs/review-candidate.md` 與 README，agent 入口不指向。
3. **`qualification-feed-trust.js answer` 是 owner 在面板回覆後 agent 必須再跑一次的步驟**，入口零命中，只有 `docs/settings-reference.md:181`（人類文件）與 `docs/backlog/p6-trust-followups.md:5` 自己承認「回覆後還要再跑一次 answer 才算數」。不跑，owner 的確認就不生效。

## 主表（C/D/F，依影響排序）

| # | 名稱 | 它做什麼 | agent 何時該用 | 判定＋證據 | 建議放進哪個入口 | 不用會怎樣 |
|---|------|----------|----------------|------------|------------------|------------|
| 1 | `autopilot status`（無參數總覽）、`status quota`、`status roster`、`status readiness [--probe]` | 一個指令看 quota 池狀態與觀測年齡、live runs、roster 席位能否用（`src/status/cli.js:2-24`）；`readiness --probe` 是有界的真實花費探測 | 派 hetero 工作、開 /l5 /l6 前，或看到 `engine_unavailable`／額度疑慮時 | **D**。`grep -rnE "autopilot.js\"? status\|status (roster\|readiness\|quota)" skills agents AGENTS.md references hooks/*.js src/hooks` 只命中 `status runs`／`status task`（`references/mods.md:162`、`hetero-dispatch.md:326`、`l5/SKILL.md:64`）；overview/quota/roster/readiness 零命中。SessionStart 注入（`src/hooks/handlers/session-start.js` `BASE_AUTOPILOT_CONTEXT`）只有 12 列 skill 表。 | `skills/l5/SKILL.md` 與 `skills/l6/SKILL.md` 的 front-door 啟動步驟加一句「派前先跑 `node bin/autopilot.js status readiness --json`」；`skills/ceo-agent/references/depth0-control-loop.md` 的 quota 恢復段加 `status quota`；`skills/dev-flow/references/model-routing.md` 在 `resolve-dispatch.sh` 旁補一列 | 派工才發現席位不可用，白燒一輪；額度被打爆前沒有預警 |
| 2 | `autopilot endpoints list / which / doctor / init` | list：已定義 endpoint；which：此 repo 的 reviewer/implementer 實際選到哪個；doctor：檔案權限與未解析 endpoint（不連網）；init：建 `~/.autopilot/endpoints.env` 樣板（`src/endpoints/cli.js:518-529`） | 設 `reviewer_endpoint`/`implementer_endpoint` 前、dispatch 回 auth／endpoint 錯誤時 | **D**（`set`、`test` 有教）。`grep -rnE "endpoints (list\|which\|doctor\|init)" skills agents AGENTS.md references hooks src/hooks scripts` 只命中 `references/probe-playbook.md:90`（債務式 probe 條目，經 `debug` skill 連到，且只提 `which`）。`skills/l5/references/hetero-impl-loop.md:51-52` 只教 `load-endpoints-env.sh`+`resolve-endpoint.sh`。 | `skills/l5/references/hetero-impl-loop.md` 第 51 行那條 endpoint 說明後加「不確定時 `autopilot endpoints which` / `doctor`」；`skills/onboard/SKILL.md:86` 旁補 `doctor` | 憑空猜 endpoint 設定；token 權限錯誤（600）不被發現 |
| 3 | `qualification-feed-trust.js status / sync / answer --card <id> --decision confirm\|reject` | `qualification_feed.trust=confirm` 時，owner 在面板回答決策卡，agent 還要執行 `answer` 才寫入 confirmations.jsonl（`scripts/qualification-feed-trust.js:4-12`；`docs/backlog/p6-trust-followups.md:5`） | owner 在待決面板回覆 feed 確認卡之後 | **D**。`grep -rn "qualification-feed-trust" skills agents AGENTS.md references hooks src` 零命中；唯一敘述在 `docs/settings-reference.md:181`（人類文件，不算入口）。 | `skills/engine-onboarding/SKILL.md` Available Scripts 表加一列（Stage 0.5 段旁），寫明「owner 回覆後必須再跑 `answer`」。注意這是 guidance 變更，依 scorecard-first 需 eval 證據（backlog 該條已記） | owner 以為已確認，實際沒生效；admission 不會用該 feed 的資格 |
| 4 | `autopilot campaign inspect / status / resume / terminalize --campaign-id <id> [--ledger <file>]` | 讀 campaign ledger：投影狀態、判斷能否 resume、必要時 terminalize 收掉死 campaign（`src/campaign/cli.js:111`、`:1007`、`:1024`） | campaign 被停車（AWAITING_DISPOSITION、REVIEWING、boundary_rejected）、session 重開接手、foreman 死亡時 | **D**。`grep -rnE "autopilot\.js\"? campaign\|autopilot campaign\|campaign (inspect\|status\|terminalize)" skills agents AGENTS.md references hooks src/hooks` 零命中。`skills/l5/references/hetero-impl-loop.md:240` 講「parked in REVIEWING … is resumable」但沒說用哪個指令查、怎麼恢復。 | `skills/l5/references/hetero-impl-loop.md:240` 同段補 `campaign status --campaign-id <id>`／`resume`；`skills/ceo-agent/references/depth0-control-loop.md` 的 foreman 死亡列補 `campaign inspect` | 手動翻 ledger 檔猜狀態；死 campaign 留著佔 lease，下一輪被擋 |
| 5 | `engine review-candidate`（`--campaign-contract --spec-file …`） | 對外部產生的 `base..head` 範圍做只審不寫的 campaign 審查，零 implementer/repair 花費（`bin/autopilot.js:50-60`、`docs/review-candidate.md:13`） | 有人（owner、別的 session）已經寫好一段 commit，要走 sealed 合約的正式審查而不是臨時 dispatch-review | **D**。`grep -rnE "review-candidate\|review_candidate" skills agents AGENTS.md references hooks/*.js src/hooks` 零命中；全 repo 只在 `docs/review-candidate.md`、README、CHANGELOG、plans。 | `skills/hetero-review/SKILL.md`（code loop）加一句路由：「範圍已存在、無 writer ⇒ `engine review-candidate`，見 docs/review-candidate.md」；或 `skills/quality-pipeline/SKILL.md` 審查節 | agent 為已完成的 commit 重跑 implement-review（付 implementer 費用），或繞過 sealed 路徑自己叫 reviewer |
| 6 | `probe-codex-enforcement.js`、`probe-codex-postcompact-production.js` | Codex 側實測探針：前者驗 PreToolUse 拒絕行為（`--output <artifact.json>`），後者有界的 live PostCompact 驗證 | 動 Codex 套件或宣稱 Codex hook 能力之前（harness-maintenance 的任務範圍） | **D**。`grep -rn "probe-codex-enforcement\|probe-codex-postcompact" skills agents AGENTS.md references` 零命中；`skills/harness-maintenance/SKILL.md:30-39` 的 Available Scripts 表沒列。呼叫端只有測試（`hooks/tests/codex-enforcement-probe.test.sh`、`codex-postcompact-production-live-driver.test.sh`）與 config-keys.json。 | `skills/harness-maintenance/SKILL.md` Available Scripts 表各加一列；`references/multi-agent-portability.md` 的 Codex 欄指到它們 | 更新 Codex 能力宣稱時沒有可重跑的證據來源，只能憑文字 |
| 7 | `autopilot mission successor / init / consume / withdraw / control / finalize-abort / check / receipt`（`prepare`、`grant` 有教） | Mission 收斂 runtime 的底層操作（`src/mission/cli.js:813-826`） | 一般情況由 engine 內部經 `src/mission/runtime.js` 呼叫；`check`/`receipt` 供人工驗 | **D（低）**。`grep -rnE "mission (consume\|withdraw\|control\|finalize-abort\|receipt\|init)" skills agents AGENTS.md references` 零命中；`mission check` 只在 `references/evidence-discipline.md`（事後教訓）；只有 `scripts/mission-convergence-check.js:5-12` 這個薄包裝與測試呼叫。`prepare/grant` 在 `l5/references/hetero-impl-loop.md:201-202` 有教。 | 暫不必進入口；若要保留，`scripts/mission-convergence-check.js` 所屬的 Mission 參考文件註明「其餘子命令為 engine 內部」 | 低；多半由 engine 自己處理 |
| 8 | `probe-engine-capability.sh` | 對 runner 做安全探測（binary／auth 面，不花模型費），寫入 capability 狀態（`scripts/probe-engine-capability.sh:2`） | 席位疑似不可用、`engine_unavailable` 後要刷新 capability 觀測 | **D（低）**。agent 入口零命中（`grep -rn "probe-engine-capability" skills agents AGENTS.md` 零；`references/evidence-discipline.md:460` 只是事故敘述）。唯一程式呼叫端是 `src/status/cli.js:83`（`status quota --probe`），即經項 #1 才到得了。 | 隨 #1 一起解決：在 `status quota --probe` 的說明裡帶出 | 額度／可用性資料過期而不自知 |
| 9 | `qualification-metrics.js`（`fetch` / `status` / `order`） | 讀 registry 的 `qualification-metrics.json`，快取並供席位排序（`scripts/qualification-metrics.js:4-14`） | 不明：無任何流程叫它 | **F 嫌疑**。`grep -rn "qualification-metrics.js" . --exclude-dir=.git --exclude-dir=platforms --exclude-dir=worktrees` 排除自身與 tests 後，`scripts/engine-qualify.js:417`、`scripts/qualification-send-queue.js:33` 引的是 `lib/qualification-metrics.js`（函式庫），不是這支 CLI；沒有 SKILL／hook／腳本呼叫 `fetch`，所以快取誰來填不明。 | 先確認設計：若它要被 `qualification_feed` 流程自動呼叫，補上呼叫端；若純人類維運，在 `docs/scripts-inventory.md` 與腳本檔頭標明 | 排序用的 metrics 快取永遠是空的，功能做了沒生效（CLAUDE.md 警語的典型情境） |
| 10 | `resolve-execution-profile.js`（`grant`／`verify`） | 依 envelope 與 input 產出／驗證 role execution grant（`scripts/resolve-execution-profile.js:14-15`） | 不明：profile 屬 shadow 模式，grant 由「host 提供」 | **F 嫌疑**。`grep -rn "resolve-execution-profile" . --exclude-dir=.git --exclude-dir=platforms --exclude-dir=worktrees` 排除 CLAUDE.md／inventory 後，僅 `project-config-template/governance-config.md:16` 一句說明與測試 `hooks/tests/execution-profile.test.sh`；`resolveRoleExecutionGrant` 的程式呼叫端只在 `src/engine/execution-profile.js`（定義）與 index 匯出。 | 若 profile 機制仍是 shadow 且 owner 已知，在 inventory 標「無 runtime 呼叫端，owner 手動」；否則補呼叫端 | 低；shadow 階段無行為影響 |
| 11 | `check-profile-isolation.js` | 驗 profile 隔離的 prose／runtime／trace 三種形式（`scripts/check-profile-isolation.js:18-20`） | 不明 | **F 嫌疑**。`grep -rln "check-profile-isolation" . --exclude-dir=.git --exclude-dir=platforms --exclude-dir=worktrees` 只有 CLAUDE.md、inventory、舊 plan／evidence 與 `hooks/tests/profile-context-isolation.test.sh`；沒有 SKILL、hook、release gate 呼叫。 | 同 #10 | 低 |
| 12 | `profile-session.js`（`prepare`／`measure`／`run`／`check`） | 建單一 profile 的無效果 Claude `--bare` 探針並量測（`scripts/profile-session.js:12-23`） | 不明；`l4/SKILL.md:54`、`l5/SKILL.md:82`、`l6/SKILL.md:114`、`dev-flow/references/card-relocated.md:75` 都只陳述「canonical `profile-session.js` lane 只證明無效果隔離」，沒說何時、誰去跑 | **F 嫌疑（有事實提及、無用法）**。`grep -rn "profile-session" skills agents references` 只命中上述四處陳述；腳本呼叫端零（`grep -rn "profile-session" scripts hooks src` 排除自身與 tests 零命中）。 | 同 #10；或把四處陳述改成指到 profile 文件 | 低 |

## 其他發現（非 C/D/F，但與入口品質有關）

- **bin 用法列與實作不一致**：`bin/autopilot.js:36` usage 寫 `endpoints <init|list|which|set|doctor>`，實作 `src/endpoints/cli.js:546` 另有 `test`，且 `skills/ceo-agent/references/depth0-control-loop.md:172` 已在教 `endpoints test`。agent 讀 usage 看不到 `test`。建議補進 `bin/autopilot.js` usage。
- **`harness report --format warning` 標榜「SessionStart-style」**（`skills/harness-maintenance/SKILL.md:23`），但沒有任何 hook 呼叫它：`grep -rn "harness report" hooks src/hooks .claude/settings.json hooks/hooks.json` 零命中。要靠 agent 載入 harness-maintenance skill 才會跑，沒有自動提醒。
- **`dispatch review`、`engine review-loop` 子命令**是 `dispatch-review.sh`、`resolve-review-loop.sh` 的別名（`bin/autopilot.js:30-31`），skills 教的是腳本路徑本身，不是別名，所以別名沒教不構成缺口（歸 E）。

## 附錄（A/B/E）

### A 自動（6）
- `resolve-worktree-teardown.sh`：`scripts/dispatch-hetero.sh:1921`、`scripts/lib/worktree-reap.sh:413`
- `resolve-scaffold-tier.js`：`scripts/dispatch-hetero.sh:2709`、`scripts/engine-scorecard.js:24`、`src/engine/roles.js:43`
- `lib/scaffold-envelope.sh`：`scripts/dispatch-hetero.sh:2708`
- `lib/config-audit.js`：`hooks/session-start.js:192`、`scripts/dev-setup.sh:348`
- `lib/autocompact-window.js`：`hooks/context-budget.js:21`、`scripts/dev-setup.sh:322`
- `qualification-prices.js`：SessionStart 背景刷新 `hooks/session-start.js:211`；說明在 `references/hetero-dispatch.md:197`

### B 入口有教（28）
- `resolve-dispatch.sh`：`skills/dev-flow/references/model-routing.md:128`；`hooks/dispatch-model-guard.js:214`
- `resolve-dispatch-topology.js`：`skills/ceo-agent/references/level-front-door.md:225`
- `resolve-doa.sh`：`skills/dev-flow/references/model-routing.md:127`
- `resolve-endpoint.sh`：`skills/l5/references/hetero-impl-loop.md:52`
- `resolve-knowledge-routing.sh`：`skills/learn/SKILL.md:43`、`skills/handoff/SKILL.md:52`
- `resolve-project-paths.sh`：`skills/finish-flow/SKILL.md:68`、`skills/research-to-ship/SKILL.md:48`
- `resolve-qc-gate.sh`：`skills/finish-flow/SKILL.md:61`、`skills/quality-pipeline/SKILL.md:59`
- `resolve-review-loop.sh`：`skills/dev-flow/SKILL.md:71`、`:305`
- `load-endpoints-env.sh`：`skills/l5/references/hetero-impl-loop.md:51`、`skills/onboard/SKILL.md:86`
- `engine-scorecard.js`：`skills/dev-flow/SKILL.md:302`、`:311`
- `engine-capability-state.js`：`skills/l5/references/hetero-impl-loop.md:195`、`skills/engine-onboarding/SKILL.md:20`
- `engine-qualify.sh`：`skills/dev-flow/SKILL.md:311`、`skills/engine-onboarding/SKILL.md`
- `engine-qualify.js`：`skills/dev-flow/references/model-routing.md:89`
- `qualification-case-broker.js`：`skills/engine-onboarding/SKILL.md:45`
- `qualification-review-provider.js`：`skills/engine-onboarding/SKILL.md:46`
- `probe-local-engine.js`：`skills/engine-onboarding/SKILL.md:47`（用法與腳本 HELP 相符）
- `probe-harness-capabilities.sh`：`skills/harness-maintenance/SKILL.md:36`
- `probe-todo-tools-pin.js`：`skills/harness-maintenance/SKILL.md:38`
- `probe-skill-frontmatter-portability.sh`：`skills/harness-maintenance/SKILL.md:35`
- `platform-capability-claims.js`：`skills/harness-maintenance/SKILL.md:37`
- `bench-engine-capability.sh`：`references/hetero-dispatch.md:873`（弱：只說「唯一能記錄 native 支援者」，未說何時跑；`project-config-template/review-loop-config.md:447` 同）
- `import-aa-capabilities.js`：`skills/engine-onboarding/SKILL.md:50`、`:217`
- `evaluate-profile-cutover.js`：`skills/engine-onboarding/SKILL.md:49`（弱：僅表列，無呼叫端）
- `build-qualification-defaults.js`：`skills/engine-onboarding/SKILL.md:52`
- `adopt-qualification-defaults.js`：`skills/engine-onboarding/SKILL.md:51`、`:72-83`
- `qualification-sweep.sh`：`skills/engine-onboarding/SKILL.md:53`、`:88`
- `qualification-send-queue.js`：`skills/engine-onboarding/SKILL.md:56`；`scripts/engine-scorecard.js:2399` 自動 enqueue
- `measure-profile-context.js`：`skills/harness-maintenance/SKILL.md:34`

### B 入口有教（bin 子命令）
- `engine implement-review`：`skills/l5/SKILL.md:41`、`skills/l6/SKILL.md:51`、`skills/ceo-agent/references/level-front-door.md:24`
- `harness report`：`skills/harness-maintenance/SKILL.md:19`、`:25`
- `status task`：`references/hetero-dispatch.md:326`、`skills/l5/SKILL.md:64`、`skills/l6/SKILL.md:88`、`skills/ceo-agent/references/depth0-control-loop.md:321`
- `status runs`：`references/mods.md:162`（該檔未被任何 SKILL 連到，弱）
- `merge execute`：`references/hetero-dispatch.md:386`
- `mission prepare/grant`：`skills/l5/references/hetero-impl-loop.md:201-202`
- `endpoints set`／`test`：`skills/engine-onboarding/references/local-model-team-recipe.md:16`、`skills/ceo-agent/references/depth0-control-loop.md:172`

### E 不需 agent（14 支腳本＋ bin 別名）
- `lib/resolve-config.sh`：被 `scripts/resolve-knowledge-routing.sh:77`、`resolve-project-paths.sh:62` source
- `lib/load-endpoints-env.js`：`src/endpoints/cli.js:15`、`src/readiness/probe.js:22`、`src/engine/local-deployment.js:16`
- `lib/agy-containment.js`：`scripts/dispatch-review.sh:1802`
- `lib/qualification-feed.js`：`scripts/adopt-qualification-defaults.js:374`
- `lib/qualification-asset-seals.js`：`scripts/engine-qualify.js:95`
- `lib/qualification-applicability-scope.js`：`scripts/engine-scorecard.js:735`
- `lib/qualification-metrics.js`：`scripts/engine-qualify.js:417`、`scripts/qualification-send-queue.js:33`
- `lib/qualification-confirm.js`：`scripts/qualification-feed-trust.js:19`、`scripts/engine-scorecard.js:37`
- `lib/qualification-prices.js`：`hooks/session-start.js:211`
- `lib/qualification-record-v2.js`：`scripts/engine-qualify.js:114`、`scripts/engine-scorecard.js:533`
- `lib/qualification-usage.js`：`scripts/engine-qualify.js:1890`
- `lib/qualification-effort-label.js`：`scripts/lib/grok-effort.js:7`
- `lib/qualify-stage-credentials.sh`：給 `docs/plans/evidence/*/administration/*/run.sh` 食譜 source（`docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/seat7-kimi-k3-kimi-consult/run.sh`），測試／施測輔助
- `build-profile-payload.js`：release 閘門 `scripts/sync-manifest.json:201`；`references/skill-contract-card.md:59,68` 清單
- bin 別名 `dispatch review`、`engine review-loop`：包裝 `dispatch-review.sh`／`resolve-review-loop.sh`
- `src/engine/` 內的 `*.py`（supervised-*）、`repair-lineage-cleanup*.js`、`external-lifecycle-witness.js`、`sealed-zero-diff-validator.js`、`verification-strength.js`：引擎內部子進程／伺服器；呼叫端 `src/engine/autopilot-engine.js:2334`、`:2459`，`scripts/dispatch-hetero.sh:1664`，`scripts/verify-strength.js:5`
- `src/runners/*.js`：無 CLI 入口（無 `require.main`），純函式庫
- `src/status/review-server.js`：由 `status runs --watch` 啟動（`src/status/review-server.js:4`）

## 計數

腳本 56：A 6、B 28、C 0、D 4（#3 qualification-feed-trust、#6 兩支 codex probe、#8 probe-engine-capability，其中 #6 算兩支故合計 4）、E 14、F 4（#9、#10、#11、#12 對應的腳本）。
bin 子命令族 D：status 總覽／quota／roster／readiness、endpoints list／which／doctor／init、campaign 四個、engine review-candidate、mission 其餘八個（共 5 族，見 #1、#2、#4、#5、#7）。
