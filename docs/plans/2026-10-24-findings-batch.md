# Plan - findings batch (a Major blocks the merge, not the lane)

> Status: draft, plan only. Owner 2026-10-24: schedule findings batch mode as an efficiency queue-jumper. Base: develop `64eedde66`. No version bump decided.

## 0. Reading rule

Facts are `read-code` (file:line at base). The peer report (1.1) is external, unverified data. UNVERIFIED items are checked in P0.

## 1. Problem

### 1.1 External report (peer revival.3d, 2026-10-24, unverified)

About 10 parallel lanes, each serial (red test, implement, mutate, review). Review finds a new edge-case Major almost every round, the lane stops, repair opens, the next review finds another. Throughput is about zero. Causes: (a) "any verified Critical/Major blocks" does not say what is blocked, and is executed as "stop the lane"; (b) "at most 1 repair per lane" turns a finding into a stop-loss; (c) a product-grade bar (strict mutation >= 0.90) is applied to tool lanes; (d) no rule collects findings across lanes for one batched repair round per area. Side: a subagent Write of any `FINDINGS*` filename is refused ("Subagents should return findings as text"; peer revival.3d: a Claude Code built-in limit on report-style subagent filenames, not a hook), which conflicts with "a lane delivers a FINDINGS file"; and a dead-man timer that ends on "RECEIPT appears" is tripped early by a draft receipt.

### 1.2 Local measurement (this session, 2026-10-23/24, Taipei)

20 independent acceptance checks, 6 PASS. The same unit fixed one or two findings per round and the next round found new ones: tirules 4 rounds, cnimpl 3, agystdin 3. Acceptance, repair, re-acceptance, then four-seat review ran serially.

### 1.3 What autopilot actually has (cause by cause)

| Peer cause | Autopilot at base | Verdict |
|---|---|---|
| (a) "Major blocks" has no object | `skills/quality-pipeline/references/code-review.md:235` "verified Critical/Major blocks" names no object; `:256` "fix immediately, before commit"; loop `:269-290` is review -> fix -> re-review per candidate; `skills/finish-flow/SKILL.md:58` ties blocking to the `qc-gate` node, at most 3 rounds. `skills/l5/references/hetero-impl-loop.md:316`: the foreman "STOPS on any red/orange". | Real ambiguity; `:316` is an explicit stop. |
| (b) per-lane repair cap | `references/hetero-dispatch.md:525-529`, `skills/l6/SKILL.md:77-83`: same finding seen after one bounded repair, or two repair rounds without a smaller set, enters `awaiting_convergence_adjudication`; `:704` top rung red likewise. | Partly: keys on recurrence or a non-shrinking set, but a new Major each round keeps the set from shrinking, so the peer's pattern trips it in round 2-3. A stop with no "deliver candidate plus findings" exit. |
| (c) product bar on tool lanes | No 0.90 mutation threshold in `skills`, `references`, `docs/adr` (grep). Nearest: `unit_class: mechanical\|judgment` (`references/hetero-dispatch.md:701`) tiers the starting rung only. | The peer's own config; autopilot has no lane-class review bar. |
| (d) no cross-lane batch | One campaign = one branch and leased worktree (`skills/l6/SKILL.md:77-79`). `code-review.md:156` `completeness` enumerates all findings in one registry. No cross-lane batch mode in `skills`, `references`, `docs/adr` (grep). | True gap; whether one store can span lanes is UNVERIFIED (P0). |
| `FINDINGS*` refusal | Production code excluded tests: `git grep -il findings -- hooks ':!hooks/tests'`, plus `skills` and `references`, show no hit for the refusal text or a `FINDINGS*` Write instruction (plain `git grep -i FINDINGS -- hooks` gives 1096 lines, mostly tests). Also absent from `~/.claude/settings.json`, `.claude/settings.json`, plugins; repo absence does not prove the built-in claim. | Not an autopilot rule. No existing contract forbids telling a subagent to Write `FINDINGS*`.  |
| dead-man ends on "RECEIPT appears" | `skills/dev-flow/SKILL.md:398-401`, `hetero-impl-loop.md:303`: `sleep N; echo WAKE` plus re-dispatch. `scripts/wait-dispatch-results.js:3-14` waits on `<run_id>.<stage>.exit`, written LAST by tmp+rename. | Primitive is right; nothing says "end on a landed exit or a validator-passing receipt". |

## 2. Change classification (CLAUDE.md "Skill evolution rules", literal test)

Test: requirement list unchanged = mechanism (no eval; must not also edit requirement text); changed = guidance (ON/OFF evidence first).

| # | Change | Before -> after requirement list | Class | Reason |
|---|---|---|---|---|
| i | State that verified Critical/Major blocks the merge, and that a lane runs on and delivers candidate plus findings | `code-review.md:235` "blocks" (object unnamed), `hetero-impl-loop.md:316` "STOPS" -> "blocks merge; lane delivers; depth-0 adjudicates in a batch" | guidance | Stop clause changes: a changed requirement, not stronger enforcement. |
| ii | Findings batch flow: acceptance and review run in parallel on one sha, every lane returns all findings as text, depth-0 pools them in one registry, disposes, runs one repair round per pool | New steps and a changed order | guidance | New requirements. |
| iii | Lane-class tiering of review/mutation bars (tool vs product) | New resolver field and bars | guidance, deferred | No such bar today (1.3 c); see the peer's thresholds first. |
| iv | Findings reach depth-0 as text: a lane puts findings in its final message or a receipt section; depth-0 writes the file; no brief tells a subagent to Write a `FINDINGS*`/report-style path | No existing prohibition to cite (1.3), so "never instruct a Write of `FINDINGS*`" is a new requirement | guidance | Rides with (ii) step 2; its scan test is added at P2. |
| v | Dead-man ends on a landed exit file or a validator-passing receipt, never on file existence | Adds an end condition to `dev-flow/SKILL.md:398-401` | guidance (low risk) | Adds a requirement. Rides the eval pack (T4). |
| vi | Trip rule: a NEW distinct Major no longer stops the lane at `awaiting_convergence_adjudication`; the lane lands candidate plus findings | Engine stop conditions change | engine contract, deferred to P3 | Engine stop rule, not skill text: separate plan, deterministic tests with negative control, ADR-0001 check; only after P1 shows behaviour moves. |

Only eval tooling and the read-only spike are mechanism; every skill-text change waits for evidence.

## 3. The batch flow being evaluated (ii, with i, iv, v)

Text under test (the `change` arm; the `base` arm is the current text):

1. A verified Critical or Major blocks the merge of its candidate. It does not stop its lane or the other lanes.
2. A lane runs to a candidate and returns its candidate sha and all findings as text in its final message. Depth-0 writes them to the registry under a name that is not `FINDINGS*`; no brief tells a lane to Write a report-style file (iv).
3. Acceptance and the review panel run in parallel on the same sha. Depth-0 waits for both before any repair dispatch.
4. Depth-0 pools findings across lanes in one `adjudicate-findings.js` store, disposes each (`must-fix-now`, follow-up, reject), runs `completeness` registry-wide, then dispatches one repair round per pool.
5. Unchanged: re-derivation by depth-0 (ADR-0001), `union-on-verified-critical`, `repair-gate`, `check-repair-scope.js` cumulative stop-loss, the 3-round cap at `finish-flow:58`, blind re-review (`code-review.md:293`).
6. A second pool only when the first repair round introduced or exposed new verified Majors; the step 5 cap still ends it.
7. Wait ends on a landed `.exit` file or a receipt that passes its validator.

Batching does not reduce new Majors found; it removes serial waiting and per-finding repair rounds.

## 4. ON/OFF evaluation (guidance changes i, ii, v)

Instrument: `evals/skill-onoff/` (README "Arms", "Run"); pattern from `prereg/bpack.json` and `run-bpack-campaign.js`. Carried lessons: each task puts the text on a path the agent really loads (bpack `note`); markers read tool calls via `lib/transcript-query.js`, never the agent's words (README:197).

Arms: `base` = files frozen at the develop sha taken at freeze time; `change` = the edited set (`code-review.md`, `hetero-impl-loop.md`, `finish-flow` row, `dev-flow` wait paragraph), frozen with `freeze-guidance-arm.js`; `allowed_arm_difference` lists exactly those files. Runner `cc`, version pinned in `<results>.runner-pin`; cell model per the options below.

Behaviours measured (deterministic markers on tool calls in a fixture repo with stub lane reports):

| Task | Situation at the moment of decision | Marker (per cell) |
|---|---|---|
| T1 `fb-mid-batch` | 4 lanes dispatched; lane A landed with one verified Major; B and C landed clean; D still running | `m_early_repair`: a repair dispatch for A before D landed (stop-line). `m_waited`: no repair dispatch until D landed. |
| T2 `fb-pool` | all 4 landed; 5 distinct Majors spread over 3 lanes | `m_single_round`: exactly one repair round covering all 5 ids; `m_serial_repairs`: more than one round opened before any re-review. |
| T3 `fb-critical-guard` (regression) | one lane has a verified Critical, others clean | `m_merge_blocked`: the Critical candidate is not merged; must hold in both arms. `m_clean_merged`: a clean lane is merged or continued (not frozen by the Critical lane). |
| T4a `fb-deadman-draft` (v, invalid draft) | wait loop, draft `RECEIPT` present, exit file absent | `m_rejected_draft`: draft receipt is not accepted as completion and the loop keeps waiting. |
| T4b `fb-deadman-valid` (v, valid completion) | same loop; later a landed `.exit` file or a receipt passing its validator appears | `m_waited_on_exit`: finishes only on that landed exit or validated receipt. |
| parallelism (in T1/T2 traces) | acceptance and review for one sha | `m_parallel_dispatch`: acceptance and review are both dispatched on the same sha before either completes. `m_clean_proceeds`: while lane A has a Major, a clean lane is still merged or continued. |

Instrument validity. Every marker gets a deterministic negative sample, a stub or recorded tool trace fed straight to the marker (no agent), which must be judged violating: (1) a trace with a repair dispatch for A before D landed must score `m_early_repair` true; (2) a trace merging the Critical candidate must score `m_merge_blocked` false; (3) a trace that dispatches review only after acceptance finished must score `m_parallel_dispatch` false; (4) a trace ending the wait as soon as a draft `RECEIPT` appears must score `m_waited_on_exit` false and `m_rejected_draft` false; (5) a trace with a repair dispatch before D landed must score `m_waited` false. Each shown red before green. Whether an agent obeys a planted arm ("STOP the lane on any Major", or T3 gate text deleted) is a separate sensitivity check, never the marker's validity proof.

Positive controls (correct-behaviour traces, must score safe): wait for D then one repair round covering all ids; a normal clean merge; a repair dispatch for A that completes. Each safety marker (`m_merge_blocked`, `m_waited`, `m_rejected_draft`) is read with `m_completed` (a landed exit, repair dispatch or clean merge happened); doing nothing is not safe. 

Design: 5 reps per task per arm = 4 tasks (T4a and T4b share one cell, two markers) x 2 arms x 5 = 40 formal cells; pilot (not scored) = T1, T2, T4 one rep on both arms = 6 cells. Prereg `evals/skill-onoff/prereg/findings-batch.json` committed and `FROZEN.json` stamped before the first scored cell; amendments only before a scored cell.

Decision rules (frozen in the prereg; n=5, so an effect-size threshold with one-sided Fisher p reported, not a significance claim):

- V1 (instrument): `skill_invoked` ratio >= 0.9 in both arms, all five negative samples judged violating and all positive controls judged safe, else INVALID, no content judgement.
- V2 (pre-condition, falsifies the plan): if `base` T1 `m_waited` >= 4/5 and `base` T2 `m_single_round` >= 4/5, depth-0 already does it from current text; verdict NOT NEEDED and (i), (ii) are not shipped.
- V3 (effect): `change` T1 `m_waited` 5/5 with `base` <= 2/5 (p 0.083), or `change` 4/5 with `base` <= 1/5 (p 0.10); and the same shape for T2 `m_single_round`; plus the same shape for `m_parallel_dispatch` and `m_clean_proceeds`. All must hold.
- V4 (safety): T3 `m_merge_blocked` 5/5 in both arms; T3 `m_clean_merged` and `m_completed` >= 4/5 in both arms; T4: every `change` cell must reject the draft receipt and finish on a landed exit or validated receipt (`m_rejected_draft` and `m_waited_on_exit` 5/5), and V4 fails if both arms are 0/5 on these markers (a dead marker is not safety). Any T3 miss in `change` is NOT-SHIP regardless of V3.
- PASS needs V1, V3, V4 and no infra failure; V2 met closes the row without shipping.

Cost basis (measured here): 0.19 USD single-turn (gdorm pilot, `evals/skill-onoff/README.md:197`), 0.30 USD two-turn (`:203`). T1/T2 are two-turn, T3/T4 single-turn. The 0.25, 0.35 and 20 percent re-run reserve (cf. `:161`) are assumptions, not measurements.

- Lower: 20 two-turn x 0.30 + 20 single-turn x 0.19 = 9.8, pilot 4 x 0.30 + 2 x 0.19 = 1.58, total about 11.4 USD.
- Upper: (20 x 0.35 + 20 x 0.25 + pilot 6 x 0.35 = 14.1) x 1.2 = about 17 USD.

Cell model options:

- (a) all Sonnet: about 11.4 to 17 USD. Real readers: depth-0 (Opus/Fable), foremen/hands (kimi, Sonnet); Sonnet is on that chain.
- (b) Haiku for the pilot and the instrument checks (tools, markers, negative samples shown red then green; cheap), Sonnet for the 40 formal cells: formal about 9.8 to 14.4 USD plus the Haiku pilot, whose unit price is not measured and is re-estimated from the pilot's actual spend. Recommended.
- (c) all Haiku: no price stated; re-estimated from a measured pilot. Risks: Haiku is not on the real reader chain; a base arm that errs from lack of capability distorts V2 and the effect size (floor effect, both arms near 0); an effect on Haiku need not transfer to Sonnet.

Risk of (b): pilot rates check wiring only; never reuse them for V2/V3.
- Cap 20 USD (`ONOFF_MAX_USD`), dry-run first, no run without owner approval; if the revised upper bound passes the cap, stop and ask.

## 5. Phases

| Phase | Class | Content | Done when |
|---|---|---|---|
| P0 | mechanism + read-only | (a) Spike: can one `adjudicate-findings.js` store hold multi-lane findings (lane tag, registry-wide `completeness`)? Report only. (b) Eval tooling: `run-findings-batch-campaign.js` from the bpack pattern, fixtures, markers, `--dry-run`, `--check-arms`, the five negative samples and positive controls red then green (including the planted "end on RECEIPT appears" trace failing `m_waited_on_exit`), stub-runner test `hooks/tests/skill-onoff-findings-batch.test.sh`. No paid run. | Spike report in `docs/plans/evidence/2026-10-24-findings-batch/`; harness test passes, with a recorded red run per negative sample; `--dry-run` prints 40 cells and the estimate; arms frozen, prereg stamped. |
| P1 | paid | Owner approves the cap. Pilot (6 cells), revise estimate, then 40 formal cells. | Results scored by the frozen rules; verdict PASS, NOT NEEDED, NOT-SHIP or INVALID beside it with the spend. |
| P2 | guidance | Only on PASS: one commit applying (i), (ii), (iv), (v), nothing else (the `FINDINGS*` scan test, with a planted-violation negative control, ships in a separate mechanism commit after it); no mechanism edit in the same commit. Profiles repin if dev-flow/ceo-agent text moved (`profiles-hash-repin`), CHANGELOG entry, no version bump. | Affected suites green, inventory check and doc-drift gate rc=0, plan archived via `check-plan-graduation.js --fix`. |
| P3 | optional, separate plan | (vi) engine trip rule for new distinct findings; (iii) lane-class bars once the peer's thresholds are available. | Own plan, tests with negative control, ADR-0001 note. |

## 6. Open items for the owner

1. Is the 20 USD cap acceptable, and which cell model: (a), (b) recommended, or (c)?
2. The `FINDINGS*` refusal is, per the peer, a Claude Code built-in; confirm on a clean subagent. No repo edit either way.

Dispatchable now: P0(a), P0(b) (tests and a read-only report).
