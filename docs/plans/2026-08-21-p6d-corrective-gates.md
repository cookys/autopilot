# P6D corrective gates — the repair ladder, alone (R2', terminal-frozen)

> 狀態: ✅ Shipped in v2.34.32 — merged as cd66b62a(無狀態終形;durable lock 重入條件在 BACKLOG)

Status: R2' FROZEN (G2 terminal adjudicated — see g2-adjudication.md). Campaign ships ONE
control (KR3); KR2 is a pre-authorized option behind a GO checkpoint; KR1 is DROPPED. Source: the
2026-08-21 P6D incident record + its BACKLOG entry (trigger fired by owner approval).
G1: sol STOP / minimax STOP / grok STOP — convergent ruling: R0 overbuilt; the incident's
only UNCAUGHT failure was the wrong recovery unit; the manifest violation WAS caught by the
existing post-commit scope gate, just after functional green. R1 ships the cheapest forms.

## 1. Problem (per failure class, with its control and posture)

| Class | Disposition (G2 terminal) |
|---|---|
| (c) workflow expansion before local repair — THE uncaught failure | **KR3 repair ladder — this campaign ships it** (transition-scoped enforce = its shadow-safe form: fires only between gate-fail and expansion, never on green paths) |
| (b) staged paths outside the allowlist — caught late by the existing gate | **KR2 pre-authorized OPTION** behind a recorded GO checkpoint; entry condition = written predicate spec (rename = delete+add; exact paths, no globs) + fixture corpus proving staged-view ≡ post-commit comparator |
| (a) heavy dispatch despite complete oracle | **OPEN — nothing ships**. KR1 dropped even as shadow (refuted predicate yields uninterpretable data). BACKLOG keeps class (a) open with predicate-replacement candidates |

## 2. OKR / KRs

- KR3 (THE deliverable): successor/terminalize is REFUSED when the last durable campaign
  event is a gate failure against a candidate and no repair receipt exists. Receipt = the
  failed gate RERAN and (its verdict changed OR its named-extras set strictly shrank);
  stores the prior failure output hash as compared-against state; keyed
  `campaign_id + candidate_ref + gate_id` (worktree-portable). Bypass = CLOSED ENUM of
  ENGINE-DERIVED terminal outcomes only (deadline/wall-clock/transport death — mapped onto
  the engine's actual terminal vocabulary at P0's call-edge audit); `owner_abort` is NOT in
  the enum (an owner abort happens outside the API). Free text attaches for audit but never
  satisfies the predicate. Planted red: zero-delta successor attempt refused.
- KR0 (P0 first act): call-edge audit — enumerate and FREEZE in the project README the
  exact file:function edges the P6D flow traversed (successor/terminalize; engine commit
  step; admission) plus the engine terminal-outcome vocabulary; in-situ tests target those
  frozen edges.
- KR2 (OPTION, not this campaign's deliverable): implemented ONLY after a recorded GO at
  the checkpoint whose entry condition is (i) written predicate spec — SUBSET relation,
  rename = delete+add (extra iff added path ∉ allowlist), exact paths no globs, deletion/
  mode-only of allowed paths = allowed — and (ii) a shared fixture corpus proving the
  staged-index view behaviorally ≡ the proven post-commit comparator. If GO: inline at the
  commit step, post-commit scopeCheck stays as backstop with its own caller test; planted
  red = 6 allowed + 2 staged symlinks.
- (KR1 REMOVED — G2 terminal: shadowing a refuted predicate is uninterpretable and the
  annotation path is fail-closed on the live admission object. Class (a) stays open in
  BACKLOG with predicate candidates: `required_change_paths` equality; opt-in
  `complete_deliverable` + closed-enum justification.)
- KR4: every refusal is explanation-first (names the cheapest local repair). Zero behavior
  change without a campaign contract / mission policy (existing suites stay green).
- KR5: each gate names its LIVE CALLER and ships an in-situ caller-side test in the same
  phase (a unit-tested predicate nothing calls = the documented dead-gate family). Full
  suite green; preflight 8/8; PATCH bump.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- ADR-0001 binds (verification by re-derivation; no attestation). No-invocation-enforcer
  ruling binds (outcome/contract-shape predicates only).
- P6D specifics never become policy (no six-path constants, no symlink ban).
- Status-report budget stays OUT of product scope.
- Node ≥ 20.10 built-ins; JSON + documented exit codes; prefer wiring into EXISTING
  surfaces over new standalone scripts — a new script requires a caller-side test proving
  it is the live caller.
- Each gate ships WITH its planted red in the same phase.

## 2.6 Change-policy decisions

- **Compatibility impact**: published-compatible (new refusals only under campaign-contract
  preconditions on the two enforce gates; KR1 is exit-0 shadow).
- **Dependency decision**: platform/stdlib.

## 3. File-structure map

| Surface | Responsibility |
|---|---|
| engine successor/terminalize path (`bin/autopilot.js` + owning src module) | KR3 predicate inline (or `scripts/check-repair-ladder.js` ONLY if the caller-side test proves it live) |
| engine compute_artifacts/commit step | KR2 inline extra-path check reusing existing scope-gate comparison |
| `scripts/mission-routing-admission.js` | KR1 shadow annotation |
| `hooks/tests/p6d-gates-*.test.sh` | per-gate: planted red + green + no-contract no-op + IN-SITU caller test + backstop-still-trips test |
| `docs/projects/2026-08-21-p6d-corrective-gates/` | tracking |

## 4. Phases (G2 terminal shape)

- **P0 — KR3**: (a) call-edge audit frozen in README FIRST; (b) predicate + receipts +
  engine-derived bypass enum + planted red/green/bypass + in-situ caller test at the frozen
  edges.
- **P1 — KR2 GO checkpoint**: write the predicate spec + build the equivalence fixture
  corpus; record GO or NO-GO in the project README. NO-GO is a legitimate exit.
- **P2 — KR2 implementation (ONLY on recorded GO)**: wiring + planted red/greens incl.
  4-of-6 + backstop caller test.
- **P3 — docs + release**: inventory/CLAUDE.md only for scripts that survived the caller
  test; CHANGELOG + INDEX + bump (version-yield check); BACKLOG entry UPDATED honestly —
  class (c) closed with planted negative, class (b) closed iff GO+shipped, class (a)
  explicitly remains open (no closure-by-annotation).

## 5. Test / validation

`bash hooks/tests/run.sh` + per-gate files; each planted red mutation-checked (disable the
gate → red case passes = test catches a dead gate). 驗證合約:紅綠可過。

## 6. Risks + inversion

Guaranteed failure: resurrecting KR1 in any form this campaign; a free-text or
controller-minted bypass in KR3; KR2 code before the GO record; comparator semantics
diverging from the existing scope gate; a gate proven only by unit test; P6D constants in
policy.

## 7. Out of scope

Report budget as product. Mission scheduler changes. KR1 ENFORCE (future campaign). Codex-side
controller behavior. The official-qualification-defaults BACKLOG item.

## 8. Open questions (Board)

None. (OQ1 resolved at G1 adjudication: closed-enum bypass; no controller-minted free-text
override.)

## Review log

- R0 2026-08-21; manifest + frozen rubric in evidence dir; logical_plan_id
  `p6d-corrective-gates-2026-08-21`.
- G1: sol STOP / minimax STOP / grok STOP; 24 findings, 24 accepted_blocker
  (`g1-dispositions.json`) → this R1. Key folds: KR1 predicate refuted (universal contract
  shape) → shadow; cheapest-form ordering (ladder first; manifest check by reuse);
  subject-delta receipts with closed-enum bypass; posture split by risk family; OQ1 closed.
  Panel note: MiniMax's exam profile (26/42, 15 FP — the 五席同卷 table, 2026-08-21) was
  weighed; its findings stood because all major thrusts were three-seat convergent.
  Envelope: `g1-envelope.json`.
- G2 (terminal, cap): sol STOP / minimax CONDITIONAL / grok STOP; 17 findings (13
  blockers), all depth-0 adjudicated (`g2-adjudication.md`) → R2' FROZEN. Key folds:
  KR3-only campaign; KR1 dropped (class (a) open); KR2 behind GO checkpoint; engine-derived
  bypass enum (owner_abort removed); rerun-receipts with prior-state hash; call-edge audit
  as P0's first act. Envelope: `g2-envelope.json`.
