## 目標
接續 autopilot 維護。2026-09-16 出貨到 **v2.36.52**。operator 2026-09-15 指令：「CEO 模式把 fired backlog 依序做完、可平行就平行、走 /l5、討論找 hetero engine」——當時 8 條 fired 全部關了（6 條早已出貨翻正、2 條合成 v2.36.45 campaign），之後這輪量到的 rail 缺陷也全部出貨（v2.36.46–48、50），既有紅燈 suite 全部歸零（v2.36.49 ＋兩個 tests-only commit）。**下一刀已定：cuda 端到端量到的 disposition resume 缺陷**（見下一步 1）。

## 現況
- 分支 `develop` = `origin/develop` @ `4ed806aa`（v2.36.52 `1985b332`；v2.36.51 merge `70eea675`；v2.36.50 `5125bb5d`；v2.36.49 `41a989df`；v2.36.48 `3f4eb339`；v2.36.47 `f88a7f53`；v2.36.46 `3be9ad53`）。工作樹乾淨；沒有 mission worktree；別的 session 的 `…/7ef6560a…/scratchpad/baseline` detached worktree 不是我們的、別動。`stash@{0}`（2026-08-30 evidence-discipline §20/§21 草稿）仍在、非本輪產物。
- session marker：本 session 的 l5 marker 已用 `session-mode.js retire` 退掉（dogfood）；`.claude/mission-routing-config.json` 目前指 `mission-backlog-entry-migration`（已完成、sources 仍相符）→ `mission-routing-admission` READY，`session-mode set` 任何 level 可用。
- 本機 pin store（`~/.autopilot/engine-capability/pins.jsonl`）：implementer `cursor-grok-4.6-low/cursor`（2026-09-12）＋ **qc_panel 兩席** `GLM-5.2/cc-shim@glm`、`gpt-5.6-sol/codex@none`（2026-09-15，v2.36.46 dogfood）。從 v2.36.46 起 managed campaign 沒 pin 的 qc 席在 intake 就被拒，這是設計。
- 這輪出貨（全在 CHANGELOG）：v2.36.45 peer-residue（/l5 campaign；rail 席位放過 57 紅候選＝reviewer miss）；v2.36.46 final panel 認 standing pin（L，owner 裁定一次到位；hand commit 被 boundary gate 拒、depth-0 接手）；v2.36.47 `--mirror-roots-json` 列 skills；v2.36.48 pre-claim repo facts ＋ `session-mode.js retire`；v2.36.49 contract schema 漏欄＋profiles 基線 re-pin；v2.36.50 `--sibling-path-prefix`；v2.36.51 backlog 遷移 table style（revival.3d）；v2.36.52 兩條鏈進 pre-commit ritual ＋ recipe 補規矩。
- Peer 狀態：cuda（revival.3d／fleet-comms）已更新到 ≥v2.36.49，拿到 table 遷移用法（等他們對 196 KB 真檔 dry-run 回報）；他們對 fleet-comms 跑 owner-led bounded campaign 到 review 成功，resume 死在 check-repair-scope（下一步 1）。308-8f 兩條剩 agy `--effort`（未重現）。送達≠已讀。

## 已決事項(不重議)
- Backlog 一列＝index row（schema 只在 `references/backlog-entry.md`），gate block 模式且是 pre-commit ritual；Title 超長不自動改。
- Managed rail 停了照文件降級（`--fallback precondition_failed`）、在 retained worktree 修、git 證據 merge、缺陷登 BACKLOG——不繞 rail。
- Review 三輪停；reviewer MUST-FIX 一律 probe＋mutation 重推才接受或駁回。
- config 列席位 ≠ 合格（ADR-0001／resolver 2311）：無證據席位只能靠 override 檔或 standing pin，且要進 `override_admitted_seats`。
- marker bridge 掃全部 marker、對不同 graph digest 的活 marker 拒絕＝concurrency fence，不改；出口是 `retire`（registry＋git 證據），不准手刪 marker。
- pre-spend 拒絕走 pre-claim 檢查（第三個同型：ledger v2.36.42、panel v2.36.46、repo facts v2.36.48），不做 attempt refund。
- 同 adoption key 換 graph digest 是 `MISSION_BINDING_MISMATCH`，只能改 `intent.objective` 開新 lineage；舊 lineage 留 ACTIVE 是殘留不阻擋。

## 下一步
1. **fired（Fix）— disposition resume 死在 `check-repair-scope.js:215`**：`campaign-intake.js:621-633` 用 `projection.initial_candidate_reference || reference` 當 `scope_implementation_sha`，repo 裡沒人設 `initial_candidate_reference`；ledger 的 `awaiting_disposition` payload 有 `candidate_ref`（40 hex）。綁上去、red-first（composition 層 + 真 ledger fixture）、若能做到 CLI e2e 更好（cuda 的 ledger 在 `/home/cookys/projects/fleet-comms/.git/autopilot/implementation-campaign.jsonl`，campaign-v1-a8095f81…，可請他們重跑）。修好回 cuda（thread `msg_01M2JW9NJRE106DKDZWQARFJF2`）。
2. 兩條 S wording（BACKLOG「/l5 wording」row）：VA 席錯誤訊息補「加進 config 即可」；文件說明 CLI `status readiness --probe` 在 engine 外永遠 probe-needed。
3. 308-8f：agy hand 不帶 `--effort` 只 edit（Fix，先本機重現，`agy_effort_clamp` 預設）。
4. open、trigger 未到：rail 從不傳 scorecard scope 檔（`fallback_ladder` 永遠 `[]`，有證據的 qc 席還是要 pin）；codex-cli／codex runner token 正規化；30 條 Title >120 B allowlist 殘留。
5. 下一個 managed campaign 是 v2.36.46 的真正量測點：final panel 三席應 `reviewed`；同時量 v2.36.43（no_verdict durable wait）。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `node scripts/mission-routing-admission.js --repo-root "$PWD" --level l5` → `READY`；`node scripts/session-mode.js status --repo-root "$PWD"` → `active: false`。
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md; echo $?` → 0（new 0、allowed 31）。
- `bash scripts/sync-all.sh --check` → ok:true（14 rituals，含新的 `check-contract-schema`、`check-profile-catalog`）。
- 既有紅 suite 歸零的證據：`autopilot-engine.test.sh` 493/0、`codex-plugin-package.test.sh` 125/0、`profile-context-isolation.test.sh` 122/0、`dispatch-hetero.test.sh` 322/0、`session-mode.test.sh` 48/0、`migrate-backlog-entries.test.sh` 70/0、`check-backlog-entries.test.sh` 31/0（一次跑一個）。

## Read-order
1. `docs/BACKLOG.md` — fired 的只剩 disposition resume 那條；證據在各列 Pointer。
2. `skills/l5/references/hetero-impl-loop.md` — depth-0 recipe 11 步（5b、6、7、9、11 這輪都改過）。
3. `CHANGELOG.md` v2.36.45–52 八節（每節都有「rail 這輪量到的」段）。
4. `docs/plans/evidence/2026-09-15-final-panel-pins/README.md`、`…/2026-09-15-peer-residue/README.md` — 兩次 campaign 的 attempt 紀錄、integration receipt、移走的 marker。

## 陷阱
- 落地在 memory 的：`engine-test-fixture-gotchas`（新增：suite 隔離 `ENGINE_CAPABILITY_DIR`，live config 的 cursor pin 席位會 exit 3——改讀凍結 fixture＋種 pin）、`archive-live-evidence-routing-closeout`（新增：merge 後改 plan 讓 admission 漂、全 level `session-mode set` 被拒；回指相符的已完成 graph＋legacy reconcile）、`dispatch-review-runner-setup`（GLM 帶完整 proof 但 parser 因 session-title chrome 回 no_verdict——讀 raw log 再判）。
- `git stash push -q <path>` 的 `-q` 放在 `push` 前會被當成沒指定子命令、接著 `stash pop` 會 pop 到別人的 stash@{0}——本輪中過一次；紅燈驗證改用 detached scratch worktree ＋ `git apply <tests.diff>`。
- 改 `skills/ceo-agent/SKILL.md`／`skills/dev-flow/SKILL.md` 或讓 resolver 多吐欄位：現在 pre-commit ritual 會擋（v2.36.52），re-pin 配方在 v2.36.49 CHANGELOG。
- `required_paths` 列新檔燒 attempt；campaign `output_paths` 要含 `skills/<projected>/**` 的 codex 鏡像（`--mirror-roots-json` 現在會列）；brief >8 KB 只是建議不是硬限。
- `record-integration.js` 要在砍分支前跑（accepted 必須是 checkout HEAD、source 要活 ref）；事後補要重建分支名在臨時 worktree。
