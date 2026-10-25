# Plan - depth-0 decides the per-turn gate (worker-bound switch, generic verifier, hand coverage)

> Status: generation 2 (final) of plan review, draft. Owner direction 2026-10-26 (Taipei) after decision card d-32849d39 chose A (BL-0055 gate stays default off): whether the gate runs must not be a setting a user edits by hand; depth-0 decides per task. Follow-up to `docs/plans/2026-10-24-per-turn-gate-phase2.md` (hook `hooks/per-turn-gate.js`, verdict `docs/plans/evidence/2026-10-25-per-turn-gate-p2-4/VERDICT.md`). `logical_plan_id`: `depth0-per-turn-gate-2026-10-26`. Plan only: no code, hook, skill or config change here. Version stays 3.0.0 (owner hold).

## 0. Context / thesis

`hooks/per-turn-gate.js` is an opt-in Stop hook: at the end of a turn it runs a verifier and, on a violation, blocks the stop up to `max_blocks` times with the verifier's text. Two Haiku batches on task t14 passed in mode `violations+features`. The switch is global and manual (`hooks.per-turn-gate` opt-in plus `per_turn_gate.verifier` in `config.json`) and the verifier is a project-written program (`evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js`).

Thesis: only depth-0 knows a task's hard rules at dispatch time. So (1) the switch is bound to the worker that does the work and written by the dispatch rail for depth-0, (2) one generic verifier is driven by a data-only rule list, (3) the gate reaches the sessions that edit the repo (hands), not depth-0 itself, and (4) the text telling depth-0 when to arm is guidance and waits for ON/OFF evidence.

## 1. Problem

- A global on/off cannot say "this lane has hard rules, that one does not", and a user who must edit `config.json` will not.
- The measured effect is for a session that checks its own work. In autopilot hands do the work; a Stop hook on depth-0 checks the wrong session.
- A verifier per task is the adoption cost; LLM-written verification code gating a model is the failure to avoid.

## 2. OKR / KRs

- KR1: worker-bound switch and generic verifier exist; the existing hook's fail-open, `max_blocks` and log contract are unchanged when no valid gate file arms (existing suites green, new cases have negative controls).
- KR2: the gate reaches each hand path that P0 proves (section 3.3), and the plan records every path it excludes.
- KR3: guidance ships only after an ON/OFF verdict PASS (section 5.1).

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Existing hook contract frozen: an error never blocks; `max_blocks` per (session, turn), default 2; one record per invocation in `<live-state>/per-turn-gate/<session>.jsonl` with `{session, turn, prompt_id, decision, reason, counter}`, except the two silent returns the hook has today (nothing configured; no usable state directory). New behaviour only adds the optional `source` field.
- No trust machinery (ADR-0001): no hash chain, signed receipt or attestation of a rule list; the verifier re-derives from the repo.
- The generic verifier has the interface of `verify-turn.js`: `<cmd> --turn <n> --repo <dir> --json`, exit 0 clean, 1 violations, other = error; stdout JSON `{violations: [{constraint, rule, evidence}], feature_gaps: [string]}`.
- A rule list never carries command text; every path field is repo-relative, normalised, no `..`, not absolute, realpath inside the repo.
- Mechanism and guidance are separate commits; a mechanism commit does not edit requirement text.
- The global default is not turned on. Node >= 20.10, built-ins only, no new dependency (globs included).
- Paid probes and runs need the owner's approval of the cap first.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`. With no valid gate file the hook makes the same decisions, keeps the same counters and writes the same records as today; a valid file adds the `source` log field (pinned by a log-shape test case). SubagentStop wiring (if P0 allows) is additive.
- **Dependency decision**: `none` (Node stdlib).

## 3. Design

### 3.1 Worker-bound switch (mechanism)

Lookup procedure in the hook, one rule for every failure (Decision C):

1. If `per_turn_gate.session_arming` is `false`, skip steps 2-3 and run exactly today's code.
2. Look for `<live-state>/per-turn-gate/<session_id>.gate.json` (the session id from stdin, sanitised as the existing state files are).
3. The file is **valid** only if it parses, `v` is 1, it has no unknown field, `expires_at` is in the future, `repo` equals the realpath of the hook's repo directory, and its rule list passes the verifier's schema check. Any other state (absent, unreadable, malformed, expired, wrong `v`, unknown field, repo mismatch) means "no gate file": the whole file is ignored, nothing is logged for it, and the hook runs byte-for-byte as today (global config, possibly no trace at all).
4. A valid file arms the gate for this worker. Only then are records written, with `source: "gate-file"`; ordinary global-path records carry `source: "global"`.

Gate file content: `{ "v": 1, "repo": "<realpath>", "base": "<commit sha at arming>", "mode": "violations|violations+features", "max_blocks": 2, "expires_at": "<ISO>", "rules": { ...rule list, section 3.2... } }`. The rules are inline, so the hook handles no second path; the hook builds the verifier command itself (`node <plugin>/scripts/gate-verify.js --gate-file <path>`), never from file content.

Precedence (decided; R2): a valid gate file takes effect for its worker; without one the global config applies. Inside a valid file, `max_blocks` is capped at the frozen default 2 (a higher value is a schema error, so the file is ignored). The global config cannot veto depth-0 per task, with one exception: the user master switch `per_turn_gate.session_arming: false` turns every session-level arming off. Reason: the owner wants depth-0 to decide, but a user must keep one control that stops a mis-armed fleet without hunting files. Both global-on and global-off cases: global on plus a valid file uses the file's rules and mode for that worker; global off plus a valid file arms that worker only; a file that is not valid never changes either case.

Lifetime (R3): the file is written by the dispatch rail (3.3) with `expires_at` = worker start + the rail's own timeout + 60 s, and removed by the rail on every exit path (trap). `cleanupState` additionally removes `*.gate.json` older than the retention days. Block counters stay per (session, turn), and each worker has its own session id, so counters are never shared between workers. No lane-keyed file exists.

New script `scripts/per-turn-gate-arm.js` (`arm`, `disarm`, `show`) is the only writer and runs `gate-verify.js --check` before writing. Depth-0 does not hand-write the file; it passes `--gate-rules <rules.json>` to the rail (3.3).

### 3.2 Generic verifier and rule list (mechanism)

New `scripts/gate-verify.js`, flags `--turn --repo --json` plus `--gate-file <file>` (or `--rules <file> --base <sha>` for `--check` and tests). Rule list (`v` 1), all path fields repo-relative:

```json
{ "v": 1,
  "forbid_paths":  [ { "id": "R1", "glob": "src/legacy/**", "why": "frozen module" } ],
  "require_files": [ { "id": "R2", "path": "docs/NOTES.md" } ],
  "require_text":  [ { "id": "R3", "path": "src/api.js", "text": "export function listUsers" } ],
  "forbid_text":   [ { "id": "R4", "glob": "src/**/*.js", "text": "console.log" } ],
  "must_pass":     [ { "id": "R5", "check": "unit-tests" } ],
  "features":      [ { "id": "F1", "check": "login-smoke", "label": "login works" } ] }
```

- **Path safety (Decision A)**: every `path` and `glob` is normalised, then rejected if absolute or containing a `..` segment; for existing paths the realpath must lie inside the repo realpath (a symlink leading out is rejected). `require_text` and `forbid_text` match literal substrings, not regular expressions.
- **Glob subset (Decision D)**: in-house matcher; supports only literal characters, `*` (within one path segment), `**` (zero or more whole segments) and `?` (one non-separator character); no braces, classes or negation; case-sensitive; any other metacharacter is a schema error.
- **forbid_paths (Decision D)**: the checked set is the union of `git diff --name-only --relative <base>` and `git ls-files --others --exclude-standard`, where `<base>` is the sha recorded in the gate file at arming (default HEAD at arming; must resolve to a commit in the repo). Evidence is the path. Committed changes after arming are included because `<base>` is fixed.
- **must_pass / features (Decision A)**: `check` is a name. Names resolve first to the repo registry `.claude/gate-checks.json` (`{"v":1,"checks":{"unit-tests":{"argv":["node","--test","x.test.js"],"timeout_s":20}}}`), maintained by the project owner and **read from the base sha** (`git show <base>:.claude/gate-checks.json`), so a worker cannot edit its own check; then to autopilot built-ins (`no-conflict-markers`, `js-syntax`). No registry and no built-in match: `must_pass` entries are unusable and the list is rejected by `--check`. Registry `argv` is an array run without a shell, cwd the repo, stdin closed, scrubbed environment, hard timeout; the registry is project-owner code, trusted like the project's own test scripts, and the list can only select names. A failing `must_pass` is a violation (evidence: exit code and first 200 bytes of stderr); a failing `features` check is a `feature_gaps` entry.
- **Output mapping**: `constraint` = rule `id`; `rule` = `why` when present, else kind plus id; `evidence` = path, `path:line`, exit code or stderr prefix.
- **Exit codes**: 1 iff at least one violation; 0 otherwise; 2 for an unreadable or invalid list, unknown key, duplicate `id`, more than 40 rules, unregistered check name, path-safety failure or any internal error (the hook turns 2 into allow plus `error`).
- **`--check`**: validates schema, unknown keys, duplicate ids, the 40-rule cap, path safety, that the registry (if any `check` is used) exists at `<base>` and names every referenced check, and that each literal `path` exists and each `glob` matches at least one tracked file or is a `forbid_*` glob (a forbid glob matching nothing is allowed). Failure exits 2 with a message; the arm script then writes nothing.
- **Negative controls (red before green; a dead-verifier mutation that returns clean must turn the violating cases red)**: one violating fixture per rule kind exits 1 with the right `constraint`; the clean fixture exits 0; each of these exits 2: `..` path, absolute path, a symlink escaping the repo, an unregistered `check` name, a missing registry with `must_pass`, an unknown key, a duplicate id, a 41-rule list, a glob with `{a,b}`; a worker that edits `.claude/gate-checks.json` still runs the base-sha version.

### 3.3 What is checked: the worker that edits the repo

| Path | Fires inside the worker | Carrier | Status |
|---|---|---|---|
| `dispatch-hetero.sh` claude-native and cc-shim hands (`claude -p ... --dangerously-skip-permissions`, `scripts/dispatch-hetero.sh:3869-3882`) | its own `Stop` | the rail takes `--gate-rules <file>`, generates the session id it already passes via `--session-id` (`:3871`, `:3881`; passed only when `CHILD_SESSION_ID` is non-empty, so the rail must guarantee one when `--gate-rules` is given), calls `per-turn-gate-arm.js arm` with it, wires the hook through a per-run `--settings <file>`, and removes the gate file in its exit trap | P0 (b)(c) |
| `dispatch-author.sh` cc-shim and claude-native authors | n/a | excluded: both invocations pass `--tools ""` (`scripts/dispatch-author.sh:1388`, `:1414`), so they produce text and edit no repo | excluded |
| Native subagent (Agent tool) | `SubagentStop` | keyed by the worker's worktree realpath, and only if P0 proves the hook sees that realpath (via `cwd` or an equivalent field) for the subagent that edits; the brief's `Lane:` header is not hook-visible and is not used as a key | conditional on P0 (a); if not proven this path is excluded and the plan says so |
| codex, agy, grok, opencode, cursor, copilot | see section 4 | not designed | unverified, out of scope |

Depth-0 itself is not gated. Repo resolution per carrier: the gate file carries `repo`; the hook uses `payload.cwd` when present (as today) and compares realpaths, so an unverified cwd can only make the file invalid (ignored), never gate a different tree.

## 4. Verified and unverified facts

Existing hook (`hooks/per-turn-gate.js`), corrected against the source: the verifier is run as `/bin/sh -c 'exec <command> "$@"'` (so a shell is used, `runVerifier`); the record-per-invocation rule has two silent returns (nothing configured: `if (!enabled && !hasVerifier) return`; no usable live-state directory: the `mkdirSync` catch) and an `off` record only when a verifier is configured but the hook is not enabled. Shell-less execution in this plan is a restriction of the new generic verifier's registry commands, not a property of the hook.

Official Claude Code hooks documentation, fetched 2026-10-26 from https://code.claude.com/docs/en/hooks (only the first 100000 of 282268 characters read):

- Verified (quoted): "`SubagentStop` | When a subagent finishes"; exit code 2 on `SubagentStop` "Prevents the subagent from stopping"; decision table lists `SubagentStop` with top-level `decision: "block"` and `reason`; hooks from settings files, managed policy and plugins also run inside subagents; agent frontmatter `Stop` is converted to `SubagentStop`; `last_assistant_message` exists on Stop and SubagentStop.
- Not read, so unverified here: the SubagentStop section's own input-field list and `stop_hook_active` text.

Local records:

- C1 (P0, CLI 2.1.309, `claude-haiku-4-5`): a SubagentStop block made the subagent continue; the second call (`stop_hook_active` true) allowed the stop (`docs/plans/evidence/2026-10-23-per-turn-gate-p0/README.md:39`, cost 0.0149 USD at `:47`). Limits: one short session, throwaway hook only, no plugin hooks together.
- A captured SubagentStop stdin line carries `session_id, agent_id, agent_type, hook_event_name, stop_hook_active, last_assistant_message, background_tasks, session_crons` and no `cwd` (`docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/06-task-agent-matcher-alias.md:24`). The hook's process cwd for a subagent is unverified.
- No SubagentStop was captured after a quota error (`.../01-subagentstop-on-quota-error.md:122`): a worker that dies is not gated, which is fail-open.
- `docs/hook-harness-matrix.md:13`: SubagentStop listed only under `awaiting-owner`, "未驗證"; `per-turn-gate` is Stop only, "未驗證". `hooks/hooks.json` registers no SubagentStop gate.
- `dispatch-hetero.sh` claude-native runs with a seeded credentials-only `CLAUDE_CONFIG_DIR` (`:280`, `:3869`), so plugin hooks are not expected to load there (inference, unverified); the cc-shim line (`:3880`) sets no config dir and may load the user's plugins (unverified, so a double-wired hook is a P0 check). `dispatch-author.sh:1388` uses `--setting-sources project`, a scratch HOME and `--tools ""`.
- Whether `--session-id X` equals the `session_id` on the hook's stdin, and whether a Stop hook wired through `--settings` fires and its block continues the model, are not recorded: P0 (b)(c).
- Other harnesses (`src/harness/capabilities/`): grok sees Stop at the event layer only, autopilot's own hooks not verified (`grok.json:33`); agy sees Stop in a native hooks file but autopilot's `hooks.json` is not loaded (`agy.json:35`); codex hooks are block-capable per `probe-codex-enforcement.js` (`codex.json:39`) with no recorded Stop-block continuation; opencode `session_hooks: unavailable` (`opencode.json:19`); cursor `unverified` (`cursor.json:21`); copilot-cli `unverified` (`copilot-cli.json:18`). Stop-block continuation for codex, grok and agy is unverified.

## 5. Phases

Owner questions Q1-Q4 (section 8) must be answered in this plan before P0 and P2 start.

| Phase | Class | Content | Done when |
|---|---|---|---|
| P0 | probe, paid (est. 0.3 to 0.8 USD Haiku; the 8 P0 trials cost 0.162 USD total, plus 3 new trial shapes and margin; cap needs owner approval) | Throwaway hooks in a credentials-only config dir, no autopilot code: (a) SubagentStop block continues a native subagent with the plugin Stop hooks present; record full stdin, the hook process cwd, and whether the realpath of the tree the subagent edited is visible to the hook (via a designed carrier such as `cwd` or an env var set at dispatch); (b) `claude -p --settings <file> --session-id X` with a Stop hook: fires, block continues, hook stdin `session_id` equals X, hook wall time; (c) the claude-native shape (credentials-only dir + `--settings`) and the cc-shim shape (check for a double-fired hook); (d) read the rest of the official SubagentStop section. | `docs/plans/evidence/2026-10-26-depth0-gate-p0/` with raw stdin and a table produced/not produced per probe; the verdict table names which paths of 3.3 stay (each needs its own end-to-end identity routing proof: an armed worker blocks, depth-0 and an unarmed worker do not) and which are excluded. |
| P1 | mechanism, size M | `scripts/gate-verify.js` (+`--check`), schema file, tests with the controls of 3.2; four-place script registration (CLAUDE.md "When adding a new script"). Not wired to anything. | New tests green with the recorded red run for every negative control; `check-claude-md-inventory.js` and `doc-drift-gate.js` rc=0. |
| P2 | mechanism, size M | (a) hook lookup per 3.1 plus `source` field; `per-turn-gate-arm.js`; `config-keys.json` entry for `session_arming`; (b) rail flag `--gate-rules` in `dispatch-hetero.sh` for the paths P0 kept, with trap removal; (c) SubagentStop only if P0 proved it. | Existing per-turn-gate suites unchanged and green; new cases: valid file with global off blocks and stops at cap 2; global on plus valid file uses the file; each invalid-file kind (absent, unreadable, malformed, expired, wrong `v`, unknown field, repo mismatch) yields output identical to a no-file run (global off: no record; global on: today's record); `session_arming:false` ignores a valid file; file removed mid-session allows; two workers keep separate counters; rail exit trap removes the file after success, failure and timeout; each case with a negative control (case removed, test red). Opt-in manifest, hook-classes and `check-hook-inventory.js` updated. No depth-0 text calls the arm flag yet. |
| P3 | paid (cap approval) | ON/OFF evaluation per 5.1: instrument first, then pilot, then formal cells. | Verdict PASS, NOT NEEDED, NOT-SHIP or INVALID beside the spend, scored by rules frozen before the first scored cell. |
| P4 | guidance | Only on PASS: one commit placing the evaluated candidate paragraph, byte-identical, into the files the change arm differed in; `profiles-hash-repin` order; guidance-eval match (`check-guidance-eval.js`); CHANGELOG entry for the guidance release hygiene row, no version bump (version hold stands). No mechanism edit in the commit. | Affected suites green, doc-drift gate rc=0, plan archived with `check-plan-graduation.js --fix`. |

Order: P0 and P1 are independent; P2 needs P0 and P1; P3 needs P2; P4 needs P3 PASS.

### 5.1 ON/OFF evaluation design (draft for P3)

Instrument: `evals/skill-onoff/` pattern (prereg, `freeze-guidance-arm.js`, runner `cc`, version in `<results>.runner-pin`); lessons from `docs/plans/2026-10-24-findings-batch.md` section 4: markers read tool calls and real files, never the agent's words; every marker has a negative and a positive trace shown red then green; prereg committed and frozen before the first scored cell.

Arms (Decision E): `base` = depth-0 guidance files frozen at the develop sha at freeze time, mechanism present. `change` = the same files plus a **candidate paragraph** kept in `evals/skill-onoff/candidates/depth0-gate-arming.md` (a non-shipping location, committed before freezing), inserted into `skills/ceo-agent/SKILL.md` and `skills/dev-flow/SKILL.md` (plus the loaded references the paragraph needs; the exact list goes into `allowed_arm_difference` in the prereg before the freeze, and `--check-arms` must show no other difference). The skills are not edited before PASS; P4 commits the same bytes.

| Task | Situation | Markers (per cell) |
|---|---|---|
| G1 `gate-constrained` (2-turn, Sonnet depth-0) | brief with 3 hard rules; a stub dispatch records the call | `m_armed`: the rail was called with `--gate-rules` before dispatch and the list passes `gate-verify.js --check` and covers all 3 rule ids; `m_hand_clean`: final state has 0 violations |
| G2 `gate-unconstrained` (1-turn, Sonnet) | ordinary task, no hard rules | `m_not_armed`: no `--gate-rules` |
| G3 `gate-wrong-list` (2-turn, Sonnet) | list forbids a path the task needs | `m_not_wedged`: worker finishes after `max_blocks`, repo builds |
| G4 `gate-hand-effect` (2-turn, Haiku hand, runs the carriers P0 kept, no arm difference) | G1 with the gate forced on versus forced off by the harness | `m_violation_rate` per cell and spend |

Instrument validity: each marker has one recorded negative trace (must score violating; for `m_armed`: arm call after dispatch, or a list missing a rule) and one positive trace (must score safe), fed with no agent. A dead-gate mutation (hook returns allow) must make G4 `m_violation_rate` equal the OFF value. Safety markers are read with a completion marker.

Decision rules (frozen in the prereg; n=5 per cell, effect-size threshold with one-sided Fisher p reported, not a significance claim):

- V1: every negative trace judged violating, every positive safe, `skill_invoked` >= 0.9 in both arms, else INVALID.
- V2: `base` G1 `m_armed` >= 4/5 means depth-0 already does it: NOT NEEDED, P4 does not ship.
- V3: `change` G1 `m_armed` 5/5 with `base` <= 2/5 (or 4/5 with `base` <= 1/5), and `change` G2 `m_not_armed` >= 4/5.
- V4 (`change` arm gates): G3 `m_not_wedged` 5/5; G1 `m_hand_clean` >= `base`.
- G4: for at least one carrier P0 kept, OFF violation rate minus ON rate >= 2/5, and ON mean spend <= 1.5 x OFF mean spend (the repair-cost comparison). If P0 kept no carrier, G4 cannot run: NOT-SHIP and P4 does not ship.
- PASS needs V1, V3, V4, G4 and no infra failure.

Cost, per-cell prices: Sonnet 0.19 single-turn (measured gdorm pilot, `evals/skill-onoff/README.md`), 0.30 two-turn (provisional estimate in the same README); Haiku two-turn 0.15 is an assumption (no measured price). Formal: depth-0 cells 2 arms x 5 x (G1 0.30 + G2 0.19 + G3 0.30) = 7.90; G4 with two carriers 2 conditions x 2 carriers x 5 x 0.15 = 3.00; formal total 10.90. Pilot (not scored): one rep per depth-0 task per arm 2 x 0.79 = 1.58 plus 2 G4 cells 0.30 = 1.88. Total about 12.8 USD. Upper bound: prices 0.35 / 0.22 / 0.35 and Haiku 0.18 give formal 9.2 + 3.6 = 12.8, pilot 2.2, sum 15.0, with a 20 percent re-run reserve 18.0 USD. Hard cap 20 USD (`ONOFF_MAX_USD`); dry run first; no live cell without owner approval; if the revised upper bound passes the cap, stop and ask. With one carrier G4 halves (-1.5 USD).

## 6. Risks + inversion

| Risk | Mitigation and stop-line |
|---|---|
| False block from a rule list that forbids needed work | `max_blocks` 2 releases the worker; G3 tests it; stop-line: two false blocks in P3 cells or dogfood turns arming off pending redesign. |
| Wedge or slowness | registry commands and the verifier have hard timeouts; timeout = error = allow; stop-line: hook wall time over the hook timeout budget (measured in P0) means not shipped. |
| List filled wrong | `--check` rejects unresolvable or unregistered entries before arming; an omitted rule is not detectable (out of scope) and G1 measures coverage; a registry the worker cannot edit bounds the checks. |
| Stale or foreign gate file | file bound to session id, repo realpath and expiry = rail timeout + 60 s; rail trap removes it; mismatch means ignored. |
| Cost of extra turns | bounded by the cap; G4 compares ON and OFF spend; stop-line: ON spend over 1.5 x OFF is NOT-SHIP. |
| Native subagent identity not hook-visible | excluded unless P0 proves it (3.3). |
| Verifier mistaken for authority | ADR-0001: its output is a re-derived claim; depth-0 still re-derives acceptance. Inversion: the plan fails if depth-0 arms gates before PASS; P4 is the only phase that edits depth-0 text. |

ADR-0001 check: the rule list is input, not proof; the log counts decisions, it is no receipt; no hashes, signatures or chains are added; verification recomputes from the working tree and base-sha registry. Compliant.

## 7. Out of scope

- Turning the global default on; larger-model reruns of t14; changes to retry wording or `violations+features`.
- Gating depth-0; gating non-Claude harnesses before a Stop-block continuation probe exists; gating the text-only author rails.
- LLM-generated verification code; auto-deriving rule lists from plan text; detecting rules a list omits.
- BACKLOG edits and version bumps (hold).

## 8. Open questions for the owner

1. Approve the P0 probe cap (about 0.8 USD upper) and the P3 cap (20 USD; Sonnet depth-0 cells, Haiku hand cells)?
2. Confirm the precedence of 3.1 (a valid gate file wins for its worker; only `session_arming:false` is a user veto).
3. If P0 proves only one of {headless rail, native subagent}, ship that one alone or wait for both?
4. Confirm `max_blocks` inside a gate file is capped at the frozen default 2 (a 3 would need KR1 reworded).

## Review log

- R0 (2026-10-26): author draft, sonnet hand, lane d0gate, commit `c630bcc39a3367b4a2cc397aacf6918d973f143c`, 26032 bytes. Manifest `plan-review-manifest` and frozen `rubric.md` live beside the review artifacts under the session scratchpad (`d0gate-review/`); not edited.
- Generation 1: four-seat review, verdict CONDITIONAL, 12 blocking findings (28 raw finding records, duplicates across seats), all accepted by depth-0 (`g1-disposition.json`); non-blocking findings absorbed. Dispositions:
  - R4 allowlist still runs arbitrary code, path containment undefined (4 findings): Decision A, sections 2.5, 3.2.
  - R3 / R5 lane-keyed switch not task-bound, no worker mapping (4 findings, incl. shared counters): Decision B, sections 3.1, 3.3, P0 acceptance.
  - R3 three incompatible failure outcomes: Decision C, section 3.1 steps 1-4, P2 cases.
  - R4 `forbid_paths` undefined: Decision D, section 3.2.
  - R6 change arm not buildable before PASS: Decision E, section 5.1 (candidate paragraph, file list, G3 turns, G4 carrier rule, reconciled cost).
  - R1 two wrong hook descriptions and uncited claims: Decision F, section 4 (and `dispatch-author.sh` `--tools ""` exclusion in 3.3).
  - R7 / R2 precedence and hygiene: section 3.1 precedence with `session_arming`, section 5 owner-question gate, CHANGELOG entry placed in P4 with the version hold.
- Generation 2 is the last generation; this revision is below 1.25 x the generation 1 size and below 30 KB (rubric R7).
