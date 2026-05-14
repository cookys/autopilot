# Handoff — 2026-05-14 End-of-Day (post v2.7.3 + observations)

**建立**：2026-05-14 ~19:30 local
**目的**：context clear 後新 session 接續執行
**現況**：`develop` 在 `871fd77`、無 active branch、無 uncommitted changes、全 push 過

---

## TL;DR — 1 段話進入狀況

今天 ship 3 個 L-size（**v2.7.0** superpowers-coexistence / **v2.7.2** context-handoff-hardening / **v2.7.3** retro-roundup）+ 多 Fix-cycle，total ~40 commits。Plans 已寫 6 個進 `docs/plans/`、roadmap 進 `docs/BACKLOG.md`（7 entries trigger-bound）。**剩下 fresh observation 沒解的 2 個**：(1) intent-capture 自動觸發在 reload 後 burst 跑了 ~20 次就停、(2) `/reload-plugins` 報 11 hooks 但實際 13。Real auto-compact (~150K threshold) 等被動觸發、就會自然驗 v2.7.2 端到端。

---

## 已 ship 一覽（develop 從 ff4aa47 起）

```
871fd77 fix(hooks): state-checkpoint ENXIO graceful skip + BACKLOG /compact note
e605118 docs(backlog): /reload-plugins hook count discrepancy observation
4c6f6f3 docs(plan): test-suite proposal — automated coverage for hooks/scripts
fd880a3 docs(archive): v2.7.3 retro-roundup shipped in 57c88ee
57c88ee Merge feat/v2.7.3-retro-roundup into develop          ← v2.7.3 L-size
e714fdf chore(.gitignore): suppress 2026-05-14_154034 noise
16ee071 fix(scripts): sync-version.js L-5.2 reviewer findings (2 Critical)
6c50cbb chore: T2-T5 polish batch (gitignore + BACKLOG + INDEX guard + CHANGELOG)
53005e2 docs(plan): retro-roundup L-1 + plan v2 + INDEX
a0c83cf feat(scripts): sync-version.js v1 (was buggy, fixed in 16ee071)
ff4aa47 docs(archive): v2.7.2 context-handoff-hardening shipped in 670cc23
670cc23 Merge feat/v2.7.2-context-handoff-hardening into develop  ← v2.7.2 L-size
e643278 fix(hooks): L-5.2 pre-merge review findings (1 Critical + 2 Major)
6780a2b feat(hooks): v2.7.2 context-handoff hardening (P1+P2+P3 atomic)
72773b3 docs(plan): context-handoff hardening L-1 + plan v4 + INDEX
... + ee74e84 Merge eval-proxy / d9df08d Merge blind-re-dispatch / e9e286b Merge skill-invocation / 71d63eb v2.7.1 bump / ... / eb70999 v2.7.0 ship
```

Active version：**v2.7.2** (next will be 2.7.3 when bumped — sync-version.js 就用來改)。

---

## 開放 observations（fresh、需診斷）

### Obs-1（HIGH）：intent-capture 自動觸發 burst 後 stagnate

**證據**：
- /reload-plugins 後 count 5→25 在數分鐘內（OK）
- 然後跨 9 分鐘 + ~10 個 Bash tool calls 都沒再增（mtime stuck 19:08）
- 手動 `node intent-capture.js` 仍 work（count 25→26）→ script 本身 OK
- 無 disable flag、無 failure counter（都 0）

**假設**：Claude Code 一段時間後停 dispatch `.*` matcher hook，或 matcher cache 失效。

**診斷起點**（next session 用）：
```bash
# 1. 看當下 intent file 跟 /tmp counter 一致嗎
HASH=$(python3 -c "import os,hashlib; print(hashlib.sha1(os.path.realpath('.').encode()).hexdigest())")
cat ~/.autopilot/intent/${HASH}.json   # check last_updated + count
cat /tmp/claude-intent-tool-count-${HASH:0:12}  # check counter

# 2. 跑幾個 Bash command，看 mtime/count 有沒有動
date; ls /tmp; date
cat ~/.autopilot/intent/${HASH}.json   # mtime should be NOW, count should ++

# 3. 同檔對比 reload-watch state — 另一 .* matcher hook
cat ~/.claude/plugins/.reload-watch-state.json   # mtime current?

# 4. /reload-plugins 再跑一次後立刻測，看 burst 模式是否復現
```

**BACKLOG 條目**：「Investigate intent-capture auto-fire stagnation post-reload」。

### Obs-2（MEDIUM）：`/reload-plugins` 11 hooks vs hooks.json 13

**Claude Code report**：`Reloaded: 1 plugin · 0 skills · 10 agents · 11 hooks`。
**hooks.json 實際**：1 PreCompact + 1 SessionStart + 3 PreToolUse + 6 PostToolUse + 2 Stop = 13。
**差 2**：可能不計 SessionStart 跟 Stop、或內部 dedup。**Not blocking**，已記 BACKLOG。

### Obs-3（已 mitigated）：`/compact` slash 不 pipe payload

**今早 method-B testing 發現** — `/compact` slash command 觸發 PreCompact hook 時 stdin 不可讀，state-checkpoint 撞 ENXIO 寫了 catastrophic log。**Auto-compact (~150K threshold) DOES pipe payload**。已修：state-checkpoint.js 改 graceful skip + log `no_payload_skip`（commit `871fd77`）。BACKLOG 記要不要進一步 (a) `hooks/README.md` warn、(b) upstream feedback、(c) fallback transcript discovery。

### Obs-4（passive 等）：Real auto-compact 沒驗

v2.7.2 端到端只有 auto-compact 能完整 trigger：PreCompact → state-checkpoint → SessionStart hint。Method D 驗了 hook 邏輯、Method B 證 `/compact` slash 走不到完整路徑。**等被動觸發**。觀察點：第一次自然 compact 後 `~/.autopilot/compaction-state.md` 內容 + 新 session 開頭 Claude 表現。

---

## 已 filed plans（waiting trigger）

| File | 內容 | Trigger |
|---|---|---|
| `docs/plans/2026-05-14-eval-router-judge.md` | API-direct router-judge 取代 skill-creator proxy isolation-test | 下次 routing tightening 痛點 |
| `docs/plans/2026-05-14-test-suite.md` | autopilot 自動化 test 框架（3-layer pyramid） | 下次出現 v2.7.3-class「reviewer-跑了-才抓到」bug，OR v2.7.4 release 前 |
| `docs/plans/2026-05-14-reload-plugins-agent-invokable.md` | Option D shipped (`reload-watch.js`); Option A 等 upstream Claude Code | upstream 動作 |
| `docs/plans/2026-05-14-powerloop-learnings.md` | B/A adopted in v2.7.2, C/D explicit skip | (closed) |
| `docs/plans/2026-05-14-superpowers-coexistence.md` | v2.7.0 ship | (closed) |
| `docs/plans/2026-05-14-context-handoff-hardening.md` | v2.7.2 ship | (closed) |
| `docs/plans/2026-05-14-retro-roundup.md` | v2.7.3 ship | (closed) |

---

## BACKLOG（7 entries，trigger-bound）

詳細 `docs/BACKLOG.md`：

1. **`/compact` silent-miss documentation** — README warn / upstream feedback / fallback discovery（剛新增）
2. **intent-capture auto-fire stagnation post-reload** — 下次 reload + 長 session 觀察（剛新增）
3. **`/reload-plugins` 11 vs 13 hook count** — 看 Claude Code source / docs 釐清（剛新增）
4. **Test suite for autopilot** — full plan at `2026-05-14-test-suite.md`
5. **intent-capture disable flag malformed → STALE** — JSON parse fail auto-clear
6. **Failure counter cleanup** — failure-escalation Stop hook 自清 OR mtime >7d filter
7. **state-checkpoint symlink reject diag detail** — 加 `$HOME` 進 visible diag

---

## MEMORY 已 sync（cross-session 持久）

`/home/cookys/.claude/projects/-home-cookys-projects-hangar/memory/` 今天新加：

- `feedback_skill_creator_eval_proxy.md` — proxy isolation-test floor = 0%, 不是 routing precision
- `reference_loop_tools.md` — `/loop` vs `/powerloop` 對比
- `feedback_autopilot_review_loop_patterns.md` — 今天 meta-pattern（4-reviewer-loop, single-atomic-commit, hook-self-extract）— **如果這份還沒寫成功，看 §"立即執行步驟 Step 0" 後段補寫**

---

## 立即執行步驟

### Step 0 — 環境確認

```bash
cd ~/projects/autopilot
git log --oneline -5             # 預期 871fd77 在 top
git status                       # 預期 clean
git branch -a                    # 預期 develop + feat/v2.7.0-superpowers-coexistence stale
```

### Step 1 — 三選一

| 選項 | Effort | Priority | When to pick |
|---|---|---|---|
| **1A** 診斷 Obs-1 intent-capture stagnation | S ~15 min | High | bug fresh、影響 v2.7.2 design |
| **1B** 跑 test-suite plan Phase 1（建 `hooks/tests/run.sh` harness）| M ~60-90 min | Med | 長期解 review-as-test 不可持續 |
| **1C** `autopilot:next` skill 跑一輪 scan | S ~5 min | Low | 沒脈絡時的 fallback |

預設推薦 **1A**：bug 細節新、診斷指令已備（見 Obs-1）、產出至少能精準 BACKLOG。

### Step 2（若選 1A）— diagnose 詳細

照 Obs-1 「診斷起點」4 個 bash block 跑。觀察點：
- `last_updated` 是否在 NOW（< 5 秒）內
- `tool_count_session` 是否 increment
- reload-watch state file mtime 是否也跟 intent-capture 一起 stagnate（同 `.*` matcher → 一起死才是 Claude Code matcher 問題；只有 intent-capture 死 = intent-capture 內部 issue）

如果**兩個 hook 都 stagnate** → Claude Code matcher dispatch 機制問題（external）→ BACKLOG 升級 + upstream feedback。
如果**只 intent-capture 死** → 可能 intent-capture script 內 silent abort 路徑（看 stderr / 加 debug log）。

### Step 3（若選 1B）— test-suite Phase 1

照 `docs/plans/2026-05-14-test-suite.md` §4 Phase P1：
- 建 `hooks/tests/run.sh` umbrella
- 建 `hooks/tests/fixtures/` dir
- 寫 state-checkpoint R10-A 為 PoC test case
- 跑 PoC 通過後 ship 一個 Fix-cycle commit

### Step 4 — 收尾

照本 handoff 補充 / 修正、或進 `autopilot:retro` 跑單日 retro 看本次 session productivity。

---

## QA 紅旗

1. **session 載新 hooks 需要 `/reload-plugins`**（per D-2 dogfood loud finding 已知 + reload-watch hook 已 ship 提示 user）。但 reload 後**沒持續觸發**（Obs-1）是新發現
2. **`/compact` 不能拿來測 state-checkpoint**（已修 ENXIO branch，但根本 limitation 在）
3. **MEMORY.md 累積到 21 條 entries** — 接近 health audit 觸發點 200 lines（autopilot:learn 自動規則）。如果觸發、要 split 或 cleanup
4. **`docs/projects/INDEX.md` finish-flow grep guard 已 active**：下次 ship 進 archive 時 `(pending) | (target) | (in progress) | (WIP) | (TBD) | (draft)` 任一 leak 進 INDEX 都會 fail L-5.5

---

## 新 session 開頭 prompt 模板

複製這段給新 session 開始：

```
我繼續 autopilot 工作。
完整 handoff 在 /home/cookys/projects/autopilot/docs/plans/2026-05-14-next-session-handoff.md
請先讀那個檔、照「立即執行步驟」走。Default 選項 1A（diagnose intent-capture stagnation）除非有別需求。
```

---

## 檔案 inventory（context reload 用）

| 路徑 | 用途 |
|---|---|
| `CHANGELOG.md` | v2.7.2 entry（top）+ RELEASE TEMPLATE comment + 完整 v2.7.0/v2.7.1 history |
| `docs/projects/INDEX.md` | 已完成 list 含 v2.7.0/v2.7.2/v2.7.3 + 進行中 = None |
| `docs/BACKLOG.md` | 7 trigger-bound entries（剛新增 3 條來自今天 observation）|
| `hooks/state-checkpoint.js` | Node JSONL parser PreCompact hook (v2.7.2)，剛加 ENXIO graceful skip |
| `hooks/intent-capture.js` | Per-cwd resume hint PostToolUse hook (v2.7.2) |
| `hooks/session-start.sh` | SessionStart with compaction recovery + per-cwd intent hint (v2.7.2)|
| `scripts/sync-version.js` | Atomic manifest version bumper (v2.7.3，two-pass design)|
| `hooks/README.md` | 19 hooks documented + Self-Disable Recovery + v2.7.2 Rollback subsection |
| `~/.autopilot/intent/<sha1>.json` | per-cwd resume hint files（runtime artifacts，gitignored）|
| `~/.autopilot/compaction-state.md` | last compact checkpoint（runtime, gitignored）|
| `~/.autopilot/.state-checkpoint.log` | JSONL log rotate 1MB |

---

## 給 next-session-me 的 1 句話

「**今天高速 ship，現在 fresh observation 還沒解的 2 個，1A diagnose 拿 15 min 看能不能解。解掉就收，解不掉精準 BACKLOG。不要再開 L-size 直到至少有 1 sleep cycle 過。**」
