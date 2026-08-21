# Implementer qualification suite — live-rail 正式考券

> Target version: v2.34.34 (PATCH — new scripts/evals, no new skill/agent; VA-suite precedent v2.34.17)
> Branch: `feat/v2.34.34-implementer-qualification-suite`
> Plan: [`docs/plans/2026-08-22-implementer-qualification-suite.md`](../../plans/2026-08-22-implementer-qualification-suite.md)
> Approved plan-mode snapshot: `~/.claude/plans/snuggly-churning-orbit.md`

## Project Goal

> **Final goal**: dev-flow 驗證合約引用的「`engine-qualify.sh` known-bad 零漏放 bar」對 implementer role 真實存在——`engine-qualify.sh implementer` 端到端出考、評分、入庫,並以兩場真實施測(grok-4.5、agy/gemini-3.7-flash-high)產出第一批正式 implementer 成績單。
> **Success criteria**:
> 1. `engine-qualify.sh implementer … --emit-row` e2e 產出 evidence + scorecard row,且通過 `engine-scorecard.js` `validateRecordRow` 11 項綁定(機械驗證:record 不拒)。
> 2. ≥6 個 deviant 作弊形 fixture 各自釘死一個非 qualified taxonomy 值;≥1 個 discriminating mutation control(沙盒副本刪 gate → deviant 翻 qualified)證明 gate 有辨別力。
> 3. 新測試套件綠 + `qualify-scorecard-vocabulary` parity 綠 + `codex-plugin-package` 鏡像 parity 綠 + 全套 `hooks/tests/run.sh --parallel 8` 綠(witness 500ms flake 為既記錄豁免)。
> 4. 兩場 dogfood 施測誠實記錄(任何結果),evidence bundle + 實體 store rows;row 的 `corpus_pass` 為 `N/N` 正規形(解鎖 resolve-scaffold-tier T0 判定,非 baseline-3/3 的 T1 ceiling)。
> **Scope boundary**:
> - IN:D1 plan+rubric+兩代 hetero plan review;D2 generator+corpus;D3 grader;D4 `runImplQualification` 接線(engine-qualify.js);D5 capability-evidence `impl_dispatch` methodology;D6 測試(紅案+mutation control+deviant matrix);D7 codex 鏡像;D8 dogfood ×2;D9 docs/CHANGELOG/PATCH bump。
> - OUT:explorer suite(獨立 leg,BACKLOG 留)、broker `unified_diff` 改名(BACKLOG)、no-confidence decay 取代 TTL(BACKLOG M)、gpt-5.3-codex-spark 施測(follow-up 場)、Official-defaults 打包 UX(獨立 BACKLOG row;本工作完成第二個 role 正式考級會點燃其 trigger → closeout surface 給 Board)、multi-round review-loop 量測、hard-tier corpus(named residual)。

## Board 裁決(2026-08-22)

1. 考場 = **live-rail 真派工**(dispatch-hetero.sh,非 broker 單發 patch-as-data)——考下游 gate 實際消費的構念(scope/test-integrity/canary/fail-closed 的合約服從)。
2. dogfood 對象 = **grok-4.5**(requalify 到期 events 137/138)+ **agy/gemini-3.7-flash-high**(識別更正:4.7 不存在於 agy 1.1.14 清單)。

## L-1.5 Scope Completeness Audit(dimensions coverage)

| Dimension | Y/N | Coverage |
|-----------|-----|----------|
| Source code + tests | Y | D2-D6(evals/impl-eval-*、engine-qualify.js、capability-evidence.js、hooks/tests + scripts 測試) |
| User-facing docs | Y | D9:engine-onboarding SKILL.md(撤 implementer ⚠️)、role-and-harness-governance.md(R2→R3)、scripts-inventory |
| API / CLI surface | Y | engine-qualify HELP 加 implementer subcommand(順修 `--raw-dir` 缺漏);broker/provider 不動(明文 deviation) |
| Config templates | N | 無新 config 欄位(qualification 由 store 查,不入 config——既有慣例) |
| CHANGELOG | Y | D9 |
| Version bump (semver) | Y | PATCH v2.34.34;bump 前重查版號(並行 session 讓號規則) |
| Version sync grep | Y | finish-flow L-5.5 preflight-release gate |
| Migration | N | schema 變更 additive(既有 rows byte-for-byte revalidate,brain P3 慣例);無 breaking |
| Dependent repos / consumers | Y | D7 codex 鏡像(`sync-codex-plugin-skills.sh` + package test) |
| Credit / attribution | N | 全內部前例(impl-baseline、VA v3、grok A/B),無外部 OSS 吸收 |
| Dogfood | Y | D8 兩場真實施測即 dogfood |

## User-stated requirements ledger

| Requirement(verbatim) | Mapped to |
|---|---|
| 「Roster qualification — implementer suite: 設計 implementer 正式考券並施測」(/next 確認) | D1-D7(設計+實作)、D8(施測) |
| 考場軌道=「Live-rail 真派工」(AskUserQuestion 裁決) | Construct、D2/D4 |
| dogfood=「grok-4.5 + agy gemini-flash-4.7 high」(AskUserQuestion 裁決,custom;後續更正為 gemini-3.7-flash-high) | D8 兩場 |

## L-1.6 Skill routing

Repo 無 `.claude/skill-routing.md`;CLAUDE.md 無 per-code-area skill 條目。各受影響區(evals/、scripts/、src/engine/、hooks/tests/、platforms/codex/)均 **N/A** — 本 repo 的 code-area 規則以 CLAUDE.md 全域慣例(severity 詞彙、ADR-0001、語言選擇表)承載,無區域級 skill。註:D6 測試設計時將依 dev-flow Config Injection 規則參考 `autopilot:test-strategy`(若屆時判定需要,於該步驟 Skill-invoke)。

## Progress

| Step | Status | Notes |
|------|--------|-------|
| L-1 admission + branch + tracking | ✅ 2026-08-22 | Mission admission READY(deliverable_count=1, l3 inline);branch 建立 |
| D1 plan doc + rubric freeze | ✅ 2026-08-22 | R2 FROZEN(21384B,ratio 1.269)|
| D1 兩代 hetero plan review | ✅ 2026-08-22 | G1:20 findings 全收(sol+grok STOP×2);G2 terminal:14/14 adopted、3 項 scoped rejection 入 backlog;`g2-adjudication.md` 終局 |
| D2 generator + corpus | ✅ 2026-08-22 | impl-eval-generator + corpus;self-check 24/24 bwrap × 3 seeds |
| D3 grader | ✅ 2026-08-22 | shared collection+grading module + bwrap oracle driver |
| D4 engine-qualify 接線 | ✅ 2026-08-22 | runImplQualification;role/router/XOR-bypass/TTL-cap;pinned hashes |
| D5 capability-evidence 擴充 | ✅ 2026-08-22 | impl_dispatch methodology + normalize/enforce;capability-evidence 102 綠 |
| D6 測試(紅案+mutation control) | ✅ 2026-08-22 | engine-qualify-impl 26 assertions;manifest-gate mutation control;codex-package 112 |
| D7 codex 鏡像 | ✅ 2026-08-22 | 4 impl assets 入 sync list;package test sandbox 同步種子 |
| D8 dogfood grok-4.5 / agy-flash | ⬜ | agy 場前置 Stage-0 探針 |
| D9 docs + CHANGELOG + bump | ✅ 2026-08-22 | engine-onboarding R2→R3;CHANGELOG;v2.34.34(26h/28s)|
| L-5 finish-flow | ⬜ | |

## Decision log

- 2026-08-22:construct = live-rail(Board,AskUserQuestion);理由:broker 單發單字串無重試裝不下 worktree 編輯迴圈,且下游 gate(dispatch-contract GO/NO-GO、density scaling、dev-flow 連言)消費的是合約服從構念非 patch 合成力。VA v3 pure-data 的動機(候選碼不進 host)以反向手段滿足:候選碼在自己的 dispatched process 跑,host 只離線評 git artifacts,oracle 在 bwrap 子進程執行候選碼(t15/t17 教訓)。
- 2026-08-22:dogfood = grok-4.5 + agy/gemini-3.7-flash-high(Board custom 選擇;2026-08-22 識別更正:原指定 4.7 不存在,`agy models` probe 後 Board 改選現行最新 flash;codex-spark 留 follow-up)。
