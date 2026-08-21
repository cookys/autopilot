## 目標

**北極星**(ADR-0001):強模型治理 = 管 outcome/evidence 不管 process。本 session(2026-08-20→21,
"autopilot@aimax395")完成了 option B 全弧 + TaskCreate 平台斷供三層修復 + P6D 事故矯正工程。
CEO 模式已授權:「需要問我的自主問 heto 後繼續,一路做到底」——此授權止於本 session,新 session 重新確認。

## 現況

- Branch:`develop`,乾淨,已推 origin(`86989214`,**v2.34.32**)。無 active project、無 stash、無殘留 feature branch。
- 全套件綠:267 檔(reviewer 獨立跑 245-suite EXIT=0 佐證)。preflight 8/8(v2.34.32)。
- Task list:#17-31 全 completed(p6d L 的完整 forcing-function 樹,含 finish-flow 7 子任務)。

### 本 session 出貨(時序)

| 版本 | 內容 |
|---|---|
| **v2.34.23** | **TaskCreate 平台斷供發現與修復**:CC ≥2.1.233 對 5 世代模型(Opus ≥4.8/Sonnet ≥5/Fable ≥5)預設關掉 task 工具(statsig `tengu_rosy_wren`,changelog 未載)→ dev-flow 全部 forcing function 生產靜默 no-op。binary 差分定位、A/B/C 三臂驗證官方桿 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`;repo `.claude/settings.json` env 釘住(gitignore 政策一併修)+ dev-flow L-1.6 錨點 advisory。全機 `~/.claude/settings.json` 也已釘(user 授權)。 |
| **v2.34.24** | onboard scaffold 鋪 env 釘(merge-safe `ensureSettingsEnvPin`,顯式值尊重、壞 JSON 不碰、gitignore 陷阱警告);兩份 README Install 告知框。 |
| **v2.34.28** | G1 transport 事故三承諾:`probe-todo-tools-pin.js`(單呼叫迴歸探針)、normalize exit-first(timeout 不再偽裝 raw_binding_mismatch)、`plan-review-timeout.js` effort 分級席位預設(max/xhigh 20m)。 |
| **v2.34.31**(讓號 29→30→31 ×2)| **plan-review PANEL 層可觀測性**:panel manifest 每席轉換 + `dispatch-status --panels/--panel`(owner_alive 三態、in_flight_stale 降級)。兩輪 review、六突變全紅。 |
| **v2.34.32** | **P6D 矯正,四連縮小**(3 閘→ladder-first→1.5 閘→無狀態 1.5 閘):KR3 無狀態 repair ladder(`terminalizeManagedCampaignFailure` 邊,generation-claim git-bound `resume_candidate` 前置,雙向突變釘死)+ KR2 staged manifest 閘(`check-disjointness --staged` 含 ita + dispatch-hetero wrapper staging 攔截)。兩代 plan review + 三輪 pre-merge review(sol 設計諮詢 Option D 亦存證)。 |
| (docs) | multiturn-event-harness campaign:R2' 凍結 → Phase A 零成本考古(766 檔 3 合格:m2/m3/m4 各 2/3 observed、m1 1/3 insufficient)→ Board 收案於 Phase A,0 live call。evidence-discipline §12(mtime≠record ts)+ §13(幽靈形狀 fixture 雙向釘定)。 |

## 已決事項(不重議)

- **儀式型假設已答**:單回合三臂近零 = 考場視野缺陷;生產多回合 FULL session 中 plan/README/FF-task 各 2/3 出現(`_archive/2026-08-20-multiturn-event-harness` 已歸檔?未歸檔——見陷阱)。card 問題維持 G2 終局,重開 = Board 決定。
- **P6D durable repair-lock 被 review 處決**:解鎖路不可達 = 永久死鎖(「用治理武裝的過度治理」= P6D 病鏡像)。重入六前置在 BACKLOG「Durable repair-lock」條目,缺一不可。
- **KR1(contract-first 閘)連 shadow 都不出**:述詞(output_paths+verify cmds)是萬用契約形狀,G1/G2 三席否證;class (a) 留 BACKLOG 觸發(有效述詞存在前不得出貨)。
- **recorded-ref 不算可修復候選**(R2 裁決):只認 generation-claim 的 git-bound `resume_candidate`,否則重演 no-git-object livelock。
- **並行 session 讓號制**:後推者讓號;push 前先 `git show origin/develop:.claude-plugin/plugin.json` 查 canonical(memory 有檔,本 session 應驗三次;對方 8/21 也自撞一次 v2.34.31——CHANGELOG 現有兩節 v2.34.31,是**他們的**債,別「修」)。
- 到期提醒不阻擋、驗證優於 attestation(ADR-0001)、不建 invocation enforcer——全部照舊。

## 硬事實(實測定住)

- task 工具 gate 是**模型世代**不是 runtime:env 釘下 headless `-p` 兩通道全開(tool_use + tasks JSON)。8/18「headless 無 task 工具」已 SUPERSEDED(portability row 有 dated 修正)。
- `dispatch-plan-review` 預設 `--timeout 5m` 會殺 max/xhigh 席(現已 effort 分級,但顯式給 20m 仍是好習慣);timeout 席曾被誤分類 `raw_binding_mismatch`(已修 exit-first)。
- dispatch-hetero 新函式必須加進 detached-child `declare -f` 名單(`:3713`),否則分離路徑 command-not-found 靜默跳過——本 session 踩過。
- 大檔 python 手術會意外複製千行(hoisting 掩蓋)——mission-convergence 曾 +1256 行零行為差,靠 reviewer 空 diff 驗證抓回。
- reviewer(sol/gpt-5.6-sol)qualified 且極能打:三輪抓 4 枚真 🔴。五席同卷官方表:sol + Gemini 3.7 Flash 雙滿分 qualified;MiniMax M3 degraded(26/42、15 FP)——用其 findings 需三席收斂佐證。

## 下一步(依序)

1. **`/next` 重掃**。已知佇列:BACKLOG met-trigger 殘項——panel 聚合視圖已清;剩:不信任投票(M)、claim_id 解耦(M)、roster implementer/explorer legs(L)、考券官方預設(L,已有五席同卷第一份數據)、Durable repair-lock(L,六前置)、panel-view residuals(S×5,事故觸發)。
2. multiturn-event-harness 無 project dir(plan 級 campaign,已於 plan+evidence 收案)——無歸檔待辦;`docs/projects/` 進行中表應為空(驗證:INDEX 進行中節)。
3. reviewer R3 殘餘 cut items(六 🔵,任一事故化即提升)。

## 驗證方式

```bash
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh   # 8/8 (v2.34.32)
bash hooks/tests/run.sh --parallel 8                             # ALL TESTS PASSED (267)
bash hooks/tests/p6d-gates-repair-ladder.test.sh                 # 21 node + 2 shell
bash hooks/tests/p6d-gates-manifest.test.sh                      # 13
node scripts/probe-todo-tools-pin.js                             # {"observed":"present","ok":true}(1 live call)
node scripts/dispatch-status.js --panels                         # panel 可觀測性
```

## Read-order

1. `docs/projects/_archive/2026-08-21-p6d-corrective-gates/README.md` — P0(a) 凍結矩陣 + GO 紀錄 + 處置附記
2. `docs/plans/2026-08-21-p6d-corrective-gates.md`(R2' FROZEN + Shipped 戳)— 哪些路走不通
3. `docs/plans/evidence/2026-08-21-p6d-corrective-gates/g2-adjudication.md` — 終局裁決
4. `references/evidence-discipline.md` §12/§13 — 本 session 兩個新失效亞種
5. `docs/BACKLOG.md`「Durable repair-lock」條目 — 鎖重入的六前置(reviewer 五探針證據)
6. `docs/plans/evidence/2026-08-20-interactive-cc-drivability-spike/README.md` — env 釘三重驗證 + tmux 駕駛配方

## 陷阱

- **判紅只信 Summary 段**;`runner | tail` 的 exit 是 tail 的(本 session 差點假綠一次)。
- **edit → sync-all → commit 順序不能倒**:pre-commit ritual 會擋鏡像漂移(本 session 被擋三次,是防線不是噪音)。
- 突變驗證還原時**別用 `git checkout <file>`**(會把未 commit 的正版一起洗掉——本 session 洗掉過一次 cli.js 閘);用 scratch 備份 cp 回。
- mission-convergence/dispatch-hetero 屬 qc-gate 保護路徑:landing commit 沒 QC-Verdict trailer 推不上(trailer 與 Co-Authored-By 同末段)。
- reviewer agent(a1315d51 panel 輪、abf9e453 p6d 輪)可 SendMessage 續 context;新 session 後即失效,需重派。
- 全機 env 釘備份:`~/.claude/settings.json.bak-before-todo-pin`。
