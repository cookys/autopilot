## 目標

2026-09-07 出貨 **v2.36.15 unknown-escalation ladder**（L 級，plan frozen g2，pre-merge review ×3 全折入），已 merge 進本機 `develop`（`6ac62767`），**尚未 push**（owner 沒說要推；origin/develop 仍在 v2.36.14 `b452d5ba`）。前一版 handoff 的「等回報／等 owner 決定」項目未變，照抄在下方。
（取代前一版 handoff。）

## 現況

- **repo**：`develop` 領先 `origin/develop` 18 個 commit（含本 handoff 提交後 19）（含 merge 與 archive），working tree 乾淨，version 2.36.15，feature branch 已刪。`git worktree list` 只剩主目錄與舊 scratch baseline。
- **本日出貨（v2.36.15）**：`scripts/probe-unknown.js`（classify／receipt／report，六訊號 S1–S6、三規則 co-signal／heterogeneity／exhaustion、**永不推 U4**、rail-failed 吃預算不算 climb）；decision-ledger telemetry kinds；knob `unknown_escalation` 預設 auto＝開＋預算 2/1/1；`dispatch-consult.sh` 修「resolved `auto` 被當 off」的 guard（出貨預設從沒派過顧問）、`--ladder-receipt`；四個 canonical call site（`references/hetero-dispatch.md` Hook points 表）；survey `issue-search` 模式＋effort 下限 medium；finish-flow 依 ladder receipt 強制 learn。CHANGELOG v2.36.15 節有完整清單與「未做」段。
- **證據**：plan review ledger `docs/projects/_archive/2026-09-07-unknown-escalation-ladder/ledger/plan-review/`；foreman round-end dogfood ledger `…/ledger/dogfood/decisions.jsonl`（1 U2 climb via survey、4 rail-failed，負對照永不 U2）；真 slash probe l4/l5/l6 PASS。
- **全套測試（tip）**：327 檔，紅的只有 develop 既有三個（下方待決）＋一個並行 flake（`opencode-v2-plugin` 單跑與 develop 都綠）。
- **knowledge 四面**：memory 新增 `unknown-escalation-ladder-shipped`、`dispatch-plan-review-contract` 補 sol 席 rc=3 靜默死與 checker 要餵 G2 審過 bytes；repo skill `.claude/skills/profiles-hash-repin` 補「改寫既有行要加 guided-baseline disposition、checker 一次只報一條」；BACKLOG 新增 probe 的 resolver 七次 spawn memoize（有觀測門檻的 trigger）。

## 已決事項(不重議)

- ladder：knob 預設開（participatory 也自動）；預算每工作單位 U1=2／U2=1／U3=1；classify 永不推 U4（run 自己的 stall fuse／DOA 停止掛 `ladder_receipts:`）；rail-failed 吃預算不算 climb；S6 自報單獨最多 U1（Q3 未裁，照建議走）。改任一條要動 plan §3 與四份文件。
- 前版全部：l4 route supported、VA/QC 選配、coverage advisory、ADR-0001 不加 trust 機制；dispatch-model-guard 不彈窗；dirty-tree 只提醒；kimi／opencode 兩個 308 需求都做；peer 訊息是 peer input。

## 下一步（等 owner 決定或外部回報）

1. **push v2.36.15**：`git push origin develop`（先 `git show origin/develop:.claude-plugin/plugin.json` 確認仍是 2.36.14，避免並行 session 撞號）。pre-push qc-gate 要 merge commit 末段的 `QC-Verdict` trailer，已在。
2. **develop 既有的三個紅（不是本分支引入，stash／worktree 驗過）**：
   - `contract-parity`＋`resolve-review-loop-consult-discuss-switch`：本機 `~/.autopilot/topology.json` `implementer_ladder[17]`（與 [18]）是 `grok-4.5@grok` 且 `effort: ""`，JS validator 拒絕。修法是重跑 `scripts/resolve-dispatch-topology.js` 重建 cache（host 狀態，owner 決定），或讓 resolver 在展開時拒絕空 effort rung。
   - `probe-runner-coverage`：v2.36.13 opencode rail（與 kimi）沒在 `probe-engine-capability.sh` 加 binary-presence／live-spend 分支——develop 上就紅，Fix 級。
3. **前版待辦不變**：cuda WIZHALL P5 dogfood、308 用 v2.36.12+ 跑 resolver／kimi／opencode 的結果、cuda QUIET-a claim、7840hs receipt 重跑；BACKLOG 的 per-hook × per-harness matrix、kimi file-indirection spike、Codex dev-mode hook 入口 spike；Codex Stop live-fire 觀察。
4. **ladder 後續觀察**：第一個真實（非 dogfood）climb 出現時，看 `probe-unknown.js report` 的 `judgment_only`／`s6_only`／`repeat_terms`（KR1／KR4）；finish-flow L-5.6 是否真的把 learn 變 MANDATORY。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain | wc -l; git log --oneline -1                 # 0；bcf6a469 或其後
node -p "require('./.claude-plugin/plugin.json').version"            # 2.36.15
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh | tail -1   # 8/8
bash hooks/tests/probe-unknown.test.sh | tail -1                     # PASS 76
bash hooks/tests/dispatch-consult-ladder.test.sh | tail -1           # PASS 37
node scripts/build-profile-payload.js catalog --check; echo $?       # 0（807 rules）
```

## Read-order

1. CHANGELOG.md v2.36.15 節（含「未做」）。
2. `docs/plans/2026-09-07-unknown-escalation-ladder.md` §3（三規則）與 Review log（G1／G2／pre-merge 三輪的折入紀錄）。
3. `references/hetero-dispatch.md` Hook points 表（四個 call site 的 argv）。

## 陷阱

- **plan review 的 checker 要餵 G2 審過的 bytes**（`git show <G1-fold commit>:docs/plans/…md`），不是折完 G2 的工作檔，否則 sha mismatch。codex 配額見底時 sol@codex 席兩刀 rc=3 全空，manifest 放 `required:false`。
- **改 ceo-agent／dev-flow 既有行**（不是插入）會讓 P0 guided-baseline rule 消失：要在 `profiles/guided-baseline-dispositions.json` 加 `rewritten` 條目（見 `.claude/skills/profiles-hash-repin/SKILL.md`）；`catalog --check` 一次只報一條。
- **schema 加欄位的連鎖**：`x-field-order`／`required`／properties 三向 → `src/engine/resolve-review-loop.js` validator → `autopilot-engine.test.sh` validPayload、`review-loop-runner.test.sh` 七份 fixture、`resolve-review-loop.test.sh:525` key-order pin、以及 **switch test :221 的 adjacency meta-literal**（這條我漏了一輪，reviewer 抓到）。
- **全套測試判紅只看 run.sh 最後的 Summary**：中間會出現巢狀 harness 的「ALL PASS」與 `preflight-release-routing` fixture 的假 `FAIL [slash-entry-probe]`；`opencode-v2-plugin` 在 `--parallel 4` 下會 flake。並行跑 suite 時別同時 commit（`sync-all` 會因 dirty tree 假紅）。
- **zsh 下 `$PIN` 不切字詞**：測試指令用 `bash -c` 或陣列。`git merge -F -` 讀不到 stdin，訊息先寫檔。
- Reviewer（opus）一輪 30–40 分鐘、常在 dead-man 後才回；催一次用 SendMessage 有效。
- 本機 kimi OAuth 無憑證、codex 配額週剩 1%；任何 live probe 先確認。
