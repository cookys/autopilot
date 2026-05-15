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

**Pipeline is a dispatcher. Each step follows its reference doc.**

## Project Config (auto-injected)
!`cat .claude/quality-gate-config.md 2>/dev/null || true`
!`cat .claude/dispatch-config.md 2>/dev/null || true`

## Sub-step References

- **Test policy**: [references/test-policy.md](references/test-policy.md) — failure investigation, pre-existing cleanup
- **Completeness gate**: [references/completeness-gate.md](references/completeness-gate.md) — anti-stub scan
- **Code review**: [references/code-review.md](references/code-review.md) — 4-tier severity, fix-first classification
- **Anti-rationalization patterns**: [references/anti-rationalization.md](references/anti-rationalization.md) — invoked from Failure Handling when retries exhaust

## Available Scripts (prefer over LLM judgment)

Each script encodes a step the pipeline previously asked the LLM to do by hand. Use them; the JSON output is stable across rounds and cheap to consume.

| Script | Replaces LLM-judgment for | When invoked |
|--------|---------------------------|--------------|
| [`scripts/completeness-scan.sh`](../../scripts/completeness-scan.sh) | Anti-stub regex pass + new-vs-pre-existing classification | Completeness Gate step |
| [`scripts/check-redispatch-prompt.sh`](../../scripts/check-redispatch-prompt.sh) | Round 2+ leaky-phrase detection (per `references/blind-dispatch.md`) | Before every re-review dispatch |
| [`scripts/diff-file-list.sh`](../../scripts/diff-file-list.sh) | Reviewer's "list every file I read" enumeration in Verified Clean | Reviewer prompt assembly |
| [`scripts/diff-scope-report.sh`](../../scripts/diff-scope-report.sh) | Whitespace-only / file-not-in-message scope-creep candidate filter | Code Review step (Scope Creep Scan) |
| [`scripts/resolve-dispatch.sh`](../../scripts/resolve-dispatch.sh) | Per-dispatch model/mode lookup against `model-routing-config.md` | Any subagent dispatch |
| [`scripts/verify-preexisting.sh`](../../scripts/verify-preexisting.sh) | Stash + checkout-base + run-test classification | Test Failure Investigation step |
| [`scripts/risk-counter.sh`](../../scripts/risk-counter.sh) | Cross-round WTF-Likelihood Cap state tracking | Self-Regulation section |
| [`scripts/diff-since-last-round.sh`](../../scripts/diff-since-last-round.sh) | Round-N checkpoint + delta-since-checkpoint (dispatcher-only) | Re-review Loop short-circuit decision |

All scripts: `<script> --help` for usage; deterministic exit codes; JSON output where applicable. If a user project ships its own script with the same contract, prefer the project version.

## Route Table

| Size | Route | Steps |
|------|-------|-------|
| **S** | scan → completeness → review | completeness (if not skip) + review |
| **L** | test → scan → completeness → review | all steps |
| **hotfix** | test → review | skip scan/completeness for speed |

## Execution Steps

### Tests (L-size only)

```
Follow references/test-policy.md
  → failure? → classify via `scripts/verify-preexisting.sh '<test-cmd>'`
              → PRE_EXISTING / INTRODUCED / NO_FAILURE / INCONCLUSIVE
              → fix per test-policy → re-run tests
  → pass? → continue
```

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
  → Critical/Major? → fix → re-review (repeat until clean)
  → Suggestion/Minor? → dispatch via Decision Tree below
  → LGTM? → pass
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

During fix loops, track cumulative risk via `scripts/risk-counter.sh` (persisted per repo+branch — no LLM cross-round memory required):

| Event | Risk delta | Increment command |
|-------|-----------|-------------------|
| Fix reverted (didn't work) | +15 | `scripts/risk-counter.sh increment --event reverted` |
| Fix touches 3+ files | +5 | `scripts/risk-counter.sh increment --event multi-file` |
| After 10th fix in same pipeline run | +1 per add'l fix | `scripts/risk-counter.sh increment --event late-fix` |
| Fix touches files unrelated to original change | +20 | `scripts/risk-counter.sh increment --event unrelated-files` |
| Any other fix (just counts toward fixes total) | 0 | `scripts/risk-counter.sh increment --event fix` |

**Thresholds** (orthogonal to retries-per-step below):
- Risk > 20 → **STOP** (check via `scripts/risk-counter.sh threshold-hit`; exit 1 ⇒ stop). Report: "Fix loop risk elevated. N fixes attempted, M reverted."
- Hard cap: 30 fixes per pipeline run (separate from per-step retry cap below)
- On STOP: list all attempted fixes, outcomes, and remaining issues; reset via `scripts/risk-counter.sh reset` only after closing the pipeline run

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
