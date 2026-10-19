# Plan — roundtable: a room log both windows only read

> Status: **Phase 0 done 2026-09-19 (worth it). Redesign 2026-10-19: room log is the record; windows A and B both approved; skill still waits on BL-0216.** · Owner: cookys (depth-0) · Branch: docs until Phase 1 code ·
> Size: S (Phase 0, done) + M (Phase 1 room log + window A) + M (Phase 2 window B) + L (Phase 3 skill, BL-0216) + S (Phase 4 hangar) · Frame: plan, not review.
> Raised 2026-09-19: the hetero plan loop fits review, not a discussion the operator sits in. Revised 2026-10-19 around a room log file.

## 0. Owner rulings (2026-10-19)

Recorded from panel card `d-e99062da`. These override the 2026-09-19 transport sketch where they conflict.

1. Window A (tmux) and window B (mod pane) are both built to a usable state.
2. Transport is fleet. Roundtable is an explicit exception to the rule "discussion goes through hetero". Review stays on hetero.
3. The owner reaches the machine over ssh into tmux. Anything shown in a terminal is plain text only. No images.

No new skill is added by this revision. The plugin version stays frozen. Skill-ization stays in BL-0216; its trigger is unchanged (three more manual rooms under the Phase 0 protocol, each with an evidence dir, or the owner asks for the skill by name).

## 1. Context / thesis

Three discussion shapes exist in autopilot today, and none of them is a discussion the operator can re-enter after a restart:

| Today | Topology | Who sees whom | Operator enters | Heterogeneity |
|---|---|---|---|---|
| `hetero-review` plan loop (`dispatch-plan-review`) | star: N reviewers → 1 aggregator | nobody sees anyone | after the verdict | real (codex / MiniMax / glm seats) |
| `think-tank` | star: 6 (or 3) role subagents → depth-0 synthesis | nobody sees anyone (Step 4 is a *post-hoc* collision) | between rounds | one model playing roles; optional `discuss` seat = **one stateless draw per round-set** |
| `brainstorm` | dialogue: depth-0 ↔ operator | n/a | throughout | none |

The star is correct for **review**: independence decorrelates errors, and ADR-0001 builds on it. Review stays on hetero. It is the wrong shape for **brainstorm**, whose value comes from participants building on each other's positions and the operator steering mid-stream.

**Thesis.** Do not build a chat product and do not run a free-for-all. Every utterance is appended to one **room log file**. Windows only read that file. The moderator re-reads the file at the start of every round, so session compaction or a restart does not lose the discussion. Cross-visibility is the moderator relaying positions (a `relay` row plus a fleet send to each seat), not a broadcast. The operator sits in window A (tmux) and, once Phase 2 lands, window B (the live mod pane). Both show the same file.

**Home = autopilot.** Roundtable is methodology (a sibling of `think-tank` / `brainstorm` / `hetero-review`). Fleet is the transport and must not learn what a "round" is. Hangar observes and links; it does not contain this skill. The precedent for an autopilot skill that depends on fleet and degrades without it is `agent-call`.

One-line routing rule, unchanged, for the Phase 3 skill description: **think-tank is one brain holding a meeting; roundtable is a room of machines holding one.**

## 2. Problem

The operator wants to develop a plan *with* several genuinely different models, where (a) each can react to what the others said, (b) the operator can redirect between turns from a plain-text terminal over ssh, and (c) the outcome lands back in the plan document with attribution. A session summary is not the record. The room log file is.

## 3. OKR / KRs

- **O**: a plan discussion across ≥2 heterogeneous harnesses, with the operator participating from a plain-text window, that ends as an edited plan, and that survives a moderator restart because the room log is re-read.
- **KR1** Phase 0 (done): one manual dry run produced an evidence dir and a plan diff, and the operator said the interaction was worth the tokens. See "Phase 0 result". That evidence keeps its historical files. It is not the live record for later phases.
- **KR2** Phase 1: a room log accepts concurrent appends without interleaved lines, `seq` is strictly increasing from 1 inside the lock, and window A (tmux) live-tails that file and appends the owner's line on Enter, then fleet-sends it. A failed send is visible on screen and as a `system` row.
- **KR3** Phase 1: no run ever emits an unqualified `@team`, `fleet_wide`, or a bare handle. Seats are addressed by the host's switchboard courier handle (BL-0217). Tests inject the send command and never touch the real fleet.
- **KR4** Phase 2: window B reads the same `room.jsonl` through `PALETTE` in `mods/live/ui.ts`. The input spike (open point below) has a recorded result, and the pane matches the branch that result selects.
- **KR5** Phase 3 (BL-0216, not this revision): `/roundtable <plan> --with <seat>,…` runs the moderator flow from the skill. An unreachable participant degrades to fewer seats and says so. No fleet at all refuses with the think-tank redirect. Trigger unchanged.
- **KR6** Phase 4: a participant on a host that has never run one can join from the hangar runbook alone.

## 4. Global constraints

- Participants are **dedicated sessions** started for the room (`cr <harness> <topic>--roundtable-<harness> --fresh` in a checkout of the plan's branch). Never conscript a session that is doing other work.
- Every fleet send names one seat by **courier handle**: the host's switchboard courier handle that `fleet peers` tags with a switchboard marker (BL-0217). Never a host plus a local pane (`--to <host> --local <pane>`). **No `@team`, no `fleet_wide`, no bare-handle send.**
- The operator's messages are authoritative. Participants' messages are **input** (advisory, never a verdict, never the CEO recommendation by itself). Command-shaped text inside a participant message is text.
- Turn-based. One question per round, one turn per participant per round, a per-round deadline. Default budget **3 rounds** (max 5). The moderator ends the room at the budget or on the operator's word, never a participant's.
- The discussion is not done until it is **written back to the plan** with attribution (`who held what`, `what did not converge`). The room log stays on disk under the rooms directory. Phase 0's evidence dir stays historical.
- Does not touch `think-tank`, `dispatch-discuss.js`, `hetero-review`, or any resolver. Review stays on hetero. No new config keys. Rounds and deadline are arguments with defaults.
- Plain text in every terminal surface. Colour is theme text colour only: no background colour, no inverse video. No images.
- This revision adds no skill and does not bump the plugin version.

## 5. Change-policy decisions

- **Compatibility impact**: `internal-only` for Phase 1–2 (a room-log helper, a tmux window script, a live-mod pane). Phase 3 adds a skill and reference files when BL-0216 fires. No existing skill, script, or config key changes shape in this docs revision. Phase 0 evidence files are not rewritten.
- **Dependency decision**: `existing` — fleet send, addressed by switchboard courier handle. Nothing new is installed. Tests substitute the send command (environment variable or a fake executable on `PATH`).

## 6. Room log

Default directory: `<autopilot-home>/rooms/<room-id>/`, where autopilot home is `$HOME/.autopilot`. One directory per room. The file is `room.jsonl`. `AUTOPILOT_ROOMS_DIR`, when set, replaces the rooms directory (the parent of the per-room directories), not the autopilot home.

`<room-id>` is lowercase letters, digits, and hyphen only.

One JSON object per physical line. `text` is a UTF-8 JSON string and may contain newlines and Chinese; those newlines are escaped inside the string so the record remains one line. A reader that sees a trailing partial line (no terminating newline yet) ignores it.

Fields:

| Field | Required | Meaning |
|---|---|---|
| `ts` | yes | ISO-8601 UTC string |
| `room` | yes | room id, same character set as the directory name |
| `seq` | yes | integer, strictly increasing from 1 within the room, assigned at append time inside the lock |
| `from` | yes | a courier handle for a seat, the literal `owner` for the owner, or the literal `moderator` for the moderator |
| `kind` | yes | one of `say`, `relay`, `system` |
| `text` | yes | UTF-8 string |
| `reply_to` | yes | `seq` of the utterance answered, or `null` |
| `round` | no | integer round number |
| `to` | no | array of handles the row was addressed to |

Kinds:

- `say` — a seat utterance or an owner utterance.
- `relay` — the moderator copying positions to seats. The fleet sends that carry those positions are separate from the row; a failed send is a `system` row, not a silent drop.
- `system` — roster changes (seat added, seat dropped, liveness result) and send failures. A send failure names the handle, the exit status, and the stderr text. It is never omitted.

Append rules: one complete line, one `write` of that line plus its newline, under an exclusive lock (a sibling lock file `room.jsonl.lock` in the room directory). `seq` is the current maximum plus one, computed inside the lock after reading the complete lines. Concurrent appenders never interleave bytes. Readers ignore a trailing partial line.

Shared helper (Phase 1, not written in this revision): `scripts/lib/room-log.js`. Window A and the tests use it. Window B reads the same file; it may call the helper or parse the same rules. The file format above is the contract either way.

## 7. File-structure map

**autopilot** (this repo). Nothing in this table is created by the 2026-10-19 docs revision.

| File | Responsibility |
|---|---|
| `scripts/lib/room-log.js` | Phase 1 — append under the lock, assign `seq`, read complete lines, ignore a trailing partial line. `AUTOPILOT_ROOMS_DIR` overrides the rooms directory. |
| `scripts/roundtable-window.js` | Phase 1 — window A. Subcommand `open <room>` opens a new window in the current tmux session. |
| `mods/live/` pane (new surface, colours only through `PALETTE` in `mods/live/ui.ts`) | Phase 2 — window B, same `room.jsonl`. |
| `skills/roundtable/SKILL.md` | Phase 3, BL-0216 — moderator flow (§8), refusal and degradation. Not added while the version is frozen. |
| `skills/roundtable/references/protocol.md` | Phase 3 — opening template, round template, reply recipe per harness class, deadline, close message. |
| `references/routing-tiebreaks.md` | Phase 3 — brainstorm ↔ roundtable, think-tank ↔ roundtable. "要辯論一下" alone stays think-tank. "叫 X 跟 Y 一起討論" / "開會" / named hosts or harnesses → roundtable. |
| `references/peer-addressing.md` | Phase 3 — one row: a roundtable seat is the host's switchboard courier handle (BL-0217), never a host plus a local pane. |
| `references/consult-discuss-seats.md` | Phase 3 — one paragraph: roundtable is the multi-turn, live-session sibling of the discuss seat. |
| `docs/plans/evidence/2026-09-19-roundtable/` | Phase 0 history only. Not the live record. Not rewritten. |
| `CHANGELOG.md`, `.claude-plugin/plugin.json` | untouched until a later phase that actually ships code or a skill. This revision does not bump them. |

**hangar** (cross-repo, Phase 4 — listed so the surface is visible; not edited from this repo):

| File | Responsibility |
|---|---|
| `decisions/_global/NNNN-roundtable-participants.md` | ADR: dedicated `cr` sessions named `<topic>--roundtable-<harness>`; no relay group until Phase 5; the room log is the record; fleet is the wire. |
| `runbooks/roundtable-participant.md` | How to join: checkout, `cr … --fresh`, what the opening message looks like, `fleet reply`, how to leave. |

## 8. Moderator flow

The moderator lives in the operator's Claude session. Until Phase 3 it is run by hand from this plan. At the start of every round it re-reads `room.jsonl` from the first complete line. It does not trust session memory or a compacted transcript.

1. **Open room.** Create `<rooms>/<room-id>/` if needed. Append a `system` row naming the plan path, the branch, and the round budget.
2. **Roster.** Seats are dedicated sessions. The moderator prints the exact `cr` line per host and waits. It never spawns remote harnesses. Each seat's address is the switchboard courier handle from `fleet peers` (the tag that marks a switchboard courier). A seat without that tag is not addressed.
3. **Liveness probe.** One short "say READY" send per seat, 60 s deadline. A seat that does not answer is a `system` row and is out of the round. Quota-dead registrations looked healthy in Phase 0; the probe exists because of that.
4. **Round.** Re-read `room.jsonl`. Collect `say` rows for this round. At the deadline, a seat with no `say` is a `system` row `no-reply`. The plan under discussion is a single file the seat can read (Phase 0: hangar clones are forbidden off-hub).
5. **Relay.** Append one `relay` row whose `text` is every position from the round, verbatim, and whose `to` lists the live seats. Fleet-send that text to each live seat's courier handle. A failed send appends a `system` row and is shown to the operator. Participants never address each other.
6. **Steer point.** Show the operator a short digest of the new rows. The operator's next line is a `say` with `from` `owner` (window A, or window B if the spike says input works, or the moderator session prompt if window B is display-only). Operator text outranks the digest. Options at the steer point: next question, relay and ask for rebuttals, stop and write back.
7. **Close.** Append a `system` row that the room is closed. Ask whether participants should exit. Write back into the plan: who held what, what converged, what did not. The write-back quotes `seq` numbers from `room.jsonl`. Commit is a later phase's job when code exists; this docs revision does not commit evidence.

Opening message (hand-run until `protocol.md` exists in Phase 3):

```
ROUNDTABLE <slug> — round 0 of N · moderator
You are one of <k> participants. This is a turn-based discussion, not a task:
answer only the question asked, ≤ 250 words, take a position and say what
would change your mind. Do not run commands. Do not message other
participants; the moderator relays every position each round.
Plan: <repo> <branch> <path>
Question 1: <one question>
Reply with:  fleet reply <this msg_id> "<your answer>"
Deadline: <HH:MM local>. Silence = no-reply for this round, the room continues.
```

What Phase 0 still requires, carried here: exact fleet call shapes stay in `protocol.md` when Phase 3 writes it (`send` to one courier handle, `reply` back to the moderator). A late-joining seat gets the missed round as a moderator summary (`relay`), not a dump of every earlier line. Roster changes mid-room are `system` rows.

## 9. Window A — tmux

`scripts/roundtable-window.js`, using `scripts/lib/room-log.js`.

Phase 1 is implemented. The helper is `scripts/lib/room-log.js` (append under the lock, read, tail). Window A is `scripts/roundtable-window.js` (`open`, `tail`, `input`, `send`). No `skills/roundtable/SKILL.md` exists; the skill is Phase 3 and still waits on BL-0216. Call the window when the operator is inside tmux and the room log should be tailed and spoken from. Contract: this section and §6. Inventory rows: `docs/scripts-inventory.md`.

- Subcommand `open <room>` opens a new window in the **current** tmux session, split into two panes.
- Upper pane live-tails `room.jsonl` and can be scrolled (tmux copy mode / scrollback). It prints `seq`, `from`, `kind`, and `text`. Plain text. Long text is wrapped in the script to the terminal column count, and every continuation keeps the two-space indent. Theme text colours only: no background colour, no inverse. Role table, the same one as §10: an owner row is "you are here" (nearest plain ANSI foreground to `PALETTE.here`, theme key `claude`: SGR `38;5;173`); other system rows are attention (ANSI 33, `warning`); a send failure is broken (ANSI 31, `error`); a seat row is default text.
- Lower pane is a one-line input. Enter appends one `say` row with `from` `owner` (and `to` set to the current live seats when a roster is known), then fleet-sends that text to each participant. The input subcommand prints one divider of box-drawing horizontals (U+2500) repeated to the terminal column count (default 80) immediately above the prompt, in the structure-role dim grey foreground (ANSI 90) only, or as plain characters when `NO_COLOR` or `--no-color` is set.
- If the fleet send fails, the pane prints the failure in the lower or upper pane immediately, and the script appends a `system` row with the same fact. The failure is never swallowed and never reported as success.
- The send executable is the real `fleet` for the owner. Tests point it at a fake via an environment variable or a fake executable. The script does not embed a fleet address book.

## 10. Window B — mod pane

`mods/roundtable/` reads the same `room.jsonl`. Colours go through `PALETTE` in `mods/live/ui.ts` only, per `docs/plans/2026-10-13-live-pane-design-system.md` section 12 (one theme key, one meaning; no theme-key literal outside `PALETTE`).

**Spike resolved: INPUT-WORKS** (real Claude Code 2.1.303, tmux, `Input` on terminal / desktop / vscode; mobile has no Input). The pane has an Input. The owner types and presses Enter. `label` must not end with a colon (the field draws its own). Do not set `closeOnEscape` (Esc would close the pane). `$.fs.read` plus `$.clock.every` about once a second is the live read. Notes: `scratchpad/ceo/roundtable/spike/SPIKE.md` (read-only spike; not rewritten here).

The scrollbar thumb uses `thumbOf` in `mods/live/scrollmath.ts`: its length is visible rows divided by total rows of the track (minimum one cell), and its position follows the offset, including the tail-follow case; when every row fits, the thumb is the whole track. Chosen branch: Enter appends a `say` row with `from` `owner` and fleet-sends, by running `node <plugin root>/scripts/roundtable-window.js send ROOM TEXT` through `$.process.run` (the same script as window A, plugin root `$.plugin.root`). A non-zero exit is drawn on the pane as `broken` (`PALETTE.broken`) and is never reported as success. A failed send (throw or non-zero exit) keeps the owner's draft; only a successful send clears it. The script appends the `system` row for a failed seat send. Role table, the same one as §9: an owner row is "you are here" (`PALETTE.here`, theme key `claude`; window A uses SGR `38;5;173`); other system rows are attention (`PALETTE.attention`, `warning`; window A uses ANSI 33); a send failure is broken (`PALETTE.broken`, `error`; window A uses ANSI 31); a seat row is default text (no role: a seat utterance is not "you are here" and not a failure); separators use `structure`. A room that fits in the pane opens at row 1; a longer room opens at the tail. The Input is not an `action` button.

Rooms directory: `AUTOPILOT_ROOMS_DIR`, else `$HOME/.autopilot/rooms`, read with `$.env.get`. When that call throws, or neither value is a non-empty string, the pane says the directory is unknown and does not guess a path. `/rt-room` with no id opens the most recently modified room directory under that parent. The one-second poll starts when the pane is opened.

## 11. Transport and addressing

Fleet. Roundtable may discuss over fleet; that is the 2026-10-19 exception. Hetero remains the review path and is not used to carry round utterances.

A seat address is the courier handle BL-0217 describes: the host's switchboard courier handle, the one `fleet peers` tags with a switchboard marker. A handle without that marker is not a seat address. The host-plus-local-pane form is forbidden.

Send failures become `system` rows (§6) and are shown on the window that sent. Tests never call the real fleet. The send command is injected by an environment variable or by placing a fake executable ahead of `fleet` on `PATH`.

## 12. Phases

### Phase 0 — manual spike (done 2026-09-19)

The protocol was run by hand. Evidence and the operator's verdict are in "Phase 0 result" below. Those files are history. Later phases do not extend them and do not treat them as the live record.

### Phase 1 — room log + window A (implemented)

1. `scripts/lib/room-log.js` implements §6.
2. `scripts/roundtable-window.js` implements §9.
3. Tests in the repo's existing runner, red first: append atomicity under concurrent writers; `seq` from 1 with no gaps on successful appends; multi-line and Chinese `text` round-trips as one JSON line; a trailing partial line is ignored; a fake send that exits non-zero produces a `system` row and a non-success screen line. Each gate has a negative control that would pass if the assertion were removed. The send path under test is the injected fake, never the real fleet.
4. Per-round acceptance commands (foreground, session-id variables unset):

   - `bash scripts/check-canonical-invariants.sh`
   - `node scripts/check-tmp-residue-registry.js`
   - `node scripts/check-config-docs.js`
   - `node scripts/check-claude-md-inventory.js`
   - `node scripts/check-js-syntax.js`
   - `bash scripts/sync-codex-plugin-skills.sh --check`

**Acceptance**: KR2 + KR3.

### Phase 2 — window B (implemented)

1. Spike: INPUT-WORKS. The pane has an Input; the owner types and presses Enter. Recorded in §10. The display-only branch is not built.
2. The pane is `mods/roundtable/` (§10). Colours only through `PALETTE`. `$.process.run` is the one extra allowlisted runner, argv fixed to `scripts/roundtable-window.js send`.
3. Red first at `0de69d4e5` (`model.ts` missing; source lint found no pane files). Negative control: a fixture string with a hex colour, `backgroundColor`, `inverse`, and a theme-key literal fails the roundtable source lint; ui-lint L8 still scans the new folder.

**Acceptance**: KR4.

### Phase 3 — the skill (BL-0216, not started)

Trigger unchanged: three more manual rooms under the Phase 0 protocol, each with an evidence dir, or the owner asks for the skill by name. The skill then encodes §8 and the routing rows in §7. Refusal: no fleet → think-tank redirect. An offline seat is `no-reply` and is left out of later sends. No version bump and no skill file until that trigger. This phase does not start in the 2026-10-19 rewrite.

**Acceptance**: KR5.

### Phase 4 — hangar conventions (cross-repo)

ADR and runbook in §7. Verified by KR6: a participant on a host that has not done this before joins from the runbook alone.

### Phase 5 — relay-level room (deferred)

A real thread or group in the relay would let seats see each other without moderator relay. It needs relay-side group provisioning and reopens the fan-out question the `@team` gate exists to close. Trigger: Phase 3 has run ≥3 real rooms and the operator complains about the moderator relay specifically. Until then, hub-and-spoke on the wire plus the room log is the design. Not scheduled.

## 13. Test / validation

No new test file is added by this docs revision. The table is the contract for Phase 1 and Phase 2.

| What | How | Gate |
|---|---|---|
| Append atomicity | concurrent appenders, exclusive lock, one complete line each | `seq` strictly increasing, no interleaved JSON; negative control drops the lock and must show a torn line or a duplicate `seq` |
| Multi-line and Chinese `text` | one object, escaped newlines, UTF-8 | read back equals the input; negative control splits on a raw newline and must fail the parser |
| Partial trailing line | reader stops before a line with no newline | ignored; negative control treats it as a row and must fail |
| Fleet send failure | fake executable exits non-zero | screen shows the failure and a `system` row exists; negative control swallows the status and must fail the assertion |
| No broadcast | rows and the fake send's argv | no `@team`, no `fleet_wide`, no bare handle, no `--local` pane form |
| Send injection | env var or fake on `PATH` | a test run has zero calls to the real fleet binary |
| Red before green | each new assertion is shown failing on the unfixed code, then passing | recorded in the phase evidence |
| Write-back | plan section cites `seq` values that exist in `room.jsonl` | human plus a diff |
| Per-round repo checks | the six commands in §12 Phase 1 | exit 0 |
| Phase 0 worth | operator's words in the Phase 0 result | already met |

`node scripts/check-plan-graduation.js` is a docs-revision check when the script exists. It must not report `plan_unregistered` for this plan.

## 14. Risks

- **Conscripting live sessions.** A paste into a working pane is an interruption. Dedicated `*--roundtable-*` sessions only. The moderator prints `cr` lines and does not target any other session.
- **Free chat.** Seats addressing each other, or the moderator forwarding everything every minute, becomes N² chatter. Turn-based relay only, ≤250 words, deadline.
- **Nothing written back.** Close is not optional. The plan section cites `seq`.
- **Wrong reply path.** A non-Claude seat that replies with `fleet send` instead of `fleet reply` lands in the hub mailbox. The opening message spells `fleet reply <msg_id>`. The moderator checks the inbox at each deadline and appends a `system` row `wrong-path` when a reply is there.
- **Restart or compaction.** Session memory is not the record. The moderator re-reads `room.jsonl` at every round. A window restart tails the same file.
- **Swallowed send failure.** The owner thinks a line was delivered. Window A (and window B, if it sends) prints the failure and appends `system`. Tests use a fake that fails.
- **Wrong address form.** `--to <host> --local <pane>` conscripts every Claude session on a host with no switchboard courier (Phase 0 F1). Courier handle only.
- **Colour or images in tmux.** The owner is on ssh. Plain text, theme text colour only.
- **Skill before the trigger.** Phase 3 stays BL-0216. This plan does not add `skills/roundtable/`.

## 15. Out of scope

- Images, background fills, inverse video.
- A new skill, a version bump, or a CHANGELOG row in this revision.
- Spawning remote harnesses from the moderator (the operator runs `cr` on each host).
- Changing `think-tank`, `dispatch-discuss.js`, the discuss seats, `hetero-review`, or any resolver. Review stays on hetero.
- Relay-side rooms — Phase 5, deferred.
- Qualification of participant engines. A roundtable seat is advisory.
- Editing Phase 0 evidence files.
- BL-0217's text, aside from addressing seats the way that entry already requires.

## 16. Open points

1. **Window B input (Phase 2 spike).** Can the mod pane take text input? Both branches are in §10. The spike decides. Unresolved as of 2026-10-19.
2. Default round budget 3 / deadline 10 min stayed the Phase 0 order of magnitude. Change it only after another manual room says otherwise.

Phase 0's plan choice and the phone-steering question are closed: the dry run used hangar `docs/plans/peer-advisory-availability.md`, and the owner sits in tmux over ssh (ruling §0). A phone client is not a surface in this revision.

## Phase 0 result (2026-09-19)

Ran on hangar `docs/plans/peer-advisory-availability.md`: three seats (aimax395/claude, cuda/claude, cuda/grok), three rounds,
~45 min, unanimous on every question, the plan changed shape (offer/lessons split, tool-written stub + one-line asker obligation
+ gate, falsifiable P4). Evidence dir `docs/plans/evidence/2026-09-19-roundtable/` is **history**: `transcript.md`, `sends.jsonl`, `plan.diff`, `notes.md` (F1–F7, cost). Those two log names are the Phase 0 record only. They are not the live record; later phases use `room.jsonl` (§6). Write-back
landed in hangar `b9438dd`. **Operator's verdict (cookys, 2026-09-19): worth it** — "值". Decision at the time: **do not build the skill yet;
run more rooms by hand first**. That decision still holds for Phase 3 (BL-0216). The 2026-10-19 revision builds the room log and the windows first; the skill trigger is unchanged.

What Phase 0 changed, still in force (§4, §8, §11):

- **Only a switchboard courier handle is a seat address.** Never `fleet send --to <host> --local <pane>` (F1, BL-0217). `fleet peers` tags the handle with a switchboard marker and refuses a handle without one.
- **Liveness probe before round 1** (F3/F6): codex and kimi seats died on their own quotas with healthy-looking registrations. A one-line "say READY" with a 60 s deadline, per seat, recorded as a `system` row.
- **Reply path** is `fleet reply` back to the moderator. A late-joining seat gets the missed round as a moderator summary.
- The plan under discussion is a **single file the seat can read** (hangar clones are forbidden off-hub). "Checked out in your cwd" is wrong for hangar plans.
- Roster changes mid-room are normal. They are `system` rows in the room log (Phase 0 stored them in its historical evidence files).

## Review log

- R0 2026-09-19 author: cookys (depth-0) with Claude. No manifest yet — this plan is not entering the hetero plan loop until Phase 0 has run; the point of Phase 0 is to find out whether the shape is right before freezing a rubric for it.
- R1 2026-10-19 author: cookys with Claude. Rewrite around `room.jsonl`. Windows A and B both owner-approved (card d-e99062da). Fleet is the discussion transport and an explicit exception to hetero; review stays on hetero. Phase 0 evidence kept as history. Skill remains BL-0216. Docs only.
