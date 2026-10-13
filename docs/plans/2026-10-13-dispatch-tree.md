# Dispatch tree — follow every piece of work from the session, without guessing a parent

Status: **draft, in plan review** (2026-10-13; `lane/w-dispatch-rail` merged as `544b654b`). Plan only; no product code changed.
Split out of [`2026-10-13-live-pane-design-system.md`](2026-10-13-live-pane-design-system.md) (its former P6 and §7.1) by owner ruling 2026-10-13: the dispatch tree is scheduled as its own plan, after the related branches merge. The live-pane plan keeps one pointer line and no dependency on this plan.
Scope: run manifests, the dispatch rails' child launch, the session marker, the subagent records, and one read-only renderer in the 派工 tab (`mods/live`). It touches producers, so it is not a pane-only change.

Owner ask (2026-10-13): when dispatched work dispatches again — including a shell that starts a harness that starts Claude Code again — can every piece be followed from the session? Evaluated before planning (evaluation notes: session scratchpad `nested-dispatch-tracking-eval.md`; facts below carry their own pointers).

## 1. Diagnosis (why this is its own plan)

The G1 review of the live-pane plan (sol_deep R1) was right that this work has no home there: the live-pane diagnosis is 18 visual defects, none about lineage. The defect here is a different one and is diagnosed below.

| # | What is missing today | Evidence |
|---|---|---|
| D1 | The 派工 tab reads none of the subagent records; only cost tracking does (`hooks/cost-tracker-lib.js` `readAgentTree`, `scripts/cost-digest.js --tree`) | `mods/live/model.ts` dispatch builders read manifests only |
| D2 | A rail that starts `claude` (cc-shim, claude-native) leaves no structured link between the rail run and the child's session. Measured: `CLAUDE_CODE_SESSION_ID` is replaced by a new id in the child, every `AUTOPILOT_*` variable is inherited unchanged | evaluation notes; `dispatch-foreman.sh:339-353` allow-lists the prefix |
| D3 | cc-shim deletes its scratch HOME, transcript included, so the child's work cannot be read after the fact | `dispatch-review.sh:1531-1536`, `dispatch-author.sh:1194` |
| D4 | A fleet dispatch carries one request/reply pair and no root, parent or depth; the far side's records are on the far machine | fleet message shape |
| D5 | Which subagent started a rail is not recorded: a subagent's Bash gets no agent id | Claude Code behaviour; `hooks/awaiting-owner.js:76` shows the PreToolUse payload does carry `agent_id` |
| D6 | A process started with `nohup` / `setsid` / `&` and no rail leaves no record at all | `/proc` only while alive; `setsid` breaks the ppid chain |

## 2. Premises already shipped

| Hand-off | State | What it gives this plan |
|---|---|---|
| 1. Read-only merged view | **on `develop`**: `scripts/dispatch-tree.js` (commits `aa9ca1ce`, `ce4f8784`). Schema `schema_version:1`; it joins the subagent tree, the rail tree and session→rail, flags unconnected branches with `untracked:true` / `untracked_reason`, and marks loop-back rails `trace_end:"loop_back_not_recorded"` | the data model for the renderer (§5) |
| 2. Manifest `session_id` | **on `develop`** (merge `544b654b`, commit `3e5b923a`). `dispatch-hetero.sh`, `dispatch-review.sh`, `dispatch-author.sh` write `"session_id"` = the launching `CLAUDE_CODE_SESSION_ID`, `null` when unset; `AUTOPILOT_SESSION_ID` is deliberately not read. Readers tolerate old manifests (`null`) | session→rail without the 24 h marker |
| 3. Loop-back identity | **on `develop`** (same merge; commits `329e186b`, and `69c4d239` for the detached `dispatch-hetero` path, which re-serializes the minted id into the detached shell). dispatch-author (cc-shim, claude-native), dispatch-review (cc-shim, claude-native) and dispatch-hetero (cc-shim) mint a uuid, pass it as `claude --session-id`, record it as manifest `child_session_id` (`null` for runners with no claude child), and put `AUTOPILOT_PARENT_SESSION_ID=$CLAUDE_CODE_SESSION_ID` on the claude command line (not exported when unset). `ensurePlainMarker`, the SessionStart marker writer, records it as `parent_session_id`; `session-mode set` never does; a parent equal to the session itself is ignored. Test: `hooks/tests/child-session-identity.test.sh` | an exact rail→child-session edge, written by the rail before the child starts |

Still not shipped: hand-off 4 (fleet) and hand-off 5 (which subagent started a rail). Their design is in §4.

## 3. The no-guessing rule (answers G1 R7)

An edge goes into the tree only when **both ends name each other**. Anything else is shown, in a visibly separate place, as untracked. Never attach a record to the nearest plausible node.

| Edge | Exact when | Otherwise |
|---|---|---|
| session → rail | `manifest.session_id == session` | marker `root_run_id` join (existing fallback): drawn with `joined_by: marker`, and `expired` flagged, not treated as exact |
| rail → child claude session | `manifest.child_session_id == X` **and** marker `X.parent_session_id == manifest.session_id` (two-sided) | the child session is listed under 「來歷不明」, never under the rail |
| subagent → subagent | `parentAgentId` resolves to an existing record | `legacy_record_no_parent_info`, `missing_parentAgentId`, `parent_agent_not_found` are all untracked (the script already names them; the old-record case must be in the untracked list, which the live-pane plan's §7.1 omitted) |
| subagent → rail | a PreToolUse stamp (§4 step 5) names the agent | until the stamp exists: the rail sits in the 「session 底下、起點不明」 bucket, **not** as a child of the session root |
| rail → rail | `parent_run_id` names a manifest in the same session | `parent_run_other_session`, `parent_run_not_found`, `cycle` (already in the script) |
| fleet | never an edge: `parent_run_id` carried in a message body is stored as **remote-reported telemetry**, shown on the row as `遠端回報` and never joined | n/a |

Two consequences for the renderer. `dispatch-tree.js` may keep attaching an unconnected node under the nearest known node as a place to *store* it, but the renderer groups every `untracked:true` node into one 「來歷不明」 group per session and never draws it as an ordinary child. And a concurrent case (two rails from one session and one `CLAUDE_CONFIG_DIR`) cannot be confused, because the edge is a minted uuid, not a time window or a config dir.

## 4. Remaining hand-offs, each with its own acceptance command (answers G1 R6)

Every hand-off is a separate commit with a compatibility rule, a rollback rule and a command that exercises **that** hand-off. `bash mods/live/run-tests.sh` covers only the renderer; it is not an acceptance for any producer commit.

| Step | Change | Compatibility and rollback | Acceptance (must be red before, green after; ADR-0001: re-derived, not attested) |
|---|---|---|---|
| 2 (shipped) | manifest `session_id` | readers accept manifests without it; revert = remove the field | `bash hooks/tests/manifest-session-id.test.sh` (1 pass / 9 fail on the old rails, 10/10 on the new) |
| 3 (shipped) | `child_session_id`, `--session-id`, `AUTOPILOT_PARENT_SESSION_ID`, marker `parent_session_id` | the variable is not exported when `CLAUDE_CODE_SESSION_ID` is unset; markers without the key stay valid | `bash hooks/tests/child-session-identity.test.sh` (27 red on the old rails; 44 green on `develop`, detached hetero case included) |
| 3b | marker write-target guard (§6) | additive refusal; a refused write exits non-zero and leaves the file untouched | new `hooks/tests/session-marker-write-target.test.sh`; negative control: the guard removed, the parent's marker is overwritten (red) |
| 3c | cc-shim keeps the child transcript: copy it out before deleting the scratch HOME | only affects the post-run copy; if the copy fails the run result is unchanged and the manifest records `child_transcript: null` | a fake cc-shim run in a temp dir; assert the transcript file exists after the run and the scratch HOME is gone; negative control: skip the copy, assert red |
| 4 | fleet: the dispatch body may carry `root_run_id` / `parent_run_id`; the receiver stores them as `remote_parent_run_id` (telemetry) via `session-mode.js --root-run-id` for the root only | old senders send nothing; a missing field is normal | `bash hooks/tests/fleet-parent-telemetry.test.sh` (new): body with and without the fields, a foreign-scope id; asserts the value is stored under the telemetry key and **never** under `parent_run_id` |
| 5 | which subagent started a rail: a PreToolUse hook stamps `agent_id` onto the Bash environment of rail commands | opt-in knob first; no stamp = bucket 「起點不明」 (§3). Hook must be added to hook-classes and the inventory | new `hooks/tests/rail-agent-stamp.test.sh`: stamp present, stamp absent, two concurrent subagents; asserts the right `agent_id` in each manifest |
| R | renderer (read-only) | reads only fields proven by the steps above; unknown fields are ignored | `node scripts/dispatch-tree.js --session <fixture> --json` against fixtures, then `bash mods/live/run-tests.sh` |

Order and where each unknown is decided: **D0 probe → 3b → 3c → 4 → 5 → R**. A writer never lands before the probe that says where and under which session identity it writes. Steps 2 and 3 are not re-opened by this plan unless the D0 probe falsifies them.

Renderer fixtures (R): the loop-back (`claude -p` started by a rail), an untracked process, a concurrent pair (two rails, one session, one config dir), a missing parent, a duplicate match (two manifests claiming one `child_session_id`), a foreign-scope parent, and an old subagent record without `parentAgentId`.

Display follows the live-pane plan §2.4: one line per top-level piece of work, children folded behind `▸ N 個子工作`; live branches open by default, finished ones closed; depth by indent. Because that grid has no tree line, the renderer adds one bounded `tree` component (kind `tree`, depth capped at 4, deeper nodes folded into `▸ 還有 N 層`) to the live-pane component catalog **in this plan's own phase**, with its own invariants; the live-pane plan does not define it. Review facts (seat verdicts) are never copied into tree rows: a tree row carries identity and lifetime only, and review verdicts stay owned by 審查 (live-pane plan §2.6).

**Cannot be traced, by nature** — shown, not hidden: a process started outside any rail after it exits; the far side of a fleet dispatch; cc-shim children from before step 3. The tree ends those branches with one note line (`◦ 之後的工作沒有紀錄`) so a missing branch never reads as "nothing happened".

## 5. Data contract with `scripts/dispatch-tree.js`

The renderer consumes `--json` schema 1 as shipped. Additions needed by §3 are additive (schema stays 1): `untracked_bucket` (`"unknown_origin" | "origin_subagent_unknown"`) on a node, `edge: "exact" | "marker" | "none"`, and `remote_parent_run_id` on rails. A renderer that sees a node without `edge` treats it as `none`.

## 6. Session marker write target (answers G1 R7 second finding and the minimax R7)

Problem: `getSessionId()` (`scripts/session-mode.js`, around line 170) takes `AUTOPILOT_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`. A child inherits `CLAUDE_CODE_SESSION_ID`; a runner that is not Claude never replaces it. If such a child calls `session-mode.js`, the marker it writes lands in the **parent's** file. `AUTOPILOT_PARENT_SESSION_ID` is lineage metadata and does not change the write target.

Design: separate write identity from lineage.

1. **The write target comes only from an authoritative own id.** For SessionStart, that is the `session_id` in the hook event payload. The environment is never a source for a marker *write* by a process that has `AUTOPILOT_PARENT_SESSION_ID` set.
2. **Fail closed on a parent-equal id.** If `AUTOPILOT_PARENT_SESSION_ID` is set and the resolved write id equals it, `session-mode.js` refuses the write (exit non-zero, one stderr line, file untouched). This catches exactly the inherited-`CLAUDE_CODE_SESSION_ID` case without unsetting that variable, which campaign intake still needs.
3. **Every rail exports the parent id to every child**, not only to claude children, so rule 2 can see it in a non-claude runner. (Step 3 today exports it only on the claude command line; step 3b widens it. The widening is checked by the same new test.)
4. **Inherited ids are read-only fields.** A child may read the parent's id to record `parent_session_id`; it never writes under it.
5. Negative control: a test where a non-claude child inherits `CLAUDE_CODE_SESSION_ID=P` and `AUTOPILOT_PARENT_SESSION_ID=P`, calls `session-mode.js set`, and the marker file `P.json` must keep its bytes. With rule 2 removed this test is red.
6. Also named: `scripts/probe-engine-capability.sh:456,462` starts `claude -p` without clearing `AUTOPILOT_SESSION_ID`. It is not a dispatch rail and the marker hook keys on its own id, so no parent marker is overwritten today; step 3b brings it under the same rule so it cannot become one.

Until step 3b lands, the renderer treats any child whose marker resolves to a non-own session as untracked (`◦ 之後的工作沒有紀錄`).

## 7. Unknowns (each is checked in the named step)

- **D0 probe, before any writer.** Does a `claude -p` child run the SessionStart hook, and with which `session_id` (own, or inherited)? Decides whether rule 1 of §6 has a payload to use. Steps 2 and 3 as shipped assume own id; the probe confirms with a real run.
- **Owner's concern, an intermediate harness (new).** A shell can dispatch another harness (a non-Claude agent), and that harness can dispatch Claude Code again. With a non-Claude process in the middle, how does the identity travel? Facts to measure, not assume: (a) does the middle harness pass its environment on, or does it clean it (`lib/cleanroom-launch.sh` and the harness's own sandbox are the suspects)? (b) if `AUTOPILOT_PARENT_SESSION_ID` and `AUTOPILOT_PARENT_RUN_ID` arrive, the grandchild's marker names the outer session, which is a skip-level edge: it is shown as exact-to-session but with the middle rail missing (untracked step between), never re-parented onto the middle rail; (c) if the environment is lost, the grandchild has no `parent_session_id` and is untracked. The design already degrades to (c); the probe measures how often (a) is lost.
- Children in a non-git working directory (BL-0142): `hooks/runs-watch-autostart.js` returns before `ensurePlainMarker` when the cwd is not a git repo, so such a child writes no marker and the two-sided check in §3 cannot pass. D0 measures which rails start a claude child outside a git repo; the renderer shows those children as untracked until a marker exists, and never accepts the one-sided `child_session_id` as exact.
- Nested rail manifests: every local manifest observed is depth 0, so the nested path is read from code only. D0 runs one two-level rail to see a manifest with `depth` 1.
- How long a transcript outside `~/.claude/projects` survives (cc-shim, dedicated `CLAUDE_CONFIG_DIR`), for step 3c.
- Fleet depth: how many hops the far side can report; one is all the local machine can show.

## 8. Not in this plan

No trust machinery (ADR-0001): no signed edges, no hash-chained lineage, no witness receipts. The two-sided agreement in §3 is verification by independent re-derivation from records that already exist, not a claim that has to be believed. No version bump (owner hold at 3.0.0). The live-pane plan's component set, state vocabulary and tab ownership are not changed here beyond the one `tree` component above.

## 9. Disposition of the G1 findings that concern this work

| G1 finding | Disposition | Where |
|---|---|---|
| sol R1 (scope/diagnosis) | adopted by splitting: the work has its own diagnosis and scope | §1, status line |
| sol R6 (not shippable, acceptance does not cover producers) | adopted: probe first, per-step acceptance commands, renderer depends only on proven fields | §4 |
| sol R7a (guessed parent edges, old records, fleet storage) | adopted | §3, §4 step 4, §4 fixtures |
| sol R7b (marker write target) | adopted | §6 |
| minimax R7 (getSessionId inheritance not on the unverified list) | adopted | §6, §7 |
| owner's added concern (harness between Claude and Claude) | recorded as an unknown with a measurement plan | §7 |
