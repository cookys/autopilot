# Plan - depth-0 decides the per-turn gate (worker-bound switch, generic verifier, hand coverage)

> Status: frozen (depth-0 terminal ruling after generation 2; P0 waits for the owner to approve the paid probe). Owner direction 2026-10-26 (card d-32849d39, A: default off): depth-0, not a user setting, decides per task. Follow-up to `docs/plans/2026-10-24-per-turn-gate-phase2.md` (hook `hooks/per-turn-gate.js`, verdict `docs/plans/evidence/2026-10-25-per-turn-gate-p2-4/VERDICT.md`). `logical_plan_id`: `depth0-per-turn-gate-2026-10-26`. Plan only: no code, hook, skill or config change. Version stays 3.0.0 (owner hold).

## 0. Context / thesis

`hooks/per-turn-gate.js` is an opt-in Stop hook: at the end of a turn it runs a verifier and, on a violation, blocks the stop up to `max_blocks` times. Two Haiku batches on task t14 passed in mode `violations+features`. The switch is global and manual and the verifier project-written (`evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js`).

Thesis: only depth-0 knows a task's hard rules at dispatch time. So the switch binds to the worker, one generic verifier reads a data-only rule list, the gate reaches the hands (not depth-0), and the text telling depth-0 when to arm is guidance that waits for ON/OFF evidence.

## 1. Problem

- A global on/off cannot say which lane has hard rules.
- The measured effect is for a self-checking session; hands do the work, so a Stop hook on depth-0 checks the wrong session.
- A verifier per task is the adoption cost; LLM-written verification code is the failure to avoid.

## 2. OKR / KRs

- KR1: worker-bound switch and generic verifier exist; the existing hook's fail-open, `max_blocks` and log contract are unchanged when no valid gate file arms (existing suites green, new cases have negative controls).
- KR2: the gate reaches each hand path P0 proves (3.3); every excluded path is recorded.
- KR3: guidance ships only after an ON/OFF verdict PASS (section 5.1).

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Existing hook contract frozen: an error never blocks; `max_blocks` per (session, turn), default 2; one record per invocation in `<live-state>/per-turn-gate/<session>.jsonl` with `{session, turn, prompt_id, decision, reason, counter}`, except the two silent returns the hook has today (nothing configured; no usable state directory). With no valid gate file the record is byte-identical to today (no `source` key); only a record written because a valid gate file armed the gate gains one optional field, `source` (`session` or `subagent`).
- No trust machinery (ADR-0001): no hash chain, signed receipt or attestation of a rule list; the verifier re-derives from the repo.
- The generic verifier has the interface of `verify-turn.js`: `<cmd> --turn <n> --repo <dir> --json`, exit 0 clean, 1 violations, other = error; stdout JSON `{violations: [{constraint, rule, evidence}], feature_gaps: [string]}`.
- A rule list never carries command text; every path field is repo-relative, normalised, no `..`, not absolute, realpath inside the repo.
- Mechanism and guidance are separate commits; a mechanism commit does not edit requirement text.
- The global default is not turned on. Node >= 20.10, built-ins only, no new dependency (globs included).
- Paid probes and runs need the owner's cap approval first.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`. With no valid gate file the hook decides, counts and logs exactly as today; a valid file adds the optional `source` field to its own records only (log-shape test). SubagentStop wiring (if P0 allows) is additive.
- **Dependency decision**: `none` (Node stdlib).

## 3. Design

### 3.1 Worker-bound switch (mechanism)

Lookup in the hook, one failure rule (Decision C) and one log contract (Decision H):

1. If `per_turn_gate.session_arming` is `false`, run exactly today's code. The knob defaults to allowed: absent or `true` permits arming; only an explicit `false` vetoes.
2. Compute the key. A Stop payload without `agent_id` uses `<session_id>.gate.json`; a `SubagentStop` payload with `agent_id` uses `<session_id>.<agent_id>.gate.json` only (Decision I). Both ids must match `^[A-Za-z0-9-]{1,128}$`, else there is no gate file. The lookup is a `stat`/read of that one path under `resolveLiveDir().base/per-turn-gate`; it never creates a directory or file, so a globally-off run with no gate file leaves the live-state tree untouched and keeps today's silent return.
3. The file is **valid** only if every field below passes; anything else (absent, unreadable, malformed JSON, expired, wrong type, unknown field, repo or base mismatch) means the whole file is ignored, nothing is logged for it, and the hook runs byte-for-byte as today.
   - `v`: integer 1. `repo`: absolute string equal to the realpath of `payload.cwd` (the same value the hook passes as `--repo`, `hooks/per-turn-gate.js:413`; `process.cwd()` when `cwd` is absent). `base`: 40-hex string that resolves to a commit in that repo. `mode`: `"violations"` or `"violations+features"`. `max_blocks`: integer 0 to 2 (the frozen default 2 is the ceiling). `expires_at`: ISO string in the future. `rules`: object passing the verifier schema check (3.2). No other field.
4. A valid file arms the gate for this worker; the hook then runs the verifier with `AUTOPILOT_GATE_FILE=<path>` in its environment, building the command itself as `node '<plugin>/scripts/gate-verify.js'`; the gate-file path is never put in the `/bin/sh -c` string (Decision K). Records written for an armed run carry `source` (`session` or `subagent`); records of any other run are unchanged.

Precedence (decided; R2): a valid gate file takes effect for its worker; without one the global config applies, as today. Global on plus a valid file uses the file's rules and mode for that worker; global off plus a valid file arms that worker only. The global config cannot veto depth-0 per task, except the user master switch `session_arming:false`, which stops every session-level arming; a user keeps one control that stops a mis-armed fleet.

Lifetime (R3): the rail (3.3) writes the file with `expires_at` = worker start + the rail's own timeout + 60 s and removes it on every exit path (trap); `cleanupState` removes `*.gate.json` older than the retention days. Counters are per (session, turn) as today; every worker has its own session id (rail case) or its own (session, agent) key (subagent case), so counters are never shared. No lane-keyed file exists.

Native subagent arming (Decision I): the Agent call returns an agent id; depth-0 immediately runs `per-turn-gate-arm.js arm --agent <id>`, writing `<session_id>.<agent_id>.gate.json`. Depth-0's own Stop has no `agent_id` and so can never load a worker's file (negative control in P2). Race: a worker that stopped before the file was written was allowed (fail-open, accepted). P0 must prove the id in the Agent result equals the hook payload's `agent_id` (sibling subagents get distinct ids); without that proof the subagent path is excluded.

`scripts/per-turn-gate-arm.js` (`arm`, `disarm`, `show`) is the only writer and runs `gate-verify.js --check` first. Depth-0 does not hand-write the file.

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

- **Path safety (Decision A)**: every `path` and `glob` is normalised, then rejected if absolute or containing a `..` segment; the deepest existing ancestor's realpath must lie inside the repo realpath (a symlink leading out is rejected). `require_files` may name a file that does not exist yet: arming checks shape and containment only, and the verifier reports a violation until it exists. `require_text` and `forbid_text` match literal substrings, not regular expressions.
- **Glob subset (Decision D)**: in-house matcher; supports only literal characters, `*` (within one path segment), `**` (zero or more whole segments) and `?` (one non-separator character); no braces, classes or negation; case-sensitive; any other metacharacter is a schema error.
- **forbid_paths (Decision D)**: the checked set is the union of `git diff --name-only --relative <base>` and `git ls-files --others --exclude-standard`, where `<base>` is the sha recorded in the gate file at arming (default HEAD at arming; must resolve to a commit in the repo). Evidence is the path. Committed changes after arming are included because `<base>` is fixed.
- **must_pass / features (Decision A)**: `check` is a name. Names resolve first to the repo registry `.claude/gate-checks.json` (`{"v":1,"checks":{"unit-tests":{"argv":["node","--test","x.test.js"],"files":["x.test.js"],"timeout_s":20}}}`), maintained by the project owner and **read from the base sha** (`git show <base>:.claude/gate-checks.json`), so a worker cannot edit its own check; then to autopilot built-ins (`no-conflict-markers`, `js-syntax`). No registry and no built-in match: `must_pass` entries are unusable and the list is rejected by `--check`. Registry `argv` is an array run without a shell, stdin closed, scrubbed environment, hard timeout. **Base-bytes execution (Decision M, closes 807aa9db)**: every file the check runs (the script and each test or helper it needs) must be listed in the entry's literal `files` array; before each run the verifier exports exactly those files with `git show <base>:<path>` into a fresh temp directory outside the worker tree, runs `argv` with that directory as cwd and the worker repo path in `AUTOPILOT_GATE_REPO`, and deletes the directory afterwards. So a worker that rewrites `x.test.js` in its tree cannot change what runs. The exported check reading the worker's modified product code is intended, because that code is what is being checked. A listed file missing at `<base>`, or an `argv` path that is not an exported file, a built-in or a bare interpreter name, is exit 2. Autopilot built-ins run from the plugin directory and need no export. The registry owner is trusted like the project's test scripts. A failing `must_pass` is a violation (evidence: exit code and first 200 bytes of stderr); a failing `features` check is a `feature_gaps` entry.
- **Output mapping**: `constraint` = rule `id`; `rule` = `why` when present, else kind plus id; `evidence` = path, `path:line`, exit code or stderr prefix.
- **Exit codes**: 1 iff at least one violation; 0 otherwise; 2 for an unreadable or invalid list, unknown key, duplicate `id`, more than 40 rules, unregistered check name, a `files` entry missing at `<base>`, an `argv` path that is not an exported file, a built-in or a bare interpreter name, path-safety failure or any internal error (the hook turns 2 into allow plus `error`).
- **`--check`**: validates schema, unknown keys, duplicate ids, the 40-rule cap, path safety, that the registry (if any `check` is used) exists at `<base>` and names every referenced check, that every `files` entry of each referenced check exists at `<base>`, that `argv` points only at exported files, built-ins or a bare interpreter name, and that `require_text` paths exist at `<base>`. Existence of `require_files` targets and matches of globs are not required. Failure exits 2; the arm script then writes nothing.
- **Negative controls (red before green; a dead-verifier mutation that returns clean must turn the violating cases red)**: one violating fixture per rule kind exits 1 with the right `constraint`; a `require_files` target absent at arming passes `--check`, then exits 1 until the file is created, then 0; the clean fixture exits 0; each of these exits 2: `..` path, absolute path, a symlink escaping the repo, an unregistered `check` name, a missing registry with `must_pass`, an unknown key, a duplicate id, a 41-rule list, a glob with `{a,b}`; a worker that edits `.claude/gate-checks.json`, the listed test or the check script (including making it exit 0 or exit 1) still gets the base version run and the same verdict; a `files` entry missing at base exits 2; an `argv` naming a path outside the exported files exits 2; the temp directory is removed.

### 3.3 What is checked: the worker that edits the repo

Every rail that edits the repo or launches Claude is listed (KR2):

| Path | Decision | Carrier and reason |
|---|---|---|
| `dispatch-hetero.sh` claude-native and cc-shim hands (`claude -p --dangerously-skip-permissions`, `scripts/dispatch-hetero.sh:3869-3882`) | included, if P0 (b)(c) produce | with `--gate-rules <file>` the rail mints a **fresh** session id per dispatch (refusing the dispatch if it cannot), passes it as `--session-id`, calls `per-turn-gate-arm.js arm` with it, and removes the file in its exit trap. Today `--session-id` is passed only when `CHILD_SESSION_ID` is non-empty (`:3871`, `:3881`). Wiring: claude-native (credentials-only config dir; plugin hooks not expected to load, unverified) gets the Stop hook via a per-run `--settings` file naming the on-disk hook by absolute path (it finds `gate-verify.js` from its own `__dirname`, not `CLAUDE_PLUGIN_ROOT`). cc-shim (no config dir; may load user plugins, unverified): if P0 (c) shows the plugin hook already fires, the rail only arms the file; otherwise it wires like claude-native. The hook is idempotent per (session, turn) under the counter lock, so double wiring still blocks at most `max_blocks` times per turn with one record per invocation. |
| `dispatch-author.sh` (cc-shim, claude-native) | excluded | both pass `--tools ""` (`scripts/dispatch-author.sh:1388`, `:1414`): text only, no repo edits |
| `dispatch-review.sh`, `dispatch-consult.sh` | excluded | verdicts and opinions, not repo edits |
| `dispatch-explore.sh` | excluded | read-only by contract (`scripts/dispatch-explore.sh:40`) |
| `dispatch-foreman.sh` | excluded | non-Claude (kimi) foreman; its nested hetero hands follow the first row |
| `dispatch-batch.sh` | excluded | artifact rail over `dispatch-hetero.sh`; no `claude -p` of its own |
| Native subagent (Agent tool) | conditional on P0 (a) | `SubagentStop`, keyed `(session_id, agent_id)` as in 3.1; excluded unless P0 proves the Agent-result id equals the hook's `agent_id` |
| codex, agy, grok, opencode, cursor, copilot | excluded | no Stop-block continuation evidence (section 4) |

Depth-0 itself is not gated. Repo resolution: the file carries `repo`; an unverified `cwd` can only make the file invalid, never gate a different tree.

## 4. Verified and unverified facts

Existing hook (`hooks/per-turn-gate.js`), checked against the source: the verifier runs as `/bin/sh -c 'exec <command> "$@"'` (`runVerifier`, a shell is used); the one-record rule has two silent returns (nothing configured; no usable live-state directory) and an `off` record only when a verifier is configured but the hook is not enabled. Shell-less execution here is a property of the new verifier's registry commands only.

Official hooks documentation, fetched 2026-10-26, https://code.claude.com/docs/en/hooks (first 100000 of 282268 characters read):

- Verified (quoted): "`SubagentStop` | When a subagent finishes"; exit code 2 on `SubagentStop` "Prevents the subagent from stopping"; the decision table lists `SubagentStop` with top-level `decision: "block"` and `reason`; settings, managed-policy and plugin hooks also run inside subagents; agent frontmatter `Stop` becomes `SubagentStop`.
- Unverified (not read): the SubagentStop section's input-field list and `stop_hook_active` text.

Local records:

- C1 (P0, CLI 2.1.309, `claude-haiku-4-5`): a SubagentStop block made the subagent continue; the second call (`stop_hook_active` true) allowed the stop (`docs/plans/evidence/2026-10-23-per-turn-gate-p0/README.md:39`, cost 0.0149 USD at `:47`). Limits: one short session, throwaway hook only, no plugin hooks together.
- A captured SubagentStop stdin line (parent `session_id` plus `agent_id`) carries `session_id, agent_id, agent_type, hook_event_name, stop_hook_active, last_assistant_message, background_tasks, session_crons` and no `cwd` (`docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/06-task-agent-matcher-alias.md:24`). The subagent hook's cwd is unverified.
- In a **simulated** rate-limit run (proxy-injected error; the note's own verdict is "SIMULATED, not a true quota error", `.../01-subagentstop-on-quota-error.md:124`) no SubagentStop followed SubagentStart (`:122`). A real quota error is unverified; the fail-open inference applies only to that observed simulation.
- `docs/hook-harness-matrix.md:13`: SubagentStop only under `awaiting-owner`, "未驗證"; `per-turn-gate` is Stop only, "未驗證"; `hooks/hooks.json` has no SubagentStop gate.
- `dispatch-hetero.sh` claude-native uses a seeded credentials-only `CLAUDE_CONFIG_DIR` (`:280`, `:3869`; plugin hooks not expected to load, unverified); the cc-shim line (`:3880`) sets none and may load user plugins (unverified; double wiring is a P0 check).
- Whether `--session-id X` equals the `session_id` on the hook's stdin, and whether a Stop hook wired through `--settings` fires and its block continues the model, are not recorded: P0 (b)(c).
- Other harnesses (`src/harness/capabilities/`): grok sees Stop at the event layer only (`grok.json:33`); agy sees Stop in a native hooks file, autopilot's `hooks.json` not loaded (`agy.json:35`); codex hooks are block-capable (`codex.json:39`) with no recorded Stop-block continuation; opencode `session_hooks: unavailable` (`opencode.json:19`); cursor and copilot-cli `unverified` (`cursor.json:21`, `copilot-cli.json:18`). Stop-block continuation for codex, grok and agy is unverified.

## 5. Phases

Owner questions Q1-Q4 (section 8) must be answered in this plan before P0 and P2 start.

| Phase | Class | Content | Done when |
|---|---|---|---|
| P0 | probe, paid (est. 0.3 to 0.8 USD Haiku, from the 0.162 USD the 8 earlier P0 trials cost; owner approves the cap) | Throwaway hooks in a credentials-only config dir, no autopilot code: (a) SubagentStop block continues a native subagent with the plugin Stop hooks present; record full stdin including the parent `session_id` and the subagent's `agent_id`, and whether the agent id in the Agent tool result equals the hook payload's `agent_id` ; (b) `claude -p --settings <file> --session-id X` with a Stop hook: fires, block continues, hook stdin `session_id` equals X, hook wall time, the on-disk hook launched by absolute path; (c) the claude-native shape (credentials-only dir + `--settings`) and the cc-shim shape (check for a double-fired hook); (d) read the rest of the official SubagentStop section. | `docs/plans/evidence/2026-10-26-depth0-gate-p0/` with raw stdin and a table produced/not produced per probe; the verdict table names which paths of 3.3 stay (each needs a routing proof: an armed worker blocks; depth-0 and an unarmed worker do not) and which are excluded. |
| P1 | mechanism, size M | `scripts/gate-verify.js` (+`--check`), schema file, tests with the controls of 3.2; four-place script registration (CLAUDE.md "When adding a new script"). Not wired to anything. | New tests green with the recorded red run for every negative control; `check-claude-md-inventory.js` and `doc-drift-gate.js` rc=0. |
| P2 | mechanism, size M | (a) hook lookup per 3.1, env-var verifier path, `source` field; `per-turn-gate-arm.js`; `config-keys.json` entry for `session_arming` (default allowed); (b) rail flag `--gate-rules` in `dispatch-hetero.sh` for the paths P0 kept, fresh session id, trap removal; (c) SubagentStop keyed `(session_id, agent_id)` only if P0 proved the id. | Existing per-turn-gate suites unchanged and green; new cases: valid file with global off blocks and stops at cap 2; global on plus valid file uses the file; each invalid-file kind (absent, unreadable, malformed, expired, wrong `v`, unknown field, repo mismatch, missing `base` or `rules`, `mode` outside the enum, `max_blocks` above 2, `base` not a commit) yields output and records identical to a no-file run, same six fields, no `source` key, and no new live-state entry on a globally-off run; a hostile session id (space, quote, semicolon, over 128 chars) yields no gate file and no shell effect; `session_arming:false` ignores a valid file; a file removed mid-session allows; the rail exit trap removes the file after success, failure and timeout; two concurrent hands get distinct ids, files and counters, and the rail refuses to arm when it cannot mint an id; depth-0 Stop with a subagent file present allows; for **each included carrier, in its real launch shape with a fake `claude`**, the production hook plus `gate-verify.js` runs and blocks once, then stops at the cap; each case with a negative control (case removed, test red). Opt-in manifest, hook-classes and `check-hook-inventory.js` updated. No depth-0 text calls the arm flag yet. |
| P3 | paid (cap approval) | ON/OFF evaluation per 5.1: instrument first, then pilot, then formal cells. | Verdict PASS, NOT NEEDED, NOT-SHIP or INVALID beside the spend, scored by rules frozen before the first scored cell. |
| P4 | guidance | Only on PASS: one commit placing the evaluated candidate paragraph, byte-identical, into the files the change arm differed in; `profiles-hash-repin` order; guidance-eval match (`check-guidance-eval.js`); CHANGELOG entry for the guidance release hygiene row, no version bump (version hold stands). No mechanism edit in the commit. | Affected suites green, doc-drift gate rc=0, plan archived with `check-plan-graduation.js --fix`. |

Order: P0 and P1 are independent; P2 needs P0 and P1; P3 needs P2; P4 needs P3 PASS.

### 5.1 ON/OFF evaluation design (draft for P3)

Instrument: `evals/skill-onoff/` pattern (prereg, `freeze-guidance-arm.js`, runner `cc`; lessons from `docs/plans/_archive/2026/10/2026-10-24-findings-batch.md` section 4): markers read recorded tool calls and files, never the agent's words; prereg frozen before the first scored cell. `skill_invoked` is the existing manipulation-check column (`evals/skill-onoff/README.md:72`), measured per cell from the runner transcript (guidance file loaded).

Arms (Decision E): `base` = depth-0 guidance files frozen at the develop sha, mechanism present. `change` = the same plus a candidate paragraph kept in `evals/skill-onoff/candidates/depth0-gate-arming.md` (committed before freezing), inserted into `skills/ceo-agent/SKILL.md` and `skills/dev-flow/SKILL.md` and the loaded references it needs; the exact list goes into `allowed_arm_difference` and `--check-arms` must show no other difference. P4 commits the same bytes.

| Task | Situation | Marker (recorded stub-dispatch argv, or files) | Negative trace (must score violating) | Positive trace (must score safe) |
|---|---|---|---|---|
| G1 constrained (2-turn, Sonnet) | brief with 3 hard rules | `m_armed`: argv has `--gate-rules <f>`, `<f>` passes `gate-verify.js --check`, covers all 3 rule ids | call after dispatch, or a list missing a rule | correct call before dispatch |
| G2 unconstrained (1-turn, Sonnet) | no hard rules | `m_not_armed`: a recorded dispatch argv exists and its flag set omits `--gate-rules` | recorded argv with the flag | recorded argv without it |
| G3 wrong list (2-turn, Sonnet) | list forbids a needed path | `m_not_wedged`: worker finishes after `max_blocks` and the repo builds | worker still blocked after the cap | finished after 2 blocks |
| G4 hand effect (2-turn, Haiku, each carrier P0 kept, ON versus OFF forced by the harness) | G1 task, real hand | `m_hand_clean` and `m_violation_rate` per cell, plus spend | dead-gate mutation (hook always allows): ON rate must equal OFF | working gate: ON rate lower |

Decision table (n=5 per cell; copied verbatim into the prereg before the first scored cell). Evaluate top to bottom; the first matching row is the verdict; a combination no row names is NOT-SHIP.

| Condition (in order) | Verdict |
|---|---|
| V1 fails: any marker negative not judged violating or positive not safe, `skill_invoked` < 0.9 in either arm, or an infra failure | INVALID |
| V2: `base` G1 `m_armed` >= 4/5 | NOT NEEDED (P4 does not ship) |
| P0 kept no carrier (G4 cannot run) | NOT-SHIP |
| V3 and V4 and G4 all hold | PASS |
| anything else | NOT-SHIP |

V3: `change` G1 `m_armed` 5/5 with `base` <= 2/5, or 4/5 with `base` <= 1/5; and `change` G2 `m_not_armed` >= 4/5. V4 (`change` arm): G3 `m_not_wedged` 5/5. G4: for at least one kept carrier, OFF `m_violation_rate` minus ON >= 2/5 and ON mean spend <= 1.5 x OFF; `m_hand_clean` is read only here. One-sided Fisher p is reported, not claimed. Doing nothing is never safe: `m_not_armed` needs a recorded dispatch, and safety markers are read with a completion marker. The P3 prereg must contain: the exact fixture matrix, the rule lists, the mechanism that forces ON/OFF, and how the violation rate is scored (G3 and G4 cell details are frozen there, not here).

Cost (Sonnet 0.19 single-turn measured, 0.30 two-turn provisional, `evals/skill-onoff/README.md`; Haiku two-turn 0.15 assumed): depth-0 cells 2 x 5 x (0.30 + 0.19 + 0.30) = 7.90; G4 with two carriers 2 x 2 x 5 x 0.15 = 3.00; pilot 1.88; about 12.8 USD. Upper bound (0.35 / 0.22 / 0.35, Haiku 0.18) 15.0, x 1.2 reserve = 18.0. Hard cap 20 USD (`ONOFF_MAX_USD`), dry run first, no live cell without owner approval.

## 6. Risks + inversion

| Risk | Mitigation and stop-line |
|---|---|
| False block from a list that forbids needed work | `max_blocks` 2 releases the worker; G3 tests it; stop-line: two false blocks in P3 or dogfood turn arming off. |
| Wedge or slowness | hard timeouts; timeout = error = allow; stop-line: hook wall time over the hook timeout budget (P0) means not shipped. |
| List filled wrong | `--check` rejects unresolvable or unregistered entries, missing `files` and unexported `argv` paths before arming; an omitted rule is not detectable (out of scope) and G1 measures coverage; a registry and check files run from base bytes (3.2) bound the checks. |
| Worker rewrites its own check | registered checks run from files exported from `<base>` outside the worker tree (3.2); P1 negative control; reading the worker's product code is intended. |
| Stale or foreign gate file | bound to session id (and agent id), repo realpath, expiry = rail timeout + 60 s; rail trap removes it; mismatch means ignored. |
| Cost of extra turns | bounded by the cap; G4 stop-line: ON spend over 1.5 x OFF is NOT-SHIP. |
| Native subagent id mismatch or race (worker stops before the file exists) | key is `(session_id, agent_id)`; excluded unless P0 proves id equality; a lost race allows (fail-open). |
| Verifier mistaken for authority | ADR-0001: its output is a re-derived claim; depth-0 still re-derives acceptance. Inversion: failure if depth-0 arms before PASS; only P4 edits depth-0 text. |

ADR-0001 check: the rule list is input, not proof; the log counts decisions, it is no receipt; no hashes, signatures or chains; verification recomputes from the working tree and base-sha registry. Compliant.

## 7. Out of scope

- Turning the global default on; larger-model t14 reruns; changes to retry wording or `violations+features`.
- Gating depth-0; gating the rails marked excluded in 3.3; gating non-Claude harnesses before a Stop-block continuation probe exists; gating the text-only author rails.
- LLM-generated verification code; auto-deriving rule lists; detecting omitted rules; BACKLOG edits and version bumps (hold).

## 8. Open questions for the owner

1. Approve the P0 probe cap (about 0.8 USD upper) and the P3 cap (20 USD; Sonnet depth-0 cells, Haiku hand cells)?
2. Confirm the precedence of 3.1 (a valid gate file wins for its worker; only an explicit `session_arming:false` is a user veto; absent means allowed).
3. If P0 proves only one of {headless rail, native subagent}, ship that one alone or wait for both?
4. Confirm `max_blocks` inside a gate file is capped at the frozen default 2 (a 3 would need KR1 reworded).

## Review log

- R0 (2026-10-26): author draft, commit `c630bcc39a3367b4a2cc397aacf6918d973f143c`. Manifest and frozen `rubric.md`: session scratchpad `d0gate-review/` (not copied).
- Generation 1: four-seat review, verdict CONDITIONAL, 28 findings (11 blocking, 17 non-blocking; 28 distinct fingerprints), all 28 accepted by depth-0 (11 accepted_blocker, 17 accepted_nonblocking; `docs/plans/2026-10-26-depth0-per-turn-gate.g1-artifact.json` and `.g1-disposition.json`). Folded: allowlist and containment (R4) Decision A, 2.5, 3.2; lane-keyed switch and worker mapping (R3, R5) Decision B, 3.1, 3.3, P0; failure outcomes (R3) Decision C, 3.1; `forbid_paths` (R4) Decision D, 3.2; change arm (R6) Decision E, 5.1; hook description errors (R1) Decision F, section 4, 3.3; precedence and hygiene (R7, R2) 3.1, section 5.
- Generation 2 (revision `19f6535541718bd7f738ff76ab9a71ec437b4812`): CONDITIONAL, terminal (generation cap). 21 findings (6 blocking, 15 non-blocking), all 21 accepted by depth-0 (`docs/plans/2026-10-26-depth0-per-turn-gate.g2-artifact.json` and `.g2-disposition.json`), accept-and-fold.  **Frozen on: depth-0 terminal ruling, residual blockers all accept-and-fold.**
  - Blocking: `ac91d647`, `812b0128` to 2.5, 2.6, 3.1, P2 (H); `2c4a86de` to 3.3, P2 (J); `d1769c7a`, `794e1ad6` to 5.1 (L); `1d264a27` to 3.1, 3.3 (I).
  - Non-blocking (15), folded: `d0459a09` 3.2; `91084427`, `291a234f` 3.1, P0; `5742ecb7` section 4; `64ea9b3e` 3.1; `bf01a8c7` 3.3; `90904efa`, `cd1529e0` 5.1; `d76eeeb6`, `a8fc7eef` 3.3, P2; `49d23e9a`, `47a09554`, `a1ec5c5e` 3.1; `782b81c6` 3.1, 2.5; `4b8658a9` 3.1.
- Pre-merge review, gen 1 (4 FIX-THEN-SHIP): counts corrected from the stored JSON; `807aa9db` folded into 3.2 Decision M and section 6; 5.1 names what the P3 prereg contains.
- Pre-merge review, gen 2 (2 FIX, 2 SHIP): `e93b9ada` the "doing nothing is never safe" rule restored in 5.1, with other normative text deleted by compression restored (`--check-arms`, sibling ids, "unchanged", arm-script-writes-nothing, C1 and simulation limits); `8f85c35a`, `bbc9ab44` Decision M exit-2 reasons synced to Exit codes, `--check`, section 6 and the P1 controls; `e4cd0133` typo. `rubric.md` and manifest untouched.
