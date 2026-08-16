# Plan — Four-layer redesign: contract hardening + capability tiering

> Status: R1 (post-G1 bounded repair) · Owner: cookys (CEO-mode delegated 2026-08-16) · Branch: develop → feature branch `feat/four-layer` · Frame: mechanism hardening on existing rails

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
  entry + config template shipped; the hetero-engine boundary map (worktree containment + qc-gate
  pre-push) is documented in the same reference.
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

- **Compatibility impact**: `published-compatible` — additive public surfaces (a new opt-in
  hook with config template + install docs, new resolver scripts, reference clauses); nothing
  removed or renamed; no skill/agent added/removed; no routing-affecting description change;
  existing config surfaces gain optional fields only. Versioning: PATCH (new hook + new scripts
  per the user-facing-milestone policy).
- **Dependency decision**: `none` — Node built-ins throughout.

## 3. File-structure map

| File / area | Action | Responsibility |
|---|---|---|
| `references/four-layer-design.md` | create | the design record: layer map, T0/T1/T2 tier definitions, cascade + single-round rules, blind-evidence rule, execution-boundary map, anti-cathedral constraints |
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
1. `scripts/check-blind-evidence.sh`: scan the ASSEMBLED reviewer payload (spec file + any
   prompt packs — the implementer→reviewer corruption surface per G1 grok R3; `--spec-file`
   remains the trusted dispatcher-authored baseline) for implementer-narrative classes
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
   `rm -rf` outside `$TMPDIR`/worktree roots, `DROP TABLE|TRUNCATE` against non-test DSNs,
   `sudo rm`; force-push stays with `branch-protection.js`). Deny = structured block message naming the matched rule;
   allow-by-default otherwise. NO LLM calls.
2. Register opt-in via the per-event opt-in-multiplexer rail (entry in
   `hooks/opt-in-manifest.json`, armed per `~/.autopilot/config.json {"hooks":{"exec-boundary":true}}`
   or `AUTOPILOT_HOOK_EXEC_BOUNDARY=1`; opt-in changelog per `check-optin-changelog.js`); enable
   in autopilot's own dogfood config. Protected-ref force-push is ALREADY covered by the shipped
   `hooks/branch-protection.js` — exec-boundary defers to it (no duplicate rule; the boundary map
   cites both).
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
   tier skeleton is PREPENDED there (`--scaffold-tier auto|T0|T1|T2`, default auto→resolver);
   resolver output recorded in the run manifest for audit. This is prompt-envelope assembly, not
   a second prompt source — the caller's prompt body is untouched (G1 grok note).
4. Fixture tests: three scorecard fixtures → T0/T1/T2; missing scorecard → T2; tier recorded in
   manifest. A/B measurement of tier effect is explicitly OUT of scope (BACKLOG row exists;
   成績單前置 applies before any skill rewrite consumes tiers).
Acceptance: KR3.

### D5 — Cascade, single-round, holdout formalization (S)
1. `resolve-review-loop.sh`: fold escalation into the EXISTING consumed output — triggers
   (computed `review_risk` ≥ threshold, new `--prior-status no_verdict|ambiguous` input,
   security surface) extend `required_review_families` / `qc_panel` so the existing qc dispatch
   path seats ONE fresh disjoint-family reviewer (family = roster `family` field);
   no-disjoint-family-available fails closed with a named reason; fixtures prove the end-to-end
   trigger→seat mapping and the red case asserts no same-family seat and no rebuttal dispatch;
   existing risk-tier behavior unchanged.
2. `scripts/check-holdout-coverage.sh` (NEW, the KR5 caller): given the diff risk tier (from
   `classify-diff-risk.sh`) and the run evidence dir, exit 1 when high-risk and no
   `probe-mutation.js` / `verify-strength.js` receipt exists; exit 0 otherwise. Wired into the
   quality-pipeline deterministic gate list; red case per KR5.
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
- Bounded review: manifest + frozen rubric beside this plan
  (`2026-08-16-four-layer-redesign.plan-review-manifest.json`, `.rubric.md`); panel GLM-5.3 /
  MiniMax-M3 (required) + grok-4.6@xhigh / gpt-5.6-sol@max (best-effort), `excluded_families:
  anthropic`; two generations maximum; G1/G2 outcomes recorded here on completion.
