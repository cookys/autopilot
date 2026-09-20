# Plan — Autonomous brain integration: frozen four-tuple, stateless orchestrator, decision ledger

> Status: **FROZEN** (R2, post-G2 terminal adjudication, 2026-08-17) · Owner: depth-0
> session under Board delegation · Branch: develop (units via dev-flow worktrees) ·
> Frame: Board thread 2026-08-17

## 0. Context / thesis

Three weeks of gpt-5.6-sol depth-0 operation are forensically documented in
[`sol-pathology.md`](evidence/2026-08-17-autonomous-brain-integration/sol-pathology.md)
(12 failure shapes F1–F12). Synthesis: the orchestrator never lost reasoning quality — it
lost **state fidelity**. Compaction erased prior rulings; the brain refilled the gap by
redesigning its own process mid-run, at quadratic re-verification cost. Written promises
did not survive as behavior (the same root cause hit BACKLOG P0 four times and recurred);
only mechanical gates alter behavior — hence every KR below is a gate, not a guideline.

Board rulings (binding): (1) the brain seat is qualified on diligence/fairness/stamina,
not intelligence — architectural statelessness substitutes for stamina; (2)
freeze-then-execute — the four surfaces sol mutated are frozen at blueprint time, change
means stop-and-re-freeze; (3) adversarial energy only at the deliverable boundary and
across families (ADR-0001 extension) — inside a cooperating unit, checks are
deterministic scripts; verification-of-verification is forbidden (onboarding exams are
the only sanctioned verifier-checking); (4) gauntlet-loop's continuous loop is rejected —
its spirit lands as a post-merge, structurally non-blocking experience critic feeding
BACKLOG → `/next`; (5) user habits are first-class — preference config picks among
qualified candidates; unqualified engines need a standing exam pass or a per-invocation
override, no third path.

## 1. Problem

Long-running autonomous delegation (/l4–/l6) cannot currently guarantee: (a) the
execution contract survives compaction; (b) proxy decisions are visible and vetoable
without polling; (c) verification spend converges to a deliverable; (d) next work is
picked without scope invention; (e) deliverables are ever judged through the user's eyes.

## 2. OKR / KRs

Objective: a depth-0 brain that runs unattended for days, cannot drift from its frozen
contract, reports its proxy decisions, and always converges to a verifiable deliverable.

Failure-shape coverage (complete): F1/F3/F4→KR1; F2→KR1's churn-budget preflight (a
mega-batch has product delta — the stall fuse cannot see it; the diff-scope declaration
exceeding the contract's churn budget is refused pre-spawn) + the scoped-reverify rule;
F5/F10→KR4; F8/F9→KR2; F12→KR3;
F6→already shipped (`reap-dispatch-worktrees.sh` + `lifecycle-residue-receipt.js`),
pinned as the declared lifecycle mechanism by KR1's control-plane freeze; F7→already
shipped (role qualification + contract admission, v2.34.12) plus KR6's no-third-path
rule; F11→P8's ambiguity→ask front door; "promises don't survive"→the plan's method
itself (every measure is a blocking script).

- **KR1**: a dispatch whose DECLARED intent (unit id, diff-scope, gate set, roles,
  control-plane digests) deviates from the frozen four-tuple is refused by
  `check-blueprint-conformance.js preflight` BEFORE the runner spawns (rides
  dispatch-hetero's `die_precondition` rail); `audit` mode cross-checks recorded actions
  after the round.
- **KR2**: kill −9 / force-compact mid-campaign → resume from the rehydration bundle.
  Machine-graded: the brain emits the fixed-schema JSON quiz `{current_unit_id,
  four_tuple_digest, owned_pids, last3_decision_ids}`, graded by exact match against
  disk truth; re-attach adopts every owned process (zero orphans/duplicates).
- **KR3**: every autonomous decision lands in the decision ledger with rationale before
  round end; the round-end report renders without polling. Omission detection uses a
  ledger-independent universe: dispatch manifests, run-ledger stages, git ref
  transitions, contract digest changes — any trace without a matching ledger entry fails
  `audit`.
- **KR4**: burst deltas are classified product-vs-verification (`diff-scope-report.sh`);
  3 consecutive zero-product bursts trip `check-stall-fuse.js` (halt + report). Finding
  re-verification is scoped to the finding's surface + frozen gate set; an automatic
  full-suite rerun on a finding is itself a conformance violation.
- **KR5**: the experience critic launches only from the post-merge hook (after the
  integration ref advances) — structurally unable to gate; emits ≤7 stable-ID findings
  into BACKLOG intake.
- **KR6**: no fresh qualification evidence → an explicit per-invocation override
  artifact is required; absent both, refusal. Among qualified candidates, the user's
  preference config beats any system ranking.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- ADR-0001 binding: no trust machinery. The decision ledger and all digests are plain
  identity pins / append-only telemetry; nothing verifies the ledger itself.
- Adversarial review only at the deliverable boundary and across families; no
  adversarial checks inside a cooperating unit; no verification-of-verification.
- dev-flow's step sequence is byte-unchanged; every mechanism attaches to a NAMED
  existing rail; no new lifecycle skill, no parallel control plane.
- Frozen four-tuple = (1) granularity: CONTENT digest of the deliverable DAG (never a
  path reference); (2) gate set: enumerated gates + seats; (3) rubric: file digest;
  (4) control plane: digest pins of an ENUMERATED file set — task-class config,
  preference config, roster config, and the five governance scripts themselves
  (check-blueprint-conformance.js, decision-ledger.js, check-stall-fuse.js,
  next-pick.js, build-rehydration-bundle.js) — so the brain cannot neuter a gate by
  editing it. All pins are brain-read-only mid-campaign; editing any pinned file is a
  violation, not a re-freeze. (Digest pins are configuration identity, not trust
  machinery: nothing chains, witnesses, or attests — a mismatch simply refuses the round.)
- Re-freeze is a STOP: current round terminates, zero spend while unfrozen, amended
  contract gets a new digest, the ledger records old→new + reason, resumed rounds
  validate only the new digest.
- The experience critic never blocks a merge (post-merge by construction).
- Findings carry stable IDs; closure = the ORIGINAL defect re-verified gone; whole-unit
  redispatch needs an explicit operator override in the ledger.
- One candidate respects the contract's file/churn budget; per-finding re-verification
  is scoped, never automatic full-suite.
- Auto-pick selects only from written queues (BACKLOG rows, docs/plans). Ask-first is
  decidable from data that actually exists: (a) at pick time, from row fields — Effort
  L/H OR `board` tag; (b) at declaration time — the picked unit's diff-scope declaration
  (which KR1 preflight already requires) touching qc-gate protected paths
  (skills/agents/scripts/references/hooks) converts the pick to ask-first before spend.
  Irreversible/outward ACTIONS are not a pick-time predicate — they are already gated at
  execution by the standing red lines (exec-boundary, confirm-first). Mid-session ideas
  enter the queue first and compete.
- Veto channel: `decision-ledger.js veto <id> [--reason]`; preflight refuses rounds
  building on vetoed decisions; undo work becomes a front-queued repair unit.
- Node ≥ 20.10 built-ins only on the dispatch/sandbox runtime path; bash for
  dev/CI-only git glue.
- Single canonical statement: four-tuple fields in dispatch-contract.js header docs;
  experience-audit methodology + rehydration bundle layout in
  references/experience-audit.md; others link, never restate.
- User authority: every proxy decision vetoable; ask-first never auto-decided;
  preference config outranks system ranking among qualified candidates.
- Every new script ships its 4-place wiring inside its own phase; release gates
  (inventories, mirrors, preflight-release) are part of each shipping phase's
  acceptance.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only` — additive contract fields; consumers are
  autopilot's own engine/scripts.
- **Dependency decision**: `none` — Node built-ins + existing repo libs
  (lib/jsonl-store.js, run-ledger.sh).

## 3. File-structure map

| File | Responsibility · same-phase caller |
|---|---|
| `scripts/check-blueprint-conformance.js` (new) | `preflight` refuses out-of-contract declared intent pre-spawn; `audit` cross-checks actions + ledger completeness · called by dispatch-hetero precondition rail (P1) |
| `scripts/build-rehydration-bundle.js` (new) | Boot bundle; frozen section order ①four-tuple ②red lines ③roster+preference digests ④ledger tail (last 20) ⑤owned-process table. Every section is load-bearing and bounded by construction (④⑤ are fixed-size views); NO truncation exists — total over 20k is a build ERROR that stops the round and surfaces in the report · called by l4/l5/l6 round-loop slice (P2) |
| `scripts/decision-ledger.js` (new) | append/query/veto/report (report = round-end incl. ask-first queue, critic findings, stall status) · called by foreman round-end slice (P3) |
| `scripts/check-stall-fuse.js` (new) | Classifies burst deltas from run-ledger; trips at 3 zero-product bursts · called by foreman round-loop slice (P4) |
| `scripts/next-pick.js` (new) | Pure f over a MATERIALIZED pick-record (BACKLOG digest + preference digest + readiness snapshot CONTENT, all appended to the ledger with the pick); total lexicographic tie-break; replay recomputes from the recorded snapshot, never live state; enforces ask-first + preference precedence · called by l4/l5 idle-transition slice + `/next` (P5) |
| `references/experience-audit.md` (new) | Canonical: seven-step methodology, five-question instantiation protocol, machine-checkable vs human-only split (human-only routes to the user, never simulated), domain rulers via survey; appendix: bundle layout · quoted by P6 template, linked by P2 |
| `scripts/dispatch-experience-critic.sh` (new, thin) | Single-round critic wrapping dispatch-review.sh; SELF-GUARDING regardless of caller: refuses to run unless the reviewed commit is already an ancestor of the integration ref (git ancestry check) — non-blocking is enforced in the script, not by call-site convention; pins the experience-audit protocol digest it instantiated from; output → admit-backlog-follow-ups.js · called by l4/l5 post-merge slice (P6) |
| `scripts/dispatch-contract.js` (extend) | Additive `frozen_four_tuple` block; `check` validates presence + digest immutability (P1) |
| `scripts/resolve-review-loop.sh` (extend) | First-use qualification: no fresh evidence → override artifact required; rides the v2.34.12 capability_warnings rail (P7) |
| `project-config-template/task-class-config.md` (new DI template) | Task classes, per-class candidate order, hard-problem pinned to depth-0, ambiguity→ask · scaffold-config.js set (P8) |
| `skills/{l4,l5,l6}/SKILL.md` | One slice per phase, never bundled: rehydrate/reset (P2), report emission (P3), stall consultation (P4), critic launch (P6) |
| `hooks/tests/*.test.sh` | One per new script, same phase; red cases per KR |

## 4. Phases (bounded deliverable DAG; each severable)

- **P1 — four-tuple freeze + conformance preflight/audit** (L). Contract block + both
  gate modes + re-freeze stop protocol. P1's audit covers actions-vs-contract using only
  pre-existing sources (dispatch manifests, run-ledger, git); the ledger-completeness
  cross-check is a P3 extension so P1 ships independently. Acceptance:
  `bash hooks/tests/check-blueprint-conformance.test.sh` green — contains KR1 red cases
  (out-of-contract gate set refused pre-spawn; churn-budget-exceeding diff-scope
  declaration refused pre-spawn), re-freeze case (old-digest round refused), and a
  pinned-script-edit case (modified governance script digest refused);
  `dispatch-contract-artifact.test.sh` stays green.
- **P2 — rehydration bundle + round reset** (L, dep P1). Bundle builder + SKILL
  round-loop slice + process re-attach. Acceptance:
  `bash hooks/tests/build-rehydration-bundle.test.sh` green — KR2 red case (deleted
  ledger line → quiz mismatch → refusal), kill/resume equivalence, cap-breach error.
- **P3 — decision ledger + veto + report** (M, dep P1). Extends P1's audit with the
  ledger-completeness cross-check. Acceptance:
  `bash hooks/tests/decision-ledger.test.sh` green — KR3 unlogged-decision red case
  (planted manifest without ledger entry fails audit), veto red case (round on vetoed
  decision refused), report fixture.
- **P4 — stall fuse** (M, dep P3). Acceptance:
  `bash hooks/tests/check-stall-fuse.test.sh` green — sol pattern trips AND healthy run
  silent (both negative controls), scoped-reverify violation case.
- **P5 — auto-pick** (M, dep P3). Acceptance: `bash hooks/tests/next-pick.test.sh`
  green — deterministic replay, ask-first row never picked (red case), KR6
  preference-precedence fixture.
- **P6 — experience-audit reference + critic** (M, dep P3). Acceptance:
  `bash hooks/tests/dispatch-experience-critic.test.sh` green — KR5 red case (planted
  blocking marker inert, surfaced as anomaly); one dogfood run on a deliverable of this
  plan recorded in evidence/.
- **P7 — first-use qualification override** (S, independent). Scope honesty: P7 governs
  the next-pick and dispatch front-door paths, where exam evidence and the override
  artifact are provably the ONLY two accepted inputs (red case exercises both branches);
  the strict-l5 advisory bootstrap path keeps its Board-decided 2026-08-16 semantics and
  is explicitly outside P7's claim. Headless fails closed to the override file.
  Acceptance: `resolve-review-loop.test.sh` extended section green — KR6 red case
  (no evidence + no override → refusal on the governed paths).
- **P8 — task-class front-door config** (S, dep P5 vocabulary). Template +
  scaffold-config wiring + front-door SKILL text (ambiguity→AskUserQuestion;
  common-pattern default = survey). Acceptance: `scaffold-config.test.sh` extended
  green; absent config → behavior unchanged (fixture).

## 5. Test / validation

Red-case matrix: KR1/KR3-audit/re-freeze → check-blueprint-conformance.test.sh;
KR2 → build-rehydration-bundle.test.sh; KR3-veto → decision-ledger.test.sh;
KR4 (both directions) → check-stall-fuse.test.sh; KR5 → dispatch-experience-critic.test.sh;
KR6 → resolve-review-loop.test.sh + next-pick.test.sh. Every gate is proven able to go
red before it ships (evidence-discipline §9 family). Human-gated: P6 finding quality and
P8 class granularity, via round-end reports. Full-suite acceptance measured against the
recorded baseline fail set (2026-08-16 owner-kernel-retirement evidence). Release gates
run inside every shipping phase.

## 6. Risks + inversion

1. **This plan balloons (sol disease, recursively)** → phases severable, per-phase
   acceptance commands, scope additions must enter BACKLOG; P1 ships first so the
   four-tuple gate governs the rest of this plan's own execution.
2. **Conformance gate is theater** → red cases authored before mechanisms; preflight is
   pre-spend by construction, audit is the backstop.
3. **Bundle grows into its own context problem** → five frozen sections, per-section
   caps, 20k total, breach = build error.
4. **Ledger drifts into trust machinery** → §2.5 pins it as telemetry; reviewers check
   ADR-0001 creep.
5. **Critic becomes a second QC** → post-merge launch is structural; KR5 red case
   proves a blocking attempt is inert.

## 7. Out of scope

Brain-seat exam suite (follow-up plan; BACKLOG row at close); reviewer-seat full
qualifications (existing row); contract-card rewrites (blocked on 成績單前置); any
continuous gauntlet loop; multi-repo portfolio scheduling; Mission hardening vs
malicious same-UID actors (existing rows).

## 8. Adopted defaults (Board may override at freeze)

Stall-fuse N=3; critic top-K=7; bundle cap 20k with the five-section layout; task-class
first cut {mechanical-impl, standard-impl, hard-problem, direction, review}. Only open
Board question: domain × difficulty class splitting now or later (default: later, driven
by routing misses recorded in the ledger).

## Review log

- **R0** — authored 2026-08-17 from the Board design thread + sol-pathology forensics.
  Manifest: `2026-08-17-autonomous-brain-integration.plan-review-manifest.json`; frozen
  rubric: `2026-08-17-autonomous-brain-integration.rubric.md`.
- **G1** (2026-08-17, transport complete): CONDITIONAL (GLM C, MiniMax C, sol STOP, grok
  no verdict); 28 findings, 17 blocker candidates — all accepted (5 cross-seat duplicate
  groups). R1 repairs: conformance split into pre-spend preflight + post-round audit;
  control-plane digest pins close the fifth mutation surface (decision policy); KR2 quiz
  machine-gradable; KR3 ledger-independent detection universe; veto channel +
  re-freeze stop protocol specified; per-phase concrete acceptance + wiring + release
  gates; ask-first predicate machine-checkable; bundle layout frozen; SKILL slices
  per-phase; defaults adopted. Dispositions: `*.g1-disposition.json`.
- **G2 attempt 1** (2026-08-17): `plan_growth_hard_stop` — R1 hit 1.60× R0 bytes vs the
  1.5 stop ratio; zero seats dispatched, zero semantic verdicts. Disposition: the
  anti-balloon gate is correct; R1 compacted below the 1.25 warn ratio with all repair
  substance retained; session state's policy-terminal marker reset (no semantic
  generation was consumed) and G2 re-dispatched.
- **G2** (2026-08-17, terminal, transport complete): CONDITIONAL (GLM C, MiniMax C, sol
  STOP, grok no verdict); 17 findings, 12 blocker candidates — depth-0 TERMINAL
  adjudication: **10 accepted, 2 duplicates** (B3→B1 pin enumeration; B6→B2 bundle
  policy). Repairs in this final R2: the five governance scripts are themselves
  digest-pinned in the control plane (a brain edit to a gate is a refused round, not a
  neutered gate); granularity pins DAG CONTENT digest, never a path; bundle truncation
  REMOVED — all five sections load-bearing and bounded by construction, over-cap is a
  build error; F2 remapped honestly to KR1's churn-budget preflight (stall fuse cannot
  see a product-producing mega-batch); pick inputs materialized into a ledger
  pick-record so replay never reads live state; ask-first predicate re-grounded in data
  that exists (row fields at pick time + diff-scope declaration at preflight);
  experience-critic non-blocking enforced in-script via git ancestry check regardless of
  caller, with protocol digest pinned; P1/P3 dependency untangled (ledger cross-check is
  a P3 extension); P7 claim scoped to the paths it governs with the strict-l5 advisory
  boundary named. Non-accepted findings (5) recorded as backlog candidates. Generation
  cap reached — **plan FROZEN as of this revision**; execution enters dev-flow
  scheduling. Dispositions: `*.g2-disposition.json`.
