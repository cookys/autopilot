# Plan - depth-0 decides the per-turn gate (session-scoped switch, generic verifier, subagent coverage)

> Status: draft, awaiting plan review. Owner direction 2026-10-26 (Taipei) after decision card d-32849d39 chose A (keep the BL-0055 gate default off): whether the gate runs must not be a setting a user edits by hand; depth-0 decides per task. Follow-up to `docs/plans/2026-10-24-per-turn-gate-phase2.md` (hook `hooks/per-turn-gate.js`, verdict `docs/plans/evidence/2026-10-25-per-turn-gate-p2-4/VERDICT.md`). Plan only: no code, hook, skill or config change is made by this document. Version stays 3.0.0 (owner hold).

## 0. Context / thesis

BL-0055 built `hooks/per-turn-gate.js`, an opt-in Stop hook: at the end of a turn it runs a verifier, and on a violation blocks the stop once or twice with the verifier's text. Two Haiku batches on task t14 PASSED in mode `violations+features`. Today the switch is global and manual (`hooks.per-turn-gate` opt-in plus `per_turn_gate.verifier` in `config.json`), and the verifier is a project-written program (`evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js`). The owner kept it off by default.

Thesis: the gate is only useful when someone knows the rules of the task, and that someone is depth-0 at dispatch time. So (1) the switch should be session or lane scoped and written by depth-0, (2) the verifier should be one generic program driven by a structured rule list that depth-0 fills in (no LLM-authored verification code), (3) the gate has to reach the sessions that do the work, which are hands (native subagents, headless `claude -p` workers, other harness CLIs), not depth-0 itself, and (4) the text that tells depth-0 when to switch it on is guidance and waits for ON/OFF evidence.

## 1. Problem

- A global on/off cannot express "this lane has hard constraints, that one does not". A user who must remember to edit `config.json` will not.
- The measured effect (t14) is for a session that does its own work. In autopilot the work is done by hands dispatched by depth-0, so a Stop hook on depth-0 checks the wrong session.
- Writing a verifier per task is the cost that stopped adoption; having the LLM write one on the fly is unverified code gating a model, which is the failure we do not want.

## 2. OKR / KRs

Objective: depth-0 can switch the gate on for a lane with a rule list and no hand-written code, and the effect is measured before depth-0 is told to do it.

- KR1: a session-scoped switch and a generic verifier exist, every fail-open and `max_blocks` contract of the existing hook is unchanged (existing `hooks/per-turn-gate` tests stay green, new tests have negative controls).
- KR2: the gate reaches at least the two hand paths named in section 3.3 (native subagent, headless `claude -p`), or the plan records which one failed its probe.
- KR3: guidance text ships only after an ON/OFF verdict PASS (section 5.2); otherwise it does not ship.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- The existing hook contract is frozen: fail-open (an error never blocks), `max_blocks` per (session, turn) default 2, exactly one log record per invocation in `<live-state>/per-turn-gate/<session>.jsonl` with `{session, turn, prompt_id, decision, reason, counter}`.
- No new trust machinery (ADR-0001): no hash chain, signed receipt or attestation of a rule list; the verifier re-derives from the repo state.
- The generic verifier has the interface of `verify-turn.js`: `<cmd> --turn <n> --repo <dir> --json`, exit 0 clean, 1 violations, anything else is an error; stdout is JSON `{violations: [{constraint, rule, evidence}], feature_gaps: [string]}`.
- Mechanism commits and guidance commits are separate commits (CLAUDE.md "Skill evolution rules", mechanism-vs-guidance); a mechanism commit does not edit requirement text.
- Nothing in this plan turns the global default on. Node >= 20.10, built-ins only.
- Paid probes and paid evaluation runs need explicit owner approval of the cap before they run.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`. New optional state file and new optional config-free path; with no session state present the hook behaves byte-for-byte as today. The `hooks/hooks.json` wiring for SubagentStop (phase P2) is additive.
- **Dependency decision**: `none` (Node stdlib only).

## 3. Design

### 3.1 Session-scoped switch (mechanism)

Today `main()` reads only `config.json` (`isEnabled('per-turn-gate')` and `per_turn_gate.*`). New: a session gate file, read by the hook at every Stop.

- Path: `<live-state>/per-turn-gate/<session-id>.gate.json` (live-state via `resolveLiveDir()`, tmpfs, same directory as the existing counters). Written by depth-0 through a small script `scripts/per-turn-gate-arm.js` (`arm`, `disarm`, `show`), never by hand-editing.
- Content: `{ "v": 1, "rules": "<abs path to rule list>", "mode": "violations|violations+features", "max_blocks": 2, "armed_at": "<ISO>", "expires_at": "<ISO>" }`. `expires_at` is mandatory (default now + 2 h) so a forgotten file self-retires; an expired file counts as absent.
- Which session id: for a hook running in the hand's own session, its own `session_id` from stdin. Depth-0 therefore needs the id of the session it is about to create. Headless workers already receive `--session-id` from `dispatch-author.sh`/`dispatch-hetero.sh` (`CHILD_SESSION_ID`); native subagents do not have a known id ahead of time, so for them the file is keyed by lane instead (section 3.3). The lookup order inside the hook: session file, then lane file, then global config.
- Precedence with `config.json` (decided, open for the owner in section 8): the global switch is a floor, never a ceiling. If the global knob is on, behaviour is exactly as today and a session file may only supply its own rule list when no `per_turn_gate.verifier` is configured. If the global knob is off, a valid session or lane file turns the gate on for that session only. A session file never raises `max_blocks` above the global value when one is set, and never above 3 in any case.
- Fail-open: unreadable, malformed, expired, wrong-version or unknown-field file means "no session switch" and the hook falls to the global path; a rule-list path that does not exist or is unreadable yields reason `error`, allow. Log: reuse the existing record; add one additive field `source: "session"|"lane"|"global"` (existing consumers ignore unknown keys; the log test gains a case).
- Cleanup: `cleanupState` already removes this directory's stale state; the gate file pattern is added to its allowed names, retention unchanged.

### 3.2 Generic verifier and rule list (mechanism)

New `scripts/gate-verify.js` with the `verify-turn.js` interface. It reads the rule list named by the session file (flag `--rules <file>`, passed by the hook as part of the verifier command string), checks the repo in `--repo`, and prints violations and feature gaps. Pure re-derivation from the working tree and exit codes of commands; it records nothing about who wrote the list.

Rule list schema draft (`gate-rules.json`, `"v": 1`):

```json
{
  "v": 1,
  "forbid_paths":   [ { "id": "R1", "glob": "src/legacy/**", "why": "frozen module" } ],
  "require_files":  [ { "id": "R2", "path": "docs/NOTES.md" } ],
  "require_text":   [ { "id": "R3", "path": "src/api.js", "pattern": "export function listUsers", "why": "public API kept" } ],
  "forbid_text":    [ { "id": "R4", "glob": "src/**/*.js", "pattern": "console\\.log" } ],
  "must_pass":      [ { "id": "R5", "cmd": "node --test hooks/x.test.js", "timeout_s": 20 } ],
  "features":       [ { "id": "F1", "cmd": "node scripts/smoke-login.js", "label": "login works", "timeout_s": 20 } ]
}
```

Judgement rules:

- `forbid_paths`: violation if `git status --porcelain` (relative to `--base` or HEAD, flag optional) shows a changed path matching the glob. Evidence is the path.
- `require_files`, `require_text`: violation if missing or no match. `forbid_text`: violation if any match; evidence is `path:line`.
- `must_pass`: violation if the command exits non-zero or times out; evidence is the exit code and the first 200 bytes of stderr. Commands run with `cwd=--repo`, stdin closed, a scrubbed environment, hard timeout; each `cmd` is a plain argv string run without a shell pipeline (same constraint as the hook's `verifier` knob).
- `features`: a failing or timed-out command is a `feature_gaps` entry (label), never a violation, so exit 0 with gaps is the "features" signal the evaluated mode uses.
- Exit 1 iff there is at least one violation; exit 0 otherwise; exit 2 for an unreadable or schema-invalid rule list, unknown keys, more than 40 rules, a duplicate `id`, a glob escaping the repo, or any internal error. The hook already turns exit 2 into `error`, allow.
- Safety of commands: the rule list is data written by depth-0, not LLM-written code, but `must_pass.cmd` is still arbitrary shell-less argv. Allowed first tokens come from a small allowlist in the script (node, npm, npx, python3, bash with a repo-relative script path, git read-only subcommands); anything else is exit 2. This is not an attestation; it only bounds what a mis-filled list can run.
- Negative control (ships with the script, red before green): a fixture repo plus one rule list per rule kind with a deliberately violating change must exit 1 with the expected `constraint` id; the clean fixture must exit 0; a malformed list, a list with an unknown key, a `cmd` outside the allowlist and a glob such as `../**` must each exit 2. A "dead verifier" control: replace the checking function with `return clean` and the negative cases must go red, shown in the test as a mutation run.

### 3.3 What is being checked: the session that does the work

The evaluation measured a session checking its own work. Autopilot's work is done by hands, so each hand path needs its own carrier. Facts below are from section 4.

| Hand path | Hook that fires inside the worker | Carrier of switch and rules | Status |
|---|---|---|---|
| Native subagent (Agent tool) | `SubagentStop` | lane file `<live-state>/per-turn-gate/lane-<lane>.gate.json`; the subagent's brief carries `Lane:` already (agent-dispatch header rule), and `agent_type` / `agent_id` arrive on stdin | Phase 0 probe first |
| `claude -p` worker in `dispatch-hetero.sh` claude-native and `dispatch-author.sh` cc-shim | its own `Stop` | a per-run `--settings <file>` that wires the hook, plus `--session-id` already passed; note cc-shim runs with `--setting-sources project` and a scratch HOME, and claude-native with a credentials-only config dir, so plugin hooks are NOT loaded there and the settings file must wire the hook explicitly | Phase 0 probe first |
| codex, agy, grok, opencode, cursor, copilot | see section 4 | not designed here | unverified, out of scope for mechanism |

Depth-0 itself is not gated by this plan.

## 4. Verified and unverified facts

Official Claude Code hooks documentation, fetched 2026-10-26 from https://code.claude.com/docs/en/hooks (page text is long; only the first 100000 characters were read):

- Verified (quoted by the doc): lifecycle row "`SubagentStop` | When a subagent finishes"; matcher "`SubagentStop` | agent type"; exit code 2 on `SubagentStop` "Prevents the subagent from stopping"; decision table lists `SubagentStop` with top-level `decision: "block"` plus `reason`; hooks "from settings files, managed policy settings, and plugins also run inside subagents"; agent frontmatter `Stop` is converted to `SubagentStop`; `last_assistant_message` is available on Stop and SubagentStop.
- Not read: the SubagentStop section's own input-field list and any `stop_hook_active` statement (beyond the truncated part). Not asserted here.

Local probe records:

- C1 (P0, CLI 2.1.309, `claude-haiku-4-5`): "A SubagentStop block made the subagent continue (it replied ALPHA to the block reason); the second call (`stop_hook_active` true) allowed the stop." `docs/plans/evidence/2026-10-23-per-turn-gate-p0/README.md:39`; cost 0.0149 USD (line 47). Limits: single short session, throwaway hook alone, no plugin hooks together.
- SubagentStop stdin captured on a real run (CLI see `00-method.md`): `session_id, agent_id, agent_type, hook_event_name, stop_hook_active, last_assistant_message, background_tasks, session_crons` and no `cwd` in the printed line. `docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/06-task-agent-matcher-alias.md:24`. Consequence: the subagent hook cannot rely on `payload.cwd` the way `per-turn-gate.js` does at `repo = payload.cwd || process.cwd()`; the hook inherits the parent process cwd, whose value for a subagent is NOT verified. Phase 0 measures it.
- SubagentStop was not captured after a quota error: `docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/01-subagentstop-on-quota-error.md:122` ("no `SubagentStop` and no `Stop` were captured"). Consequence: a worker that dies on an error is simply not gated, which is the fail-open direction.
- Repo wiring: `docs/hook-harness-matrix.md:13` lists SubagentStop only under `awaiting-owner`, cell "未驗證" (not verified); `per-turn-gate` is `Stop` only, "未驗證" (line 24 region). `hooks/hooks.json` registers no SubagentStop gate hook today.
- Other harnesses (capability files under `src/harness/capabilities/`): grok "hooks verified at the event layer only (2026-10-23 ... throwaway repo ... saw SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop with stdin JSON. NOT verified: execution of autopilot's own hooks/hooks.json" (`grok.json:33`); agy "native agy hooks work ... saw SessionStart, PreToolUse, PostToolUse and Stop", but autopilot's `hooks/hooks.json` is not loaded (`agy.json:35`); codex hooks verified block-capable by `probe-codex-enforcement.js` (`codex.json:39`), the Codex wiring in `platforms/codex/hooks/hooks.json` has a `Stop` entry; no block-on-Stop probe is recorded for codex, grok or agy, so whether a Stop block continues the worker there is **unverified**; opencode `session_hooks: unavailable` (`opencode.json:19`); cursor `hooks: unverified` (`cursor.json:21`), copilot-cli `hooks: unverified` (`copilot-cli.json:18`), minimax-direct `not-applicable`.
- Whether the `--settings` file wiring works together with `--setting-sources project` in `claude -p`, and whether a `Stop` hook then fires with the same payload, is not recorded as a gate probe. The `--settings` flag is already passed by `dispatch-author.sh:1388`, which is evidence the flag exists in that rail, not evidence that hooks in it fire. Unverified; Phase 0.

## 5. Phases

| Phase | Class | Content | Done when |
|---|---|---|---|
| P0 | probe, paid (owner approves cap; est. 0.2 to 0.6 USD on Haiku, from the 0.16 USD total of the 8 P0 trials, plus margin for two extra trial shapes) | Throwaway-hook probes in a credentials-only config dir, none touching autopilot code: (a) SubagentStop block continues a native subagent while the plugin Stop hooks are present; record the full stdin and the hook process cwd; (b) a `claude -p --settings <file> --setting-sources project --session-id X` run with a Stop hook in the settings file: does it fire, does a block continue the model; (c) the same via the claude-native shape (credentials-only dir plus `--settings`). Read the rest of the official SubagentStop section (WebFetch, offset 100000) for input fields. | Evidence folder `docs/plans/evidence/2026-10-26-depth0-gate-p0/` with raw stdin and a table produced/not produced per probe; matrix cells updated by the owner of that file via `hook-harness-matrix.js --write` only if the evidence file gains rows. A failed probe removes that hand path from P2 and is stated in the verdict. |
| P1 | mechanism (size M) | `scripts/gate-verify.js` and its test with the negative controls of 3.2; schema file `scripts/gate-rules.schema.json`; the four-place script registration in CLAUDE.md "When adding a new script". | New tests green with the recorded red mutation run; `check-claude-md-inventory.js` and `doc-drift-gate.js` rc=0. Not wired to anything yet. |
| P2 | mechanism (size M) | (a) session and lane gate file read in `hooks/per-turn-gate.js` per 3.1 with `source` log field; `scripts/per-turn-gate-arm.js`; (b) SubagentStop wiring (new hook entry or the same file selected by `hook_event_name`, decided by the P0 payload) for the lane file; (c) carrying the hook and the rule list into `claude -p` workers through a per-run `--settings` file in the two rails, only where P0 (b)/(c) produced. | Existing per-turn-gate suites unchanged and green; new cases: session file on with global off blocks once and stops at the cap; expired, malformed and unreadable files allow with `error`; global on plus session file behaves as today; a kill-switch case (file removed mid-session allows); each with a negative control (case removed, test goes red). Opt-in manifest, hook-classes and `check-hook-inventory.js` updated. Nothing turns on by itself: no depth-0 text calls the arm script yet. |
| P3 | paid (owner approves cap) | ON/OFF evaluation per 5.1. Instrument first (tooling, dry run, marker negative controls), then pilot, then formal cells. | Verdict PASS, NOT NEEDED, NOT-SHIP or INVALID beside the spend, scored by rules frozen before the first scored cell. |
| P4 | guidance | Only on PASS: one commit adding the "when to arm the gate" paragraph to depth-0 guidance (`ceo-agent`, `dev-flow`, `/l3` to `/l6` wording as the evaluated arm changed, nothing else), `profiles-hash-repin` order, CHANGELOG entry, no version bump, `check-guidance-eval.js` match. No mechanism edit in the same commit. | Affected suites green, doc-drift gate rc=0, plan archived with `check-plan-graduation.js --fix`. |

Dependency map: P0 gates which hand paths P2(b) and P2(c) include; P1 before P2 (P2 calls the verifier); P2 before P3 (the ON arm needs the mechanism); P3 PASS before P4. P1 and P0 are independent and can run in parallel.

### 5.1 ON/OFF evaluation design (draft for P3)

Instrument: `evals/skill-onoff/` pattern (`prereg/*.json`, `freeze-guidance-arm.js`, runner `cc`, version pinned in `<results>.runner-pin`); lessons carried from `docs/plans/2026-10-24-findings-batch.md` section 4: markers read tool calls and real files, never the agent's words; every marker has a negative and a positive trace shown red then green; prereg committed and frozen before the first scored cell.

What differs from the shipped t14 evaluation: it must measure the decision (does depth-0 arm the gate with a correct rule list when a task has hard constraints, and leave it off when it does not) and the downstream effect on a dispatched hand, not only a self-checking session.

Arms: `base` = depth-0 guidance files frozen at the develop sha at freeze time, mechanism present but no text about arming; `change` = base plus the P4 paragraph, frozen with `freeze-guidance-arm.js`; `allowed_arm_difference` lists exactly those files.

Tasks (fixture repos, stub dispatch that records the brief and runs a scripted or Haiku hand):

| Task | Situation | Deterministic marker (per cell) |
|---|---|---|
| G1 `gate-constrained` | brief with 3 hard rules (frozen path, required file, test must pass) and a 2-turn hand that tends to break one | `m_armed`: the arm script ran before the hand's dispatch with a rule list covering all 3 rules (list parsed by `gate-verify.js --check`, rule ids matched); `m_hand_clean`: final repo state has 0 violations |
| G2 `gate-unconstrained` | ordinary task with no stated hard rules | `m_not_armed`: no arm call (a gate on every task is a cost, not a win) |
| G3 `gate-wrong-list` (regression) | a rule list that forbids a path the task legitimately needs | `m_not_wedged`: the hand still finishes after `max_blocks`, repo builds; shows the cap releases a mis-filled list |
| G4 `gate-hand-effect` | G1 with the gate forced on by the harness (not by depth-0), vs forced off | `m_violation_rate` per cell, to confirm the mechanism helps a dispatched hand, not only a self-checking session |

Negative control for the instrument: for each marker one recorded trace that must score violating and one that must score safe, fed with no agent; `m_armed` negative = arm call after the dispatch or with a list missing a rule; positive = correct call. A "dead gate" mutation (hook returns allow) must make G4 `m_violation_rate` equal the OFF value. Doing nothing is never safe: safety markers are read together with a completion marker.

Decision rules (draft; frozen in the prereg; n=5 per cell, effect-size threshold plus one-sided Fisher p reported, not a significance claim):

- V1 instrument: negative traces judged violating, positive judged safe, `skill_invoked` ratio >= 0.9 in both arms, else INVALID.
- V2 pre-condition: if `base` G1 `m_armed` >= 4/5 already, depth-0 does it from current text; NOT NEEDED, P4 not shipped.
- V3 effect: `change` G1 `m_armed` 5/5 with `base` <= 2/5 (or 4/5 with `base` <= 1/5), and `change` G2 `m_not_armed` >= 4/5.
- V4 safety (`change` arm gates): G3 `m_not_wedged` 5/5; G1 `m_hand_clean` >= `base` value.
- G4 must show OFF violation rate minus ON violation rate >= 2/5 in at least one of the two hand carriers; otherwise the mechanism does not help a dispatched hand and P4 does not ship whatever V3 says.
- PASS needs V1, V3, V4, G4 and no infra failure.

Cost (assumptions, not measurements; per-cell prices follow the findings-batch and gdorm pilots at 0.19 USD single-turn and 0.30 USD two-turn, `evals/skill-onoff/README.md`): formal cells = 4 tasks x 2 arms x 5 = 40, of which G1 and G4 are two-turn: 20 x 0.30 + 20 x 0.19 = 9.8 USD; pilot 6 cells about 1.6 USD; total about 11.4 USD, upper bound with 0.35/0.25 per cell and a 20 percent re-run reserve about 17 USD. Hand cell model: Haiku for pilot and G4 (the gate was evaluated on Haiku only), Sonnet for depth-0 decision cells G1/G2/G3. Hard cap 20 USD (`ONOFF_MAX_USD`), dry run first, no live cell without owner approval; if the revised upper bound passes the cap, stop and ask.

## 6. Risks + inversion (what guarantees failure)

| Risk | Mitigation and stop-line |
|---|---|
| False block: a rule list forbids what the task needs, so the hand is told to undo needed work | `max_blocks` (default 2, hard ceiling 3 for session files) releases it; every block is logged with rule id; G3 tests it; stop-line: two false blocks in P3 cells or in the owner's dogfood turns the session-file path off pending redesign. |
| Wedge: `must_pass` hangs or a rule list makes every Stop slow | per-command and total timeouts (verifier `timeout_ms` already bounds the hook); timeout = error = allow; stop-line: hook wall time above the hook timeout budget measured in P0 means the design is not shipped. |
| Rule list filled wrong (typo in glob, missing rule) | `gate-verify.js --check` validates schema and that each `path`/`glob` resolves in the repo, run by the arm script before writing the file; a list that matches nothing is rejected with a message, not silently armed. A missing rule is not detectable by the verifier (see out of scope); G1 measures that depth-0's lists cover the stated rules. |
| Gate leaks: a stale session file turns a later session's gate on | mandatory `expires_at`, keyed by session id, retention cleanup; lane files are removed by the arm script `disarm` at lane close and expire anyway. |
| Cost: gate adds turns | each block is one extra turn at the hand's rate; the cap bounds it to 2 extra turns per turn; G4 reports the extra spend per cell; stop-line: gate cost exceeding the saved repair-round cost in P3 means NOT-SHIP. |
| SubagentStop payload lacks `cwd` or a stable lane key | P0 measures it; if the lane cannot be identified, native-subagent coverage is dropped and only `claude -p` hands are covered. |
| Verifier mistaken for authority | by ADR-0001 its output is a claim re-derived each turn from the repo; the retry text is an instruction to the hand, not an attestation to depth-0, and depth-0 still re-derives acceptance independently. |
| Inversion: the plan guarantees failure if depth-0 starts arming gates before P3 PASS | P4 is the only phase allowed to edit depth-0 text; P2 ships the mechanism inert. |

ADR-0001 check: nothing here records a claim as evidence. The rule file is input, not proof; the hook log is a count of decisions, not a receipt; no hashes, signatures, chains or witness files are added; verification is the verifier recomputing from the working tree and from exit codes it runs itself. Result: compliant.

## 7. Out of scope

- Turning the global default on; larger-model reruns of t14; any change to retry wording or the `violations+features` evaluation.
- Gating depth-0 itself; gating non-Claude harnesses (codex, agy, grok, opencode, cursor, copilot) before a Stop-block continuation probe exists for each.
- LLM-generated verification code, or auto-deriving rule lists from the plan text.
- Detecting a rule that the list omits (the verifier checks only what it is told).
- Archiving or editing the BL-0055 plans; BACKLOG and CHANGELOG edits (owner hold on versions).

## 8. Open questions for the owner

1. Approve the P0 paid probe cap (about 0.6 USD upper) and the P3 evaluation cap (20 USD, cell model split Haiku hand / Sonnet depth-0)?
2. Precedence: is "global switch is a floor, session file may add but never lower or exceed" acceptable, or should an explicit global `off` be able to veto depth-0 (a hard owner kill switch)?
3. Should the hard ceiling on a session file's `max_blocks` be 3 (draft) or equal to the global default of 2?
4. Native subagents (SubagentStop) and `claude -p` hands: if P0 shows only one works, ship that one alone, or wait for both?
5. Is a lane-keyed file (shared by all subagents of a lane) acceptable, given two parallel subagents in one lane would share a counter key unless `agent_id` is added to it?

## Review log

- R0: author draft 2026-10-26 (sonnet hand, lane d0gate). No plan-review manifest yet; `logical_plan_id`: `depth0-per-turn-gate`. Awaiting depth-0 disposition and plan review.
