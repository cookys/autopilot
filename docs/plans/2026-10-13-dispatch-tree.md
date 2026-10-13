# Dispatch tree — follow every piece of work from the session, without guessing a parent

Status: **draft, in plan review, G1 revision** (2026-10-13; `lane/w-dispatch-rail` merged as `544b654b`). Plan only; no product code changed.
Split out of [`2026-10-13-live-pane-design-system.md`](2026-10-13-live-pane-design-system.md) (its former P6 and §7.1) by owner ruling 2026-10-13: the dispatch tree is scheduled as its own plan, after the related branches merge. The live-pane plan keeps one pointer line and no dependency on this plan.
Scope: run manifests, the dispatch rails' child launch, the session marker, the subagent records, and one read-only renderer in the 派工 tab (`mods/live`). It touches producers, so it is not a pane-only change.

Owner ask (2026-10-13): when dispatched work dispatches again — including a shell that starts a harness that starts Claude Code again — can every piece be followed from the session? Evaluated before planning (evaluation notes: session scratchpad `nested-dispatch-tracking-eval.md`; facts below carry their own pointers).

## 1. Diagnosis (why this is its own plan)

The G1 review of the live-pane plan (sol_deep R1) was right that this work has no home there: the live-pane diagnosis is 18 visual defects, none about lineage. The defect here is a different one and is diagnosed below, **as `develop` stands after the `lane/w-dispatch-rail` merge** (the rail side of the loop-back link is already shipped, §2; what is listed here is what is still missing).

| # | What is missing on `develop` | Evidence |
|---|---|---|
| D1 | The 派工 tab reads none of the subagent records; only cost tracking does (`hooks/cost-tracker-lib.js` `readAgentTree`, `scripts/cost-digest.js --tree`) | `mods/live/model.ts` dispatch builders read manifests only |
| D2 | The rail→child link is **one-sided** for every author and review child. The rail writes manifest `child_session_id` and passes `--session-id` (§2), but the child end — the child's own marker naming `parent_session_id` — is not written on these launch shapes: **author/review claude-native** start `claude -p --setting-sources project` in a fresh `mktemp -d` (not a git repo), and `runs-watch-autostart.js` returns at "not a git repo" before `ensurePlainMarker` even if the plugin's SessionStart hook loads; whether user-enabled plugin hooks load at all under `--setting-sources project` is unmeasured. **author/review cc-shim** do the same and also set `HOME=<scratch dir>`, so the plugin install and the default marker dir (`~/.autopilot/session-mode`) both resolve under a directory that is `rm -rf`'d after the run. Only **hetero cc-shim** starts in the hand worktree (git), without `--setting-sources` or a HOME redirect, so the plugin path can write the child marker there; not yet observed in a real run. Tracked as BL-0142 | `dispatch-author.sh:1199-1223`, `dispatch-review.sh:1537-1570`, `dispatch-hetero.sh:3737-3738`, `hooks/runs-watch-autostart.js:288-297` |
| D3 | cc-shim deletes its scratch HOME, transcript included, so the child's work cannot be read after the fact | `dispatch-review.sh:1544`, `dispatch-author.sh:1206` |
| D4 | A fleet dispatch carries one request/reply pair and no root, parent or depth; the far side's records are on the far machine. The sender surface owned here is only text: the fleet MCP `dispatch` tool takes `to` and `task` (a string) and nothing else; `fleet` itself is an external binary | fleet message shape; `mcp__fleet__dispatch` schema |
| D5 | Which subagent started a rail is not recorded: a subagent's Bash gets no agent id | measured in this revision: a subagent's Bash environment carries the session's `CLAUDE_CODE_SESSION_ID` and no agent id variable; `hooks/awaiting-owner.js:76` shows the PreToolUse payload does carry `agent_id` |
| D6 | A process started with `nohup` / `setsid` / `&` and no rail leaves no record at all | `/proc` only while alive; `setsid` breaks the ppid chain |
| D7 | **Marker write target.** Every marker writer except the SessionStart one keys its file on `getSessionId()` (`AUTOPILOT_SESSION_ID` → `CLAUDE_CODE_SESSION_ID` → `CLAUDE_SESSION_ID` → `CODEX_THREAD_ID` → cwd). A child that inherited the parent's id — a non-Claude runner keeps `CLAUDE_CODE_SESSION_ID`, any child keeps an exported `AUTOPILOT_SESSION_ID` — writes into the **parent's** marker. Writers: `session-mode.js` `set` (plain, `--level`, `--size` init), `clear`, `bind-campaign-root` (also called by the engine), and `stage-advance.js --resume-from` | `scripts/session-mode.js:175-185`, `:535-575`, `:663-695`, `:822-888`, `:909-1030`, `:1106-1134`; `scripts/stage-advance.js:351-358`; `src/engine/autopilot-engine.js:9725-9731` |
| D8 | **Intermediate harness.** The owned non-Claude harness, `dispatch-foreman.sh`, passes an env allowlist (`PATH HOME TERM LANG TMPDIR XDG_* LC_* KIMI_* AUTOPILOT_*`, minus `AUTOPILOT_SESSION_ID`) and adds `AUTOPILOT_DISPATCH_DEPTH=1 AUTOPILOT_PARENT_RUN_ID=<run>`. `CLAUDE_CODE_SESSION_ID` is dropped by construction, so a rail under a foreman writes `session_id: null` and joins only through `parent_run_id`, and its claude grandchild gets no `AUTOPILOT_PARENT_SESSION_ID`. Third-party harnesses are unmeasured | `scripts/dispatch-foreman.sh:339-361` |
| D9 | **The merged view draws non-exact joins as ordinary edges.** `dispatch-tree.js` attaches a rail joined through the marker `root_run_id` (expired markers included) under the session with `untracked:false`, pushes every `untracked:true` node under the nearest parent, and does not read `child_session_id` at all, so a duplicate claim is never detected. Its tests pin the marker join as an ordinary child | `scripts/dispatch-tree.js:168-224`; `scripts/dispatch-tree.test.js:85-107`, `:141-153` |

Every step in §4 traces to these: D0 → all (gate); 3a → D2; 3b → D7; 3c → D3; 4 → D4; 5 → D5; R → D1, D9. D6 and the third-party part of D8 get no producer step: they are shown as "cannot be traced" (§4) and measured in D0 (§7).

## 2. Premises already shipped

| Hand-off | State | What it gives this plan |
|---|---|---|
| 1. Read-only merged view | **on `develop`**: `scripts/dispatch-tree.js` (commits `aa9ca1ce`, `ce4f8784`). Schema `schema_version:1`; it joins the subagent tree, the rail tree and session→rail, flags unconnected branches with `untracked:true` / `untracked_reason`, and marks loop-back rails `trace_end:"loop_back_not_recorded"` | the data model for the renderer (§5) |
| 2. Manifest `session_id` | **on `develop`** (merge `544b654b`, commit `3e5b923a`). `dispatch-hetero.sh`, `dispatch-review.sh`, `dispatch-author.sh` write `"session_id"` = the launching `CLAUDE_CODE_SESSION_ID`, `null` when unset; `AUTOPILOT_SESSION_ID` is deliberately not read. Readers tolerate old manifests (`null`) | session→rail without the 24 h marker |
| 3. Loop-back identity | **on `develop`** (same merge; commits `329e186b`, and `69c4d239` for the detached `dispatch-hetero` path, which re-serializes the minted id into the detached shell). dispatch-author (cc-shim, claude-native), dispatch-review (cc-shim, claude-native) and dispatch-hetero (cc-shim) mint a uuid, pass it as `claude --session-id`, record it as manifest `child_session_id` (`null` for runners with no claude child), and put `AUTOPILOT_PARENT_SESSION_ID=$CLAUDE_CODE_SESSION_ID` on the claude command line (not exported when unset). `ensurePlainMarker`, the SessionStart marker writer, records it as `parent_session_id`; `session-mode set` never does; a parent equal to the session itself is ignored. Test: `hooks/tests/child-session-identity.test.sh` | **the rail end only**: a one-sided pointer (`child_session_id`) written by the rail before the child starts. It becomes an exact edge only where the child's own marker carries `parent_session_id` (§3). That is plausible for hetero cc-shim (git worktree cwd, plugin loaded) and does not happen today for the four author/review shapes (D2), until step 3a. The shipped test uses a stub `claude` that never runs SessionStart and then calls `ensurePlainMarker` directly, so it proves the rail side and the writer function, not the production edge |

Still not shipped: the child end for author/review (step 3a), hand-off 4 (fleet) and hand-off 5 (which subagent started a rail). Their design is in §4.

## 3. The no-guessing rule (answers G1 R7)

An edge goes into the tree only when **both ends name each other**. Anything else is shown, in a visibly separate place, as untracked. Never attach a record to the nearest plausible node. Two general rules make the table total: **a null or absent id never matches anything** (`null == null` is not an edge), and **a predicate that more than one record satisfies is not exact** (every candidate goes untracked).

Membership and placement are separate. Membership says a rail belongs to this session's tree at all; placement says under which node it hangs. Every record that fails its placement predicate goes into one of two untracked groups per session (§5): **「來歷不明」** (`untracked_bucket: "unknown_origin"`) or **「session 底下、起點不明」** (`"origin_subagent_unknown"`).

| Edge | Exact when | Otherwise (`untracked_reason`, bucket) |
|---|---|---|
| session → rail (membership) | `manifest.session_id` is non-null and equals the session | marker `root_run_id` / `campaign_roots` join: the rail is shown, but **only** in 「來歷不明」 with `joined_by_marker` (or `joined_by_expired_marker`); never an ordinary child. A marker root is a lineage label the marker holder chose, not a record the rail made about this session |
| session → rail (placement at depth 0) | membership exact, no `parent_run_id`, and a stamp (step 5) of `session` | no stamp: 「session 底下、起點不明」 (`origin_unstamped`); a rail with `depth ≥ 1` and no `parent_run_id`: 「來歷不明」 (`parent_run_missing_at_depth`) |
| rail → rail | child `parent_run_id` names manifest P, P is placed in this tree, and child `session_id` is null or equals P's | `parent_run_not_found`, `parent_run_other_session`, `cycle` (already in the script) → 「來歷不明」 |
| rail → child claude session X | **exactly one** manifest in the runs dir has `child_session_id == X`, **and** marker `X.json` exists with non-null `parent_session_id == that manifest's session_id`, **and** `X ≠ manifest.session_id` | zero markers: `child_marker_absent`; parent mismatch: `child_parent_mismatch`; two or more claimant manifests: `duplicate_child_claim` on X, and X is drawn under none of the claimants. All → 「來歷不明」 |
| subagent → subagent | `parentAgentId` resolves to an existing record | `legacy_record_no_parent_info`, `missing_parentAgentId`, `parent_agent_not_found`, `cycle` → 「來歷不明」 (the old-record case was omitted by the live-pane plan's §7.1) |
| subagent → rail | manifest `origin_agent_id` (step 5) names an agent whose record exists in the same session | stamp absent: 「session 底下、起點不明」 (`origin_unstamped`); stamp names no record: 「來歷不明」 (`stamp_agent_not_found`) |
| fleet | never an edge: an id carried in a message is stored as **remote-reported telemetry** (`remote_parent_run_id`), shown on the row as `遠端回報` and never joined | n/a |

**No skip-level edge.** With a non-Claude harness between two Claude sessions (D8), the nested rails hang only by rail → rail, and a claude grandchild hangs only by its own rail → child predicate. If that predicate fails, the grandchild is untracked (`child_marker_absent`, with the note `◦ 中間經過非 Claude 的工作，之後沒有紀錄` when the nearest placed rail runs a non-Claude runner); it is never attached to an outer rail or to the session. A skip-level edge would need a record at the grandchild naming the outer rail and a record at the outer rail naming the grandchild; neither exists, so none is drawn.

Consequences for `dispatch-tree.js` and the renderer: the script itself (step R), not a renderer post-process, moves every untracked node out of its parent into its session's group and sets `untracked_bucket`; the renderer draws the groups distinctly and never as ordinary children. A concurrent case (two rails from one session and one `CLAUDE_CONFIG_DIR`) cannot be confused, because the edge is a minted uuid claimed by exactly one manifest, not a time window or a config dir.

## 4. Remaining hand-offs, each with its own acceptance command (answers G1 R6)

Every hand-off is a separate commit with a compatibility rule, a rollback rule and a command that exercises **that** hand-off. `bash mods/live/run-tests.sh` covers only the renderer; it is not an acceptance for any producer commit.

Acceptance means red before, green after, re-derived by running the command (ADR-0001), never taken from an implementer's report.

### Order (honest version)

Steps 2 and 3 are **already on `develop`**; they were written before any probe. D0 is therefore two things: a **verification gate over the shipped writers** (§7 rows a, c, e, f) and the **gate in front of every new writer** (3a, 3b, 4, 5). Order: **D0 → 3a → 3b → 3c → 4 → 5 → R**. No new writer lands before the D0 rows that decide where and under which identity it writes are recorded (§7 "Blocks" column). D0 may run before or after plan approval; step 3a does not start until its rows are in.

**Re-open protocol for the shipped steps.** If a D0 row falsifies step 2 or step 3: (1) the matching suite (`hooks/tests/manifest-session-id.test.sh` or `hooks/tests/child-session-identity.test.sh`) is changed first to assert the corrected behaviour and shown red on `develop`; (2) the writer is fixed in its own commit, suite green; (3) §2's row is restated in that same commit; (4) step R's fixtures for that edge are re-derived and R is re-accepted only after (2) is green.

### Shipped

| Step | Change | Acceptance |
|---|---|---|
| 2 | manifest `session_id` | `bash hooks/tests/manifest-session-id.test.sh` (1 pass / 9 fail on the old rails, 10/10 on the new) |
| 3 | `child_session_id`, `--session-id`, `AUTOPILOT_PARENT_SESSION_ID`, marker `parent_session_id` (rail end; see §2 for what it does not prove) | `bash hooks/tests/child-session-identity.test.sh` (27 red on the old rails; 44 green on `develop`, detached hetero case included) |

### Step D0 — measurement gate (all rows in §7)

- **Change**: none to product code. One probe script, `d0-probe.sh` in this plan's evidence directory (created by this step, `<evidence>` below), runs each §7 row against the real `claude` CLI and the real rails, and writes `d0-result.json` with one entry per row: `{row, status: "pass"|"bad"|"not_run", evidence}` (raw payload or env dump, never a summary).
- **Acceptance**: `bash <evidence>/d0-probe.sh --out <evidence>/d0-result.json` exits 0 and every row the "Blocks" column needs is `pass` or `bad`. Negative control: `--omit-sentinel` runs row a with the sentinel not installed and the plugin path switched off (`AUTOPILOT_RUNS_WATCH_AUTOSTART=0`), and must report row a as `bad`. A `not_run` row (for example a cc-shim shape with no endpoint configured) is treated as `bad` for design purposes. It is not a `hooks/tests` suite because it needs a live, authenticated `claude`; the suite stays offline.
- **Rollback**: nothing to roll back; the evidence directory is plan evidence.

### Step 3a — child end of the rail→child link for author and review (D2, BL-0142)

- **Change**: the four author/review claude launches install a SessionStart hook the child loads regardless of user plugins: `--settings '<json>'` with `hooks.SessionStart` → `node <abs plugin root>/scripts/session-mode.js ensure-child`, a new subcommand that reads the hook payload on stdin and writes a plain marker for **`payload.session_id` only**, with `parent_session_id` from `AUTOPILOT_PARENT_SESSION_ID`, `repo_root`/scope null. The rails also export `AUTOPILOT_SESSION_MODE_DIR=<the launching session's resolved marker dir>` so cc-shim's `HOME=<scratch>` cannot relocate the marker into the deleted directory. If D0 row b shows `--settings` hooks are dropped under `--setting-sources project`, the rail writes `<scratch cwd>/.claude/settings.json` (a project source, which those flags do load) instead. The hook reads only its payload, so the untrusted prompt or diff cannot reach it. `runs-watch-autostart.js` and its git-only watcher rule are unchanged; hetero keeps the plugin path (D0 row c).
- **Compatibility**: a child whose plugin hook also ran gets `kept` (same no-overwrite rule as `ensurePlainMarker`); a child that fires no SessionStart writes nothing and is shown as `child_marker_absent`.
- **Rollback**: revert the commit. Children go back to one-sided pointers (shown untracked); markers already written are ordinary plain markers and expire on their TTL. No data to migrate.
- **Acceptance**: new `bash hooks/tests/child-marker-sessionstart.test.sh`. A stub `claude` that executes the SessionStart hook command it was given (from `--settings` or `<cwd>/.claude/settings.json`) with payload `{hook_event_name:"SessionStart", session_id:<its --session-id>, cwd}`; for each of author-native, author-ccshim, review-native, review-ccshim, with parent `P` set: assert `$AUTOPILOT_SESSION_MODE_DIR/<minted id>.json` exists after the run, its `parent_session_id == P`, its `session_id == manifest child_session_id`, the scratch HOME is gone, and `P.json` is byte-identical. Red on `develop` (no marker). Negative control: the rail run with the hook flag removed → no marker (red). Live: after 3a lands, D0 rows a and b are re-run against the real CLI through each shape and recorded; a shape that stays `bad` stays untracked in the tree.

### Step 3b — marker write-target resolver (D7, §6)

- **Change**: one resolver in `session-mode.js`, used by every writer in the §6 table; rails export `AUTOPILOT_PARENT_SESSION_ID` to **every** child runner and unset `AUTOPILOT_SESSION_ID` for it; `probe-engine-capability.sh` does the same for its `claude -p`.
- **Compatibility**: with `AUTOPILOT_PARENT_SESSION_ID` unset the resolver returns exactly today's `getSessionId()` result (pinned by the existing session-mode suites). A refused write exits 3 with one stderr line naming the rejected source and leaves every file untouched. Rule 3 also changes what children receive (no `AUTOPILOT_SESSION_ID`), so the consumers of that variable that can run below a rail (engine session binding, `src/engine/profile-runtime.js:588`; hooks inside a hand; managed-campaign intake) are enumerated before the commit and each is pinned in case (e).
- **Rollback**: revert the commit; no stored data changes shape.
- **Acceptance**: new `bash hooks/tests/session-marker-write-target.test.sh`, all cases red on `develop`, green after:
  (a) **SessionStart path through the real hook**: `node hooks/runs-watch-autostart.js` fed a SessionStart payload `{session_id:P, cwd:<git sandbox>}` with `AUTOPILOT_PARENT_SESSION_ID=P` and a pre-seeded **expired** `P.json` (so the unguarded `ensurePlainMarker` would replace it): `P.json` byte-identical. Same through `session-mode.js ensure-child`.
  (b) non-Claude child: `CLAUDE_CODE_SESSION_ID=P AUTOPILOT_PARENT_SESSION_ID=P node scripts/session-mode.js set --size S` → exit 3, `P.json` byte-identical. Same for `set --level l3`, `clear`, `bind-campaign-root`, `stage-advance.js --resume-from`.
  (c) inherited explicit binding: `AUTOPILOT_SESSION_ID=X CLAUDE_CODE_SESSION_ID=C AUTOPILOT_PARENT_SESSION_ID=P` → writes `C.json`; `X.json` byte-identical.
  (d) legitimate Claude child: `CLAUDE_CODE_SESSION_ID=C AUTOPILOT_PARENT_SESSION_ID=P` → `C.json` written.
  (e) rails: a stub non-Claude runner (codex) under `dispatch-hetero.sh` and a stub `claude` under `probe-engine-capability.sh` record their env: `AUTOPILOT_PARENT_SESSION_ID == P`, `AUTOPILOT_SESSION_ID` absent.
  Negative control: the resolver call in `cmdSetPlain` replaced by `markerPath()` → case (b) red.

### Step 3c — cc-shim keeps the child transcript (D3)

- **Change**: before removing the scratch HOME, dispatch-author and dispatch-review (cc-shim) copy `<scratch HOME>/.claude/projects/*/<child_session_id>.jsonl` to `<runs dir>/<run_id>.child-transcript.jsonl` and record its path as manifest `child_transcript` (`null` when there is nothing to copy or the copy fails). The copy is the child's own record of its own id; it is not used as the child end of the rail→child edge (it does not name the parent).
- **Compatibility**: the run result and exit code never depend on the copy.
- **Rollback**: revert; copied files stay as plain files beside the manifests and can be deleted by hand.
- **Acceptance**: new `bash hooks/tests/ccshim-child-transcript.test.sh`: a stub `claude` writes `$HOME/.claude/projects/x/<its --session-id>.jsonl` with known bytes; after `dispatch-author.sh --runner cc-shim` and `dispatch-review.sh --runner cc-shim`, assert manifest `child_transcript` names an existing file with the same bytes and the scratch HOME is gone; a stub that writes nothing → `child_transcript: null` and the same run status as without the change. Red on `develop` (no key). Negative control: copy line removed → first case red.

### Step 4 — fleet parent as remote-reported telemetry (D4)

- **Sender** (owned): new `scripts/fleet-lineage.js header` prints one line, `autopilot-lineage: root_run_id=<id> parent_run_id=<id> project_key=<key>`, from the sending session's current lineage; the agent-call skill puts it as the first line of the `task` text (the only field the fleet `dispatch` tool has).
- **Parser** (owned): `scripts/fleet-lineage.js parse --message-file <f>` validates the line (ids `[A-Za-z0-9._-]{1,128}`; `project_key` must equal the receiver's own, else `foreign_scope`) and prints `AUTOPILOT_REMOTE_PARENT_RUN_ID=<parent_run_id>` or nothing.
- **Record** (owned): the rails copy `AUTOPILOT_REMOTE_PARENT_RUN_ID` into manifest `remote_parent_run_id` and do not pass it on to nested rails. Nothing in this path writes the marker, the marker `root_run_id`, or manifest `parent_run_id` / `root_run_id`. The receiving session is an LLM relaying the value, which is exactly why it stays telemetry and a missing value is normal.
- **Compatibility**: old senders send no line; old receivers ignore it.
- **Rollback**: revert; manifests carrying the extra key stay readable (unknown keys are ignored).
- **Acceptance**: new `bash hooks/tests/fleet-parent-telemetry.test.sh`, the full path: header → message file → parse → export → `dispatch-hetero.sh` with a stub runner. Asserts: (1) `remote_parent_run_id ==` the sent parent, and manifest `parent_run_id` / `root_run_id` and the marker file bytes are identical to a run without the line; (2) no line → key null; (3) malformed id → parse exit 2, nothing exported, key null; (4) foreign `project_key` → `foreign_scope`, key null; (5) nested rail under the stamped rail → key null. Red on `develop` (script absent).

### Step 5 — which subagent started a rail (D5)

- **Change**: new hook `hooks/rail-agent-stamp.js`, registered **directly** in `hooks/hooks.json` under PreToolUse matcher `Bash`, not through `opt-in-multiplexer.js` (the multiplexer forwards only `additionalContext` and `permissionDecision`, `hooks/opt-in-multiplexer.js:153-176`; teaching it to merge input rewrites from several children would need a conflict rule nobody owns). The opt-in knob is read inside the hook; off → exit 0, no output. On, and only when the command invokes a dispatch rail script, it returns `hookSpecificOutput.updatedInput` = the original input with the command prefixed `export AUTOPILOT_ORIGIN_AGENT_ID=<v>; `, where `<v>` is the payload `agent_id` if it matches `[A-Za-z0-9_-]{1,64}` (no quoting needed; anything else → no stamp) or the literal `session` when the payload has no `agent_id` (a depth-0 Bash). It **never returns `permissionDecision`**: the hooks reference (code.claude.com/docs/en/hooks, PreToolUse decision control) says `allow` skips the permission prompt and that permission rules are evaluated against the returned input, so an auto-approving stamp would widen what runs unprompted. Rails copy the value into manifest `origin_agent_id` and unset it for their own children (a nested rail is placed by `parent_run_id`).
- **Viability is a D0 question** (§7 rows g, h, i): `updatedInput` without a decision is not documented. If any of g/h/i is bad, step 5 is **not shipped**; rails stay in 「session 底下、起點不明」 and D5 moves to "cannot be traced". There is no sidecar fallback that matches on command text or time, because that would be a guess (§3).
- **Compatibility**: stamp absent → `origin_unstamped` bucket (§3). Registered in `profiles/hook-classes.json` and the hook inventory (`node scripts/check-hook-inventory.js` green).
- **Rollback**: remove the `hooks.json` entry and the hook (revert); manifests keep the key, which readers ignore.
- **Acceptance**: new `bash hooks/tests/rail-agent-stamp.test.sh`, driven from `hooks/hooks.json` rather than the hook file: it reads every PreToolUse entry whose matcher hits `Bash`, runs each command with the payload, asserts only the stamp hook returns `updatedInput` and none returns a `permissionDecision` because of the stamp, then **executes the resulting command** with a stub runner and reads the manifest. Cases: `agent_id` A1 → `origin_agent_id == "A1"`; no `agent_id` → `"session"`; knob off → no output, key null; `agent_id` with a quote → no stamp; non-rail command → no output; two subagents A1 and A2 running rails concurrently → each manifest carries only its own id; nested rail → key null. Red on `develop`. Live: D0 rows g–i re-run through a real subagent after the hook lands.

### Step R — merged view and renderer (D1, D9)

- **Change**: `scripts/dispatch-tree.js` applies the §3 predicates (it starts reading `child_session_id`, child markers, `origin_agent_id`, `remote_parent_run_id`), then a **hoist pass** moves every `untracked:true` node out of its parent into its session's `untracked_groups` entry and sets `untracked_bucket`; `untracked_reason` is kept. The 派工 tab renders the groups with their own glyph and never as ordinary children. Codex mirror re-synced.
- **Compatibility**: §5 (schema 2; no consumer reads schema 1 today besides its own test).
- **Rollback**: revert; the script writes nothing, so there is no stored state.
- **Acceptance**: `node --test scripts/dispatch-tree.test.js` with these fixtures and placements pinned (the existing tests at `:85-107` and `:141-153` that pin a marker join as an ordinary child are rewritten here, so they are red on `develop` against the new expectations):
  1. loop-back exact (one claimant, child marker parent == session) → child under its rail, `edge:"exact"`;
  2. loop-back with no child marker → child in 「來歷不明」 `child_marker_absent`;
  3. duplicate claim (two manifests, one `child_session_id`) → child in 「來歷不明」 `duplicate_child_claim`, under neither rail;
  4. null ids on both sides → never exact;
  5. fresh marker join → rail in 「來歷不明」 `joined_by_marker`, absent from `root.children`;
  6. expired marker join → `joined_by_expired_marker`;
  7. missing parent rail → `parent_run_not_found`; foreign-scope parent → `parent_run_other_session`;
  8. old subagent record without `parentAgentId` → `legacy_record_no_parent_info` in 「來歷不明」;
  9. unstamped depth-0 rail → 「session 底下、起點不明」; stamp `session` → under the root; stamp A1 with record → under A1; stamp A9 without record → `stamp_agent_not_found`;
  10. intermediate harness: foreman rail R1 → nested rail R2 (`session_id` null, `parent_run_id` R1) → claude child G without a marker: R2 under R1, G in 「來歷不明」, no edge from the session or R1 to G;
  11. `depth ≥ 1` rail without `parent_run_id` → `parent_run_missing_at_depth`;
  12. concurrent pair (two rails, one session, one config dir, each with its own child) → each child under its own rail.
  Negative control: hoist pass disabled → fixtures 5, 6, 7 red (node found in an ordinary `children`). Then `bash mods/live/run-tests.sh` for the tab.

Display follows the live-pane plan §2.4: one line per top-level piece of work, children folded behind `▸ N 個子工作`; live branches open by default, finished ones closed; depth by indent. Because that grid has no tree line, the renderer adds one bounded `tree` component (kind `tree`, depth capped at 4, deeper nodes folded into `▸ 還有 N 層`) to the live-pane component catalog **in this plan's own phase**, with its own invariants; the live-pane plan does not define it. Review facts (seat verdicts) are never copied into tree rows: a tree row carries identity and lifetime only, and review verdicts stay owned by 審查 (live-pane plan §2.6).

**Cannot be traced, by nature** — shown, not hidden: a process started outside any rail after it exits (D6); the far side of a fleet dispatch; cc-shim children from before step 3; rails below a third-party harness that strips the environment (§7 row d2); and, if D0 rows g–i are bad, which subagent started a rail (D5). The tree ends those branches with one note line (`◦ 之後的工作沒有紀錄`) so a missing branch never reads as "nothing happened".

## 5. Data contract with `scripts/dispatch-tree.js`

Moving untracked nodes out of `children` is not additive, so step R raises the script's own `--json` `schema_version` to **2** (the only reader of schema 1 today is `scripts/dispatch-tree.test.js`). Changes:

- `root.untracked_groups: [{ bucket: "unknown_origin" | "origin_subagent_unknown", children: [NODE] }]` — at most one entry per bucket; untracked nodes appear here and nowhere in an ordinary `children` array.
- every NODE: `edge: "exact" | "none"` (a marker join is `none`; there is no `marker` edge kind), `untracked_bucket` (null on placed nodes), `untracked_reason` extended with `joined_by_marker`, `joined_by_expired_marker`, `origin_unstamped`, `stamp_agent_not_found`, `parent_run_missing_at_depth`, `child_marker_absent`, `child_parent_mismatch`, `duplicate_child_claim`.
- new NODE kind `child_session` (id = the child session id, from `child_session_id`), with `parent_session_id` as read from its marker.
- rail NODE adds `child_session_id`, `origin_agent_id`, `remote_parent_run_id`, `child_transcript`; `joined_by` keeps its values.

A renderer that sees a node without `edge` treats it as `none`.

## 6. Session marker write target (answers G1 R7 second finding and the minimax R7)

Problem (D7): `getSessionId()` (`scripts/session-mode.js:175-182`) takes `AUTOPILOT_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`, `CLAUDE_SESSION_ID`, `CODEX_THREAD_ID`, then the cwd. A child inherits `CLAUDE_CODE_SESSION_ID`; a runner that is not Claude never replaces it; and any child inherits an exported `AUTOPILOT_SESSION_ID` (the parent's marker key, which need not equal the parent's `CLAUDE_CODE_SESSION_ID`). If such a child calls a marker writer, it writes the **parent's** file. `AUTOPILOT_PARENT_SESSION_ID` is lineage metadata and does not change the write target today.

Design: separate write identity from lineage, through **one resolver** `resolveMarkerWriteTarget({ payloadId, explicitId, env })` → `{ id, source }` in `session-mode.js`, where `source` is one of `payload`, `explicit`, `env:AUTOPILOT_SESSION_ID`, `env:CLAUDE_CODE_SESSION_ID`, `env:CLAUDE_SESSION_ID`, `env:CODEX_THREAD_ID`, `cwd`. Let `P = AUTOPILOT_PARENT_SESSION_ID`.

1. **`P` unset**: the resolver returns exactly today's `getSessionId()` chain. Nothing changes for a session that no rail started.
2. **`P` set**: accepted sources are `payload` and `explicit` (each refused if equal to `P`) and `env:CLAUDE_CODE_SESSION_ID` **only when it differs from `P`** (Claude replaces this variable in its own children, measured in the evaluation notes and re-checked by D0 row a). `env:AUTOPILOT_SESSION_ID`, `env:CLAUDE_SESSION_ID`, `env:CODEX_THREAD_ID` and `cwd` are refused, because a process with `P` set cannot tell its own value of those from an inherited one. A refusal exits 3, prints one stderr line naming the source, and leaves every file untouched.
3. **Every rail exports `P` = its own `CLAUDE_CODE_SESSION_ID` to every child runner** (not only claude children) and unsets `AUTOPILOT_SESSION_ID` for it, as `dispatch-foreman.sh` already does; this is what lets rule 2 see the inherited case in a non-Claude runner, including the runner below a Claude child (its inherited `CLAUDE_CODE_SESSION_ID` then equals the `P` its own rail exported).
4. **Inherited ids are read-only.** A child may read `P` to record `parent_session_id`; it never writes under it.

Own-id source for every writer:

| Writer | Entry point | Own id today | After step 3b |
|---|---|---|---|
| SessionStart plain marker | `hooks/runs-watch-autostart.js` → `ensurePlainMarker` | hook payload `session_id` | `payload`; refused if equal to `P` (D0 row a says whether that can happen) |
| child marker hook (step 3a) | `session-mode.js ensure-child` | — (new) | `payload` only; no env fallback at all |
| plain `set`, `set --level`, `set --size` init | `session-mode.js` `cmdSetPlain`, `cmdSet`, `cmdSetInit` | env chain → cwd | resolver, rules 1–2 |
| `clear` (deletes the file) | `session-mode.js` `cmdClear` | env chain → cwd | resolver, rules 1–2 |
| `bind-campaign-root` | `session-mode.js` `bindCampaignRoot` (CLI and `src/engine/autopilot-engine.js:9725-9731`) | env chain (cwd refused already by `hasExplicitSessionId`) | resolver, rules 1–2 |
| stage resume | `scripts/stage-advance.js:351-358` (`markerPath()`) | env chain → cwd | resolver, rules 1–2 |
| `retire --session <id>` | `session-mode.js` `cmdRetire` | explicit flag | `explicit`; refused if equal to `P` |
| probe child | `scripts/probe-engine-capability.sh:456,462` (`claude -p`) | not a writer itself; its SessionStart is payload-keyed | launched with `P` exported and `AUTOPILOT_SESSION_ID` unset (rule 3) |

Negative controls (step 3b acceptance, §4) cover both entry kinds: the SessionStart path through the real hook script with an expired parent marker pre-seeded, and the env-keyed path for each writer above, plus the rail and probe launches.

**Residual, named, not closed**: a non-Claude process started *outside any rail* from a Claude session's Bash inherits that session's ids unchanged and cannot be told apart from the session's own shell; its writes land in that session's marker. That is the D6 class (no rail, no record).

Until step 3b lands, the renderer treats any child whose marker does not satisfy §3 as untracked.

## 7. Unknowns — who measures each, how it is read, and what changes if the answer is bad

All rows are measured by step D0 (`d0-probe.sh`, §4) unless the row names another step. "Blocks" lists the steps that may not start until the row is recorded.

| Row | Unknown | Measurement | Pass | Bad result → design change | Blocks |
|---|---|---|---|---|---|
| a | Does a `claude -p --session-id <u>` child run SessionStart, with payload `session_id == u`, and is its Bash `CLAUDE_CODE_SESSION_ID == u` (not the inherited parent id)? Verifies shipped step 3 | real CLI in an opted-in git temp dir through channels independent of row b: the plugin's own SessionStart path (assert `<u>.json` appears in the marker dir, as it does for every attended session) and a `<cwd>/.claude/settings.json` sentinel that dumps its payload, plus one Bash call that dumps env. The `--settings` channel is row b's question and is not used here | marker or sentinel present, both ids `== u` | no SessionStart in `-p`, or payload id `≠ u`: no child end can exist; step 3a is dropped, every claude child is shown `child_marker_absent`, §2 row 3 is restated as a one-sided pointer under the re-open protocol (§4). Bash id inherited: §6 rule 2's `env:CLAUDE_CODE_SESSION_ID` acceptance is removed (a `P`-set process may then write only from `payload`/`explicit`) | 3a, 3b |
| b | Under the author/review flags (`--setting-sources project`, scratch cwd; cc-shim also `HOME=<scratch>`), do user-plugin hooks load; does a `--settings` hook fire; does a `<cwd>/.claude/settings.json` hook fire? | same sentinel, per shape: author-native, review-native, and the two cc-shim shapes (cc-shim needs an endpoint; `not_run` otherwise) | at least one of the two rail-installable hooks fires with payload id `== u` | neither fires: 3a is dropped for that shape and its children stay `child_marker_absent`; BL-0142 stays open with that evidence. Only plugin hooks fire: 3a uses neither, and instead relaxes `runs-watch-autostart.js` to ensure the marker (not the watcher) for a non-git cwd when `P` is set, with an explicit marker dir | 3a |
| c | Does a real `dispatch-hetero.sh --runner cc-shim` child (hand worktree, plugin loaded) write `<u>.json` with `parent_session_id == P`? Verifies shipped step 3 | one real hetero run on a scratch branch, then read the marker | marker present, parent `== P` | re-open protocol for step 3 (hetero); step 3a's rail-installed hook is extended to the hetero launch | 3a, R |
| d1 | Owned intermediate harness (`dispatch-foreman.sh`): does a nested rail carry `session_id: null`, `parent_run_id == <foreman run>`, `depth 1`? Expected from code (D8) | one foreman run whose hand is a stub hetero run; read the nested manifest | as expected | `parent_run_id` missing: fix the foreman env allowlist (one line) before R; until then those rails are `parent_run_missing_at_depth` | R |
| d2 | Third-party harnesses (codex, kimi, agy, opencode, as installed): which of `AUTOPILOT_PARENT_RUN_ID`, `AUTOPILOT_DISPATCH_DEPTH`, `CLAUDE_CODE_SESSION_ID` reach a command the harness runs? | per harness, a non-interactive run whose task is to print those variables; raw output recorded | `AUTOPILOT_*` arrive, so nested rails hang by rail → rail | all stripped: nested rails are not in the tree; the outer rail ends with `◦ 之後的工作沒有紀錄`. Partial (`CLAUDE_CODE_SESSION_ID` arrives, `AUTOPILOT_*` do not): a nested rail would claim the session at depth 0 and be misplaced, so the outer rail launches that harness with `CLAUDE_CODE_SESSION_ID` unset (the `dispatch-foreman.sh` allowlist pattern); its nested rails then have `session_id: null` and are not shown | R |
| e | Does a rail started from a session's Bash (top level and subagent) see that session's id as `CLAUDE_CODE_SESSION_ID`? Verifies shipped step 2 | env dump from a top-level Bash and a subagent Bash (the subagent case was already observed in this revision) | both equal the session id | re-open protocol for step 2 | R |
| f | Nested Claude: a rail started from a rail's claude child writes `session_id` = the child's own id, `depth 1`, `parent_run_id` = the outer run? Every local manifest observed so far is depth 0 | one real two-level run (outer hetero cc-shim, whose child starts a stub-runner rail) | as stated | `session_id` equals the outer session (child id not replaced): the rails write `session_id: null` whenever `CLAUDE_CODE_SESSION_ID == AUTOPILOT_PARENT_SESSION_ID`, so such rails are placed only by `parent_run_id` | 3b, R |
| g | Is a PreToolUse `updatedInput` applied when the hook returns no `permissionDecision`? (not documented) | real session, a subagent runs `echo A`; a test hook rewrites it to `echo B` with no decision | output is `B` | step 5 not shipped (§4) | 5 |
| h | With the rewrite, do existing permission allow rules for the rail command still match without a new prompt (rules are evaluated against the returned input)? | same session, an allow rule for the rail script; stamped invocation | no prompt | step 5 not shipped | 5 |
| i | With the other Bash PreToolUse hooks registered (multiplexer, `foreman-guard`, `cost-fuse`, `depth0-delegate-gate`), does the rewrite survive? | same session, full plugin hook set | stamped value reaches the manifest | step 5 not shipped | 5 |
| j | How long does a copied cc-shim transcript live? It sits in the runs dir (`${TMPDIR:-/tmp}/autopilot-dispatch-runs`) | measured in step 3c's live check: list the runs dir again one day after a run | file present while its manifest is | the renderer checks the file exists at read time and shows `◦ 子工作紀錄已清除` instead of a dead link | — |

Not unknowns any more: **fleet depth** is fixed by design at one hop (step 4 carries only the sender's own root and parent; deeper hops are not relayed). **Children in a non-git directory** (BL-0142) are rows a–b and step 3a.

## 8. Not in this plan

No trust machinery (ADR-0001): no signed edges, no hash-chained lineage, no witness receipts. The two-sided agreement in §3 is verification by independent re-derivation from records that already exist, not a claim that has to be believed. No version bump (owner hold on the version line). The live-pane plan's component set, state vocabulary and tab ownership are not changed here beyond the one `tree` component above.

## 9. Disposition of the G1 findings that concern this work

| G1 finding | Disposition | Where |
|---|---|---|
| sol R1 (scope/diagnosis) | adopted by splitting: the work has its own diagnosis and scope | §1, status line |
| sol R6 (not shippable, acceptance does not cover producers) | adopted: probe first, per-step acceptance commands, renderer depends only on proven fields | §4 |
| sol R7a (guessed parent edges, old records, fleet storage) | adopted | §3, §4 step 4, §4 fixtures |
| sol R7b (marker write target) | adopted | §6 |
| minimax R7 (getSessionId inheritance not on the unverified list) | adopted | §6, §7 |
| owner's added concern (harness between Claude and Claude) | recorded as an unknown with a measurement plan | §7 |

### G1 of this plan (2026-10-13; seats sol_chair and minimax_consult)

| Finding (fingerprint prefix) | Seat, rubric | Disposition | Where |
|---|---|---|---|
| `54becd7a` Diagnosis does not describe current code; 3b has no source gap | sol_chair R1, blocking | accepted: §1 rebased onto `develop` (D2 restated as the remaining one-sided child end; D7 marker write target, D8 intermediate harness, D9 view draws non-exact joins added); step→D map added | §1 |
| `1a41c6fc` marker join drawn as an ordinary edge | sol_chair R2, blocking | accepted: a marker join is membership-only and goes to 「來歷不明」 (`joined_by_marker` / `joined_by_expired_marker`); no `marker` edge kind; fixtures 5–6 pin fresh and expired | §3, §5, §4 R |
| `188483af` duplicate child claims; undefined skip-level edge | sol_chair R2, blocking | accepted: exactly-one-claimant rule and null-never-matches; skip-level wording removed, grandchild across a non-Claude harness is untracked; fixtures 3, 4, 10 | §3, §4 R |
| `c3da93e5` shipped premise overstates the exact edge for scratch-dir launches | sol_chair R3, blocking | accepted: §2 states the rail end only; step 3a installs a SessionStart hook the author/review children actually load, with an explicit marker dir; D0 rows a–c measure each launch shape with the real CLI | §2, §4 3a, §7 a–c |
| `6e325162` write-target rules lack an own-id source per writer; one negative control | sol_chair R4, blocking | accepted: one resolver with source classes; per-writer table including `clear`, `bind-campaign-root`, `stage-advance`, `retire`, the probe; controls on the SessionStart hook path (expired parent marker pre-seeded) and every env-keyed writer | §6, §4 3b |
| `56a3391e` rollback and executable acceptance missing; fleet path writes the local root | sol_chair R5, blocking | accepted: each remaining step has change / compatibility / rollback / named test with assertions and negative control; fleet path is sender → parser → manifest `remote_parent_run_id`, never the marker or `parent_run_id` | §4 |
| `5341e414` no viable PreToolUse path to change the Bash environment | sol_chair R5, blocking | accepted: direct `hooks.json` registration (not the multiplexer), `updatedInput` with no `permissionDecision`, acceptance driven from `hooks.json` and executing the rewritten command; viability rows g–i with a drop-the-step bad branch | §4 step 5, §7 g–i |
| `6fc53ca4` probe-first order impossible for shipped writers; bad outcomes undecided | sol_chair R6, blocking | accepted: order restated (D0 = gate over shipped writers + before new ones); outcome table with measurement, pass, bad-result design and blocked steps per row | §4 Order, §7 |
| `716fa4a5` script attaches untracked nodes under the nearest parent | minimax_consult R2, non-blocking | accepted: hoist pass in the script sets `untracked_bucket`; schema 2 | §4 R, §5 |
| `0edb5f52` D0 has no acceptance command | minimax_consult R5, non-blocking | accepted with a change: D0 is a live probe script with recorded rows and its own negative control, not a `hooks/tests` suite, because it needs an authenticated `claude` | §4 D0 |
| `cbf73c66` no re-open protocol for shipped steps 2 and 3 | minimax_consult R6, non-blocking | accepted: four-step re-open protocol | §4 Order |
