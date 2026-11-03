# Dispatch tree — follow every piece of work from the session, without guessing a parent

Status: **frozen** (2026-10-13) after two plan-review generations (G2 blockers ruled by the coordinator; receipts in [`evidence/2026-10-13-dispatch-tree/plan-review/`](evidence/2026-10-13-dispatch-tree/plan-review/README.md); `lane/w-dispatch-rail` merged as `544b654b`). Plan only; no product code changed.
D0 ran 2026-10-15 ([`d0-summary.md`](evidence/2026-10-13-dispatch-tree/d0-summary.md)): 3a, 3b, 3c may start; **5 is blocked** (row h bad: the stamp rewrite makes the rail command compound, so the allow rule no longer covers it); **R is blocked** (row d2 bad: the codex runner does not export `AUTOPILOT_PARENT_SESSION_ID`; kimi, agy, opencode not_run), so per §4 the plan is revised and plan-reviewed again before R.
3b merged as `92002f7f` (2026-10-15): every rail, codex included, exports `AUTOPILOT_PARENT_SESSION_ID`; D0 row d2 re-run 2026-10-15: codex path **pass** (`d0-summary.md` re-run section); R still waits on kimi, agy, opencode (not_run) and step 5 on row h. Follow-ups BL-0174 to BL-0176.
**Revision 2026-10-15, plan review frozen and step 3d merged 2026-10-15 (G1 and G2 CONDITIONAL, all blockers folded; receipts in [`plan-review-3d/`](evidence/2026-10-13-dispatch-tree/plan-review-3d/)): step 3d** (BL-0176, tmux parent leak) is added below, with D10, §6 rule 5 and §7 row l. It changes no step 5 or R conclusion; the review of this revision gates only 3d.
Split out of [`2026-10-13-live-pane-design-system.md`](2026-10-13-live-pane-design-system.md) (its former P6 and §7.1) by owner ruling 2026-10-13: the dispatch tree is scheduled as its own plan, after the related branches merge. The live-pane plan keeps one pointer line and no dependency on this plan.
Scope: run manifests, the dispatch rails' child launch, the session marker, the subagent records, and one read-only renderer in the 派工 tab (`mods/live`). It touches producers, so it is not a pane-only change.

Owner ask (2026-10-13): when dispatched work dispatches again — including a shell that starts a harness that starts Claude Code again — can every piece be followed from the session? Evaluated before planning (evaluation notes: session scratchpad `nested-dispatch-tracking-eval.md`; facts below carry their own pointers).

## 1. Diagnosis (why this is its own plan)

The live-pane diagnosis is 18 visual defects, none about lineage (live-pane G1, sol_deep R1). This diagnosis describes **`develop` after the `lane/w-dispatch-rail` merge**: the rail side of the loop-back link is shipped (§2); listed here is what is still missing.

| # | What is missing on `develop` | Evidence |
|---|---|---|
| D1 | The 派工 tab reads no subagent records; only cost tracking does | `mods/live/model.ts` (manifests only); `hooks/cost-tracker-lib.js` `readAgentTree` |
| D2 | The rail→child link is **one-sided** for author and review: the rail writes `child_session_id`, but the child writes no marker naming its parent. claude-native: `claude -p --setting-sources project` in a fresh non-git `mktemp -d`; the SessionStart hook returns at "not a git repo", and whether user plugins load under those flags is unmeasured. cc-shim: same, plus `HOME=<scratch>`, so plugin install and default marker dir sit in a directory deleted after the run. Only hetero cc-shim (hand worktree, no flag, no HOME redirect) can write the child marker. BL-0142 | `dispatch-author.sh:1199-1223`; `dispatch-review.sh:1537-1570`; `dispatch-hetero.sh:3737-3738`; `hooks/runs-watch-autostart.js:288-297` |
| D3 | cc-shim deletes its scratch HOME, transcript included | `dispatch-review.sh:1544`; `dispatch-author.sh:1206` |
| D4 | A fleet dispatch carries no root, parent or depth; the fleet `dispatch` tool has only `to` and `task` | fleet MCP `dispatch` schema |
| D5 | Which subagent started a rail is not recorded: a subagent's Bash has the session's `CLAUDE_CODE_SESSION_ID` and no agent id (measured this revision); the PreToolUse payload has `agent_id` | `hooks/awaiting-owner.js:76` |
| D6 | A process started with `nohup` / `setsid` / `&` and no rail leaves no record | `/proc` only while alive |
| D7 | **Marker write target.** Every writer except SessionStart keys its file on `getSessionId()` (`AUTOPILOT_SESSION_ID` → `CLAUDE_CODE_SESSION_ID` → `CLAUDE_SESSION_ID` → `CODEX_THREAD_ID` → cwd). A child that inherited the parent's id (a non-Claude runner keeps `CLAUDE_CODE_SESSION_ID`; any child keeps an exported `AUTOPILOT_SESSION_ID`) writes the **parent's** marker. `AUTOPILOT_PARENT_SESSION_ID` does not change the target today | `session-mode.js:175-185`, `:535-575`, `:663-695`, `:822-888`, `:909-1030`, `:1106-1134`; `stage-advance.js:351-358`; `src/engine/autopilot-engine.js:9725-9731` |
| D8 | **Intermediate harness.** `dispatch-foreman.sh` passes an env allowlist that drops `CLAUDE_CODE_SESSION_ID` and adds `AUTOPILOT_PARENT_RUN_ID`/depth, so a rail under it has `session_id: null` and its claude grandchild gets no parent id. Third-party harnesses unmeasured | `dispatch-foreman.sh:339-361` |
| D9 | **The merged view draws non-exact joins as ordinary edges**: marker-joined rails (expired included) sit under the session with `untracked:false`; untracked nodes sit under the nearest parent; `child_session_id` is never read, so duplicate claims go unseen. Tests pin the marker join | `dispatch-tree.js:168-224`; `dispatch-tree.test.js:85-107`, `:141-153` |
| D10 | **Parent record leaks to unrelated sessions.** `ensurePlainMarker` takes `parent_session_id` from `AUTOPILOT_PARENT_SESSION_ID` and refuses only id == P. A long-lived shell (tmux) started below a rail child keeps P, so a brand-new top-level session started in it gets a marker naming P as its parent. Reproduced 2026-10-15 (BL-0176). Only the provenance field is wrong: `set` fails closed and `write-target --rail` returns the new session's own id | `session-mode.js:696-713`, `:742`; `hooks/runs-watch-autostart.js:275`, `:293`; `docs/backlog/dispatch-tree-3b-follow-ups.md` |

Step → diagnosis: D0 → all (gate); 3a → D2; 3b → D7; 3c → D3; 3d → D10; 5 → D5; R → D1, D9. D4 is deferred (§4); D6 and third-party D8 have no producer step and are shown as "cannot be traced".

## 2. Premises already shipped

| Hand-off | State | What it gives this plan |
|---|---|---|
| 1. Read-only merged view | **on `develop`**: `scripts/dispatch-tree.js` (`aa9ca1ce`, `ce4f8784`), joining subagent tree, rail tree and session→rail | the base of step R |
| 2. Manifest `session_id` | **on `develop`** (`3e5b923a`): hetero, review and author write the launching `CLAUDE_CODE_SESSION_ID` (`null` when unset; `AUTOPILOT_SESSION_ID` not read) | session→rail without the 24 h marker |
| 3. Loop-back identity | **on `develop`** (`329e186b`; `69c4d239` for detached hetero): author and review (cc-shim, claude-native) and hetero (cc-shim) mint a uuid, pass `claude --session-id`, record manifest `child_session_id`, export `AUTOPILOT_PARENT_SESSION_ID` on the claude command line; `ensurePlainMarker` records it as `parent_session_id`. Test: `hooks/tests/child-session-identity.test.sh` | **the rail end only.** It is an exact edge only where the child's own marker names the parent (§3): plausible for hetero, absent for author/review until step 3a (D2). The test's stub `claude` never runs SessionStart, so it proves the rail side and the writer function, not the production edge |

## 3. The no-guessing rule (answers G1 R7)

An edge goes into the tree only when **both ends name each other**; never attach a record to the nearest plausible node. The table is total because **a null or absent id never matches** and **a predicate more than one record satisfies is not exact**. Membership (is this rail in the session's tree) and placement (under which node) are separate. Every node failing placement goes into one of two groups per session (§5): **「來歷不明」** (`unknown_origin`) or **「session 底下、起點不明」** (`origin_subagent_unknown`).

| Edge | Exact when | Otherwise (`untracked_reason`) |
|---|---|---|
| session → rail (membership) | `manifest.session_id` non-null and equal to the session | marker `root_run_id`/`campaign_roots` join: shown **only** in 「來歷不明」 as `joined_by_marker` / `joined_by_expired_marker`, never as a child (a marker root is a label the marker holder chose, not a record the rail made) |
| session → rail (placement, depth 0) | membership exact, no `parent_run_id`, stamp (step 5) `session` | no stamp → 起點不明 (`origin_unstamped`); `depth ≥ 1` without `parent_run_id` → 來歷不明 (`parent_run_missing_at_depth`) |
| rail → rail | child `parent_run_id` names manifest P placed in this tree; child `session_id` null or equal to P's | `parent_run_not_found`, `parent_run_other_session`, `cycle` |
| rail → child claude session X | **exactly one** manifest has `child_session_id == X`, marker `X.json` has non-null `parent_session_id ==` that manifest's `session_id`, and `X ≠` it | `child_marker_absent`, `child_parent_mismatch`; two or more claimants → `duplicate_child_claim`, X under none of them |
| child session X → rail B (nested Claude) | X placed exact under rail A (row above), `B.session_id == X`, `B.parent_run_id == A` | X not exact under A → `nested_via_untracked_child`; `B.session_id == A.child_session_id` but `B.parent_run_id ≠ A` → `nested_parent_mismatch` |
| session → subagent (top level) | meta in the session's own `subagents/` dir (written there by Claude Code), no `parentAgentId`, `spawnDepth == 1`, and **exactly one** tool result in the session transcript has `toolUseResult.agentId ==` the id and `tool_use_id ==` meta `toolUseId` (second end; observed this revision) | 來歷不明: `agent_result_absent`, `agent_tool_use_mismatch`, `duplicate_agent_result`; `spawnDepth` 0 → `unexpected_spawn_depth` |
| subagent → subagent | `parentAgentId` resolves | `legacy_record_no_parent_info`, `missing_parentAgentId`, `parent_agent_not_found`, `cycle` |
| subagent → rail | manifest `origin_agent_id` (step 5) names an agent recorded in the session | absent → 起點不明 (`origin_unstamped`); no such record → `stamp_agent_not_found` |
| fleet | never an edge (deferred, §4) | — |

**No skip-level edge.** Across a non-Claude harness (D8), nested rails hang only by rail → rail and a claude grandchild only by its own rail → child predicate; otherwise it is `child_marker_absent` (note `◦ 中間經過非 Claude 的工作，之後沒有紀錄`), never attached to an outer rail or the session. The script itself (step R) moves untracked nodes into their group; the renderer never draws them as children. Two concurrent rails from one session and config dir cannot be confused: the edge is a minted uuid with exactly one claimant.

## 4. Remaining hand-offs (answers G1 R6)

Each hand-off is its own commit. Acceptance is red before, green after, re-derived by running it (ADR-0001). `bash mods/live/run-tests.sh` accepts no producer commit.

**Order.** Steps 2 and 3 shipped before any probe, so D0 is a **verification gate over shipped writers** (§7 rows a, c, e, f) and the **gate before every new writer**. Order: **D0 → 3a → 3b → 3c → 3d → 5 → R**; no new writer starts before the §7 rows that block it are recorded. A bad d1, d2 or f needs a producer change this plan does not hold: work stops, the plan is revised and plan-reviewed again before R (no conditional step here). **Re-open protocol**: if D0 falsifies step 2 or 3, (1) `hooks/tests/manifest-session-id.test.sh` or `child-session-identity.test.sh` is changed first and shown red on `develop`; (2) the writer is fixed in its own commit; (3) §2 is restated in that commit; (4) R's fixtures for that edge are re-derived after (2) is green.

**Step 4 (fleet) is deferred out of this plan** (owner ruling 2026-10-13): low value, and the receiving side is an LLM relaying the value. Tracked in the backlog.

**D0 — measurement gate.** No product code. `d0-probe.sh` in this plan's evidence directory (`<evidence>`) runs each §7 row against the real CLI and rails; writes `d0-result.json`, one `{row, status: pass|bad|not_run, evidence}` per row with raw dumps.
- Accept: `bash <evidence>/d0-probe.sh --out <evidence>/d0-result.json` exits 0, every blocking row `pass` or `bad`; `not_run` counts as `bad`.
- Negative control: `--omit-sentinel` with `AUTOPILOT_RUNS_WATCH_AUTOSTART=0` must report row a `bad`.
- Live probe, not a `hooks/tests` suite: it needs an authenticated `claude`. Rollback: none.

**3a — child end for author/review (D2, BL-0142).** The four launches pass `--settings` with a SessionStart hook → new `session-mode.js ensure-child`, which writes a plain marker for **`payload.session_id` only** with `parent_session_id` from `AUTOPILOT_PARENT_SESSION_ID`; rails export `AUTOPILOT_SESSION_MODE_DIR` (the launcher's marker dir) so cc-shim's HOME cannot hide it. If row b shows `--settings` hooks dropped, the rail writes `<scratch cwd>/.claude/settings.json` instead. The hook reads only its payload. Watcher rules and hetero's plugin path unchanged.
- Compat: an existing marker is kept; no SessionStart → `child_marker_absent`. Rollback: revert; written markers expire on TTL.
- Accept: `hooks/tests/child-marker-sessionstart.test.sh` — stub `claude` runs the configured hook with `{session_id:<its --session-id>}`; per shape (author/review × native/cc-shim) with parent P: `<id>.json` exists in the marker dir, `parent_session_id == P`, `session_id ==` manifest `child_session_id`, scratch HOME gone, `P.json` byte-identical. Red on `develop`.
- Negative control: hook flag removed → no marker. Live: rows a–b re-run per shape after landing.

**3b — write-target resolver (D7, §6).** One resolver used by every §6 writer; rails set the child env per §6 rule 3; same for the probe's `claude -p`.
- Compat: with the parent variable unset, output equals today's `getSessionId()`; refusal = exit 3, one stderr line naming the source, no file touched. Consumers of `AUTOPILOT_SESSION_ID` below a rail (`src/engine/profile-runtime.js:588`, hooks in a hand, campaign intake) are enumerated and pinned in case (e). Rollback: revert.
- Accept: `hooks/tests/session-marker-write-target.test.sh`, red on `develop`:
  (a) `node hooks/runs-watch-autostart.js` with SessionStart payload `{session_id:P}`, `AUTOPILOT_PARENT_SESSION_ID=P`, an **expired** `P.json` pre-seeded → bytes unchanged; same via `ensure-child`.
  (b) `CLAUDE_CODE_SESSION_ID=P` + parent P: `set --size S`, `set --level l3`, `clear`, `bind-campaign-root`, `stage-advance.js --resume-from` → exit 3, `P.json` unchanged.
  (c) `AUTOPILOT_SESSION_ID=X`, `CLAUDE_CODE_SESSION_ID=C`, parent P → `C.json` written, `X.json` unchanged. (d) `C` with parent P → `C.json` written.
  (e) stub codex under `dispatch-hetero.sh` and stub `claude` under `probe-engine-capability.sh` see parent P and no `AUTOPILOT_SESSION_ID`.
  (f) launcher with only `CLAUDE_SESSION_ID=L`: stub child sees parent L, no `CLAUDE_SESSION_ID`; its `set` → exit 3, `L.json` unchanged. (g) launcher with no id (cwd id W): child sees parent W; `set` in the same cwd → exit 3, `W.json` unchanged. (h) launcher with only `CODEX_THREAD_ID=T`: child keeps T; `set` → exit 3, `T.json` unchanged.
- Negative controls: `cmdSetPlain` back on `markerPath()` → (b) red; rail takes P from `CLAUDE_CODE_SESSION_ID` only → (f)–(h) red.

**3c — keep the cc-shim transcript (D3).** Before removing the scratch HOME, author and review copy `<scratch>/.claude/projects/*/<child_session_id>.jsonl` to `<runs>/<run_id>.child-transcript.jsonl` and set manifest `child_transcript` (null on failure). It is the child's record of itself, not the child end of an edge.
- Compat: run status never depends on the copy. Rollback: revert; copies stay as plain files.
- Accept: `hooks/tests/ccshim-child-transcript.test.sh` — stub writes known bytes; manifest `child_transcript` names a file with those bytes, scratch HOME gone; stub writes nothing → `null`, same status. Red on `develop`.
- Negative control: copy removed → first case red.

**3d — a child's parent record needs the rail's own child id (D10, BL-0176; option 1 of the backlog entry, option 2 rejected).** A session's marker may name P as parent only when the rail that launched it says which session it launched. Option 2 (a liveness or time window on P's marker) is a heuristic and is not used (ADR-0001: re-derive from records, never guess).
- **Variable.** `AUTOPILOT_CHILD_SESSION_ID` = C, the uuid the rail already mints with `child_session_mint` (`scripts/lib/repo-identity.sh:103`) for `--session-id` and manifest `child_session_id`. Minted only where a rail starts a `claude` child it can name: author and review (cc-shim, claude-native) and hetero (cc-shim). C is never minted for another runner.
- **Writer rule, in one place.** `ensurePlainMarker` records `parent_session_id = P` only when P is non-empty, C is non-empty, the normalized payload id equals C, and the id is not P (the `refused_parent` check stays first). Otherwise no `parent_session_id` key. Both SessionStart paths reach it (`ensure-child`, `session-mode.js:742`; the plugin hook, `runs-watch-autostart.js:275` fast path and `:293` full path), so the rule is not duplicated. `resolveMarkerWriteTarget` is **not** changed: C selects no write target and refuses nothing; §6 rules 1–4 stay as they are.
- **Rail rule (extends §6 rule 3).** Every child launch sets C or removes it; none passes an inherited one.

| Rail / launch | Child gets | Where |
|---|---|---|
| author, review: cc-shim and claude-native `claude -p` | `AUTOPILOT_CHILD_SESSION_ID=<minted>` on the command line, next to P and `--session-id` | `dispatch-author.sh:1269`, `:1289`; `dispatch-review.sh:1558`, `:1588` |
| hetero: cc-shim `claude -p` | same, through the shared worker wrapper (all variants) | `dispatch-hetero.sh:3671`, `:3676`, `:3690`, `:3702`, `:3710`, `:3715`; claude at `:3756` |
| author, review, hetero: codex, agy, grok, kimi, opencode, qoder, cursor, anthropic-compatible, and `dispatch-author-kimi.js` | C **removed** (`-u`, or `unset` where the rail uses `child_session_apply_env`); P still passed (§6 rule 3) | `child_session_apply_env` (author `:1130`, review `:1113`); hetero wrapper above; the kimi transport inherits `process.env` (`src/runners/kimi.js:57`, `:133`, `:150`) |
| explore: codex, agy | C removed | `dispatch-explore.sh:186`, `:206` |
| foreman | C removed from both routes into `FOREMAN_ENV`, as `AUTOPILOT_SESSION_ID` is: the `AUTOPILOT_*` allowlist copy and the `--env-passthrough` loop | `dispatch-foreman.sh:345-358` |
| `probe-engine-capability.sh`, every runner invocation | C removed: no manifest, no `--session-id`, so nothing could join it. The probe unsets C once at entry, before its first runner invocation (the `--version` calls at `:181-252`), so the version calls and every live branch run without it; the claude branches keep calling `child_session_env_setup` | `--version` `:181-252`; claude `:460`, `:467`; others `:388-489` |

- **Non-Claude runners.** No `child_session_mint` there and none is added: those runners take no session id from the rail, and a `claude` they start picks its own id, which the rail cannot name, so no exact edge exists under §3 anyway (the "no skip-level edge" note). Decision: the rail does **not** mint; the grandchild's marker carries no parent. Each such launch must still carry the C removal, otherwise a C inherited from the rail's own launcher (a rail running inside a claude child) would reach a grandchild whose id the rail never chose.
- **Mechanism.** `child_session_env_setup` appends `-u AUTOPILOT_CHILD_SESSION_ID` to `CHILD_SESSION_UNSET` for every caller (the pinned set copies it, `repo-identity.sh:140-145`); the claude launches add `AUTOPILOT_CHILD_SESSION_ID=<C>` **after** the `-u` list, because every `-u NAME` must precede any `NAME=VALUE` in an `env` argv. `child_session_apply_env` also unsets it in-shell. The detached hetero child gets these functions through `declare -f` at detach time (`dispatch-hetero.sh:4971`), so it runs the current body; any new helper goes into that list. The fallback used when the helper is absent (`:3653`) also removes C.
- **Old environments.** P without C (a shell or session started before 3d, or a launcher that does not know 3d): no `parent_session_id`, write target unchanged. C without P: ignored. The failure direction is "not traced" (`child_marker_absent`), never a wrong edge; no fallback to P alone.
- **Order and scope.** After 3b (same helpers and fixtures), before R. 3d needs no owner credential: its acceptance uses stub runners. It does not close R's kimi, agy and opencode rows: C removal on those launches is covered by the stub tests, and the live env check stays with row d2. 3d is independent of step 5: row h and the stamp prefix do not touch these launches, and a bad row h leaves 3d shipped.
- **Row d2 effect.** For a non-Claude harness the expected inner marker changes from "names the outer session as parent" to "carries no parent" (§7 row d2 note). The 2026-10-15 codex `pass` in `d0-summary.md` was measured against the old wording; row d2 is re-run for the codex path after 3d, and R still waits on kimi, agy and opencode.
- Compat: with C absent and P absent, behaviour equals today. Rollback: revert; markers written meanwhile keep or lack `parent_session_id` and expire on TTL.
- Accept: `hooks/tests/child-parent-record.test.sh` (new, `chmod +x`, mode 100755 in the index), red on `develop`:
  (a) **tmux reproduction.** A stub `claude` launched by each claude-branch rail dumps its environment and leaves a long-lived shell holding it; the test replays that exact environment and runs a SessionStart payload with a new id Z through `ensure-child` **and** through `node hooks/runs-watch-autostart.js` (opted-in git temp dir, full path; the fast path at `:275` calls the same `ensurePlainMarker` with the same id, and staging a live watcher for it is not attempted, so the claim is limited to the full path plus the direct writer cases). `Z.json` has no `parent_session_id`. The same environment with payload = C gives `parent_session_id == P`.
  (b) P set, C unset (old environment): no parent for any payload id. (c) C set, P unset: no parent. (d) payload = P: `refused_parent`, `P.json` byte-identical (unchanged from 3b).
  (e) **per rail, pass**: author and review × cc-shim, claude-native, and hetero cc-shim: the stub claude sees `AUTOPILOT_CHILD_SESSION_ID ==` manifest `child_session_id ==` its `--session-id`, and the hook-written `<C>.json` has `parent_session_id == P`.
  (f) **per rail, scrub**: with C pre-set in the rail's own environment (a rail inside a claude child), the stub runner sees C unset: author × codex, kimi (`dispatch-author-kimi.js` stub), agy; review × codex, opencode, kimi; hetero × codex, kimi, agy, opencode, plus hetero codex in detached mode; explore × codex, agy; the foreman hand, once with C inherited and once with `--env-passthrough AUTOPILOT_CHILD_SESSION_ID`; `probe-engine-capability.sh` × cc-shim, claude-native, codex, agy, grok, qoderclicn, cursor, kimi, opencode, where every stub invocation is checked, including `--version` and a run with no live command; hetero codex with the helper absent, so the `:3653` fallback runs. A runner with no stub is `not_run`, which counts as bad (the D0 convention in this section).
  The assertions that read `parent_session_id == P` from a P-only environment (`child-marker-sessionstart.test.sh:105`, `:133`, `:150`; `child-session-identity.test.sh:128`; `session-marker-write-target.test.sh:98`) are rewritten in the same commit to set C, so they stay green for the right reason.
- Negative controls (each shown red, then green): (e) drop `AUTOPILOT_CHILD_SESSION_ID=` from one launch at a time (author ×2, review ×2, hetero via each wrapper variant) → that rail's pass case red; (f) drop the `-u` from `child_session_env_setup` → every helper-dependent scrub case red (the foreman case stays green: it has its own filter); remove `child_session_env_setup` from the `:4971` list while the `:3653` fallback lacks the C removal → the detached case red; drop it only from `child_session_apply_env` → the in-process runner cases red; foreman allowlist filter off → the inherited foreman case red; passthrough exclusion off → the passthrough foreman case red; the probe's entry unset removed → every probe case red, the `--version`-only run included; only the `:3653` fallback's C removal dropped → the helper-absent case red; writer compares to P only (today's rule) → (a) red.
- Live: §7 row l after landing; D0 `--rows d2` re-run for the codex path.

**5 — which subagent started a rail (D5).** New `hooks/rail-agent-stamp.js`, registered **directly** in `hooks/hooks.json` (PreToolUse, `Bash`), not through `opt-in-multiplexer.js`, which forwards only `additionalContext`/`permissionDecision` (`:153-176`). For a rail command it returns `updatedInput` with `export AUTOPILOT_ORIGIN_AGENT_ID=<v>; ` prefixed: `<v>` = payload `agent_id` if `[A-Za-z0-9_-]{1,64}` (else no stamp), or `session` when absent. It **never returns `permissionDecision`**: per the hooks reference (code.claude.com/docs/en/hooks), `allow` skips the prompt and rules match the returned input. Rails copy it to manifest `origin_agent_id` and unset it for children. It is opt-in; the default is decided after §7 rows g–i are measured. Any bad row in g–i → step 5 not shipped and D5 joins "cannot be traced"; no command-text or time matching fallback (a guess).
- Compat: no stamp → `origin_unstamped`. In `profiles/hook-classes.json` and the inventory (`check-hook-inventory.js` green). Rollback: remove the entry and hook.
- Accept: `hooks/tests/rail-agent-stamp.test.sh`, driven from `hooks/hooks.json`: run every Bash PreToolUse entry, assert only the stamp returns `updatedInput`, **execute the rewritten command** with a stub runner, read the manifest. Cases: A1 → `"A1"`; no agent → `"session"`; knob off → null; quote in id → none; non-rail → no output; A1 and A2 concurrent → each own id; nested rail → null. Red on `develop`; rows g–i re-run live after landing.

**R — merged view and renderer (D1, D9).** `dispatch-tree.js` applies §3 (reads `child_session_id`, child markers, `origin_agent_id`), then a **hoist pass** moves every untracked node into its session's group, setting `untracked_bucket` and keeping `untracked_reason`. The tab renders groups with their own glyph. Codex mirror re-synced. Compat: §5. Rollback: revert (no stored state).
- Accept: `node --test scripts/dispatch-tree.test.js`; the tests at `:85-107`, `:141-153` are rewritten, so red on `develop`. Fixtures: (1) exact loop-back → child under its rail, `edge:"exact"`; (2) no child marker → `child_marker_absent`; (3) two claimants → `duplicate_child_claim`, under neither; (4) null both sides → not exact; (5) fresh marker join → `joined_by_marker`, not in `root.children`; (6) expired → `joined_by_expired_marker`; (7) `parent_run_not_found`, `parent_run_other_session`; (8) old subagent record → `legacy_record_no_parent_info`; (9) unstamped → 起點不明, `session` → root, A1 → under A1, A9 → `stamp_agent_not_found`; (10) foreman R1 → R2 (`session_id` null) → G without marker: R2 under R1, G in 來歷不明; (11) depth 1 without parent → `parent_run_missing_at_depth`; (12) two concurrent rails → each child under its own; (13) top-level agent with one matching transcript result → under the session, `edge:"exact"`; no result → `agent_result_absent`; two → `duplicate_agent_result`; `toolUseId` differs → `agent_tool_use_mismatch`; (14) A → exact X → B (`session_id` X, `parent_run_id` A) → B under X; X without marker → `nested_via_untracked_child`; `parent_run_id` ≠ A → `nested_parent_mismatch`. On `develop` (13) "no result" sits under the session and (14) puts B under A: red.
- Negative controls: hoist off → (5)–(7) red; transcript end ignored → (13) "no result" red; nested rule on `parent_run_id` alone → (14) mismatch red. Then `bash mods/live/run-tests.sh`.

Display follows live-pane §2.4 (one line per top-level work, children folded behind `▸ N 個子工作`, live open, finished closed). This plan adds one bounded `tree` component (depth ≤ 4, deeper folded into `▸ 還有 N 層`) with its own invariants. Tree rows carry identity and lifetime only; seat verdicts stay in 審查 (live-pane §2.6).

**Cannot be traced, by nature** — shown, not hidden: a process outside any rail after it exits (D6); the far side of a fleet dispatch; cc-shim children from before step 3; rails below a harness that strips the environment (row d2); and D5 if rows g–i are bad. Such branches end with `◦ 之後的工作沒有紀錄`.

## 5. Data contract with `scripts/dispatch-tree.js`

The hoist moves nodes out of `children`, which is not additive, so the script's own JSON `schema_version` becomes **2** (only its own test reads 1). `root.untracked_groups: [{bucket, children}]`, one per bucket, the only place untracked nodes appear. Every node: `edge: "exact"|"none"` (no `marker` kind), `untracked_bucket`, and the §3 reasons. New kind `child_session` with `parent_session_id`; it may hold rail children (nested Claude, §3). Agents add `tool_use_id`. Rails add `child_session_id`, `origin_agent_id`, `child_transcript`. A node without `edge` reads as `none`.

## 6. Session marker write target (answers G1 R7 second finding and the minimax R7)

D7 states the problem. Design: one resolver `resolveMarkerWriteTarget({payloadId, explicitId, env})` → `{id, source}`, with `source` ∈ `payload`, `explicit`, `env:<variable>`, `cwd`. Let P = `AUTOPILOT_PARENT_SESSION_ID`.

1. **P unset**: today's `getSessionId()` chain, unchanged.
2. **P set**: accept `payload` and `explicit` (unless equal to P) and `env:CLAUDE_CODE_SESSION_ID` **only when it differs from P** (Claude replaces it in its children; row a re-checks). Refuse other env sources and cwd: a process with P set cannot tell its own value from an inherited one.
3. **Every rail exports P = its own write target** (this resolver's id, whatever the source, cwd included) to every child runner, and removes `AUTOPILOT_SESSION_ID`, `CLAUDE_SESSION_ID`, and `CLAUDE_CODE_SESSION_ID` when it differs from P. A non-Claude runner, including one below a Claude child, is then caught by rule 2. `CODEX_THREAD_ID` stays (codex sets it): with P set, rule 2 refuses every `env:` source except a `CLAUDE_CODE_SESSION_ID` ≠ P, so an inherited thread id is never written under; a codex child's own is refused too (fail closed, no marker).
4. Inherited ids are read-only: read to record `parent_session_id`, never written under.
5. **A parent is recorded only against a named child (3d).** `parent_session_id = P` is written only when the marker's own id equals `AUTOPILOT_CHILD_SESSION_ID`, the id the launching rail minted for that child. P alone identifies an inherited environment, not a child.

| Writer | Own id today | After 3b |
|---|---|---|
| SessionStart: `runs-watch-autostart.js` → `ensurePlainMarker` | payload | payload; refused if equal to P; parent recorded only if payload = C (3d) |
| `session-mode.js ensure-child` (3a) | new | payload only; parent recorded only if payload = C (3d) |
| `set` (plain, `--level`, `--size` init), `clear` | env chain → cwd | rules 1–2 |
| `bind-campaign-root` (CLI and engine) | env chain | rules 1–2 |
| `stage-advance.js` resume (`:351-358`) | env chain → cwd | rules 1–2 |
| `retire --session` | explicit | refused if equal to P |
| `probe-engine-capability.sh:456,462` `claude -p` | payload (in the child) | launched under rule 3 |

Controls (3b) cover the SessionStart hook path and every env-keyed writer. **Residual, not closed**: a non-Claude process started *outside any rail* from a Claude session's Bash is indistinguishable from that session's shell (D6 class).

## 7. Unknowns — who measures each, and what changes if the answer is bad

All measured by D0 unless named. Pass = the Unknown holds as written; anything else is bad. "Blocks" = steps that wait for the row.

| Row | Unknown | Measurement | Bad result → design change | Blocks |
|---|---|---|---|---|
| a | `claude -p --session-id u`: SessionStart fires with payload `u`, and Bash sees `CLAUDE_CODE_SESSION_ID == u` (verifies step 3) | opted-in git temp dir; plugin path (`u.json` appears) and a `<cwd>/.claude/settings.json` sentinel; env dump. Not `--settings` (row b) | no SessionStart or wrong id: 3a dropped, all claude children `child_marker_absent`, §2 restated via re-open. Bash id inherited: rule 2 drops the `CLAUDE_CODE_SESSION_ID` acceptance | 3a, 3b |
| b | Under author/review flags (and cc-shim HOME): do plugin, `--settings`, or `<cwd>/.claude/settings.json` hooks fire? | sentinel per shape; cc-shim needs an endpoint | none fires: that shape stays `child_marker_absent`, BL-0142 open. Only plugin: `runs-watch-autostart.js` ensures the marker for a non-git cwd when P is set | 3a |
| c | A real hetero cc-shim child writes `u.json` with parent P (verifies step 3) | one real hetero run | re-open step 3; 3a's hook extended to hetero | 3a, R |
| d1 | `dispatch-foreman.sh` nested rail: `session_id` null, `parent_run_id` = foreman run, depth 1 | foreman with a stub hand | stop; plan revised and re-reviewed before R | R |
| d2 | Claude → non-Claude harness → Claude, end to end: the inner `u.json` names the outer session as parent (**after 3d, for a non-Claude harness: carries no parent**, since the rail minted no child id), the outer marker is unchanged, and the nested manifest has `parent_run_id` = the harness run | outer Claude session → `dispatch-hetero.sh --runner codex`; the codex task runs `claude -p --session-id u`, which starts a stub rail. Record env at codex and inner claude (`AUTOPILOT_PARENT_RUN_ID`, depth, `AUTOPILOT_PARENT_SESSION_ID`, `CLAUDE_CODE_SESSION_ID`), the inner SessionStart payload, `u.json`, the nested manifest. Same for kimi, agy, opencode when installed, else `not_run` (= bad). No manifest claims `u`, so R places the nested rail by §3 (a named reason), never by guess | stop; plan revised and re-reviewed before R | R |
| e | Top-level and subagent Bash see the session's `CLAUDE_CODE_SESSION_ID` (verifies step 2; subagent observed) | env dumps | re-open step 2 | R |
| f | Nested Claude: a rail from a rail's claude child writes the child's own id, depth 1, outer `parent_run_id` | one two-level run | stop; plan revised and re-reviewed before R | 3b, R |
| g | `updatedInput` applied with no `permissionDecision` (undocumented)? | subagent `echo A` rewritten to `echo B` | step 5 not shipped | 5 |
| h | Allow rules still match the rewritten rail command without a prompt? | allow rule + stamped run | step 5 not shipped | 5 |
| i | Rewrite survives the other Bash PreToolUse hooks? | full plugin hook set | step 5 not shipped | 5 |
| l | A real claude child sees `AUTOPILOT_CHILD_SESSION_ID` in its SessionStart hook environment, and a real tmux started inside it keeps it: a new top-level session started in that tmux writes a marker with no parent | one hetero cc-shim run (the author claude branches pass `--tools ""`, so their child cannot start tmux) whose claude child starts `tmux new -d`, which starts a second `claude -p`; dump hook env and both markers | 3d not shipped; BL-0176 stays open, no heuristic fallback | 3d (live acceptance only) |
| j | Lifetime of a copied transcript in the runs dir | step 3c live check, one day later | renderer shows `◦ 子工作紀錄已清除` when the file is gone | — |
| k | The session transcript's Agent result carries `toolUseResult.agentId` and `tool_use_id` for foreground and background launches (background observed) | one launch of each | top-level agents go to 來歷不明 (`agent_result_absent`); no producer change | R |

Non-git children (BL-0142) are rows a–b and step 3a. Fleet depth left with the deferred fleet step.

## 8. Not in this plan

No trust machinery (ADR-0001): no signed edges, no hash-chained lineage, no witness receipts. The two-sided agreement in §3 is verification by independent re-derivation from records that already exist, not a claim that has to be believed. No version bump (owner hold on the version line). The live-pane plan's component set, state vocabulary and tab ownership are not changed here beyond the one `tree` component above.

## 9. Disposition of the G1 findings that concern this work

Live-pane plan G1 (sol R1, R6, R7a, R7b; minimax R7; owner's harness concern): adopted by splitting this plan out and answered in §1, §3, §4, §6, §7; full table in the [live-pane plan-review evidence](evidence/2026-10-13-live-pane/plan-review/README.md).

### G1 of this plan (sol_chair, minimax_consult)

| Finding | Rubric | Disposition | Where |
|---|---|---|---|
| `54becd7a` diagnosis not current; 3b has no source | R1 | accepted: §1 rebased; D2 restated, D7–D9 added, step→D map | §1 |
| `1a41c6fc` marker join drawn as an edge | R2 | accepted: membership-only, 「來歷不明」; fixtures 5–6 | §3, §5, §4 R |
| `188483af` duplicate claims; skip-level edge | R2 | accepted: one-claimant rule, nulls never match, no skip-level; fixtures 3, 4, 10 | §3, §4 R |
| `c3da93e5` shipped premise overstated | R3 | accepted: rail end only; step 3a; rows a–c | §2, §4 3a, §7 |
| `6e325162` no own-id source per writer | R4 | accepted: resolver, per-writer table, SessionStart and env controls | §6, §4 3b |
| `56a3391e` rollback/acceptance; fleet wrote local root | R5 | accepted: per-step compat, rollback, test, control; fleet step deferred out | §4 |
| `5341e414` no viable stamp path | R5 | accepted: direct registration, `updatedInput` without decision, hooks.json-driven test; rows g–i | §4 step 5, §7 |
| `6fc53ca4` probe-first order impossible | R6 | accepted: honest order, outcome table with blocks | §4 Order, §7 |
| `716fa4a5` untracked under nearest parent | R2 | accepted: hoist pass, schema 2 | §4 R, §5 |
| `0edb5f52` D0 has no acceptance | R5 | accepted as a live probe with its own control | §4 D0 |
| `cbf73c66` no re-open protocol | R6 | accepted | §4 Order |

### G2 of this plan (sol_chair STOP, minimax_consult READY; blockers ruled by the coordinator)

| Finding | Rubric | Disposition | Where |
|---|---|---|---|
| `48daef4f` session → top-level subagent edge missing | R2 | accepted: two-sided rule via the transcript's Agent result, named reasons; fixture 13; row k | §3, §4 R, §5, §7 |
| `4a39b78d` nested Claude A → X → B has no exact rule | R2 | accepted: child session → rail edge, three conditions; fixture 14 | §3, §4 R, §5 |
| `f00f02a8` P only from `CLAUDE_CODE_SESSION_ID` | R4 | accepted: P = launcher's resolved target, inherited ids removed, `CODEX_THREAD_ID` reasoned; cases f–h | §6 rule 3, §4 3b |
| `723dddf8` d1, d2, f bad results need unowned producer work | R5 | accepted: a bad result stops for plan revision and re-review | §4 Order, §7 |
| `f2eb5a77` d2 unspecified | R6 | accepted: codex end-to-end probe; other harnesses or `not_run` | §7 d2 |
