## 目標

「資格判定穩定性重設計」plan(`docs/plans/2026-08-29-qualification-verdict-stability.md`,D0–D8)**已全部落地(v2.35.3)且 D7 真金重跑已執行(v2.35.4)**。沒有進行中的工作;下個 session 只需要做「殘留清理 + BACKLOG 裡的 rail/recipe 債」——或開新題目。

## 現況(2026-08-30/31 交接)

- Branch `develop` @ `eea5a919`,**乾淨、與 origin 同步**,版本 **v2.35.4**(`4ca5c9c4`),preflight 8/8,全套 `hooks/tests/run.sh` **303/303 綠、零 TIMEOUT**。無殘留 worktree。
- **D7 結果**(events 176–185,每列 `wilson_lower` 已由 depth-0 重算):7 PASS(gpt-5.6-sol、MiniMax-M3、kimi-code/k3、Qwen3.8-Max、grok-4.6、claude-fable-5 consult;gemini-3.7-flash-high discuss)/ 2 FAIL(GLM-5.3 consult 真 Tier-1;gpt-5.6-sol discuss `locked_fail`)。三個單次翻盤席全部平反。ledger:`docs/plans/evidence/2026-08-29-verdict-stability/ADMINISTRATION-LEDGER.md`。
- **真店狀態**:`~/.autopilot/engine-scorecard/scorecard.jsonl` 59 列;events 157–165 已 superseded(D1 標記),175 已 superseded(177,儀器缺陷作廢);備份 `*.bak-verdict-redesign-2026-08-30`、`*.bak-d7-2026-08-30`、`scorecard.jsonl.bak-d7-void175-2026-08-30` 都在原目錄旁。
- **殘留(可清,非必要)**:6 條 `mission/*` 分支(a1–a4 與 83828e5e 的 a2/a3,皆已 merge 或作廢);`stash@{0}`(rail-fix 期間為 bootstrap agent 救回的 WIP,內容已 merge,可 drop);`stash@{1}` 是更早 session 的 evidence-discipline §20/§21 草稿,**不是本 session 的,別動**;Mission registry 下三條 lineage(2e784929 DRAFT、83828e5e ACTIVE 含永遠 live 的 claim、420ac261 用了 4/8 campaigns)為 inert 殘留。
- session marker `l6`,2026-08-31T01:51Z 自然到期(沒有 `can_close` receipt 可清——rail 缺陷,已記)。

## 已決事項(不重議)

- 判定設計全部裁決(雙層 / Wilson z=1.6448536269514722、τ=0.85 / 不動 sealed grader / supersession 契約 / PATCH)有效且已出貨。
- Mission-managed campaign 沒有一個靠自己的 terminal receipt 收尾;merge 權威 = depth-0 三席 hetero qc + 獨立重跑(ADR-0001),每段偏差記在 EXECUTION-LOG。**不要**為了「補 receipt」重跑任何 campaign。
- 執行紀錄寫 `docs/plans/evidence/<plan>/EXECUTION-LOG.md`,**不進 plan 檔**(sources manifest 綁 plan 內容)。
- D7 已執行且授權已用完;再施測任何席要新的授權,且先修 recipe 的 staging credentials 陷阱。

## 下一步

1. **沒有必做項**。若要清殘留:`git branch -D $(git branch --list 'mission/*')`;`git stash drop stash@{0}`(只 drop @{0})。
2. 想接著做 rail 債,從 `docs/BACKLOG.md` 2026-08-30 的列挑:優先 (a) dead campaign 的 terminalize/claim 釋放 + `mission withdraw`、(b) `mission grant` 對 open claim 的 replay 假綠、(c) recipe staging credentials 無條件重播、(d) wall cap 3600s 是 schema 上限。每一條都有 file:line 與事故編號。
3. 若下個題目要用 /l5 或 /l6:先讀 memory `l6-managed-campaign-gotchas.md`(含兩段 addendum),再派工。

## 驗證方式

```bash
git status --short                                            # 空
grep '"version"' .claude-plugin/plugin.json                   # 2.35.4
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh # 8/8
bash hooks/tests/engine-qualify-verdict-stability.test.sh     # 54 PASS(約 100s)
for e in MiniMax-M3:cc-shim gemini-3.7-flash-high:agy:discuss; do IFS=: read en ru ro <<<"$e"; node scripts/engine-scorecard.js seat-status --engine $en --runner $ru --role ${ro:-consult}; done   # qualified,baseline 178 / 181
```

## Read-order

1. `/home/cookys/projects/autopilot/docs/plans/evidence/2026-08-29-verdict-stability/EXECUTION-LOG.md` — 整個 campaign 逐段做了什麼、qc 裁決、偏差。
2. `/home/cookys/projects/autopilot/docs/plans/evidence/2026-08-29-verdict-stability/ADMINISTRATION-LEDGER.md` — D7 九席結果、作廢紀錄、花費實數。
3. `/home/cookys/projects/autopilot/docs/BACKLOG.md`(2026-08-30 各列)— 剩下的 rail/recipe 債。

## 陷阱

- 全部已路由到 memory `l6-managed-campaign-gotchas.md`(主文 + addendum 1/2)與 BACKLOG;此處只留指標:marker level 與 `AUTOPILOT_LEVEL` 要相等;`AUTOPILOT_ROOT_RUN_ID` = contract 的 `mission_runtime.root_run_id`;implementer 只能改 `strict_dispatch.output_paths`;grant 對 open claim 是 replay;worktree 子 agent 共用 stash;MiniMax review 常 `no_verdict`、Qwen 授權 rail 常 55-byte 假綠;`engine-qualify --execute` 的 `--store` 要給 canonical 目錄;`record --supersede-provisional` 要 `</dev/null`。
- 推 develop 觸及 protected path 需 `QC-Verdict:` trailer 與 Co-Authored-By 同末段。
