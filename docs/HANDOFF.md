## 目標

「資格判定穩定性重設計」plan(`docs/plans/2026-08-29-qualification-verdict-stability.md`,D0–D8)**已全部落地(v2.35.3),D7 真金重跑亦已執行完畢(v2.35.4)**。剩下的只有 rail 與 recipe 的殘餘缺陷(BACKLOG)。

## 現況(2026-08-30 結案,含 D7)

- `develop` 與 origin 同步;版本 **v2.35.4**(`4ca5c9c4`);preflight 8/8;全套 `hooks/tests/run.sh` 綠。
- **D7 已執行**(user 授權 2026-08-30):九席匯總施測 **7 PASS / 2 FAIL**(events 176–185;GLM-5.3 consult 真 Tier-1、gpt-5.6-sol discuss `locked_fail`),三個單次翻盤席(Gemini、MiniMax、Qwen)全部平反;每列 `wilson_lower` 由 depth-0 重算一致;ledger 在 `docs/plans/evidence/2026-08-29-verdict-stability/ADMINISTRATION-LEDGER.md`。真錢施測抓出並修掉 reason-recovery 的 undefined-gates 缺陷(`95a8a8af`,event 175 superseded by 177);wall 預算改為 ×施測次數(`5a168fb9`)。
- D1–D8 全部 merge:D1–D3(`6a3620a1`)、D4(`e6b5f171`)、D5(`1a7e42f4`)、D6(`8a8a5bd2`)、D7/D8 文件(`80693f7e`/`0af7b5f5`)。每段的 qc 裁決、修復 sha、獨立重跑結果都在 `docs/plans/evidence/2026-08-29-verdict-stability/EXECUTION-LOG.md`。
- **D1 閘門在真店生效**:九席 consult/discuss(events 157–165)`seat-status` 全 `no_record`;備份在 `~/.autopilot/engine-scorecard/*.bak-verdict-redesign-2026-08-30`。
- OC 特徵:`OC-CHARACTERIZATION.md`——精確二項 oracle(p* 0.922585 consult / 0.924032 discuss)、n=3000 模擬 power 表、rejected calibration、D7 協定(**未授權花費**)。
- Mission lineage `420ac261…`:gate attempts 用 4/12、campaigns 4/8,claim 全已釋放;`2e784929…`、`83828e5e…` 為 inert 殘留。session marker 為 l6(今天修好 bootstrap 後可用)。
- 殘留分支:`mission/420ac26112ac/…-a1..a4`、`mission/83828e5e60c1/…-a2/a3`(歷史,可刪)。

## 已決事項(不重議)

- 上兩份 handoff 的裁決全部有效。
- Mission campaign **一次都沒靠自己的 terminal receipt 收尾**:merge 權威 = depth-0 三席 hetero qc panel + 獨立重跑(ADR-0001),偏差逐段記錄。
- qc 裁決紀錄:codex 對 D3 的 🔴 降 🟡;D6 的角色 parity 用 kernel 原始碼位元相等視為足夠;D4 harness 的 `discuss-44p4t` 標籤放寬(completion 與 locked_fail 重合)。
- 執行紀錄**不得**寫進 plan 檔(sources manifest 綁 plan 內容)。

## 下一步

1. D7 已完成;若要再施測任何席,先修 recipe 的 staging credentials 陷阱(BACKLOG 2026-08-30)。cursor 席不考。
2. Rail 殘餘缺陷(`docs/BACKLOG.md` 2026-08-30 列):wall cap 3600s 是 schema 上限、dead campaign 無法 terminalize/釋放 claim、`mission grant` replay 假綠、VA rail 非空即 authored、agy/cc-shim VA 席過不了精確 tuple 閘、`mission withdraw` 缺席。下次 /l5 或 /l6 前先看這些有沒有出貨。
3. 可選:把 `qualification-tier-mapping.test.sh`(盲測 D4 harness)的名字改成反映內容(D3 tier-map 盲測已被它取代)。

## 驗證方式

```bash
git status --short                                             # 乾淨
grep '"version"' .claude-plugin/plugin.json                    # 2.35.4
bash hooks/tests/engine-qualify-verdict-stability.test.sh      # 44 PASS(約 100s)
bash hooks/tests/qualification-tier-mapping.test.sh            # 11 PASS
bash hooks/tests/capability-evidence.test.sh                   # PASS
sha256sum evals/consult-eval-grader.js evals/discuss-eval-grader.js   # 7852cf33… / 39b5ba15…
for e in MiniMax-M3:cc-shim kimi-code-k3:kimi; do node scripts/engine-scorecard.js seat-status --engine ${e%%:*} --runner ${e##*:} --role consult; done   # qualified, baselines 178 / 182 (pooled rows)
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh # 8/8
```

## Read-order

1. `docs/plans/evidence/2026-08-29-verdict-stability/EXECUTION-LOG.md`
2. `docs/plans/evidence/2026-08-29-verdict-stability/OC-CHARACTERIZATION.md`
3. `docs/BACKLOG.md` 2026-08-30 列;memory `l6-managed-campaign-gotchas.md`

## 陷阱

- 見 memory `l6-managed-campaign-gotchas.md`(含 addendum):grant 對 open claim 是 replay;plan 檔綁 digest;worktree 共用 stash;MiniMax `no_verdict` 重跑一次;Qwen 授權 rail 55-byte 假綠。
- 推 develop 觸及 protected path 需 `QC-Verdict:` trailer 與 Co-Authored-By 同末段。
