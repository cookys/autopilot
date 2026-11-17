# Plan — PM seat token split: scripted PM chores (fleet task 01M7KZZ1ZT3V1KTKNR3E4MFK4B)

Status: draft for plan review · logical_plan_id: `pm-token-split-2026-11-17` · Size: L (seven phases)

## 0. Context / thesis

The PM seat read ~5 billion cached tokens in two days (4,274 turns, 3.64 API calls per turn, ~320k tokens re-read per call). The PM's synthesis (fable / astra / carbon, PM final v1, 2026-11-17) found that 45–78 % of that volume carries no judgment: routine intake, one wake per consultant reply, many tool round-trips per turn, long tool output, and an over-long context. The synthesis's "scripting" section lists the chores that a lane implements and the PM only uses. The work order selects six of them, split into two deliveries:

- (A) by 2026-11-18 18:00 (UTC+8): (1) request register, (2) parallel consultant barrier with de-identification, (3) tool-output truncation.
- (B) by 2026-11-20 18:00 (UTC+8): (4) `pm-act` macro, (5) intake rule check, (6) switchboard runner in shadow mode.

The PM added one more item on 2026-11-17 (message 01M7M071), to ship with (1): a work order of Size M or larger must carry `Plan: <path>@<sha>` or `plan-first`, and a lane's dev-flow refuses to enter implementation on such an order without a frozen plan receipt. That is phase P0 here.

Prior art in this repo that the plan builds on rather than duplicates:

- `hooks/askpm-log.js` (opt-in, PM-gated by `.claude/console.json` schema `autopilot.console/1`) already appends every operator prompt as an `ask` row and the first two reply lines as a `reply` row to one jsonl under the account state dir. P1 extends it.
- `hooks/_shared/opt-in.js` is the default-off gate (`~/.autopilot/config.json {"hooks":{"<stem>":true}}` or `AUTOPILOT_HOOK_<STEM>=1`); `hooks/opt-in-multiplexer.js` spawns Stop halves of opt-in hooks.
- `scripts/wait-dispatch-results.js --ledger X --expect run.stage …` blocks until every `.exit` file lands.
- `scripts/ar-redact.js` (fail-closed, exit 4) and `scripts/lib/cn-model-dispatch-gate.js` already run before dispatch-author / dispatch-consult send.
- `scripts/stage-advance.js` + `references/stage-graph.json`: size M has a `plan` node; L/XL have `plan` and `plan-review`. `scripts/check-phase-review-receipt.js --plan-artifact` verifies `plan_sha256`. `session-mode.js set --fleet-task <id>` stores `fleet_task_id` on the marker.
- Claude Code hook facts (docs: https://code.claude.com/docs/en/hooks): PostToolUse `hookSpecificOutput.updatedToolOutput` replaces what the model sees for built-in and MCP tools; Stop accepts `decision: "block"` + `reason`; UserPromptSubmit input carries `prompt` and may return `additionalContext`.

## 1. Problem

The PM must spend its context on decisions, not on bookkeeping. Concretely: no operator request is lost (today they are tracked by memory and lost on compaction); a three-seat consultation wakes the PM once, not three times; a 400-line tool result never enters the PM's context; one PM turn's dispatch + reply + ledger entry is one tool call; intake is a script verdict, not a re-read of the evidence; routine fleet traffic is classified by a cheap, isolated runner before it reaches the PM. And the PM's own lapse (dispatching M-size work without a plan) is caught by code.

## 2. OKR / KRs

- KR1: every operator prompt in a PM session gets an `ask_id` (100 % in a one-day real PM run); `pm-ask overdue` lists every ask open > 24 h; a Stop with an undisposed ask of that turn produces exactly one reminder.
- KR2: a three-seat consultation produces exactly one wake (one background-task completion) and one combined result file; a prompt with a personal identifier or a host/LAN address is refused before any seat is called.
- KR3: in a PM session, a Bash/MCP tool result longer than 40 lines reaches the model as ≤ 41 lines plus one pointer line; a ledger-search result as ≤ 30 lines plus a pointer.
- KR4: one `pm-act` call performs dispatch + reply + ledger write; a lint failure in any part sends nothing.
- KR5: `pm-accept-check` returns ACCEPT only when all four conditions hold, and an executor's "done" text alone never yields ACCEPT.
- KR6: switchboard shadow runs over one day of real PM traffic, writes packets that meet the packet contract, and a comparison report against the PM's actual handling exists.
- KR7: a PM dispatch declaring Size M+ without a plan marker is refused at send; a lane marker on such an order cannot reach `impl` without a plan receipt.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Everything ships inside the autopilot plugin as opt-in, default-off hooks/scripts; PM-only behaviour is additionally gated by `.claude/console.json` schema `autopilot.console/1` (the askpm-log gate). Non-PM sessions see no behaviour change.
- No new hook registration where an existing hook entry can host the logic: UserPromptSubmit work goes into the `advisory-relay.js` host path (as askpm-log does); Stop halves go through `opt-in-multiplexer.js`; a new PostToolUse script is allowed only for P3 and must be listed in `hooks/opt-in-manifest.json`, `hooks/README.md`, `CLAUDE.md` counts and `profiles/hook-classes.json` (+ codex mirror) so `check-hook-inventory.js --check` and `sync-all.sh --check` stay green.
- Scripts that parse JSON are Node built-ins only (no npm dependency). Storage: jsonl via `scripts/lib/jsonl-store.js` (flock + atomic append). No SQLite in this plan.
- Never read, print or copy a credential, token, `.env`, key file or auth store; tests use fake values only. The switchboard runner gets a throwaway config dir seeded with only `.credentials.json`, never the real `~/.claude`.
- The switchboard runner's tool allowlist excludes: approve (`fleet approve` or any approval), opening cards (`open-decision.js open`), dispatching new work, replying to the operator, credentials, extending deadlines, editing the authority table. In shadow mode it has no write tools at all; it outputs JSON only.
- No Chinese-made model (GLM / Qwen / DeepSeek / MiniMax / Kimi) receives PM traffic, prompts or transcript content in any phase.
- Every new or changed check ships a negative control: the test is shown red before the change and green after.
- Times shown to people are UTC+8; machine fields keep RFC 3339 UTC.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible` — askpm-log rows gain fields (`ask_id`, `disposition`, `supersedes`); old rows without them are read as open asks with a derived id; no consumer outside this repo reads the file. All new behaviour is opt-in.
- **Dependency decision**: `existing` — Node built-ins, `jsonl-store.js`, `wait-dispatch-results.js`, `ar-redact.js`, `dispatch-author.sh`, `open-decision.js`, the fleet CLI; no new package.

## 3. File-structure map

| File | Phase | Responsibility |
|---|---|---|
| `hooks/fleet-dispatch-plan-guard` logic inside the existing PreToolUse fleet hook (`hooks/fleet-send-work-order-guard.js`) | P0 | PM session: refuse `mcp__fleet__dispatch` whose body declares `Size: M|L|XL` without `Plan: <path>@<sha>` or `plan-first`, and refuse a dispatch with no `Size:` line |
| `scripts/stage-advance.js`, `scripts/lib/work-order-plan.js` (new) | P0 | lane side: read the order's declared size/plan marker once at `set --fleet-task`, store on marker; refuse `--to impl` (and size below declared) without a plan receipt |
| `hooks/askpm-log.js`, `scripts/pm-ask.js` (new) | P1 | ask_id assignment, dispositions (close/progress/supersede), Stop reminder, daily overdue list |
| `scripts/dispatch-panel.js` (new) | P2 | N seats in parallel through `dispatch-author.sh`, de-id scan first, one wake, one combined file |
| `hooks/pm-output-cap.js` (new, PostToolUse, opt-in) | P3 | cap Bash/MCP output at 40 lines (30 for ledger search) via `updatedToolOutput`, full text to a tmpfs file |
| `scripts/pm-act.js` (new) | P4 | one JSON plan → lint all → dispatch + reply + ledger write |
| `scripts/pm-accept-check.js` (new) | P5 | four-condition intake verdict from re-derived evidence |
| `skills/switchboard/SKILL.md` (new), `scripts/switchboard-run.js` (new) | P6 | batch classifier runner (Sonnet, one isolated call per batch, ≤ 30k context), packet builder, shadow comparison |
| `docs/scripts-inventory.md`, `scripts/CLAUDE.md`, `CHANGELOG.md`, `docs/guide/installation.md`, `config-keys.json` | all | wiring for each new script/knob |
| tests: `hooks/tests/*.test.sh` / `scripts/*.test.js` per phase | all | red-then-green per item |

## 4. Phases

Dependency order: P0 ∥ P1 → P3 ∥ P2 (A delivery) → P5 → P4 → P6 (B delivery). P0 and P1 share no file. P4 uses P1's `pm-ask close` and P5's verdict.

### P0 — work-order plan-first gate (Size M)

Steps:
1. PM side, in the existing fleet PreToolUse guard: when the session passes the console gate and the tool is `mcp__fleet__dispatch`, parse the body. Deny with one line (`工單 Size M 以上要帶「Plan: 路徑@sha」或「plan-first」`) when a `Size:` line names M/L/XL and neither marker is present; deny `缺 Size: 行` when no `Size:` line exists. `[no-task: …]` chat sends are not dispatches and are untouched.
2. Lane side: `scripts/lib/work-order-plan.js parse(text)` → `{size, plan: {path, sha} | 'plan-first' | null}`. `session-mode.js set --fleet-task <id>` fetches the order text once (`fleet task show <id> --json`, field to be confirmed against the fleet CLI in step 0 of the hand brief) and stores `wo_size` and `wo_plan` on the marker.
3. `stage-advance.js --to impl` (and any `--to` that skips `plan`) refuses (exit code distinct from existing ones, message names the missing receipt) when `wo_size` ≥ M and none of: (a) `wo_plan` is `{path, sha}` and `git cat-file -e <sha>:<path>` succeeds and, for L/XL, `check-phase-review-receipt.js --plan-artifact <path>` passes for that blob; (b) this marker completed the `plan` node (and `plan-review` for L/XL) — `plan-first` orders take this route. `set --size` lower than `wo_size` is refused.
Acceptance (done when): tests show (i) PM dispatch `Size: M` without marker denied, with `Plan: docs/plans/x.md@<sha>` allowed, with `plan-first` allowed, without `Size:` denied, non-PM session untouched; (ii) a marker with `wo_size=M` and no receipt → `--to impl` refused, after plan node done → allowed, with valid `Plan:` blob → allowed, with a sha whose blob is absent → refused; (iii) `set --size S` on `wo_size=M` refused. Each red before, green after.

### P1 — request register (Size M)

Steps:
1. `askpm-log.js` UserPromptSubmit: each `ask` row gets `ask_id` = `a-` + first 8 hex of sha256(session_id + at + prompt). The id is returned to the model through the existing advisory-relay `additionalContext` as one line `ask_id a-xxxxxxxx`.
2. `scripts/pm-ask.js`:
   - `close <ask_id> --evidence <sha|msg-id|url|path>` (evidence required, non-empty; a bare "done" string is refused),
   - `progress <ask_id> --task <fleet-task-id>` (in-flight disposition, not a closure),
   - `supersede <old> <new>` (appends a supersedes row; the old ask counts as closed by the new one),
   - `list [--open] [--overdue-hours 24]` (≤ 30 lines, newest first, one line per ask: id, age, first 60 chars),
   - all writes via `jsonl-store.js`.
3. Stop half (through `opt-in-multiplexer.js`): when the ask opened by this turn has no `close`/`progress`/`supersede` row and `stop_hook_active` is false, return `decision: "block"` with reason `ask_id a-xxxxxxxx 尚未處置：pm-ask close/progress/supersede`. Once per ask; a second Stop for the same ask never blocks.
4. Daily list: the first UserPromptSubmit of each UTC+8 calendar day in a PM session appends `pm-ask list --overdue-hours 24` (≤ 30 lines) to `additionalContext`; a marker file in the state dir records the day.
Acceptance: tests show an ask gets an id; close without evidence refused; Stop blocks once on an undisposed ask and not again; an injected (fleet/system) prompt gets no id; supersede closes the old ask; overdue list shows an ask aged 25 h and not one aged 23 h; old rows without `ask_id` still list. Real run: one PM turn on the PM host with the opt-in on, `pm-ask list` output captured.

### P2 — parallel consultant barrier with de-identification (Size M)

Steps:
1. `scripts/dispatch-panel.js --prompt-file F --seat <runner:model> … --out-dir D [--timeout 15m]`:
   - before any seat: run `ar-redact.js` in check mode and a host/LAN/personal-identifier scan (`redact-personal.js` rules plus the leak-guard host pattern) on F; any hit → exit 4, print the matched rule ids (not the matched text), call no seat;
   - run the cn gate per seat (existing `cn-model-dispatch-gate.js check`); a barred seat is reported, not silently dropped;
   - start every seat's `dispatch-author.sh` concurrently, each writing `D/<seat>.out` and `D/<seat>.exit`;
   - wait with `wait-dispatch-results.js` until all `.exit` exist or timeout; write `D/panel.json` (`{seats:[{seat, rc, out_path, bytes}], complete: bool}`) and print one line.
2. The PM starts it with `run_in_background`, so its single completion is the single wake.
Acceptance: tests with stub runners show three seats → one `panel.json`, process exits once after the slowest seat; one seat timing out → `complete:false` and the others kept; a prompt containing a fake LAN address or a fake email → exit 4 and zero runner invocations (stub counter = 0); a cn-barred seat reported in `panel.json`. Real run: one three-seat panel (astra / carbon / grok on a short non-sensitive question) on the PM host.

### P3 — tool-output truncation (Size S)

Steps:
1. `hooks/pm-output-cap.js` (PostToolUse, opt-in stem `pm-output-cap`, console gate): for Bash and `mcp__*` tool results, count lines of the text the model would see; when > 40 (or > 30 when the command or tool matches the configured ledger-search pattern), write the full text to `$XDG_RUNTIME_DIR/autopilot/pm-output/<tool_use_id>.txt` (0600) and return `updatedToolOutput` with the first 40 (30) lines plus `… N 行已截斷，全文：<path>`.
2. Ledger-search pattern is a config key (`pm_output_cap.ledger_search_pattern`, default empty = no 30-line rule) documented in `config-keys.json`; the PM sets it to its ledger CLI.
3. Read/Grep/Glob are not capped (their own limits apply); a result that is not text is passed through unchanged.
Acceptance: tests show 41-line Bash output capped to 40 + pointer and the file holds all 41; 40 lines untouched; ledger-pattern command capped at 30; non-PM session untouched; opt-in off untouched; MCP result shape preserved. Real run: one long command in the PM session.

### P4 — `pm-act` macro (Size M)

Steps:
1. `scripts/pm-act.js --plan act.json`: `act.json` = `{dispatch:[{to, body, size, plan}], reply:[{message_id, body}], ledger:[{…}], ask_close:[{ask_id, evidence}], card:[{open-decision args}]}`.
2. Preflight, all before any side effect: P0's dispatch rule on each dispatch; `open-decision.js` validation (`--dry-run` or its lint) on each card; the PM's ledger lint command (config key `pm_act.ledger_lint_cmd`) on each ledger entry; `pm-ask close` evidence rule. Any failure → exit 2, list every failure, send nothing.
3. Execute in order ledger → card → dispatch → reply → ask_close, each through the existing CLI (`fleet`, `open-decision.js`, ledger CLI from config); stop at the first failure and print what was done and what was not.
4. Signing: replies and dispatches must be signed as the PM session. Step 0 of the hand brief confirms with the fleet lane which CLI form signs as the calling session (the shell `fleet send` lands replies in an unread inbox); if none exists, P4 delivers the preflight + ledger + card + ask_close half and the PM keeps sending through MCP, recorded as a scope cut in the Review log.
Acceptance: tests with stub `fleet` and stub ledger CLI: a valid plan → one call each, in order; one bad card → zero side effects; executor failure mid-way → report lists done/undone. Real run: one PM turn executed through `pm-act` on the PM host.

### P5 — intake rule check (Size S)

Steps:
1. `scripts/pm-accept-check.js --task <fleet-task-id> --checklist <file>`; the checklist (written by the PM at dispatch time) names: threshold files/keys, the expected version (sha or tag), the required checks (command + expected rc, or receipt path), and an exception policy.
2. Four conditions, each re-derived, never read from the executor's text:
   - thresholds unchanged: `git diff --quiet <base> <head> -- <threshold files>` (and key-level compare for JSON keys);
   - evidence matches the version: every evidence sha in the result equals or is an ancestor of the expected version and exists in the repo;
   - required checks passed: receipt files exist for that head with rc=0, or the command is re-run;
   - no exceptions: the result and the head's diff add no known-red entry, waiver, skip or bypass marker (patterns listed in the checklist, default set in the script).
3. Output: `ACCEPT` or `REJECT` with one line per failed condition; exit 0 / 1.
Acceptance: tests: all four hold → ACCEPT; each condition broken alone → REJECT naming it (four cases); an executor result saying "done, all green" with no receipt → REJECT. Real run: one real task of the PM's checked on the PM host.

### P6 — switchboard runner, shadow mode (Size L)

Steps:
1. `scripts/switchboard-run.js --batch <file|--from-fleet-recent>`: input = a batch of non-operator fleet messages addressed to the PM (operator messages never enter); size cap: the batch is split so each call's input is ≤ 30k tokens (estimate chars/3.5, conservative).
2. One `claude -p --model sonnet` call per batch with a throwaway `CLAUDE_CONFIG_DIR` seeded with only `.credentials.json`, `--tools` limited to none (shadow: JSON output only), system prompt = classification rules from the synthesis (escalate verbatim: questions, A/B trade-offs, exception requests, unhealthy or rc≠0, shared-pool impact, unreadable).
3. Packet builder (deterministic, in the script, not in the model): ≤ 1,500 tokens and ≤ 5 items per packet; each item has id, lane, task, type (提問 / 疑似該退件 / 越權 / 失敗 / 逾期 / 卡片就緒 / 看不懂), ask_id, ≤ 3 facts with evidence refs, options, recommendation marked 「建議，非決定」, deadline; plus "auto-handled count + 3 samples"; over the cap → split into more packets, never truncated (a single item over the cap → its own packet with facts reduced to 3, never cut mid-text).
4. Shadow mode: packets go to `$state/switchboard/shadow/<date>/`; the PM still receives everything; `switchboard-run.js compare --date D` lines up packet items with the PM's actual handling (from askpm/pm-ask rows and the PM's ledger via the configured CLI) and writes agreement counts and misses.
5. Kill switch: config `switchboard.enabled=false` or env `AUTOPILOT_SWITCHBOARD=off` makes the runner exit 0 without calling a model.
6. `skills/switchboard/SKILL.md` (contract-card shape): when to run, the allowlist, the packet contract, shadow vs live (live is out of scope for this plan).
Acceptance: tests with a stub `claude`: batch over 30k → split into ≥ 2 calls; packet with 7 items → 2 packets (5 + 2); an item over 1,500 tokens never truncated; the child command line has no write tool and the child env's config dir contains only `.credentials.json` (fake); a question-type message is always escalated; kill switch → zero model calls. Real run: one day of PM traffic in shadow, comparison report produced.

## 5. Test / validation

- Script-gated: each phase's tests (red before, green after, both tails captured in the phase commit message or merge note); `node scripts/affected-suites.js --base origin/develop --run`; `scripts/check-hook-inventory.js --check`; `bash scripts/sync-all.sh --check`; `bash scripts/validate.sh`; leak-guard.
- Code review: hetero code loop per delivery (A, B), non-Claude implementer reviewed by a different family.
- Human-gated: the real run on the PM host per item requires the plugin pin to be promoted there (live-pin precedent, PM go per rollout) and the PM to turn the opt-ins on in its own session; evidence = one captured output line per item.

## 6. Risks + inversion

- Guaranteed failure 1: the Stop reminder blocks every PM turn (the PM answers fleet traffic, not only asks). Mitigation: only the ask opened by this turn's operator prompt is checked; fleet/system turns have no ask; once per ask.
- Guaranteed failure 2: truncation hides the one line that matters (an error at the end). Mitigation: full text always on disk with the path in the cut line; Read/Grep untouched; the 40-line rule applies only in PM sessions.
- Guaranteed failure 3: `pm-act` sends replies signed as a shell inbox, so peers' answers vanish. Mitigation: P4 step 4 verifies signing with the fleet lane first; fallback scope cut stated.
- Guaranteed failure 4: switchboard swallows a question. Mitigation: shadow first, PM still receives everything; deterministic "always escalate" rules run in the script before and after the model; live mode is out of scope.
- Guaranteed failure 5: de-identification misses a host name in a prompt and a consultant receives it. Mitigation: refusal is fail-closed (scan error = refuse); negative controls with fake host/LAN/email.
- Guaranteed failure 6: the P0 lane gate blocks legitimate S work because a PM order is mislabelled. Mitigation: the gate keys only on the order's declared size; the PM fixes the order; the refusal message says which field to fix.
- Cache trap (synthesis): fewer wakes with the same context length raise cache-write cost. Not solved here; the PM's daily new session (synthesis day 6) is the counterpart and is out of scope.

## 7. Out of scope

- Card-answer auto-forward (synthesis scripting item 2): not in the work order's six; listed as an open question.
- Switchboard live mode, Haiku classification, Sonnet shadow PM, autocompact changes, the daily new PM session.
- Any change to `~/.claude` on any host; enabling the opt-ins on the PM host (the PM does that in its own session).
- SQLite storage.

## 8. Open questions (PM)

1. Card-answer auto-forward (synthesis item 2) — add as a later phase or leave out?
2. The ledger-search command the 30-line rule should match, and the ledger lint command `pm-act` should call (names only; this lane does not read the ledger).
3. Real runs "on the PM's machine" mean the PM account on the same host after a live pin; confirm that is the intended target.

## Review log

- R0: author depth-0 (autopilot lane), 2026-11-17. Manifest `docs/plans/2026-11-17-pm-token-split.manifest.json`, rubric `docs/plans/2026-11-17-pm-token-split.rubric.md`; seats astra (chair, openai) + grok (boundary red-team, xai).
