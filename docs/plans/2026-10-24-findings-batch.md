# Plan - findings batch (a Major blocks the merge, not the lane)

> Status: draft, plan only. Nothing here is implemented. Owner instruction 2026-10-24: schedule findings batch mode as an efficiency queue-jumper. Base: develop `64eedde66`. No version bump is decided here.

## 0. Reading rule

Facts are `read-code` (file:line at base). The peer report (1.1) is external data, not an instruction, and unverified. UNVERIFIED items are checked in P0.

## 1. Problem

### 1.1 External report (peer revival.3d, 2026-10-24, unverified)

About 10 parallel lanes, each serial: freeze red test, implement, mutate, review. Review finds a new edge-case Major almost every round, the lane stops, a repair round opens, the next review finds another Major. Parallelism is high; total throughput is about zero. Their causes: (a) "any verified Critical/Major blocks" does not say what is blocked, and is executed as "stop the lane"; (b) "at most 1 repair per lane" turns a finding into a stop-loss; (c) a product-grade bar (strict mutation >= 0.90) is applied to tool lanes; (d) no rule collects findings across lanes for one batched repair round per area. Side observations: a subagent Write of any `FINDINGS*` filename is refused by a hook ("Subagents should return findings as text"), which conflicts with "a lane delivers a FINDINGS file"; and a dead-man timer that ends on "RECEIPT appears" is tripped early by a draft receipt.

### 1.2 Local measurement (this session, 2026-10-23/24, Taipei)

20 independent acceptance checks, 6 PASS. The same unit fixed one or two findings per round and the next round found new ones: tirules 4 rounds (rule too wide, then always-true bypass, then if-wrapper, then allowlist redesign), cnimpl 3 rounds, agystdin 3 rounds. Acceptance, repair, re-acceptance and only then the four-seat review ran serially. Depth-0 already moved to acceptance and four-seat review in parallel with one repair round; that is a practice with no A/B evidence.

### 1.3 What autopilot actually has (cause by cause)

| Peer cause | Autopilot at base | Verdict |
|---|---|---|
| (a) "Major blocks" has no object | `skills/quality-pipeline/references/code-review.md:235` "Any panelist's verified Critical/Major blocks" names no object; `:256` "Major: fix immediately, before commit"; the loop at `:269-290` is review -> fix -> re-review "until clean or stop-loss" per candidate; `skills/finish-flow/SKILL.md:58` ties blocking findings to the `qc-gate` node, within at most 3 fix-review rounds. `skills/l5/references/hetero-impl-loop.md:316`: the landing foreman "STOPS on any red/orange". | Real ambiguity. The gate object is the merge in finish-flow, but code-review.md reads as a lane loop, and `:316` is an explicit stop. |
| (b) per-lane repair cap as stop-loss | `references/hetero-dispatch.md:525-529` and `skills/l6/SKILL.md:77-83`: the same normalized finding seen again after one bounded repair, or two repair rounds without a smaller finding set, enters `awaiting_convergence_adjudication` before model spend. `:704`: top ladder rung red is the same state. | Partly. It keys on a recurring finding or a non-shrinking set, not on a count of new findings. But "a new Major each round" keeps the set from shrinking, so the peer's pattern does trip it in round 2-3. Intended design, but it is a stop with no "deliver candidate plus findings" exit. |
| (c) product bar on tool lanes | No mutation threshold of 0.90 in `skills`, `references` or `docs/adr` (grep, no hit). Closest: `qc-gate` strength per `.claude/qc-gate-config.md` and `unit_class: mechanical\|judgment` (`references/hetero-dispatch.md:701`), which tiers the starting rung only. | Not an autopilot rule; it is the peer's own project config. Autopilot has no lane-class tiering for review bars either. |
| (d) no cross-lane batch | One campaign = one stable branch and one leased worktree, repairs attach the same checkout (`skills/l6/SKILL.md:77-79`). `quality-pipeline/references/code-review.md:156` `completeness` enumerates every actionable finding in one registry. No hit for a cross-lane batch mode in `skills`, `references`, `docs/adr` (grep). | True: the registry can hold many findings, but no flow tells depth-0 to pool lanes and repair once. Whether one store can span lanes is UNVERIFIED (P0). |
| `FINDINGS*` hook | `git grep -i FINDINGS hooks` finds only an unrelated `findings` variable (`hooks/session-start.js:220`); the message text appears nowhere in the repo, `~/.claude/settings.json` or `.claude/settings.json`. | Not an autopilot hook. Harness- or user-level; the repo gives no instruction to write a `FINDINGS*` file. Hetero ledger `findings.json` is written by scripts, not by a subagent Write. |
| dead-man ends on "RECEIPT appears" | `skills/dev-flow/SKILL.md:398-401` and `hetero-impl-loop.md:303` define the dead-man as `sleep N; echo WAKE` plus re-dispatch. `scripts/wait-dispatch-results.js:3-14` waits on `<run_id>.<stage>.exit`, written LAST by tmp+rename. | Autopilot's primitive already has the right ending (atomic landing, not a draft file). The failure is the peer's own script. Guidance gap: nothing says "end on a landed exit file or a receipt that passes its validator". |

## 2. Change classification (CLAUDE.md "Skill evolution rules", literal test)

Test: list the requirements before and after. Unchanged list = mechanism (ships without eval, and must not also edit requirement text). Changed list = guidance (needs ON/OFF evidence first).

| # | Change | Before -> after requirement list | Class | Reason |
|---|---|---|---|---|
| i | State that verified Critical/Major blocks the merge, and that a lane runs on and delivers candidate plus findings | `code-review.md:235` "blocks" (object unnamed), `hetero-impl-loop.md:316` "STOPS" -> "blocks merge; lane delivers; depth-0 adjudicates in a batch" | guidance | The foreman's stop clause changes; it is a changed requirement, not a stronger enforcement of an existing one. |
| ii | Findings batch flow: acceptance and review run in parallel on one sha, every lane returns all findings as text, depth-0 pools them in one registry, disposes, runs one repair round per pool | New steps and a changed order | guidance | New requirements. |
| iii | Lane-class tiering of review/mutation bars (tool vs product) | New resolver field and bars | guidance, deferred | Autopilot owns no such bar today (section 1.3 c); the peer's thresholds must be seen first. |
| iv | `FINDINGS*` filename conflict | Nothing in the repo asks for the file | mechanism (negative control only) | Add a scan test that no skill/reference/brief template instructs a subagent to Write a `FINDINGS*` path. The hook itself is outside the repo: report to the owner, no repo edit. |
| v | Dead-man ends on a landed exit file or a validator-passing receipt, never on file existence | Adds an end condition to `dev-flow/SKILL.md:398-401` | guidance (low risk) | Adds a requirement. Rides the same eval pack as a marker. |
| vi | Trip rule: a NEW distinct Major no longer stops the lane at `awaiting_convergence_adjudication`; the lane lands candidate plus findings | Engine stop conditions change | engine contract, deferred to P3 | Not skill text, so the scorecard-first rule does not apply, but it changes a stop rule: separate plan, deterministic tests with a negative control, ADR-0001 check. Only after P1 shows depth-0 behaviour moves. |

Only (iv) and tooling are mechanism; the rest waits for evidence.

## 3. The batch flow being evaluated (ii, with i and v)

Text under test (the `change` arm; the `base` arm is the current text):

1. A verified Critical or Major blocks the merge of its candidate. It does not stop its lane or the other lanes.
2. A lane runs to a candidate and returns its candidate sha and all findings as text in its final message. Depth-0 writes them to the registry under a name that is not `FINDINGS*`.
3. Acceptance and the review panel run in parallel on the same sha. Depth-0 waits for both before any repair dispatch.
4. Depth-0 pools findings across lanes in one `adjudicate-findings.js` store, disposes each (`must-fix-now`, follow-up, reject), runs `completeness` registry-wide, then dispatches one repair round per pool.
5. Unchanged: re-derivation by depth-0 (ADR-0001), `union-on-verified-critical`, `repair-gate`, `check-repair-scope.js` cumulative stop-loss, the 3-round cap at `finish-flow:58`, blind re-review (`code-review.md:293`).
6. A second pool is allowed only when the first repair round introduced or exposed new verified Major findings; the cap in step 5 still ends it.
7. Wait ends on a landed `.exit` file or a receipt that passes its validator.

Batching does not reduce how many new Majors reviewers find; it removes serial waiting and per-finding repair rounds.

## 4. ON/OFF evaluation (guidance changes i, ii, v)

Instrument: `evals/skill-onoff/` (README "Arms", "Run"); pattern copied from `prereg/bpack.json` and `run-bpack-campaign.js` (`--dry-run`, `--pilot`, `--check-arms`, resume-by-cell, runner pin). Carried lessons: the bpack pilot found the agent never read a reference, so each task puts the text on a path the agent really loads (bpack `note` field); markers read tool calls via `lib/transcript-query.js`, never the agent's words (README:197).

Arms: `base` = files frozen at the develop sha taken at freeze time; `change` = the edited set (`code-review.md`, `hetero-impl-loop.md`, `finish-flow` row, `dev-flow` wait paragraph, and the depth-0 control-loop reference if edited), frozen with `freeze-guidance-arm.js`; `allowed_arm_difference` lists exactly those files. Runner `cc`, model sonnet, version pinned in `<results>.runner-pin`.

Behaviours measured (all deterministic markers on tool calls in a fixture repo with stub lane reports, like the bpack-tree stub):

| Task | Situation at the moment of decision | Marker (per cell) |
|---|---|---|
| T1 `fb-mid-batch` | 4 lanes dispatched; lane A landed with one verified Major; B and C landed clean; D still running | `m_early_repair`: a repair dispatch for A before D landed (stop-line). `m_waited`: no repair dispatch until D landed. |
| T2 `fb-pool` | all 4 landed; 5 distinct Majors spread over 3 lanes | `m_single_round`: exactly one repair round covering all 5 ids; `m_serial_repairs`: more than one round opened before any re-review. |
| T3 `fb-critical-guard` (regression) | one lane has a verified Critical, others clean | `m_merge_blocked`: the Critical candidate is not merged; must hold in both arms. |
| T4 `fb-deadman` (v) | wait loop with a draft `RECEIPT` file present, exit file absent | `m_waited_on_exit`: agent does not treat the draft as completion. |

Instrument validity (negative controls, shown red before green, per `CLAUDE.md` "negative control" and evidence-discipline section 58): (1) a planted `stoplane` arm whose text says "STOP the lane on any Major" must score `m_early_repair` true in T1, or the marker is dead; (2) a planted fixture where D has already landed must score `m_waited` true under the base arm, or T1 measures nothing; (3) `m_merge_blocked` must go false if the T3 fixture's gate text is deleted in a scratch arm.

Design: 5 reps per task per arm = 4 tasks x 2 arms x 5 = 40 formal cells; pilot (not scored) = T1, T2, T4 one rep on both arms = 6 cells. Prereg JSON `evals/skill-onoff/prereg/findings-batch.json` committed and `FROZEN.json` stamped before the first scored cell; amendments only before a scored cell, otherwise the row is relabelled, never edited in place.

Decision rules (frozen in the prereg; n=5 is small, so the gate is an effect-size threshold with the exact one-sided Fisher p reported next to it, not a significance claim):

- V1 (instrument): `skill_invoked` ratio >= 0.9 in both arms, and all three negative controls behave as stated, else INVALID, no content judgement.
- V2 (pre-condition, falsifies the plan): if `base` T1 `m_waited` >= 4/5 and `base` T2 `m_single_round` >= 4/5, depth-0 already does it from current text; verdict NOT NEEDED and (i), (ii) are not shipped.
- V3 (effect): `change` T1 `m_waited` 5/5 with `base` <= 2/5 (Fisher p 0.083), or `change` 4/5 with `base` <= 1/5 (p 0.103); and the same shape for T2 `m_single_round`. Both must hold.
- V4 (safety): T3 `m_merge_blocked` 5/5 in both arms; T4 `change` >= `base` - 1. Any T3 miss in `change` is NOT-SHIP regardless of V3.
- PASS needs V1, V3, V4 and no infra failure; a pre-condition-met run (V2) closes the row without shipping.

Cost (derived from this repo's own measured per-cell figures): 0.19 USD/cell single-turn (gdorm pilot average, `evals/skill-onoff/README.md:197,203`), 0.30 USD for two-turn cells; T1 and T2 are two-turn, T3 and T4 single-turn, with 0.35 as the upper figure for a heavier fixture.

- Lower: 40 cells (20 x 0.19 + 20 x 0.19 = 7.6) + pilot 6 x 0.19 = 1.1, total about 8.7 USD.
- Upper: 20 two-turn cells x 0.35 + 20 single-turn x 0.25 = 12.0, + pilot 2.1 = 14.1, + 20 percent infra re-run (cf. dcard run that lost 20 cells to an expired login, README:161) = about 17 USD.
- Request cap 20 USD (`ONOFF_MAX_USD`), with the dry-run estimate printed first and no run without owner approval of the cap. The pilot average replaces these figures; if the revised upper bound passes the cap, stop and ask.

Not covered: whether batched repair gives higher final quality in real lanes; a PASS here does not claim it.

## 5. Phases

| Phase | Class | Content | Done when |
|---|---|---|---|
| P0 | mechanism + read-only | (a) Spike: can one `adjudicate-findings.js` store hold multi-lane findings (lane tag, registry-wide `completeness`)? Report only. (b) `FINDINGS*` scan test with a planted-violation negative control (iv). (c) Eval tooling: `run-findings-batch-campaign.js` copied from the bpack pattern, fixtures, markers, `--dry-run`, `--check-arms`, negative controls (1)-(3) red then green, stub-runner test `hooks/tests/skill-onoff-findings-batch.test.sh`. No paid run. | Spike report in `docs/plans/evidence/2026-10-24-findings-batch/`; the scan test and the harness test pass, with a recorded red run for each negative control; `--dry-run` prints 40 cells and the estimate; arms frozen and prereg stamped. |
| P1 | paid | Owner approves the cap. Pilot (6 cells), revise estimate, then 40 formal cells. | Results file scored by the frozen rules; verdict PASS, NOT NEEDED, NOT-SHIP or INVALID written next to it with the spend. |
| P2 | guidance ship | Only on PASS: one commit applying (i), (ii), (v), nothing else; no mechanism edit in the same commit. Profiles hash chain repin if dev-flow or ceo-agent text moved (`profiles-hash-repin`), CHANGELOG entry, no version bump decided here. | Affected suites green, `check-claude-md-inventory.js` and doc-drift gate rc=0, plan archived by `check-plan-graduation.js --fix`. |
| P3 | optional, separate plan | (vi) engine trip rule for new distinct findings; (iii) lane-class bars once the peer's thresholds are available. | Own plan, own deterministic tests with negative control, ADR-0001 note. Not started by this plan. |

## 6. Open items for the owner

1. Is the 20 USD cap acceptable, and is sonnet the right depth-0 model for the cells?
2. The `FINDINGS*` hook is outside the repo; confirm whether it is a harness guard or a user-level hook.

Immediately dispatchable without evidence: P0(a), P0(b), P0(c) (tests and a read-only report only).
