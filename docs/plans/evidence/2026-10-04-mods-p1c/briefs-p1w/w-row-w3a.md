# P1W row W3a — the live mod reads every wired source (plan §4 P1W W3a)

Read `w-common.md` first, then `hand-c3-brief.md` (how the mod is built and tested: `mods/live/*`, `live.test.ts`, tsc, `claude plugin test`/`validate` on the throwaway wrapper, the negative grep), the plan §4 P1W rows W3a, W2d, W2c and Review log R5.3–R5.6, and the memory-free facts in `references/mods.md` (surface element limits: no Node in the mod sandbox, only `$.fs`/`$.process.run` argv; pane auto-opens only ≥144 columns).

## Base
Worktree `$P/wt-w3a`, branch `w/w3a`, created by depth-0 at `w/int2` (e227528e). FIRST step: `git cherry-pick -x` the four mod commits of `p1c/c` in order — `2680228c` (C1), `2279e6d0` (C2), `48be3ecd` (C3), `734365c1` (C3b-M). Expected conflicts only in `references/mods.md` (+ codex mirror; W1c added a section): union. Anything else → STOP. Do NOT pick `p1c/d1` (hooks.json comment-key removal + `modules`; that joins at W4). Then ONE W3a commit on top. The MARKER row runs in parallel on `w/marker` (session-mode marker `level: null` = plain session, `phase`/`phase_set_at` fields already on `w/int2`); build against that contract with fixtures, do not touch `scripts/session-mode.js` or hooks.

## Sources the mod must read (all via the live pointer → absolute paths; never compute the live base in the mod)
| field | file (shape owner) |
|---|---|
| tasks | `<live>/tasks/<sid>.json` `autopilot.session-tasks/1` (W1de) — no file + task tools never used → 「任務工具未開」 with the `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` hint |
| attention | `<live>/attention/<sid>.json` `attention/1` (W1de) |
| phase | job `model.json` `phase {code,label,source}` (W1a, WATCH-A marker phase source `session`) |
| progress / planned | job `model.json` (W1a, WATCH-A) |
| decision | job `model.json` `decision` incl. `stale`/`age_s` (WATCH-A) → 「（已等 N 天）」 |
| decisions sidecar | `<live>/runs/<scope>.decisions.json` `autopilot.decisions-sidecar/1` (WATCH-B) |
| foreman activity | `<live>/runs/<scope>.foreman.json` `autopilot.foreman-activity/1` (WATCH-B; absent = not wired) |
| sources manifest | `<live>/runs/sources/<scope_key>.json` `autopilot.sources/1` (WATCH-A) |
| context | `<live>/context/<sid>.json` — also the W2f hook-written shape with `model: {}` and `window_source`; percent withheld when window unknown |
Read each owner's REPORT (`$P/run-w/{w1de,w1a,watch-a,watch-b,w2f}/REPORT.md`) for exact shapes; quote file:line of the writer in your report.

## Behaviour (plan W3a + R5.5)
- Verdict word precedence: 要你決定 (attention `permission`/`question`, or an open decision) > 疑似卡住 > 完成待驗收 (campaign terminal, or all session tasks completed) > 進行中 > 待命 (idle; append 「停在等你指示 N 分」 from attention/idle). `awaiting_disposition` is never 要你決定.
- Elapsed = start of this piece of work: campaign → earliest bound progress receipt (W1a binding); session → tasks `first_created_at`, else marker `started_at`.
- Band line 2 (only when non-zero): 「代你決定 m 件（k 件不可逆）」 from the decisions sidecar; when `writers_wired` lacks a depth-0 writer, label 「僅自動裁決」 — word it from the actual `writers_wired` list (engine, next-pick), not a constant; `undocumented_dispatches > 0` → 「n 件派工無決策紀錄」.
- Pane: decisions per row + the veto command text (read `decision-ledger.js` for the real veto/override verb; if none exists, show the ledger path and say 「尚無 veto 指令」 — do NOT invent one); foreman activity rows (description, label, age; `stale` dimmed; `binding:"session"` shown honestly); 「工頭狀態：來源未接」 when the sidecar is absent.
- Every field: source not installed/enabled per the sources manifest → 「來源未接」; installed but empty → the original empty-state text; never 0 for unknown. No manifest (older watcher) → today's inference.
- WATCH-B follow-ups to close here: foreman rows of a marker from another `project_key` must not show (add the negative control at the reader); run-ledger heartbeat rows without `stage` — confirm the row shape in `scripts/watch-foreman.js`/`run-ledger.sh` and, if heartbeats omit `stage`, fix `foreman-activity.js` `fromRunLedger` to take max(heartbeat) over all rows (this is the only non-mod file you may touch; say so).

## Verify
As `hand-c3-brief.md` Verify (mod suite RED-first + mutations per behaviour above, tsc, plugin test/validate on the wrapper, negative grep), plus the watcher/renderer suites if `foreman-activity.js` changed, codex sync, L1. Report `$P/run-w/w3a/REPORT.md` with a field table (field → file → shape → band/pane text in each state: wired-with-value, wired-empty, not-wired). One W3a commit `feat(mods): live mod reads tasks, attention, phase, decisions, foreman activity and the sources manifest (mods P1W W3a)`.
