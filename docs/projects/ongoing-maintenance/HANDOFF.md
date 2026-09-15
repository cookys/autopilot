## 目標
接續 autopilot 維護。2026-09-16 出貨到 **v2.36.53**（merge `527d59d2`，release `41193a66`，已推 `origin/develop`）。operator 指令（2026-09-16）：「CEO 模式把全部該做的依序處理完，/l5，需要討論的找 hetero engine 討論」。這一輪做完 campaign A（disposition resume）；下一刀已定：**campaign D（ledger rotation 重排 journal，fired）**，再來 B（plan 已凍、hetero review 兩代完成）、C（cuda 回報 verification 紅照走 review）。

## 現況
- `develop` = `origin/develop` @ `41193a66`。工作樹乾淨；沒有 mission worktree；別的 session 的 `…/7ef6560a…/scratchpad/baseline` detached worktree 不是我們的、別動。
- session marker：本 session 的 marker 已 `retire`（integration receipt）→ `active: false`。`.claude/mission-routing-config.json` 指 `disposition-resume-2026-09-16`（已完成、sources 相符）→ admission READY，`session-mode set` 任何 level 可用。開 D 之前照 recipe：新 graph → routing 換 → `mission-terminal-reconcile.js legacy --graph-digest <new>`。
- pin store 不變（implementer cursor-grok-4.6-low；qc_panel gpt-5.6-sol、GLM-5.2；MiniMax 是 incumbent）。**grok CLI 402（Grok Build 額度見底）**：consult 席（grok-4.6）壞，本輪用 `dispatch-author.sh --runner codex --model gpt-5.6-sol` 直接送 consult prompt 替代（見 evidence dir `consult-*`）。
- Peer：cuda 已收到 v2.36.53 通知（`msg_01M2K795G4JMGRH1NK92S9JNFT`，含「ledger >256 KiB 先別 resume」警告）；等他們對 fleet-comms `campaign-v1-a8095f81…` 重跑 `--resume` 回報。送達≠已讀。

## 已決事項(不重議)
- 承接上版全部（backlog row=index、rail 停了照文件降級、review 三輪停、config 席位≠合格、marker retire 不手刪、pre-spend 拒絕走 pre-claim、換 graph 開新 lineage）。
- A 的 design 裁定（codex consult + plan G1/G2）：durable-wait 的 git_candidate resume 走 `verifyResumeCandidate`；pre-claim preflight **只**涵蓋 durable-wait 相位（rubric R6），ADJUDICATING 的 pre-claim 化另立 BACKLOG row（open）。
- MUST-FIX 處置先例：codex r2「preflight 忽略 `--campaign-ledger`」駁回——v2.36.42 起該旗標只收 canonical 路徑，與 preflight 同一 resolver。
- B plan 已凍（`docs/plans/2026-09-16-agy-effort-and-rail-wording.md`，G2 終局、receipt 通過），釘 **v2.36.54**；若 D 先出貨，B 要重標 v2.36.55（plan 條款已預授權）→ 改完 bytes 再跑 freeze chain。
- D 的 scope：只修 carry 的順序保留＋一個可量測 acceptance；七月 stale lease 永遠被 carry（live segment 縮不回去）是**另一條** row，不併進 D。

## 下一步
1. **D（fired）ledger rotation carry 重排**：`scripts/run-ledger.sh` ~3155-3190 的 carry jq 用 `group_by(._rotation_root)` 排序，journal 時間序丟失；ledger 2.1 MB ≫ 256 KiB 每次 append 都 rotate。先問 consult（codex）design fork：(a) 只修 writer（carry 保 append 序，dedupe 用 reduce+seen set，jq 的 group_by/unique_by 都會排序）；(b) 加 reader 端 `projectCampaign` 依 `input_artifact_digest === 前一 output` 鏈結（ts 只到秒會撞）。(b) 會把 `src/campaign/cli.js` 拉進 output_paths。紅測試放 `hooks/tests/run-ledger-rotation.test.sh` 旁：三條 journal 其 base64 序≠append 序、ledger 先撐過 cap、append 一次 → 斷言 snapshot 序＝append 序 **且** `projectCampaign` 不丟例外（兩者都要，單一斷言會被另一種修法混過）。現有磁碟 segment 已經是壞序，D 的 dogfood 若選 (a) 只能用新 campaign 或 fixture。D 自己的 campaign 若 reviewer no_verdict，別花時間 `--resume`（preflight 會擋、且投影仍壞）：直接走 A 的降級路徑。
2. **B**：freeze chain（`SCRATCH=<dir> node freeze.js`——腳本在舊 session scratchpad，不在 repo；重寫很快，內容見 A 的 mission 檔）→ routing → legacy reconcile → commit → marker → grant → brief（≤8 KB，列七個測試檔＋鏡像）→ dispatch。agy 1.2.3 的重現指令在 plan §0.1。
3. **C**：機制已讀（task #3 描述）：composition 在 verification 紅且 retriable 時照契約先跑 full-diff barrier → engine journal `REVIEW_COMPLETED`，但 reducer 只從 REVIEWING 收、VERTICAL_VERIFIED 只收 passed:true → 卡 journal。三個修法選項要 consult。
4. 之後：ADJUDICATING pre-claim（open row）、stale lease GC（要開 row）、308-8f 的 agy 部分已併進 B。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY；`node scripts/session-mode.js status --repo-root "$PWD"` → `active: false`。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（new 0、allowed 31）。
- `bash scripts/sync-all.sh --check` → ok:true（14 rituals）。`AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8。
- A 的證據：`docs/plans/evidence/2026-09-16-disposition-resume/README.md`（含 red-at-base log、兩份 verify log、codex r1/r2、lifecycle receipt zero_residue:true）。

## Read-order
1. `docs/BACKLOG.md` — fired：ledger rotation（D）、agy effort（B）、verification 紅照走 review（C）；open：ADJUDICATING pre-claim、dirty-tree remedy（併 B）。
2. `docs/plans/2026-09-16-agy-effort-and-rail-wording.md`（B，已凍）；`docs/plans/evidence/2026-09-16-agy-effort-rail-wording/`（G1/G2）。
3. `skills/l5/references/hetero-impl-loop.md` recipe 11 步（本輪照走一遍，全部有效）。
4. `CHANGELOG.md` v2.36.53。

## 陷阱
- **campaign 跑的整段時間主 checkout 一個字都不能動**（本輪 attempt 1 燒在這：readiness 探測時我平行 fold 了 plan B）；grant 後 HEAD 也不能前進（contract 釘 base_sha=HEAD）。平行工作全放 scratchpad。已進 memory `managed-campaign-depth0-recipe`。
- `check-phase-review-receipt.js` 的 disposition 詞彙：blocker 只能 `accepted_blocker|rejected`，非 blocker 用 `accepted_nonblocking`；exit code 要不用管線才看得到。
- `reap-dispatch-branches.sh reap --into develop --inventory-file <worktree JSON>`（子命令是 positional）；`lifecycle-residue-receipt.js issue` 要 `--out`。`record-integration.js` 要 full OID。
- `status task --root-run-id` 仍是 `TASK_STATUS_INPUT_UNAVAILABLE`（沒 writer，已知）；merge 用 git 證據。
- MiniMax 席 NO-FINDING-PROOF 格式病本輪再現（raw log 內容其實是 SHIP-AS-IS）；照規則換第二家族（codex）不重跑。
- `dispatch-plan-review.js` 不帶 `--timeout 20m` 高檔席會死；G2 到 cap 後 depth-0 逐條裁決＋freeze，不開 G3。
