# P2 brief — autopilot consumes the live files

Repo: `/home/cookys/projects/autopilot`, branch `feat/v2.36.1-statusline-live-context-feed` (already checked out in the
main tree). Work in a git worktree: `git worktree add /home/cookys/projects/autopilot-wt-p2 -b feat/v2.36.1-p2 feat/v2.36.1-statusline-live-context-feed`
and do everything there. Commit there; do not merge. Node ≥ 20.10, built-ins only, no new dependency.

Plan (read §2.5 and P2 only): `docs/plans/2026-09-05-statusline-live-context-feed.md`. P0 ruling: `tasks[].id === payload.agent_id`
(`docs/projects/2026-09-05-statusline-live-context-feed/ledger/p0/README.md`). Real payloads for fixtures: `ledger/p0/{statusline,subagent}.json`.
Read first: `hooks/context-budget.js`, `hooks/context-budget-lib.js`, `hooks/context-budget.test.js`, `hooks/foreman-guard.js` + its test, `hooks/tests/run.sh` header.

## Global Constraints (verbatim from plan §2.5)

- Live-dir resolution order is fixed: `$AUTOPILOT_LIVE_DIR` → `$XDG_RUNTIME_DIR/autopilot` → `/dev/shm/autopilot-<uid>` → `/tmp/autopilot-<uid>`. **Every** candidate, the override included, is accepted ONLY if `findmnt -T <dir> -o FSTYPE -n` prints `tmpfs` or `ramfs`; if `findmnt` is absent, fall back to longest-prefix match in `/proc/mounts`; if neither works the candidate is rejected. When every candidate is rejected, use `~/.autopilot` as the base and print exactly one warning line per process. Never assume a path is RAM. A rejected override is skipped, not fatal.
- Base-dir contract: `resolveLiveDir()` returns a BASE; every consumer appends its own purpose segment (`context/`, `context-budget/`), so the SSD fallback state path is exactly the legacy `~/.autopilot/context-budget/<sid>.json`.
- Two live files: `<base>/context/<sid>.json` (main) and `<base>/context/<sid>.tasks.json` (subagent). A reader checks freshness of the file it uses only.
- `<sid>` sanitiser = today's `getSessionId()`: replace every Unicode scalar not in `[A-Za-z0-9_-]` with one `_`, keep the first 64 scalars, empty ⇒ `unknown`. Vector file: `hooks/tests/fixtures/session-id-vectors.json` (create it if P1 has not; array of `{input, expected}`: uuid, `a/b:c d`, `會議123`, an emoji string, empty, 70 chars). `getSessionId()` must read `session_id` from the hook payload first, env second, cwd last, then sanitise — writer and reader must meet on one name.
- Readers accept a live file only if `schema_version` is the integer `1`; missing/non-integer/other ⇒ treated as absent. Unknown fields ignored.
- Freshness: `written_at` older than 120 s ⇒ absent ⇒ existing transcript/inference path. Silence is never a gate pass.
- Tier formula unchanged: `t1 = explicit ?? round(100000·W/200000)`, `t2 = explicit ?? round(150000·W/200000)`; the plan changes only where `W` comes from.
- Compatibility: with no usable live file, `context-budget` and `foreman-guard` keep v2.36.0 exit status, stdout and stderr byte-for-byte (test diffs against a fixture run captured from `git show develop:hooks/context-budget.js`); only the state-file location moves, and only when a RAM base exists.
- Severity vocabulary 🔴/🟠/🟡/🔵. No trust machinery (ADR-0001). Every prompt you write for a sub-dispatch starts with `Engine: <model>`.

## Deliverables

1. `scripts/lib/live-state-dir.js` (new): exports `resolveLiveDir({env, execSync, procMountsPath, warn})` → `{base, source}` (`source`: `override|xdg|shm|tmp|ssd-fallback`), `sanitizeSessionId(s)`, `readLive(base, sid, {kind:'main'|'tasks', nowMs, maxAgeMs=120000})` → object or `null`, `modelFamily(id)` (P3 uses it; implement the plan §2.5 grammar `^claude-([a-z]+)-[0-9]+(-[0-9]+)*(\[[a-z0-9]+\])?$` on the lowercased id, else `unknown`). Header comment: purpose, contract, exit semantics. Tests `scripts/lib/live-state-dir.test.js`: fake `findmnt` on `PATH` (tmpfs ⇒ chosen; ext4 everywhere ⇒ `~/.autopilot` + exactly one warning; absent findmnt + `/proc/mounts` fixture; ext4 override + tmpfs XDG ⇒ XDG); sanitiser vectors; readLive: fresh/stale/schema 2/missing/malformed/wrong session; modelFamily positive (`claude-fable-5-1`, `CLAUDE-OPUS-4-8[1m]`, `claude-sonnet-5`) and negative (`fable-ish`, `claude-fable`, `fable`, `""`).
2. `hooks/context-budget.js` / `-lib.js`: read the main live file first (base from `resolveLiveDir`; sid from payload `session_id`). If usable: `W = context_window_size` (skip `inferWindowTokens`), `contextTokens = max(transcript usage, total_input_tokens)` when the transcript row is older than `written_at`, message suffix `= N% of the ~1000k window (statusline)`. Otherwise unchanged path. State dir: `<base>/context-budget/` (env override `AUTOPILOT_CONTEXT_BUDGET_DIR` still wins). Tests to ADD to `hooks/context-budget.test.js`: RED first — "1M live file, 153k context ⇒ no T2" fails on the current code (commit the failing test, then the fix); "200K live file at 150k ⇒ T2"; "stale live ⇒ inference path"; "schema_version 2 / missing / malformed ⇒ inference path"; "state file lands under the tmpfs base"; "absent live ⇒ exit/stdout/stderr identical to develop fixture".
3. `hooks/foreman-guard.js`: when marker l4–l6 + `payload.agent_id`: read `<base>/context/<sid>.tasks.json`; row = `tasks.find(t => t.id === agent_id)`; 0 or ≥2 rows ⇒ pass + one stderr diagnostic naming the count; row with `tokenCount ≥ t2(W = row.contextWindowSize)` ⇒ deny (`{"decision":"deny", …}` shape the hook already uses) with the handoff directive; `AUTOPILOT_FOREMAN_GUARD_MODE=warn` prints instead. Tests: 160k/200k row ⇒ deny; 90k ⇒ pass; no row ⇒ pass + diagnostic; two rows same id ⇒ pass + diagnostic; stale tasks file ⇒ pass; no marker ⇒ untouched.
4. `hooks/README.md` rows for the two hooks (short; P4 owns the rest). Do NOT touch `hooks.json`, `hook-classes.json`, versions.

## Method

harness-verify-loop: one change → `node hooks/<x>.test.js` (or the single test file) → stage → next. Before the commit: `bash hooks/tests/run.sh --parallel 4` (full suite incl. the serial tail; read the whole log for `FAIL` lines, not just the parallel `ALL TESTS PASSED`) with `AUTOPILOT_TOPOLOGY_FILE=/nonexistent` exported so the host topology never leaks into fixtures, plus `node scripts/check-js-syntax.js`. Commit message `feat(hooks): context-budget + foreman-guard read the statusline live files (v2.36.1 P2)`.

## Report → `ledger/p2/report.json`

`{"status":"done|blocked","worktree":…,"branch":"feat/v2.36.1-p2","commits":[…],"red_test":{"name":…,"fails_on_base":true|false},"suite":{"cmd":…,"passed":N,"failed":N,"failed_names":[…]},"files_changed":[…],"notes":…}` — numbers only, no green claims without them. Reply with the report path.
