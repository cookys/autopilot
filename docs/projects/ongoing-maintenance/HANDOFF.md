## 目標
接續 autopilot 維護。2026-09-17 出貨 v2.36.62（1b-A cleanroom launcher＋seat tiers，merge `94d44940`）與 v2.36.63（1b-B intake cleanroom probe＋JS/resolver tier，merge `bc4ea99e`、release `f15e9e1e`）。兩刀 closeout 全清（worktree／branch reap、residue receipt zero、marker retire）。**1c（可設定 packet deny-list）進行中**：plan loop G1（7 折）／G2（6 折，cap）跑完、freeze READY（graph `4a5a3a80…`、lineage `lineage-v1-16c3e9be…`）、session marker l5、campaign 派出（見「現況」）。

## 現況
- routing → `blind-review-packet-deny-config-2026-09-17`；marker **l5 active**（session `ed4f4545-3dbb-4256-bdb4-80502ec4d221`）；1c scratchpad `…/scratchpad/c1e/`（prepared.json、grant.json、impl-brief.md、impl-run1.{json,err}）；worktree `/tmp/hetero-mission-16c3e9be1a87-*`。**campaign 跑中不要動 plan／repo tree**。1c evidence：`docs/plans/evidence/2026-09-17-blind-review-packet-deny-config/`（g1 attempt 1 transport-exhausted：claude-native 席在 scratch cwd 想跑工具→plan 加「citations are provenance」條款＋MiniMax fallback 席、fresh `--state-dir`）。
- 1b-B evidence：`docs/plans/evidence/2026-09-17-blind-review-cleanroom-intake/README.md`（時間線、MiniMax／GLM 工具病、claude 🟡 修補 `af1879cb`、§5 dogfood、resume rail 缺陷）。
- **1c plan**：`docs/plans/2026-09-17-blind-review-packet-deny-config.md`＋`.rubric.md`（DRAFT；§0 行號以 `130b97a8` 校對，plan loop 前用 `d7912c7e`…`f15e9e1e` 之間的 HEAD 再校對一次、Base 釘 release commit）。範圍：`review_packet_deny_extra`（additive、單一 grammar owner＝`normalizeDenyList`、resolver conditional 欄位如 `qc_panel_endpoints`、engine `reviewPacketIdentity` 收 `denyExtra`、review.js 合成 effective list；builder／rail／launcher／intake byte-identical）。manifest／brief／freeze 尚未寫（抄 1b-B 的：`evidence/…-intake/scratch/{run-g.sh,dispatch.sh,freeze-c1d.js}`＋`impl-brief.md`）。
- BACKLOG 新 open rows（多數已 fired；openclaw row 等 cookys 點頭）：final panel 無 repair 迴圈（1b-A）、**reviewer no_verdict 留 REVIEWING 不能 resume**（1b-B，rail 缺陷）、codex pin swap 等 live cleanroom verdict（09-19 16:26 後）、dispatch-review cleanroom path hygiene（S）、openclaw ruling relay（要 cookys 點頭）。
- codex 額度 2026-09-19 16:26 回來後：plan §5 尾段——`cleanroom-launch.sh --profile codex` 對真 packet 拿 parsed verdict → `engine-capability-state.js pin-seat --role qc_panel --engine gpt-5.6-sol --runner codex --effort max …`＋`review-loop-config.md qc_panel[0]` 換回；也可讓 consult 席回 codex。

## 已決事項(不重議)
- 承接上版全部。1c＝additive deny-list（不能拿掉預設）、一個 grammar owner、conditional 欄位不動 `x-field-order`。
- 兩個 in-rail／二審工具病（MiniMax tautological、GLM END 後多字）都不算票；換席補乾淨判決（claude-native）。
- record-integration 要在 reap branch **之前**（需要活 ref）；做反了就從 `.git/autopilot-reap-bundles/` 的 bundle `git fetch <bundle> refs/heads/<b>:refs/heads/<b>` 還原再 record 再刪。

## 下一步（順序）
1. 1c campaign 收尾：等 `impl-run1.err` 出 `rc=`；rail 停了就照 1b-B 路徑（降級 l3、驗候選九條、二審 full diff、§5 dogfood、修 MUST-FIX、delta 複審）→ merge → v2.36.64。
2. campaign 跑時：起草 cut 2（verify-once、並行席）或處理 BACKLOG fired rows。
3. 收尾同 1b-A／1b-B（驗候選、二審 full diff 不加路徑、§5 dogfood、merge trailer 末段、`sync-version.js --version 2.36.64 --hook-count 31 --skill-count 30`、CHANGELOG／INDEX／maintenance／BACKLOG、**record-integration → reap → receipt → retire**、preflight 8/8、push）。

## 驗證方式
- `git fetch -q origin && git status -sb` → `## develop...origin/develop`。
- `node scripts/session-mode.js status --repo-root "$PWD"` → `"active": false`。
- `git worktree list` 只剩主 checkout（`7ef6560a…/baseline` 是別的 session 的，別動）；`git branch --list 'mission/*'` 空。

## Read-order
1. `docs/plans/2026-09-17-blind-review-packet-deny-config.md`＋rubric。
2. `docs/plans/evidence/2026-09-17-blind-review-cleanroom-intake/README.md`、`scratch/`（配方）。
3. `skills/l5/references/hetero-impl-loop.md` Depth-0 recipe。
4. `docs/BACKLOG.md` open rows（上面列的）。

## 陷阱
- **frozen rubric 一字不動**；receipt 用被審那版 bytes；G2 要 `--disposition-file <g1-dispositions.json>`（`generation: 1`），漏了 rc=3 不派。
- disposition 詞彙：`accepted_blocker`／`accepted_nonblocking`／`deferred`／`rejected`（沒有 `accepted`）。
- **二審 diff 不加路徑**；reviewer 說格式錯先查 pre-commit（CLAUDE.md 800 B 行）。
- zsh：`echo ===` 炸、`$PIPESTATUS` 要 bash、**`"$B:refs/…"` 會被 `:r` 修飾子吃掉**（用 `${B}:` 或 bash -c）；`load-endpoints-env.sh` 包 `bash -c`。
- 套件一次一個；長工作 setsid nohup＋Monitor（30 分鐘會過期要重掛）；scratchpad 隨 session 消失——產物先進 repo。
- campaign 跑中 repo tree 要乾淨（intake 拒 dirty tree 燒 attempt）；rail 停了才動 tree。
- reaper root-run-id 給 campaign_id（`impl-run1*.json` `campaign_control.campaign_id`）。
