## 目標
接續 autopilot 維護：FIRED queue 六項已全部出貨（v2.36.34–36），下一步是 BACKLOG 裡尚未 FIRED 的殘留，或 operator 指名的新工作。

## 現況
- 分支 `develop` = `origin/develop` @ `4a76ea6f`（docs: record v2.36.34–36 push SHAs）。工作樹乾淨。
- DONE 並已推：v2.36.34 工頭軌 Shape B（`dispatch-foreman.sh`、`wait-dispatch-results.js`、`lib/main-checkout-boundary.sh`）；v2.36.35 `repo-residue-sweep.js`（308 (a)）；v2.36.36 四條 2026-09-12 dogfood 缺陷。三輪 MiniMax review，trailer 在 `7769259f`。
- IN-FLIGHT：無。唯一鬆散端：`git stash list` 有一筆舊的 `stash@{0}: pending: evidence-discipline §20/§21 (needs QC review to land on protected references/)`——不是本 session 建的，內容是 `references/evidence-discipline.md` 的兩節草稿，落地前要走 QC review（references/ 是 protected path）。
- 308-db 已收到通知（send receipt ≠ read receipt）。

## 已決事項(不重議)
- 工頭軌是 Shape B（owner 2026-09-13：配額是動機）；Shape A 不建。
- 工頭軌只出貨 rail；`/l5` 改走此軌是 skill 變更、另一個 PATCH、要 owner 說開。
- 環境走允許清單不走 scrub；出口不封鎖但結果誠實標 `egress_policy: unbounded`。
- 並行 campaign 的 CAS 衝突採「重新採納」（bounded 3 次），不採「mission grant 拒絕並行」。
- graph-check mirror rule 只做 depth-0 裁定（落在兩輪 review diff 之間），BACKLOG 已註明。
- Review 停止規則：三輪後 depth-0 依重新推導裁決，殘留寫 BACKLOG。

## 下一步
1. `git stash show -p stash@{0} | head -80` 看那兩節草稿；若要落地：`git stash pop`，派 `dispatch-review.sh`（roster：cc-shim/MiniMax-M3 @minimax，見 memory `dispatch-review-runner-setup`）審 diff，帶 QC-Verdict trailer 再推。不要就 `git stash drop`。
2. `grep -n 'NOT FIRED' docs/BACKLOG.md | head` 找下一條候選；`/next` 也可。
3. 若 owner 開 `/l5` 走工頭軌：先讀 `references/hetero-dispatch.md` § A non-Claude foreman，改 `skills/l5/SKILL.md` 與 `skills/ceo-agent/references/level-front-door.md`（guidance 變更，需 eval 證據）。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop` 無 ahead/behind。
- `bash hooks/tests/dispatch-foreman.test.sh` → `PASS [dispatch-foreman] 102 assertions`（約 2 分鐘）。
- `node scripts/repo-residue-sweep.js scan --repo .` → JSON，`summary.worktrees` 只有 clean-unintegrated 1（別人 session 的 scratch worktree），不動它。
- `AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh` → `8/8` for v2.36.36。

## Read-order
1. /home/cookys/projects/autopilot/docs/BACKLOG.md — FIRED queue（第 14–24 行）全劃掉；「Foreman rail residuals」是唯一新殘留清單。
2. /home/cookys/projects/autopilot/docs/plans/2026-09-13-foreman-rail-b-build.md — 一頁建置計畫、量測表、保守分叉。
3. /home/cookys/projects/autopilot/CHANGELOG.md — v2.36.34–36 三節，每節列了測試數與哪一輪 review 抓到什麼。
4. /home/cookys/projects/autopilot/scripts/dispatch-foreman.sh — header 是契約；`run_turn` 是 kill/cap 核心。

## 陷阱
- 長套件平行跑會互相干擾（memory `parallel-suites-interfere`）：hetero 22m 平行時假紅，單跑 279 綠。
- 背景 review 跑的時候別改 `dispatch-review.sh` / `scripts/lib/*.sh`（memory `editing-running-bash-script-corrupts-it`）；`dispatch-foreman.sh` 本身不被 review 讀，可改。
- `git push origin develop` 在 HEAD 不在 develop 時印 up-to-date 假成功——先 `git branch --show-current`，用 `HEAD:develop`。
- kimi：`-r` 換 cwd 被拒、`-c` 同 cwd 接回被殺 session、`pin-seat` 一定要 `--endpoint`（`@none` 存成 null）。都在 repo evidence README / CHANGELOG，這裡只是指標。
- `dispatch-contract-pin.test.sh` 跑完會在 `scripts/` 留 `dispatch-contract.pre.js`，sync mirror 前先刪，否則 pre-commit 的 mirror check 紅。
