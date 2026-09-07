## 目標

2026-09-07 出貨 **v2.36.16**（Fix 級）：把 handoff 前版列的「develop 既有三個紅」歸零。**已 push**（2026-09-08，owner 指示；`origin/develop` = `2e4c61e3`，v2.36.15 ladder 的 19 個 commit 與本版一起上去，推前 origin 仍是 2.36.14，無讓號情形）。前一版 handoff 的「等回報／等 owner 決定」項目未變，照抄在下方。
（取代前一版 handoff。）

## 現況

- **repo**：`develop` 與 `origin/develop` 同步（`2e4c61e3`），working tree 乾淨，version 2.36.16。
- **本日出貨（v2.36.16）**：三個紅的真因**都不是** handoff 前版寫的「cache 過期」：
  1. `resolve-dispatch-topology.js` implementer 路徑對 legacy（無 effort 分區）席位 emit `effort: ""`（重算仍吐，`--check` rc=0 只證 cache 與 script 一致）→ 改 emit `high`（同 reviewer 路徑 Case 12）＋排序後去重、exact-tuple 席位勝出；本機 ladder 19→17。`resolve-review-loop.sh` auto 讀取端 effort 過 enum、exit 3 指名 rung 與「重跑 topology」。
  2. `probe-engine-capability.sh` 少 opencode binary／live 分支（v2.36.13 加 rail 時沒跟），並列入 effort consumer（dispatcher 餵 `--variant`）；live 驗 `opencode-go/muse-spark-1.3-contributor` effort low → available。
  3. switch test 的 pinned pre-D6 resolver 解析不了 `plan_review: auto`／`implementer_ladder: auto`（2026-09-04 起的值）⇒ OLD 輸出空、parity 比空集合；改共用一份兩行重寫的 parity template，consult_* 四欄允許 D6 自身的 topology 填值漂移，added-keys 補 `ladder_start_rung_judgment`，migration negative 放寬為「指名任一缺欄」。
- **本機 host 狀態**：`~/.autopilot/topology.json` 已用修後 script 重建（備份 `topology.json.bak-legacy-effort-20260907`）。`contract-parity`／switch 兩支測試仍讀真主機 cache——BACKLOG 新條目（hermetic fixture 化）。
- **doc-sync 已做（2026-09-08，scoped，兩版 diff）**：十個確定性 gate 全綠；四個 finder 的 confirmed 修正全部落地（U3 依 `unknown_type` 分流、dev-flow receipt 回填 unknown_type、README「25 hooks」等）；「正文數字 vs badge」這一類已降進 Layer 1（`check-readme-parity.js` prose-count 檢查）。細節見 CHANGELOG v2.36.16 doc-sync 段。
- **證據**：`resolve-dispatch-topology` 46、`resolve-review-loop` 417、switch 58、`contract-parity` 42、`probe-runner-coverage` 23、`probe-engine-capability` 8；全套見下方驗證方式。`references/evidence-discipline.md` §29 新增。

## 已決事項(不重議)

- legacy 席位 emit `high` 不 emit 空字串（兩個角色路徑同規則）；同 dispatch identity 只留一階、exact-tuple 勝出。
- opencode 是 effort consumer（依 dispatcher 實際 argv 判定，不是依 CLI help）。
- ladder（v2.36.15）全部：knob 預設開；預算 2/1/1；classify 永不推 U4；rail-failed 吃預算不算 climb；S6 單獨最多 U1。
- 前版全部：l4 route supported、VA/QC 選配、coverage advisory、ADR-0001 不加 trust 機制；dispatch-model-guard 不彈窗；dirty-tree 只提醒；kimi／opencode 兩個 308 需求都做；peer 訊息是 peer input。

## 下一步（等 owner 決定或外部回報）

1. ~~push~~ **已完成**（2026-09-08）。下次出貨前照舊先 `git show origin/develop:.claude-plugin/plugin.json` 對版號，避免與並行 session 撞號。
2. **前版待辦不變**：cuda WIZHALL P5 dogfood、308 用 v2.36.12+ 跑 resolver／kimi／opencode 的結果、cuda QUIET-a claim、7840hs receipt 重跑；BACKLOG 的 per-hook × per-harness matrix、kimi file-indirection spike、Codex dev-mode hook 入口 spike；Codex Stop live-fire 觀察。
3. **ladder 後續觀察**：第一個真實（非 dogfood）climb 出現時，看 `probe-unknown.js report` 的 `judgment_only`／`s6_only`／`repeat_terms`（KR1／KR4）；finish-flow L-5.6 是否真的把 learn 變 MANDATORY。
4. **其他主機**：任何有 legacy 席位的主機在拿到 v2.36.16 後要重跑 `scripts/resolve-dispatch-topology.js`，否則 `implementer_ladder: auto` 會 exit 3（訊息會指名）。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain | wc -l; git log --oneline -1                 # 0
node -p "require('./.claude-plugin/plugin.json').version"            # 2.36.16
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh | tail -1   # 8/8（commit 後）
bash hooks/tests/resolve-dispatch-topology.test.sh | tail -1        # PASS 46
bash hooks/tests/probe-runner-coverage.test.sh | tail -1            # 23 passed, 0 failed
bash hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh | tail -1   # PASS 58
node scripts/resolve-dispatch-topology.js --check; echo $?          # 0
```

## Read-order

1. CHANGELOG.md v2.36.16 節（含「未做」）。
2. `references/evidence-discipline.md` §29。
3. v2.36.15 的：CHANGELOG 節、`docs/plans/2026-09-07-unknown-escalation-ladder.md` §3、`references/hetero-dispatch.md` Hook points 表。

## 陷阱

- **`--check` rc=0 不等於 script 對**：derived cache 與 generator 一致只證 generator 跑過。紅測試歸因「host 狀態」前先重算 diff。
- **switch test 的 frozen baseline**：pinned pre-D6 resolver 對任何它不認識的**值**（不只是欄位）直接 exit 3；shipped template 新增 `auto` 值時 parity template 的 sed 要跟著加一行。
- **plan review 的 checker 要餵 G2 審過的 bytes**（`git show <G1-fold commit>:docs/plans/…md`）；codex 配額見底時 sol@codex 席 rc=3 全空，manifest 放 `required:false`。
- **改 ceo-agent／dev-flow 既有行**要在 `profiles/guided-baseline-dispositions.json` 加 `rewritten` 條目；`catalog --check` 一次只報一條。
- **schema 加欄位的連鎖**：`x-field-order`／`required`／properties → JS validator → validPayload／七份 fixture／key-order pin／switch test adjacency literal。validator 報「第一個」缺欄，斷言別釘死欄名。
- **全套測試判紅只看 run.sh 最後的 Summary**；`opencode-v2-plugin` 在 `--parallel 4` 下會 flake。並行跑 suite 時別同時 commit。
- **zsh 下 `--include=*.md` glob 會炸、`$PIN` 不切字詞**：用 `bash -c`。管線裡 `${PIPESTATUS}` 在 zsh 是空的。
- Reviewer（opus）一輪 30–40 分鐘；本機 kimi OAuth 無憑證、codex 配額週剩 1%；任何 live probe 先確認。
