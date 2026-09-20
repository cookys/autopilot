## 目標
接續 autopilot 維護。2026-09-20～21 本 session（opus，ctx 610k、437 turns——它本身就是 token 檢討的樣本）出貨 v2.36.76–80；**wave-1 落地（v2.36.81）與 depth-0 強制委派閘門（v2.36.82）兩件在收尾，交給 autopilot--codex 接手。**

## 鐵律（owner 今天定的，接手者照做）
- depth-0 只做三件事：讀報告、下裁決、派工。**不自己跑 shell 修東西**；release 落地（cherry-pick、docs、版本、commit、push）也交工頭（sonnet 在 clone）。
- BACKLOG 是佇列（有 plan／shipped 就刪列）；plan 要登記 INDEX `active`（v2.36.80 閘門會擋）；🔵 不進 BACKLOG。
- rail 缺陷一律 Fix 版再重派或依文件降級。

## 現況（HEAD `a95217a0` = v2.36.80 已 push；樹乾淨；只剩 develop；marker 無）
1. **wave-1 落地工頭在跑**（sonnet Agent，depth-0 的子代理；它停車等自己的背景套件——若沒回來，看 clone）：clone `SCRATCH/land-w1`，branch `release/wave1`。任務：cherry-pick 28 個 LAND 列（跳過每個 clone 的 `PARALLEL-RUN LOCAL ONLY` shadow commit）、補審 3 列（rlr/47、mrce/125、hlsm/r133，fable SHIP-AS-IS 才收）、`chmod +x` 兩個新套件、刪已落地的 BACKLOG 列（含 row 121、64）、整合驗證（紅要跟 develop 基準逐行同）、寫 **v2.36.81** release、preflight 9/9、**不 push**。裁決依據：`SCRATCH/wave1-harvest.md`。接手者要做的：讀它的 REPORT／`git -C SCRATCH/land-w1 log --oneline develop..release/wave1`、`diff --stat`、套件表 → go 就 `git fetch` 進主 checkout ff、push。
2. **depth-0 委派閘門**：clone `SCRATCH/depth0-gate`，branch `feat/depth0-delegation-gate` @ `2ec4f767`（套件綠），fable 二家審跑中（工頭會回 verdict）。plan `docs/plans/2026-09-21-depth0-delegation-gate.md`（已登記 INDEX）。設計要點：`hooks/depth0-delegate-gate.js` 單一 owner；武裝條件 = l4–l6 marker ∥ 派過 agent ∥ host-day brain ≥$150；武裝後拒 Edit/Write 與會改樹的 Bash、唯讀 Bash 終身預算 60、派工 rail 不計、絕對 context T3=200k 強制交接、cost-fuse 武裝後 `block`、`scripts/depth0-gate.js override --reason --minutes ≤30` 記帳逃生口。審回 SHIP-AS-IS → 落地 **v2.36.82**（mechanism，CHANGELOG 要 `prose-justification:` 只註 l4/l5/l6 各一行機制指標）。Commit B（拓樸反轉：便宜 controller、只裁決用貴模型）要 eval，另開 plan。
3. **wave-1b（11 列未開始）**：rlr 131/136/137、hlsm r139/r140、dlrm 93/109/122/123、mrce 15（授權擴 scope 到 `src/engine/campaign-intake.js`＋`scripts/implementation-campaign-check.js`＋鏡像）。kimi **週配額已耗盡（403）**——改用 sonnet 工頭（v2.36.71 配方，`skills/l5/references/hetero-impl-loop.md` "Sonnet foremen as Agent subagents"），clone 與 brief 都還在：`/home/cookys/projects/autopilot-par/<unit>`、`SCRATCH/par/<unit>/{brief.md,plan.md}`；hands 從各 unit LAND tip 續鏈。wave 2 = B1 `review-loop-resolver-a`（單獨跑，會動 `~/.autopilot/topology.json`）。
4. **Token 檢討**：control 表已回 peer（grok@aimax395，msg_01M300WA…）；報告 `SCRATCH/token-postmortem.md`；兩份外審 `SCRATCH/tokreview/consult-{codex,claude-native}.json`（raw_log 是全文）。
5. 停放：openclaw dispatch-watch 三問（thread msg_01M3010Z…，不阻塞）；`origin/main` 落後 1401 commit 等 owner 決定；`stash@{0}` 別動。

## 驗證方式
`git status --short` 空；`git log --oneline -1` = a95217a0 之上只有本 handoff；`node scripts/check-plan-graduation.js --repo-root . --json | jq .exit` = 0；五個 par clone 存在且各有 hands/* 分支。

## 陷阱
- 引用改寫別碰 sha-bound plan（`docs/mission-*-sources.json` 封印）——v2.36.80 已踩過，BACKLOG 有列。
- zsh 的 `set -- $var` 不切詞，要 `bash -c`。
- 落地工頭若停車：`SendMessage` 戳它「check your background suite and continue」。

SCRATCH = /tmp/claude-1000/-home-cookys-projects-autopilot/489c5f8c-612b-4f23-8faa-364d0b5aa78f/scratchpad（session 專屬；codex 接手先 cp 走）。
