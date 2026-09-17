## 目標
接續 autopilot 維護。2026-09-17 出貨 **v2.36.61**（merge `e43cc44d`，release `69c7668b`，closeout `e38b903e`，已推 `origin/develop`）：blind review redesign **第二刀 1a-B**——engine 每次 managed review 都給 packet、`reviewDiff`／`performReview` 帶回 `packet_hash`、seat receipt optional 鍵、engine＋validator 兩層 panel 一致性。同日稍早 v2.36.60（rail 缺陷 (1) panel `--timeout`，已在 1a-B campaign 實測到 `--timeout 5024s`）。redesign 四刀（1a-A plan §7）：1a-A ✓ → 1a-B ✓ → **1b**（cleanroom tier：`bwrap` launcher、intake preflight canary、runner tier 取代 `BLIND_DISCOVERY_CAPABLE_RUNNERS`、codex 回 panel、可設定 deny-list）→ 2。下一個 session 做 **1b**。

## 現況
- `develop` = `origin/develop`。工作樹乾淨；1a-B 的 worktree／branch 已 reap 進 bundle（`evidence/2026-09-17-blind-review-packet-engine/lifecycle-receipt.json` `zero_residue: true`）。別的 session 的 `…/7ef6560a…/scratchpad/baseline` detached worktree 不是我們的、別動。
- session marker 已 `retire`（帶 `integration-record.json`）→ `active: false`。routing 指 `blind-review-packet-engine-2026-09-17`（graph `cb248cb1…`，已完成）→ admission READY。開 1b 前照 recipe：新 plan → 新 graph → routing 換 → `mission-terminal-reconcile.js legacy --graph-digest <new>`。
- **codex 額度用盡到 2026-09-19 16:26**（`review-codex-r1-quota.json`）：plan loop 第二家族與二審都要改 GLM-5.2（anthropic-compatible／glm）或 claude-native；plan-review manifest 的 codex 席要換。grok 仍 402。
- pin 不變：`qc_panel[0]` = claude-fable-5-1/claude-native、GLM-5.2/cc-shim、MiniMax-M3/cc-shim。**1b 落地後換回 `gpt-5.6-sol/codex max`**——config 檔＋`pin-seat`。
- CI：v2.36.60 run `35174146770` 同樣 detached smoke 兩條紅、套件步驟 skipped（BACKLOG row `if: always()` 未做）；v2.36.61 的 run 還沒看——看 steps 不只看 job。
- **兩個 suite 從 `acf3b06c` 起 base 紅**（`provider-readiness-consumer` 5、`autopilot-cli` 33），campaign `verification_commands` 不要放。`next-touch-validation` 在 detached HEAD 會死——跑 base／head 證據要開臨時分支。
- 1a-B campaign 量到兩個新 rail 缺陷（都登 row）：(3) **`changed_files >= max_changed_files` 擋 repair**——hand 碰滿 13 個 sealed path 後 repair 一律 `campaign mutation budget exhausted`；freeze 時 `max_changed_files` 要 > |output_paths|（暫時解法）。(4) **verification 在 rail 內紅只留 digest**（run output／work order／ledger 都沒有命令與輸出）；原因事後由 advisor 交叉對出：rail 的 verification 是**刻意 detached checkout**（`campaign-verification.js:322-341`），而 `next-touch-validation.test.sh:1765` 對 repo root 跑 `symbolic-ref HEAD` → 綁分支的 suite 在 rail 內永遠紅（BACKLOG S row）。**1b 的 `verification_commands` 不要放 next-touch-validation；base／head 證據要在 detached checkout 跑一次才等於 rail 的條件。**(2) graph-check 14400 vs schema 7200 仍 open。
- 1a-B 未做的 dogfood：plan §5「真 campaign 的 final panel receipt 帶同一 `packet_hash`」——這次 campaign 沒走到 final panel。1b 的 campaign 會是第一次；packet build 失敗時第一個看 `raw.reviewResult.error`。
- Peer：openclaw thread（`msg_01M2PHM6PWH6VY7WP059Y0Q1TT`）——已通知 v2.36.60，他們會回報 fleet-comms Phase 2/3 review round 有沒有 `--timeout`；四提案登了 PEER-REPORTED row，(a) 豁免 review 席等 operator 裁定。**沒有通知 v2.36.61**；要通知用 reply thread 或 `fleet send`（本專案 scope 目前只到自己）。
- 主機：兩個閒置 llama-server 09-17 01:5x 已關；`las` CADO worker 是 operator 的算題，沒動。

## 已決事項(不重議)
- 承接上版全部（backlog row=index、rail 停了照文件降級、review 三輪停、config 席位≠合格、marker retire 不手刪、pre-spend 拒絕走 pre-claim、換 graph 開新 lineage、B 兩個 base 紅 suite 不 reseal）。
- Redesign 隔離用 **bwrap 不是 UID drop**：主機 `/home/cookys` 0750、所有 CLI 在 `~/.local/bin`，UID drop 要動 sudoers／useradd／搬 binary；bwrap 免 root 且 codex 帶工具在裡面實跑過（`evidence/2026-09-16-blind-review-redesign/bwrap-probe.md`；要 `--sandbox danger-full-access`、bind 整個 release `bin/`、`/proc/1/cmdline` 會漏 host 路徑要包 wrapper）。
- Packet 樹**不能用 `git archive`**（`export-subst` 展 commit message、`export-ignore` 丟檔）；也不能直接 `checkout-index`（smudge filter 會在 integrity 前執行、含 `$GIT_DIR/info/attributes`）→ 隔離暫時 `GIT_DIR`＋alternates＋拔 `.gitattributes`＋空 work-tree＋清光 `GIT_*` env。每條都主機實測過。
- 五席 codex 二審找到的（leaf-only deny、ambient `GIT_COMMON_DIR`、symlink `.gitattributes`、name-status UTF-8、反斜線）全部接受並 RED-first 修掉；durable replay 綁 `packet_hash`（consult 5）駁回：packet 是 (base, tree, spec, deny-list) 的純函數，前三者 authority 已綁，deny-list 這刀是常數——1b 可設定後再議。
- `packet_hash` 在 receipt 上是 **optional key（像 `raw_log`）**，reviewed 席混有／無要拒、failed 席禁止、全無只給 legacy receipt（1a-B 的規則，consult 定的）。

## 下一步
1. **1b plan**：`docs/plans/2026-09-17-blind-review-cleanroom.md`（新 plan 檔＝新 graph node）。範圍照 1a-A plan §7 第 3 點：runner table 加 `tools: true|false`；`scripts/lib/cleanroom-launch.sh` 用 `bwrap` 跑 tool-capable CLI，只 bind `packet/tree`＋runtime＋TLS/DNS＋消毒過的 credential HOME（policy 與 probe：`evidence/2026-09-16-blind-review-redesign/bwrap-probe.md`——要 `--sandbox danger-full-access`、bind 整個 release `bin/`、`/proc/1/cmdline` 漏 host 路徑要包 wrapper）；intake 對每個 cleanroom 席跑 no-model stub probe，邊界不可強制就秒拒；`BLIND_DISCOVERY_CAPABLE_RUNNERS` 變 packet tier；codex profile 先做；隔離 suite host-only、沒 `bwrap` 要拒不是跳過；可設定 deny-list。**freeze 時 `max_changed_files` 設 > |output_paths|**（缺陷 (3)）。
2. 每刀照 recipe：consult（codex）→ hetero plan loop（GLM＋codex，`--timeout 20m`，**detached 跑**見陷阱）→ freeze（`…/6bdcb942…/scratchpad/c1a/freeze-c1a.js` 最新模板：`max_wall_seconds` ≤ 7200、`wall_seconds` reservation ≥ 它、`SCRATCH` env 要設）→ verification_commands 先在 base 跑綠 → `session-mode set l5` → grant → brief ≤ 8 KB → dispatch detached。
3. 之後 fired／open：rail 缺陷 (3) changed_files cap（Fix）、(4) verification digest-only（S）、(2) wall cap ruling；CI `if: always()`（S）；PEER-REPORTED openclaw (b)(c)；resume→repair 分支名；cuda backlog 遷移；hash-object 批次化（packet 建包 21 s／3382–4236 檔）；ADJUDICATING pre-claim；stale lease GC；carry-only recovery；REVOKED 撞 id；CI dispatch-detached。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`（HEAD 見 git log）。
- v2.36.61 的紅綠：`evidence/2026-09-17-blind-review-packet-engine/head-suites-f81f9425.txt` 的 13 條（engine 516、routing 96、receipt 21、dogfood 21…）；別平行跑；`next-touch-validation` 要在分支上。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY；`node scripts/session-mode.js status --repo-root "$PWD"` → `active: false`。
- `bash scripts/resolve-review-loop.sh --check-scorecard --field override_admitted_seats` → 四席全 admit、沒有 blind ⚠。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（new 0、allowed 31）。
- `bash scripts/sync-all.sh --check` → ok:true。`AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8。
- 證據：`docs/plans/evidence/2026-09-16-blind-review-packet/README.md`（campaign、codex r1–r3、dogfood、receipts）；設計：`…/2026-09-16-blind-review-redesign/`（兩份 consult、plan consult、bwrap probe）。

## Read-order
1. `docs/plans/2026-09-16-blind-review-packet.md` §7 第 3 點＋`evidence/2026-09-16-blind-review-redesign/bwrap-probe.md` — 1b 的範圍與主機實測。
2. `docs/plans/2026-09-17-blind-review-packet-engine.md` §1（1a-B 出貨後的 engine 行為，1b 要接的介面）＋`evidence/2026-09-17-blind-review-packet-engine/README.md`（campaign 怎麼停、live probe、GLM 誤報怎麼駁）。
3. `docs/BACKLOG.md` — open：changed_files cap（Fix）、verification digest-only（S）、wall-cap mismatch（Fix）、CI skipped-step（S）、PEER-REPORTED openclaw（S）、hash batching（S）。
4. `CHANGELOG.md` v2.36.61、v2.36.60。
5. `skills/l5/references/hetero-impl-loop.md` 5b（本輪加了 rubric 性質／換 lineage 一段）。

## 陷阱
- **harness 的記憶體守衛會殺 `run_in_background` 的長工作**（這台 `las` factoring＋llama-server 佔 ~80 GB，free 常 <15 GB）：plan review 被殺兩次、campaign 也可能。長工作一律 `setsid nohup … & disown` 分離＋`Monitor` 輪詢檔案（不是裸等）；被殺的 plan-review 會留 `orphaned_active_claim_transport_exhausted`，零席消費時把 `~/.autopilot/plan-review/<hash>/` 搬走重跑（記進 Review log）。
- **frozen rubric 被自己的 G1 blocker 打掉**（rubric 寫「git archive」但 G1 證明不能用 archive）→ 改 rubric 會 `frozen rubric/manifest drifted`；只能開新 logical id（`-v2`）＋新 `--ticket`（舊 ticket 綁舊 id），舊 G1 artifact／dispositions 留證據。**寫 rubric 時別把機制細節寫死，寫性質。**
- 換 rubric 之前先確認 rubric ID 格式、plan growth ≤1.25×（這次 v2 baseline 24.7 KB，終稿 31.5 KB＝1.27×，cap 到了才沒被擋；下次先瘦身）。
- **campaign 跑的整段時間主 checkout 一個字都不能動**；平行工作全放 scratchpad。
- `dispatch-review.sh` 手動二審：codex 非 blind、`--effort max --timeout 20m`、spec 給 plan；delta 複核用「只有修補的 diff」＋一句說明前一輪 finding，r2／r3 各 5 分鐘。
- `record-integration.js` 要**完整 OID**（短 sha 拒）；`reap-dispatch-branches.sh reap` 要 `--inventory-file <reap-wt.json>`；`lifecycle-residue-receipt.js issue` 要 `--branch-result`。
- `session-mode set` 可以直接把自己的 active marker 換到新 graph digest（`prior_marker_status: active` 照常 READY）；不用 clear。
- 貼 BACKLOG row：Title ≤120、Context ≤240 bytes（中英混排先數 bytes）。
- `test -x` 每個 hand 建的測試檔（這次 hand 有做對）；hand 的 fixture 對照組要真的能紅（這次兩個 control 都真的會觸發），但仍漏了一條斷言（tracked `.gitattributes` sentinel「沒跑」）——讀 fixture，別只看 pass 數。
- **二審 diff 要涵蓋整個 commit**（含 `platforms/` mirrors 與 `docs/`）：這次只送 `src schemas hooks references`，GLM 就報兩條「mirror 沒同步／BACKLOG 沒改」的假 MUST-FIX；用 `git diff base..head`（不加路徑）或至少對照 `--name-only`。
- **plan loop 收 receipt 要用被審那一版 bytes**：先 `cp plan → plan.as-reviewed-gN.md` 再 fold；這次 G1 忘了，靠精確反推替換才對回 sha。
- **freeze 時 `max_changed_files` 一定要 > |output_paths|**：等於就是 repair 死路（缺陷 (3)）。
- codex 額度到 09-19 前，plan-review manifest 與二審都換 GLM／claude-native；MiniMax in-rail 席照常。
