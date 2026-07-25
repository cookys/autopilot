# Review Scope Stop-Loss

Status: approved by user on 2026-07-26.

## Incident

Revival World 3D ticket 030-P2 was an asset-production pipeline POC. A reviewer raised
valid hardening concerns about an optional phone/browser preview tool. The implementation
loop treated every verified Major as an instruction to extend the current ticket, so the
preview helper grew into an authenticated, expiring, digest-bound publish receipt system.
The work was technically defensible but unrelated to the product goal.

The current quality pipeline already says findings are claims, supports refutation, and
mentions YAGNI. Its action rule nevertheless remains “verified Critical/Major ⇒ fix now”,
without a durable relevance classification or a cumulative scope-growth stop.

## Project Goal

> **Final goal**: keep high-severity review useful while preventing it from silently
> changing the task being built.
>
> **Success criteria**:
>
> 1. Every surviving Critical/Major implementation finding has one explicit disposition:
>    `must-fix-now`, `follow-up`, or `reject-out-of-scope`.
> 2. Only `must-fix-now` findings enter the repair loop; severity alone cannot authorize
>    scope expansion.
> 3. A deterministic guard stops a review repair loop when it introduces an unplanned
>    subsystem or exceeds a frozen cumulative diff budget.
> 4. Regression tests prove: in-scope Major blocks, out-of-scope Major does not mutate the
>    current ticket, and scope growth trips the stop condition.
> 5. Existing union-on-verified-Critical/Major semantics remain intact inside the
>    `must-fix-now` class.
>
> **Verification**: focused shell tests for the new adjudication/stop-loss contract plus
> the existing review-loop and quality-pipeline test suites pass.

## Scope Boundary

Included:

- implementation-review finding disposition contract;
- machine-checkable adjudication artifact or checker;
- cumulative diff/new-subsystem stop-loss tied to the frozen task boundary;
- quality-pipeline and review-loop documentation;
- regression tests and version/changelog sync required to ship the plugin.

Excluded:

- changing plan-review classification (already has its own bounded controller);
- changing reviewer roster, model selection, severity definitions, or majority policy;
- redesigning the whole engine review protocol;
- fixing Revival World 030-P2 product code in this branch.

## Requirements Ledger

| User requirement | Phase |
|---|---|
| “這屬於 autopilot 缺陷還是你被本專案的那些限制或文件誤導?” | Phase 1 records the combined root cause and preserves the incident as a regression fixture. |
| “應該先修 flow 避免以後又歪?” | Phases 1–3 implement and verify the shared-flow fix before 030 continues. |
| Reviewer 概念偏掉時 Core 要攔 | Phase 1 makes relevance adjudication a required gate before repair. |
| 合法資產 pipeline 不得被裝置驗證帶離目標 | Phase 2 negative control models an optional helper whose hardening is follow-up, not current-ticket work. |

## Phase 1: Finding Relevance Gate

Extend the existing append-only `adjudicate-findings.js` protocol rather than create a
second finding registry:

- retain `gate` as the backward-compatible “is this claim real?” check;
- add a disposition event with exactly one of `must-fix-now`, `follow-up`, or
  `reject-out-of-scope`;
- add `repair-gate`, which succeeds only when a finding is both actionable under the
  existing probe/trace rules and disposed `must-fix-now`;
- require `must-fix-now` to name a frozen acceptance/rubric ID or allowed task surface
  plus the concrete harm caused by deferral;
- require `follow-up` to carry context and a trigger; require rejection to carry a
  rationale.

Missing or uncertain relevance fails `repair-gate` and returns to depth-0 scope
adjudication. It does not default to implementation. Existing consumers of `gate` remain
byte-compatible.

## Phase 2: Cumulative Scope Stop-Loss

Add a deterministic checker driven by a frozen JSON contract created once at
implementation-review intake:

```json
{
  "schema": 1,
  "task_id": "030-p2",
  "base_sha": "<immutable task base>",
  "implementation_sha": "<first reviewed implementation>",
  "allowed_path_prefixes": ["scripts/assetctl/", "client/src/ops/"],
  "allowed_new_paths": ["scripts/assetctl/tests/**"],
  "baseline_churn": 400,
  "max_growth_ratio": 1.5,
  "max_extra_churn": 200
}
```

Definitions and trip rules:

1. **Accounting baseline**: every round recomputes the full `base_sha..HEAD` diff; it
   never sums per-round deltas, so revert/re-add cannot game the counter.
2. **Churn unit**: `insertions + deletions` from Git numstat; binary files count as one
   changed file and are still subject to path/new-file rules.
3. **Growth trip**: stop when either total churn exceeds
   `baseline_churn × max_growth_ratio` or added churn exceeds `max_extra_churn`.
   Both thresholds are explicit, positive contract fields; there is no permissive
   implicit default.
4. **Subsystem trip**: stop when a changed path is outside `allowed_path_prefixes`, or a
   newly tracked path was absent at `implementation_sha` and does not match
   `allowed_new_paths`. Prefixes/globs are repo-relative; traversal and symlink-resolved
   escape are rejected.
5. **Reset**: the contract is immutable for one review loop. A trip ends automatic
   repair. Only an explicit task split or scope re-approval may create a new contract;
   no fixer/reviewer may reset it in-place.

Fixtures must independently cover path escape, unapproved new file, ratio trip, absolute
churn trip, revert-safe full-diff accounting, allowed in-scope repair, and an attempted
in-loop reset.

## Phase 3: Integration, Dogfood, and Release Sync

Wire the contracts into the canonical quality/review flow, add RED/GREEN fixtures based
on the 030-P2 failure shape, run focused and existing suites, update changelog/version
mirrors, and perform independent implementation review.

## Review Loop History

- 2026-07-26 depth-0 diagnosis: project scope drift and Core adjudication failure were
  contributing causes; the reusable Autopilot defect is the missing relevance/action
  boundary plus missing cumulative implementation-growth stop.
- 2026-07-26 generation 1, gpt-5.6-sol: CONDITIONAL on R3 because “subsystem” and
  “configured growth” were not deterministic. Phase 2 now freezes path/new-file rules,
  two explicit churn thresholds, full-diff accounting, and a no-in-place-reset rule.
- 2026-07-26 generation 2 controller: STOP at 1.5086× bytes (6499/4308). Depth-0
  adjudication: the 2191-byte increase only specifies the admitted R3 repair above and
  adds no deliverable, surface, or phase. The stop evidence is retained; implementation
  is frozen to this revision and any further scope change requires user approval.
