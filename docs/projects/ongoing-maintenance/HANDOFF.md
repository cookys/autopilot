## 目標
接續 autopilot 維護。2026-09-17 出貨 **v2.36.60**（merge `f6964c3a`，release `9974e590`，已推 `origin/develop`）：rail 缺陷 (1) 修掉——managed rail 每次 review 派工（in-rail／final panel／terminal 站點）都帶 sealed wall budget 推出的 `--timeout`，panel 席均分剩餘；dogfood kill／resume fixture 修回綠。前一版 v2.36.59 = blind review redesign **1a-A**。redesign 四刀（plan §7）：**1a-B**（engine 傳 `options.packet`、receipt 帶 `packet_hash`、panel 一致性）→ **1b** → **2**。下一個 session 做 **1a-B**（BACKLOG open row，L）——它的 campaign 前置（panel 5m 死）已清。

## 現況
- `develop` = `origin/develop`。工作樹乾淨；沒有 mission／verify worktree 或 branch（`lifecycle-receipt.json` `zero_residue: true`；merged 分支進 bundle）。plan-review state 留兩個 lineage（v1／v2）當證據。別的 session 的 `…/7ef6560a…/scratchpad/baseline` detached worktree 不是我們的、別動。
- session marker 已 `retire` → `active: false`。routing 指 `blind-review-packet-2026-09-16`（graph `d3068a5e…`，已完成）→ admission READY。開下一個之前照 recipe：新 graph → routing 換 → `mission-terminal-reconcile.js legacy --graph-digest <new>`。
- **pin 有動**（`004cb2da`，operator 決定 per 上版 HANDOFF 步驟 0 選項 (a)）：`qc_panel[0]` = `claude-fable-5-1/claude-native high @none`（packet tier），`MiniMax-M3/cc-shim` 也補了 standing pin（原本 `reviewer_qualified=false` 沒被 admit）。`.claude/review-loop-config.md` 同步改了（qc_panel／runners／efforts／endpoints）。**1b 落地後換回 `gpt-5.6-sol/codex max`**——config 檔＋`pin-seat`。grok 仍 402：consult 走 `dispatch-author.sh --runner codex --model gpt-5.6-sol --effort high --prompt-file … --timeout 20m`。
- CI（release-gated）：run `35132044435`（這次 release）`completed failure`——只剩已知的 `dispatch-detached-campaign-authority`（8 passed, 2 failed；open row），executable gate 這次綠。
- **兩個 suite 從 `acf3b06c` 起 base 紅**（`provider-readiness-consumer` 5、`autopilot-cli` 33），任何 campaign 的 `verification_commands` 都不要放。
- rail 缺陷 (1)（panel 5m timeout）**v2.36.60 已修**：`buildReviewArgs({timeoutSeconds})`、`--timeout` builder-managed、`campaignWallRemainingSeconds` 與 budget check 同上限來源、legacy 無 budget 不發旗標；codex max 非 blind 審 SHIP-AS-IS（raw log 在 scratchpad `qc/`，`/tmp/dispatch-review-log-1BMNA0`）。**尚未在真 campaign 上驗過**——1a-B 的 campaign 就是第一次實跑，final panel 若再死要先看 receipt 的 `--timeout` 值。(2) **graph-check 放行 `max_wall_seconds` 14400、schema 上限 7200** 仍 open（是裁定不是機械修）。
- **CI 假綠陷阱**：`test.yml` 的 `Run hooks test suite` 步驟在 `Detached dispatch ledger smoke` 紅時整步 **skipped**（run 35132044435 如此）——所以「只剩 detached 那條紅」其實是「其他套件根本沒跑」；dogfood kill／resume 自 v2.36.58 紅到 v2.36.60 都沒被看到。BACKLOG row（S，`if: always()`）。下次看 CI 先看 steps 的 conclusion，不只看 job。
- Peer：openclaw 09-17 02:0x 來問 depth-0 brief 踩 l5 marker 的四提案（`msg_01M2PHM6PWH6VY7WP059Y0Q1TT`，thread 兩則）；已回：(c) brief linter＋(b) 同一 `precondition_failed` 兩次即 ladder stop 會接；(a) `session-mode set` 印 mask 行可做、**豁免 plan／terminal review 席要 operator 裁定**（openclaw 說會另問 cookys）；(d) 是 brief 形狀問題。登了 PEER-REPORTED row。openclaw 另給資料點：fleet-comms P3 in-loop reviewer 也死在 5m——v2.36.60 涵蓋。**沒有主動通知 cuda／openclaw v2.36.60 出貨**——要通知用 `fleet send`（本專案 scope）。
- 主機：09-17 01:5x 關掉兩個閒置三週的 llama-server（Ornith-35B :8002 手動起的，`kill`；gemma-4-26B :8001 = `scriptorium-summary-llm` user service，只 `stop` 沒 disable）→ used 80→35 GB。8 個 `las` CADO worker（mple2-recovery）是 operator 的算題，沒動。harness 記憶體守衛的觸發條件因此暫時解除，但守衛本身還在。

## 已決事項(不重議)
- 承接上版全部（backlog row=index、rail 停了照文件降級、review 三輪停、config 席位≠合格、marker retire 不手刪、pre-spend 拒絕走 pre-claim、換 graph 開新 lineage、B 兩個 base 紅 suite 不 reseal）。
- Redesign 隔離用 **bwrap 不是 UID drop**：主機 `/home/cookys` 0750、所有 CLI 在 `~/.local/bin`，UID drop 要動 sudoers／useradd／搬 binary；bwrap 免 root 且 codex 帶工具在裡面實跑過（`evidence/2026-09-16-blind-review-redesign/bwrap-probe.md`；要 `--sandbox danger-full-access`、bind 整個 release `bin/`、`/proc/1/cmdline` 會漏 host 路徑要包 wrapper）。
- Packet 樹**不能用 `git archive`**（`export-subst` 展 commit message、`export-ignore` 丟檔）；也不能直接 `checkout-index`（smudge filter 會在 integrity 前執行、含 `$GIT_DIR/info/attributes`）→ 隔離暫時 `GIT_DIR`＋alternates＋拔 `.gitattributes`＋空 work-tree＋清光 `GIT_*` env。每條都主機實測過。
- 五席 codex 二審找到的（leaf-only deny、ambient `GIT_COMMON_DIR`、symlink `.gitattributes`、name-status UTF-8、反斜線）全部接受並 RED-first 修掉；durable replay 綁 `packet_hash`（consult 5）駁回：packet 是 (base, tree, spec, deny-list) 的純函數，前三者 authority 已綁，deny-list 這刀是常數——1b 可設定後再議。
- `packet_hash` 在 receipt 上是 **optional key（像 `raw_log`）**，reviewed 席混有／無要拒、failed 席禁止、全無只給 legacy receipt（1a-B 的規則，consult 定的）。

## 下一步
1. **1a-B plan**：`docs/plans/2026-09-17-blind-review-packet-engine.md`（新 plan 檔＝新 graph node）。前置 rail 缺陷 (1) 已清（v2.36.60）。範圍（1a-A plan §3）：`performReview` ~4812 與 terminal site ~9692（`baseSha: immutableBase`；`noReviewSpec` 時 spec undefined→packet 給 null）兩處 `reviewOptions.packet`；`reviewDiff` 回傳 `packet`；`performReview` 回 `packet_hash`；`finalPanelSeatReceipt` 帶 `packet_hash`（reviewed 且有包才有，不放 null）；`campaign-composition.js` `FINAL_PANEL_SEAT_OPTIONAL_KEYS = ['raw_log','packet_hash']`＋validator（64-hex、混有／無拒、failed 席禁）；`schemas/implementation-campaign-receipt.schema.json` finalPanelSeat 加 optional `packet_hash`（`additionalProperties:false`）＋codex 鏡像；`performFinalPanel` 兩個以上不同 hash → `reviewed:false`。八個 suite 手搭 seat receipt 沒這個 key（state／routing／receipt／dogfood／status-task／qc-panel-honesty／next-touch-validation／controller-execution-independent）——optional 就不用碰。
2. 每刀照 recipe：consult（codex）→ hetero plan loop（GLM＋codex，`--timeout 20m`，**detached 跑**見陷阱）→ freeze（`…/6bdcb942…/scratchpad/c1a/freeze-c1a.js` 最新模板：`max_wall_seconds` ≤ 7200、`wall_seconds` reservation ≥ 它、`SCRATCH` env 要設）→ verification_commands 先在 base 跑綠 → `session-mode set l5` → grant → brief ≤ 8 KB → dispatch detached。
3. 之後 fired／open：resume→repair 分支名；cuda backlog 遷移；suite/config 耦合；hash-object 批次化（packet 建包 21 s／4236 檔）；ADJUDICATING pre-claim；stale lease GC；carry-only recovery；REVOKED 撞 id；CI dispatch-detached。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- v2.36.60 的紅綠：`bash hooks/tests/autopilot-engine.test.sh`（502）、`bash hooks/tests/implementation-campaign-dogfood.test.sh`（21，含 `review_dispatch_timeouts=115s,115s`）；別平行跑。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → READY；`node scripts/session-mode.js status --repo-root "$PWD"` → `active: false`。
- `bash scripts/resolve-review-loop.sh --check-scorecard --field override_admitted_seats` → 四席全 admit、沒有 blind ⚠。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（new 0、allowed 31）。
- `bash scripts/sync-all.sh --check` → ok:true。`AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → 8/8。
- 證據：`docs/plans/evidence/2026-09-16-blind-review-packet/README.md`（campaign、codex r1–r3、dogfood、receipts）；設計：`…/2026-09-16-blind-review-redesign/`（兩份 consult、plan consult、bwrap probe）。

## Read-order
1. `docs/plans/2026-09-16-blind-review-packet.md` §1、§3、§7、Review log — 1a-B 的規格就在 §3。
2. `docs/plans/evidence/2026-09-16-blind-review-packet/README.md` — 這次 campaign 怎麼死、怎麼降級、codex 抓到什麼。
3. `docs/BACKLOG.md` — open：panel seat timeout（Fix）、wall-cap mismatch（Fix）、hash batching（S）、cut 1a-B（L）。
4. `CHANGELOG.md` v2.36.59。
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
