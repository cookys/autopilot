## 目標
接續 autopilot 維護。2026-09-16 出貨到 **v2.36.54**（merge `79528505`，release `f55fbe55`，已推 `origin/develop`）。operator 指令（2026-09-16）：「CEO 模式把全部該做的依序處理完，/l5，需要討論的找 hetero engine 討論」。本輪做完 campaign D（ledger rotation carry 保 append 序，writer-only）；下一刀已定：**B（agy effort + rail wording，plan 已凍、hetero review 兩代完成，要重標 v2.36.55）**，再來 C（cuda 回報 verification 紅照走 review）、cuda P1。

## 現況
- `develop` = `origin/develop` @ `f55fbe55`（HANDOFF 這次 commit 之後再前進一個）。工作樹乾淨；沒有 mission worktree／branch（`zero_residue: true`）；別的 session 的 `…/7ef6560a…/scratchpad/baseline` detached worktree 不是我們的、別動。
- session marker：本 session marker 已 `retire`（integration receipt）→ `active: false`。`.claude/mission-routing-config.json` 指 `ledger-rotation-order-2026-09-16`（已完成、sources 相符）→ admission READY。開 B 之前照 recipe：新 graph → routing 換 → `mission-terminal-reconcile.js legacy --graph-digest <new>`。
- pin store 不變（implementer cursor-grok-4.6-low；qc_panel gpt-5.6-sol、GLM-5.2；MiniMax incumbent 無 pin，intake 沒擋）。**grok CLI 仍 402**：consult 走 `dispatch-author.sh --runner codex --model gpt-5.6-sol --prompt-file … --timeout 20m`（本輪 8 分鐘回）。
- 本 repo 的 canonical ledger（`.git/autopilot/implementation-campaign.jsonl`）**仍是 carry-only 亂序**（v2.36.54 是 writer-only，不自癒）：任何舊 campaign 都不能 `--resume`／inspect；新 campaign 從 v2.36.54 起 carry 保序。D 自己的 campaign（`campaign-v1-409e89d2…`）也在亂序堆裡（open row）。
- Peer：cuda 收過 v2.36.53 的「ledger >256 KiB 先別 resume」警告；**v2.36.54 對他們已亂的 fleet-comms `a8095f81…` 沒用**（原始 segment 已 GC，投影照樣 ARTIFACT_CHAIN_BROKEN）——本輪已用 send_to_peer 講清楚（見 log）。openclaw 的 agy implementer no-go 回報已登 BACKLOG（他們說不用回）。

## 已決事項(不重議)
- 承接上版全部（backlog row=index、rail 停了照文件降級、review 三輪停、config 席位≠合格、marker retire 不手刪、pre-spend 拒絕走 pre-claim、換 graph 開新 lineage）。
- D 的 design 裁定：codex consult 建議 (c) writer＋provenance-gated reader recovery；depth-0 裁 **(a) writer-only**（owner 已凍 scope；沒有活的 caller 需要舊 bytes 自癒；reader recovery 是投影核心裡的 DFS，要自己的 plan＋hetero loop）。reader recovery／locked migration 與 stale lease GC 各一條 open row。
- B plan 條款已預授權：D 先出貨 → B 重標 **v2.36.55**（plan §2.x 兩處＋rubric 若有）；重標後 **不重取 G2 receipt**（receipt 綁審過的 bytes），Review log 加一行「re-stamped v2.36.54→v2.36.55 under the pre-authorized clause」→ 再跑 freeze chain。
- MiniMax 席 REVOKED 撞 id → normalizer no_verdict：是 rail wart（row open），不是換 reviewer 的理由；照規則第二家族 codex review 不重跑 MiniMax。

## 下一步
1. **B**：重標 v2.36.55（`docs/plans/2026-09-16-agy-effort-and-rail-wording.md` :134-135、:167；rubric 也 grep）→ Review log 一行 → freeze chain（`freeze.js` 在本 session scratchpad `…/23f2bf74…/scratchpad/d/freeze.js`，改 slug／plan／rubric／acceptance_ids／output_paths＋每個 codex mirror／authorized_creates；`docs/mission-agy-effort*` 目前不存在）→ routing → legacy reconcile → commit → 確認 `~/.autopilot/session-mode/` 沒別的 active marker → `session-mode set --level l5` → grant → brief（≤8 KB，列七個測試檔＋鏡像）→ dispatch。agy 1.2.3 的重現指令在 plan §0.1。
2. **C**：機制已讀：composition 在 verification 紅且 retriable 時照契約先跑 full-diff barrier → engine journal `REVIEW_COMPLETED`，但 reducer 只從 REVIEWING 收、VERTICAL_VERIFIED 只收 passed:true → 卡 journal。三個修法選項要 consult（codex）。
3. cuda P1（BACKLOG fired，排 C 後）：GLM no_finding_proof 判 tautological 停 full_diff_review；r3 final_panel_seat_transport_failed——已向 cuda 要 raw log（`msg_01M2KKKM50WEXHZFA5NXQ61SYG`）。
4. 之後：ADJUDICATING pre-claim（open）、stale lease GC（open）、carry-only segment recovery（open）、REVOKED 撞 id（open）、openclaw agy 席（open）。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY；`node scripts/session-mode.js status --repo-root "$PWD"` → `active: false`。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（new 0、allowed 31）。
- `bash scripts/sync-all.sh --check` → ok:true。`AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8。
- D 的證據：`docs/plans/evidence/2026-09-16-ledger-rotation-order/README.md`（red-at-base 兩份、verify summary、codex r1、MiniMax raw、dogfood repro、lifecycle receipt zero_residue:true）。

## Read-order
1. `docs/BACKLOG.md` — fired：agy effort（B）、verification 紅照走 review（C）、cuda P1；open：五條 rail 後續。
2. `docs/plans/2026-09-16-agy-effort-and-rail-wording.md`（B，已凍）；`docs/plans/evidence/2026-09-16-agy-effort-rail-wording/`（G1/G2）。
3. `skills/l5/references/hetero-impl-loop.md` recipe 11 步（本輪照走一遍，全部有效）。
4. `CHANGELOG.md` v2.36.54。

## 陷阱
- **campaign 跑的整段時間主 checkout 一個字都不能動**；grant 後 HEAD 也不能前進。平行工作全放 scratchpad。已進 memory `managed-campaign-depth0-recipe`。
- `reap-dispatch-branches.sh reap` 沒 `--yes` 是 dry-run（回 kept、rc 0）；merged 分支要 `--ack-preserved <branch>@<tip>` 才砍（bundle 留在 `.git/autopilot-reap-bundles/`）。worktree reaper 也要 `--yes`；root id 用 campaign 自己的 `campaign-v1-…`（`impl-run1.json .campaign_control.campaign_id`），mission root 回 owned 0 假乾淨。
- `check-backlog-entries.js`：Pointer 必須是裸的可解析路徑（加 `§6` → `pointer_unresolved`）；entry >600 B 就強制要 Pointer。
- `next-touch-validation.test.sh` 在 detached worktree 會死（`symbolic-ref HEAD`）——驗證 worktree 先 `git checkout -b`。
- run-ledger 測試要釘 `ts`：PATH 前置一個 `date` shim，只攔 `-u +%Y-%m-%dT%H:%M:%SZ` 那組 argv，其他 exec 真 `date`（`now_ts`、liveness `-d` 才不壞）。
- MiniMax 席會在同一 id 下出 🟠＋🔵 且自我 REVOKED → `product_review_normalization` 停在 `duplicate product review finding`，campaign 標 durable wait；raw log 其實可讀。
- `dispatch-plan-review.js` 不帶 `--timeout 20m` 高檔席會死；G2 到 cap 後 depth-0 逐條裁決＋freeze，不開 G3。`check-phase-review-receipt.js` rc 0 時不印任何東西。
