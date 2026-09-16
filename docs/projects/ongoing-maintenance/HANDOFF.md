## 目標
接續 autopilot 維護。2026-09-16 出貨到 **v2.36.55**（merge `6d83e121`，release `661e6209`，已推 `origin/develop`）。operator 指令（2026-09-16）：「CEO 模式把全部該做的依序處理完，/l5，需要討論的找 hetero engine 討論」。本輪做完 D（v2.36.54，ledger rotation carry 保序）與 B（v2.36.55，agy effort＋三個拒絕訊息）；下一刀：**C（verification 紅照走 review → journal 撞 VERTICAL_VERIFICATION，fired，兩台 peer 各量到一次）**，再來 cuda P1（fired）、suite/config 耦合（fired）。

## 現況
- `develop` = `origin/develop` @ `661e6209`（HANDOFF 這次 commit 之後再前進一個）。工作樹乾淨；沒有 mission worktree／branch（兩個 campaign 都 `zero_residue: true`）；別的 session 的 `…/7ef6560a…/scratchpad/baseline` detached worktree 不是我們的、別動。
- session marker 已 `retire` → `active: false`。routing 指 `agy-effort-rail-wording-2026-09-16`（已完成）→ admission READY。開 C 之前照 recipe：新 graph → routing 換 → `mission-terminal-reconcile.js legacy --graph-digest <new>`。
- pin store 不變（implementer cursor-grok-4.6-low；qc_panel gpt-5.6-sol、GLM-5.2；MiniMax incumbent）。**grok 仍 402**：consult 走 `dispatch-author.sh --runner codex --model gpt-5.6-sol --prompt-file … --timeout 20m`。
- 本 repo canonical ledger 仍 carry-only 亂序（v2.36.54 writer-only 不自癒）；D／B 兩個 campaign 的 lease 都在 stale 堆（B 的還沒 terminal：rail 連 acceptance_failed 都記不下來，row open）。**v2.36.54 起新 campaign 的 carry 保序**，B 的 campaign 沒被序問題咬到。
- **兩個 suite 從 `acf3b06c`（09-12）起 base 紅**：`provider-readiness-consumer`（5）與 `autopilot-cli`（33）——suite 內跑 `--check-scorecard`，sandbox 看不到 host 的 cursor pin。CI 也紅（且 CI 只跑改到的檔，所以本機才看得到）。fired row；任何 campaign 的 `verification_commands` 在修好前**不要放這兩個**。
- CI：`dispatch-detached-campaign-authority.test.sh` 在 runner 上紅（09-14 起，open row）；v2.36.54 的 100644 test 檔已 `c8d2f97e` 補 +x。看最新 run 是否只剩那一條。
- Peer：cuda 已知 v2.36.54 對已亂 segment 無用（`msg_01M2KQA9GPTEW4P29AWT913NX0`），他們 P0 的 resume 量到 preflight 正確擋 drift（claim 沒燒）。openclaw 三則（agy no-go、report #2、hook 提案）都登 row、已回覆 hook 提案（`msg_01M2KS6RBYNB9X43MT9PMTKGVG`）。gentoo 的 context-budget 問題已回覆＋登 row。

## 已決事項(不重議)
- 承接上版全部（backlog row=index、rail 停了照文件降級、review 三輪停、config 席位≠合格、marker retire 不手刪、pre-spend 拒絕走 pre-claim、換 graph 開新 lineage）。
- D：writer-only (a)，reader recovery／migration 與 stale lease GC 各一條 open row。
- B：兩個 base 紅 suite **不 reseal rubric、不靜默 merge**——證據目錄與 CHANGELOG 明說 no-regression 對它們沒達到；耦合修法是自己的 row（fired）。
- Oracle 不得自我推導：codex r1 抓到的兩個（拿抓到的 argv 比自己、用受測實作算 expected receipt）一律改凍結字面。
- MiniMax REVOKED 撞 id → normalizer no_verdict 是 rail wart（row open），照規則第二家族 codex review，不重跑 MiniMax。

## 下一步
1. **C**：先 consult（codex）三個修法：(a) verification 紅→直接 repair generation（reducer 收 passed:false 進 VERTICAL_VERIFICATION→REPAIR）；(b) 紅→terminal stop 帶 verify stdout/stderr；(c) composition 不跑 review barrier。兩台量測：cuda `campaign-v1-48ffc2fd…`、openclaw `campaign-v1-cfadd975…`（後者根因是 verify 跑在無 node_modules 的 detached worktree——另一條 row，別併）。plan＋rubric → hetero plan loop（GLM＋codex，`--timeout 20m`）→ freeze chain（`freeze-b.js` 在本 session scratchpad `…/23f2bf74…/scratchpad/d/`，改 slug／paths／acceptance）→ marker → grant → brief ≤8 KB → dispatch。**verification_commands 全部先在 base 跑綠再封**。
2. cuda P1（fired）：GLM tautological no_finding_proof 假陽性（cuda 又量到三次「non-tautological」parser 誤判）；no_verdict 不帶 raw_log；final panel 拒 codex（blind-review no-tools profile）。raw log 已向 cuda 要（`msg_01M2KKKM50WEXHZFA5NXQ61SYG`）。
3. suite/config 耦合（fired）：hermetic `REVIEW_LOOP_CONFIG_OVERRIDE` fixture＋host 無關的期望；修好後 CI 應只剩 dispatch-detached 一條。
4. 之後 open：ADJUDICATING pre-claim、stale lease GC、carry-only recovery、REVOKED 撞 id、acceptance_failed terminal journal、verify_cmd detached worktree、openclaw hook 提案（operator 裁決）、context-budget model-id 視窗、CI dispatch-detached。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY；`node scripts/session-mode.js status --repo-root "$PWD"` → `active: false`。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（new 0、allowed 31）。
- `bash scripts/sync-all.sh --check` → ok:true。`AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8。
- B 的證據：`docs/plans/evidence/2026-09-16-agy-effort-rail-wording/README.md`；D 的：`…/2026-09-16-ledger-rotation-order/README.md`。

## Read-order
1. `docs/BACKLOG.md` — fired：C、cuda P1、suite/config 耦合；open：上面第 4 點。
2. `CHANGELOG.md` v2.36.55、v2.36.54。
3. `skills/l5/references/hetero-impl-loop.md` recipe（本輪加了兩條：base 先跑綠再封；`test -x`＋temp branch）。

## 陷阱
- **campaign 跑的整段時間主 checkout 一個字都不能動**；grant 後 HEAD 也不能前進。平行工作全放 scratchpad。
- 驗證 worktree 要 `git checkout -b`（`next-touch-validation`、`provider-readiness-consumer` 在 detached HEAD 會死）；hand 建的測試檔是 100644，`bash file` 看不出來，CI executable gate 會紅——`test -x`。
- `reap-dispatch-branches.sh reap` 沒 `--yes` 是 dry-run；merged 分支要 `--ack-preserved <branch>@<tip>`。worktree reaper 也要 `--yes`；root id 用 campaign 自己的 `campaign-v1-…`（`impl-run1.json .campaign_control.campaign_id`）。`record-integration.js` 的 accepted sha 必須＝當下 HEAD（merge 後再 commit 就用新 HEAD）。
- `check-backlog-entries.js`：Pointer 必須裸路徑且存在（evidence README 要先建）；entry >600 B 強制 Pointer；Title ≤120、Context ≤240、Source ≤160。
- run-ledger 測試釘 `ts`：PATH 前置 `date` shim 只攔 `-u +%Y-%m-%dT%H:%M:%SZ`。
- `verify-preexisting.sh` 不吃 `--help`（會把它當測試指令跑）。
- `dispatch-plan-review.js` 不帶 `--timeout 20m` 高檔席會死；`check-phase-review-receipt.js` rc 0 時不印任何東西。
