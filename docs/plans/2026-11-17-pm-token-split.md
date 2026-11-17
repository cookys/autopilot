# Plan — PM seat token split: scripted PM chores (fleet task 01M7KZZ1ZT3V1KTKNR3E4MFK4B)

Status: draft for plan review · logical_plan_id: `pm-token-split-2026-11-17-b` · Size: L (seven phases)

## 0. Context / thesis

The PM seat read ~5 billion cached tokens in two days (4,274 turns, 3.64 API calls per turn, ~320k tokens re-read per call). The PM's synthesis (fable / astra / carbon, PM final v1, 2026-11-17) found that 45–78 % of that volume carries no judgment: routine intake, one wake per consultant reply, many tool round-trips per turn, long tool output, and an over-long context. The work order selects six scripted chores, split into two deliveries:

- (A) by 2026-11-18 18:00 (UTC+8): (1) request register, (2) parallel consultant barrier with de-identification, (3) tool-output truncation.
- (B) by 2026-11-20 18:00 (UTC+8): (4) `pm-act` macro, (5) intake rule check, (6) switchboard runner in shadow mode.

The PM added one item on 2026-11-17 (message 01M7M071), to ship with (1): a work order of Size M or larger must carry `Plan: <path>@<sha>` or `plan-first`, and a lane's dev-flow refuses to enter implementation on such an order without a frozen plan receipt. That is phase P0.

Facts this plan builds on (verified in this repo or the official docs):

- `hooks/askpm-log.js` (opt-in stem `askpm-log`, PM-gated by `.claude/console.json` schema `autopilot.console/1`) appends `{schema:'autopilot.askpm/1', kind:'ask'|'turn'|'reply', at, …}` rows to one jsonl under the account state dir; it never writes stdout; its UserPromptSubmit half runs inside `hooks/advisory-relay.js` and its Stop half is spawned by `hooks/opt-in-multiplexer.js`. Stop writes one reply per ask and honours `stop_hook_active` re-entry.
- `hooks/_shared/opt-in.js`: default-off gate (`~/.autopilot/config.json {"hooks":{"<stem>":true}}` or `AUTOPILOT_HOOK_<STEM>=1`).
- Inventories a new opt-in hook must touch: `hooks/hooks.json`, `hooks/opt-in-manifest.json`, `hooks/README.md` (tier counts), root `CLAUDE.md` counts (checked by `scripts/check-hook-inventory.js --check`), `profiles/hook-classes.json` + `platforms/codex/plugin/profiles/hook-classes.json` (hash pinned in `profile-catalog.json`), codex mirrors via `bash scripts/sync-all.sh`.
- `references/stage-graph.json`: node ids are `plan`, `plan-review`, `implement`, `verify`, …; size M = `plan` → loop(`implement`,`verify`); L/XL add `intent`, `proposal`, `plan-review`. `scripts/check-phase-review-receipt.js --plan-artifact` verifies `plan_sha256`.
- `session-mode.js set --fleet-task <id>` stores `fleet_task_id`; `fleet task show <id> --json` returns the order in field `title` (whether it is ever truncated is being confirmed with the fleet lane, message 01M7M1GE; P0 treats a missing `Size:` line as "no declared size", so truncation can only under-gate, never mis-gate).
- `fleet send` / `fleet task` CLI sign as the CLI identity, not as the calling Claude session (`fleet send --help`), so a reply sent from a shell lands in an inbox no session reads.
- Claude Code hooks (https://code.claude.com/docs/en/hooks): PostToolUse `hookSpecificOutput.updatedToolOutput` (built-in and MCP) / `updatedMCPToolOutput` (MCP only); Stop accepts `decision:"block"` + `reason`; UserPromptSubmit input has `prompt` and may return `additionalContext` (≤ 10,000 chars). Whether a Bash result is actually replaced in the model's view is verified by P3 step 0 before P3 is built on it.

## 1. Problem

The PM must spend context on decisions, not bookkeeping: no operator request lost across compactions; one wake per consultation; no 400-line tool result in context; one PM turn's dispatch + reply + ledger entry in one call; intake decided by a script from re-derived evidence; routine fleet traffic classified by a cheap isolated runner; and the PM's own lapse (M-size work dispatched without a plan) refused by code.

## 2. OKR / KRs

- KR1: in a PM session with the opt-in on, every operator prompt gets an `ask_id`; `pm-ask overdue` lists every ask open > 24 h; an undisposed ask produces exactly one Stop reminder. Measured over the PM's first real session (≥ 5 asks) before delivery A; the one-day count is reported 2026-11-19.
- KR2: a three-seat consultation produces one wake and one combined result file; a prompt with a personal identifier, a LAN address or a fleet host name is refused before any seat is called.
- KR3: in a PM session, a tool result > 40 lines reaches the model as 40 lines + one pointer line (ledger search: 30 + pointer), verified in the PM's transcript.
- KR4: one `pm-act` call performs dispatch + reply + ledger write signed as the PM session; a lint failure in any part sends nothing.
- KR5: `pm-accept-check` returns ACCEPT only when all four conditions hold; an executor's "done" alone never yields ACCEPT.
- KR6: the switchboard runner, replayed over one day of the PM's real inbound fleet traffic, produces packets that meet the packet contract, and a comparison report against the PM's actual handling exists by 2026-11-20 18:00.
- KR7: a PM dispatch declaring Size M+ without a plan marker is refused at send; a lane whose order declares M+ cannot reach `implement` without a frozen plan receipt.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Ships inside the autopilot plugin. PM-side behaviour is opt-in (default off) AND gated by `.claude/console.json` schema `autopilot.console/1`. Lane-side P0 behaviour fires only when the session's fleet work order declares `Size: M|L|XL`; sessions without such an order see no change.
- Reuse existing hook entries: UserPromptSubmit logic goes into the `advisory-relay.js` host path; Stop halves through `opt-in-multiplexer.js`; the only new hook script is P3's PostToolUse `hooks/pm-output-cap.js`, wired into `hooks/hooks.json`, `hooks/opt-in-manifest.json`, `hooks/README.md`, root `CLAUDE.md` counts and `profiles/hook-classes.json` (+ codex mirror) so `check-hook-inventory.js --check` and `sync-all.sh --check` stay green.
- Node built-ins only; jsonl via `scripts/lib/jsonl-store.js`; no SQLite.
- No phase reads, prints or copies a credential, token, `.env`, key file or auth store, with one exception already sanctioned by the repo (`references/hetero-dispatch.md`): a model child gets a fresh 0700 throwaway config dir seeded with only `.credentials.json`, removed on exit (trap), never the real `~/.claude`. Tests use fake values only.
- The switchboard runner can never approve, open cards, dispatch, reply to the operator, touch credentials, extend deadlines or edit authority. Its child runs with no built-in tool, no MCP server, no project settings, no slash commands, from an empty cwd. Operator messages never enter it.
- No Chinese-made model (GLM / Qwen / DeepSeek / MiniMax / Kimi / qoder) receives PM traffic, prompts or transcript content; every model call in this plan passes `scripts/lib/cn-model-dispatch-gate.js check` and scrubs `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL` from the child env.
- Every new or changed check ships a negative control: for a changed file, the new test fails on the base revision; for a new script, the test is first run against a stub that implements the unguarded behaviour (named per phase) and fails on the behavioural assertion, not on MODULE_NOT_FOUND.
- Times shown to people are UTC+8; machine fields are RFC 3339 UTC.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible` — askpm-log rows gain optional fields and new kinds (`disposition`, `reminded`); old readers ignore unknown kinds. P0 adds a refusal path to `stage-advance.js` and `session-mode.js` that triggers only on orders declaring Size M+, a convention the PM introduces with this plan; the PM-side guard is opt-in. No consumer outside this repo reads the askpm jsonl.
- **Dependency decision**: `existing` — Node built-ins, `jsonl-store.js`, `wait-dispatch-results.js`, `ar-redact.js`, `redact-personal.js`, `cn-model-dispatch-gate.js`, `dispatch-author.sh`, `open-decision.js`, the fleet CLI.

## 3. File-structure map

| File | Phase | Responsibility |
|---|---|---|
| `hooks/fleet-send-work-order-guard.js` (existing PreToolUse fleet guard) | P0 | PM side (opt-in stem `pm-dispatch-plan-guard` + console gate): refuse `mcp__fleet__dispatch` declaring Size M+ without a marker |
| `scripts/lib/work-order-plan.js` (new) | P0 | parse an order text → `{size, plan}` |
| `scripts/session-mode.js` | P0 | `set --fleet-task <id> [--refresh]` stores `wo_size`, `wo_plan`; size floor |
| `scripts/stage-advance.js` | P0 | refuse `--to implement` without a frozen plan receipt when `wo_size` ≥ M; `--plan <path>` records the receipt at the `plan` node |
| `hooks/askpm-log.js`, `hooks/advisory-relay.js`, `hooks/opt-in-multiplexer.js` | P1 | ask_id, reminder (opt-in stem `askpm-remind`), daily overdue context |
| `scripts/pm-ask.js` (new) | P1 | close / progress / supersede / list / overdue |
| `scripts/dispatch-panel.js` (new) | P2 | N seats in parallel, fail-closed de-id, one wake, one `panel.json` |
| `hooks/pm-output-cap.js` (new, PostToolUse, opt-in stem `pm-output-cap`) | P3 | cap model-visible output at 40 (ledger search 30) lines |
| `scripts/pm-accept-check.js` (new) | P5 | four-condition verdict |
| `scripts/pm-act.js` (new) | P4 | one JSON plan → lint all → ledger + dispatch + reply + ask close |
| `scripts/switchboard-run.js`, `scripts/lib/packet-builder.js`, `skills/switchboard/SKILL.md` (new) | P6 | isolated classifier, deterministic packets, shadow compare |
| Integration step per delivery (one commit, one owner): `docs/scripts-inventory.md`, `scripts/CLAUDE.md`, `CHANGELOG.md`, `docs/guide/installation.md`, `config-keys.json`, hook inventories above, skill inventory (`skills/` index, `CLAUDE.md` skill count, codex mirror) | A-int, B-int | wiring; parallel phases never edit these files |
| tests: `hooks/tests/<phase>.test.sh`, `scripts/<script>.test.js` | all | red-then-green |

## 4. Phases

Dependencies (code edges only): P0 ∥ P1 ∥ P2 ∥ P3 → A-int (delivery A). P5 ∥ P6 (P6 needs P1's ask rows for its compare only) → P4 (needs P0's `work-order-plan.js`, P1's `pm-ask`, P5's check as an optional `accept` action) → B-int (delivery B). Parallel phases share no file; all shared docs/inventory edits are in A-int / B-int.

### P0 — work-order plan-first gate (Size M)

1. PM side: in `fleet-send-work-order-guard.js`, when opt-in `pm-dispatch-plan-guard` is on and the console gate passes and the tool is `mcp__fleet__dispatch`: parse the `task` text with `work-order-plan.js`. Size M/L/XL without `Plan: <path>@<sha>` (sha = 7–40 hex) or `plan-first` → deny with `工單 Size M 以上要帶「Plan: 路徑@sha」或「plan-first」`. No `Size:` line → allowed (the PM rule covers declared sizes only). The PM dispatches through MCP; a Bash `fleet` CLI has no dispatch subcommand (`fleet task --help`), so there is no second path to guard.
2. `work-order-plan.js parse(text)`: first line matching `/^\s*Size:\s*(XS|S|M|L|XL)\b/m` (also inside the `Engine: … | Size: X |` brief header); `Plan:\s*(\S+)@([0-9a-f]{7,40})` or the token `plan-first`. Returns `{size|null, plan: {path, sha}|'plan-first'|null}`.
3. `session-mode.js set --fleet-task <id>` runs `fleet task show <id> --json`, parses `title`, stores `wo_size`, `wo_plan`, `wo_fetched_at` on the marker. If the fetch fails: store `wo_size:null` and print one stderr line (the gate cannot apply; it never blocks on a fleet outage). `set --size X` with X below a stored `wo_size` is refused; `set --fleet-task <id> --refresh` re-fetches (the recovery after the PM fixes a mislabelled order with `fleet task resize`/a corrected order). A `set --size` issued before `--fleet-task` is checked when `--fleet-task` lands: marker size below `wo_size` → the `--fleet-task` call raises the marker size to `wo_size` and says so.
4. Frozen plan receipt (minimum): `{path, blob_sha, plan_sha256, recorded_at}` where `blob_sha` = `git rev-parse <commit>:<path>` of a committed file and `plan_sha256` = sha256 of that blob's bytes. `stage-advance.js --to implement` with `wo_size` ≥ M requires a receipt on the marker whose blob still resolves (`git cat-file -e`) and, for L/XL, a `check-phase-review-receipt.js --plan-artifact` pass whose `plan_sha256` equals the receipt's. Routes: `Plan: path@sha` orders — the receipt is derived from `<sha>:<path>` at `set --fleet-task`; `plan-first` orders — `stage-advance.js --to <next after plan> --plan <path>` at the end of the `plan` node writes the receipt from HEAD (refused if the file is uncommitted or dirty).
Acceptance (each red on the base revision, green after): PM guard — `Size: M` without marker denied; with `Plan: docs/plans/x.md@abc1234` allowed; with `plan-first` allowed; no `Size:` allowed; opt-in off untouched; non-PM cwd untouched. Lane — `wo_size=M`, no receipt → `--to implement` refused; plan node finished without `--plan` → still refused; `--plan` on a dirty file refused; valid receipt → allowed; receipt whose blob no longer resolves → refused; L with receipt but no plan-review pass → refused; `set --size S` on `wo_size=M` refused; `--refresh` after a corrected order unblocks; marker without a fleet task untouched. Real run on the PM host: one refused and one accepted dispatch captured from the PM session after the live pin.

### P1 — request register (Size M)

1. Ask row: `{schema, kind:'ask', at, ask_id, session_id, text}`; `ask_id = 'a-' + sha256(session_id + '\n' + at + '\n' + text).slice(0,8)`. The id reaches the model as one `additionalContext` line `ask_id a-xxxxxxxx` (advisory-relay host). Rows written before this phase have no `ask_id` and are ignored by every `pm-ask` view (cutoff = first row with an `ask_id`; no flood on day 1).
2. Disposition rows (via `jsonl-store.js`): `{kind:'disposition', at, ask_id, action:'close'|'progress'|'supersede', evidence?, task?, superseded_by?}`. `scripts/pm-ask.js`:
   - `close <ask_id> --evidence <ref>`: ref must match a commit sha (7–40 hex), a fleet message/task id (26-char ULID), a `d-` card id, an https URL or an existing absolute path; anything else exit 2;
   - `progress <ask_id> --task <ulid>`; `supersede <old> <new>` (old counts as closed by new);
   - `list [--open]` and `overdue [--hours 24]`, ≤ 30 lines, one line per ask (`id age first-60-chars`), output `… N more` beyond 30.
3. Reminder (separate opt-in stem `askpm-remind`, inside askpm-log's Stop half so ordering is in one process): at Stop, if the ask opened by this turn has no disposition row and no `reminded` row: append `{kind:'reminded', ask_id}`, write no reply row, return `{"decision":"block","reason":"ask_id a-xxxxxxxx 尚未處置：pm-ask close/progress/supersede"}`. On the following Stop (re-entry or later turn) the `reminded` row exists → never blocks again; the reply row is written then (askpm-log's existing "first Stop wrote nothing" path). A turn whose ask was opened earlier (fleet/system turn) is never checked. With `askpm-remind` off, askpm-log behaves exactly as today (stdout silent).
4. Daily overdue: on the first UserPromptSubmit of a UTC+8 day in a PM session with `askpm-remind` on, `additionalContext` carries `pm-ask overdue` output (≤ 30 lines); a `remind-day` file in the state dir records the day.
Acceptance (base-revision red for askpm-log tests; stub = askpm-log without dispositions for pm-ask): ask gets id; injected prompt gets none; close without evidence / with "done" refused; Stop blocks once, not on re-entry, not on a later fleet turn; reply row written after the reminder, not before; `askpm-remind` off → no stdout, rows as today; supersede closes old; overdue shows 25 h ask, not 23 h; legacy rows ignored; 31 asks → 30 lines + `… 1 more`. Real run: first PM session with the opt-ins on (≥ 5 asks), `pm-ask list` captured.

### P2 — parallel consultant barrier with de-identification (Size M)

1. `scripts/dispatch-panel.js --prompt-file F --seat <runner>:<model>[:<effort>] … --out-dir D [--timeout 15m]`:
   - reads F once into memory; empty/unreadable → exit 4; writes the snapshot `D/prompt.txt` (0600; D created 0700) and passes only the snapshot path to seats;
   - scans the snapshot with `ar-redact.js` (check mode), `redact-personal.js` rules, the leak-guard host/LAN pattern, and a host list built from `fleet directory` courier names; any hit, scanner non-zero exit or missing rule file → exit 4, print rule ids only, zero seats run;
   - each seat: resolves aliases first, then `cn-model-dispatch-gate.js check`; a barred seat gets `{status:'barred'}` in `panel.json` and is never spawned;
   - spawns `dispatch-author.sh` per allowed seat concurrently with cwd = an empty 0700 temp dir (no repo context attached); output `D/<i>-<sanitized>.out` where sanitized = `[a-z0-9.-]` only;
   - waits with `wait-dispatch-results.js`; writes `D/panel.json` `{schema:'autopilot.panel/1', seats:[{seat, status:'ok'|'failed'|'timeout'|'barred', rc, out_path, bytes}], complete}` and prints one line.
2. The PM starts it with `run_in_background`; the one completion is the one wake.
Acceptance (stub runners counting invocations; unguarded stub = spawn-all script without scan): 3 seats → one `panel.json`, exit after the slowest; one timeout → `complete:false`, others kept; fake email / fake `192.168.x.x` / a fake courier name in F → exit 4, invocation count 0; scanner crash (rule file missing) → exit 4, count 0; a seat resolving to glm → `barred`, count excludes it; `../x` in a model name stays inside D. Real run: one three-seat panel (astra / carbon / hydrogen) on a short non-sensitive question on the PM host.

### P3 — tool-output truncation (Size S)

0. Probe (first commit of the phase, before any other step): a throwaway PM-gated session with a PostToolUse hook returning `updatedToolOutput` for Bash; the transcript must show the replaced text as the tool result. If Bash is not replaced, P3 switches to the PreToolUse path: `updatedInput` rewrites the Bash command to `{ <cmd> ; } > <file> 2>&1; rc=$?; head -n 40 <file>; <pointer line>; exit $rc` (MCP results still use `updatedMCPToolOutput`). The probe result is recorded in the Review log.
1. `hooks/pm-output-cap.js` (opt-in stem `pm-output-cap`, console gate): for Bash and `mcp__*` results over 40 lines (30 when the command/tool matches config `pm_output_cap.ledger_search_pattern`, default empty), write the full text to `$XDG_RUNTIME_DIR/autopilot/pm-output/<safe-id>.txt`, fallback `<state dir>/pm-output/` (dirs 0700, file 0600; `safe-id` = `tool_use_id` filtered to `[A-Za-z0-9_-]`), and return the first 40 (30) lines plus `… N 行已截斷，全文：<path>`. Read/Grep/Glob and non-text results pass through.
Acceptance (base red, since the hook does not exist the test asserts the capped shape against the hook entry): 41 lines → 40 + pointer, file holds 41; 40 untouched; ledger pattern → 30; non-PM/opt-in off untouched; MCP shape preserved; unsafe `tool_use_id` stays inside the dir. Real run: one 100-line command in the PM session; the PM transcript's tool_result shows 40 lines + pointer.

### P5 — intake rule check (Size S)

1. `scripts/pm-accept-check.js --checklist <file.json> --result <file>`; checklist schema `autopilot.accept-checklist/1`: `{repo, base, expected_head, threshold_paths:[…], threshold_keys:[{path, json_pointer}], required_checks:[{name, receipt_path, expect_rc}], exception_patterns:[…]}`. The PM writes it at dispatch time; `--result` is the executor's result text.
2. Conditions, all re-derived: (a) thresholds unchanged: `git -C repo diff --quiet base expected_head -- threshold_paths` and equal JSON values at each pointer; (b) evidence matches version: every sha in the result text resolves in the repo and is `expected_head` or its ancestor, and at least one sha is present; (c) checks passed: each `receipt_path` exists, names `expected_head`, rc = `expect_rc` (no command re-run in this phase); (d) no exceptions: `git diff base expected_head` adds no line matching `exception_patterns` (default: known-red, `skip`, `--no-verify`, `bypass`, `waiver`, `allow-failure`).
3. Output `ACCEPT` or `REJECT` with one line per failed condition; exit 0/1; bad checklist exit 2.
Acceptance (unguarded stub = always ACCEPT): all hold → ACCEPT; each condition broken alone → REJECT naming it; result "done, all green" with no sha and no receipt → REJECT. Real run: one real PM task checked on the PM host.

### P6 — switchboard runner, shadow mode (Size L)

1. Input filter (code, before any model): `switchboard-run.js --batch <jsonl>`; each row must have `from` (courier-attested address) and `kind`; rows whose `from` is the operator's human address or whose kind is `decision_answer` are dropped and counted; a row without `from` is rejected (exit 2). `--export-instructions` prints the one command the PM runs in its own session to export a day of inbound fleet messages to jsonl (the runner never reads the PM's inbox itself).
2. Deterministic pre-classification (code): rows matching any of — a question mark or 嗎/呢 at line end, `rc=[1-9]`, `unhealthy`, `FAIL`, `blocked`, `A/B`, `例外|特例`, a shared-pool name, or unparseable — become `escalate` items without the model.
3. Model call per batch for the remaining rows: `claude -p --model sonnet --output-format json --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources "" --disable-slash-commands`, cwd = empty 0700 temp dir, `CLAUDE_CONFIG_DIR` = fresh 0700 dir seeded only with `.credentials.json` (removed by trap), env scrubbed of `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_*`, `cn-model-dispatch-gate.js check` passed first. Batch size: estimated tokens ≤ 30,000 with estimator `ascii_chars/3.5 + non_ascii_codepoints*1.5`.
4. Post-validation (code): every model item must carry the 10 fields; a missing/invalid field → item type `看不懂` (escalate); the recommendation is stamped `（建議，非決定）` by code; any item the model marks `auto` that also matches step 2 is forced to `escalate`.
5. Packet builder `scripts/lib/packet-builder.js`: each packet ≤ 1,500 estimated tokens (same estimator) and ≤ 5 items; the "auto-handled count + 3 samples" block goes in packet 1 and is reserved first; an item larger than the remaining budget starts a new packet; an item larger than a whole packet is split into continuation parts `(1/k)…(k/k)` at line or sentence boundaries with no text dropped.
6. Shadow: packets to `<state>/switchboard/shadow/<date>/`; `switchboard-run.js compare --date D --pm-log <askpm jsonl>` reports per item whether the PM acted on it (matched by task id / message id) and lists escalate items the PM never answered and messages the PM acted on that the runner auto-handled.
7. Kill switch: `switchboard.enabled=false` or `AUTOPILOT_SWITCHBOARD=off` → exit 0, zero model calls.
8. `skills/switchboard/SKILL.md` (contract-card shape): when to run, allowlist, packet contract, shadow only.
Acceptance (stub `claude` recording argv/env/cwd; unguarded stub = pass-through builder that truncates): operator / decision_answer rows never reach the stub; a row without `from` → exit 2; child argv contains the five isolation flags, cwd empty, config dir holds only the fake `.credentials.json` and is gone after exit, scrubbed vars absent; a question row escalated with zero model calls; model JSON missing a field → `看不懂`; 7 items → 5 + 2; a 4,000-token CJK item → continuation parts each ≤ 1,500, concatenation equals the original; batch over 30k → ≥ 2 calls; kill switch → zero calls. Real run: replay of one day of the PM's exported inbound traffic on the PM host, packets + compare report produced.

### P4 — `pm-act` macro (Size M)

1. `scripts/pm-act.js --plan act.json`; `act.json` schema `autopilot.pm-act/1`: `{dispatch:[{to, task, class?}], reply:[{message_id, content}], ledger:[{text}], ask:[{ask_id, action, evidence?|task?}], accept:[{checklist, result}]}`.
2. Preflight before any side effect: P0 parse rule on each dispatch; config `pm_act.ledger_lint_cmd` on each ledger entry (exit 0 = pass); `pm-ask` evidence rule on each ask; `pm-accept-check` on each accept (REJECT fails preflight). Any failure → exit 2, every failure listed, nothing sent or written.
3. Execute: ledger (`pm_act.ledger_write_cmd`, entry on stdin) → dispatch → reply → ask; stop at the first failure; print one line per action `done|failed|skipped`.
4. Signing: dispatch and reply go through the fleet path that signs as the calling Claude session. The fleet lane is asked which interface provides this (message 01M7M1GE: CLI identity bound to the session, or a batched MCP tool). This phase starts only after that interface exists; if the fleet lane cannot provide it by 2026-11-19 18:00 (UTC+8), the PM decides between shipping the preflight + ledger + ask half or moving P4's deadline. Signing as the shell CLI identity is never used.
Acceptance (stub fleet + stub ledger CLIs; unguarded stub = execute-without-preflight): valid plan → ledger, dispatch, reply, ask in order, each once, fleet stub sees the session identity; one bad ledger entry → zero side effects; failure mid-way → done/failed/skipped report. Real run: one PM turn executed through `pm-act` on the PM host; the recipient sees the reply from the PM session address.

### A-int / B-int — integration (Size S each)

Wire every new script/hook/skill/knob into the inventories in §3, run the codex mirror sync, CHANGELOG Unreleased lines; then the delivery's suites.

## 5. Test / validation

- Per phase tests as above (red on base or against the named unguarded stub, then green); `node scripts/affected-suites.js --base origin/develop --run`; `check-hook-inventory.js --check`; `sync-all.sh --check`; `validate.sh`; leak-guard.
- Code review: hetero code loop per delivery; implementers are non-Claude (hydrogen; codex when its pace allows), reviewers from a different family.
- Human-gated: real runs need the plugin pin promoted on the PM host (live-pin precedent, PM go per rollout) and the PM turning the opt-ins on in its own session. Schedule: delivery A pinned by 2026-11-18 15:00 so the PM's real session runs before 18:00; delivery B's P6 replay uses an exported past day, so it needs no 24 h soak before 2026-11-20 18:00.

## 6. Risks + inversion

- Stop reminder blocks every turn → only the ask opened by this turn is checked, once (a `reminded` row), never on fleet/system turns (P1 step 3, tested).
- Truncation hides the decisive last line → full text on disk with its path in the pointer; Read/Grep untouched; PM sessions only (P3).
- pm-act replies signed as a shell inbox → never used; P4 waits for a session-signed interface (P4 step 4).
- Switchboard swallows a question → deterministic escalation before and after the model (P6 steps 2 and 4); shadow only; the PM still receives everything.
- De-id misses an internal host name → the scan includes fleet courier names from `fleet directory` besides the regex rules; fail closed on scanner error (P2 step 1). Residual: a host named nowhere in fleet; consultants are non-CN families only.
- A mislabelled order blocks a lane → the PM corrects the order, the lane runs `set --fleet-task <id> --refresh` (P0 step 3, tested).
- Cache trap: fewer wakes spaced beyond the 5-minute cache TTL turn each wake into a full cache write (~12× read cost) with the same context length → the barrier (P2) and switchboard (P6) cut wake count but not context; the counterpart (daily new PM session, 60–150k target) is the PM's step in the synthesis and out of scope here; P6's compare report includes the PM's wake count per day so the trade-off is measured.

## 7. Out of scope

- Card-answer auto-forward (synthesis item 2): not among the work order's six (open question 1).
- `pm-act` card opening (cards stay with `open-decision.js`).
- Switchboard live mode, Haiku classification, Sonnet shadow PM, autocompact changes, daily new PM session.
- Any change to `~/.claude`; turning the opt-ins on at the PM host (the PM does it).
- SQLite.

## 8. Open questions (PM)

1. Card-answer auto-forward (synthesis item 2): a later phase, or out?
2. The ledger CLI names for `pm_output_cap.ledger_search_pattern`, `pm_act.ledger_lint_cmd`, `pm_act.ledger_write_cmd` (names only; this lane never reads the ledger). Until given, the 30-line rule is off and P4's ledger action is refused at preflight.
3. "Real run on the PM's machine" = the PM account on the PM host after a live pin: confirm.

## Review log

- R0: author depth-0 (autopilot lane), 2026-11-17. Manifest `docs/plans/2026-11-17-pm-token-split.manifest.json`, rubric `docs/plans/2026-11-17-pm-token-split.rubric.md`; seats astra (chair, openai) + grok (boundary red-team, xai).
- Generation 1 (logical id `pm-token-split-2026-11-17`, 2026-11-17): no semantic verdict. Required seat grok_redteam failed both attempts with HTTP 402 (Grok Build usage balance exhausted), so the round stopped with `required_seat_transport_exhausted`; no finding was produced or adjudicated. Re-opened as `pm-token-split-2026-11-17-b` with the red-team seat moved to agy gemini-4-carbon-high (google); budget restarts because no semantic generation was consumed; ticket `01M7KZZ1ZT3V1KTKNR3E4MFK4B-b` because the first ticket stays bound to the first logical id.
- Generation 1 (`-b`, astra + carbon, both STOP): 11 blocking, 7 non-blocking. Repaired in this revision: frozen plan receipt defined and required on both routes; node id `implement`; P0 refresh recovery and size floor ordering; P0/P1 opt-in separation (`pm-dispatch-plan-guard`, `askpm-remind`); reminder without breaking the reply row; legacy-row cutoff; `pm-ask overdue`; JSON/row/checklist/act schemas; P3 Bash probe with a PreToolUse fallback; real runs per phase incl. P0 and a transcript check for P3; negative-control baselines per new script; switchboard isolation flags, operator-row filter, deterministic escalation and post-validation; CJK-safe estimator and continuation packets; panel fail-closed snapshot, cn-barred seats never spawned, sanitized names, courier-name host list; dependencies by code edge with integration steps; deadline alignment (A pinned 15:00, P6 replay of an exported day). Partially accepted: §2.5 credential rule now names the repo-sanctioned throwaway seeding instead of forbidding it; pm-act signing is resolved by an interface from the fleet lane before P4 starts (no shell-identity fallback), not inside the plan. Out of scope stated: card opening in pm-act; missing-`Size:` dispatches are allowed.
