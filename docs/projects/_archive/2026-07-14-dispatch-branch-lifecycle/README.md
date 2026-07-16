# dispatch-branch-lifecycle — session-end 整合候選 gate + repo-branch reaper + 中間輪偵測／保全／人工處置

> Status: ✅ SHIPPED in v2.32.37 — merged as `d8ab47811be0f16bfab9f57278aae7cd6f1a895c` on 2026-07-16.
> Source: 2026-07-14 codex-worktree audit（`/home/twgs-dev/reports/2026-07-14-codex-worktree-audit.md`）§5 autopilot 側修法；BACKLOG「Dispatch-branch lifecycle」條目。
> Board 指令：CEO 寫 plan → hetero engine loop review 收斂 → 實作。

## OKR

**Objective**: 把「merge-back + branch/worktree GC 由 depth-0 負責」從純 prose 責任降級為 deterministic 工具 + gate，讓 TWGameProject 式殘骸（70 條 branch + 46-commit 整合候選懸空）成為結構上不可能靜默發生的事。

**Key Results**:
1. **KR1 — session-end gate**: finish-flow / front-door 收尾時存在一個 deterministic 檢查：dispatch-owned 整合候選 branch（`ceo-integration-candidate-*` 等）存在且 ahead>0 ⇒ 擋 clean exit、要求 merge/保留記 handoff/丟棄三選一明確裁決。
2. **KR2 — reaper 工具**: `scripts/reap-dispatch-branches.sh` 存在且 preserve-first：contained（`merge-base --is-ancestor`）⇒ bundle 存證後刪；未 contained ⇒ 保留並列出。絕不 fail-open 刪未存證內容。
3. **KR3 — 中間輪裁決**: 被取代的 `-r<n-1>` 中間輪 branch 可被 deterministic 偵測、保留並列入 manual-disposition 清單；只有已 contained 於 authoritative integration target 的 branch 可自動刪除，supersession 本身永不授權刪除。
4. **KR4 — 品質**: plan/review 無未決 Critical/Major；fixture red/green 與 diff-scoped zero-regression 綠。既有 portability/full-suite 非零須 base 重現並標 PRE_EXISTING DEFERRED，不冒充 pass。

## Scope（Hold — L-1.5 audit 結果）

| Dimension | In/Out | Note |
|-----------|--------|------|
| Source | IN | 新 `scripts/reap-dispatch-branches.sh`；gate wiring（finish-flow L-5.x + level-front-door §4/§5）；orphan-log prune 小修 |
| Tests | IN | `hooks/tests/reap-dispatch-branches.test.sh`（fixture repo、red/green） |
| Docs | IN | CLAUDE.md inventory row、`references/hetero-dispatch.md` branch-lifecycle 節、CHANGELOG |
| Version | IN | PATCH（新 script + gate 為 shipped-code 行為） |
| Codex payload | IN | 觸及 `skills/finish-flow` / `skills/ceo-agent/references` ⇒ `sync-codex-plugin-skills.sh`（pre-commit gate 會抓） |
| Consumers | IN | /l4-/l6 front-door prose 引用新工具 |
| TWGameProject 殘骸執行 | OUT | 使用者 2026-07-14 裁決全部擱置；本專案只出工具，不對該 repo 動手 |
| codex-native spawn_agent 納管 | OUT | 獨立 BACKLOG 條目 |
| E1 manifest 合規 gate | OUT | 獨立 BACKLOG 條目 |
| Migration / API | N/A | 無 |

## Phases

| Phase | Content | Status |
|-------|---------|--------|
| P0 | Plan 撰寫（docs/plans/2026-07-14-dispatch-branch-lifecycle.md） | complete |
| P1 | Hetero loop review of plan（agy Gemini + cc-shim GLM，5 generations；無未決 Critical/Major） | complete |
| P2 | 實作（TDD：fixture tests 先行；MiniMax verification-author artifact + foreman fallback） | complete |
| P3 | 實作 diff hetero review loop + 文件 wiring | complete |
| L-5 | finish-flow（quality gate → merge develop → archive） | complete |

## 已知限制（引擎面）

2026-07-16 Spark 與 Grok 4.5 已恢復。Canonical Spark fixer rail 會建立隔離 worktree，與本次 recovery 的「不得新增 worktree」硬限制衝突，因此 P3 修正沿用 Board 已核准的 depth-1 native fallback。Grok read-only review 可完成內容審查，但 CLI 會在 nonce wrapper 前加 preamble，canonical parser 因而誠實回報 `no_verdict`；raw wrapped block 僅作 finding/second-look 證據，結構化 clearance 由 Gemini/MiniMax 補足。Claude Code CLI 另遇 weekly 429（reset 2026-07-16 12:00 Asia/Taipei），只阻塞 release preflight 的五個 slash-entry LLM probes。

## P2 execution evidence（2026-07-15）

`dispatch-author.sh --strict-roster` 的 configured GLM-5.2 endpoint 連續兩次 API 529；Board 核准一次性 roster override 後，由 `cc-shim/MiniMax-M3@high` 產出 verification-author evidence，repo config 隨即 byte-for-byte 還原。Canonical Spark implementer 以 current-checkout/no-worktree 方式嘗試兩次，均卡在 model-refresh/futex 且零 artifact；Board 因此核准本 foreman 依已收斂 plan 與 executable verification 實作。持久證據以 git diff、ledger provenance 與可重跑測試為準，不宣稱任何暫存最終 artifact。

Recovery 的 test-only negative control 在 immutable base `8250dc9` 得到 `RED_RC=1`，失敗為 registered orphan worktree 未 retry/remove 與 log 未清除兩個行為 assertion（非缺檔/import failure）。現行 focused GREEN 計數為 `reap-dispatch-branches.test.sh` 103、`dispatch-hetero-gc.test.sh` 42、`worktree-reap.test.sh` 18。完整 `hooks/tests/run.sh` 有 2/142 groups failed：inherited host-config test hermeticity 與 inherited OpenCode V2；其餘 140 組通過，這兩組不冒充為 pass。L1 直接重驗證實清除 session marker 後，真 HOME 因 `~/.autopilot/config.json` 啟用 context-budget/orchestrator-edit-gate，`node --test hooks/*.test.js` 仍為 121/123（兩個 disabled assertions exit 2）；隔離 `HOME=$(mktemp -d)` 後同命令為 123/123，故根因是測試只清 env、未隔離 host opt-in config。文件修正前的 `git diff origin/develop` 實際差異為 31 paths、`+3205/-112`；本專案最終 cap 為 ≤35 paths 且 total churn（insertions+deletions）≤3500。

## P3 review + QC evidence（2026-07-16）

完整 implementation diff 以 artifact-only canonical `dispatch-review.sh` 盲審；所有 round 2+ prompt 均先通過 suppression + redispatch linter。Gemini r1/r2/r3/r4 皆為結構化 `SHIP-AS-IS`；MiniMax-M3 額外 leg 為結構化 `SHIP-AS-IS`。Grok r2 raw block 為 `SHIP-AS-IS`，r3 raw block 為 `FIX-THEN-SHIP`，r4 raw block 回到 `SHIP-AS-IS`；三次皆因 wrapper 前 preamble 被 parser fail-closed 成 `no_verdict`，未被冒充為結構化 pass。最終 evidence 以 git diff、結構化 verdict 紀錄與可重跑 gates 為準；不宣稱暫存 review log/diff 是持久 artifact。

所有可驗證 finding 均先重現再修；P3 首輪後 authoritative QC 再驗出 fail-open enumeration、非 local target、ack/worktree/CAS races、orphan-log rewrite、cherry-pick containment 與 preserve-first 文件缺口。舊的 risk-20 pipeline 已正式以 **BLOCK** 關閉；其後另起 fresh bounded repair pipeline，risk 重置並更新為 15，兩條 pipeline 的 verdict/risk 不合併記錄。Fresh pipeline 對應的 focused GREEN 為 reaper 103、orphan-GC 42、worktree-reap 18；exact-ref 回復僅透過 prepared no-deref transaction 嘗試，raced direct ref/symref 一律 abort/fail closed，且 verified bundle 仍是 authoritative recovery artifact。最終 cap 與 full-suite residual 以上段實際數字為準。

## L-5 completion evidence（2026-07-16）

- Merge: `d8ab47811be0f16bfab9f57278aae7cd6f1a895c` on `develop`.
- Final goal/security audit: PASS. Cross-family evidence: Spark full formal SHIP；Gemini exact-union 3× formal SHIP；Grok full raw SHIP，但 canonical parser 誠實回報 `no_verdict`。
- Focused GREEN: reaper 103、orphan-GC 42、worktree-reap 18。
- Umbrella suite: 2/142 groups failed，均為 inherited baseline groups，不冒充 full pass；portability/OpenCode/eval case 13/17 為 inherited `PRE_EXISTING DEFERRED`。
- Post-merge doc-sync 補上 SHA-1-only 限制：durable ack 與 destructive reap 目前只支援 40-hex SHA-1 object IDs；SHA-256 repos 的 `scan` 仍為唯讀可用，寫入／刪除路徑 fail closed，並以 trigger-bearing BACKLOG follow-up 追蹤泛化。
