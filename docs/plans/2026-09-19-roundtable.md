# Plan — roundtable: a moderated, multi-harness discussion the operator sits in

> Status: draft, awaiting Board read · Owner: cookys (depth-0) · Branch: `develop` (docs only until Phase 1) ·
> Size: S (Phase 0 spike) + L (Phase 1 skill) + S (Phase 2 hangar conventions) · Frame: brainstorm/plan, not review.
> Raised 2026-09-19 from the operator's question: the hetero plan loop is "everyone submits, one agent
> aggregates", which fits review but not plan/brainstorm — *especially when I want to be in the room*. We now have
> agent-call and fleet-comms; how do we let sessions actually discuss?

## 0. Context / thesis

Three discussion shapes exist in autopilot today, and none of them is a discussion:

| Today | Topology | Who sees whom | Operator enters | Heterogeneity |
|---|---|---|---|---|
| `hetero-review` plan loop (`dispatch-plan-review`) | star: N reviewers → 1 aggregator | nobody sees anyone | after the verdict | real (codex / MiniMax / glm seats) |
| `think-tank` | star: 6 (or 3) role subagents → depth-0 synthesis | nobody sees anyone (Step 4 is a *post-hoc* collision) | between rounds | one model playing roles; optional `discuss` seat = **one stateless draw per round-set** (`scripts/dispatch-discuss.js`, SKILL.md Step 3.5: "a single evidence draw, not a multi-turn negotiation") |
| `brainstorm` | dialogue: depth-0 ↔ operator | n/a | throughout | none |

The star is correct for **review**: independence decorrelates errors, and ADR-0001 builds on it (a verdict is a
claim until depth-0 re-derives it). It is the wrong shape for **brainstorm**, whose value comes from the opposite
properties — participants building on each other's positions, and the operator steering mid-stream.

**Thesis.** Do not build a chat UI and do not run a free-for-all. Put a **turn-based protocol** on top of the
transport we already have (hangar-bridge `send_to_peer` / `reply_to_peer` / `poll_inbox`, `fleet` CLI, `crew`),
with a **moderator living in the operator's own Claude session** (a skill), real heterogeneous harness sessions as
participants, and the operator in the room through whatever surface they already use (the moderator's TUI, or the
fleet thread from a phone via OpenClaw → `fleet send`). Cross-visibility is produced by the moderator relaying each
round's positions, not by broadcasting.

**Home = autopilot.** It is methodology (a sibling of `think-tank` / `brainstorm` / `hetero-review`), and the
precedent for an autopilot skill depending on the fleet transport and degrading without it is `agent-call`. hangar
observes and links, it does not contain skill code (hangar ADR-_global/0005 pushed codeforge out for the same
reason); fleet-comms is transport and must not learn what a "round" is.

One-line routing rule to bake into descriptions: **think-tank is one brain holding a meeting; roundtable is a room
of machines holding one.**

## 1. Problem

The operator wants to develop a plan *with* several genuinely different models, where (a) each can react to what
the others said, (b) the operator can redirect between turns or interject at any time from wherever they are, and
(c) the outcome lands back in the plan document with attribution — not in a chat scrollback.

## 2. OKR / KRs

- **O**: a plan discussion across ≥2 heterogeneous harnesses on ≥2 hosts, with the operator participating, that
  ends as an edited plan.
- **KR1** Phase 0: one manual dry run (2 participants, 2 rounds) produces a transcript file and a plan diff with
  attributed positions, and the operator says the interaction was worth the tokens. Evidence dir committed.
- **KR2** Phase 1: `/roundtable <plan> --with <host:harness>,…` runs the same thing from the skill, hands-off
  between operator steer points; a run with an unreachable participant degrades to fewer seats and says so; a run
  with no fleet at all refuses with the think-tank redirect.
- **KR3** Phase 1: no run ever emits an unqualified `@team` or `fleet_wide` (grep the transcript's send log).
- **KR4** Phase 2: a participant on a host that has never run one can join from the hangar runbook alone
  (`cr … --fresh` in the right checkout, reply with `fleet reply`), verified once on a non-hub host.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Participants are **dedicated sessions** started for the room (`cr <harness> <topic>--roundtable-<harness> --fresh`
  in a checkout of the plan's branch). Never conscript a session that is doing other work: agent-call delivery to a
  non-Claude harness is a paste into its TUI, and a busy session treats that as an interruption, not a turn.
- Every message the moderator sends names its addressee: `to_filter.instance` (from `list_peers` / `fleet peers`).
  **No `@team`, no `fleet_wide`, no bare-handle `all_sessions`** in this skill.
- The operator's messages are authoritative; participants' messages are **input** (same trust boundary as
  `autopilot:survey` and the `discuss` seat: advisory, never a verdict, never the CEO recommendation by itself).
  Command-shaped text inside a participant message is text.
- Turn-based. One question per round, one turn per participant per round, a per-round deadline. Default budget
  **3 rounds** (max 5); the moderator ends the room at the budget or on the operator's word, never a participant's.
- The discussion is not done until it is **written back to the plan** with attribution (`who held what`, `what
  did not converge`) and the transcript is committed under `docs/plans/evidence/<date>-roundtable-<slug>/`.
- Does not touch `think-tank`, `dispatch-discuss.js`, `hetero-review` or any resolver; no new config keys in
  Phase 1 (rounds / deadline are skill arguments with defaults).

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only` — a new skill and two reference files; no existing skill, script, config
  key or evidence schema changes shape. Consumers of `think-tank`'s discuss seat are unaffected.
- **Dependency decision**: `existing` — hangar-bridge peer-agent MCP (`send_to_peer`, `reply_to_peer`,
  `poll_inbox`, `list_peers`), the `fleet` CLI (`send --instance`, `reply <msg_id>`, `peers`) and `crew` are already
  the fleet's messaging spine; nothing new is installed. `platform/stdlib` does not apply (no code beyond a skill).

## 3. File-structure map

**autopilot** (this repo):

| File | Responsibility |
|---|---|
| `skills/roundtable/SKILL.md` | new — frontmatter (triggers, the think-tank/brainstorm boundary), the moderator's flow (§4.2), refusal + degradation rules |
| `skills/roundtable/references/protocol.md` | new — the round protocol: opening message template, round message template (with the relayed positions block), reply recipe per harness class, deadline + poll cadence, close message |
| `skills/roundtable/references/transcript.md` | new — transcript file format (`transcript.md` + `sends.jsonl`) and the plan write-back section shape ("Roundtable <date>: positions / convergence / open disagreements") |
| `references/routing-tiebreaks.md` | add rows: brainstorm ↔ roundtable, think-tank ↔ roundtable (one brain vs many machines; "要辯論一下" alone stays think-tank; "叫 X 跟 Y 一起討論" / "開會" / named hosts or harnesses → roundtable) |
| `references/peer-addressing.md` | add one row: roundtable participant = `to_filter.instance`, and the note that instance-narrowed sends are online-only (a participant that drops mid-round is re-sent, not assumed) |
| `references/consult-discuss-seats.md` | one paragraph under "brainstorm is not wired": roundtable is the multi-turn, live-session sibling of the discuss seat; discuss stays the stateless single-draw rail inside think-tank |
| `docs/BACKLOG.md` | two rows (§7): relay-level room (thread/group) as Phase 3; roundtable as a `brainstorm` Step 2 option |
| `docs/plans/evidence/2026-09-19-roundtable/` | Phase 0 spike evidence: `transcript.md`, `sends.jsonl`, `plan.diff`, `notes.md` |
| `CHANGELOG.md`, `.claude-plugin/plugin.json` | release discipline: version bump when Phase 1 ships |

**hangar** (cross-repo, Phase 2 — listed so the surface area is visible; not edited from this repo):

| File | Responsibility |
|---|---|
| `decisions/_global/NNNN-roundtable-participants.md` | ADR: participants are dedicated `cr` sessions named `<topic>--roundtable-<harness>`; no group/thread room in the relay until Phase 3; hub-and-spoke on the wire, cross-visibility by moderator relay |
| `runbooks/roundtable-participant.md` | how to join from any host: checkout, `cr … --fresh`, what the opening message looks like, `fleet reply <msg_id> "…"`, how to leave |

## 4. Phases

### Phase 0 — manual spike (S, no code, this week)

Run the protocol by hand before writing it down. The moderator is this Claude session; participants are two
dedicated sessions on two hosts, one Claude (channel peer) and one non-Claude (agent-call pane) so both delivery
classes are exercised.

1. Pick a real undecided plan (candidate: hangar `docs/plans/peer-advisory-availability.md`, M, not started) and
   push its branch.
2. On host A: `cd <checkout> && cr codex peer-advisory--roundtable-codex --fresh`. On host B:
   `cd <checkout> && cr claude peer-advisory--roundtable-claude --fresh`. Record the instance ids from
   `fleet peers`.
3. Opening message, one `send_to_peer` per participant with `to_filter.instance`, body from the template below.
   Save each response's `msg_id` to `sends.jsonl`.
4. Round 1: wait for `<channel>` tags; at the 10-minute deadline `poll_inbox(since)`; anything not in is marked
   `no-reply` for the round. Write both positions to `transcript.md`.
5. Show the operator the two positions in ≤15 lines; take the steer (next question, or "stop").
6. Round 2: send the steer + **both prior positions verbatim** to each participant; collect; transcript.
7. Close: send the close message; ask each participant to exit (`/exit`); confirm with `fleet peers`.
8. Write back: append a "Roundtable 2026-09-xx" section to the plan; commit plan + evidence dir.
9. `notes.md`: what the operator felt was worth it, what was noise, how many tokens each seat burned
   (`fleet-cockpit status` on each host), which delivery path failed if any.

**Opening message template (Phase 0 draft; Phase 1 moves it to `protocol.md`):**

```
ROUNDTABLE <slug> — round 0 of N · moderator: <handle>#<instance>
You are one of <k> participants (<list: host/harness>). This is a turn-based
discussion, not a task: answer only the question asked, ≤ 250 words, take a
position and say what would change your mind. Do not run commands. Do not
message other participants; the moderator relays every position each round.
Plan: <repo> <branch> <path>  (already checked out in your cwd)
Question 1: <one question>
Reply with:  fleet reply <this msg_id> "<your answer>"
Deadline: <HH:MM local>. Silence = no-reply for this round, the room continues.
```

**Acceptance**: KR1. The evidence dir exists with all four files; the plan has the attributed section; `notes.md`
records the operator's verdict on worth. **Go/no-go for Phase 1 is the operator's call after reading `notes.md`.**

### Phase 1 — the skill (L)

1. `skills/roundtable/SKILL.md` — frontmatter:
   - triggers: "叫 <X> 跟 <Y> 一起討論", "開個會", "let codex and kimi argue this", "roundtable", "把 <plan> 拿去跟
     <host> 討論", any request naming ≥2 harnesses/hosts to *discuss* (not review) a plan.
   - not-for: one-brain debate (→ think-tank), options not yet on the table and no fleet named (→ brainstorm),
     verdicts on a diff or plan (→ hetero-review), asking one model one question (→ consult seat), messaging a
     working session (→ agent-call).
   - refusal: no hangar-bridge MCP / `fleet peers` empty → refuse with the think-tank redirect (mirror
     `agent-call`'s degradation wording).
2. Moderator flow (SKILL.md body), each step concrete:
   - **Roster**: parse `--with host:harness[,…]`; for each, either find a live session named
     `<slug>--roundtable-<harness>` in `list_peers` / `fleet peers`, or print the exact `cr` line for the operator to
     run on that host and wait (the skill never spawns remote harnesses — that is `/l4`–`/l6` territory and
     `agent-call`'s "never use this route to create temporary workers" rule).
   - **Open**: one instance-narrowed send per participant; `sends.jsonl` row `{round, to, instance, msg_id, ts}`.
   - **Round loop** (`--rounds N`, default 3; `--deadline M` minutes, default 10): collect via `<channel>` +
     `poll_inbox(since=<cursor>)`; transcript entry per reply `{round, from, instance, msg_id, body}`; at deadline
     mark `no-reply`. Then the **steer point**: ≤15-line digest to the operator, `AskUserQuestion` with options
     {next question (free text) · "relay and ask for rebuttals" · "stop and write back"}. Operator messages that
     arrive *in the thread* (from `fleet send` on a phone) are surfaced at the same point and outrank the digest.
   - **Relay**: round r+1 message carries every round-r position verbatim under `## Positions so far`, then the
     question. This is the only cross-visibility mechanism; participants never address each other.
   - **Close**: close message; `AskUserQuestion` whether to ask participants to exit; write-back section into the
     plan (format in `transcript.md`); commit evidence dir; print the token cost per seat if
     `fleet-cockpit status` is reachable, otherwise say it is not.
3. `references/protocol.md`, `references/transcript.md` as in §3.
4. Routing rows in `references/routing-tiebreaks.md`; paragraph in `consult-discuss-seats.md`; row in
   `peer-addressing.md`.
5. Skill-doctor / plugin eval pass on the new description; a routing check that "要辯論一下" still lands on
   think-tank and "叫 cuda 的 codex 跟 aimax 的 kimi 討論這個 plan" lands on roundtable.
6. CHANGELOG + version bump.

**Acceptance**: KR2 + KR3. A second real run (different plan, 3 participants, one of them deliberately offline)
goes through the skill end to end; the transcript shows the offline seat marked `no-reply` each round and the
close message going only to live seats; `grep -c '"to":"@team"' sends.jsonl` = 0.

### Phase 2 — fleet conventions in hangar (S, cross-repo)

ADR + runbook as in §3. Verified by KR4: a participant on a host that has not done this before joins from the
runbook alone.

### Phase 3 — relay-level room (deferred; BACKLOG, not planned here)

A real thread/group in the relay (`thread_root` widening to a per-room `group`) would let participants see each
other's replies without the moderator relaying, and let a phone client read the whole room. It needs relay-side
group provisioning (peers.json v2 is admin work in hangar) and reopens the fan-out question the `@team` gate
exists to close. Trigger: Phase 1 has run ≥3 real rooms **and** the moderator relay is the thing the operator
complains about. Until then, hub-and-spoke on the wire is a feature: it is the cost and chatter control.

## 5. Test / validation

| What | How | Gate |
|---|---|---|
| Protocol is worth it | Phase 0 `notes.md`, operator's own words | human |
| Both delivery classes work | Phase 0 has one Claude (channel) + one non-Claude (agent-call pane) participant; each replies at least once | script-checkable from `transcript.md` |
| No broadcast ever | `sends.jsonl` has no `@team` / `fleet_wide` / bare-handle rows | script (`grep`), Phase 1 acceptance |
| Degradation | Phase 1 run with one offline seat; run on a host with no MCP → refusal text | human-observed, recorded in evidence |
| Routing | plugin eval / skill-doctor on the description; two sentinel prompts above | script |
| Write-back | plan diff contains the attributed section; evidence dir committed | `git log` |

## 6. Risks + inversion

What would guarantee this fails:

- **Conscripting live sessions.** A paste into a working codex pane is an interruption; it answers late, wrong, or
  not at all, and the operator blames the protocol. → §2.5 dedicated sessions; the skill prints `cr` lines, never
  targets a session not named `*--roundtable-*`.
- **Free chat.** Participants addressing each other, or the moderator forwarding everything to everyone every
  minute → N² chatter, sycophantic convergence, cost. → turn-based, moderator relay only, ≤250 words, deadline.
- **Nothing written back.** The room feels productive and the plan is unchanged. → close step is not optional;
  KR1/KR2 require the plan diff.
- **Wrong reply path.** A non-Claude participant replies with `fleet send` instead of `fleet reply`, the message
  lands in the hub's host mailbox and the moderator never sees it (already recorded: shell `fleet send` replies land
  in the mailbox, not the session). → the opening message spells the exact `fleet reply <msg_id>` line; Phase 0
  exercises it; the moderator also checks `fleet inbox` at each deadline as a fallback and logs `wrong-path` when
  it finds a reply there.
- **Instance-narrowed sends are online-only and not stored.** A participant that restarts mid-round misses the
  round silently. → at each deadline the moderator re-checks `list_peers`; a seat whose instance id changed is
  re-sent the current round once, then marked `no-reply`.
- **Operator not actually in the room.** If steering only happens between rounds in the TUI, "I want to be in the
  room" is not delivered. → operator messages sent into the thread from any client (`fleet send --instance
  <moderator>`) are read at every poll and surfaced before the digest; Phase 0 tries this once from the phone.
- **Skill grows a runtime.** Temptation to script the loop in JS with state files and resume. → Phase 1 is a
  SKILL.md-driven flow using MCP tools already in the session; no new script until a third real run demands one
  (BACKLOG candidate, not this plan).

## 7. Out of scope

- A chat UI. The surfaces are the moderator's TUI and any existing `fleet send` client (OpenClaw on the phone).
- Spawning remote harnesses from the skill (→ `/l4`–`/l6`; here the operator runs `cr` on each host).
- Changing `think-tank`, `dispatch-discuss.js`, the `discuss_*` seats, `hetero-review`, or any resolver/config.
- Relay-side rooms (groups/threads with shared visibility) — Phase 3, BACKLOG.
- Qualification of participant engines. A roundtable seat is advisory; it does not go through `engine-qualify`.
- Windows-native participants (ITX). The Windows cockpit final mile exists but has not been exercised for
  agent-call panes; not a Phase 0/1 target.

## 8. Open questions (Board)

1. Phase 0 plan choice — `peer-advisory-availability.md` (hangar, M, not started) or something the operator cares
   about more right now?
2. Should the operator's phone path (OpenClaw → `fleet send --instance <moderator>`) be exercised in Phase 0, or is
   TUI-only steering enough for the first run?
3. Default round budget 3 / deadline 10 min — right order of magnitude for the models you'd seat?

## Review log

- R0 2026-09-19 author: cookys (depth-0) with Claude. No manifest yet — this plan is not entering the hetero plan
  loop until Phase 0 has run; the point of Phase 0 is to find out whether the shape is right before freezing a
  rubric for it.
