## 目標

無進行中工作。這份 handoff 記錄 2026-09-04 的第二段：**v2.35.16 預設派遣拓樸（brain up, hands down）** 已出貨、merge、push；
以及當天稍早收掉的舊帳（ladder 裁定、fixture 隔離、guard headless BACKLOG）。

## 現況

- **branch**: `develop`，與 `origin/develop` 同步在 `8e188403`（handoff commit 在其後）；working tree 乾淨；`docs/projects/` 無進行中專案。
- **version**: 2.35.16（28 hooks：15 default-on／13 opt-in；新 default-on `cost-fuse`）。
- **session marker**: 已 clear。governance `enforcement_mode` 為 **enforce**（分支期間曾 shadow，merge 前還原）。
- **dogfood roster**（`.claude/review-loop-config.md`）：implementer 仍是 grok-4.5@grok（派工期間暫切 gemini，已還原）。
  `implementer_ladder` 未設 `auto`——這台是否採用 auto 是 owner 決定（見下一步 2）。
- **測試**: 全套 `run.sh --parallel 4` 平行段 ALL TESTS PASSED；重釘後 `autopilot-engine` 470、`check-hook-inventory` 18、
  `resolve-review-loop` 335、`cost-fuse` 63、`dispatch-model-guard` 65 單跑綠。既有紅：`opencode-v2-plugin` 3 條在 develop 上同樣紅
  （opencode 1.18 `debug config` 行為漂移，未修）。`slash-entry-probe` 在負載下 0-byte，單獨開 probe 7/7 綠。

**DONE**（v2.35.16，merge `8e188403`）：`scripts/resolve-dispatch-topology.js`＋`implementer_ladder: auto`＋rung-0；
`resolve-dispatch.sh` implementer→sonnet、`hands`→haiku；`dispatch-model-guard` `guarded_models_implementing`＋`require_engine_header`
（缺 model 先走 `on_missing_model`）；`hooks/cost-fuse.js`＋`scripts/cost-digest.js`；front-door canonical 拓樸段、l3–l6 薄殼。
完整帳在 `CHANGELOG.md` v2.35.16 節與 `docs/projects/_archive/2026-09-04-default-dispatch-topology/`（README＋ledger/P0–P4）。

**IN-FLIGHT**: 無。沒有背景派工。cuda 的 fleet 訊息皆已回覆（設計＋rollout；owner 裁定確認；出貨通知＋P5 配方）。

## 已決事項(不重議)

- **§8 四項照提案值**（owner 2026-09-04，cuda 轉達＋本機直接裁定）：門檻 USD 150/host/day；`judgment` 也 rung-0；`/l3` 改 brain brief
  + sonnet hands，`--solo` 唯一 inline 逃生；未合格引擎不進 ladder（`candidates_to_qualify`）。
- **claude-native 退路不展開進 hetero ladder**——`claude_fallback_ladder` 只是給原生 Agent 派工的提示，`dispatch-hetero` runner enum
  沒有 claude-native；auto 空階梯 ⇒ implicit rung + warning。
- **cost-fuse 永不 `ask`**；預設 warn，block 要自己開。
- **sol delta 的「`set -e` 會終止 auto probe」不成立**——`resolve-review-loop.sh` 是 `set -uo pipefail`；別再重查。
- **本 repo 的 L5 mission rail 綁在 verdict-stability graph**；要派 hetero 又不想寫 rubric／graph／sources，就走「分支 shadow + /l4 sonnet
  工頭 + dispatch-hetero」（先例 `4c842a92`、本次 `5ca93e08`），merge 前還原 enforce。

## 下一步

1. **P5 fleet rollout（cuda 優先）**：每台 `scripts/dev-update.sh` → `node scripts/resolve-dispatch-topology.js --json` → 有合格 hetero 席的主機
   在 `.claude/review-loop-config.md` 設 `implementer_ladder: auto`；cuda 先跑 `node scripts/cost-digest.js --since 14` 重現 $1,180 形狀，
   用 p75 決定是否調 `cost_fuse.daily_usd_brain`。一週後 KR5：各主機 digest 的 brain_share。
2. **這台 dogfood 是否切 `implementer_ladder: auto`**：切了會讓 `resolve-review-loop.test.sh` 九條 roster 釘值（grok-4.5/xai → review_risk
   high、required_review_families 2、l1_required）失效，且 google 家族 implementer 會把 review 姿態降成 low——owner 決定，不要靜默切。
3. **BACKLOG 候選（未寫）**：guard header 比對是嚴格前綴、`guarded_models` 是子字串（長 model id 如 `claude-opus-4-5@agy` 會誤拒）；
   legacy 無 effort 的 scorecard 列在 ladder 排尾端、`effort:""` 是否能過 `implementer-ladder.js isTuple`；`opencode-v2-plugin` 既有紅；
   cost-fuse 一週 warn 後改 block 的日期（P3 acceptance 寫的 calibration week）。
4. 舊 handoff 其餘未動項目仍在：BACKLOG 八筆、suite oracle lock 殘留處置、flash-next 正式切 implementer。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain              # 空
git log --oneline -2                # handoff commit → 8e188403
node -p "require('./.claude-plugin/plugin.json').version"   # 2.35.16
node scripts/check-hook-inventory.js --check   # 28 hooks (15 default-on, 13 opt-in)
node scripts/resolve-dispatch-topology.js --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).implementer_ladder[0].rung))'   # gemini-3.8-flash-low/low@agy
bash hooks/tests/cost-fuse.test.sh; bash hooks/tests/dispatch-model-guard.test.sh   # 63 / 65
```

## Read-order

1. `CHANGELOG.md` v2.35.16 節——三個新件、qc 六修、refuted 一項、測試現況。
2. `docs/plans/2026-09-04-default-dispatch-topology.md`——三層拓樸、KR、§8。
3. `docs/projects/_archive/2026-09-04-default-dispatch-topology/README.md` 與 `ledger/P1.md`——實際派工帳（含被退的 cut A 與工頭到上限後 depth-0 接手）。
4. `skills/ceo-agent/references/level-front-door.md` § Default dispatch topology——canonical 段落。

## 陷阱

- **停車的工頭／hands 不會被自己的背景子任務喚醒**：depth-0 要用等待迴圈盯 leaf 的 JSON 落地再 SendMessage；等 `test` 這種它自己開的
  背景工作也一樣，要定時叫醒。
- **等待迴圈別用 `ls … | xargs -r test -s`**：沒有檔案時 xargs 空輸入回 0，`until` 立刻結束；zsh 下 glob 無匹配還會直接 error——寫成
  `bash -c 'for f in glob; do [ -s "$f" ] && exit 0; done'`。
- **`check-redispatch-prompt.sh` 會擋 implementer prompt 裡的 fenced code 與「around line N」**：修復 brief 用文字描述位置與程式碼。
- **governance enforce 下 raw `dispatch-hetero` 必拒**（`check_mission_enforcement_gate`）：還原 enforce 之後的小修改走 sonnet 原生 hands。
- **在 worktree 目錄裡 `git merge` 會 merge 到自己**：整合一律 `cd` 回主 checkout；Bash 工具的 cwd 會殘留。
- **`worktree.baseRef`**：沒設 `head` 時 Agent worktree 從 `origin/develop` 開，hands 要先 ff 到 feature；設了記得在 release commit 前
  `git checkout -- .claude/settings.local.json`。
- **全套 suite 的平行段「ALL TESTS PASSED」不代表 serial 尾段綠**——要看整份 log 的每個 `FAIL [` 摘要行。

## 已路由出去的耐久內容

- **memory**：`dispatch-topology-dogfood-lessons.md`（新：本節陷阱的機制版）、`cc-headless-hook-ask-auto-denies.md`、
  `engine-qualify-administration-gotchas.md`（ladder 裁定）。
- **repo**：CHANGELOG v2.35.16、INDEX Completed 列、archive README＋ledger、front-door canonical 段、BACKLOG 一筆已刪。
