# /l6 Skills 全面稽核報告 — transcripts × skills 交叉分析

> 執行日 2026-07-05。五軌平行:4 個 Claude 分析 agent + 1 個 codex/gpt-5.5 獨立稽核軌
> (`dispatch-explore.sh`),depth-0 逐項驗證後合成。語料:573 sessions / 483MB
> (`~/.claude/projects/`,PEACE 471、backtester 30、mple2 30;排除 eval-arena 與 worktree 噪音)。
> 真人輸入訊息 509 則(過濾注入行後)。

## 執行摘要

- **已修正並 merge**:6 處 skill 指令面矛盾/drift(commit `955f6bf`,doc-only 不 bump 版本,codex 判 SHIP-AS-IS)。
- **最大的新 skill 缺口**:mid-work **handoff/context-pressure SOP** — 語料中 handoff/clear 儀式出現 **91 行**,使用者全程手動駕駛。
- **最高頻挫折**:回覆語言回退英文(**16 則明確糾正**,語氣遞增)— 是執行力問題不是文件問題,要用 hook/output-style 強制,不是再寫一次 CLAUDE.md。
- **弱模型 lift 已證實的唯一槓桿**:操作程序包(procedure pack)— haiku t2 任務 8/8 vs 0/8(Fisher p≈0.0001);**機械式合約改變行為,散文只改變詞彙**(adjudication_valid 40% vs 40% 不動)。最佳下一步:verification density 隨 implementer 能力分級(S 工作量)。
- **雙家族交叉確認**:「get it done」同時觸發 `ceo-agent` 與 `/l3` 且無 tiebreak — Claude 軌與 codex 軌**獨立**都抓到。

## 方法與誠實聲明

| 軌 | 引擎 | 狀態 |
|----|------|------|
| skills 矛盾稽核 | Claude subagent | 交付,claims depth-0 驗證通過 |
| transcript 修正挖掘 | Claude subagent | 交付,兩大 cluster 抽驗屬實(handoff 91 行、語言 16 行) |
| skill 升格偵察 | Claude subagent | 交付(PEACE-local) |
| 弱模型 lift 分析 | Claude subagent | 交付,3 部分 |
| 獨立稽核(decorrelated) | codex / gpt-5.5 | **read-probe 失敗**(未回帶 token)→ 依 fail-loud 原則不信 self-report,改由 depth-0 對每條引文逐一核對原檔 — **全部屬實**,故採用其 findings |

## 一、已修正(merged, `955f6bf` → develop `9ace4e7`)

1. `ceo-agent/SKILL.md` front-door 章節漏 `/l6`;`/l5` 描述停在舊的「agy/Gemini via dispatch-hetero」(正確:`engine implement-review` + resolver)。
2. `ceo-agent` step 3f 漏掉 dev-flow 宣告 NON-OPTIONAL 的 `L-1.6` parent forcing-function task。
3. `ceo-agent` DOA:補「已 merge 分支的 finish-flow 清理(L-5.7/F.5/H-9.5)在 DOA 內」— 解掉與 `finish-flow:121`「全部 sub-tasks 在 CEO DOA 內」的矛盾(escalation 表的 Delete branches 指未 merge/受保護分支)。
4. `dev-flow` 過時的「6 more discrete pending tasks」→ 7(L-5.7 後加)。
5. `quality-pipeline/references/code-review.md` severity 表 Suggestion 排在 Minor 上面,顛倒 canonical 🔴🟠🟡🔵 順序。
6. `finish-flow` L-5.5 同一列混用 `doc/` 與 `docs/`(該列的 grep guard 本來就用 `docs/`)。

Gates:validate.sh / check-canonical-invariants.sh / sync-model-routing --check 全過;codex payload 重新生成;codex/gpt-5.5 diff review = SHIP-AS-IS。

## 二、Report-only(有行為/路由風險,需你裁決)

### 2a. `agents/reviewer.md` + `agents/debugger.md` frontmatter `model: opus` ↔ canonical routing 說 sonnet
`references/model-routing.md:26-27` 與 `resolve-dispatch.sh` 都判 sonnet(「100% accuracy on review/debug tasks in benchmark」);planner 一致、只有這兩個發散。經 resolver 派遣時會被蓋掉,但**裸 `subagent_type: autopilot:reviewer` 會跑 opus**。改 frontmatter 是行為變更(PATCH + CHANGELOG),故不代做。建議:改 sonnet,或在 frontmatter 旁註明「deliberate override for bare invocation」。

### 2b. Routing tiebreak 缺口(6 組,改 `description:` 有 MAJOR 路由風險 → 建議加「body 內 tiebreak 段落」而非動 frontmatter)
| 重疊 | tiebreak 建議 |
|------|--------------|
| `ceo-agent` ↔ `/l3`("get it done"/全權處理)**[雙家族確認]** | 對話語句 → ceo-agent;打了 `/lN` → front-door |
| `audit` ↔ `doc-sync`("verify X matches Y") | 兩個實作/系統 → audit;文件 vs code → doc-sync |
| `survey` ↔ `think-tank`(tradeoff) | 外部證據/業界 → survey;內部優先序/角色辯論 → think-tank |
| `debug` ↔ `test-strategy` ↔ `quality-pipeline`(flaky test 三重) | 診斷單一 bug → debug;測試方法論 → test-strategy;pre-merge gate 失敗 → quality-pipeline |
| `ceo-agent` ↔ `research-to-ship`("investigate then do it") | 全自主 → ceo-agent;human-gated pipeline → research-to-ship |
| `next` ↔ `think-tank`(priority) | 掃 backlog 文件 → next;策略辯論 → think-tank |

### 2c. 未被 gate 保護的 canonical 重複(建議加 `check-canonical-invariants.sh` seeds)
- **Verifier isolation**:canonical `references/blind-dispatch.md` §Verifier isolation;`agents/reviewer.md:32-39` 與 `code-review.md:81-92` 整段重述,無 invariant 釘住。
- **Panel aggregation `union-on-verified-critical`**:canonical `code-review.md:193-201`;`level-front-door.md:289-295` 全文重述。
- 這兩條都是 load-bearing 安全規則,drift 代價高。

### 2d. `doc/` vs `docs/` 預設路徑清剿(此次只修了 finish-flow 內部不一致)
殘留單數 `doc/` 預設:`next/SKILL.md:48-51`(INDEX/plans/BACKLOG/proposals)、`dev-flow:67`、`code-review.md:251`、`finish-flow:88,99`、`retro`、`project-lifecycle/references/*`、`phase0-hygiene.md:59`。autopilot 本身與 PEACE 都用 `docs/`;在 dogfood 情境 `/next` 掃 `doc/projects/INDEX.md` 會**靜默掃空**。建議一次 sweep 統一為 `docs/` + 「(or project-configured path)」註記(scaffold/project-detect 已偵測 doc convention,注入 config 仍是最終權威)。

### 2e. merge-to-main 弱矛盾
`finish-flow:61`「(or main per project convention)」vs `ceo-agent`「Merging to main … NOT within DOA」。ceo-agent 的「(or equivalent team-default branch)」其實已涵蓋,但弱模型會讀成絕對禁令。建議一句話釐清:main 就是 team-default 時 = DOA 內;develop→main 晉升 = DOA 外。

## 三、Transcript 驅動的改善(頻率 × 嚴重度排序)

### 3.1 🔴 新 skill:`handoff` — mid-work context-pressure 交接(91 行證據)
最大宗工作流摩擦。使用者反覆手動:「ctx 太滿,寫 handover 我 clear 去新 session 修」「寫 handoff 我 clear session 後繼續」×20+,再貼 `read HANDOFF.md` 回來 ×11。`finish-flow` 只管收尾,**沒有 mid-work 交接 skill**。建議:
- `autopilot:handoff` skill:標準化 resume doc(git 狀態、已決事項不重議、下一步、read-order),觸發詞「寫 handoff」「ctx 太滿」「context pressure」。
- 搭配 opt-in hook 在 context 高水位主動提議(使用者的「需要寫 handoff 嗎?」顯示他要的是**助手主動判斷**)。

### 3.2 🔴 語言回退強制(16 則糾正,最情緒化)
「用正體中文回答 要講幾次」「為什麼都會變英文,檢查一下」。CLAUDE.md 指令存在但跨 session 靜默失效 → 文件層再寫沒用。建議:output-style / SessionStart context / Stop-hook 級的機械提醒(autopilot opt-in hook:偵測回覆主體為英文時 nudge)。

### 3.3 🟠 委派姿態 under-delivery(~22 則)
「你不要參加,你只負責派遣」「盡量用 subagent 不要汙染自己的 context」(逐字重複兩次)「連驗證派遣寫 prompt 都派出去」。front-door 預設 involvement=just-results,但 depth-0 仍 inline 執行燒 context。**/l6 的存在正是解這題** — 建議:ceo-agent/lN 明文「depth-0 預設把驗證 authoring 也派出去(/l6 姿態),inline 執行需有理由」;把「省 depth-0 context」寫進 front-door 的執行紀律。

### 3.4 🟠 中途停下來問(5 則,強烈)
「goal 還沒達成為什麼停下來?」「一路到底不要問我」。與 no-go=none 預設矛盾。建議:front-door 補一條「escalate 條件不含『想確認一下』— 只有 DOA 邊界/不可逆才停」;搭配「差點走錯路要記下來」(near-miss 自動寫入 learn/knowledge,使用者原話要求過)。

### 3.5 🟡 收尾四面清點(4 則)
「該補的 skill / doc / memory / knowledge 都處理了嗎?」建議:finish-flow L-5.6 的 Session End checklist 把「skill/doc/memory/knowledge 四面 sweep」升級為**明確輸出項**(每面:更新了什麼 or 為何不需要),不是籠統的 knowledge extraction。

### 3.6 🟡 已承諾需求掉落(2 則)
「我之前不是有要求你做 role based / user story 測試嗎?後來沒寫?」建議:dev-flow L-1 的 scope audit 輸出「使用者明示需求 → 對應 task」對照表,finish-flow Final Goal Review 逐條銷。

## 四、PEACE 專案層(不進 autopilot;可直接做)

1. 🔴 **DB 連線 harness + 憑證外洩修復**:PEACE/PANEL DSN 內聯重打 ~45 次,**readonly Panel 密碼明文進 transcript 數十次**。修法:小 resolver script(從 `docker exec … env` 取 DSN,已有 8 次正確示範)+ 更新 `peace-pnl-reconciliation` SKILL.md:127-131 的過時佔位 DSN。附帶建議:輪換該 readonly 密碼。
2. 🟠 `dev.sh cargo <args>` passthrough:`docker compose exec -T backend cargo …` 前綴重打 235+ 次。
3. 🟡 `wait-ready.sh` 有界輪詢:17 個手刻 `until … sleep` 迴圈,間隔隨機、多數無 timeout 上限。

## 五、弱模型 lift(讓低能力模型接近前沿)

**已證實**(campaign R1/R1b/R2):
- 程序包在 haiku t2(byte-fidelity)8/8 vs 0/8,p≈0.0001 — lift 來自**操作程序**(A3 reconstruct-from-git),詞彙零效果。
- 散文包改詞彙不改合規(`adjudication_valid` 40% vs 40%);合規來自**機械式 required-artifact 合約**。
- 天花板效應:sonnet 兩臂全過 — 資產包對強模型無增益。
- 樓地板:MiniMax-M3 reviewer 校準 10/10 known-bad、false-pass-on-critical=0。

**建議(lift-per-effort 排序)**:
1. **S|最高**:`resolve-review-loop.sh` 接 `engine-scorecard.js` 能力分級 → **verification density 隨 implementer tier 縮放**(弱 implementer 自動多 rounds + 更密 cross-family panel)。現在 density 只 key 在 source-trust/diff-lines,`loop_max_rounds` 是死常數。直接服務 cc-shim(MiniMax/GLM)路徑。
2. **S/pattern**:把 A1/A2/A4/A5 acceptance patterns 各建一個 haiku-band 判別任務跑 ON/OFF — 把「可信但未測」變「已證」,擴大唯一有效槓桿。
3. **S(操作花費)**:campaign 直接用 **MiniMax-M3 / flash-via-agy 當 orchestrator** 跑 ON/OFF — 真實弱模型路徑從未進過 campaign;haiku 的 lift 不保證遷移。
4. **M**:attention-slip 類的 L0 機械 gate(error-path enumerator、secret-leak scanner)進 completeness gate/pre-push 為 required artifacts(注意:campaign 只證明散文在此失敗,未證明 L0 gate 成功 — 配 #2 量測)。
5. **M-L**:multi-turn/long-horizon eval mode — 整個 quality-floor 的核心主張(長程漂移)目前**零證據**(所有 eval 單輪 `claude -p`)。
6. **S(標註 speculative)**:decomposition 單元大小隨 tier 縮放 — 機制都在(`dispatch-batch`/`check-disjointness`),但無任何證據,先建 eval 再上。

**總原則(campaign 的最大教訓,也是「讓弱模型發揮」的答案)**:把判斷步驟降為**腳本與合約**(L0/L3 機械 rails)+ 給**操作程序**而非叮嚀,再用 **decorrelated cross-family review** 兜底(v2.31.9/10 panels 各抓到 7 個單一 reviewer 漏掉的真缺陷)。散文式提醒是最弱的手段 — 對弱模型與強模型皆然。

## 附錄:run-summary ledger

| step | runner | model | verdict | artifact |
|------|--------|-------|---------|----------|
| 語料掃描 | script | distill-scan.js / retro-review-loop.js | n/a | 573 sessions, friction 286 |
| 分析 fan-out ×4 | claude | (session tier) | 交付 | 4 份報告(本文合成) |
| 獨立稽核 | codex | gpt-5.5 | read_failed → 引文逐條 depth-0 驗證後採用 | /tmp/dispatch-explore-log-7HOLOY |
| 修正 impl | claude (depth-0) | — | 6 fixes | `955f6bf` |
| decorrelated review | codex | gpt-5.5 | **SHIP-AS-IS** | dispatch-review JSON |
| merge | depth-0 | — | merged, no push | develop `9ace4e7` |

偏離聲明:本任務為分析/報告型,implementer 未走 `engine implement-review`(無碼可寫);hetero 驗證改以「codex 獨立稽核軌 + codex diff review」落實 /l6 的異家族 decorrelation 精神。depth-0 全程持有 merge authority 與最終判定。
