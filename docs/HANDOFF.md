## 目標

實作已核准的「資格判定穩定性重設計」plan(`docs/plans/2026-08-29-qualification-verdict-stability.md`,D0–D8),再收尾 consult/discuss qualification campaign。

## 現況(2026-08-30)

- Branch `develop` @ `09485468`,乾淨,與 origin 同步。版本 v2.35.2(D8 才 bump 2.35.3)。
- **Phase 1 = D0+D1+D2+D3 已 merge**:`1d91a6f4`(grok-4.5 實作)+ `365ee37c`、`6a3620a1`(qc 驅動的兩個修復)。sealed grader 位元組不變(consult `7852cf33…` / discuss `39b5ba15…`)。
- **D1 store 操作已執行**:兩份 `.bak-verdict-redesign-2026-08-30` 備份 sha256 已驗;events 157–165 各一個 `record_kind:"supersession"` 標記已 append(9/9);原始行位元組不變。reader 尊重標記是 D5。
- **depth-0 qc panel 三席裁決**與所有 finding 處置寫在 plan 檔尾「Phase 1 execution record」。
- **Mission lineage**:`420ac261…`(單節點、campaigns=8、gate budget 12)已 prepare,campaign 1 已用(未能 terminal),2–8 未用。舊 lineage `83828e5e…`(有一個永遠 live 的 claim)與 `2e784929…` 是 inert 殘留。
- 殘留分支(可刪,已無用途,留作 salvage 歷史):`mission/420ac26112ac/…-a1`(=1d91a6f4)、`mission/83828e5e60c1/…-a2`(102fd0ed)、`…-a3`(367d41c7)。
- session marker 目前是 **l5**(不是 l6,見陷阱)。
- 盲測 VA harness(Qwen)在 scratchpad:`qualification-tier-mapping.test.sh` sha256 `c01b1be6…`,五個 harness 側錯誤待修後才能進樹(D6)。scratchpad 是 session 專屬,下個 session 拿不到——要用就從 plan 記錄的期望重生成。

## 已決事項(不重議)

- 上個 handoff 的全部裁決仍有效(雙層/Wilson/z=1.645/τ=0.85/不動 grader/supersession 契約/PATCH)。
- **codex 🔴「STEP-1 不遞迴/C5 繞過/lure id」降為 🟡**:C5 免掃是 seam 與 plan 明文;consult 無 lures;discuss grader 本身接受 lure id;嵌套假 artifact_ref 在未宣告欄位是 plan 表的 tier2。不重審。
- **VA harness 五個殘紅是 harness 側**:caseSpec 真形狀 `bundle.artifacts[]`;多訊號取 seam 列表第一個(verdict_token_present 先於 tokens_outside);bound 只掃不拒。
- **Phase 1 走「depth-0 qc + 獨立重跑」而非 Mission terminal receipt**——使用者選 B(2026-08-30),偏差已記在 plan 與 BACKLOG。

## 下一步

1. **先修 rail 或先做 D4?** Mission-managed rail 在本 repo 有六個缺陷(BACKLOG 2026-08-30 列),其中「`hooks/tests/run.sh` 在 develop 紅(≥7 套件)→ sealed verify_cmd 不可滿足」會讓**任何** campaign acceptance_failed。不修它,D4–D8 每段都得重演 salvage 舞步。建議:先派一個 Fix 單位三角那 7 個紅套件 + 修 `autopilot-engine.js:6477` lease fence + `bin/autopilot.js:396` 接受 l6;再回來跑 D4。
2. D4(verdict 引擎,fail-only sequential + `(Z,TAU)` 一處釘)→ D5(supersession reader 尊重 + 額外 schema)→ D6(精確二項 OC oracle + 盲 harness 進樹)→ D7 文件(**不花錢**)→ D8(mirror/CHANGELOG/2.35.3)。
3. D7 真金重跑前**停下問使用者**。

## 驗證方式

```bash
git status --short                                       # 乾淨
bash hooks/tests/engine-qualify-verdict-stability.test.sh # D1–D3 套件 PASS
bash hooks/tests/engine-qualify-consult.test.sh           # PASS
bash hooks/tests/honest-consult-discuss-solver.test.sh    # 16 PASS
sha256sum evals/consult-eval-grader.js evals/discuss-eval-grader.js   # 7852cf33… / 39b5ba15…
grep -c '"record_kind":"supersession"' ~/.autopilot/engine-scorecard/scorecard.jsonl   # 9
node scripts/session-mode.js status | head -8            # level l5
```

## Read-order

1. plan 檔尾「Phase 1 execution record」段。
2. `docs/BACKLOG.md` 2026-08-30 的六列(rail 缺陷)。
3. memory `l6-managed-campaign-gotchas.md`。

## 陷阱

- 見 memory `l6-managed-campaign-gotchas.md`:marker 與 `AUTOPILOT_LEVEL` 都要 l5;`AUTOPILOT_ROOT_RUN_ID` = contract 的 `mission_runtime.root_run_id`;implementer 測試只能落 `strict_dispatch.output_paths`;campaign ≤ 1 小時;每次 grant 燒一個 gate attempt。
- 圖改一次就鑄一條新 lineage(requirements_hash 含 graph digest),舊的無法 withdraw。
- sonnet 子 agent 會把 SendMessage 的追加指令當注入拒絕——追加工作用清楚的主體聲明重送。
- 推 develop 觸及 protected path 需要 `QC-Verdict:` trailer 與 Co-Authored-By 同末段。
