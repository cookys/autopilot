## 目標

**進行中**：owner 2026-09-04 裁定（go）：把「plan hetero loop review → 派工 → hetero review loop → qc gate」做成 dev-flow L-size 的**預設**（opt-out，不是 opt-in），並給 owner 口語「hetero review」一個入口。尚未動工：下一步從寫 plan 開始，plan 先過 plan loop review hetero，再照拓樸派工。
上一段（v2.35.16 拓樸出貨）已 merge、push，見本檔末「上一段」。

## 現況

- **branch**: `develop`，`origin/develop` 同步在 `84a7ca56`（handoff commit 之後多一個 docs commit）；working tree 乾淨；session marker 已 clear；governance `enforce`。
- **version**: 2.35.16（28 hooks：15/13）。
- **IN-FLIGHT**: 無派工。fleet 問卷已收 7 支 session 回覆（cuda×3、7840hs×2、gentoo×2、openclaw×3），內容已消化進下方設計；兩支（7840hs/mple2、openclaw/hangar-bridge）以「peer 轉述不算授權、行為側寫敏感」為由只回 memory——**合理，不要再問卷式 fan-out**，要問就 `--instance` 定址或 owner 親自說。

## 已決事項(不重議)

**調查結論（本機 878 session + fleet 7 支，母體各自標明）**
- owner 最常講的是「叫 autopilot plan loop review hetero」「coding 完成後過 hetero loop review」「engage hetero engine review」。**沒有任何 skill description 含這些字**；`dispatch-plan-review.js` 只有 research-to-ship 呼叫；code qc panel 藏在 finish-flow。這才是「hetero 跟 agent-call 混淆」的主因。
- 動詞決定姿態：諮詢／問一下 → 問模型；叫／派／處理／通知／跟 X 說 → X 是引擎名就跑 CLI，X 是主機／專案／pane 就是 session（agent-call）。
- 問模型的實況：全 fleet 都直接叫 CLI（codex exec、claude -p、GLM API key、kimi cli）；`dispatch-consult`／`dispatch-explore`／codex plugin **零使用**。consult 席六個合格（kimi、sol、fable、grok-4.6@xhigh、MiniMax、Qwen）但 `consult_dispatch` 預設 off、dogfood 沒填席、無 skill 呼叫。
- 引擎分工固定：sol 審稿／讀圖、fable/kimi/grok 討論、gemini flash 實作、sonnet 工頭、GLM/MiniMax/Qwen 多為被考對象。
- 兩條紀律要進 evidence-discipline：hetero implementer 的 green 是主張不是閘（openclaw 2026-07-02 /l6：implementer 默默放寬已 commit 的 live-test ACL）；leaf 是 systemd／CLI 程序時 SendMessage 到不了，只能再派一刀。

**設計（owner go）**

```
L-2 plan → L-2.5 plan hetero loop review → L-4 派工（拓樸）→ 每 phase hetero review loop → L-5 qc gate
```
1. **L-2.5**：`dispatch-plan-review.js`；`plan_review: auto`（有合格 plan_reviewer 席就 on，席由 topology 推導）；rubric 從 plan 的 KR／§2.5／§6 自動生骨架；≤2 代；depth-0 逐條裁決後 freeze；沒 freeze 不進 L-3。
2. **L-4 派工**：v2.35.16 拓樸（sonnet 工頭、hands ladder rung-0、brain 不下場）。
3. **每 phase hetero review loop**：`hetero_review: auto|on|off`；工頭整合後跑 reviewer 席（跨家族），FIX-THEN-SHIP → hands 修 → SHIP 才算 phase advance gate 的 code review 項（取代現在那行空泛文字）。
4. **L-5 qc gate**：三席 panel union-on-verified-critical，delta 複核到 SHIP，QC-Verdict trailer（pre-push gate 已在）。
5. **尺寸**：L／H 全走；S 跳過 plan loop、保留一席 hetero review＋qc；Fix 只 qc。
6. **新薄 skill `hetero-review`**：description 用 owner 原話當觸發（「plan loop review hetero」「過 hetero loop review」「hetero review」「engage hetero engine review」）；只分流：plan 檔 → plan loop；branch／diff → code loop（resolve 三席、dispatch-review 三路、union 合成、FIX-THEN-SHIP 派 hands、delta 複核、trailer）。dev-flow 內部重用它。→ MINOR（v2.36.0）。
7. **附帶**：consult 與 codex plugin 脫鉤（`hetero-dispatch.md` 那節改「Codex-plugin consult（optional）」，「peer」只留給 session）；`resolve-dispatch-topology.js` 加 `--role consult|discuss|plan_reviewer|reviewer`，consult ladder 優先「與提問者不同家族」再快又便宜；`consult_dispatch: auto`；consult 接點：debug 卡兩輪、think-tank 3.5、dev-flow L 設計決策前、qc 三席互斥。`agent-call` description 加 owner 動詞與 hangar-bridge 觸發，Not-for 指向 hetero-review／consult／l4–l6，並記「Claude session 用 `fleet peers` instance 定址，`fleet local list` 只有非 Claude pane」。research-to-ship 改成「dev-flow 加先 survey」。
8. **不做**：新頂層 `/ask`、強制裝 codex plugin、claude-native 進 hetero ladder。

## 下一步（下一個 session 從這裡開始）

1. 寫 `docs/plans/2026-09-04-dev-flow-hetero-loops-default.md`＋`.rubric.md`（R1: 格式；rubric ID 後直接冒號）。內容＝上面設計＋KR＋§2.5＋§6＋§8。
2. **先過 plan loop review hetero**：manifest 三席 sol@codex max（chair）、kimi-code/k3@kimi、MiniMax-M3@cc-shim；`--timeout 20m`；≤2 代；depth-0 逐條裁決（accept-and-fold／refute-with-rationale），瘦身不調 growth 閾值；契約陷阱見 memory `dispatch-plan-review-contract`。
3. 派工照拓樸：分支 `feat/dev-flow-hetero-loops`，governance 本分支 shadow（先例 `5ca93e08`）、`worktree.baseRef: head`、session marker l4；sonnet 工頭一刀一命、hands `gemini-3.8-flash-low@agy`（dogfood roster 要暫切 gemini 三欄，收尾還原）；brief 模板在上一 session 的 scratchpad 已失效，照 `docs/projects/_archive/2026-09-04-default-dispatch-topology/ledger/P1.md` 的形狀重寫。
4. dev-flow／ceo-agent SKILL.md 有改動就要重釘 profiles hash 鏈（skill `profiles-hash-repin`）；CHANGELOG 要 `prose-justification:` 行。
5. 收尾：還原 enforce 與 roster、全套 suite、qc 三席、delta 複核、trailer、preflight、archive、push；P5 fleet rollout 仍待 cuda。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain              # 空
git log --oneline -1
node -p "require('./.claude-plugin/plugin.json').version"   # 2.35.16
bash scripts/resolve-review-loop.sh --field plan_review     # off（現況；設計要改成 auto）
grep -rl "hetero review\|loop review" skills/*/SKILL.md     # 空（現況；設計要補）
```

## Read-order

1. `docs/projects/_archive/2026-09-04-default-dispatch-topology/README.md`＋`ledger/P1.md`——上一段的派工形狀與工頭到上限的接手方式。
2. `skills/dev-flow/SKILL.md` L-2～L-5（430–545 行）——要改的段落。
3. `scripts/resolve-review-loop.sh` 的 `plan_review`／`plan_reviewer_*`（383、500 行附近）與 `scripts/dispatch-plan-review.js --help`。
4. `references/hetero-dispatch.md` § consult seat、§ Peer consult——要改名與脫鉤的段落。
5. memory：`dispatch-plan-review-contract`、`dispatch-topology-dogfood-lessons`、`dispatch-review-runner-setup`。

## 陷阱

- 停車的工頭／hands 不會被自己的背景子任務喚醒；等待迴圈用 `bash -c 'for f in glob; do [ -s "$f" ] && exit 0; done'`，別用 `xargs -r`。
- `check-redispatch-prompt.sh` 擋 implementer prompt 裡的 fenced code 與「around line N」。
- enforce 下 raw `dispatch-hetero` 必拒；還原後的小修改走 sonnet 原生 hands。
- 在 worktree 目錄裡 `git merge` 只會 merge 到自己；整合回主 checkout。
- `git diff 68e142c0..HEAD` 這種 range 在 handoff 後 sha 都變了；重新 `git log` 取。
- 全套 suite 平行段 ALL TESTS PASSED 不含 serial 尾段；`opencode-v2-plugin` 3 紅是既有；`slash-entry-probe` 負載下假紅。

## 上一段（2026-09-04 前半，已出貨）

v2.35.16 拓樸：`resolve-dispatch-topology.js`、`implementer_ladder: auto`、implementer→sonnet／hands→haiku、`dispatch-model-guard` header 規則、`cost-fuse`＋`cost-digest`、front-door canonical 段；本身照拓樸做（5 sonnet 工頭、10 把 gemini-low 刀）；qc 三席 FIX-THEN-SHIP → 六修 → sol delta 一項 refuted。舊帳收掉：ladder `[]` 是設計、fixture 271/272 已隔離、guard headless BACKLOG 刪（CC 2.1.259 `-p` 下 ask 自動拒）。cuda 已收 P5 配方，等 owner 授權跑。
