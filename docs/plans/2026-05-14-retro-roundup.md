# Retro Roundup — Post-v2.7.2 Plumbing + Process Improvements

**日期：** 2026-05-14
**狀態：** ✅ Shipped in v2.7.3 — merged to develop as `57c88ee` on 2026-05-14
**Size：** L-lite（plan + project + L-5；P1 batch ~50min 實作）
**Branch：** `feat/v2.7.3-retro-roundup`
**Project：** [`docs/projects/2026-05-14-retro-roundup/README.md`](../projects/2026-05-14-retro-roundup/README.md)

---

## 1. 背景

2026-05-14 是 autopilot ship 高峰日：40 commits / 4 個 fix-cycle / 2 個 L-size 完成（v2.7.0 superpowers-coexistence + v2.7.2 context-handoff-hardening）。Day-end retro 從 git history + reviewer findings + dogfood evidence 抽出 **25 條改進建議**。本 plan 把這 25 條：
- 全部結構化（status + tier + trigger）
- Tier 1 五條立即 ship
- Tier 2 / 3 / 4 / 5 各自寫明處置條件

讓未來 me 看單 plan 就能：(a) 知道哪些已 ship、(b) 哪些待 trigger、(c) 哪些 explicit skip。

## 2. CEO Scope Decision

**Selective scope mode**：
- **Hold baseline = Tier 1 五條 quick wins**
- **Surface as Board Decisions = Tier 2 # 6**（Plan C handoff schema — 今天 pain sample 升到 3）
- **Defer to roadmap = Tier 2 餘下 + Tier 3 全部**
- **Explicit skip = Tier 5**

不 ship 全部 25 條的理由：
- session 已長，疲勞 risk
- Tier 2 多項需獨立 fix-cycle、混在 P1 batch 違反 single-purpose 原則
- review-fatigue 預防 — 25 條一次審反而漏東西

## 3. 25 Entries Catalog

### Tier 1 — Quick Wins（**本 plan ship**，split into P1a + P1b 兩 commits per r1 review）

**r1 reviewer findings absorbed**：
- 原 plan 寫 "single P1 atomic commit"，三 reviewer 一致駁回 — T1 script 危險（IO-mutation across 4 files）、其他 4 條 polish 純加性。**Split into 2 commits**：P1a = T1（含 hardened spec），P1b = T2-T5 batch。
- T1 sed-based 設計 → 改用 **Node.js（match existing hook fleet pattern）+ 嚴格 verify**：atomic temp-write + rename，per-file backup `.bak.$$`，`--dry-run` mode，per-file exact-count grep verify (`grep -c`)，set on failure。

| # | 條目 | 動作 | Files |
|---|---|---|---|
| **T1** | `scripts/sync-version.sh` 一鍵改 plugin.json + marketplace.json + hooks.json + README headers | **Node.js** script (per Ops r1#1)：CLI `--version X --hook-count N --skill-count M [--dry-run]`；per-file backup → atomic temp+rename → per-file exact-count verify；on any verify fail → restore from backup + exit non-zero | `scripts/sync-version.js`（new，rename from .sh per Node convention）|
| **T2** | `.gitignore` 加 `.in_use/`（only）；**NOT** blanket `skill-creator-workspace/results/` | `.in_use/` 純 session lock OK ignore；但 results/ 有 tracked baseline（v2.7.0 / v2.7.2_155325），blanket 會 hide future intentional baselines。**改用 pattern**：`skill-creator-workspace/results/*/2026-05-14_154034/`（only the noise dirs from today's non-baseline runs，明示） | `.gitignore` |
| **T3** | `docs/BACKLOG.md` 建立 + **seed 今天 deferred items**（Ops/QA r1）| 新檔 + 3 entries：context-handoff symlink homedir diag、failure counter cleanup、disable flag malformed STALE handling。Format example + trigger field mandatory（per autopilot dev-flow code-review.md backlog spec）| `docs/BACKLOG.md`（new）|
| **T4** | finish-flow L-5.5 加 INDEX stale-qualifier guard | **r1 r1 fix — regex 全 pattern**：`grep -E '\\((pending\|target\|in progress\|WIP\|TBD\|draft)\\)' docs/projects/INDEX.md` 必空；emit 匹配行 on failure（surface cause not just count）| `skills/finish-flow/SKILL.md` L-5.5 sub-task description |
| **T5** | hook-order disclaimer 確認 + CHANGELOG top-of-file comment specify location | `hooks/README.md` Hook order section v2.7.2 已含 cross-matcher caveat ✓；新加：CHANGELOG.md 開頭加 HTML comment block 標 release-template + 寫 hook-order semantics reminder | `hooks/README.md` confirm + `CHANGELOG.md`（top HTML comment） |

**P1a single commit**: T1 alone（~150 lines new script + smoke-test fixture）。
**P1b single commit**: T2 + T3 + T4 + T5 batch（~100 lines doc/config polish）。

### Tier 2 — Medium Fixes（roadmap，需獨立 fix-cycle）

| # | 條目 | Trigger | Estimated effort | 排程 |
|---|---|---|---|---|
| **T6** | Plan C — handoff schema：**CEO author default = stay Tier 2**（per QA r1#5 punt critique）| **Sharpened trigger** (per Arch r1)：「sample 4 在**同一個 sub-category** 出現」— 三 pain samples 是 heterogeneous（agent handoff / acceptance template / status hygiene），太早一個 schema 會 over-fit。需 4th sample 在這三個之中**同類型**重複才 promote | 90min if triggered | **trigger-bound**（不 punt to reviewer）|
| **T7** | Plan-review-rounds 上限明文進 `references/blind-dispatch.md` / dev-flow | 下次 L-size 啟動前（不急） | 30min（單檔 edit + reference）| 下次 L-size kickoff |
| **T8** | quality-pipeline acceptance-criterion drift check sub-step | 下次 L-size pre-merge review 前 | 60min（reviewer agent prompt template + quality-pipeline ref edit）| 下次 L-size L-5.2 之前 |
| **T9** | `hooks/README.md` Tier counts auto-rendered from `hooks.json` | **r1 Arch F4 — trigger fix**：drift sample 已 ≥ 2（v2.7.0 「12 skills」miss in `ef9a7b9` + Tier counts in v2.7.2 review）。實際應 Tier 1。**Compromise**：列 Tier 2 但 trigger 從「hook 增刪」改「next hooks/README.md touch」— 比現況早一步 | 90min（script + CI hint）| **trigger: next hooks/README.md edit**（更積極）|
| **T10** | 「parameter flow through layers」pattern doc in `references/` | 下次寫 multi-layer extraction code 時 | 30min（doc）| next L-size touching extraction/parser logic |

### Tier 3 — Strategic（roadmap，較大、緩議）

| # | 條目 | Trigger / Status | Doc |
|---|---|---|---|
| **T11** | Implement router-judge harness（已有 plan） | Trigger: 下次 routing tightening 痛點 OR description-ambiguity 出 ≥2 次連環 | [`2026-05-14-eval-router-judge.md`](2026-05-14-eval-router-judge.md) |
| **T12** | autopilot think-tank/audit Plan B SKILLS 段補完 | Trigger: think-tank role 跑出明顯 paraphrase failure / 或 voltagent agents 接入需強化指示時 | (no plan yet) |
| **T13** | v2.7.2 context-handoff hook 真實 compact 觸發後驗證 | Trigger: 第 1 次自然 compact 發生（passive 等）| dogfood log in archive project |
| **T14** | `MEMORY.md` health audit | 個人 memory，autopilot scope 外；trigger: lines > 170 | （個人 trigger，非 autopilot tracking）|
| **T15** | `agents/reviewer.md` 加 round-2 blind-dispatch prompt template | Trigger: 下次 quality-pipeline re-review 觀察到 reviewer agent 還是收 prior verdict 字眼時 | (no plan yet) |

### Tier 4 — Watch & Observe（觀察，不動手）

**r1 Ops #4 + QA #6**：原 plan watch 項無 operator → roadmap theater 風險。**加觀察 owner（grep 或 manual review）**，並補 3 條 coverage gaps（Architect F coverage）。

| # | 觀察項 | 信號 | Review 時點 | Owner |
|---|---|---|---|---|
| **T16** | v2.7.2 compact 觸發後 user-visible quality | compaction-state.md byte usage、turn count、resume-time 主觀感受 | 7 天 | manual: 第一次自然 compact 後 grep `~/.autopilot/compaction-state.md` |
| **T17** | `intent-capture` circuit-breaker triggered 與否 | flag 出現 = 過嚴；從未出現 = 過鬆或健康 | 14 天 | `test -f ~/.autopilot/intent-capture.disabled` |
| **T18** | review-loop catch ratio | 30 天後若 review-catch-rate < 50% → prompt design re-check | 30 天 | `autopilot:retro` 月度跑 |
| **T19** | Plan→Impl drift rate | 6 個月後若 L-size 連 2 次有 Critical drift → 建立 structured plan-impl contract | 6 個月 | retro 時 grep "Critical" in archive 內 plan→impl review log |
| **T26** | **Hook execution latency p50/p99**（per Arch coverage gap）| v2.7.2 hooks 共 12 Tier A，PostToolUse `.*` 4 hooks 累積延遲 — Ops r2 預計 ~150-200ms cumulative。觀察是否引起 user-perceivable lag | 14 天 | manual: `time` 一次 PostToolUse 鏈 |
| **T27** | **Rollback drill** — 練習 v2.7.2 → v2.7.1 user-side downgrade（per Arch coverage gap）| CHANGELOG 已寫 rollback 指令；確認真實可行 | 30 天 | manual: 另一台環境跑 rollback 指令 |
| **T28** | **Security/permissions surface review**（per Arch coverage gap）| v2.7.0 dispatch-config scope + v2.7.2 hook scopes：是否有 secret leak / file system over-permission | 60 天 | manual: grep `chmod 600` consistency + scan `~/.autopilot/` permission |

### Tier 5 — Explicit Skip（明示不做、無 trigger）

| # | 項 | 為何 skip |
|---|---|---|
| **T20** | UserPromptSubmit + `count_tokens()` API threshold detection | r0 think-tank unanimously REJECT（Architect / QA / Ops）; Architect 替代設計已實作 in v2.7.2 |
| **T21** | TaskList auto-rehydrate at SessionStart | Architect r0 警告耦合 undocumented internals; v2.7.2 用 read-only resume hint 已解 |
| **T22** | autopilot:tdd skill ship | CEO 已駁回（5/14）— TDD 是 coding loop 非 methodology layer，侵蝕 v2.7.0 brand boundary |
| **T23** | vendor `skill-creator` | CEO 已駁回 — 除非 superpowers 廢棄 |
| **T24** | 裝 `claude-powerloop-plugin` 體驗 | 概念已 absorb（B/A）+ MEMORY 已 reference；無 multi-session campaign 即時需求 |
| **T25** | Plan C handoff schema 在沒「第 3 pain sample」前 ship | **Re-evaluate per T6**：今天 sample = 3，T25 應 promote 到 T6 active status |

## 4. Phases

| Phase | Scope | Files | Estimate |
|---|---|---|---|
| L-2.5 | 3-reviewer plan loop — r1 absorbed | — | done |
| **P1a** | T1 alone：`scripts/sync-version.js`（Node.js，hardened spec）| `scripts/sync-version.js`（new）| ~40min |
| **P1b** | T2 + T3 + T4 + T5 batch | `.gitignore` + `docs/BACKLOG.md`（new）+ `skills/finish-flow/SKILL.md` + `hooks/README.md` confirm + `CHANGELOG.md` | ~20min |
| L-5 | finish-flow 6 sub-tasks | merge + archive + INDEX + push | ~15min |

**T6 default = stay Tier 2**（CEO author defends per QA r1 punt critique）。No P2。Trigger sharpened to「sample 4 in same sub-category」— 等真痛點再啟動。

**Plan archive after P1 (per Ops r1 #5)**：本 plan 不變 immortal roadmap — P1 ship 後，Tier 2-3 餘下 20 entries graduate to `docs/BACKLOG.md`（T3 同 commit 建的檔）。plan doc 隨 project archive 進 `_archive/`，BACKLOG.md 變 live 唯一 source of truth for future me。

## 5. Acceptance

1. ✅ Plan 涵蓋 **28 條 entries**（25 原 + 3 coverage gap T26-T28）— grep T1..T28 都在
2. ✅ Each entry 有明確 status / trigger / files / effort
3. ✅ P1a single commit（T1 alone）+ P1b single commit（T2-T5）= **2 commits 而非 1**（per r1 split）
4. ✅ `scripts/sync-version.js`（Node）可執行 + `--dry-run` flag + per-file exact-count `grep -c` verify + `.bak.$$` backup
5. ✅ **T1 verify spec test**：對當前 plugin.json (2.7.2 → fake 2.9.9) 跑 `--dry-run` → 應 print proposed diff + exit 0；再用 invalid hook-count（e.g. -1）→ exit non-zero + 不寫檔
6. ✅ `.gitignore` 加 `.in_use/`（only），**不**加 blanket `results/`（per Ops r1 #2 tracked baseline 保留）
7. ✅ `docs/BACKLOG.md` 存在 + 預植 ≥3 entries（from today's context-handoff Suggestions：symlink homedir、failure counter cleanup、disable flag malformed）+ entry format with mandatory trigger field
8. ✅ `skills/finish-flow/SKILL.md` L-5.5 含 multi-pattern regex `grep -E '\\((pending\|target\|in progress\|WIP\|TBD\|draft)\\)'`，emit matched lines on failure
9. ✅ `CHANGELOG.md` 頂部加 HTML comment template + hook-order semantic disclaimer
10. ✅ Plan 通過 3-reviewer loop r1（all CONDITIONAL→absorbed）；r2 optional per CEO DOA
11. ✅ Plan archive policy 文件化：P1 ship 後 Tier 2-3 餘下 entries graduate to BACKLOG.md（per Ops r1 #5）;本 plan archive 進 `_archive/`
12. ✅ **Verifiable proof gate for "future me knows triggers"**（per QA r1 #5）：r2 reviewer 或下次 session me 讀 plan 後在 60s 內能命名 ≥3 個 Tier 2/3 trigger 條件

## 6. Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | ~~T6 reviewer 挑戰升 P2~~ → **CLOSED**：r1 已採 CEO author defends default = stay Tier 2，trigger sharpened | — | — | r1 absorbed |
| R2 | T1 sync-version.js 寫 buggy logic、誤改 manifest | Low | Medium | Node 重寫消 sed 風險；`--dry-run` mandatory；`.bak.$$` per-file backup；per-file exact-count `grep -c` verify；any failure → restore + exit non-zero |
| R3 | T3 BACKLOG.md 太薄 → 未來自己 ignore | Low | Low | r1 fix：seed 3 entries from today + mandatory trigger field |
| R4 | T4 finish-flow grep guard regex 漏 case | Low | Low | r1 fix：multi-pattern allow-list；emit matched lines |
| **R5** | P1a / P1b 分 2 commits 但下個 push 時 review 漏第二個 | Low | Low | 同 branch、 same push、CHANGELOG bullet 同行表述兩 commit 用途 |
| **R6** | T26-T28 watch 項目無 active operator | Medium | Low | r1 已標 Owner column（manual grep / `time` / file existence check）|

## 7. Out-of-scope（不做、不在 P1）

- T6 完整 implementation（除非 reviewer 升）
- T7-T10 各 fix-cycle
- T11-T15 各長期 plan
- T16-T19 monitoring 不需 code change
- T20-T25 explicit skip

## 8. Inspired By / Credit

- 今日 retro：`autopilot:retro` skill + git log（origin/develop --since 2026-05-14）
- 25 條建議 evidence 來源：v2.7.0 / v2.7.1 / v2.7.2 三波 review findings + dogfood logs + Architect/QA/Ops 過去評估文書

## 9. 變更歷史

| 日期 | 事件 |
|---|---|
| 2026-05-14 | Plan v1 written after CEO Startup confirmed OKR / Level 3 / Selective scope |
| 2026-05-14 | Plan v2 — r1 reviewer findings absorbed: P1 split P1a/P1b, T1 → Node + hardened spec, T2 .gitignore narrowed, T3 seeded, T4 regex full, T5 location specified, T6 default defended, T9 trigger sharpened, T26-T28 coverage gaps added, plan archive policy documented |
