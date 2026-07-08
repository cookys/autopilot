# HANDOFF — /l6 全委 campaign 結案快照(2026-07-09)

> 取代 2026-07-08 版(該系列已結案)。由 session 31d0d311 於 campaign 完成後寫入。
> 機械快照另有 `handoff_inject` hook 於 /clear 時自動寫入 ~/.autopilot 並於下個 session 注入。

## 目標
2026-07-08 起的 /l6 全委 campaign:依序清完前一版 HANDOFF 的四個「下一步候選」。**全部完成 shipped + pushed**:v2.32.8 → **v2.32.11**。本 handoff 供下個 session 認路,無 in-flight 工作。

## 現況
- develop = origin(`a82135d`),工作樹乾淨,**零**工作分支、零 worktree 殘留
- 四個任務全 merge:T1 min_panel_size(v2.32.9)、T2 t14 --reinject(v2.32.10)、T3 m3-band tasks(no-bump)、T4 red-green 儀器(v2.32.11)
- preflight-release 8/8;reviewer scorecard 六家族 qualified 不變(opus/sonnet/gpt-5.5/MiniMax-M3/grok-build/GLM-5.2)
- **codex quota 耗盡至約 2026-07-15**(memory 已記):默認 /l5/l6 implementer + gpt-5.5 reviewer 都受影響;改道 grok / cc-shim glm|minimax

## 已決事項(不重議)
1. **每個任務的執行形狀**:depth-1 foreman(worktree 隔離)跑 hetero implementer(engine implement-review 或直接 dispatch-hetero)→ depth-0 親跑產物 + 三家族權威 qc panel(opus + MiniMax-M3 + GLM,皆與 implementer 去相關)→ union-on-verified-critical 合成 → depth-0 簽 merge。Fable/Opus 只決策/裁定/簽核,勞務全委派
2. **兩個誠實負面結果(不要當失敗掩蓋,是知識)**:(a) t14 逐輪重注入 3/15 vs baseline 1/18,Fisher p=0.234 不顯著,與 prose pack 打平 → 移動詞彙非行為;(b) 新造的「更難」單輪任務 M3 仍天花板 18/18 → 單輪對 M3 是死路,判別在 long-horizon
3. **qc panel 非橡皮圖章**:T3 opus 席位用實跑 cheat 提交證明三個 oracle 全可被遊玩(4 條 false-PASS),硬化後獨立重攻確認全封 + 固化回歸。這是本 campaign 最高價值時刻
4. **foreman 是 quota-fragile 環節**:T2/T3 foreman 各撞一次 model limit 中途死亡,但實作已 commit 到分支 → 從 artifact 軌恢復,零工作丟失。長批次量測要移出 foreman context,由 depth-0 resumable batch 跑
5. 成本紀律(user 逐字重申):Fable 很貴,只做決策/簽核;報告/分析→sonnet、qc lens→opus、實作→hetero engine

## 下一步(候選,無承諾順序)
1. **verify_strength Segment 2**(BACKLOG L428+):真實測試套件「驗證強度」評分器(red-green 前置已於 T4 交付)。Effort M-L
2. **verify_strength Segment 3**:`resolve-review-loop.sh` 消費 `verify_strength` 作第三密度軸(additive,fail-safe unknown⇒最弱⇒最多審查)。依賴 Segment 2。Effort M
3. **M3-band 判別要往 long-horizon**:單輪已證死路(T3);要量 M3 的 pack/procedure lift 需 t14 型多輪任務,或把 t15-t17 難度再推高
4. **M3-band fixtures process-isolation**(BACKLOG L508):若這三個 fixture 供對抗性 implementer(/l5/l6)重用,需候選呼叫跑在分離 subprocess(in-process introspection 否則可打穿)。Effort L

## 驗證方式
- `git log origin/develop --oneline -12` — 應見 T1-T4 的 merge/feat commits 至 `a82135d`
- `AUTOPILOT_SKIP_SLASH_PROBE=1 ./scripts/preflight-release.sh` — v2.32.11 應 8/8
- `bash hooks/tests/verify-red-green.test.sh`(16)+ `hooks/tests/orchestration-eval-m3band.test.sh`(15,含 4 poison 回歸)+ `hooks/tests/resolve-review-loop.test.sh` 應全綠

## Read-order
1. `~/.claude/projects/-home-cookys-projects-autopilot/memory/MEMORY.md` — codex-quota 條目 + dispatch model discipline
2. `docs/projects/2026-07-09-m3-band-tasks/report.md` — M3 天花板負面結果 + oracle 遊玩性/硬化/N2 殘留全史
3. `docs/projects/2026-07-08-t14-reinject/report.md` — 重注入量測(p=0.234)
4. `docs/plans/2026-07-09-verify-strength-precursors.md` — verify_strength 三段拆解 + red-green 已知限制
5. `docs/BACKLOG.md` L428+ / L508 — 兩個新軸的立案條目

## 陷阱
- **共用 checkout**:多 session 並行過(本 campaign 期間鄰 session 有 release-writer/plan-review 等 teammate 在跑);review diff 必須 path-scoped(`git diff base..HEAD -- <file>`);判分支歸屬先 `git log develop..<branch>`
- **被殺的 foreman ≠ 工作丟失**:先查分支 commit(artifact 軌),從 run-ledger resume 或親跑接手
- **verify-cmd / calibration runner 一律寫成 script 檔**傳路徑(嵌套引號碎 argv)
- **batch resume-skip 鍵在 per-cell 目錄,不只 jsonl**:換 oracle 後要 `rm -rf runs/` 全清,否則跑舊產物(本 campaign 踩過)
- **`grep -c ... || echo 0` 會 double-count**(grep-c 無 match 印 0 且 exit 1 → fallback 再印一個 0);用 `x=$(grep -c ...); x=$((x+0))`
- **MiniMax dispatch-review 偶爾漏 verdict wrapper** → no_verdict fail-closed,重試即可(非真失敗)
- **codex 至約 7/15 不可用** → hetero dispatch 改道 grok / cc-shim glm|minimax;先 `endpoints doctor --json` 存活檢查
- 版本號先 `git fetch` 查撞車;新 script=PATCH、純 fixtures/docs=no-bump
