# Plan — ctx-reset W2: the sweep lane that actually resets idle large-context sessions

> Status: draft r0, awaiting one round of heterogeneous plan review · Owner: autopilot lane · Branch: `docs/ctxreset-w2` · Frame: PM order 2026-11-12, fleet 01M76Z4WVCFP5PT1BTV2QTJK8V · Implementer after review: grok or agy (never codex) · Rubric and plan-review manifest: written by the controller before review (see Review log)

## 0. Context / thesis

W1 shipped the measuring and deciding half: `scripts/session-ctx-report.js` (`list`, `candidates`, exported `decide()`, `:253-305`) and its contract `references/session-reset.md`. W1 never restarts anything (`session-ctx-report.js:6-7`, `session-reset.md:9`). The other half, a sweep that asks a session for a HANDOFF and restarts it fresh (`session-reset.md:3`, protocol `:85-94`), was never built, so no host resets anything and idle 150K–250K+ sessions keep re-reading their whole context on every wake.

Facts this plan builds on, read from the repo during authoring (file:line):

| Fact | Source |
|---|---|
| Context size comes only from `<liveBase>/context/<sid>.json`, schema 1, `written_at` = idle signal; no transcripts, nothing under `~/.claude` | `references/session-reset.md:13-25` |
| `<liveBase>` = `$XDG_RUNTIME_DIR/autopilot` → `/run/user/<uid>/autopilot` → `/dev/shm/autopilot-<uid>` → `/tmp/autopilot-<uid>`, accepted only on tmpfs/ramfs | `scripts/lib/live-state-dir.js:10-24,65` |
| Decision order, first match wins: excluded, claim, running_go, open_task, skip_until, cooldown, hard, soft; idle = `now - max(last_active, last_sent)` | `references/session-reset.md:57-71`; `scripts/session-ctx-report.js:266-305` |
| Defaults 150000/250000 tokens, idle 15/5 min, cooldown 120 min | `references/session-reset.md:73-81` |
| Subagent sidecar `<liveBase>/context/<sid>.tasks.json` exists and is skipped by `list`; it is written by the codeforge status line, not by the tee | `scripts/session-ctx-report.js:218-219`; `scripts/statusline-live-tee.js:21-22` |
| Per-session task list `<liveBase>/tasks/<sid>.json` with `cwd`, `counts.in_progress` | `hooks/session-tasks.js:4-11` |
| Lanes are opened by hand in tmux; seat `<project>--claude` stable per cwd; an unreleased old session gives the new one a `-2` seat; confirm with `fleet whoami`; fleet MCP needs `--mcp-config` in a non-home profile | `docs/guide/accounts.md:193,202-205` |
| Existing tmux glue: `tmux new-window -d -c <cwd> -n <window> <cmd>` | `scripts/lane-reopen.js:63` |
| Existing stop/start recipe: `tmux send-keys -t <pane> '/exit' Enter`, wait until `#{pane_current_command}` is the shell, start with `tmux send-keys ... 'cd <cwd> && <env> claude ... <flags>' Enter`, then the dev-channel acceptor | `scripts/lane-switch.js:66-74` (dry-run printer only, `:8-10`) |
| Dev-channel dialog: polls `tmux capture-pane -p`, sends one Enter only on the two exact strings, exit 0 accepted / 1 not seen or send failed / 2 usage | `scripts/accept-dev-channel-prompt.sh:2-25` |
| Read-only pane reading pattern (`capture-pane -p -J`, optional `-S <socket>`), never sends keys | `scripts/permission-prompt-watch.js:11,44` |
| Lane record `{lane, pane, cwd, seat, session_id, model, launch_flags, profile}`, prompt flags rejected, `~/.config/autopilot/lanes/<lane>.json` 0600 | `scripts/lib/lane-manifest.js:4-5,17`; `docs/guide/accounts.md:212` |
| Fleet verbs known from the repo: `fleet peers`, `fleet send <ns/courier/member> "…"`, `fleet reply <message_id> "…"`, `fleet whoami`; MCP tools `directory`, `send`, `reply`, `state`; `fleet approve` is a human tty gate | `skills/agent-call/SKILL.md:15-18,26`; `references/peer-addressing.md:33`; `docs/guide/accounts.md:204` |
| Receipts stop at `injected_unverified` for pane delivery | `references/peer-addressing.md:42-46` |
| `fleet --help` prints usage and exits 1; `AUTOPILOT_FLEET_BIN` stubs the binary in tests | `scripts/lib/fleet-decision.js:17,22,34` |
| Handoff skill headings `## 目標`, `## 現況`, `## 下一步`, … | `skills/handoff/SKILL.md:61-86` |

**Not verified in this authoring pass** (the authoring harness allowed file reads only, no shell; D0 runs each one and records output): `fleet --help` and every subcommand help; which fleet call returns a member's claims, running GO/tasks, `last_sent` and role (resident/lead/PM); how fleet exposes member ↔ pane ↔ session id; a repo-wide grep for `tmux new-session`, `send-keys` and `--dangerously-load-development-channels` launch lines (none of the files read contains a `new-session` line); hangar's rollout command and the host list. Each is marked **to verify with hangar** or **D0** below; nothing in the deliverables depends on a guessed flag.

## 1. Problem

Reset idle, oversized Claude lanes safely and unattended on every host with a Claude lane: never lose a draft, a running background job, a claimed task or a handoff; never touch the PM, hangar, leads or resident sessions; and prove each reset by reading the new session's screen and live file.

## 2. OKR / KRs

- KR1: on the dry-run host, 24 h of journal rows show a decision with a reason for every live session, zero sends and zero keys (`mode: dry-run`), and every excluded class (PM, hangar, lead, resident, claim, GO, draft, background) appears at least once as a `keep` reason or is shown by fixture.
- KR2: first live reset on a low-risk session: `[session-reset]` sent, `[reset-ready]` received, durable handoff copy sha256-equal to the source, old claude exited without the background dialog, new session id live within 5 min, screen shows the handoff being read, fleet address unchanged (no `-2`).
- KR3: every host with a Claude lane has a sha16 receipt equal to the develop tip before its sweep timer is enabled (c4140 currently at `c663a4ade`, 11-10).
- KR4: no reset in the first week was followed by an operator restore (`claude --resume <old sid>`) caused by lost work.

## 2.5 Global Constraints (copied verbatim into every implementer and reviewer brief)

1. Dry-run is the default. Sending any fleet message, any tmux key or copying any file requires `--live --order <fleet message id>`; the order id is written to every journal row.
2. Never reset: a session that holds a fleet claim, has a running GO, has open tasks, is the PM, hangar, any lead or any resident session. Unknown role = excluded. Every unknown or unreadable fact fails closed to `keep`.
3. Not idle (fail closed to `keep`): typed-but-unsent text in the input box, a running background subagent, any non-allowlisted descendant process of the claude PID, an unrecognised screen.
4. Never read another session's transcript (operator card d-522f32f4). Inputs are only `<liveBase>/` files of this uid, `tmux capture-pane`/`display` output, `/proc` of verified PIDs, and fleet hub facts.
5. Never use `pkill -f`/`pgrep -f`; signal no process at all. The only stop is `/exit` typed into the verified pane.
6. Key budget per pane per run: at most one `Escape`, never two; `Enter` only after `/exit`, after the launch line, after the first prompt, and the one Enter sent by `accept-dev-channel-prompt.sh`. Never press Enter while a Rewind menu or the "Background work is running" dialog is on screen; never choose "Exit and stop tasks".
7. Restart only after the handoff's durable copy is written, fsynced, re-read and sha256-equal, on a filesystem that is not tmpfs/ramfs.
8. One reset in flight per (host, OS account); at most `--max-resets` (default 1) per run; a kill-switch file `~/.config/autopilot/ctx-reset.off` stops the run before any action.
9. W1 `decide()` and its thresholds are reused unchanged; the sweep only builds its input.
10. Node >= 20.10, built-ins only; bash only for tmux glue; tmux and fleet are spawned through injectable `spawnSync` (test stubs, `AUTOPILOT_FLEET_BIN`). Every new check ships a negative control shown red before green (`scripts/CLAUDE.md:13`). New scripts are wired per `scripts/CLAUDE.md:61-69`.
11. Operator-facing text is Traditional Chinese, times Taipei; journal timestamps ISO UTC.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`. New scripts and one additive protocol field (`pane=` on `[reset-ready]`, optional; old replies stay valid). `session-ctx-report.js` is untouched.
- **Dependency decision**: `platform/stdlib` plus `existing`: Node built-ins, `scripts/lib/jsonl-store.js` (`withWriteLock`/`appendRow`, as used by `project/plans/2026-11-10-profile-switch.md:57`), `scripts/lib/live-state-dir.js`, `scripts/lib/lane-manifest.js`, `scripts/accept-dev-channel-prompt.sh`.

## 3. File-structure map

- `scripts/lib/ctx-reset-facts.js` (new, D1): builds the W1 `candidates` input per (host, uid): `list` rows + fleet facts + `<liveBase>/tasks/<sid>.json` + sid↔pane↔member mapping.
- `scripts/lib/ctx-reset-pane.js` (new, D2): pure classifiers over captured text (`draft`, `placeholder`, `prompt_ready`, `bg_dialog`, `rewind_menu`, `dev_channel`, `unknown`) and a process-tree probe from `#{pane_pid}`.
- `scripts/lib/ctx-reset-handoff.js` (new, D3): validates a `[reset-ready]` path and writes the durable copy.
- `scripts/ctx-reset-sweep.js` (new, D4): per-session state machine and CLI (`--dry-run` default, `--live --order`, `--stop-after-ready`, `--max-resets`, `--json`).
- `scripts/*.test.js` beside each; fixtures under `scripts/fixtures/ctx-reset/` (captured pane text with SGR codes, fake fleet stub, fake tmux stub).
- `references/session-reset.md` (edit, D4): sweep section, durable handoff path, optional `pane=` field, skip/timeout semantics.
- `scripts/CLAUDE.md` (name list), `docs/scripts-inventory.md` (rows), `docs/guide/examples/ctx-reset-sweep.{service,timer}` (D5).
- Evidence: `project/plans/evidence/2026-11-12-ctx-reset-sweep/` (D0 facts, D5 receipts).

## 4. Deliverables (bounded DAG, 6 units; tests, review and doc sync are gates inside each)

### D0 — fact sheet (S, no code shipped; blocks D1, D2, D4)

Run on one Claude host as the lane's OS account and paste raw output into `evidence/.../D0-facts.md`:
1. `fleet --help; fleet peers --help; fleet send --help; fleet whoami --help` and help of every subcommand the usage lists that mentions claim, task, go, state, last, role or directory. Record for each needed fact (claims, running GO, open tasks, `last_sent`, role resident/lead/PM, pane or session id of a member, a way for a script to receive a reply) the exact command and a sample of its output, or "absent". Absent facts go to hangar as a question; until answered the sweep treats the fact as unknown (constraint 2).
2. `git grep -n -e 'tmux new-session' -e 'send-keys' -e 'dangerously-load-development-channels' -e 'new-window'` in autopilot, and the same question to hangar for its launch units (to verify with hangar). Record the launch line of each lane class and whether it runs through `claude-account.js exec` (`lane-reopen.js:9-12`).
3. On a throwaway session in a throwaway pane (never a production lane): capture `tmux capture-pane -p -e` of (a) empty input with placeholder, (b) typed text, (c) "Background work is running" after `/exit` with a `sleep 600` background job, (d) the Rewind menu, (e) the dev-channel prompt, (f) a Read tool line on a file; record which single key closes (c) and (d) without side effects. These become D2 fixtures.
4. Whether `<liveBase>/context/<sid>.json` or `.tasks.json` carries cwd or pane, and the `.tasks.json` running-state field name.
Acceptance: every row of the "not verified" list in §0 has a command with output, or "to verify with hangar" with the fleet message id of the question.

### D1 — facts collector (M; after D0)

`ctx-reset-facts.js collect [--json]` emits exactly the W1 input (`session-reset.md:39-55`) plus `mapping` and `facts_source` per session:
- `ctx_tokens`, `last_active`: from `listSessions()` (`session-ctx-report.js:204-233`).
- `holds_claim`, `running_go`, `last_sent`, role: from the D0 fleet commands; `excluded = role in {pm, hangar, lead, resident} || role unknown || member in the static core list` (`session-reset.md:83`).
- `open_tasks`: `counts.in_progress` of `<liveBase>/tasks/<sid>.json` plus fleet open tasks if D0 finds them.
- `last_reset`, `skip_until`: from the sweep state file `$XDG_STATE_HOME/autopilot/ctx-reset/state.json` (0600; same state-dir convention as `docs/guide/accounts.md:175`).
- Mapping sid → pane → member, in order: lane manifest (`lane-manifest.js:5`); fleet directory fields if D0 finds them; cwd join (`tasks/<sid>.json.cwd` ↔ `tmux display -p -t <pane> '#{pane_current_path}'` ↔ seat `<project>--claude`). No mapping or two candidates = `excluded: true`, reason `unmapped`.
Dry-run: it is read-only by construction. Acceptance: fixture run with stub fleet and stub tmux; then `candidates --input` on its output reproduces the expected decisions. Negative controls: fleet stub exits non-zero → every session `excluded` (not "no claim"); role field missing → excluded; two panes on one cwd → `unmapped`; a stub that reports a claim on the fixture session flips it from `reset` to `keep claim`.

### D2 — pane and process probes (M; after D0, parallel with D1, D3)

`ctx-reset-pane.js` (library + `probe --pane <id> [--socket <path>] [--json]` CLI):
- Input box: from `capture-pane -p -e`, locate the prompt line by the D0 glyph; text after it that lies inside an SGR dim span (`\e[2m` … `\e[22m`/`\e[0m`) is placeholder; any printable non-space character outside a dim span is `draft`. No prompt line found = `unknown`.
- Background: (a) `.tasks.json` sidecar has a running entry → `bg_subagent`; (b) descendants of `#{pane_pid}` read from `/proc/<pid>/task/*/children` (no `pgrep -f`), each with `/proc/<pid>/cmdline`; any process not on the D0 allowlist (fleet MCP server and other resident children) → `bg_process`, e.g. `bash -c 'until grep …; sleep …'`; (c) screen classes `bg_dialog`, `rewind_menu`, `dev_channel`, `prompt_ready` from D0 strings.
- Output `{idle_ok: bool, reasons: [...], claude_pid, claude_argv}`; `claude_pid` is the single verified `claude` child of `pane_pid`, else `unknown`.
Dry-run: read-only by construction (capture and `/proc` only). Acceptance: all D0 fixtures classified as recorded. Negative controls: dim placeholder alone → idle; same line with one non-dim char → `draft`; fixture with no prompt glyph → `unknown`/not idle; a `sleep 600` grandchild → `bg_process`; an allowlisted MCP child alone → idle; a probe given a PID whose parent is not `pane_pid` → refused.

### D3 — handoff durability (S; parallel with D1, D2)

Durable home (decision): `$XDG_STATE_HOME/autopilot/ctx-reset/handoff/<sid>-<UTC yyyymmddThhmmssZ>.md` (default `~/.local/state/...`), dir 0700, file 0600, kept 14 days. Not a git commit: a handoff is in-flight state of one session and belongs to no branch; committing it into the lane's checkout would add a commit to whatever branch that lane has checked out. Not `~/.autopilot/handoff/` either: that key is consumed by the next session in the same worktree (`scripts/resolve-repo-placement.js:20-23`), a different contract.
`ctx-reset-handoff.js accept --sid <sid> --path <p> --since <iso> [--dry-run]`: realpath under `<liveBase>/handoff/`, regular file owned by this uid, no symlink, mtime >= request time, size >= 200 bytes, contains `## 目標` and `## 下一步` (`skills/handoff/SKILL.md:61-86`); copy via same-dir temp, fsync, rename, fsync dir; re-read and compare sha256; `findmnt -T` of the destination must not be tmpfs/ramfs (`live-state-dir.js:65`). Prints `{durable_path, sha256}`. `--dry-run` validates and prints the destination without writing.
Negative controls: path outside `handoff/` or symlink → refused; file older than the request → refused; missing headings → refused; destination on `/dev/shm` → refused; a byte flipped between copy and re-read (injected fs) → refused, nothing reported as durable.

### D4 — sweep driver (L; after D1, D2, D3)

`ctx-reset-sweep.js [--dry-run] | --live --order <id> [--stop-after-ready] [--max-resets 1] [--json]`. Kill switch and per-uid lock (`jsonl-store.js withWriteLock`) first. Per candidate with decision `reset`, steps journaled to `$XDG_STATE_HOME/autopilot/ctx-reset/journal.jsonl` (sid, pane, member, step, outcome, order, own checkout sha16):
1. **Probe**: D2 `idle_ok`, else `keep` with the D2 reason.
2. **Ask**: `fleet send <member> "[session-reset] <sid>"`; body asks for the handoff skill to `<liveBase>/handoff/<sid>.md` and a reply `[reset-ready] <path> pane=$TMUX_PANE` or `[reset-skip] <reason>`. Reply channel = the D0-verified way for a script to receive it; if fleet offers none, the hangar-agreed fallback recorded in D0 (to verify with hangar). No reply in 10 min = `no_reply`, `skip_until = now + 2h`, nothing else.
3. **Skip**: `[reset-skip]` → `skip_until = now + 2h` (`session-reset.md:91`).
4. **Ready**: `pane=` must equal the mapped pane (mismatch = abort); D3 accept. `--stop-after-ready` ends here.
5. **Re-check** (TOCTOU): D2 again; no fleet `last_sent` newer than the reply; else abort, no keys.
6. **Exit**: record `claude_argv` and old sid; `tmux send-keys -t <pane> -l '/exit'` then `Enter`; poll `capture-pane` and `#{pane_current_command}` for 30 s. Shell reached = exited. `bg_dialog` → send one `Escape`, confirm `prompt_ready`, journal `abort:bg_work_dialog`, `skip_until = now + 2h`, notify the session. `rewind_menu` or `unknown` → no further key, alert the operator (Traditional Chinese, pane and screen class, no screen text).
7. **Start**: in the same pane `tmux send-keys -t <pane> -l "cd <cwd> && <launch line>"` + `Enter`. Launch line = lane manifest `launch_flags`, else recorded `claude_argv` minus `--resume/-r/--continue/-c <id>` and prompt flags (`lane-manifest.js:17`); wrappers seen in D0 (for example `claude-account.js exec`) are kept whole. Fresh session, never `--resume`.
8. **Dev channel**: if the line contains `--dangerously-load-development-channels`, run `accept-dev-channel-prompt.sh --pane <pane> --timeout 90`; exit 1 → alert, stop.
9. **First prompt**: wait for `prompt_ready` (120 s), send `read HANDOFF <durable path> first` literally + `Enter`.
10. **Confirm**: new `<liveBase>/context/<newsid>.json` with `newsid != sid` and `written_at` after step 7 within 5 min; a capture shows a Read line naming the durable path; `fleet peers` shows the same member address, no `-2`. Write `last_reset` for both sids. Any failure → alert with the restore command `cd <cwd> && claude --resume <old sid> <flags>`; never an automatic retry.
`--dry-run` (default) runs steps 1 and the D1/D2/D3 dry paths and prints, per candidate, the exact fleet message, every key sequence and the launch line it would send; it sends and writes nothing except a `mode: dry-run` journal row.
Doc gate: update `references/session-reset.md` (sweep section, durable path, `pane=`, timeouts), `scripts/CLAUDE.md`, `docs/scripts-inventory.md`.
Acceptance: fake tmux + fake fleet scenario suite. Negative controls: dry-run with every stub recording calls → zero send-keys and zero `fleet send`; `--live` without `--order` → exit 2, nothing spawned; kill-switch present → exit before any probe; `bg_dialog` scenario → exactly one Escape, no Enter, no restart; `rewind_menu` → zero further keys; `pane=` mismatch → no keys; durable copy failure → no `/exit`; a second candidate while one is in flight → `keep in_flight`; a stub showing a claim appearing between ask and re-check → abort.

### D5 — rollout with hangar (M; human-gated; after D4 merged to develop)

1. **Host list**: every (host, OS account) with a Claude lane, from hangar (to verify with hangar); stored in the evidence dir.
2. **Checkout sync** through hangar's existing rollout path (command to verify with hangar), ff-only to the develop tip; a dirty or diverged checkout is reported to hangar, not forced. Receipt row per host: `host, os_account, checkout path, before sha16, after sha16, develop sha16, UTC time` where sha16 = first 16 hex of `git -C <checkout> rev-parse HEAD`. c4140 (`c663a4ade`) is a known stale case.
3. **Install**: `docs/guide/examples/ctx-reset-sweep.{service,timer}` (every 5 min, `--dry-run`), installed by hangar's rollout; the live flag is added per stage below.
Acceptance: every host receipt `after == develop`; the sweep journal's own sha16 equals the receipt.

### Dependency map and schedule (Taipei)

D0 → {D1, D2} ; D3 independent ; {D1, D2, D3} → D4 → D5. Plan review 11-12/13; D0 11-13; D1–D3 11-13/14; D4 11-14/15; D5 stage A from 11-15.

## 5. Rollout order (inside D5)

- **A. Dry-run, one host, 24 h**: one host, timer in `--dry-run`. Gate: KR1, and a human reads the journal for false `reset` decisions.
- **B. Ask-only**: `--live --order <id> --stop-after-ready` on one or two idle, low-risk sessions (no claim, no GO, not a lead, small task list, idle > 1 h). Gate: replies parsed, durable copies sha-equal, no keys sent.
- **C. First restarts**: `--live --max-resets 1` on the same low-risk sessions, operator watching the pane. Gate: KR2 on three resets.
- **D. Widen**: remaining hosts one at a time, each repeating A for 24 h after its sync receipt.

## 6. Test / validation

Script-gated: each deliverable's suite with its negative controls, run as `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node --test scripts/<name>.test.js < /dev/null` (pattern of `session-reset.md:104-106`), all tests with `AUTOPILOT_LIVE_DIR` pointed at a temp dir and stub tmux/fleet. Human-gated: D0 throwaway-session captures, rollout gates A–D, the first live restart watched in the pane.

## 7. Rollback

- Whole lane: create `~/.config/autopilot/ctx-reset.off` (next run exits before any action), then `systemctl --user disable --now ctx-reset-sweep.timer` through hangar's rollout path.
- Back to observe-only: drop `--live` from the unit; dry-run keeps journaling.
- One bad reset: the journal row has pane, cwd, old sid and launch line; the operator types `/exit` in the new session and runs `cd <cwd> && claude --resume <old sid> <flags>`; the durable handoff remains for 14 days.
- Checkout sync: hangar reverts to the receipt's `before sha16` through the same rollout path.

## 8. Risks + inversion (what would guarantee failure)

- Restarting a working session (draft, background job): three independent probes, re-check after the reply, fail closed on unknown screens.
- Pressing Enter in the Rewind menu: constraint 6 key budget, class detector, no key on `unknown`.
- Losing the handoff on tmpfs: D3 durable copy before `/exit`, non-tmpfs check.
- Wrong pane: mapping must agree with the session's own `pane=`.
- `-2` seat after restart: wait for the shell before starting, check `fleet peers` after.
- No way for a script to read a fleet reply: D0 surfaces it before code; D4 blocks until hangar answers.
- Stale checkouts running old code: D5 receipts plus sha16 in every journal row.
- Self-matching kills: no process signals at all.
- Known W1 gap (`session-reset.md:96-98`): text-only turns do not refresh `written_at`; mitigated by `last_sent`, the screen probe and the session's own reply.

## 9. Out of scope

- Changing W1 thresholds, `decide()` or `session-ctx-report.js`.
- Reading transcripts or anything under `~/.claude`.
- Non-Claude harness panes (codex, grok, agy lanes).
- Automatic retry or automatic restore after a failed restart.
- Resetting the PM, hangar, leads or resident sessions under any flag.
- Login-profile switching (`project/plans/2026-11-10-profile-switch.md`) and account selection.
- Changes to codeforge or the fleet hub (requests go to their owners).
- Installing timers outside hangar's rollout path; pushing to any remote.

## 10. Open questions (Board / hangar)

1. Which fleet calls give claims, running GO, `last_sent`, role and member↔pane (D0; to verify with hangar)?
2. How does a non-interactive sweep receive `[reset-ready]` (fleet inbox, or a hangar-agreed file signal)?
3. Hangar's rollout command and the authoritative host list.
4. Definition of "resident session" (a fleet role, or a hangar list?).

## Review log

- R0 (2026-11-12): author draft from PM order 01M76Z4WVCFP5PT1BTV2QTJK8V. `logical_plan_id`: `ctx-reset-w2-sweep`. Plan-review manifest and frozen rubric: to be written beside this plan by the controller before generation 1 (one round, heterogeneous seats; implementer afterwards grok or agy, not codex).
