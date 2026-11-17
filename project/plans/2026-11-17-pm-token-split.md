# Plan — PM seat token split: scripted PM chores (fleet task 01M7KZZ1ZT3V1KTKNR3E4MFK4B)

Status: frozen (PM ruling 01M7M32A, option A) · logical_plan_id: `pm-token-split-2026-11-17-b` · Size: L (eight phases P0–P6 and Q, plus two integration steps A-int, B-int)

## 0. Context / thesis

The PM seat read ~5 billion cached tokens in two days (4,274 turns, 3.64 API calls per turn, ~320k tokens re-read per call). The PM's synthesis (fable / astra / carbon, PM final v1, 2026-11-17) found that 45–78 % of that volume carries no judgment: routine intake, one wake per consultant reply, many tool round-trips per turn, long tool output, and an over-long context. The work order selects six scripted chores, split into two deliveries:

- (A) by 2026-11-18 18:00 (UTC+8): (1) request register, (2) parallel consultant barrier with de-identification, (3) tool-output truncation.
- (B) by 2026-11-20 18:00 (UTC+8): (4) `pm-act` macro, (5) intake rule check, (6) switchboard runner in shadow mode.

The PM added one item on 2026-11-17 (message 01M7M071), to ship with (1): a work order of Size M or larger must carry `Plan: <path>@<sha>` or `plan-first`, and a lane's dev-flow refuses to enter implementation on such an order without a frozen plan receipt. That is phase P0.

Facts this plan builds on (verified in this repo or the official docs):

- `hooks/askpm-log.js` (opt-in stem `askpm-log`) appends `{schema:'autopilot.askpm/1', kind:'ask'|'turn'|'reply', at, …}` rows to one jsonl under the account state dir; it never writes stdout. Its gate walks up to `/` and does not require console `mode:"program"` (its own comment, lines 38–39). Its UserPromptSubmit half runs inside `hooks/advisory-relay.js`; its Stop half is spawned by `hooks/opt-in-multiplexer.js`, which does **not** forward a Stop decision (multiplexer comment, line 30). Its Stop reply check `transcriptMatchesAsk` compares the transcript's last real user text with the ask (lines 197–206).
- `mods/live/console.ts` reads console mode by walking up to the first `.git` and requires `schema:"autopilot.console/1"` and `mode:"program"`.
- `hooks/_shared/opt-in.js`: default-off gate (`~/.autopilot/config.json {"hooks":{"<stem>":true}}` or `AUTOPILOT_HOOK_<STEM>=1`).
- Inventories a new hook or opt-in stem touches: `hooks/hooks.json`, `hooks/opt-in-manifest.json`, `hooks/README.md` (tier counts), root `CLAUDE.md` counts (`scripts/check-hook-inventory.js --check`), `scripts/lib/config-keys.json`, `profiles/hook-classes.json` + `platforms/codex/plugin/profiles/hook-classes.json` (hash pinned in `profile-catalog.json`), codex mirrors via `bash scripts/sync-all.sh`.
- `references/stage-graph.json`: node ids `plan`, `plan-review`, `implement`, `verify`, …; size S starts at `implement`; M = `plan` → loop(`implement`,`verify`); L/XL add `intent`, `proposal`, `plan-review`. `scripts/check-phase-review-receipt.js --plan-artifact` verifies `plan_sha256`.
- `scripts/affected-suites.js --run --record` writes a JSON run record with full `base`/`head` shas and the run's rc.
- `session-mode.js set --fleet-task <id>` stores `fleet_task_id`. `fleet task show <id> --json` carries the order in `title`; whether `title` is ever truncated is asked of the fleet lane (01M7M1GE, acknowledged, answer pending).
- `fleet send` / `fleet task` CLI sign as the CLI identity, not as the calling Claude session (`fleet send --help`); a reply sent that way lands in an inbox no session reads.
- Claude Code hooks (https://code.claude.com/docs/en/hooks): PostToolUse `hookSpecificOutput.updatedToolOutput` / `updatedMCPToolOutput`; PreToolUse `updatedInput`; Stop accepts `decision:"block"` + `reason`; UserPromptSubmit returns `additionalContext` (≤ 10,000 chars).

## 1. Problem

The PM must spend context on decisions, not bookkeeping: no operator request lost across compactions; one wake per consultation; no 400-line tool result in context; one PM turn's dispatch + reply + ledger entry in one call; intake decided by a script from re-derived evidence; routine fleet traffic classified by a cheap isolated runner; and the PM's own lapse (M-size work dispatched without a plan) refused by code.

## 2. OKR / KRs

- KR1: in a PM session with the opt-ins on, every operator prompt gets an `ask_id`; `pm-ask overdue` lists every ask open > 24 h; an undisposed ask produces exactly one Stop reminder and its reply row is still recorded. Measured in the PM's first real session after the A pin (≥ 5 asks); the one-day count is reported 2026-11-19.
- KR2: a three-seat consultation produces one wake and one combined result file; a prompt with a personal identifier, a LAN address or a fleet member/host name is refused before anything is written to disk or any seat is called.
- KR3: in a PM session, a tool result > 40 lines reaches the model as 40 lines + one pointer line (ledger search: 30 + pointer), verified in the PM's transcript.
- KR4: one `pm-act` call performs dispatch + reply + ledger write, signed as the PM session; a lint failure in any part sends nothing; a retry after a partial failure never repeats a completed action.
- KR5: `pm-accept-check` returns ACCEPT only when all four conditions hold; an executor's "done" alone never yields ACCEPT.
- KR6: the switchboard runner, replayed over one exported day of the PM's inbound fleet traffic, produces packets that meet the packet contract (§4 P6), and a comparison report against the PM's recorded handling (including wakes per day) exists by 2026-11-20 18:00.
- KR7: a PM dispatch declaring Size M+ without a plan marker is refused at send; a lane whose order declares M+ cannot reach `implement` without a frozen plan receipt.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Ships inside the autopilot plugin. Every new PM-side behaviour is opt-in (default off) AND gated by the new shared PM gate `hooks/_shared/pm-console.js`: walk up from the hook cwd to the first directory holding `.git`, read that repo's `.claude/console.json`, require `schema:"autopilot.console/1"` and `mode:"program"` (the same rule as `mods/live/console.ts`). A child repo inside the PM workspace never matches. `askpm-log`'s existing passive logging keeps its own gate unchanged.
- Lane-side P0 behaviour fires only when the session has an attached fleet task (`set --fleet-task`); sessions without one see no change and no output.
- New opt-in stems: `pm-dispatch-plan-guard` (P0), `askpm-remind` (P1), `pm-output-cap` (P3). Each is wired into `hooks/opt-in-manifest.json`, `scripts/lib/config-keys.json` and `hooks/README.md` at A-int. New hook entries: `hooks/askpm-remind.js` (Stop, direct in `hooks/hooks.json`, because the multiplexer does not forward a Stop decision) and P3's entry or entries (event decided by the P3 probe). `check-hook-inventory.js --check` and `sync-all.sh --check` stay green.
- Node built-ins only; jsonl via `scripts/lib/jsonl-store.js`; config via `scripts/lib/config-path.js` (`~/.autopilot/config.json`); no SQLite.
- No phase reads, prints or copies a credential, token, `.env`, key file or auth store, with one exception already sanctioned by the repo (`references/hetero-dispatch.md`): a model child gets a throwaway config dir seeded with only `.credentials.json`. In Node: `fs.mkdtempSync` (then `chmodSync 0700`), `copyFileSync` (never symlink, file 0600), removed with `rmSync` in `finally` and in `exit`, `SIGINT`, `SIGTERM` and `uncaughtException` handlers. Tests use fake values only.
- The switchboard runner can never approve, open cards, dispatch, reply to anyone, touch credentials, extend deadlines or edit authority. Its child runs with no built-in tool, no MCP server, no project settings, no slash commands, from an empty cwd. Operator messages never enter it.
- No Chinese-made model (GLM / Qwen / DeepSeek / MiniMax / Kimi / qoder) receives PM traffic, prompts or transcript content. Every model call in this plan passes `scripts/lib/cn-model-dispatch-gate.js check` (an unknown runner or model is refused, not allowed) and runs with `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_*`, `OPENAI_BASE_URL`, `OPENAI_API_BASE` removed from the child env.
- Every new or changed check ships a negative control: for a changed file, the new test fails on the base revision; for a new script or hook, the test is first run against the named unguarded stub (a file at the real path with the stated unguarded behaviour) and fails on the behavioural assertion, never on a missing file or module.
- Real runs on the PM host happen only after the delivery's integration step and live pin (§5); phase acceptance before that is local.
- Probe results and real-run evidence go to `docs/plans/evidence/2026-11-17-pm-token-split/`, never into this plan file (its `plan_sha256` is a receipt).
- Times shown to people are UTC+8; machine fields are RFC 3339 UTC.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible` — askpm rows gain new kinds (`disposition`, `reminded`); old readers ignore unknown kinds. P0 adds a refusal path to `stage-advance.js` and `session-mode.js` that triggers only for an attached fleet task whose order declares Size M+, or whose order could not be read; the PM-side guard is opt-in. No consumer outside this repo reads the askpm jsonl.
- **Dependency decision**: `existing` — Node built-ins, `jsonl-store.js`, `config-path.js`, `wait-dispatch-results.js`, `ar-redact.js`, `redact-personal.js`, `cn-model-dispatch-gate.js`, `dispatch-author.sh`, the fleet CLI.

## 3. File-structure map

| File | Phase | Responsibility |
|---|---|---|
| `hooks/_shared/pm-console.js` (new) | P0 | the PM gate in §2.5 (P1 and P3 import it) |
| `hooks/fleet-send-work-order-guard.js` (existing PreToolUse fleet guard) | P0 | PM side: refuse `mcp__fleet__dispatch` declaring Size M+ without a marker |
| `scripts/lib/work-order-plan.js` (new) | P0 | parse an order text → `{size, plan}` (also used by P4 preflight) |
| `scripts/session-mode.js` | P0 | `set --fleet-task <id> [--refresh]` stores `wo_*`; size floor; stage reset |
| `scripts/stage-advance.js` | P0 | `--to implement [--plan <path>]` receipt check / record |
| `hooks/askpm-log.js`, `hooks/advisory-relay.js` | P1 | ask_id rows; ask_id context line only with `askpm-remind`; Stop half yields the reply row to askpm-remind when that is on |
| `hooks/askpm-remind.js` (new, Stop) | P1 | one reminder per ask; owns the reply row when on; daily overdue context via advisory-relay |
| `scripts/pm-ask.js` (new) | P1 | close / progress / supersede / list / overdue |
| `scripts/dispatch-panel.js` (new) | P2 | N seats in parallel, fail-closed de-id in memory, one wake, one `panel.json` |
| `hooks/pm-output-cap.js` (new) | P3 | cap model-visible output at 40 (ledger search 30) lines |
| `scripts/pm-accept-check.js` (new) | P5 | four-condition verdict |
| `scripts/pm-act.js` (new) | P4 | one JSON plan → lint all → ledger + dispatch + reply, journaled |
| `scripts/switchboard-run.js`, `scripts/lib/packet-builder.js`, `scripts/switchboard-export.js`, `skills/switchboard/SKILL.md` (new) | P6 | input allowlist, isolated classifier, deterministic packets, shadow compare |
| Integration (one commit each, one owner): `hooks/hooks.json`, `hooks/opt-in-manifest.json`, `hooks/README.md`, root `CLAUDE.md` counts, `scripts/lib/config-keys.json`, `profiles/hook-classes.json` (+ codex mirror, catalog hash), `docs/scripts-inventory.md`, `scripts/CLAUDE.md`, `CHANGELOG.md`, `docs/guide/installation.md`, skill inventory (skills index, `CLAUDE.md` skill count, codex mirror) | A-int, B-int | wiring; parallel phases never edit these files |
| tests: `hooks/tests/<phase>.test.sh`, `scripts/<script>.test.js` | all | red-then-green |

## 4. Phases

Dependencies (code edges): Delivery A: P0 ∥ P1 ∥ P2 ∥ P3 → A-int → A pin (2026-11-18 15:00) → A real runs. Delivery B: A-int → P5 ∥ P6 ∥ P4 (P4 imports P0's `work-order-plan.js`; P4 also needs the fleet signing interface, §8 Q4); P6 → Q → B-int → B pin (2026-11-20 15:00) → B real runs. P4 does not depend on P5 or P6; P6 does not depend on P1. Parallel phases share no file.

### P0 — work-order plan-first gate (Size M)

1. `work-order-plan.js parse(text)`: field lines only.
   - Size: `/^\s*(?:[-*]\s+)?(?:\*\*)?Size(?:\*\*)?\s*:\s*(?:\*\*)?\s*(XS|S|M|L|XL)\b/m`, or the brief header form `| Size: X |` on line 1.
   - Plan: `/^\s*(?:[-*]\s+)?(?:\*\*)?Plan(?:\*\*)?\s*:\s*(?:\*\*)?\s*(?:plan-first|(\S+)@([0-9a-f]{7,40}))\s*$/m`, or a line consisting only of `plan-first`. The word `plan-first` inside prose is not a marker.
   - Returns `{size|null, plan:{path,sha}|'plan-first'|null}`; two different Size field lines → `size:'conflict'`.
2. PM side: when opt-in `pm-dispatch-plan-guard` is on, the PM gate passes and the tool is `mcp__fleet__dispatch`: parse `task`; no Size field or `conflict` → deny with `每張派工都要帶 Size（XS|S|M|L|XL），請補上`; size M/L/XL without a Plan marker → deny with `工單 Size M 以上要帶「Plan: 路徑@sha」或「Plan: plan-first」` (PM ruling 01M7M32A: every PM dispatch carries a Size). The fleet CLI has no dispatch subcommand (`fleet task --help`); P4's dispatch path runs the same parse in its preflight.
3. Lane side, `session-mode.js set --fleet-task <id>`: runs `fleet task show <id> --json`, parses `title`, stores `wo_task`, `wo_size`, `wo_plan`, `wo_state:'resolved'|'unresolved'`, `wo_fetched_at`.
   - Fetch failure, timeout or unparseable JSON: keep any previously resolved `wo_*` for the same task; with none, store `wo_state:'unresolved'` and print one stderr line. A non-M+ resolved order prints nothing.
   - `--refresh` re-fetches the same task; a new id replaces all `wo_*` (recovery when the PM issues a corrected order).
   - Size floor: `set --size X` below a resolved `wo_size` is refused. When `--fleet-task` resolves a `wo_size` above the marker size: raise the marker size; if the stage is at or past `implement` and no valid receipt exists, reset the stage to `plan` and say so.
4. Frozen plan receipt: `{path, commit, blob_sha, plan_sha256, recorded_at}`; `blob_sha = git rev-parse <commit>:<path>`; `plan_sha256` = sha256 of that blob.
   - `Plan: path@sha` orders: the receipt is derived at `set --fleet-task` from `<sha>:<path>`; if that does not resolve, `wo_state:'unresolved'`.
   - `plan-first` orders: `stage-advance.js --to implement --plan <path>` writes or replaces the receipt from HEAD (refused if the file is uncommitted or dirty). It can be re-run after plan-review generations change the plan.
   - `--to implement` with an attached task: refused when `wo_state:'unresolved'`; with `wo_size` M+: refused without a receipt whose blob resolves (`git cat-file -e`); for L/XL also refused unless `check-phase-review-receipt.js --plan-artifact` passes with the same `plan_sha256`.
5. Title truncation: P0 does not start until the fleet lane answers 01M7M1GE item 3 (or the fleet source shows the field is the full body). If it can be truncated, P0 reads the untruncated field the fleet lane names. A truncated Plan line can only make an M+ order look unmarked, which refuses (fails closed); the PM recovers by re-issuing.
Acceptance (unguarded stubs: `work-order-plan.js` returning `{size:null,plan:null}`; `pm-console.js` returning true): PM side — `Size: M` unmarked denied; `- **Size**: L` unmarked denied; `Plan: docs/plans/x.md@abc1234` allowed; `Plan: plan-first` allowed; prose `we follow plan-first` with `Size: M` denied; no Size denied with the Size message; two conflicting Size lines denied; `Size: S` unmarked allowed; opt-in off untouched; child repo with its own `.git` under the PM workspace untouched; `mode` not `program` untouched. Lane — no task attached: no output, unchanged; `wo_size=M` no receipt → `--to implement` refused; `--plan` dirty file refused; valid receipt allowed; blob gone refused; L receipt without plan-review pass refused; L after a second plan-review generation: `--to implement --plan` re-records and passes; fetch outage with a previous resolved M → still refused; outage with nothing resolved → `unresolved` refused; `set --size S` on `wo_size=M` refused; `set --size S`, enter implement, then `--fleet-task` (M) → stage reset to plan; new task id replaces `wo_*`.

### P1 — request register (Size M)

1. Every row carries `schema:'autopilot.askpm/1'` and `at`. Ask row adds `ask_id`, `session_id`, `text`; `ask_id = 'a-' + sha256(session_id + '\n' + at + '\n' + text).slice(0,8)`. Rows written before P1 have no `ask_id` and are ignored by every `pm-ask` view (cutoff = first row with an `ask_id`). A prompt starting with `[voice call · unverified]` is not operator input (PM ruling 01M7M32A): it is logged as an injected turn, never an ask.
2. The `ask_id a-xxxxxxxx` additionalContext line is emitted only when `askpm-remind` is on. `askpm-remind` on with `askpm-log` off does nothing (no rows to read) and says so once on stderr.
3. `scripts/pm-ask.js` writes `{kind:'disposition', ask_id, action:'close'|'progress'|'supersede', evidence?, task?, superseded_by?}`:
   - every referenced id must exist as an ask row; `supersede <old> <new>` requires old ≠ new and new newer than old;
   - `close <ask_id> --evidence <ref>`: ref is a 7–40 hex commit sha, a 26-char fleet ULID, a `d-` + 8 hex card id, an https URL or an existing absolute path; else exit 2;
   - `progress <ask_id> --task <ulid>`; `list [--open]`, `overdue [--hours 24]`: ≤ 30 lines, one per ask (`id age first-60-chars`), `… N more` beyond.
4. `hooks/askpm-remind.js` (Stop, direct entry): with the PM gate and `askpm-remind` on —
   - the ask is the one opened by this turn (askpm-log's open-ask rule); a turn without an open ask (fleet/system turn) is not checked;
   - Stop 1, ask has no disposition and no `reminded` row: append `{kind:'reminded', ask_id, pending_reply}` where `pending_reply` is askpm-log's `lastAssistantText` at that moment (the answer to the operator), and return `{"decision":"block","reason":"ask_id a-xxxxxxxx 尚未處置：pm-ask close/progress/supersede"}`;
   - next Stop (a `reminded` row exists): never blocks; writes the reply row from `pending_reply`, without the transcript match (the block reason is now the last user entry);
   - ask already disposed at Stop 1: writes the reply row as askpm-log does today.
   With `askpm-remind` on, askpm-log's own Stop half skips the reply row (one writer per reply). With it off, askpm-log behaves exactly as today.
5. Daily overdue: on the first UserPromptSubmit of a UTC+8 day with `askpm-remind` on, advisory-relay adds `pm-ask overdue` output (≤ 30 lines) to additionalContext; a `remind-day` file in the state dir records the day.
Acceptance (askpm-log changes: red on base; unguarded stubs: `pm-ask.js` that appends any disposition unchecked, `askpm-remind.js` that always exits 0 silently): ask gets id; id line absent with `askpm-remind` off; injected prompt and `[voice call · unverified]` prompt get none; close without evidence / with "done" refused; supersede a-x a-x refused; unknown id refused; Stop 1 blocks, Stop 2 does not and writes the reply equal to Stop 1's assistant text; a later fleet turn never blocks; exactly one reply row per ask with both opt-ins on; `askpm-remind` off → no stdout, rows as today; overdue shows a 25 h ask, not a 23 h one; legacy rows ignored; 31 asks → 30 lines + `… 1 more`; child repo under the PM workspace untouched.

### P2 — parallel consultant barrier with de-identification (Size M)

1. `scripts/dispatch-panel.js --prompt-file F --seat <runner>:<model>[:<effort>] … --out-dir D [--timeout 15m]`:
   - read F once into memory; empty or unreadable → exit 4;
   - build the identifier list from `fleet directory` (courier, member and host names); a non-zero exit, timeout (10 s), parse failure or zero names → exit 4;
   - scan the in-memory text with `ar-redact.js` check mode, `redact-personal.js` rules, the leak-guard host/LAN pattern and the identifier list; any hit, scanner error or missing rule file → exit 4, print rule ids only, nothing written, zero seats run;
   - only then: refuse a symlinked D, create or `chmod` D to 0700, write `D/prompt.txt` 0600;
   - per seat: resolve aliases, then `cn-model-dispatch-gate.js check`; a barred or unknown seat is `{status:'barred'}` in `panel.json` and never spawned;
   - spawn `dispatch-author.sh` per allowed seat concurrently, cwd = a fresh empty 0700 temp dir, env without the vars listed in §2.5; output `D/<i>-<name>.out` with `<name>` reduced to `[a-z0-9.-]`;
   - wait with `wait-dispatch-results.js`; write `D/panel.json` `{schema:'autopilot.panel/1', seats:[{seat, status:'ok'|'failed'|'timeout'|'barred', rc, out_path, bytes}], complete}`; print one line.
2. The PM starts it with `run_in_background`; the one completion is the one wake.
Acceptance (unguarded stub: a `dispatch-panel.js` that writes the prompt and spawns every seat without scanning; stub runners record invocation count and env): 3 seats → one `panel.json`, exit after the slowest; one timeout → `complete:false`; fake email / fake `192.168.x.x` / a fake member name in F → exit 4, count 0, no `prompt.txt`; scanner rule file missing → exit 4, count 0; stub `fleet directory` failing or empty → exit 4, count 0; glm seat and an unknown runner → `barred`, not spawned; child env lacks `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` set in the parent; D as a symlink refused; `../x` in a model name stays inside D.

### P3 — tool-output truncation (Size S)

0. Probe (first step): in a throwaway PM-gated session, a PostToolUse hook returning `updatedToolOutput` for Bash; the transcript must show the replaced text as the tool result. Result recorded in `docs/plans/evidence/2026-11-17-pm-token-split/p3-probe.md`. If Bash is not replaced: Bash uses PreToolUse `updatedInput` rewriting the command to `( <cmd>` + newline + `) > <file> 2>&1; rc=$?; head -n 40 <file>; <pointer>; exit $rc` (the newline keeps heredocs and trailing comments intact); MCP stays on PostToolUse `updatedMCPToolOutput`. A-int wires whichever events the probe chose.
1. `hooks/pm-output-cap.js` (opt-in `pm-output-cap`, PM gate): Bash and `mcp__*` results over 40 lines (30 when the command or tool matches config `pm_output_cap.ledger_search_pattern`, default empty = rule off) → full text to `$XDG_RUNTIME_DIR/autopilot/pm-output/<id>.txt`, fallback `<state dir>/pm-output/` (dirs 0700, file 0600; `<id>` = `tool_use_id` reduced to `[A-Za-z0-9_-]`, or a random hex when that is empty); model sees the first 40 (30) lines plus `… N 行已截斷，全文：<path>`. Read/Grep/Glob and non-text results pass through.
Acceptance (unguarded stub: a pass-through `pm-output-cap.js`; tests call the hook script directly, so they do not need the A-int wiring): 41 lines → 40 + pointer, file holds 41; 40 untouched; ledger pattern → 30; non-PM / opt-in off untouched; MCP shape preserved; unsafe or empty `tool_use_id` stays inside the dir; with the PreToolUse fallback, a command with a heredoc, `exit 3` and a trailing `#` comment keeps its rc and output.

### P5 — intake rule check (Size S)

1. `scripts/pm-accept-check.js --checklist <file.json> --head <sha> --result <file>`. Checklist (written by the PM at dispatch time) schema `autopilot.accept-checklist/1`: `{repo, base, threshold_paths:[…], threshold_keys:[{path, json_pointer}], required_checks:[{name, record_path}], exception_patterns:[…]}`; `required_checks` must be non-empty (else exit 2). `--head` is given at intake time.
2. Conditions, all re-derived:
   - (a) thresholds unchanged: for non-empty `threshold_paths`, `git -C repo diff --quiet base head -- <paths>`; equal JSON values at each pointer;
   - (b) evidence matches version: `base` is a strict ancestor of `head`; the result names `head` (sha tokens of 7–40 hex not inside a longer hex run); every named sha resolves and is `head` or its ancestor;
   - (c) checks passed: each `record_path` is an `affected-suites.js --record` JSON whose `head` equals the full `head` and whose rc is 0;
   - (d) no exceptions: `git diff base head` adds no line matching `exception_patterns` (default: known-red, `skip`, `--no-verify`, `bypass`, `waiver`, `allow-failure`).
3. Output `ACCEPT` or `REJECT` with one line per failed condition; exit 0/1; bad checklist or args exit 2.
Acceptance (unguarded stub: always ACCEPT): all hold → ACCEPT; each condition broken alone → REJECT naming it; result "done, all green" with no sha → REJECT; base == head → REJECT; a 64-hex plan_sha256 in the result is ignored; empty `threshold_paths` does not diff the whole repo; empty `required_checks` → exit 2.

### P6 — switchboard runner, shadow mode (Size L)

1. Export: `scripts/switchboard-export.js --date D` runs in the PM's own session (the PM reads only its own session transcript, per card d-522f32f4) and writes two content-minimal jsonl files: inbound fleet messages `{message_id, from, kind, task_id?, reply_to?, at, text}` and PM handling events `{at, action:'reply'|'dispatch'|'task_result'|'send'|'turn', ref_message_id?, task_id?}` taken from the PM's `mcp__fleet__*` tool calls and turn starts. The runner never reads the PM's transcript or inbox itself.
2. Input allowlist (code, before any model). The operator has no fleet address (PM ruling 01M7M32A); operator input is the PM session's UserPromptSubmit plus `decision_answer` messages. So: the export (step 1) takes only fleet channel messages and never a UserPromptSubmit prompt; a row enters only if `from` is a member listed by `fleet directory` and `kind` ∈ {`chat`, `dispatch`, `broadcast`, `wake`}; everything else (`decision_answer`, `decision_close`, unknown kinds, rows without `from`, text starting with `[待決回覆` or `[voice call · unverified]`) is dropped and counted. An empty `fleet directory` result → exit 2, zero model calls.
3. Deterministic pre-classification (code): rows with a question mark or 嗎/呢 at line end, `rc=[1-9]`, `unhealthy`, `FAIL`, `blocked`, `A/B`, `例外|特例`, a shared-pool name (read at run time from every pool field of capacity's `out/pace.v1.json`, path from config `switchboard.pace_file`; unreadable or no pools → every row mentioning `pool`/`池` escalates; PM 01M7M372), or unparseable text → `escalate` items built by code without the model.
4. Model call per batch for the rest: `claude -p --model sonnet --output-format json --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources "" --disable-slash-commands`, cwd = empty 0700 temp dir, config dir and env per §2.5, cn gate first. Batch ≤ 30,000 estimated tokens.
5. Item contract (`autopilot.switchboard-item/1`, ten fields): `item_no` (int), `lane` (string), `task_id` (ULID|null), `type` (`提問`|`疑似該退件`|`越權`|`失敗`|`逾期`|`卡片就緒`|`看不懂`|`auto`), `ask_ref` (ask_id|null), `facts` (≤ 3 × `{text ≤ 200 chars, ref}`), `options` (string[] ≤ 4), `recommendation` (string, code appends `（建議，非決定）`), `deadline` (RFC 3339|null), `source_message_ids` (string[] ≥ 1).
6. Post-validation (code): every input `message_id` maps to exactly one item via `source_message_ids`; a missing, duplicated or invalid item, or a failed batch parse, yields a code-built `看不懂` item `{type:'看不懂', facts:[{text:'<raw text, split by code>', ref:message_id}], options:[], recommendation:'上呈 PM（建議，非決定）'}`; any `auto` item matching a step-3 rule becomes `escalate`.
7. Packets (`scripts/lib/packet-builder.js`): estimator `ceil(ascii_chars/2 + non_ascii_codepoints*1.5)` applied to the serialized packet including labels; each packet ≤ 1,500 and ≤ 5 items. Packet 1 reserves 200 for the auto-handled block (count + 3 samples, each one line ≤ 60). An item larger than the remaining budget starts a new packet; larger than a whole packet: continuation parts `(1/k)…(k/k)` split at line, then sentence, then codepoint boundaries, concatenation equal to the original. Output `<state>/switchboard/shadow/<date>/packet-<n>.md` + `packets.json`.
8. Compare: `switchboard-run.js compare --date D --handling <export>` reports per inbound message: escalated & handled, escalated & no recorded handling, auto & handled by PM (possible swallow), auto & not handled; messages answered by `send` without `reply_to` are counted `unobservable`; plus the PM's turns per day (wake count) from the turn events.
9. Kill switch: `switchboard.enabled=false` or `AUTOPILOT_SWITCHBOARD=off` → exit 0, zero model calls.
10. `skills/switchboard/SKILL.md` (contract-card shape): when to run, allowlist, packet contract, shadow only.
Acceptance (unguarded stubs: a runner passing all rows to the model; a builder truncating at 1,500; stub `claude` recording argv/env/cwd/config-dir contents): empty directory → exit 2, zero calls; `decision_answer`, `[待決回覆`, `[voice call · unverified]`, unknown-kind and non-member rows never reach the stub; the export contains no UserPromptSubmit text; argv has the five isolation flags, cwd empty, config dir holds only the fake `.credentials.json` and is gone after normal exit, after SIGTERM and after a thrown error; scrubbed vars absent; question row escalated with zero model calls; model output missing one input id → `看不懂` with the raw text; duplicate id → one item; field missing → `看不懂`; 7 items → 5 + 2; 4,000-token CJK item and a 6,000-char unbroken ASCII line → parts ≤ 1,500 each, concatenation equal; long samples → each clipped to one line ≤ 60; batch over 30k → ≥ 2 calls; kill switch → zero calls; compare marks an inbound with a matching PM reply `handled` and one answered by `send` `unobservable`.

### P4 — `pm-act` macro (Size M)

0. `scripts/pm-ledger.js lint|write|search` (§8 Q2): `write` never writes the ledger itself, it runs `ledger.sh`; `search` caps at 30 lines. Tests use a stub `ledger.sh`.
1. `scripts/pm-act.js --plan act.json [--check]`; schema `autopilot.pm-act/1`: `{dispatch:[{to, task, class?}], reply:[{message_id, content}], ledger:[{text}]}` (dispatch + reply + ledger only).
2. Preflight before any side effect: `work-order-plan.js` rule on each dispatch; config `pm_act.ledger_lint_cmd` on each ledger entry (entry text on stdin, exit 0 = pass, stdout ignored); unset ledger commands with ledger entries → preflight failure. Any failure → exit 2, every failure listed, nothing sent or written. `--check` stops here.
3. Execute in order ledger (`pm_act.ledger_write_cmd`, entry on stdin) → dispatch → reply; stop at the first failure; print `done|failed|skipped` per action.
4. Journal: `<state>/pm-act/<sha256 of act.json>.json` records each completed action before the next starts; a re-run with the same file skips completed actions and says so.
5. Signing: dispatch and reply use the interface the fleet lane names in answer to 01M7M1GE (session-bound CLI identity, which `pm-act` calls directly; or a batched MCP tool, in which case `pm-act` does preflight + ledger + journal and prints the one MCP call for the PM to make, and the journal marks the fleet actions done when the PM re-runs with `--confirm <message ids>`). The shell CLI identity is never used.
Acceptance (unguarded stub: a `pm-act.js` that executes without preflight; stub fleet and ledger CLIs): valid plan → ledger, dispatch, reply in order, each once, signed as the session; one bad ledger entry → zero side effects; unmarked Size M dispatch → zero side effects; failure at reply → report done/done/failed, re-run sends only the reply; `--check` sends nothing.

### Q — quality measurement and rollback (Size M; PM ruling 01M7M32A)

Must be complete before B-int, and before the switchboard ever handles real traffic.

1. Baseline: `scripts/switchboard-quality.js baseline --days 7` runs the PM's own `extract.py` (PM repo `knowledge/sources/2026-11-17-pm-token`, path from config `switchboard.extract_script`, run in the PM's session) and stores per-day tokens per turn and turns per day in `<state>/switchboard/quality/baseline.json`. This lane does not copy or edit `extract.py`.
2. Daily checks (`switchboard-quality.js daily --date D`), from the shadow packets and the handling export:
   - auto-intake audit: a deterministic 10 % sample (at least 1) of `auto` items re-classified by a second, non-CN family engine (astra or carbon; same isolation as P6 step 4); a disagreement where the second engine says escalate counts as a wrong intake;
   - swallow review: 50 random non-escalated messages (all when fewer) reviewed the same way; one judged a question counts as swallowed;
   - decision latency: for escalated items with a recorded PM handling event, p50 and p95 of (handling at − item at);
   - output `quality/<date>.json` and one summary line.
3. Rollback rules (synthesis "回滾"): 1 authority breach, 1 missed operator ask (P1 overdue), 1 wrong executor, 1 sensitive-data send, ≥ 2 wrong intakes in a day, ≥ 1 swallowed question, or re-ask rate / p95 latency ≥ 20 % worse than baseline two days running. Any trigger sets `switchboard.mode` in `<state>/switchboard/mode.json` to `shadow` (the runner refuses any other mode change from code) and writes the unresolved items of the affected days as packets addressed to the PM (`replay/<date>/`), then prints one line naming the rule.
4. The PM's one-key bypass is P6's kill switch.
Acceptance (unguarded stub: `daily` that always reports pass): a fixture with 2 wrong intakes → rollback to shadow + replay packets; 1 swallowed → rollback; clean day → no change; sample size is 10 % rounded up; second engine is never a CN family (cn gate test); p50/p95 computed on a fixture with known values; baseline reads only the configured script's output. Real run: baseline over the PM's last 7 days and one `daily` on the replayed P6 day, on the PM host.

### A-int / B-int — integration (Size S each)

1. Wire every new script, hook, opt-in stem, config key and skill of the delivery into the files listed in §3; run `bash scripts/sync-all.sh`; CHANGELOG Unreleased lines.
2. Negative control: before wiring, `check-hook-inventory.js --check` and `sync-all.sh --check` are red on the phases' merged tree; after, green.
3. Delivery suites: `node scripts/affected-suites.js --base origin/develop --run --record`; `validate.sh`; leak-guard; hetero code review of the delivery range.
Done when: both checks green, suites green against the develop baseline, review SHIP or PM ruling, merged to `develop`.

## 5. Test / validation and schedule

- Per phase tests as above, red then green.
- Implementers are non-Claude (hydrogen; codex when its pace allows); reviewers from a different family.
- Delivery A: A-int merged → PM go → live pin on the PM host by 2026-11-18 15:00 → the PM turns on the opt-ins in its own session → real runs before 18:00: one refused and one accepted dispatch (P0), `pm-ask list` after ≥ 5 asks (P1), one three-seat panel on a short non-sensitive question (P2), one 100-line command whose transcript tool_result shows 40 lines + pointer (P3).
- Delivery B: B-int merged → PM go → live pin by 2026-11-20 15:00 → real runs: one real task checked by `pm-accept-check` (P5), replay of one exported past day with packets + compare report (P6, no 24 h soak needed), one PM turn through `pm-act` whose reply the recipient sees from the PM session address (P4).
- Evidence for each real run: `docs/plans/evidence/2026-11-17-pm-token-split/`.

## 6. Risks + inversion

- Stop reminder blocks every turn → only the ask opened by this turn, once (`reminded` row), never fleet/system turns (P1 step 4).
- Reminder loses the operator reply → reply text captured at Stop 1 (`pending_reply`), single writer (P1 step 4, tested).
- Truncation hides the decisive last line → full text on disk with its path in the pointer; Read/Grep untouched; PM sessions only (P3).
- pm-act sends as a shell inbox → never; P4 step 5.
- pm-act retry duplicates a ledger entry or a dispatch → journal keyed by the act file hash (P4 step 4, tested).
- Switchboard swallows a question → deterministic escalation before and after the model, 1-to-1 id accounting (P6 steps 3 and 6); shadow only; the PM still receives everything.
- Operator message reaches the switchboard → allowlist with a mandatory operator list (P6 step 2).
- Packet over budget → conservative estimator on the serialized packet, codepoint fallback split (P6 step 7, tested with unbroken ASCII).
- De-id misses an internal name → identifier list from `fleet directory`, fail closed on any scanner or directory failure, nothing on disk before the scan (P2). Residual: a name absent from fleet; consultants are non-CN families only.
- A mislabelled order blocks a lane → the PM issues a corrected order; the lane runs `set --fleet-task <new id>` or `--refresh` (P0 step 3).
- A fleet outage blocks a lane with an attached order → intended (fail closed); `--refresh` after recovery.
- Cache trap: fewer wakes spaced beyond the 5-minute cache TTL turn each wake into a full cache write (~12× read cost) at the same context length. P2 and P6 cut wakes, not context; P6's compare reports the PM's turns per day so the effect is measured; the context counterpart (daily new PM session) is the PM's step and out of scope.

## 7. Out of scope

- Card-answer auto-forward (synthesis item 2): owned by the fleet lane (01M7KZZ8). This lane only adds, when the fleet lane asks for it, per-option executor and command fields to `scripts/open-decision.js`.
- 200k autocompact and the daily new PM session: owned by hangar (wrapper and restart). This lane provides the handover state files: the ask register (P1 jsonl + `pm-ask list --open`) and PM-STATE.
- `pm-act` card opening, ask disposition and intake actions (`pm-ask` and `pm-accept-check` stay separate commands).
- Switchboard live mode, Haiku classification, Sonnet shadow PM, autocompact changes, daily new PM session.
- Any change to `~/.claude`; turning the opt-ins on at the PM host (the PM does it).
- SQLite.

## 8. Open questions (PM)

1. Answered (01M7M32A): card-answer auto-forward belongs to the fleet lane (§7).
2. Answered (01M7M32A): `scripts/ledger.sh` stays the only ledger write path; commands are `pm-ledger lint`, `pm-ledger write` (wraps `ledger.sh`) and `pm-ledger search` (≤ 30 lines). Config defaults: `pm_act.ledger_lint_cmd = "pm-ledger lint"`, `pm_act.ledger_write_cmd = "pm-ledger write"`, `pm_output_cap.ledger_search_pattern = "^pm-ledger search\\b"`. The operator has no fleet address (P6 step 2). Pool names come from `pace.v1.json` (P6 step 3; PM 01M7M372). The three `pm-ledger` wrappers ship in this plugin as `scripts/pm-ledger.js` (`lint`, `write` = pipes the entry to the PM repo's `scripts/ledger.sh`, path from config `pm_ledger.ledger_sh`; `search` ≤ 30 lines), built in P4; `ledger.sh` stays in the PM repo and remains the only write path (PM 01M7M372).
3. Answered (01M7M32A): real runs are on the PM host, in the PM session under the cookys account.
4. P4 signing interface: pending the fleet lane (01M7M1GE, acknowledged; answer next session). P4 starts when it arrives; if none by 2026-11-19 12:00, P4 ships the `--check` + ledger + journal half on 11-20 and the fleet half follows the interface.
5. Should `pm-act` also carry `pm-ask` dispositions (the synthesis puts "close with evidence" in item 1, not item 5)? Default: no.

## Review log

- R0: author depth-0 (autopilot lane), 2026-11-17. Manifest `project/plans/2026-11-17-pm-token-split.manifest.json`, rubric `project/plans/2026-11-17-pm-token-split.rubric.md`; seats astra (chair, openai) + grok (boundary red-team, xai).
- Generation 1 (logical id `pm-token-split-2026-11-17`): no semantic verdict; required seat grok_redteam failed both attempts with HTTP 402. Re-opened as `pm-token-split-2026-11-17-b` with the red-team seat on agy gemini-4-carbon-high (google); ticket `01M7KZZ1ZT3V1KTKNR3E4MFK4B-b`.
- Generation 1 (`-b`, astra + carbon, both STOP): 11 blocking, 7 non-blocking, all accepted; repaired in 82a975f2b.
- Generation 2 (`-b`, reviewed 82a975f2b, both STOP, CONDITIONAL at the generation cap): 12 blocking, 2 non-blocking. Depth-0 accepted all 12 and repaired them in this revision (post-head delta, not re-reviewed): P0 fail-closed on unresolved orders, anchored markers, L/XL receipt re-record at `--to implement --plan`, stage reset, new-id replace; new PM gate stopping at `.git` with `mode:"program"`; P1 reminder as a direct Stop hook with `pending_reply` and one reply writer, full row schema, id validation; P2 scan in memory before any write, fail closed on `fleet directory`, env scrub, unknown seats barred; P3 stubs, probe evidence outside the plan, newline-safe fallback; P5 `--head` at intake, record schema, ancestry and empty-list rules; P6 ten-field contract, allowlist with mandatory operator list, Node config-dir cleanup, 1-to-1 accounting, conservative estimator and codepoint split, compare from the PM's own export with wake count; P4 limited to dispatch + reply + ledger with a journal; dependencies by code edge with A-int → B phases; real runs after each pin; A-int/B-int done-when and negative controls. Not repaired in the plan: the P4 signing interface (external, §8 Q4) — the PM rules on it at the cap.
- PM ruling 01M7M32A (2026-11-17): option A, frozen at d8fab0048 and implementation starts; the PM checked all 12 G2 items (10 fixed; #5 and #11 wait only on P4 signing, handled per §8 Q4). Three additions folded in without another review generation, as ruled: phase Q (quality measurement and rollback, before B-int); P0 denies a PM dispatch with no Size; §7 names owners for the two excluded items. §8 answers recorded.
