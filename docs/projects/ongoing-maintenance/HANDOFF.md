## 目標
接續 autopilot 維護。2026-09-16 出貨到 **v2.36.56**（merge `5117590c`，release `e4039fe8`，已推 `origin/develop`）。operator 指令（2026-09-16）：「CEO 模式把全部該做的依序處理完，/l5，需要討論的找 hetero engine 討論」。本輪做完 D（v2.36.54）、B（v2.36.55）、C（v2.36.56，verification 紅走 repair 路徑）；下一刀：**cuda P1（fired；final panel codex 席 transport_failed 本機今天第三次量到、GLM tautological proof 假陽性、no_verdict 沒 raw_log）**，再來 suite/config 耦合（fired）。

## 現況
- `develop` = `origin/develop` @ `e4039fe8`（HANDOFF 這次 commit 之後再前進一個）。工作樹乾淨；沒有 mission worktree／branch（三個 campaign 都 `zero_residue: true`）；別的 session 的 `…/7ef6560a…/scratchpad/baseline` detached worktree 不是我們的、別動。
- session marker 已 `retire` → `active: false`。routing 指 `red-verification-repair-2026-09-16`（已完成）→ admission READY。開下一個之前照 recipe：新 graph → routing 換 → `mission-terminal-reconcile.js legacy --graph-digest <new>`。
- pin store 不變（implementer cursor-grok-4.6-low；qc_panel gpt-5.6-sol、GLM-5.2；MiniMax incumbent）。**grok 仍 402**：consult 走 `dispatch-author.sh --runner codex --model gpt-5.6-sol --prompt-file … --timeout 20m`。
- 本 repo canonical ledger 仍 carry-only 亂序（v2.36.54 writer-only 不自癒）；D／B／C 三個 campaign 的 lease 都在 stale 堆（B 沒 terminal：acceptance_failed 記不下來；C 停在 final_panel，row open）。**v2.36.54 起新 campaign 的 carry 保序**，B／C 沒被序問題咬到。
- **兩個 suite 從 `acf3b06c`（09-12）起 base 紅**：`provider-readiness-consumer`（5）與 `autopilot-cli`（33）——suite 內跑 `--check-scorecard`，sandbox 看不到 host 的 cursor pin。CI 上同樣會紅（但 CI 是 release-gated，見下）。fired row；任何 campaign 的 `verification_commands` 在修好前**不要放這兩個**。
- CI 是 release-gated（只在 `.claude-plugin/plugin.json` 變動時跑）：v2.36.55 那 run 紅在 executable gate（100644 test 檔；`c8d2f97e` 只改 index 被 `git add -A` 讀回，`c5df6df7` 才真 chmod）；下次 release 的 run 應只剩 `dispatch-detached-campaign-authority.test.sh`（09-14 起 runner 上紅，open row）。
- Peer：cuda 已知 v2.36.54 對已亂 segment 無用（`msg_01M2KQA9GPTEW4P29AWT913NX0`），他們 P0 的 resume 量到 preflight 正確擋 drift（claim 沒燒）。openclaw 三則（agy no-go、report #2、hook 提案）都登 row、已回覆 hook 提案（`msg_01M2KS6RBYNB9X43MT9PMTKGVG`）。gentoo 的 context-budget 問題已回覆＋登 row。

## 已決事項(不重議)
- 承接上版全部（backlog row=index、rail 停了照文件降級、review 三輪停、config 席位≠合格、marker retire 不手刪、pre-spend 拒絕走 pre-claim、換 graph 開新 lineage）。
- D：writer-only (a)，reader recovery／migration 與 stale lease GC 各一條 open row。
- B：兩個 base 紅 suite **不 reseal rubric、不靜默 merge**——證據目錄與 CHANGELOG 明說 no-regression 對它們沒達到；耦合修法是自己的 row（fired）。
- Oracle 不得自我推導：codex r1 抓到的兩個（拿抓到的 argv 比自己、用受測實作算 expected receipt）一律改凍結字面。
- MiniMax REVOKED 撞 id → normalizer no_verdict 是 rail wart（row open），照規則第二家族 codex review，不重跑 MiniMax。

## 下一步
1. **cuda P1（fired）**，三個缺陷可能拆兩刀：(i) final panel 拒 codex「blind review requires an enforceable no-tools runner profile (got: codex)」——`dispatch-review.sh` 明明跑得動 codex，本機 C 的 final panel 也是這樣 2/3；(ii) GLM tautological no_finding_proof 假陽性（cuda 量到 r2/r5/r7 三次，proof 三 label 齊全）；(iii) no_verdict 結果不帶 raw_log。raw log 已向 cuda 要（`msg_01M2KKKM50WEXHZFA5NXQ61SYG`）。先 consult（codex）分刀，plan＋rubric → hetero loop → freeze（`freeze-c.js` 在本 session scratchpad `…/23f2bf74…/scratchpad/c/`，改 slug／paths／acceptance）→ marker → grant → brief → dispatch。**verification_commands 先在 base 跑綠再封**；別放 `provider-readiness-consumer`／`autopilot-cli`。
2. suite/config 耦合（fired）：hermetic `REVIEW_LOOP_CONFIG_OVERRIDE` fixture＋host 無關的期望；修好後 CI 應只剩 dispatch-detached 一條。
3. 之後 open：ADJUDICATING pre-claim、stale lease GC、carry-only recovery、REVOKED 撞 id、acceptance_failed terminal journal、verify_cmd detached worktree＋紅 verification 落 ledger（C §6）、openclaw hook 提案（operator 裁決）、context-budget model-id 視窗、CI dispatch-detached。C 的 plan §5 真 campaign dogfood 延後——下一個自然紅的 campaign 就是量測點。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY；`node scripts/session-mode.js status --repo-root "$PWD"` → `active: false`。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（new 0、allowed 31）。
- `bash scripts/sync-all.sh --check` → ok:true。`AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8。
- C 的證據：`docs/plans/evidence/2026-09-16-red-verification-repair/README.md`；B：`…/2026-09-16-agy-effort-rail-wording/`；D：`…/2026-09-16-ledger-rotation-order/`。

## Read-order
1. `docs/BACKLOG.md` — fired：cuda P1、suite/config 耦合；open：上面第 3 點。
2. `CHANGELOG.md` v2.36.56、v2.36.55、v2.36.54。
3. `skills/l5/references/hetero-impl-loop.md` recipe（本輪加了兩條：base 先跑綠再封；`test -x`＋temp branch）。

## 陷阱
- **campaign 跑的整段時間主 checkout 一個字都不能動**；grant 後 HEAD 也不能前進。平行工作全放 scratchpad。
- **plan 點名的斷言欄位要先確認資料結構真的有**：C 的 T7 寫 `gate.input.vertical_failed === true`，但 gate journal 只存 `input_digest`（`recordGateEntry`），G1/G2 與兩家族 reviewer 全照字面要求；先 `grep` 結構再寫 rubric，不然 MUST-FIX 只能駁回。
- 已決：C 的 MUST-FIX 駁回不改 plan（plan 改了 source sha 漂、admission 拒）；證據 README＋CHANGELOG 明說。
- 驗證 worktree 要 `git checkout -b`（`next-touch-validation`、`provider-readiness-consumer` 在 detached HEAD 會死）；hand 建的測試檔是 100644，`bash file` 看不出來，CI executable gate 會紅——`test -x`。
- `reap-dispatch-branches.sh reap` 沒 `--yes` 是 dry-run；merged 分支要 `--ack-preserved <branch>@<tip>`。worktree reaper 也要 `--yes`；root id 用 campaign 自己的 `campaign-v1-…`（`impl-run1.json .campaign_control.campaign_id`）。`record-integration.js` 的 accepted sha 必須＝當下 HEAD（merge 後再 commit 就用新 HEAD）。
- `check-backlog-entries.js`：Pointer 必須裸路徑且存在（evidence README 要先建）；entry >600 B 強制 Pointer；Title ≤120、Context ≤240、Source ≤160。
- run-ledger 測試釘 `ts`：PATH 前置 `date` shim 只攔 `-u +%Y-%m-%dT%H:%M:%SZ`。
- `verify-preexisting.sh` 不吃 `--help`（會把它當測試指令跑）。
- `dispatch-plan-review.js` 不帶 `--timeout 20m` 高檔席會死；`check-phase-review-receipt.js` rc 0 時不印任何東西。
