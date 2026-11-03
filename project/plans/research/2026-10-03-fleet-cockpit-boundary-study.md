> Status: research, not a plan; nothing built. Date: 2026-10-03.
> Source: autopilot maintenance session (fable depth-0), run3 closeout; original at session scratchpad research/fleet-cockpit-study.md.

# Fleet "user cockpit" study (read-only)

摘要（繁體中文）
1. fleet 裡沒有「使用者 cockpit／儀表板」：現有的 "cockpit" 是舊的本機 courier（fleet-cockpit，v1），已被 fleet v2 取代並退場。
2. 現行 fleet（cookys/fleet @2046dd1，與已安裝 release 相同）只有訊息脊柱：hub、courier、plugin，以及 member 狀態（idle/busy/needs_human + 200 字 summary）。沒有 project、work item、進度、排程、配額、甘特等概念。
3. 與 autopilot 唯一的接點是一個叫 `autopilot` 的 channel（access yml）。沒有任何文件化的「消費者契約」。fuchikoma（"第二個 cookys"、預算有界的排程層）才是意圖上的 meta／排程歸屬。
4. 擴充點已存在：plugin（manifest + courier socket）、message kind、`state` summary、`fleet events --exec`、state 目錄 JSON 快照；但「進度」這類結構化 payload 在 fleet 是全新的。
5. 建議：autopilot 擁有並發佈「單一專案進度快照」(schema 版本化、冪等、只含摘要與指標)；cockpit 擁有跨專案／跨主機彙整、排程、配額。fleet 只負責運送與授權，不解讀內容。

---------------------------------------------------------------------

## 0. Sources used (read this first)

- `~/projects/fleet-comms` (GitHub last push 2026-09-19; not a git checkout locally) is the **v1** repo. It is STALE vs the
  installed release: `fleet-comms` README says `fleet-cockpit` / `fleet-ground`; the installed `fleet` binary
  (release `2046dd1`, built 2026-09-30) is the v2 stack.
- Per depth-0 addendum I shallow-cloned the v2 repo `cookys/fleet` ("Fleet messaging v2: contracts, hub, couriers, plugins")
  to `<scratchpad>/research/fleet-src`. **HEAD = 2046dd1cee140455dd87b0f405190fb8f62c0116** ("Merge feat/fleet-receipt ..."),
  exactly the installed release SHA (`VERSION: sha=2046dd1`). 497 files, 186 commits, last commit 2026-09-30.
- Also cloned `cookys/fuchikoma` (SHA b893b66) to `<scratchpad>/research/fuchikoma-src` because it is the repo that
  describes a program/meta layer. Other read-only reads: `~/projects/hangar/bin/fleet-pulse.sh`, autopilot scripts inventory.
- Live read-only commands: `fleet --help`, `fleet status`. Nothing was sent or changed.
- The fleet v2 repo has NO README/AGENTS.md/CLAUDE.md; docs = `CHANGELOG.md`, `docs/operations.md`, per-component
  `CHANGES.md`, `plugins/*/README.md`, `contracts/fleet/v1/*.proto` (the IDL), `docs/evidence/`.

## 1. Does a user cockpit exist?

**No. Not as a dashboard/console/board/TUI/web view, shipped, in progress, or planned.** Evidence:
- `grep -ri "dashboard|operator view|overview|gantt|quota"` in both fleet repos: no product hits.
- The word "cockpit" in v2 appears only for the OLD service: `deploy/rollout.sh` (`OLD_UNIT_NAME="fleet-cockpit.service"`,
  retire-old/restore-old), `deploy/matrix-cutover.sh`, `docs/evidence/p7/cutover.txt` ("old fleet-cockpit.service stopped"
  on 8 couriers). It is a retired local courier, not a user view.
- In fleet-comms (v1), "cockpit" = `fleet-cockpit`: "one login account ... every harness that account is running" (README table).
  Commands: `list|send|serve|inbox|status [--json]`. `status` is the closest v1 thing to an overview: per-local-session
  busy/idle, time in state, deduped transcript tokens, peer weak signals. Plans: `docs/plans/2026-09-{08,11,16,17,19}-*cockpit*.md`
  (all pane/delivery plumbing; project docs `docs/projects/2026-09-19-cockpit-pane-final-mile/`). Superseded by v2.
- Closest existing operator-facing surfaces today (all CLI, text, per host, no aggregation across hosts):
  - `fleet status [--sessions]` (courier/crates/cli/src/status.rs, observe.rs): `hub:` link line, plugin table
    (pid, restarts, CRASH-LOOP), `needs_human:` marker, per-session delivery_state + busy/idle + context tokens.
  - `fleet peers` (fleet-wide, consent-filtered directory) / `fleet peers --local`.
  - `fleet events --follow [--to s] [--from s] [--exec argv...]` tails `<state>/events/state.jsonl`.
  - hub `GET /v1/admin/links` (loopback-only): per courier stream_open, last_activity_at, held_count, oldest_held_age_s.
  - hangar `bin/fleet-pulse.sh`: weekly Telegram digest of reachability/config drift/staleness/BACKLOG due triggers
    (host-level, not project progress; "NOT wired to cron yet" per its header).
- fuchikoma (README, docs/ROADMAP.md, PORTFOLIO.md) is the **intended** program/meta layer ("budget-bounded", nightly
  `bin/night-proposer.sh` morning brief reading `git` state of `~/projects/*`, `bin/schedule...` rules-only scheduler
  proposal, ROADMAP P3.1 "audit-log instrumentation = daily dashboard"). It is the nearest existing home of the owner's
  "tracks all project-management systems" idea, but today it reads raw git, not a published contract. (Observation from
  README/ROADMAP; I did not read all of ROADMAP.)

Conclusion: the owner's "user cockpit" is a NEW component. Name collision warning: "cockpit" already means the v1
courier; reuse of the word in docs will confuse. INFERRED: pick a distinct name (or say "cockpit v2").

## 2. Data model fleet knows today

Source of truth: `contracts/fleet/v1/{common,hub,plugin}.proto` (JSON wire; protobuf only as IDL; additive-only changes
enforced by `make contracts-check`, fixtures with `.unknown-field.json` variants).

Entities:
- **Address** `namespace/courier/member[@generation]` (namespace = owner/tenant, e.g. `cookys`; courier = per login/host;
  member = one session/pane, e.g. `<project>--claude`, `<project>--codex`).
- **Member**: registered via plugin `Register` with capabilities (chat, broadcast, dispatch, lock, answer_permission,
  visible) and `message_kinds`.
- **State**: `idle | busy | needs_human`, `source`, optional `confidence`, optional `summary` (<=200 chars, plugin/claude tool
  `state`). Published into hub `directory_entries(namespace,courier,member,channels_json,message_kinds_json,state,last_seen)`.
  The hub keeps NO member data except this directory. `summary` is carried courier-side on the `State` frame; I found no
  Rust/TS code storing it in the directory or hub (INFERRED: not visible fleet-wide today; verify before depending on it).
- **Message** kinds: `chat`, `ping`, `dispatch` (others declared per member). Priority `normal|needs_human|urgent`.
  Delivery modes `immediate|batch|silent`. Receipts `accepted<delivered<injected_unverified<read` with Evidence.
- **Dispatch / task_result**: no new wire type. dispatch = submit kind `dispatch` to ONE member; answer = submit with
  `reply_to_message_id` + `disposition` (`accepted|declined|in_progress|completed`); failed = `completed` with `[failed]`
  text prefix. CLI keeps a local task ledger (`courier/crates/cli/src/tasks.rs`, `fleet task list --json`).
- **Claims/locks**: `fleet lock acquire|release|list`, hub table `locks(lock_name, holder_courier, expires_at)`, TTL default 24h, cap 7d.
- **Channels** (`ChannelAccess`: posters, auto-join all|opt-in, cross_namespace_dispatch, consents), **namespaces**
  (approvers, request expiry, consents), **approvals** (`approvals` table; verdict by human tty only).
- **Sessions snapshot** (`<state>/sessions-<plugin>.json`): member, pid, session_id, cwd, claude_version, delivery_state
  (verified|deaf|unverified), status, time_in_state_s, context tokens (n/a when unknown, never 0).
- NO entity for: project, repo, plan, backlog item, release, work item, queue, schedule, account/quota, progress, timeline.
  (`cwd` and the `<project>--<harness>` member-name convention are the only project hints; `project` = git toplevel basename.)

Where state lives (all per host unless noted): hub SQLite `hub.sqlite3` (messages, holds, receipts, approvals, locks,
directory_entries) + `credentials`; courier `~/.local/state/fleet/` (`registry.json`, `inbox/`, `queues/`, `receipts/`,
`cursors/`, `access.json`, `hub-link.json`, `status.json`, `sessions-*.json`, `events/state.jsonl`, `logs/plugins/`);
plugin state under `plugins/<name>/`.

Ingestion from member sessions:
- Claude sessions: `plugins/claude` (MCP channel) + `plugins/claude-lane` (local UDS lane). Member state is derived from
  Claude's own `~/.claude/sessions/<pid>.json` (`status`, `statusUpdatedAt`) rather than model self-report; transcript tail
  gives context tokens; each transition appended once to `events/state.jsonl`.
- Other harnesses: `plugins/tmux` scans `tmux list-panes`, registers `<project>--codex|kimi|grok|...`, pastes inbound
  (`injected_unverified`), outbound via control socket / `fleet-pane-send`. No state ingestion beyond liveness.
- `plugins/mcp` (poll-only HTTP MCP), `plugins/webhook` (wake POST + local `/send`), script plugin.
- Everything is **push messages + local polling of files**; the hub does not poll members. No file-watching of project docs.

## 3. Progress / work items / schedules / autopilot integration

- Project progress, work items, queues, schedules, quotas/accounts, gantt/timeline, completion tracking: **none in fleet v2**
  (grep clean). In fleet-comms v1: only token counts per session (`status`), not quota.
- Quota/budget thinking lives elsewhere: hangar `bin/unattended-budget-guard.sh` + `etc/schedules/fuchikoma-budget-guard.*`
  (runbook `runbooks/unattended-budget-guard.md`); fuchikoma ROADMAP P1.3 "billing-layer hard cap + kill-switch".
- Autopilot already has producer-side machine-readable state (candidates to publish from): `scripts/tree.js board-status`
  and `report` (task-tree JSONL), `scripts/run-ledger.sh` (stage state machine), `scripts/dispatch-status.js` (mid-run
  phase/liveness/usage/stall JSON), `scripts/next-pick.js parse` (BACKLOG row machine fields), `docs/projects/INDEX.md`
  (In Progress / archived tables), `scripts/check-plan-graduation.js`, `build-rehydration-bundle.js`, `~/.autopilot/*` stores.
  Nothing today emits one per-project, versioned, cross-consumer "progress snapshot". (INFERRED from the inventory.)
- Integration points between fleet and autopilot (grep "autopilot" in fleet v2): only
  1. channel `autopilot` (`deploy/rehearsal/access/channels/autopilot.yml`: owner-namespace cookys, kind project,
     posters all, auto-join opt-in, cross-namespace-dispatch false) and its use in access tests (`courier/crates/core/src/access.rs`);
  2. hub/CHANGES.md mention. No consumer contract, no schema, no doc. In fleet-comms: plan review runs used autopilot
     plan-review; autopilot `docs/plans/2026-09-19-roundtable.md` consumes fleet send/receipts (v1 wording `fleet-cockpit status`).
- Documented consumer-facing contracts that DO exist: the `.proto` IDL + `contracts/fixtures`, `fleet status --json`/
  `fleet task list --json`/`fleet inbox --json`/`fleet whoami --json`, `sessions-*.json` snapshots and `state.jsonl`
  (described in `plugins/lib/session-observe.ts` header; used by hangar fleet-pulse). Stability promise = additive-only (contracts).

## 4. Extension points for a producer (exists vs new)

Exists:
- **Plugin** (courier-supervised process; manifest keys strict: name, command, args, [env]) speaking PluginFrame over a unix
  socket via `plugins/lib/courier-client.ts`; template: `plugins/webhook` (built with zero hub/courier change, KR8 proof).
  A `project-progress` plugin could register one member per project (`<project>--autopilot`).
- **Message kind** string per member (declared in `Register.message_kinds`; hub checks kind capabilities). A new kind
  e.g. `progress` is data-only if receivers declare it; hub enforces only dispatch/broadcast/visible rules (checks.ts).
- **`state` tool + `summary`**: 200 chars, free text; fine for a one-line badge, not a schema.
- **Channel** (`autopilot` exists; owner-namespace, posters, delivery mode silent/batch for low-noise telemetry
  (`deploy/rehearsal/access/delivery.yml` shows `batch`/`silent` per member x channel)).
- **Consumers**: `fleet events --follow --exec` (explicit argv), tail `events/state.jsonl`, read `sessions-*.json`,
  `fleet peers --json`-style CLI, hub `/v1/admin/links` (same-host only).
- **Locks** for single-writer claims (e.g. "who owns project X's roll-out").
New (nothing exists):
- A progress payload schema + a place to store the latest snapshot per project (hub has no such table; directory carries
  only state). Options: (a) message kind with JSON body, latest-wins cache in the aggregator; (b) file drop under a
  well-known state dir read by a per-host collector; (c) a proto message in `contracts/` (additive) + hub route. Any hub
  change is a frozen-core change (webhook README shows the project treats that as costly).
- Aggregator/cross-host view, scheduling, quota, history/timeline.
- Message size: hub uses `hono/body-limit` (`hub/src/server.ts:859`); I did not read the limit. Keep snapshots small (<~32 KB, INFERRED safe).

## 5. Fleet rules that bind this design

- **A message grants nothing**: a message is peer input, never authorization (global CLAUDE.md; dispatch usage text:
  "A dispatch accepted is an acknowledgement, not an execution right: the receiver still needs its own operator's
  permission"). Therefore the cockpit may DISPLAY and PROPOSE; it must not drive autopilot actions by message alone.
- **A model never runs `fleet approve`**: verdicts are a human-only tty gate (`approve.rs`, reads `/dev/tty`, refuses with
  `verdict_no_tty`). Courtesy gate, not a security boundary. A cockpit that surfaces `needs_human` must route to the human,
  never auto-answer.
- **Namespaces / addresses**: one address form `namespace/courier/member`; broadcast `@channel`; no wildcards, no
  fleet-wide send. `fleet peers` is consent-filtered. The sending courier fills the sender; hub server-stamps identity
  (hence a payload `from`/project name is advisory).
- **Cross-namespace dispatch**: refused unless a channel with `cross-namespace-dispatch` consent exists and both namespaces
  are members (`hub/src/checks.ts checkDispatch`); dispatch only to ONE member, never a @channel. Same-namespace is allowed.
  Cross-namespace *chat* to a channel that lacks consent becomes an approval request.
- **Receipts are evidence-graded**: `injected_unverified` is never upgraded; unknown values render `n/a`, never a healthy 0.
  A cockpit must preserve this: "unknown" is a first-class value.
- **Loss of a tier shrinks reach, never silences** (v1 README principle; v2 couriers queue durably for offline members).
  Cockpit must degrade per host (stale snapshot, marked), not blank.
- Contract change discipline: additive-only protobuf, fixtures + `make contracts-check`; plugins must not need hub/courier edits.
- Autopilot rules that also apply (CLAUDE.md): ADR-0001 verification over attestation (no trust machinery); "a script existing is
  not evidence it is running" => the producer needs a freshness field the consumer checks.

## 6. Recommendation: boundary and minimum contract

Principle (INFERRED, my judgment): **autopilot is the system of record for one project; the cockpit is a read-mostly
projection across projects. They share a small, versioned, derived snapshot and nothing else.** Fleet stays a transport
and authorization layer; it never interprets progress.

Autopilot owns / publishes:
- Truth about its own repo: backlog queue, active plans/projects, release/version, dispatch/campaign state, blockers.
- A `project_progress` snapshot (derived, re-computable from the repo, per ADR-0001: the consumer can re-derive or
  spot-check from the repo; no signatures/hash chains).
- Events (optional, sparse): `needs_human`, `release_shipped`, `plan_state_changed`, `campaign_failed/parked`.
- Producer-side hygiene: emit on change plus a heartbeat; stamp `generated_at`.

Cockpit owns:
- Discovery of which projects/hosts exist, collection, cross-host dedupe, staleness judgment, history/timeline (it stores
  snapshots over time; autopilot does not need to keep history for it).
- Priority/scheduling across projects, quota/account accounting and budget caps (fuchikoma/hangar budget-guard are the
  likely feeders), notifications, human routing of `needs_human`.
- Acting is out of scope for the data path: any "do X on project Y" goes via normal fleet `dispatch` and needs the receiver's own
  operator permission (rule 5). Do not put commands in the snapshot.

Transport recommendation (INFERRED): start with a per-host **file convention** (zero fleet change): autopilot writes
`<repo>/.autopilot/progress.json` (or `$XDG_STATE_HOME/autopilot/progress/<project_id>.json`), atomic rename; a per-host collector
(a fleet plugin, template `plugins/webhook`) reads it and forwards via `submit` kind `progress` on channel `autopilot` with
`silent`/`batch` delivery to the cockpit member; cockpit keeps latest-wins per (host, project_id). Promote to a proto
message only after the schema survives real use. Keep it additive and tolerant of unknown fields (matches fleet's
`.unknown-field` fixture rule).

Minimum contract (schema v1, all fields derived; any unknown = `null`, never 0):

| Field | Type | Notes |
|---|---|---|
| `schema` | string | `autopilot.progress/1`; consumers ignore unknown fields, refuse unknown major |
| `project_id` | string | stable id (repo remote slug or configured id), not a path |
| `project_name`, `repo_path_hint` | string | display only; path is host-local and advisory |
| `host`, `fleet_member` | string | filled by collector from fleet address; never trusted from payload alone |
| `generated_at` | RFC3339 | producer clock |
| `valid_for_s` | int | freshness budget; cockpit marks `stale` after this (advisory, never blocks) |
| `producer` | {name, version, commit} | autopilot version, repo HEAD sha, branch, dirty flag |
| `phase` | enum | `idle | planning | implementing | reviewing | releasing | blocked | parked | done` (small closed set; mapping done by autopilot) |
| `needs_human` | {flag, reason, since} | mirrors fleet `needs_human`; reason <=200 chars |
| `current` | {kind(plan/backlog/release/campaign), id, title, started_at, percent: int|null, steps_done: int|null, steps_total: int|null} | percent only if autopilot can derive it from steps, else null |
| `queue` | {backlog_open, plans_active, plans_unregistered?, next_pick: {id,title,size}|null} | counts + head only, no full lists |
| `release` | {version, released_at, pending_unreleased_commits: int|null} | |
| `run` | {active: bool, level(l3-l6), engine, started_at, last_activity_at, stall: bool, cost_usd: number|null, tokens: int|null} | from dispatch-status/run-ledger; feeds quota |
| `blockers` | array(<=5) of {id, summary(<=200), since} | |
| `links` | {plan, project_dir, last_receipt} | repo-relative paths so a human/agent can re-derive |
| `evidence` | {derivation: "scripts/<x>", source_files:[...]} | how to re-derive (ADR-0001) |

Out of the contract on purpose: raw ledger contents, prompts, review findings, secrets, any action/command field,
anything requiring knowledge of autopilot internals to interpret (cockpit only needs `phase`, counts, freshness, and links).

Open decisions for the owner (not resolvable from the repos):
1. Name of the cockpit component (avoid "fleet-cockpit").
2. Whether the cockpit lives in fleet repo, fuchikoma, or its own repo; which store holds history.
3. Whether to go through fleet messages at all for v1 (git/rsync/ssh pull of `progress.json` is simpler and needs no
   cross-namespace consent; messages add push + `needs_human` routing).
4. `summary` visibility: confirm whether `State.summary` is actually surfaced fleet-wide before using it as a badge.
