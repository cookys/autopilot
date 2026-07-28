---
name: quality-pipeline
description: >
  Run pre-commit or pre-merge quality checks: tests, completeness scan (no stubs/TODOs/mocks),
  code review. Use when: "quality gate", "quality checks", "run tests before merge", "check for
  stubs", "scan for completeness", "is this ready to commit?", "pre-merge review", "品質檢查",
  "準備好可以 commit 了嗎", "跑一下檢查". Not for: writing new tests (→ TDD), debugging CI
  failures, or receiving external review feedback.
---

# Quality Pipeline (Unified Quality Gate)

> Routing overlap? If this intent better matches a sibling skill, redirect per [references/routing-tiebreaks.md](../../references/routing-tiebreaks.md) (prefer pre-merge gate failures over manual debugging).

**Pipeline is a dispatcher. Each step follows its reference doc.**

## Project Config (auto-injected)
!`cat .claude/quality-gate-config.md 2>/dev/null || true`
!`cat .claude/dispatch-config.md 2>/dev/null || true`

## Sub-step References

- **Test policy**: [references/test-policy.md](references/test-policy.md) — failure investigation, pre-existing cleanup
- **Completeness gate**: [references/completeness-gate.md](references/completeness-gate.md) — anti-stub scan
- **Test integrity gate**: [references/test-integrity-gate.md](references/test-integrity-gate.md) — L0 anti-gaming (no deleted/skipped/weakened tests)
- **Code review**: [references/code-review.md](references/code-review.md) — 4-tier severity, fix-first classification
- **Anti-rationalization patterns**: [references/anti-rationalization.md](references/anti-rationalization.md) — invoked from Failure Handling when retries exhaust

## Available Scripts (prefer over LLM judgment)

Each script encodes a step the pipeline previously asked the LLM to do by hand. Use them; the JSON output is stable across rounds and cheap to consume.

| Script | Replaces LLM-judgment for | When invoked |
|--------|---------------------------|--------------|
| [`scripts/completeness-scan.sh`](../../scripts/completeness-scan.sh) | Anti-stub regex pass + new-vs-pre-existing classification | Completeness Gate step |
| [`scripts/error-path-scan.sh`](../../scripts/error-path-scan.sh) | L0 attention-slip scan for error paths (swallowed errors, broadened catches, untested error paths) | Completeness Gate step (advisory to review) |
| [`scripts/secret-scan-diff.js`](../../scripts/secret-scan-diff.js) | L0 attention-slip scan for leaked secrets | Completeness Gate step (blocking) |
| [`scripts/adjudicate-findings.js`](../../scripts/adjudicate-findings.js) | "Is this finding real / repair-eligible?" — probe-backed statuses; `gate --ids` = claim-real; `dispose` + `repair-gate --ids` = relevance (`must-fix-now`); `completeness` = all-blocking Critical/Major dispositions over the full registry | Review step: verify → classify → completeness before fix dispatch and before acceptance |
| [`scripts/review-mvp-portfolio.js`](../../scripts/review-mvp-portfolio.js) | Bounded multi-reviewer candidate union → verified MUST-FIX/prerequisite admission + deterministic fixed-budget maximum-score MVP, cut list, and evidence-backed backlog candidates | After a panel returns a complete scored candidate matrix; canonical contract: [`references/reviewer-mvp-portfolio.md`](../../references/reviewer-mvp-portfolio.md) |
| [`scripts/check-repair-scope.js`](../../scripts/check-repair-scope.js) | Cumulative repair stop-loss — sealed contract (`seal --out` + check `--seal`), full `base_sha..HEAD` churn/path/new-file accounting; TRIP ends automatic repair | Before fixer, after every repair mutation, and before acceptance |
| [`scripts/check-redispatch-prompt.sh`](../../scripts/check-redispatch-prompt.sh) | Round 2+ leaky-phrase detection (per `references/blind-dispatch.md`) | Before every re-review dispatch |
| [`scripts/diff-file-list.sh`](../../scripts/diff-file-list.sh) | Reviewer's "list every file I read" enumeration in Verified Clean | Reviewer prompt assembly |
| [`scripts/diff-scope-report.sh`](../../scripts/diff-scope-report.sh) | v2 scope-creep filter: whitespace-only files, files not in message, comment-only hunks, quote-style swaps | Code Review step (Scope Creep Scan) |
| [`scripts/resolve-dispatch.sh`](../../scripts/resolve-dispatch.sh) | Per-dispatch model/mode lookup against `model-routing-config.md` | Any subagent dispatch |
| [`scripts/check-test-integrity.sh`](../../scripts/check-test-integrity.sh) | "Did the implementer game the tests?" — deleted / skipped / soloed / weakened existing tests, escaped fixtures/config (see [references/test-integrity-gate.md](references/test-integrity-gate.md)) | After impl, before merge — esp. delegated / `/l5` hetero dispatch |
| [`scripts/verify-preexisting.sh`](../../scripts/verify-preexisting.sh) | Stash + checkout-base + run-test classification | Test Failure Investigation step |
| [`scripts/verify-red-green.sh`](../../scripts/verify-red-green.sh) | Red-green validation: a change's tests must be GREEN at head and RED at base+tests (else they don't exercise the change) — isolated detached worktrees, verdict from real exit codes | When judging whether new tests actually test the change (see [references/test-policy.md](references/test-policy.md)) |
| [`scripts/reap-dispatch-worktrees.sh`](../../scripts/reap-dispatch-worktrees.sh) | Exact schema-2 worktree state classification and preserve-first dead/clean reclamation | Before closing a managed root run; `check` blocks while exact owned worktrees remain |
| [`scripts/lifecycle-residue-receipt.js`](../../scripts/lifecycle-residue-receipt.js) | Issue or freshness-check exact worktree/branch residue evidence | Before handing lifecycle truth to LSM; a valid receipt does not itself compute `can_close` |
| [`scripts/risk-counter.js`](../../scripts/risk-counter.js) | Cross-round WTF-Likelihood Cap state tracking | Self-Regulation section |
| [`scripts/diff-since-last-round.sh`](../../scripts/diff-since-last-round.sh) | Round-N checkpoint + delta-since-checkpoint (dispatcher-only) | Re-review Loop short-circuit decision |
| [`scripts/qc-panel.js`](../../scripts/qc-panel.js) | Cross-family interrogation panel (shadow mode, task-tree engine) | Shadow QC panel section below |
| [`scripts/calibration.sh`](../../scripts/calibration.sh) | Panel verdict sample store + agreement report | Shadow QC panel section below |
| [`scripts/resolve-qc-gate.sh`](../../scripts/resolve-qc-gate.sh) | Per-project anti-skip gate strength (`block`/`warn`/`off`) for the `.githooks/pre-push` enforcer | On PASS, stamp the landing/merge commit with `QC-Verdict: PASS (reviewer <id>, <date>)` so the pre-push gate is satisfied |

All scripts: `<script> --help` for usage; deterministic exit codes; JSON output where applicable. If a user project ships its own script with the same contract, prefer the project version.

### Shadow QC panel (task-tree engine)

When `docs/projects/<proj>/tree/` exists AND the review target is a verdict-bearing node (report has non-null `verdict`), the dispatcher MUST run `scripts/qc-panel.js` in parallel with the authoritative reviewer (Amendment 4: a silently-dead shadow fails the gate). Convention: `--proj` is the active project's directory name under `docs/projects/` (no auto-detection — an omitted `--proj` means the shadow silently doesn't run, so the dispatcher owns supplying it). The existing reviewer flow REMAINS authoritative — this is shadow-only (KR5: zero behavior change for non-opted-in users; the wiring is conditional on the tree existing).

```
IF docs/projects/<proj>/tree/ exists AND node report has verdict != null:
  Run scripts/qc-panel.js --report <node-report.json> \
      --artifacts <artifact-paths> --out <panel-out-dir> \
      --proj <proj> --node <node-id>
  Panel writes verdict artifact + appends a liveness (self-report-baseline)
  calibration sample automatically (Amendment 4 liveness).
  After the authoritative reviewer completes, add the graduation-bearing sample:
    scripts/calibration.sh add-sample \
      --panel-verdict <panel_verdict> \
      --authoritative-verdict <reviewer_verdict> \
      --baseline reviewer \
      [--class <severity-class>]
  (Baseline separation: the panel's internal sample is liveness-only and
  excluded from graduation math; only the dispatcher's reviewer-baseline
  sample counts toward graduation criteria.)
ELSE: shadow path is a no-op; authoritative reviewer runs unchanged.
```

See [references/code-review.md](references/code-review.md) "Shadow QC panel" subsection for full wiring details and Amendment 4 liveness requirements.

## Route Table

| Size | Route | Steps |
|------|-------|-------|
| **S** | scan → completeness → review | completeness (if not skip) + review |
| **L** | test → scan → completeness → review | all steps |
| **hotfix** | test → review | skip scan/completeness for speed |

## Execution Steps

> **Contract** — the pseudocode blocks below are the **executable dispatch contract** that quality-pipeline reads at runtime: which step runs, which script to invoke, which reference doc owns the rest. They are intentionally minimal. Each step's full spec — rationale, examples, exceptions, prohibitions — lives in the linked reference doc, which is the **canonical source of truth**. Edits to the canonical spec MUST be mirrored here if (and only if) they change the dispatch shape (script name, branching outcome, ordering). Edits to examples/rationale stay in the reference — never duplicate them here.

### Tests (L-size only)

```
Follow references/test-policy.md
  → failure? → classify via `scripts/verify-preexisting.sh '<test-cmd>'`
              → PRE_EXISTING / INTRODUCED / NO_FAILURE / INCONCLUSIVE
              → INTRODUCED + (≥3 failures OR flaky/intermittent OR root cause not
                obvious from the diff) → invoke `autopilot:test-strategy` for the
                failure-investigation funnel (baseline / regression scoping / flaky
                systemic handling) BEFORE patching blindly
              → otherwise: fix per test-policy → re-run tests
  → pass? → continue
```

> **Why route to test-strategy** (added v2.25.10): the classifier tells you *whose* failure it
> is, not *why* it fails or whether it's flaky-systemic. A cluster of INTRODUCED failures or an
> intermittent one is exactly where test-strategy's funnel (test-pyramid placement, baseline
> 守則, regression scoping) prevents whack-a-mole patching. A single obvious INTRODUCED failure
> with a clear diff cause does NOT need it — fix directly. This is the cross-cutting routing edge
> that was missing (2026-06-26 methodology inventory).

> **Long-running / CI-backed test commands (Claude Code only, capability-gated):** when the
> test command is a remote CI run or a multi-minute build, prefer the **`Monitor`** tool over
> re-running `gh run watch` in a busy-loop — Monitor runs the watch script in the background
> and streams each output line back, re-invoking the session on change instead of polling.
> This is optional leverage; on agents without Monitor, fall back to manual `gh run watch` /
> re-checking by hand. See [references/multi-agent-portability.md §7](../../references/multi-agent-portability.md).

### Completeness Gate (if not skip)

```
Follow references/completeness-gate.md
  → run `scripts/completeness-scan.sh` (exit 1 ⇒ has new findings)
  → TODO/stub/placeholder found? → complete or remove them
  → clean? → continue
```

### Code Review (always runs)

**Model routing**: resolve via `scripts/resolve-dispatch.sh --role reviewer` — reads `.claude/model-routing-config.md` if present, else defaults from [references/model-routing.md](references/model-routing.md). Do not hardcode defaults in this file.

```
Follow references/code-review.md (dispatches per .claude/dispatch-config.md '## Code Review' chain; defaults to autopilot:reviewer when chain unset or no chain entry is dispatchable)
  Agent dispatch: read JSON from `resolve-dispatch.sh --role reviewer`
  Before any round 2+ dispatch: `scripts/check-redispatch-prompt.sh <prompt>` (exit 1 ⇒ leaky, strip and retry)
  Optional short-circuit: `scripts/diff-since-last-round.sh stat` (dispatcher-only — doc_only=true ⇒ skip re-review)
  → Critical/Major claims?
       → verify (adjudicate-findings gate / probe|trace)
       → classify relevance (dispose: must-fix-now | follow-up | reject-out-of-scope)
       → completeness: `adjudicate-findings.js completeness --store <store>` (all-blocking; not --ids subset)
       → scope check: `scripts/check-repair-scope.js check --contract <contract> --seal <seal.json>`
       → repair-gate --ids <must-fix-now> → fix only those
       → scope check after every repair mutation (full base_sha..HEAD) → re-review
       → completeness + scope check before acceptance / commit
       (severity orthogonal; union-on-verified Critical/Major intact inside must-fix-now)
  → Suggestion/Minor? → dispatch via Decision Tree below
  → LGTM? → completeness + scope check before acceptance → pass
```

### Pre-existing Error Cleanup (after main task)

```
Follow references/test-policy.md "Pre-existing Error Cleanup" section
  → Project hand-written code? → analyze + fix
  → Auto-generated code? → record root cause, don't edit generated file
  → Third-party dependency? → document only
```

## Dispatch Decision Tree (Non-Critical Findings)

After code review, each Suggestion/Minor finding must be dispatched — never ignored:

```
Finding (Suggestion or Minor severity)
├── (a) S-size fix (< 5 min, self-contained) → fix now, treat as Major
├── (b) False positive / by-design → close with written rationale
├── (c) Independent task needing separate analysis → create task with context
└── (d) Deferred → add to BACKLOG with trigger condition
```

**Rules:**
- Every finding must reach exactly one of (a)-(d). "Will look at it later" is not a valid outcome.
- Backlog entries without a trigger condition are rejected (see references/code-review.md).
- If 3+ findings route to (c) in the same review, consider whether scope was underestimated.

## Self-Regulation (WTF-Likelihood Cap)

During fix loops, track cumulative risk via `scripts/risk-counter.js` (persisted per repo+branch — no LLM cross-round memory required):

| Event | Risk delta | Increment command |
|-------|-----------|-------------------|
| Fix reverted (didn't work) | +15 | `scripts/risk-counter.js increment --event reverted` |
| Fix touches 3+ files | +5 | `scripts/risk-counter.js increment --event multi-file` |
| After 10th fix in same pipeline run | +1 per add'l fix | `scripts/risk-counter.js increment --event late-fix` |
| Fix touches files unrelated to original change | +20 | `scripts/risk-counter.js increment --event unrelated-files` |
| Any other fix (just counts toward fixes total) | 0 | `scripts/risk-counter.js increment --event fix` |

**Thresholds** (orthogonal to retries-per-step below):
- Risk > 20 → **STOP** (check via `scripts/risk-counter.js threshold-hit`; exit 1 ⇒ stop). Report: "Fix loop risk elevated. N fixes attempted, M reverted."
- Hard cap: 30 fixes per pipeline run (separate from per-step retry cap below)
- On STOP: list all attempted fixes, outcomes, and remaining issues; reset via `scripts/risk-counter.js reset` only after closing the pipeline run

## Failure Handling

Any step fails → stop → fix → resume from that step. **Never skip.**

```
Step N fails
  1. Fix the problem
  2. Re-run from Step N (not Step 1)
  3. Pass → continue to Step N+1
```

**Max retries per step**: 3 (counts step failures, not fix attempts — orthogonal to the 30-fix pipeline cap and the 20-risk threshold above). After 3 step failures, escalate via [references/anti-rationalization.md](references/anti-rationalization.md) (7-point checklist + structured failure report) before declaring inability to solve.

## See Also
- `autopilot:dev-flow` — sets session rules and dispatches pipeline
