## 目標
接續 autopilot 維護。2026-09-16 出貨到 **v2.36.58**（merge `931b31b2`，release `9df3bef9`，已推 `origin/develop`）。operator 指令（2026-09-16 收尾時）：**下一個 session 做「blind review redesign」**（L，BACKLOG open row "Blind review redesign: blind the packet and the process boundary, not the runner"），用 /l5 走完整 plan → hetero review → campaign。codex 席的 pin **不用換**——redesign 上線後 cleanroom 席合法；在那之前這台跑不了 managed campaign（intake 會 `final_panel_seat_blind_incompatible`），所以 redesign 本身的 campaign 要先處理這個雞生蛋（見下一步 0）。

## 現況
- `develop` = `origin/develop` @ `9df3bef9`（HANDOFF 這次 commit 之後再前進一個）。工作樹乾淨；沒有 mission worktree／branch（五個 campaign 都 `zero_residue: true`）；別的 session 的 `…/7ef6560a…/scratchpad/baseline` detached worktree 不是我們的、別動。
- session marker 已 `retire` → `active: false`。routing 指 `final-panel-blind-admission-2026-09-16`（已完成）→ admission READY。開下一個之前照 recipe：新 graph → routing 換 → `mission-terminal-reconcile.js legacy --graph-digest <new>`。
- pin store 不變（implementer cursor-grok-4.6-low；qc_panel gpt-5.6-sol/codex、GLM-5.2/cc-shim；MiniMax-M3/cc-shim incumbent）。**codex 席現在會被 intake 拒**（v2.36.58）：blind allowlist 是 `anthropic-compatible|cc-shim|claude-native|qoderclicn`，`min_panel_size: 3`，required families 2。換席選項：(a) claude-native/claude-fable-5（anthropic 家族、blind-capable）；(b) qoderclicn/Qwen3.8-Max-Preview（alibaba）；(c) anthropic-compatible 端點的模型。pin 指令：`node scripts/engine-capability-state.js pin-seat --role qc_panel --engine <model> --runner <runner> --effort <effort> --endpoint <endpoint|@none> --reason <text> --operator cookys`；先 `resolve-review-loop.sh --check-scorecard` 看 ⚠ 消失。**grok 仍 402**：consult 走 `dispatch-author.sh --runner codex --model gpt-5.6-sol --prompt-file … --timeout 20m`。
- 本 repo canonical ledger 仍 carry-only 亂序（v2.36.54 writer-only 不自癒）；D／B／C／P1-1 四個 campaign 的 lease 都在 stale 堆。**v2.36.54 起新 campaign 的 carry 保序**；P1-1 是第一次 `--resume --campaign-disposition-authority` 在活 ledger 走通到 REPAIR_AUTHORIZED（v2.36.53 preflight＋v2.36.54 保序都生效），停在 rail 要求 `--branch` 等於 derived repair 分支名（fired row）。
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
0. **雞生蛋**：redesign 的 campaign 自己會被 .58 的 intake 擋（pin 有 codex 席）。兩條路：(a) 這一刀暫時 pin 一席 blind-capable 的頂替（`claude-native`/claude-fable-5-1 或 `qoderclicn`/Qwen3.8-Max-Preview），做完 redesign 再把 codex 換回來；(b) 用 `--solo`/l3 inline 做這一刀。建議 (a)——redesign 需要 panel 走真流程當 dogfood。pin 指令：`node scripts/engine-capability-state.js pin-seat --role qc_panel --engine <model> --runner <runner> --effort high --endpoint @none --reason "temporary blind-capable seat during redesign" --operator cookys`；驗證 `bash scripts/resolve-review-loop.sh --check-scorecard` 無 blind ⚠、`node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` READY。
1. **Redesign plan**：底稿＝`docs/plans/evidence/2026-09-16-blind-review-redesign/consult-claude-fable-5-1.md`（Fable 5.1）＋ `consult-gpt-6-astra.md`；兩者一致的骨架：
   - **審查包**（`src/runners/review.js` 的 scratch-cwd 換成 `buildPacket`）：`git archive` 的候選樹（無 .git）＋`git diff base..candidate`＋只有 spec；deny-list（`.autopilot/**`、evidence dir、`*.receipt.json`、review decision records）；`MANIFEST.json` 帶 packet hash，每席 receipt 記 hash。
   - **兩種席位都算數**：`packet`（prompt-only：cc-shim、claude-native、qoderclicn、anthropic-compatible）與 `cleanroom`（有工具：codex、grok、cursor、kimi、opencode）。cleanroom 在隔離下跑：Fable 建議 **UID drop（`setpriv`，per-seat review UID + 0700 HOME 只放憑證，環境清空）**，astra 建議 bwrap 帶完整 launch policy；先做 UID drop，bwrap 當第二 profile。runner 表加 `tools` / `isolation_required`。
   - **gate 在 intake＋resolver**：intake 每席跑不呼叫模型的 canary preflight（stub 試讀 repo／HOME／`.autopilot`／`/proc/*/cwd`／兄弟 HOME → 全 denied），秒級失敗；panel 快照進 campaign state，final panel 從快照解析。`final-panel-qualification.js` 把「模型資格」與「runner/profile 隔離能力」分開；.58 的 `BLIND_DISCOVERY_CAPABLE_RUNNERS` 變成 `packet` tier 的定義。
   - **提速**：verify 只跑一次（tree hash 綁 verify＋full_suite 兩個義務）；有 panel 就關 in-rail 單席 review（`review.in_rail` 預設 off）；三席並行（真並行：分離子行程，不是 `Promise.all` 包 spawnSync）＋一席 standby；packet build／panel 與 rail 自己的 suite 可重疊。
   - **紅字測試**：packet canary（commit message／evidence／deny-list 各種一個 token，建包後零命中）；attestation canary；敵意 stub 席在隔離下讀不到；兩席並行互讀不到；同 panel receipt hash 一致；沒 review UID 的主機 intake 十秒內拒；假「tests passed」rail 照跑 verify。
   - 知道的取捨：cleanroom 看不到 git history（spec 要寫意圖）；網路開著（斷言憑證檔無 MCP／本地端點）；`min_panel_size`/family 規則跨 tier 混合滿足。
   - 可能拆兩刀：刀 1＝packet＋tiers＋intake preflight＋UID drop（讓 codex 上 panel）；刀 2＝verify 一次＋砍 in-rail review＋並行＋standby。每刀都要 consult（codex gpt-5.6-sol 或 gpt-6-astra）、hetero plan loop（GLM＋codex，`--timeout 20m`）、freeze chain（scratchpad `…/23f2bf74…/scratchpad/a1/freeze-a1.js` 是最新模板）、**verification_commands 先在 base 跑綠再封**、**max_wall_seconds 至少 hand＋2×suite＋review（寧可 7200+）**。
2. 之後 fired：resume→repair 分支名（`deriveCampaignDispatchUnit` 在 resume 路徑自己 derive）；cuda backlog 遷移三缺陷（修好回版本號）；suite/config 耦合（hermetic `REVIEW_LOOP_CONFIG_OVERRIDE`）。
3. open：A2（被 redesign 吸收）、ADJUDICATING pre-claim、stale lease GC、carry-only recovery、REVOKED 撞 id、acceptance_failed terminal journal、verify_cmd detached worktree、openclaw hook 提案、context-budget model-id 視窗、CI dispatch-detached。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY；`node scripts/session-mode.js status --repo-root "$PWD"` → `active: false`。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（new 0、allowed 31）。
- `bash scripts/sync-all.sh --check` → ok:true。`AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8。
- A1 的證據：`docs/plans/evidence/2026-09-16-final-panel-blind-admission/README.md`；P1-1：`…/2026-09-16-proof-parity-raw-log/`；C：`…/2026-09-16-red-verification-repair/`；B：`…/2026-09-16-agy-effort-rail-wording/`；D：`…/2026-09-16-ledger-rotation-order/`。

## Read-order
1. `docs/plans/evidence/2026-09-16-blind-review-redesign/`（兩份 consult＋問題）— redesign 的底稿。
2. `docs/BACKLOG.md` — open：Blind review redesign（L）；fired：resume→repair 分支名、cuda backlog 遷移、suite/config 耦合。
3. `CHANGELOG.md` v2.36.58 → v2.36.54（今天五刀，每刀的 rail 教訓都在裡面）。
4. `skills/l5/references/hetero-impl-loop.md` recipe（本輪加了兩條：base 先跑綠再封；`test -x`＋temp branch）。

## 陷阱
- **campaign 跑的整段時間主 checkout 一個字都不能動**；grant 後 HEAD 也不能前進。平行工作全放 scratchpad。
- **plan 點名的斷言欄位要先確認資料結構真的有**：C 的 T7 寫 `gate.input.vertical_failed === true`，但 gate journal 只存 `input_digest`（`recordGateEntry`），G1/G2 與兩家族 reviewer 全照字面要求；先 `grep` 結構再寫 rubric，不然 MUST-FIX 只能駁回。
- 已決：C 的 MUST-FIX 駁回不改 plan（plan 改了 source sha 漂、admission 拒）；證據 README＋CHANGELOG 明說。
- **hand 的測試要看它有沒有真的叫到受測物**：P1-1 的 hand 交了兩個空斷言（手搭 wrapper 從沒呼叫 engine；stub 餵 composition 只測 pass-through），suite 全綠、MiniMax 兩條都真。驗證時 grep 新斷言的資料來源，回溯到真的 engine/腳本呼叫才算。
- **campaign wall budget 要算兩遍 suite**：rail 跑 verify 又跑 full_suite（同一組 verification_commands 兩次）；A1 六個 suite 兩遍 ~40 分＋hand 40 分 > 我封的 5400 s，在 convergence 才停（全綠）。`max_wall_seconds` 至少 = hand 時間 + 2×suite 時間 + review，寧可 7200+。
- cuda 已在 GLM-5.3 席位驗證 v2.36.57 有效（同 diff .54 no_verdict → .57 reviewed）。
- awaiting_disposition 的 resume：disposition authority 檔形狀見 `docs/plans/evidence/2026-09-16-proof-parity-raw-log/disposition-authority.json`（review_digest 從 `impl-run1.json` 撈、finding_id 是 normalized id、evidence.kind=trace）；resume 不燒 attempt；走到 repair 會撞分支名 row。
- 驗證 worktree 要 `git checkout -b`（`next-touch-validation`、`provider-readiness-consumer` 在 detached HEAD 會死）；hand 建的測試檔是 100644，`bash file` 看不出來，CI executable gate 會紅——`test -x`。
- `reap-dispatch-branches.sh reap` 沒 `--yes` 是 dry-run；merged 分支要 `--ack-preserved <branch>@<tip>`。worktree reaper 也要 `--yes`；root id 用 campaign 自己的 `campaign-v1-…`（`impl-run1.json .campaign_control.campaign_id`）。`record-integration.js` 的 accepted sha 必須＝當下 HEAD（merge 後再 commit 就用新 HEAD）。
- `check-backlog-entries.js`：Pointer 必須裸路徑且存在（evidence README 要先建）；entry >600 B 強制 Pointer；Title ≤120、Context ≤240、Source ≤160。
- run-ledger 測試釘 `ts`：PATH 前置 `date` shim 只攔 `-u +%Y-%m-%dT%H:%M:%SZ`。
- `verify-preexisting.sh` 不吃 `--help`（會把它當測試指令跑）。
- `dispatch-plan-review.js` 不帶 `--timeout 20m` 高檔席會死；`check-phase-review-receipt.js` rc 0 時不印任何東西。
