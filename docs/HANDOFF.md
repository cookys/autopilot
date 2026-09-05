## 目標

接續 **l4 host provider-readiness bootstrap**（L 級，v2.36.8）：plan 已凍結（plan loop g2 checker exit 0），mission admission READY（單一 deliverable D1），**尚未建分支、尚未動工**。上一 session 在 T2（750k／1M）交棒。
（取代前一版 handoff。）

## 現況

- **autopilot**: `develop` 本地比 `origin/develop`（`bb5b78a5`，v2.36.7）多 **6 個 docs-only commit**（plan R0→g2 folds、rubric、manifest、ledger、project README、INDEX in-progress row、BACKLOG row 更新）；**未 push**；working tree 乾淨。version 2.36.7。
- **plan**: `docs/plans/2026-09-07-l4-host-provider-readiness-bootstrap.md`（Board 已答 §8：l4 route supported／VA、QC 選配／PATCH v2.36.8）。rubric R1–R13、manifest（sol chair codex/max ＋ MiniMax-M3 cc-shim/high）同目錄。
- **plan loop**: g1 sol STOP（R3 R5 R9）→ 全折入；g2（cap）sol READY、MiniMax CONDITIONAL（R7 non-blocking）→ 折入；freeze：`check-phase-review-receipt.js --plan-artifact g2.adjudicated.json --dispositions g2.dispositions.checker.json --plan-file plan.g2-reviewed.md --rubric-file <rubric>` exit 0。ledger：`docs/projects/2026-09-07-l4-host-bootstrap/ledger/plan-review/`（README 有表）。
- **admission**: `mission-routing-admission.js --level l3` → READY、deliverable_count 1、admission_digest `dc4d8671…`（2026-09-07）。
- **project**: `docs/projects/2026-09-07-l4-host-bootstrap/README.md`（goal／KRs／L-1.5 audit／D1 graph／progress）；INDEX 進行中已有列。
- **P0 spike 已做**（plan §4 P0 表，五個隔離探針）：l4 建構子拒絕；l5/l6 VA 缺 ⇒ roster_incomplete（VA 訊息）；VA 在、QC 空或 `qc_panel_seats_complete:false` ⇒ roster_incomplete（QC 訊息）。
- **v2.36.2–v2.36.7 本 session 已出貨並 push**：live 窗口 >0、aborted 世代 receipt、grok 黏框架、seat-gap 門檻、never-started claim、l4 reviewer_qualification 豁免＋readiness 具名拒絕（CHANGELOG 各節）。

## 已決事項(不重議)

- Canonical policy coverage 是 advisory（Board 2026-08-16）——l4 **不需要**新資格證據，只需 bootstrap 收 l4 ＋ per-level roster profile（l4：implementer＋reviewer 必要、VA/QC 選配；l5/l6 不變）。不得新增任何 roster identity 硬閘（rubric R1/R3）。
- ADR-0001：l4 bundle 走同一個 `collectProviderReadinessBundle` live probe；`strict_level` 記真實 level `l4`；level-drift 檢查擴大不移除。
- v2.36.7 的 reviewer waiver 保留；bootstrap 認證 reviewer ⇒ 無 `waived` 條目，未認證 ⇒ 有（KR4）。
- readiness 不豁免（owner「先 fix 然後完整修好」，fix 半在 v2.36.7）。
- KR3 負對照要三條各自隔離（VA 缺／QC 空／QC 旗標 false），l5 與 l6 各一組——同時拿掉兩者證明不了 QC 不變量。
- 版本 PATCH v2.36.8；不動 D4 claim set；不做 v2 claim↔ICC 綁定（另一 BACKLOG row）。

## 下一步

1. `git checkout -b feat/v2.36.8-l4-host-bootstrap develop`；TaskCreate 三個 forcing function（L-1.5 已在 README 完成可直接標完、L-1.6 skill routing、L-5 finish-flow），D1 task `blockedBy=[L-1.6]`；L-1.6：本 repo 無 skill-routing 檔，N/A 一行說明。
2. D1 依 plan §4 P1→P2→P3 一個 branch、一次 pre-merge review：
   - P1 `src/readiness/provider-bootstrap.js`：建構子收 `l4`（~489-497）；`LEVEL_ROSTER_PROFILE`；`deriveStrictL5InvocationPolicy(resolved, level)` 在 ~292（VA）/~301（QC）查 profile；`validateCollectedBundle`／receipt `strict_level`＝真實 level；level-drift（~619）收 l4。
   - P2 `bin/autopilot.js:396` 三 level；usage 文字；`engine-lifecycle-observation.js` `OBSERVABLE_LEGACY_LEVELS`＋`l4`、`OBSERVABLE_ENGINE_STATUSES`＋`waived`；`campaign-intake.js` 訊息「only l4/l5/l6」；`sync-codex-plugin-skills.sh`。
   - P3 測試：`autopilot-cli.test.sh` L4 fixture（仿 L6 fixture ~270-295，preload roster `verification_author_present:false`＋空 QC；斷言 ready／`strict_level:"l4"`／KR2 三斷言）＋ l5、l6 各三條隔離負對照；`provider-readiness-consumer.test.sh` profile 單元＋level drift；`autopilot-engine.test.sh` KR4；observation KR5。**每條新斷言先在 develop 紅**（stash 兩個 src），紅跑記進 ledger。
   - P4 docs：`level-front-door.md` foreman 段改寫、`references/multi-agent-portability.md:185`、`docs/installation.md`、BACKLOG 兩 row 收線、CHANGELOG v2.36.8、INDEX、`sync-version.js --version 2.36.8 --hook-count 29 --skill-count 30`。
3. pre-merge review：`autopilot:reviewer` **帶 `model: opus` 與首行 `Engine: opus`**（memory：漏 model 會被 dispatch-model-guard deny）；brief 明說只跑三套 suite、別跑 run.sh（會 30 分鐘停車）；transcript 15 分鐘沒動就 SendMessage 催。
4. finish-flow L-5 → merge `--no-ff` → 跑 preflight（8/8）→ owner 說推才 push → 通知 cuda（instance `01M1RKK4DH2KQS014KJS8Z35DV`，用 `to` handle ＋ `to_filter.instance`）跑 P5 dogfood。
5. 等待中的 peer 回報：cuda QUIET-a claim `mission withdraw --never-started`（v2.36.6）、7840hs receipt 重跑（v2.36.3）。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain && git log --oneline -1                  # 空；de0193f8
git log --oneline origin/develop..develop | wc -l               # 6（docs-only，未 push）
node -p "require('./.claude-plugin/plugin.json').version"       # 2.36.7
L=docs/projects/2026-09-07-l4-host-bootstrap/ledger/plan-review
node scripts/check-phase-review-receipt.js --plan-artifact $L/g2.adjudicated.json --dispositions $L/g2.dispositions.checker.json --plan-file $L/plan.g2-reviewed.md --rubric-file docs/plans/2026-09-07-l4-host-provider-readiness-bootstrap.rubric.md; echo $?   # 0
node scripts/mission-routing-admission.js --repo-root "$PWD" --level l3 | head -c 60   # READY
```

## Read-order

1. docs/plans/2026-09-07-l4-host-provider-readiness-bootstrap.md — §2 KRs、§3 檔案表、§4 P1–P4、Review log。
2. docs/projects/2026-09-07-l4-host-bootstrap/README.md — goal、scope、D1。
3. src/readiness/provider-bootstrap.js ~270-310（VA/QC 檢查）、~489-500（建構子）、~600-625（bundle validate）；bin/autopilot.js ~396-412（l4 waiver 與 bootstrap 順序）；hooks/tests/autopilot-cli.test.sh ~236-300（L5/L6 fixture 範本）。

## 陷阱

- plan loop 的 dispatcher／checker disposition 形狀不同：freeze 要用 ledger 的 `adjudicate.js` 橋接（已放好）。`--timeout 20m` 必帶。
- Bash 工具跑 >120 s 前景指令後 context-budget 可能走推斷路徑假響 T2（無「(statusline)」）——這次是真的 T2（有 statusline 字樣）。
- 派 reviewer 要 `model:`＋`Engine:` 首行；reviewer 常在 `hooks/tests/run.sh` 上停車，brief 要禁跑。
- pre-commit ritual 會擋 codex 鏡像 drift（`src/` 也有鏡像）：commit 前 `sync-codex-plugin-skills.sh`；commit 失敗後 `git branch -d` 不會擋（分支無獨有 commit），工作樹不會丟。
- fleet 訊息：`to` handle 必填，`to_filter.instance` 縮到單 session；訊息表頭的 sender instance 可能已失效，先 `list_peers`。
