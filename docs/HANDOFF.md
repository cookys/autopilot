## 目標

「managed-campaign rail 債」四條（BACKLOG 2026-08-30 的 a/b/c/d）**已全部落地並出貨 v2.35.5**（merge `d5408f5e`）。沒有進行中的工作；下個 session 是清 BACKLOG 裡剩下的小債，或開新題目。

## 現況(2026-08-31 交接)

- Branch `develop` @ `0b8fa6b3`，**乾淨、與 origin 同步**，版本 **v2.35.5**（release `45ea97e5`，merge `d5408f5e` 帶 `QC-Verdict: PASS` trailer），preflight 8/8。零殘留 worktree、零本案分支（刪前已 `pin-evidence-anchors.js apply --exclude-ref …`，刪後 scan `unreachable:0`、anchors 87）。session marker 已 clear。
- **出貨內容**：U1 `campaign terminalize` + `mission withdraw`（證據閘控、六種具名拒絕、summary 可補寫）；U2 recipe 憑證 staging sha256 戳記重播 + plan 模式拒偏移（14 份 run.sh + 新 `scripts/lib/qualify-stage-credentials.sh`）；U3 wall cap 3600→14400（5 處 JS/schema 鏡像同步）；U4 `mission grant` 對 open claim 改 `attempt_blocked_by_open_claim`（HEAD==base_sha 才 exact-replay）。
- **品質鏈**：每單元 codex gpt-5.3-codex-spark 實作、fixture 先紅後綠、三席 hetero qc（sol/GLM/MiniMax）批次 SHIP-AS-IS、最終 autopilot:reviewer 4 個 MUST-FIX 全修。完整 ledger 在 `docs/projects/_archive/2026-08-31-managed-campaign-rail-debt/README.md`。
- **殘留**：`stash@{0}`（evidence-discipline §20/§21 草稿）是**更早 session 的，別動**。`git branch` 還有一批舊 `worktree-agent-*`／`fix/*`／`verify/d6` 分支，屬先前 session，非本案，未清。

## 已決事項(不重議)

- 治理 shadow 繞道只限修 rail 的分支且 merge 前必還原——已還原 byte-identical（`git diff` 對 merge-base 為空），Board 決策記在 archive README。**不要**因為 enforce 擋 raw dispatch 就再翻治理檔；那是每次都要 Board 的決定。
- U3 上限 14400（4h）與 U4「不動 reducer、在 runtime.js 擋」都經 qc 三席審過——不重議。
- 測試 `--now` 一律跟 `record` 的 UTC 戳記同源 `$(date -u +%F)`；釘死日期是跨日炸彈（正向會紅、負向會空洞化）。

## 下一步

1. **沒有必做項**。要接債就從 `docs/BACKLOG.md` 挑：新增的「v2.35.5 qc 🔵 follow-ups」列（四項 XS–S：cli.js 縮排 churn、plan 拒絕的 set -e e2e、cmdX emit 統一、run-ledger --help 印原始碼）；或 U4 記的 `mission-subject-v2` ↔ ICC `campaign-v1` claim-id 不匹配（withdraw 放不掉 v2 claim）；或大條的「Engine/CLI 無 session-mode fallback」不對稱（已兩次實證）。
2. Mission registry 三條 inert lineage（2e784929/83828e5e/420ac261）現在**有工具可收了**：`campaign terminalize` + `mission withdraw` 就是為它們造的——拿真 registry 收尾兼當 dogfood（先備份 state 檔）。

## 驗證方式

```bash
git status --short                          # 空
grep '"version"' .claude-plugin/plugin.json # 2.35.5
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh  # 8/8
bash hooks/tests/campaign-terminalize.test.sh && bash hooks/tests/mission-grant-open-claim.test.sh  # 6 + 11 PASS
```

## Read-order

1. /home/cookys/projects/autopilot/docs/projects/_archive/2026-08-31-managed-campaign-rail-debt/README.md — 全案 OKR/ledger/偏差/qc 裁決。
2. /home/cookys/projects/autopilot/docs/BACKLOG.md — 剩債（qc 🔵 follow-ups、v1/v2 claim-id、enforce-gate 不對稱）。
3. /home/cookys/projects/autopilot/CHANGELOG.md — v2.35.5 節，出貨行為總表。

## 陷阱

- raw `dispatch-hetero.sh` 在 governance `enforce` 下**必拒**（無旁路旗標）；shadow 期間 strict fixture（autopilot-cli、mission-routing-admission）會假紅——fixture `git clone` 帶到已提交的治理檔，還原即自癒。
- 工頭 brief 必帶 ⛔ hand-author=升級硬條款，否則 sonnet 會自判引擎不適任親手做（本案 U2 第一版因此退件重做）。
- 背景工頭會停車等自己的 leaf 不被喚醒：depth-0 掛 `until ! kill -0 <pid>` 等待器＋SendMessage 喚醒（配方在 memory `background-agent-parking-worktree-traps`）。
- `hooks/tests/run.sh` 從 live session 的主 checkout 跑，`context-window`/`dispatch-author-claude-native` 兩套可能假紅（fresh worktree 綠）——判紅前先在乾淨 worktree 重跑。
- 其餘全在 memory `l6-managed-campaign-gotchas.md`（主文＋三段 addendum）。
