# Plan — Four-layer redesign: contract hardening + capability tiering

> Status: R2 (final, post-G2 terminal adjudication) · Owner: cookys (CEO-mode delegated 2026-08-16) · Branch: develop → feature branch `feat/four-layer` · Frame: mechanism hardening on existing rails

## 0. Context / thesis

Successor to the owner-kernel retirement (`2026-08-16-owner-kernel-retirement.md`), chartered by the
Board's four-layer direction and corrected by the dual-agent survey
(`2026-08-16-four-layer-redesign-survey.md`). The survey's verdicts bound this plan:

- **(a) evidence-over-process holds only as capability-indexed** — SpecBench shows gaming of a
  visible evidence gate GROWS ~27pp per 10x LOC; Agentless beat agent scaffolds with MORE process.
  → scaffold amount becomes a function of the dispatched engine's qualification tier.
- **(b) decorrelated verification survives as a cascade** — self-preference bias is real (+0.14,
  75–84% family win rates), but always-on panels hit diminishing returns at ~4-5 models and
  multi-round debate AMPLIFIES error (+30% wrong-consensus). → escalate-on-trigger, single-round
  verdicts only, depth-0 adjudication.
- **(c) graph-beats-loop fails for this shape** — coding is deep-and-narrow (Cognition), no
  topology-vs-topology benchmark exists. → NO orchestration framework, NO parallel code-writing;
  keep only typed stage contracts + independent-work fan-out (which qc-panel already is).
- **The skeptic's structural find**: every option lacked a non-LLM execution-boundary layer (the
  Replit lesson: "the freeze lived only in the instructions"), and LLM verifiers are
  narrative-steerable (97.2%→3.6% detection under "secure" framing). → two new Kernel mechanisms:
  a policy-as-code deny gate and a blind-evidence rule.

**Anti-cathedral clause**: the owner-kernel retirement is the cautionary tale for THIS plan. Every
deliverable must attach to an existing rail, ship with a red-case test (plant the broken case and
watch it fail), and have a caller in the same phase that lands it. No speculative layers.

## 1. Problem

The lifecycle currently applies one scaffold weight to every engine, accepts implementer narrative
alongside evidence in review payloads, has no pre-execution deny gate for destructive commands in
Claude sessions, and leaves the survey-validated cascade/holdout/single-round rules as informal
practice rather than enforced contract. Each is a measured failure surface (survey sources), and
each has an existing rail to attach the fix to.

## 2. OKR / KRs

**O: the four survey-hardened mechanisms are enforced by shipped code on existing rails, each proven by a planted red case.**

- KR1 (blind evidence): `check-blind-evidence.sh` lints the ASSEMBLED reviewer payload (spec +
  any prompt packs — the implementer→reviewer surface, not merely the dispatcher-authored
  spec): rejects a seeded payload carrying implementer completion-narrative (exit 1, named
  finding), passes a real historical spec file pinned as the clean fixture (exit 0); a
  structural red case additionally asserts `dispatch-review.sh` exposes NO
  implementer-narrative input channel today (regression guard).
- KR2 (execution boundary): the `exec-boundary` PreToolUse hook denies planted destructive
  commands (`git push --force` to a protected ref, `rm -rf` escaping the worktree, raw
  `DROP TABLE`, `sudo rm`) and permits benign commands, under hook-harness tests; opt-in manifest
  entry + config template shipped; the force-push rule deliberately overlaps default-on
  `branch-protection.js` (defense-in-depth); the hetero-engine boundary map (worktree
  containment + qc-gate pre-push) is documented in the same reference.
- KR3 (capability tiering): `resolve-scaffold-tier.js` deterministically maps fixture
  scorecard/capability-state inputs to tiers T0/T1/T2 with rationale and `evidence_refs`;
  **missing, unknown, STALE, or conflicting evidence all resolve to T2** (fail-closed to MOST
  scaffolding — fixtures for each of the four cases); T1 is reserved for fresh-but-partial
  evidence; the freshness cutoff, source precedence (capability-state over imported priors),
  and conflicting-record behavior are frozen in resolver fixtures; the dispatch-hetero
  combined-prompt assembly consumes the tier in the same phase.
- KR4 (cascade + single-round): escalation lands on the EXISTING qc rail — the resolver folds
  trigger outcomes (computed `review_risk` ≥ threshold, `--prior-status no_verdict|ambiguous`,
  security surface) into its `required_review_families` / `qc_panel` output, which the existing
  qc dispatch path already consumes to seat reviewers; fixtures prove end-to-end
  trigger→one-fresh-disjoint-family-seat mapping (family = roster `family` field), the red case
  asserts NO same-family seat and NO rebuttal dispatch occurs, and no-disjoint-family-available
  fails closed with a named reason; the single-round rule is canonical in
  `references/evidence-contract.md`.
- KR5 (holdout): a shipped gate, not prose — new `scripts/check-holdout-coverage.sh` fails
  (exit 1) when `classify-diff-risk.sh` reports a high-risk diff and no mutation/strength probe
  receipt exists in the run evidence, passes when receipts are present; wired into the
  quality-pipeline deterministic gate list as its same-phase caller; red case = planted
  high-risk diff without receipts fails, with receipts passes. `references/evidence-contract.md`
  gains the holdout-leg + single-round clauses (additive).
- KR6 (hygiene): a pre-D1 step runs the full suite and records the baseline fail set as an
  immutable evidence artifact (`baseline-suite.json`); final acceptance compares against that
  artifact (fail set ⊆ baseline); red case = a seeded unregistered-script name makes
  `check-claude-md-inventory.js` fail, then registration turns it green;
  every new script wired per the 4-step checklist (reference doc, SKILL/reference row,
  scripts-inventory, CLAUDE.md group); `preflight-release.sh` green for the PATCH version.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only; no new dependencies; no orchestration frameworks (no LangGraph or
  equivalents).
- NO trust machinery: no hash chains, event ledgers, witness receipts, attestation, or trust
  roots. If a deliverable starts to need one, stop-and-review.
- Verification is single-round: one verdict per seat per generation, adjudicated at depth 0;
  never feed one reviewer's verdict to another reviewer for a rebuttal round.
- The implementer path stays single-threaded; fan-out is reserved for independent work
  (review seats, research).
- Every new script lands with: a red-case test in the same commit, a caller in the same phase,
  and the 4-step wiring (reference, skill/reference row, scripts-inventory, CLAUDE.md group).
- `references/evidence-contract.md` may gain clauses; existing clauses may not be weakened.
- Blind-evidence rule: a review payload contains obligations, diff, and receipts — never the
  implementer's own narrative about them.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`, with the behavior deltas named honestly
  (G2 sol R8), each with an escape hatch: (1) `dispatch-review.sh` gains a fail-closed
  narrative lint — `--allow-narrative <reason>` overrides, logged to stderr AND the run
  manifest; (2) `dispatch-hetero.sh` prompt envelope gains the tier preamble — dispatch-config
  `scaffold_tiers: off` disables, and default `auto` on an unqualified engine yields T2 (a
  superset of today's implicit expectations, not a contradiction); (3) round-N+1 review after
  `no_verdict|ambiguous` now requires a second family — previously that state meant a stalled
  loop, so the delta strengthens an already-failing path; (4) quality-pipeline gains the holdout
  gate step for high-risk diffs. Nothing removed or renamed; no skill/agent added/removed.
  Versioning: PATCH per CLAUDE.md "Versioning (semver bump rule)" — new scripts/hooks are
  PATCH-tier; the second digit is reserved for new skills/agents.
- **Dependency decision**: `none` — Node built-ins throughout.

## 3. File-structure map

| File / area | Action | Responsibility |
|---|---|---|
| `references/four-layer-design.md` | create | the design record: layer map, rule→enforcer table, execution-boundary map, anti-cathedral constraints; LINKS to scaffold-tiers.md (tier definitions) and evidence-contract.md (single-round) — never restates them |
| `scripts/check-blind-evidence.sh` | create | lint a review payload (spec/prompt file) for implementer completion-narrative markers; sibling of `check-dispatch-suppression.sh` (which guards the controller→reviewer direction; this guards implementer→reviewer) |
| `scripts/dispatch-review.sh` | edit | run the blind-evidence lint on `--spec-file` before dispatch (fail closed, override flag with logged reason) |
| `hooks/exec-boundary.js` + `hooks/tests/exec-boundary.test.sh` | create | PreToolUse(Bash) deny gate: configurable deny patterns (force-push to protected refs, `rm -rf` outside sanctioned roots, raw destructive SQL, `sudo rm`); allow-by-default outside the deny list |
| `hooks/opt-in-manifest.json` + install docs | edit | register `exec-boundary` as opt-in (16th opt-in); enable in autopilot's own dogfood settings |
| `project-config-template/execution-boundary-config.md` | create | per-project deny-list config (protected refs, sanctioned roots, extra patterns) |
| `scripts/resolve-scaffold-tier.js` + test | create | scorecard/capability-state → `{tier: T0\|T1\|T2, rationale, evidence_refs}`; unknown/stale → T2 fail-closed |
| `references/scaffold-tiers.md` | create | what each tier's dispatch prompt includes: T0 contract-only (goal + evidence contract + red lines), T1 contract + obligation checklist, T2 full prescribed process |
| `scripts/dispatch-hetero.sh` (implementer prompt assembly) | edit | consult `resolve-scaffold-tier.js` for the implementer seat; select T0/T1/T2 prompt skeleton |
| `scripts/resolve-review-loop.sh` | edit | surface the escalation rule (`review_risk`/ambiguity triggers → disjoint-family seat addition) as explicit output fields; no behavioral change to existing risk tiers |
| `references/evidence-contract.md` | edit (additive) | holdout-leg clause + single-round clause |
| `scripts/check-holdout-coverage.sh` + test | create | KR5 gate: high-risk diff without mutation/strength receipts fails closed; quality-pipeline deterministic gate list is the caller |
| `skills/quality-pipeline/SKILL.md` + `references/*.md` | edit | gate row + call condition for the holdout instruments |
| `docs/plans/evidence/2026-08-16-four-layer-redesign/` | create | red-case transcripts, resume-audit note, phase SHAs |
| `docs/scripts-inventory.md`, `CLAUDE.md`, `CHANGELOG.md`, version files | edit | 4-step wiring + PATCH release |

## 4. Phases

### D1 — Baseline + design record (S)
0. **Baseline capture** (KR6): run the full suite, record the fail set to
   `docs/plans/evidence/2026-08-16-four-layer-redesign/baseline-suite.json` — the immutable
   comparison artifact for every later phase.
1. Write `references/four-layer-design.md` (contract-card style: decision tables, not prose
   essays) capturing the survey-bound rules this plan enforces, each row pointing to its
   enforcing mechanism (D2-D5) and its survey evidence; tier definitions and prompt skeletons
   are NOT restated here — they live only in `references/scaffold-tiers.md` (no second
   canonical statement); the single-round clause's canonical home is
   `references/evidence-contract.md`, linked not restated.
Acceptance: baseline artifact committed; doc exists, links resolve, no rule lacks a named
enforcing mechanism or an explicit "documented-only" tag.

### D2 — Blind-evidence gate (S)
1. `scripts/check-blind-evidence.sh`: the guarded threat is LAUNDERING (G2 sol R3): no direct
   implementer→reviewer channel exists today (the structural red case pins that), but an
   orchestrator composing `--spec-file` can paste implementer output — completion claims enter
   wearing the dispatcher's trust. The lint therefore scans the ASSEMBLED reviewer payload
   (spec + any prompt packs) for implementer-narrative classes regardless of who pasted them
   (first-person completion claims, self-assessed quality, test-outcome assertions with no
   receipt path). Exit 1 + JSON findings on hit; exit 0 clean. Patterns in the script header
   with rationale, mirroring `check-dispatch-suppression.sh` conventions (which guards the
   opposite, controller→reviewer direction — no overlap).
2. Wire into `dispatch-review.sh` at the transport-assembly point (fail closed;
   `--allow-narrative <reason>` escape hatch, logged to stderr).
3. Red-case tests: seeded narrative payload fails; a PINNED REAL historical spec file passes
   clean; escape hatch logs; a structural assertion proves `dispatch-review.sh` exposes no
   implementer-narrative input channel today (regression guard for future flags).
Acceptance: KR1.

### D3 — Execution-boundary hook (L)
1. `hooks/exec-boundary.js`: PreToolUse Bash matcher; deny-list evaluation over the command
   string; config from `.claude/execution-boundary-config.md` (fallback: shipped defaults —
   protected-ref force-push, `rm -rf` outside `$TMPDIR`/worktree roots, `DROP TABLE|TRUNCATE`
   against non-test DSNs, `sudo rm`). Protected-ref force-push OVERLAPS the default-on
   `branch-protection.js` deliberately — defense-in-depth across an opt-in and a default-on
   hook, not a conflict; the boundary map documents both. Deny = structured block message naming the matched rule;
   allow-by-default otherwise. NO LLM calls.
2. Register opt-in via the per-event opt-in-multiplexer rail (entry in
   `hooks/opt-in-manifest.json`, armed per `~/.autopilot/config.json {"hooks":{"exec-boundary":true}}`
   or `AUTOPILOT_HOOK_EXEC_BOUNDARY=1`; opt-in changelog per `check-optin-changelog.js`); enable
   in autopilot's own dogfood config. The force-push rule coexists with the default-on
   `hooks/branch-protection.js` by design (defense-in-depth; boundary map cites both).
3. Document the full boundary map in `references/four-layer-design.md`: Claude sessions → this
   hook; hetero dispatched engines → worktree containment + contained-branch-only deletion in `reap-dispatch-branches.sh` +
   qc-gate pre-push (already shipped; named as boundary components, not rebuilt).
4. Red-case tests per KR2, including a config-override case and a benign-command pass case.
Acceptance: KR2; hook inventory gates green.

### D4 — Capability-tiered scaffolding (L)
1. `scripts/resolve-scaffold-tier.js`: inputs = engine tuple + role; reads
   `engine-capability-state` / scorecard evidence; outputs `{tier, rationale, evidence_refs}`.
   Tier rules (canonical ONLY in `references/scaffold-tiers.md`): T0 = qualified-for-role with
   FRESH evidence; T1 = fresh-but-partial evidence; **T2 = everything else — unqualified,
   unknown, STALE, or conflicting records (fail-closed)**. Freshness cutoff, source precedence
   (capability-state over imported priors), and conflicting-record→T2 are frozen in fixtures.
2. `references/scaffold-tiers.md`: per-tier prompt skeleton contract (T0: goal + evidence
   contract + red lines; T1: + obligation checklist + verify-first ordering; T2: + full
   prescribed step sequence). Skeletons are per-tier sections consumed by dispatch assembly.
3. Consumer wiring: `dispatch-hetero.sh` already assembles a runner-specific COMBINED prompt
   around the caller's `--prompt-file` (the `GROK_PROMPT_FILE`/`CCSHIM_PROMPT_FILE` step); the
   tier skeleton is prepended to the SHARED prompt assembly BEFORE the per-runner branches (the
   caller `--prompt-file` is wrapped once, so codex/agy/pi/qoder consume the tier identically to
   grok/cc-shim — G2 grok R5); `--scaffold-tier` accepts `auto` (default → resolver) or an
   explicit tier that may only ADD scaffolding relative to the resolved tier (requesting less
   than resolved is rejected — fail-closure applies to humans too, G2 sol R5);
   resolver output recorded in the run manifest for audit. This is prompt-envelope assembly, not
   a second prompt source — the caller's prompt body is untouched (G1 grok note).
4. Fixture tests: three scorecard fixtures → T0/T1/T2; missing scorecard → T2; tier recorded in
   manifest. A/B measurement of tier effect is explicitly OUT of scope (BACKLOG row exists;
   成績單前置 applies before any skill rewrite consumes tiers).
Acceptance: KR3.

### D5 — Cascade, single-round, holdout formalization (S)
1. Cascade, on the REAL rail semantics (G2 grok): risk/security triggers ALREADY escalate —
   computed `review_risk=high` sets `required_review_families=2` + `cross_family_required`,
   which the loop consumer enforces (no new work; a fixture pins this existing behavior). The
   genuinely missing trigger is prior-round outcome: add `--prior-status none|no_verdict|ambiguous`
   to `resolve-review-loop.sh`; `no_verdict|ambiguous` elevates the computed risk to high
   (thereby reusing the exact same families/cross-family escalation path). PRODUCER: the engine
   review loop (`autopilot-engine.js` review-args assembly) passes the prior round's status on
   round N+1 — a named same-phase caller edit. Fixtures: resolver-level (prior-status→high
   mapping; default `none` byte-identical to today) and engine-level (round-2 after no_verdict
   requires a second family; red case asserts the added seat is disjoint-family and no rebuttal
   content is passed).
2. `scripts/check-holdout-coverage.sh` (NEW, the KR5 gate): two subcommands. `run` executes
   `probe-mutation.js` / `verify-strength.js` and writes their stdout JSON into the evidence dir
   as receipts STAMPED with the diff range head SHA and probe exit status (the probes today
   write stdout only — the gate materializes the receipts; G2 grok). `check` computes the risk
   tier via `classify-diff-risk.sh` and, when high, requires a receipt that (a) parses, (b) is
   BOUND to the current diff head SHA, (c) records a passing result — absent, malformed, stale,
   or failed receipts all fail closed (G2 sol). Caller: a numbered quality-pipeline gate step,
   same standing as `completeness-scan.sh` (SKILL-directed deterministic gate — the honest
   description of that rail; it is not a machine-consumed list). Red cases: absent, stale-SHA,
   and failed-result receipts each fail; a bound passing receipt passes.
3. `references/evidence-contract.md` (additive): single-round clause; holdout-leg clause
   (verifier-authored checks frozen after the implementation diff; implementer-invisible).
4. Quality-pipeline reference: gate row for `check-holdout-coverage.sh` + probes named as the
   holdout instruments (call condition: `classify-diff-risk.sh` high tier).
Acceptance: KR4 + KR5.

### D6 — Resume audit + closeout (S)
1. Durable-resume audit note (evidence dir): what survives an interrupt today on the L4-L6 path
   (`--resume`, run-ledger leases, campaign state), the gaps, and whether any gap merits work —
   audit-only; new machinery requires a fresh Board decision (anti-cathedral).
2. CHANGELOG + `sync-version.js` PATCH; 4-step wiring check (`check-claude-md-inventory.js`);
   `sync-all.sh` mirrors; full suite + `preflight-release.sh`; BACKLOG rows updated
   (four-layer row → shipped-mechanisms note; tier A/B eval row added).
Acceptance: KR6; phase SHAs recorded in the evidence dir.

## 5. Test / validation

- Script-gated: per-phase red-case tests (the planted broken case MUST fail before the fix and
  pass after), full `hooks/tests/` suite (fail set ⊆ recorded baseline), KR6 gate set.
- Human-gated: none inside execution (CEO-mode delegation, 2026-08-16); the plan-review
  generations below are the external check.
- Explicitly NOT claimed: that tiering improves outcomes (that is the deferred A/B), or that the
  deny gate stops a determined adversary (it stops the measured accident classes).

## 6. Risks + inversion

- **Rebuilding the cathedral** → anti-cathedral clause in §2.5; D6 resume work is audit-only;
  every mechanism needs a same-phase caller.
- **Deny-gate false positives break legitimate flows** → opt-in rollout, allow-by-default
  outside the deny list, config override per project, benign-case tests.
- **Narrative lint false positives on legitimate spec text** → pattern classes target
  first-person completion claims, not domain words; escape hatch with logged reason; clean-case
  test uses a real historical spec file.
- **Tier resolver trusts editable disk telemetry** (survey: same-UID JSON is advisory) → T0
  requires FRESH qualification evidence; resolver output carries evidence_refs so the audit
  trail shows what the tier stood on; fail-closed to T2.
- **Prompt-skeleton drift across three tiers** → skeletons live in ONE reference consumed by
  assembly, never copy-pasted into scripts (no second canonical statement).
- **What would guarantee failure**: shipping any mechanism without its red-case test; wiring the
  deny gate default-on in the first release; letting the escalation rule trigger a second
  debate round instead of a fresh independent seat.

## 7. Out of scope

- Skill contract-card rewrites (BACKLOG; 成績單前置 requires eval ON/OFF evidence first).
- Tier-effect A/B measurement (BACKLOG row added in D6).
- Any orchestration framework, graph runtime, or parallel implementer topology.
- New durable-execution machinery (D6 audits; building waits for a Board decision).
- Multi-tenant/cloud threat models.

## 8. Open questions

None — CEO-mode delegation resolves defaults: exec-boundary ships opt-in (enabled in autopilot's
own dogfood settings); three tiers (T0/T1/T2); PATCH version.

## Review log

- **R0** — authored 2026-08-16 by the depth-0 session under CEO-mode delegation, from the
  dual-agent survey (`2026-08-16-four-layer-redesign-survey.md`).
- **G1** (2026-08-16, transport complete): CONDITIONAL (GLM C, MiniMax C, grok STOP, sol
  STOP); 17 findings, 11 blocker candidates — 8 accepted, 3 duplicates, 0 rejected. Themes, all
  repaired in this R1: the author's own T1/T2 stale-evidence contradiction (caught by three
  seats independently); cascade landed as orphan resolver fields (now folded into the existing
  `required_review_families`/`qc_panel` rail with an end-to-end red case); holdout was prose
  (now `check-holdout-coverage.sh`, a shipped gate); blind-evidence lint aimed at the trusted
  spec instead of the assembled payload; baseline fail-set capture undefined (now D1 step 0).
  Dispositions: `*.g1-disposition.json`.
- **G2** (2026-08-16, terminal, transport complete): CONDITIONAL (GLM C, **MiniMax READY**,
  grok STOP, sol STOP); 16 findings, 12 blocker candidates — depth-0 terminal adjudication:
  **10 accepted** (force-push KR2/D3 contradiction → resolved as deliberate defense-in-depth
  overlap with branch-protection.js; cascade re-landed on the REAL rail semantics with
  `--prior-status` + engine producer, risk/security triggers recognized as already-escalating;
  tier preamble moved to the shared prompt assembly so every runner consumes it; explicit tier
  override restricted to adding scaffolding; holdout receipts materialized by the gate's `run`
  subcommand and SHA-bound in `check`; blind-evidence threat named as laundering; canonical-home
  contradiction fixed; change-policy deltas enumerated with escape hatches), **2 duplicates**
  (grok/sol force-push = GLM's). 4 non-blocking folded (durable override log to run manifest,
  unchanged-behavior fixture, versioning policy citation, lint-target wording). Dispositions:
  `*.g2-disposition.json`. This R2 text is final; execution proceeds under CEO-mode delegation.
- Bounded review: manifest + frozen rubric beside this plan
  (`2026-08-16-four-layer-redesign.plan-review-manifest.json`, `.rubric.md`); panel GLM-5.3 /
  MiniMax-M3 (required) + grok-4.6@xhigh / gpt-5.6-sol@max (best-effort), `excluded_families:
  anthropic`; two generations maximum; G1/G2 outcomes recorded here on completion.
