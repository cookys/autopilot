# autopilot — BACKLOG

Trigger-conditioned future work. Each entry must have:
- **Trigger**：what must be true / observed before this fires
- **Context**：one-line problem statement
- **Effort**：S / Fix / L estimate
- **Source**：commit / review-round / retro that surfaced it

Entries without a trigger are rejected (per `skills/quality-pipeline/references/code-review.md` backlog spec).

**Discovery**: when starting any work, `grep <topic>` here. Plan-doc-as-roadmap (`docs/plans/2026-05-14-retro-roundup.md`) post-archive 後遷移 entries 也都歸這裡。

---

## Format example

```markdown
### <Topic title>
- **Trigger**: <observable condition; e.g. "next time touching X" / "after sample N of behavior Y" / "performance degrades below threshold Z">
- **Context**: <one-line problem>
- **Effort**: S | Fix | L (estimate)
- **Source**: <commit SHA / review-round / retro / plan ref>
```

---

## Active entries

### `check-redispatch-prompt.sh` has no test (pre-existing gap)
- **Trigger**: next time `check-redispatch-prompt.sh`'s patterns are edited, OR an idle batch to close test-coverage gaps.
- **Context**: surfaced by the v2.25.0 Ops dialectic — the round-2+ leaky-phrase linter (`scripts/check-redispatch-prompt.sh`) ships with **zero test coverage** (its new sibling `check-dispatch-suppression.sh` got a 16-assertion test). Editing its regex is unprotected. Mirror `hooks/tests/check-dispatch-suppression.test.sh`: positive (leaky phrase caught) + negative (honest re-dispatch prompt passes) fixtures, auto-discovered by `run.sh`.
- **Effort**: S.
- **Source**: 2026-06-24 v2.25.0 ship (`05d02e4`) Ops review.

### Depth-0 loop hardening — content-fingerprint no-progress + hook backpressure (from loop-engineering study)
- **Trigger (a)** content-fingerprint: a real case where a foreman/dispatch loop **runs busy but makes no actual progress** (same diff / same verdict across rounds) and the **round cap (3)** lets it burn most of a budget before tripping — i.e. the crude round cap proves too loose. **Trigger (b)** backpressure: only if the `/loop` + event-driven harness integration ([[project_harness-integration-direction]]) is actually built out into an event/webhook-fed loop.
- **Context**: 2026-06-24 study of `maxmilian/loop-engineering` found autopilot already embodies all 7 of its loop principles (verify-by-artifact, machine-checkable done, budget/escalation exits, filesystem-as-memory via `tree.sh`, semi-autonomous DOA gate). The ONE grdually-coarse spot: autopilot's depth-0 has a **wall-clock stall detector** (hung foreman trips the clock, `level-front-door.md:207`) + round cap + WTF cap, but no **loop-fingerprinting** (content/state unchanged across N cycles ⇒ break EARLY, before the round cap). And hook **rate-limiting/backpressure** (webhook-storm guard) is a non-gap today (tool-event + self-paced triggers) that becomes relevant only if event-driven `/loop` deepens.
- **Effort**: S (fingerprint = compare round-N diff/verdict hash to round-N-1, break on match) / S (backpressure, when/if relevant).
- **Source**: 2026-06-24 `maxmilian/loop-engineering` study (see [[project_loop-engineering-mirror]] memory).

### agent-skills study — rejected items (don't re-litigate)
- **Trigger**: a CONCRETE incident matching one of the rejected items below (not "it seemed like a good idea again").
- **Context**: 2026-06-24 study of `addyosmani/agent-skills` → 2-round Architect/Ops/Skeptic dialectic. Shipped 3 inline edits (E1 doubt-theater self-audit → `blind-dispatch.md`; E2 LLM-Top-10 → `reviewer.md` security axis; E3 metric-honesty → `profiling`). **Rejected** (full reasoning in `docs/plans/2026-06-24-agent-skills-learnings.md`): **C1 WebFetch revalidation cache** — zero observed re-fetch pain in the repo, extra HEAD-per-miss, cached body is a model-post-processed reading (304 revalidates bytes not the rendering), AND whether a PreToolUse WebFetch hook can even *return* a substitute result is UNVERIFIED (spike first if ever revisited). **C3a dead-cross-skill-ref detector** — the `→ skill` arrow collides with prose (`→ add`/`→ execute`...), FP-catastrophic; revisit ONLY after migrating cross-refs to a strict `[[skill:x]]` syntax. **C4 security persona** — would reverse the recorded `reviewer.md:70` decision (deep security delegated to native `/security-review`); only the LLM-Top-10 content was the real gap, landed as E2. **C2 doubt-driven skill** — CLAIM-stripping already shipped in `blind-dispatch.md` + the v2.24.0 refute pass; only the doubt-theater signal was missing, landed as E1. **O6 dual-env-var hook fallback** — genuine but solves a non-biting dogfood-path problem. Other O-tier net-new skills violate `skill-refactor-rules`.
- **Effort**: varies (each gated by its own trigger).
- **Source**: 2026-06-24 `docs/plans/2026-06-24-agent-skills-learnings.md` dialectic.

### qc-panel refute pass — graduate from shadow to gating (calibration-gated)
- **Trigger**: `scripts/calibration.sh report` over accumulated refute-shadow samples shows the refute pass does **not** false-suppress critical/`MISSED:` findings (meets the existing graduation-criteria data block). Until then it stays shadow.
- **Context**: v2.24.0 shipped the refute pass as **shadow / non-gating** — it emits `refute_shadow` + rides into the calibration `--source` tag but never alters `verdict` (a refute pass that suppresses a true critical is worse than the bug it fixes). Graduation = wire the survived/refuted result into the authoritative verdict, but only after calibration proves it safe. Also fold in the depth-0 reviewer 🔵: add a regression assertion to `hooks/tests/qc-panel.test.sh` that a stubbed refute judge returning `REFUTED` for a real miss still yields `verdict=fail` (locks the non-gating invariant mechanically before any graduation can silently break it).
- **Effort**: S (the test) now + L (graduation) when the trigger fires.
- **Source**: 2026-06-24 v2.24.0 ship (`77214a1`) + depth-0 qc 🔵 (reviewer `a4162329`).

### `/l5` hetero-parallel width fan-out (machinery built, deliberately unwired)
- **Trigger**: a **concrete, repeated** need to fan a single batch out across multiple *heterogeneous* (agy/Gemini) workers in parallel — i.e. real `/l5` task-supply where the cost-arbitrage of a second engine actually pays, AND the base-correctness + engine-variance risks are acceptable for that workload.
- **Context**: Phase L shipped `/l4` homogeneous (Claude) batch fan-out. The deterministic rails for the hetero-parallel path **already exist** — `dispatch-batch.sh reap` is the SIGTERM-to-pgroup parallel-kill trap built for shell-dispatched workers (setsid-verified), and `dispatch-hetero.sh` is the single-unit hetero dispatcher. What's unbuilt is the loop that fans `dispatch-hetero.sh` across N units under `dispatch-batch.sh`'s verify/merge-back/reap. It was **cut at plan time** (the weakest leg: base-correctness × engine-variance × *rarest* task-supply — speculative on speculative). S0.a then confirmed wide task-supply is already thin even homogeneously, so this is one-day-to-wire-IF-needed, not a gap. `/l4` homogeneous is the value path.
- **Effort**: S (wire existing rails) — only if the trigger fires.
- **Source**: 2026-06-23 `docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md` scope-cut + Phase L ship (`577ba8d`).

### ✅ DONE (2026-06-22, `e96998d` via /l4 dogfood) — subagent-driven-development: explicit BLOCKED / incomplete-return handling
- **Resolution**: `skills/team/references/team-tactics.md` gained a `## Dispatched-Subagent Return Contract` section — 4-value status enum (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED) + orchestrator action per status, BLOCKED→re-scope/escalate explicit. No separate spec-reviewer rebuilt (reviewer.md already covers spec-compliance, as the original note required). Landed as the `/l4` dogfood payload for `ceo-fleet-autonomy`.
- **Trigger**: next time a dispatched implementer subagent returns **incomplete / blocked** (NEEDS_CONTEXT, partial, gave up) and the orchestrator mishandles it (proceeds as if done, or stalls silently).
- **Context**: From the superpowers-parity survey (2026-06-04). superpowers' `subagent-driven-development` has (a) a two-stage **spec-compliance → code-quality** review ORDER and (b) explicit dispatched-subagent return-status handling (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED). Light design found (a) is **already covered** — `agents/reviewer.md` v2.12.1/v2.12.3 folded claim-completeness / "claimed but missing: decompose / claim-scope = unit of done" into the reviewer, which IS spec-compliance within `quality-pipeline`. The residue is (b): a documented status-enum + escalation for incomplete implementer returns, landing in `skills/team/references/team-tactics.md`. Today this works ad-hoc (the orchestrator sees an incomplete return and re-dispatches); formalizing is nice-to-have, not biting.
- **Proposed**: add a short "dispatched-subagent return contract" to team-tactics (status enum + BLOCKED→re-scope/escalate path). Do NOT rebuild a separate spec-reviewer (reviewer already does it).
- **Effort**: S
- **Source**: 2026-06-04 superpowers-parity inventory + research-to-ship light design (CEO-deferred: no biting value for self-use yet).

### writing-skills: RED-phase pressure-testing for behavior-shaping skills
- **Trigger**: when autopilot starts **publishing skills broadly** (beyond self-use / the distill pack), OR a distilled/authored skill ships and then visibly fails to shape behavior (agents rationalize around it).
- **Context**: superpowers' `writing-skills` applies TDD to skill docs — a RED phase (run a pressure scenario WITHOUT the skill, watch the agent rationalize, then write the skill to close those exact loopholes) + rationalization tables + Cialdini-grounded rules. Light design (2026-06-04) found this is **calibrated for public shared codebases (94% PR rejection)** and **overkill for self-use**; it's also coupled to `distill` maturity. The cheap high-leverage bit — the **CSO description principle** (description states triggering conditions only, never a workflow summary) — is **already autopilot practice** (see `brainstorm` / `research-to-ship` descriptions). So the genuine remaining delta is only the RED-phase apparatus, which is deferred.
- **Proposed**: if/when publishing, add a RED-phase intake gate to `distill` Step 3 (pressure-scenario baseline → write → loophole-close). Until then, keep CSO-only.
- **Effort**: M (distill-coupled)
- **Source**: 2026-06-04 superpowers writing-skills study + research-to-ship light design (CEO-deferred: self-use doesn't warrant the apparatus).

### `/compact` slash-command silent miss documentation
- **Trigger**: 任何 user 想用 `/compact` 測 state-checkpoint hook 時 — 必須先讀本條
- **Context**: 2026-05-14 method-B testing 發現：Claude Code 的 `/compact` slash command 觸發 PreCompact hook 時**不 pipe JSON payload**，而是讓 hook 撞 ENXIO on `/dev/stdin`。Auto-compact (~150K-token threshold) DOES pipe payload — 兩條路徑不對稱。
- v2.7.2 fix: state-checkpoint.js ENXIO 改 graceful skip (log `no_payload_skip` 而非 `catastrophic`)，所以未來不會 misleading log。但**根本性質仍在**：`/compact` 無法測 state-checkpoint 抽取邏輯，只能驗 hook reachable
- **Future action options**:
  - (a) 在 `hooks/README.md` 加 note「`/compact` ≠ real PreCompact for testing」
  - (b) 跟 Claude Code 反饋此 slash-command 應該 pipe consistent payload
  - (c) state-checkpoint 用 fallback（無 stdin 時自行 spawn `claude --transcript-path-query` 或讀 `~/.claude/projects/$CWD_HASH/*.jsonl` 最新檔）
- **Effort**: (a) S; (b) external — out of scope; (c) M, 但複雜度未必值得
- **Source**: 2026-05-14 v2.7.2 method-B verification — user diagnostic report

### PostToolUse dispatch dies after `/clear` — process restart required（verified）
- **Trigger**: 下次有 user 回報 intent-capture / audit-log / reload-watch 在 long-running session 沒更新；或 Claude Code 升級 release notes 提到 hook dispatch 變更
- **Context**: 2026-05-14 三階段觀察，verified via fresh-process test：
  - **Phase 1**: post-`/reload-plugins` intent-capture 跑 ~20 次 burst 後 stagnate 9+ 分鐘
  - **Phase 2 (post-`/clear` 同 session)**: 全部 PostToolUse hooks 不 fire（intent count, reload-watch mtime, audit-log 全凍）。`/reload-plugins` reload 11 hooks 但 **不 re-init dispatch**
  - **Phase 3 (fresh `claude` process 驗證)**: PostToolUse `.*` matcher **復活** — intent count 10→11、mtime 變新。**確認**：`/clear` + `/reload-plugins` 不 re-init PostToolUse dispatch、fresh process boot 才會
- **Verified hypothesis**: Claude Code PostToolUse dispatch table 跟 process boot 綁定一次性 init
- **Workaround**: 完整 exit + relaunch `claude`（不是 `/clear`、不是 `/reload-plugins`）
- **Impact**: v2.7.2 cross-session intent recovery 在 long-running session post-/clear 失效；user 不會察覺到 hooks 已 dead
- **Next step options**:
  - (a) **detect (SPIKE-GATED — do NOT write code first)** — auto-detect at SessionStart and prompt restart. **v2.8.1 dialectic (5/6) ruled the naive heuristic NON-FUNCTIONAL**, not merely risky: (1) the intent file is keyed by `sha1(realpath(cwd))`, *not* session_id; (2) SessionStart runs at boot *before* the new session's first PostToolUse writes the new session_id, so the file still shows the prior id — indistinguishable from a dead-dispatch `/clear`; (3) dispatch dies *mid*-session but SessionStart only fires at the *next* entry (already a fresh live process); (4) `intent.tool_count` is written by the very hook that's dead → invalid liveness oracle. **Required spike before any (a) code**: empirically verify what `CLAUDE_CODE_SESSION_ID` does across `startup` / `clear` / `compact` (same vs new value, and write-ordering vs SessionStart) in a fresh `claude`. Only if a clean discriminator exists is (a) buildable.
  - (b) upstream report 給 Claude Code（PostToolUse re-init on `/clear` matcher dispatch）
  - (c) ✅ **DONE v2.8.1** — `hooks/README.md` "Is my PostToolUse dispatch dead?" section: deterministic manual check (run a Bash tool → did `bash-commands.log` gain a line?) + recovery (full restart).
- **Effort**: (a) spike ~15min + M if buildable; (b) external; (c) ✅ done
- **Source**: 2026-05-14 v2.7.2 post-`/clear` diagnostic + fresh-process verification; 2026-06-02 v2.8.1 hook-followups dialectic (KR2 deferred → docs-only)

### Claude Code tool-event hooks get NO stdin pipe — event-type-specific, not version regression
- **⚠️ CORRECTED 2026-06-23 (v2.23.0)**: the diagnosis was **too broad**. It is only the **`/dev/stdin` PATH open** that throws ENXIO — the payload **IS** delivered on **fd 0**. Reading fd 0 directly (`fs.readFileSync(0, 'utf8')`) recovers it; verified e2e on **2.1.186** (probe hook saw the JSON; a real PreToolUse hook returning exit 2 blocked the tool). The official-docs `jq '.tool_input.command'` example fails because it reads via a path/`/dev/stdin`-style open, not because stdin is absent — `INPUT=$(cat)` (fd 0) works (rtk's hook proves this). Net: PreToolUse hooks are **not** unrecoverable; they just must read fd 0. The 3 blockers were re-enabled (opt-in) in v2.23.0 on this basis. Everything below is the original (over-broad) finding, kept for history.
- **Trigger**: 立即（影響所有 PreToolUse / PostToolUse hooks since hooks were authored）
- **Context**: 2026-05-14 兩輪 fresh-claude transcript 驗證收斂：
  - **Round 1 (2.1.141)**: 11 tool-event hook fires 全 ENXIO opening `/dev/stdin`
    - transcript `76a7e1b6-...jsonl`
    - PostToolUse:Bash × 4 + PreToolUse:Bash × 3 + PreToolUse:Read × 2 全部 ENXIO
    - SessionStart + Stop 正常
  - **Round 2 (2.1.129 downgrade test)**: 同 transcript 結構 `7bd61ac4-...jsonl`，**同 ENXIO**，`~/.claude/bash-commands.log` mtime 沒動
  - **2.1.128 binary strings**: 無 `EPIPE.*hook` markers（同 2.1.129），同類 issue 推斷一致
  - **Round 3 (2.1.159, 2026-06-01 `/next` probe)**: **仍 broken**。`~/.autopilot/intent/<cwd-hash>.json` 顯示 `last_tool: <unknown>` 但 `tool_count_session: 41` — PostToolUse 這 session fire 41 次、stdin 仍未 pipe（讀不到 tool_name）。確認 bug 跨 2.1.128→2.1.159 持續存在、Anthropic 尚未修。
- **Final root cause**: 不是版本 regression — 是 **Claude Code 的 hook stdin pipe 對 PreToolUse / PostToolUse event 從來沒運作**（at least on Linux + this Bun-spawned Node 環境）。SessionStart 跟 PreCompact 用不同 spawn path 所以 work
- **Critical implication**: Anthropic docs 內附 example `jq -r '.tool_input.command' >> ~/.claude/bash-log.txt`（給 PreToolUse Bash logging）**也是 broken** — 不只我們 hooks 受影響、官方 docs example 也跑不動
- **Impact** (all silent due to fail-open hook convention):
  - 所有依賴 `tool_input` / `tool_response` 的 hook 都 broken（audit-log, failure-escalation, large-file-warner, suggest-compact, design-quality, ...）
  - intent-capture 仍 write file 但 `last_tool: <unknown>` — v2.7.2 cross-session resume degraded
  - `~/.claude/bash-commands.log` 從未存在（audit-log silent-skip）
  - autopilot tool-event hooks 從未 e2e tested via real Claude Code dispatch（過去只 heredoc synthetic 測 script 本身）
- **Workaround paths** (next-step decision):
  1. ~~Downgrade~~ **RULED OUT** by Round 2 test
  2. **Upstream comment**（updated 2026-05-14 post web-research）：**comment on existing open issue `#6305`** 而非 file 新 — Anthropic close 同類 issue "not planned" 多次（#9567, #6403, #38162）、新 issue 預期低 ROI。#6305 reporter 已給 macOS 範例、加 Linux ENXIO + 2.1.139 changelog correlation + binary strings diff 補強
  3. **Hook design pivot** ✅ DONE in v2.8.0 (project `2026-06-02-hook-transcript-pivot`): PostToolUse hooks read transcript JSONL via `transcript-reader-lib.js`. Re-enabled: intent-capture `last_tool`, audit-log, log-error, failure-escalation. PreToolUse (large-file-warner, branch-protection, commit-secret-scan) **permanently unrecoverable** by this approach (tool hasn't run). **Remaining follow-up** (not done): suggest-compact (PostToolUse Write|Edit — recoverable, deferred), cost-tracker + session-summary (Stop events, env-driven — separate verification, NOT tool-event-stdin).
  4. **Disable broken hooks** ✅ DONE in `c5e5a4c` (v2.7.4)
- **Web research (2026-05-14)**:
  - **同 class issue 出現多次跨多平台**：macOS（#9567, #6403, #6305）、Windows（#17424, #36156, #46601）、Linux（我們確認 + 暗示 in #38162 inverted-async-bug）
  - **Anthropic 不修紀錄**：#9567, #6403 closed not planned 無回應；#6305 仍 open 無回應
  - **changelog smoking gun**：v2.1.139 `Fixed a bug where a hook writing to the terminal could corrupt an on-screen interactive prompt; hooks now run without terminal access` — 拔 hook terminal access 後 `/dev/stdin` open 拋 ENXIO；但 2.1.129 (pre-2.1.139) 也 ENXIO 表示 bug 比這次改動更早
  - **`ruvnet/ruflo #1172` 反證**：claude-flow 在 2.1.45–47 Linux Node v22 **正常** stdin → 退化發生於 2.1.47 → 2.1.128 區間（autopilot intent file 史上 `last_tool: <unknown>` 對應）
  - **官方 docs example `jq -r '.tool_input.command'` broken** — 強化 case
- **Effort**: (2) comment on #6305 ~30min；(3) L-size ~6-10hr
- **Recommendation**: 等 1-2 週看 (2) comment 有沒有回應；若無、(3) hook design pivot 排上 next L-size
- **Source**: 2026-05-14 fresh-claude transcripts `76a7e1b6-...` (2.1.141) + `7bd61ac4-...` (2.1.129)；binary strings diff 2.1.128/129/141；Claude Code official changelog v2.1.139；GitHub issues #6305, #9567, #6403, #38162, ruvnet/ruflo #1172

### Re-enable v2.7.4 disabled hooks once upstream stdin-pipe lands
- **Status (2026-06-23, post-v2.23.0)**: ✅ the **PostToolUse tool-event** hooks were re-enabled by the **transcript pivot** (`log-error`/`audit-log`/`failure-escalation` v2.8.0, `suggest-compact` v2.8.1). ✅ the **3 PreToolUse blockers** (`large-file-warner`, `branch-protection`, `commit-secret-scan`) were re-enabled **opt-in in v2.23.0** — NOT by waiting for upstream, but by the **fd-0 read fix** (the "permanently unrecoverable" claim was wrong: only the `/dev/stdin` PATH is broken, fd 0 works — see the corrected stdin entry above). e2e-verified on 2.1.186 + `reenabled-blockers.test.sh`. **Remaining:**
  - **Stop-event hooks** (`cost-tracker`, `session-summary`): verified 2026-06-23 (v2.23.0) — fd 0 works for Stop too (`/dev/stdin` still ENXIOs). ✅ `session-summary` re-enabled opt-in (it only needs git+env; fd-0 read fix). ⛔ `cost-tracker` **stays disabled** — the blocker is NOT stdin: the **2.1.186 Stop payload carries no `usage`/`model` field** (keys: session_id, transcript_path, cwd, permission_mode, effort, stop_hook_active, last_assistant_message, background_tasks, session_crons), so it would always early-exit at 0 tokens. **Re-enabling cost-tracker needs a transcript-sum rewrite**: read `transcript_path` from the Stop payload and sum `usage` across the assistant turns. This is the **only hook left disabled**.
- **Trigger** (任一觸發即跑驗證、全綠才 re-enable — applies to the PreToolUse blockers):
  1. Claude Code release notes 提到 hook stdin / PreToolUse / PostToolUse fix
  2. autopilot user 在 issue / discussion 報「audit-log 突然有 entries」「branch-protection 真的 block 了」
  3. 距 v2.7.4 ship 過 30 天且想主動 re-test（避免無限拖延）
  4. 跑 path (3) transcript-file pivot 前先做這個 verification — 確認還是 broken 才值得寫 L-size code
- **Verification recipe**:
  1. `cd ~/projects/autopilot && scripts/toggle-payload-capture.sh enable`
  2. 新 terminal 跑：`AUTOPILOT_CAPTURE_PAYLOAD=1 claude`（用 current version OR 指定 binary path）
  3. 在 fresh claude 跑 `echo TEST_$(date +%s)` + read a small file + exit
  4. `ls ~/.autopilot/payloads/` — **要看到 4 個檔（pre-bash + post-bash + pre-read + post-star）**且 stdin_parsed 不是 null
  5. 同 transcript（最新 jsonl in `~/.claude/projects/-home-cookys-projects-*/`）grep `"stderr":"[^"]*ENXIO"` 必須 **0 hits**
  6. `scripts/toggle-payload-capture.sh disable`
- **Re-enable order** — remaining only (the 6 log-only PostToolUse hooks are DONE via v2.8.0/v2.8.1):
  1. **Stop-event hooks** (separate verification, NOT #6305): `cost-tracker` → `session-summary`. Re-enable each, fresh claude, confirm artifact (`~/.claude/metrics/costs.jsonl` row, `~/.claude/sessions/{date}-{sid}.md`).
  2. **PreToolUse blockers**（最後，gated on upstream stdin fix）: `large-file-warner` → `branch-protection` → `commit-secret-scan`
     - 每個都試一個 **正常操作不被誤 block**（read small file、commit secret-clean code、push to feature branch）
     - 再試一個 **應該 block 的操作** 驗真的 block（read 5MB 檔、push to main、commit with 假 API key）
- **Effort**: PreToolUse re-probe ~15min；2 Stop hooks 重 wire + smoke ~20min；3 blockers 重 wire + 雙向 smoke ~45min
- **Rollback**: 任何 re-enable 後出現問題 → `git revert <re-enable-commit>` + `/reload-plugins` OR 直接 edit hooks.json 拔回前一狀態
- **Don't forget**: re-enable 完同步 CHANGELOG + `hooks/README.md` 對應 section
- **Source**: 2026-05-14 v2.7.4 disable batch ship（`c5e5a4c`）；2026-06-02 v2.8.0 transcript pivot + v2.8.1 suggest-compact re-enable

### Investigate `/reload-plugins` hook count discrepancy
- **Trigger**: 下次有人寫 reload-watch 邏輯時，或 Claude Code update 改 hook reload semantics
- **Context**: 2026-05-14 v2.7.2 post-reload 觀察 `/reload-plugins` 回報「11 hooks」但 hooks.json 實際 13 entries (1 PreCompact + 1 SessionStart + 3 PreToolUse + 6 PostToolUse + 2 Stop)。差 2 — 可能忽略 SessionStart 或 PreCompact runtime hook count。Live functionality OK（intent-capture 確認 firing post-reload）
- **Effort**: S（看 Claude Code source / docs 確認 count semantics）
- **Source**: 2026-05-14 v2.7.2 post-ship reload verification

### Generated `.opencode/agent-bodies/*.body.md` relative links break one level deep
- **Trigger**: next time `scripts/sync-agent-bodies.sh` is touched, OR an OpenCode agent reports a dangling `code-review.md` link
- **Context**: 2026-06-02 link-check found `.opencode/agent-bodies/reviewer.body.md` inherits `../skills/quality-pipeline/references/code-review.md` from `agents/reviewer.md` — correct at `agents/` depth, but resolves to `.opencode/skills/...` (missing) from `.opencode/agent-bodies/`. Generated artifact; the link is informational and the body is consumed via OpenCode `{file:..}` inline, so low severity. Fix options: (a) sync script rewrites `../` → `../../` for links when generating bodies; (b) make the source links repo-root-relative; (c) accept. NOTE: the v2.7.x validate.sh link-check is scoped to `skills/` only, so this does NOT fail CI today.
- **Effort**: S (fiddly — link-rewriting in the sync script risks other links)
- **Source**: 2026-06-02 level-3 deep scan + validate.sh link-check enhancement

### hetero-dispatch skill wrapper (and/or dispatch-config Implementer chain)
- **Trigger**: after 2-3 more real uses of `scripts/dispatch-hetero.sh` beyond the `_bodies` relocation (recurrence proven), OR when a second engine (gemini CLI / codex / `opencode run`) passes the headless-equivalence spike and the engine choice needs routing logic.
- **Context**: heterogeneous dispatch shipped script-first (v2.15.0): `scripts/dispatch-hetero.sh` + `references/hetero-dispatch.md`. Per distill philosophy, the skill wrapper (when-to-use routing, forcing-function TaskCreates for the review-before-merge step, possible `dispatch-config.md` Implementer chain + `resolve-dispatch.sh` runner field) waits for recurrence instead of speculative construction — same reasoning as the 2026-06-04 workflow-parallelization deferral.
- **Effort**: S (skill) + S (resolve-dispatch runner field, if chain routing is wanted) + S (user-facing README section for hetero-dispatch — deliberately deferred to ship together with the skill so the public story is written once)
- **Source**: 2026-06-11 hetero-dispatch spike + first production use (`a83c04a`); CEO decision to ship script-first.

### Tree-engine graduation Board review
- **Trigger**: `~/.autopilot/calibration/samples.jsonl` reaches 50 reviewer-baseline samples OR 30 days after the first shadow run (2026-06-12), whichever comes first.
- **Context**: Amendment 6 — Board decides graduate / extend / abort based on `scripts/calibration.sh report` output. Silence is NOT extension. P6 adapter post-signoff activation is blocked on a `board_signoff` event recorded in the project tree (see `references/tree-contracts.md` §3.12 and `scripts/tree.sh board-status`).
- **Effort**: Fix (Board review meeting; not a code task)
- **Source**: task-tree-engine P5 close-out (2026-06-12); R1 review round Fix M1.

### ✅ DONE (2026-06-22, `b274439` via /l5 hetero dogfood) — resolve-doa.sh override-row preset-column injection (sibling of v2.17.0 fix)
- **Resolution**: `scripts/resolve-doa.sh` gained `valid_token() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]; }` (byte-identical to the `resolve-dispatch.sh` sibling), guarding the override `preset_val` before `emit_preset_json` — invalid token → stderr warning + fall-through to defaults. Implemented by **Gemini 3.5 Flash (High)** via `dispatch-hetero.sh` and passed an adversarial depth-0 qc (injection/quoting/condition-sense all verified). Landed as the `/l5` dogfood payload for `ceo-fleet-autonomy`.
- **Trigger**: next time `scripts/resolve-doa.sh` is touched for any reason.
- **Context**: v2.17.0 review found override-config column values flow into printf-built JSON in both resolve-* scripts. resolve-dispatch.sh got allowlist validation on extracted model/mode (warn + fall back to defaults); resolve-doa.sh has the same vector on its Preset column — though its `emit_preset_json` maps unknown presets to fail-closed, the `role`/`tier` echo-back fields are sanitized at entry, so exploitability is lower still. Verify and, if needed, apply the same `valid_token` pattern for symmetry.
- **Effort**: S
- **Source**: 2026-06-12 tree-role-dispatch pre-merge review (🔵 Suggestion 2).
- **2026-06-15 note**: `resolve-doa.sh` was touched by the cwd-config-resolution fix (`fix/resolve-doa-cwd-project-config`). The Preset-column vector was re-reviewed and **consciously deferred** — the new code only changed config-path resolution (`$PWD` is never used as a regex/pattern), and the unknown-preset → fail-closed mapping still holds, so risk is unchanged and low. Allowlist symmetry remains open.

### agy install symlinked-dest self-copy truncation — guard install script + upstream report
- **Trigger**: before the next `agy plugin install` of autopilot anywhere in the fleet (until the guard ships, manually check `ls -la ~/.gemini/config/plugins/` for symlinks first), OR next S-size hardening slot.
- **Context**: 2026-06-11 incident, **mechanism CONFIRMED by sandboxed repro same day** (repro spike ✅ done): `agy plugin install` follows a symlinked destination `~/.gemini/config/plugins/<name>` and self-copies — open+truncate "dest" (= source through the symlink), read back empty, write 0 bytes, file after file. Sandbox: symlinked dest → 1497 files zeroed + `.git/HEAD` destroyed. Incident = legacy symlink from the 5/29 agy-1.0.1 era; the first (failed) install truncated 55 files before dying on read-only `.git` object `008efd…` (same object in sandbox — deterministic walk); uninstall/reinstall exonerated (all 4 sandbox control phases clean). Hazard + guards documented in `references/multi-agent-portability.md` § agy spike.
- **Remaining**: (c) upstream report to Antigravity — 3-line deterministic repro (clone, `ln -s` dest, install), verified on 1.0.5 AND 1.0.7 (latest). **Intentionality research (2026-06-11)**: plugins-dir symlinks are plausibly THEIR OWN plumbing (1.0.1 installed to a private app-data dir, 1.0.2 moved to `~/.gemini/config/` — our legacy symlink dates from exactly that 1.0.1-era install; community docs also describe the IDE symlinking `antigravity-ide/plugins/` → `config/plugins/`), which makes the kill condition reachable WITHOUT user error — lead with that in the report. The destructive follow itself is clearly unintentional: undocumented, no changelog entry, inconsistent with their security posture (IDE refuses to follow symlinked skills, vercel-labs/skills#633) and with their own bug taxonomy (1.0.5 fixed "settings silently wiped out"). No existing issue covers it (searched; only #327, an unrelated macOS `/var` resolution bug) — we would be first reporters.
- **Done**: (b) ✅ v2.15.1 — preflight guards in `install-antigravity.sh`/`.ps1` (symlink refuse never bypassable; dirty/unpushed/non-git behind `--skip-git-checks`; 16-assertion test).
- **Effort**: (c) S (report writing; needs user's go on identity/account)
- **Source**: 2026-06-11 incident + same-day sandboxed repro spike (H1/H2/H3 refuted, H6 symlink-dest confirmed).

### Leaf-level output compaction for dispatched implementer / qc shell commands (rtk-style)
- **Trigger**: next time a `/l4` / `/l5` foreman or a `quality-pipeline` / `qc-panel` sub-agent's context bloats from raw shell output (full `git diff`, full `pytest`/`vitest` runs, linter dumps) — i.e. a concrete in-the-wild "the leaf agent burned its budget on tool output" observation, OR a user ask to wire token compaction.
- **Context**: 2026-06-23 survey of two token-saving projects — **headroom** (`headroomlabs-ai/headroom`: ML/Rust compression *proxy*, 60-95%, wrong category — a whole product, not a pattern to re-port) and **rtk** (`rtk-ai/rtk`: single Rust binary, 60-90%, filters command output *before* the LLM sees it: failure-only test output, `git diff --stat`, per-class truncation caps (errors:20/list:20 + single `[N more]` marker), linter `--format=json` first, smart structural file truncation). The portable, native, stdin-free win is to bake **rtk's filtering discipline into autopilot's OWN leaf commands** — the implementer/qc shell calls — as compact-by-construction script wrappers (autopilot already does this for `diff-scope-report.sh` / `verify-preexisting.sh`; the gap is the noisy raw commands the dispatched agents still run). autopilot's structural lever (sub-agent context isolation — only the verdict returns to depth-0) is orthogonal and already in place; this is the葉節點 complement.
- **Two adoption paths, both with caveats (spiked 2026-06-23, CC 2.1.186)**:
  - **rtk-transparent (PreToolUse hook that rewrites `git status`→`rtk git status`)**: ✅ **WORKS on 2.1.186** (corrected 2026-06-23 — the earlier "broken" claim was wrong). rtk's `rtk-rewrite.sh` reads `INPUT=$(cat)` = **fd 0**, which is delivered; e2e-verified — a `git log -8` was transparently rewritten to `rtk git log -8` and the model received the compressed output. Gotchas: the hook subprocess needs `rtk` on PATH and `rtk-rewrite.sh` executable.
  - **rtk-CLI (explicit `rtk <cmd>` calls)**: also works; rtk **now installed** at `~/.local/bin/rtk` v0.42.4 (prebuilt musl, no cargo build needed).
- **⚠️ MEASURED ROI (don't oversell — `scripts/` transcript scan, 2026-06-23)**: across 46 autopilot sessions, rtk's **safe-addressable** slice (git log/status/ls/grep/test) is only **~13% of tool-output / ~11% of total context**, ≈ **3K tok/session** — and it's all cheap **input** (≈ noise in $ terms, esp. under prompt caching). rtk's headline "60-90%" is **per-command** (real: `git diff` measured 74%) but those commands are a small fraction of real context; the bulk is Read/Edit/Agent results rtk can't touch (or only lossily). rtk's diff compression is **lossy** → must NOT feed the **reviewer's** line-level diff. Real value is **context-window headroom in long `/l4`/`/l5` autonomous runs**, not $ savings.
- **Recommendation**: rtk is a **context-window tool for long autonomous runs, opt-in only** — not worth default-on for interactive sessions (ROI too thin). Prefer building rtk's *filtering discipline* (failure-only tests, `git diff --stat` for orientation) into autopilot's own script wrappers over a runtime dependency. **Never** route the reviewer's diff through it.
- **Effort**: S (per-command compact wrapper, e.g. a `git diff --stat`-first reviewer feed) — scope to the one command that actually bloats first, don't build the whole rtk surface speculatively.
- **Source**: 2026-06-23 `/next` follow-up — user-requested survey of headroom + rtk; two Explore-agent technical reports + same-session spike (rtk not installed, CC 2.1.186, intent `last_tool_source:"transcript"` confirms transcript-pivot ≠ stdin, zero live PreToolUse hooks).

---

## Resolved (kept briefly for traceability; prune when stale)

- **README.zh-TW.md staleness + no drift guard** — ✅ RESOLVED 2026-06-22 in three passes: (1) skill count 6× "16"→"20" + hook badge/Tier-B; (2) full structural sweep — backfilled the gutted Install section (5 platform subsections), Hooks Secret-Detection + Override, and consolidated the split/duplicated Inspired By (added task-tree entry, removed the fired deferral note); (3) shipped `scripts/check-readme-parity.js` (preflight #15) asserting every shields.io badge value matches EN + `##`/`###` section-count parity. The guard immediately caught a stale zh version badge (2.7.0 vs 2.19.1) the manual sweeps had missed. Period-accurate historical prose numbers (e.g. "v2.5 新增 14 個 hook") are out of scope by design.

- **hook inventory reconciliation (4 inconsistent sources) + "Hook tally is stale (12 default-on)"** — ✅ RESOLVED 2026-06-22 (these were two entries, 2026-06-22 + 2026-06-02, describing the **same** drift; folded into one fix). Established a single source of truth: `scripts/check-hook-inventory.js` derives the canonical tally from real wiring — **8 default-on** (`hooks.json`) + **7 opt-in** (`settings.example.json` `hooks-opt-in-examples`) + **5 disabled** (`hooks/*.{js,sh}` wired nowhere = v2.7.4 batch) = **20 total**. The 4 canonical descriptions (`.claude-plugin/plugin.json`, root `plugin.json`, `marketplace.json`, `CLAUDE.md`) now read `20 hooks (8 default-on, 7 opt-in, 5 disabled)`; README.md + README.zh-TW.md + hooks/README.md tier tables rebuilt to correct **membership** (they had listed the 5 disabled hooks as Tier-A default-on while omitting the 5 actually-wired — a count-only check would have missed it). `check-hook-inventory.js --check` asserts counts AND per-tier membership, wired into `preflight-portability.sh` (#11). `sync-version.js` was de-coupled from hook-count ownership (3-tier-aware fragment mirror; `--disabled-count`; README hooks badge + hooks/README ceded to the new script); its 6-test suite + AGENTS.md updated. Historical counts (README "v2.5 added 14 hooks", devteam-absorb narrative) deliberately left as period-accurate. Residual: zh-TW skill-count "16" (separate drift, new backlog entry above).

- **`.opencode/skills/` stale mirror** — ✅ RESOLVED v2.17.2 by **deletion, not a sync script**. The 2026-06-12 entry mischaracterized it as a mirror needing sync; investigation found `.opencode/skills/*` was a `bf0c637` (2026-05-22) leftover the portability-correction plan already decided to remove (`docs/plans/2026-05-22-multi-agent-portability-correction.md` step 24: "把 `.opencode/skills/*` 整個目錄移除", rationale §I1 "多一條 = 多一條 drift surface"). OpenCode discovers all 19 skills via the `.agents/skills/ → ../skills` symlink — confirmed live by `preflight-portability.sh` check #11 (`opencode debug skill`) post-deletion. Building a sync script would have perpetuated the duplication the architecture was designed to avoid. Date 2026-06-15.

- **resolve-dispatch.sh tree-role integration** — ✅ shipped v2.17.0 (project `docs/projects/2026-06-12-tree-role-dispatch/`): `--tree` context flag (role vocabulary shared with `resolve-doa.sh`), `manager` refusal exit 3, `tree:<role>` override rows, sanitization + env seam parity with resolve-doa. Date 2026-06-12.

- **agents/_bodies/*.body.md surface as dispatchable agents with NO tool allowlist** — ✅ fixed by relocating bodies out of the CC agent scan path, date 2026-06-11.
- **Nested subagent (depth=5) integration** — ✅ shipped v2.14.0 (project `docs/projects/2026-06-11-nested-dispatch-integration/`). Both triggers fired 2026-06-11: CC v2.1.172 changelog ("Sub-agents can now spawn their own sub-agents (up to 5 levels deep)") + nest-probe green (explicit grant honored; children get `Agent` not `Task`; v2.1.170 negatives were server-side rollout lag). Landed with two upgrades over the original proposal: blind-dispatch rule is **context-indexed** ("verdict dispatch only from depth 0" — closes the fixer→verify-my-fix hole), and depth ≤ 2 policy has a single canonical home (`agents/README.md` § Orchestration). See CHANGELOG v2.14.0.

### sync-version.js: omitting `--disabled-count` silently drops the "N disabled" hook fragment
- **Trigger**: next version bump via `scripts/sync-version.js`, or next time the hook description format changes.
- **Context**: `disabledCount` defaults to `0` when `--disabled-count` is omitted, so a bump that forgets the flag rewrites "H hooks (D default-on, O opt-in, X disabled)" → "H hooks (D' default-on, O opt-in)" — silently clobbering the `disabled` tally and miscomputing default-on (D'=H−O). Hit 2026-06-22 during the v2.20.0 bump; worked around by hand-editing the version string in the mirrors instead of running the script.
- **Fix**: PRESERVE the existing disabled-count (parse it from the current description) when `--disabled-count` is omitted, rather than defaulting to 0 — same principle as not clobbering counts you weren't asked to change. Until fixed: always pass `--disabled-count <N>` matching current (currently 5).
- **Effort**: Fix (S)
- **Source**: retro 2026-06-22 (codeforge doc-drift-system session); workaround in autopilot v2.20.0 bump.

Shipped items are tracked in [`CHANGELOG.md`](../CHANGELOG.md) (source of truth). Last pruned 2026-06-02: v2.7.5 test-suite + v2.7.6 hook-polish items A/B/C.
