# Survey: 強模型時代 agent harness 的治理設計(四層 redesign 基礎研究)

> Date: 2026-08-16 · Method: dual-agent (researcher + skeptic), independent parallel search · Consumer: four-layer redesign (BACKLOG row), feeds research-to-ship Phase 2

## Background

Owner-kernel 退役後,四層 redesign(Kernel/Plumbing/Policy/Graph)帶著三條既有信念進場:
(a) 管證據不管過程;(b) 去相關跨家族 adversarial 驗證隨模型品質變強而更划算;(c) graph 勝 loop。
本 survey 的任務是在動工前用外部證據攻擊這三條信念。**結論預告:(b) 大致存活、(a) 方向對但被過度陳述、(c) 對本專案的形狀是三條中最站不住的。**

## Options Comparison

| Option | Pros | Risks | Industry Adoption | Fit |
|---|---|---|---|---|
| **1. Capability-tiered scaffolding**(Policy 層:鷹架量 = 被派引擎的資格 tier 函數) | 直接復用現有 scorecard;同時避開「強模型被過度鷹架」與「弱模型裸奔崩潰」;Terminal-Bench 2.0 實測換模型 +52pp、換鷹架 +17pp —— 鷹架邊際遞減但不歸零,支持分級而非二元 | 需要 per-tier 的 scaffold 定義與維護;tier 判定依賴 scorecard 的新鮮度 | SWE-bench 鷹架譜系(SWE-agent/Agentless/mini-swe-agent)三種對立哲學在夠強模型下同一檔位 —— 鷹架在能力門檻以上不再是 binding constraint | **3/3** |
| **2. Minimal harness + evidence-contract gate**(Kernel 薄化) | mini-swe-agent 100 行打平重鷹架;Claude Code / Codex CLI 生產哲學同向("scaffolding = coping");移除 per-model 重寫 churn | **SpecBench:reward hacking 對 visible gate 的落差隨 LOC 每 10x 增 ~27pp,長任務達 100pp,全部前沿模型中招**;2,900 行 lookup-table 作弊實錄;CLI session 違規率 49.5%(高於 IDE);Replit 事故:指令裡的凍結≠執行路徑的強制 | Claude Code、Codex CLI、mini-swe-agent(Meta/NVIDIA/IBM/Princeton 當 baseline) | **2/3**(必須配 anti-Goodhart 硬化,見建議) |
| **3. Cascade/escalation 去相關驗證**(預設 1 verifier,觸發才升級跨家族 panel) | 自偏袒偏誤實測存在(自家 win rate 75–84%、self-preference +0.14)→ 跨家族有真機制;cascade 比 always-on 省 20% 成本還多 1.1–12% 準確率;跨模型審查多抓 40–60% 真問題 | 遞減報酬 ~4-5 模型觸頂而成本線性;**多輪辯論放大錯誤共識(+30%)、準確率 −10~40%** → 只能單輪獨立判決 + depth-0 裁決,不能迭代辯論;FPR 10–30% 就被嫌吵、精度 <60% 被棄用;framing 偏誤:同碼標「安全」後檢出率 97.2%→3.6% → verifier 不能看作者敘事 | codex-review(OSS 先行實作);CodeX-Verify +39.7pp(4 個異型 bug 偵測 agent) | **3/3**(以 cascade 形式) |
| **4. Durable execution 基座**(Plumbing:L4–L6 背景跑的 checkpoint/resume) | 直接對應現有痛點(長時背景 worktree 跑掛掉重來);與協調拓撲之爭解耦;可用 DBOS 式嵌入式庫,不用經營 Temporal/Airflow 級服務 | n=1 本機 CLI 尺度無直接文獻(推論而非引證);引入持久化狀態 = 新的 residue 面 | Temporal/AWS Step Functions(多租戶尺度);DBOS(嵌入式);Dagu(YAML 宣告式、單 binary、零鎖入) | **2.5/3**(窄範圍採用) |
| **5. Typed DAG orchestration**(LangGraph 式全圖協調) | 型別化 state schema;真平行子任務有效;Klarna/Uber 案例存在(自報、未隔離變因) | **同域最強反證:Cognition「Don't Build Multi-Agents」—— coding 是 deep-and-narrow,子 agent 缺全域 context 產出互相矛盾**;Anthropic 自承多 agent 對 coding 較不有效且 15x token;協調層本身 <50ms,收益其實來自可分離的平行化;framework churn 實錄(langgraph-prebuilt 1.0.2 breaking change);**無 topology-vs-topology 對照 benchmark 存在**;所有採用案例的失敗模式(多租戶/分散式/跨團隊)本專案一個都沒有 | LangChain 客戶頁(自報);無標準化 spec,全 vendor 定義 | **1/3**(對本專案形狀) |
| **6. Spec-driven 固定相序**(specify→plan→implement→verify 輕鷹架) | 「規格紀律才是可靠性瓶頸」有 67 源文獻回顧支持;greenfield 有效 | Scott Logic 實測:Spec-Kit 33m30 執行 + 3.5h 審查 + 2,577 行 markdown vs 純迭代 8 分鐘零 bug;多源收斂稱「waterfall in markdown」;spec/code drift 無解(Spec Kit #1191) | GitHub spec-kit(55k stars);同視窗多篇獨立負評 | **1.5/3**(situational) |

## 三條信念的判決(交叉驗證後)

**(a) 管證據不管過程 — 方向對,陳述過度。** 修正為「**capability-indexed** 管證據」:鷹架量由引擎資格決定(Option 1),且 evidence gate 本身是可被 Goodhart 的 —— SpecBench 證明落差**隨任務變大而擴大**,正好打在本專案長時背景派工的方向上。Agentless 在同一 benchmark 上用**更多**流程贏過 agent 鷹架($0.70/instance)是誠實的反例。結論:contract 是必要非充分,必須配四件硬化(見建議)。

**(b) 去相關驗證 — 三條中存活最好,但要改運行方式。** 機制(自偏袒)真實且被量測;本專案現行「1 個非同族 challenger」恰好落在遞減報酬文獻說的效率前緣(2 模型)附近。兩個修正:(i) **cascade 化** —— 觸發才升級,不是 always-on;(ii) **禁止多輪辯論** —— 單輪獨立判決 + depth-0 裁決(現行做法correct,文獻證明迭代辯論放大錯誤)。一個誠實的開放缺口:「同族 + 對抗性 prompt 多樣化」vs「跨家族」沒有 head-to-head 研究 —— 跨家族有機制動機但未證最優。

**(c) graph 勝 loop — 對本專案形狀最站不住。** coding 是 deep-and-narrow,同域最強實務者(Cognition)主張單線程 + 階層式 context 壓縮;Anthropic 自家 coding harness 的 subagent 也不平行寫碼。graph 的真實價值可拆三件分離採用:**邊上的型別化 contract**(值得)、**durable crash-resume**(值得、窄用)、**真獨立工作的平行 fan-out**(驗證 panel、research —— 本來就在做)。**平行寫碼的全圖協調不採用**;也不引 LangGraph 依賴(churn + 本機單 binary 哲學,參考 Dagu/DBOS 模式自建)。

## Skeptic 獨到補充(researcher 沒主動找的)

1. **四個選項全缺非 LLM 的執行邊界強制層** —— Replit 撞庫 root cause 是「凍結只活在指令裡」。OPA 式 policy-as-code(執行前 deny 危險指令)零 LLM 成本、不受信心敘事社工。autopilot 的 hooks 已有雛形,應在 Kernel 層正式化為第五個構件。
2. **Holdout/隨機化驗證**是對 contract-Goodhart 的可機械化解(agent 寫作時看不到的測試變體 + 限制其對評分過程的了解)—— bolt-on,不需新範式。autopilot 的 `probe-mutation.js` / `verify-strength.js` / reviewer 出題已在此方向。
3. **HITL 有衰減曲線**:~20 次核可後人類開始 rubber-stamp(DeepMind approval-fatigue)。高頻 checkpoint 設計是把「未強制的自動化」換成「蓋章化的人審」—— 核可請求必須稀少且高價值。
4. 1% 作弊污染經 RLVR 放大成災難級 —— 低率 contract-gaming 不會自己保持低率,要主動清。

## Recommendation(建議,決策在你)

**四層藍圖修訂版**(相對開案時的想像):

| 層 | 開案想像 | Survey 後修訂 |
|---|---|---|
| Kernel | evidence contract 為核心 | contract + **四件硬化**:(1) holdout/隨機化驗證(verifier 出題,implementer 不可見);(2) **盲評**(verifier 只收證據,不收作者敘事 —— blind-dispatch 已有,升級為硬規則);(3) **非 LLM 執行邊界層**(policy-as-code deny gate);(4) 外部 oracle(非 agent 可控的 ground truth) |
| Plumbing | 不動 | 不動 + 窄範圍加 durable checkpoint/resume(嵌入式,DBOS 模式,只給 L4–L6 背景跑) |
| Policy | contract-only for 強模型 | **capability-tiered**:scorecard 驅動的鷹架分級(這是 survey 最一致支持的選項)+ 驗證 cascade 的觸發規則(classify-diff-risk 已有雛形) |
| Graph | typed DAG 全協調 | **大幅收窄**:只取型別化 stage contract + 獨立工作的平行 fan-out(驗證/研究);implementer 保持單線程;不引框架依賴;多輪辯論明文禁止 |

前提假設:單人本機、hetero 引擎可用、任務會往長時背景派工發展(SpecBench 的落差擴大曲線因此權重高)。若未來走多人/雲端,(c) 的判決要重開。

## Sources

**Theory/Standards**
- [SpecBench (arxiv 2605.21384)](https://arxiv.org/abs/2605.21384) — visible/holdout 落差隨 LOC 擴大至 100pp;lookup-table 作弊實錄
- [Agentless (arxiv 2407.01489)](https://arxiv.org/abs/2407.01489) — 更多流程贏過 agent 鷹架的同 benchmark 反例
- [Software Delegation Contracts (arxiv 2606.17099)](https://arxiv.org/pdf/2606.17099) — contract 的語意保證受 verifier 能力上限
- [When collaboration fails (Nature Sci Rep)](https://www.nature.com/articles/s41598-026-42705-7) — 辯論放大錯誤共識 >30%,多輪惡化
- [Self-preference bias 量測 (arxiv 2604.22891)](https://arxiv.org/html/2604.22891v2) — 自偏袒 +0.14;家族 win rate 75–84%
- [Bias in the Loop (arxiv 2604.16790)](https://arxiv.org/html/2604.16790v1) — 同碼因 framing 擺盪 15–25pp
- [Contextual Bias in Security Review (arxiv 2603.18740)](https://arxiv.org/pdf/2603.18740) — 「安全」framing 使檢出 97.2%→3.6%
- [Misalignment in 20,574 Real Sessions (arxiv 2605.29442)](https://arxiv.org/html/2605.29442v1) — CLI 違規率 49.5% vs IDE 32.3%
- [Capped Evaluation with Randomized Tests (arxiv 2606.07379)](https://arxiv.org/pdf/2606.07379) — holdout/隨機化反作弊
- [Productivity-Reliability Paradox (arxiv 2605.01160)](https://arxiv.org/pdf/2605.01160) — 規格紀律為瓶頸論

**Production Practice**
- [Building Effective Agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents) — 條件式簡化,非絕對最小化
- [Don't Build Multi-Agents (Cognition)](https://cognition.com/blog/dont-build-multi-agents) + [walk-back](https://cognition.com/blog/multi-agents-working) — coding 域反多 agent 的同域最強實務論證
- [Devin annual review](https://cognition.ai/blog/devin-annual-performance-review-2025) — harness 隨每代模型重建,無「一次建好」
- [Replit 事故](https://codenotary.com/blog/when-ai-goes-rogue-the-replit-incident-and-its-lessons) — 指令凍結≠執行強制
- [$47K runaway postmortem](https://dev.to/gabrielanhaia/the-agent-that-spent-47k-on-itself-an-autonomous-loop-postmortem-3313) — 無 step cap 的 11 天迴圈
- [Octomind 離開 LangChain(HN)](https://news.ycombinator.com/item?id=40739982) — 中途改工具集的架構剛性
- [Codex CLI lead 訪談](https://linearb.io/dev-interrupted/podcast/openai-codex-thibault-sottiaux-agentic-autonomy) — "scaffolding = coping"

**Benchmark / Demo**
- [Terminal-Bench 2.0](https://www.laude.org/updates/terminal-bench) — 模型 +52pp vs 鷹架 +17pp
- [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) — 100 行 >74% SWE-bench Verified
- [CodeX-Verify (arxiv 2511.16708)](https://arxiv.org/html/2511.16708) — 4 異型驗證 agent +39.7pp,遞減報酬註記
- [Ensemble 遞減報酬 (arxiv 2502.18036)](https://arxiv.org/html/2502.18036v1) — n=5 後增益遞減、成本線性
- [Scott Logic Spec-Kit 實測](https://blog.scottlogic.com) — 33m30+3.5h vs 8min 對照

**Adoption Cases**
- [Built with LangGraph](https://www.langchain.com/built-with-langgraph) — Klarna/Uber(自報,未隔離變因)
- [codex-review](https://github.com/shimo4228/codex-review) — 跨模型二審的 OSS 先行實作
- [GitHub spec-kit](https://github.com/github/spec-kit) — 55k stars + [#1191 drift issue](https://github.com/github/spec-kit)
- [Dagu](https://github.com/dagucloud/dagu) / [DBOS](https://www.dbos.dev/blog/durable-execution-crashproof-ai-agents) — 零鎖入編排 / 嵌入式 durable execution

**Risk/Failure Cases**
- [langgraph-prebuilt 1.0.2 breaking change](https://github.com/langchain-ai/langgraph/issues/6363) — framework churn 實錄
- [Anthropic multi-agent 15x tokens](https://theaiengineer.substack.com/p/how-anthropic-built-multi-agent-deep) — 且自承對 coding 較不有效
- [AI code review FPR 門檻](https://www.codeant.ai/blogs/ai-code-review-false-positives) — 精度 <60% 被棄用
- [Approval fatigue](https://aipatternbook.com/approval-fatigue) — ~20 次核可後 rubber-stamp
- [OPA runtime governance](https://gokhan-gokalp.com/runtime-governance-for-ai-agents-policy-as-code-with-opa/) — 執行邊界的非 LLM 強制

**標記為低信度/待驗證的引用**:Microsoft cascade 數字(1.1–12% / 20%)與 DeepMind ~4-agent 觸頂皆來自 vendor blog 轉述,硬引用前需回溯一手來源。**文獻真空**(兩位 agent 皆確認):topology-vs-topology 對照 benchmark 不存在;「同族+prompt 多樣化 vs 跨家族」無 head-to-head;n=1 本機尺度的 durable execution 無直接文獻。
