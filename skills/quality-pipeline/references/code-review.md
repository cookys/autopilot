# Code Review (All Sizes, Mandatory)

**Every commit/merge requires code review. No exceptions.**

## Fix-First Classification (C++ Safe)

Classify each finding AUTO-FIX or ASK before presenting.

**C++ safety principle:** Even "mechanical" C++ edits can change compiled output and runtime. Auto-fix stays narrow.

### AUTO-FIX (apply immediately, no asking)

Only these — nothing that changes compiled output:

| Category | Examples | Why safe |
|----------|----------|----------|
| Comment typos/formatting | `// retrun` → `// return`, missing period | Zero compiled output change |
| Trailing whitespace / extra blank lines | Whitespace-only diffs | Zero compiled output change |
| Log message text corrections | `spdlog::info("recieved")` → `spdlog::info("received")` | String literal only |
| Markdown / documentation fixes | Typos in `docs/`, README, CLAUDE.md | Not compiled |
| Unused `#include` removal | **Only if compiler confirms** no transitive dependency (project build passes) | Must verify — C++ headers have side effects |

**Hard boundary:** Doubt → ASK, not AUTO-FIX.

### ASK (present to user with recommendation)

Everything else, including seemingly trivial items:

| Category | Why not auto-fix |
|----------|-----------------|
| Any code logic change (even "obvious") | C++ implicit conversions, overload resolution |
| `#include` reordering | May change implicit conversion behavior, macro definitions |
| Type cast changes (even narrowing → widening) | Affects overload resolution, template instantiation |
| Variable/function rename | May affect serialization, protocol field names, reflection |
| Error handling changes | Different exception paths, return codes |
| Default parameter changes | Affects all call sites, ABI |
| Const/constexpr additions | May change overload selection |
| `std::move` / forwarding changes | Ownership semantics |

### Workflow

```
1. Collect all findings from code-reviewer agent
2. Classify each finding as AUTO-FIX or ASK
3. Apply all AUTO-FIX silently
   - If any AUTO-FIX involves #include removal: run the project build command to verify
   - Revert on build failure → reclassify as ASK
4. Present ASK findings one-at-a-time with severity + recommendation
5. Summary: "Auto-fixed N items (comments/formatting). M items need your decision."
```

### Classification Example

| # | Finding | Class | Rationale |
|---|---------|-------|-----------|
| 1 | Comment: `// caluclate score` | AUTO-FIX | Typo in comment, no compiled effect |
| 2 | Trailing whitespace in `GameRoom.cpp` | AUTO-FIX | Whitespace only |
| 3 | `spdlog::warn("faild to connect")` | AUTO-FIX | Log string typo |
| 4 | Unused `#include <algorithm>` | AUTO-FIX | Only after build verification |
| 5 | `int` → `size_t` for loop counter | ASK | Changes type, affects comparisons |
| 6 | Reorder includes alphabetically | ASK | May change macro/conversion behavior |
| 7 | Rename `tmp` → `pendingCards` | ASK | May affect debug tooling, serialization |
| 8 | Add `[[nodiscard]]` to return value | ASK | Changes compiler warnings at call sites |


## Invocation

**Dispatch per the `.claude/dispatch-config.md` `## Code Review` chain** (auto-injected atop `skills/quality-pipeline/SKILL.md`). quality-pipeline picks the **first AVAILABLE** reviewer; missing plugins skipped. **`autopilot:reviewer` is the default fallback** when chain unset or nothing dispatchable. Chain = declarative preference; one-off non-chain reviewer → Agent tool direct.

**Model/mode**: `scripts/resolve-dispatch.sh --role reviewer` → JSON `{model, mode, agent, source}` from `.claude/model-routing-config.md` or [`references/model-routing.md`](../../../references/model-routing.md) defaults. Never hardcode at dispatch site.

Example (chain selects `autopilot:reviewer`):

```
Task tool:
  subagent_type: "autopilot:reviewer"
  prompt: "Review the changes against [plan/task description]. Focus on [specific concerns]."
```

> (canonical: references/blind-dispatch.md § Verifier isolation) **Verifier isolation (MUST — EVERY round, round 1 included).** Dispatch prompt/context MUST carry **only artifacts** — diff / changed files / test output — plus the **original** task / plan / commit message as baseline. It **MUST NOT** include the implementer's self-report, summary, "what I did" writeup, or self-assessed verdict: that anchors the verifier into confirming the claim (multi-agent hallucination cascade) — the failure a decorrelated gate prevents. `[plan/task description]` is the *specification*, not a report of work done — keep it; strip any "here's what I changed / it works / this is done" narrative. Rule + baseline-vs-report test: [`references/blind-dispatch.md`](../../../references/blind-dispatch.md) § "Verifier isolation". Orthogonal to round-2+ blind re-dispatch (strips *prior verdicts*); both apply.
>
> Round 2+ (Re-review Loop): leave `[specific concerns]` blank or **non-finding-derived** scope reminders only. Run `scripts/check-redispatch-prompt.sh <prompt>` before dispatch — exit 1 = leaky per [`references/blind-dispatch.md`](../../../references/blind-dispatch.md); MUST strip.

Whichever reviewer the chain selects, the agent (canonical scope also consumed by `agents/reviewer.md`) will:
1. Read every file affected by the diff and the **original task / plan / commit message** as baseline. Callers / tests / config only when a finding depends on them.
2. Run the full correctness / security / boundary / error-handling / performance / API-usage / scope-creep checklist (scope-creep in "Scope Creep / Surgical Changes Scan" below).
3. Return findings with 4-tier severity (🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion) + `✅ Verified Clean` section + `### Handoff` with enum `Next consumer`.

(Non-autopilot reviewers may use another shape — see "Handoff Consumption" for enum vocabulary; foreign shapes → quality-pipeline inline interpretation.)

### Bounded convergence contract

Reviewer output is a **bounded keep/cut list and a minimum shippable version**, not an unbounded
search for further defects.

- Grade only against the frozen task/spec and actual current artifact/baseline. Preferences,
  nitpicks, ideal-architecture deltas, and invented requirements are not defects.
- Classify every item as `MUST-FIX` or `CUT/FOLLOW-UP`. A `MUST-FIX` item names a concrete
  in-scope failure and impact plus the smallest concrete remediation. `CUT/FOLLOW-UP` records why
  optional hardening or aspiration is excluded from this version and never blocks.
- An attack or edge case without a concrete failure and smallest concrete remediation is invalid.
- When the `MUST-FIX` list is empty and the supplied acceptance evidence passes, the review is
  complete and must return a passing verdict. Do not extend the loop with a new wish list or a
  renamed version of a requirement the current artifact already satisfies.

## Handoff Consumption

Read `### Handoff`; route by enum.

**Scope note**: table = enums `autopilot:reviewer` emits. Global grammar (`agents/README.md`) also has `AUTOPILOT_PLANNER`, `PARALLEL_DISPATCH`, `SEQUENTIAL_DISPATCH` — other methodology agents only; quality-pipeline need not consume them here.

| Enum | quality-pipeline action |
|------|------------------------|
| `MAIN_CLAUDE` | Apply fixes inline (or hand to main Claude context) |
| `AUTOPILOT_DEBUGGER` | Re-dispatch `autopilot:debugger` as an independent session to investigate root cause, then loop back to review |
| `AUTOPILOT_PLANNER` | Re-dispatch `autopilot:planner` for six-element Task Prompt decomposition before attempting the fix |
| `NEEDS_DOMAIN_EXPERT` | Use the rationale to pick the appropriate voltagent role agent (e.g., `voltagent-lang:rust-engineer`, `voltagent-data-ai:postgres-pro`) and dispatch for the fix |
| `DOCUMENT_ONLY` | Record the findings without taking fix action (typical for 🟡 Minor / 🔵 Suggestion only runs) |

Methodology agents never call each other. Re-dispatch is quality-pipeline's job, not the reviewer's session.

### Consuming a finding — verify before implementing (findings are suggestions to evaluate, not orders)

A finding is a *claim to check*, not a command. **Severity alone does not authorize scope expansion.** Before dispatching any repair:

1. **Verify the claim** against the codebase. Open cited `file:line`; confirm it. Reviewers confabulate — unreproducible = false positive, not a task. (Consumer half of the Fact-driven Red Line.) Mechanical form: adjudication table (`scripts/adjudicate-findings.js`) — statuses `REPRODUCED` / `REFUTED` / `UNPROBED` / `PROOF_BY_TRACE`. `gate --ids` remains the backward-compatible “is this claim real?” check (`actionable`).
2. **Classify relevance (disposition)** — required for every surviving Critical/Major before repair. Exactly one of:
   - `must-fix-now` — names a frozen acceptance/rubric ID or allowed task surface **and** the concrete harm of deferral;
   - `follow-up` — context + trigger (backlog / next ticket; does **not** enter this repair loop);
   - `reject-out-of-scope` — rationale (does not enter repair).
   Record via `adjudicate-findings.js dispose`. Missing, malformed, conflicting, or uncertain disposition **fails closed** — return to depth-0 scope adjudication; never default to “fix it”.
3. **Blocking completeness** — before fix dispatch **and** before acceptance, run `adjudicate-findings.js completeness --store …`. It enumerates every actionable Critical/Major in the registry (not a caller `--ids` subset), fails on missing or conflicting disposition, and distinguishes `must-fix-now` IDs from follow-up/reject IDs. Subset `repair-gate --ids` alone is never complete.
4. **Scope check** — freeze once at intake with `check-repair-scope.js seal --contract <contract.json> --out <seal.json>` (independent seal path; same-path/self-comparison rejected). Then enforce with `scripts/check-repair-scope.js check --contract <contract.json> --seal <seal.json>`. Full `base_sha..HEAD` accounting (never per-round sums); path/new-file allowlists; ratio + absolute churn caps; symlink/traversal containment; contract digest must match the frozen seal (no in-place reset). **Required** (a) before the fixer runs, (b) **after every repair mutation**, and (c) once more **before acceptance**/commit. A TRIP ends automatic repair.
5. **Dispatch fix only for repair-eligible findings** — `adjudicate-findings.js repair-gate --ids …` passes **only** when each id is actionable **and** disposed `must-fix-now` without conflict. Severity remains orthogonal: `union-on-verified-critical` still unions verified Critical/Major, but only the `must-fix-now` class may mutate the ticket. Always pair with step 3 completeness (registry-wide).
6. **YAGNI-check "do it properly"** — "implement X fully" → `grep` if X is used; unused → propose removal / `follow-up`, not expansion of the current ticket.
7. **No performative agreement.** Never "You're absolutely right!", "Great catch!", or thanks. State the fix (`Fixed — <what changed>`) or reasoned pushback / disposition.
8. **One fix at a time, re-verify** — no batch-apply-and-hope; each fix checked (re-review loop enforces at round level). Re-run scope check after every repair mutation and before acceptance.

**Action order (binding):** verify claim → classify relevance → completeness → scope check → dispatch fix → (after mutation) scope check → … → completeness + scope check before acceptance.

Mechanical form: `scripts/adjudicate-findings.js` (`gate` = claim-real; `dispose` + `repair-gate` = relevance; `completeness` = all-blocking disposition coverage); `scripts/check-repair-scope.js` = cumulative stop-loss with independent `--seal`. `union-on-verified-critical` "verified" = actionable status; repair authority additionally requires `must-fix-now`.

## Scope Creep / Surgical Changes Scan

**Every changed line must trace directly to the stated task, plan, or commit message.**

Beyond correctness / security / boundary / error-handling / performance / API-usage, the reviewer **must** scan for unrequested changes — the common LLM failure of "improving" adjacent code, refactoring unbroken code, or cleaning what they think they understand.

### Pre-screen (cheap, deterministic)

Before per-hunk judgment: `scripts/diff-scope-report.sh [--message-file <commit-msg>]`. v1 signals: `whitespace_only_file`, `unrelated_to_message`. JSON `findings` = candidates to judge, not auto-findings. Unscreened hunks still get the mapping test below.

### What counts as scope creep

| Pattern | Example |
|---------|---------|
| Reformatting unrelated lines | Reindenting a function the task didn't touch |
| Renaming outside the task surface | Renaming `tmp` → `pendingCards` in a file the task only adds one method to |
| Refactoring "while we're here" | Extracting a helper from existing code the task didn't need to call |
| Style alignment beyond changed lines | `'` → `"` quote swaps, trailing commas, etc., in unmodified code |
| Deleting pre-existing dead code | Removing a function the task didn't make unused (only newly-orphaned code may be removed) |
| Comment cleanup unrelated to the change | Rewording or removing comments on lines the task didn't touch |
| Dependency / config tweaks not required by the task | Bumping unrelated package versions, reordering imports |

### The test

Per changed hunk: **"Which sentence of the task description does this hunk implement?"** No map → scope creep.

### Severity

| Situation | Severity |
|-----------|----------|
| Unrequested change in compiled output (rename, refactor, dep change, behavior tweak) | **Major** |
| Unrequested whitespace / formatting / comment edit in compiled-output files | **Minor** |
| Unrequested whitespace / formatting in pure-doc files (`.md`, comments-only) | **Suggestion** |
| Newly-orphaned imports/variables/functions removed by the task | ✅ Verified Clean (not scope creep — cleanup is required) |

### Reviewer output contract

Scope creep found → dedicated subsection:

```
### Scope Creep Findings

🟠 Major — `src/foo.cpp:42-58` reindented; not in task description.
🟡 Minor    — `src/bar.h:103` comment reworded; not part of the requested fix.
```

No scope creep → `✅ Verified Clean` MUST include:

```
- No scope creep — every changed line traces to the task.
```

so consumers know the scan ran. Seed Verified Clean via `scripts/diff-file-list.sh changed` (no LLM-from-memory file list).

### Why this matters (one-liner)

Mixed task + scope-creep changes inflate review, break `git blame` / bisect, and (esp. C++) risk silent behavior shifts from "harmless" refactors. Push back at review; cheaper than post-merge revert.

## No silent caps — disclose every bound

**Any bounded coverage — top-N, per-segment, sampled, or skipped-on-timeout — MUST be DISCLOSED in the verdict. An undisclosed bound is a defect.** Partial file reads, one partition, samples, or timeout drops belong in the report (`### ✅ Verified Clean` or `### Summary`) as *what was NOT covered*. Believing a partial sweep was exhaustive is worse than knowing the bound.

**Generalizes `skills/doc-sync` ethos**: doc-sync treats its non-deterministic LLM sweep as bounded — *"a 'clean' sweep only means this sample found nothing, never that nothing exists"* — never proof of absence. Same honesty for any bounded review/audit: name the bound; never silent.

## Panel aggregation (multi-reviewer / disjoint-family qc)

When authoritative qc is a **panel** (depth-0 from `scripts/resolve-review-loop.sh` `qc_panel` / `required_review_families` / `min_panel_size`; homogeneous all-Claude must not drop below resolver **`min_panel_size`** (default 3), separate from `required_review_families` — lens diversity ≠ family decorrelation; same-family lenses share blind spots; no resolver → fall back to 3 — see [`skills/ceo-agent/references/level-front-door.md`](../../ceo-agent/references/level-front-door.md) § "qc@depth-0"), combine by **`union-on-verified-critical`**, NOT majority:

- **Any panelist's _verified_ Critical/Major blocks.** Correlated-blind-spot catches appear to ONE reviewer (often cross-family). **Majority would suppress exactly the finding the panel exists for** — majority **forbidden** (`resolve-review-loop.sh` rejects `qc_panel_aggregation: majority` → `union-on-verified-critical`).
- **"Verified" gates the union, not raw count.** Before a single-track finding blocks: reproduce it — **executable** via `independent_harness` (execution = decorrelation ceiling, zero shared LLM lineage); non-executable (design/spec-fit) → depth-0 second-look. Stops noisy false-blocks; never lets a real single-track Critical through.
- **No-verdict = FAIL-CLOSED.** Empty/unparseable (e.g. `dispatch-review.sh` `status:no_verdict` from agy stdout-drop) = **"did not clear"**, never silent pass. Re-dispatch or treat as blocking unknown.
- **Decorrelate by _family_, not just lens.** Same-vendor N share failure modes; panel needs **≥1 family ≠ implementer's** (`cross_family_required`/`cross_family_satisfied` from `resolve-review-loop.sh`; **unknown-family** fails closed = unsatisfied). Grounding: PoLL (disjoint families beat one large judge + cut intra-model bias) + same-family self-preference/familiarity bias.
- **Risk-tiered depth, honest terminals (v2.25.11).** Depth follows deterministic `implementation_review_risk` (NOT source-trust alone — diff risk, oracle availability, security surface; `resolve-review-loop.sh`), not who implemented. **High risk**: cross-family hard-required + **decorrelated execution oracle (`l1_required`) mandatory** — absence → `block`/non-automerge (`--enforce` exit 3). Terminals, never forged softer: **`verified`** (decorrelated oracle/reviewer cleared), **`unverified-nonblocking`** (low-risk, proceeds but HONESTLY unverified — NOT green), **`unverified-blocking`** (high-risk missing L1/cross-family — blocked). `warn`/`off` may suppress BLOCKING but **never** relabel `unverified` as `verified`. Design (honest-but-weak only, not malicious-proof): [`docs/plans/2026-06-26-trust-tiered-review-policy.md`](../../../docs/plans/2026-06-26-trust-tiered-review-policy.md).

## 4-Tier Severity

| Severity | Definition | Action |
|----------|------------|--------|
| **Critical** | Correctness / security / data-loss | Fix immediately, before commit |
| **Major** | Quality / maintainability / reliability | Fix immediately, before commit |
| **Minor** | Style, naming, cosmetic | Analyze, then backlog or fix (see below) |
| **Suggestion** | Improvement, does not affect correctness | Analyze, then backlog or fix (see below) |

**Classification guide:**

| Symptom | Severity |
|---------|----------|
| Crash, data corruption, security hole | **Critical** |
| Coding convention violation, missing error handling, resource leak risk | **Major** |
| Naming style, whitespace, formatting | **Minor** |
| Better design, readability, performance suggestion | **Suggestion** |

## Re-review Loop (Critical / Major)

Critical/Major **claims** still surface via `union-on-verified-critical`. Only findings that pass **repair-gate** (`must-fix-now`) enter the fix loop; `follow-up` / `reject-out-of-scope` / unclassified do not mutate the ticket.

```
review → findings?
├── Has Critical/Major
│     → verify claim (adjudicate gate / probe|trace)
│     → classify relevance (dispose: must-fix-now | follow-up | reject-out-of-scope)
│     → completeness (all actionable Critical/Major disposed; not --ids subset)
│     → scope check (check-repair-scope.js --seal; TRIP ⇒ stop automatic repair)
│     → repair-gate --ids <must-fix-now set>
│     → fix only repair-eligible
│     → scope check after every repair mutation (full base_sha..HEAD)
│     → re-review (repeat until clean or stop-loss)
│     → completeness + scope check before acceptance / commit
├── Only Suggestion/Minor → process per below → commit
└── Clean (LGTM) → completeness + scope check before acceptance → commit
```

**Re-review scope:** After each fix round, re-review the **entire diff**, not just the fix. Fixes can introduce new issues. Re-run the repair-scope checker on the full `base_sha..HEAD` after every repair mutation and once more before acceptance.

**Re-review checkpoint (dispatcher-only)**: Before round 1, `scripts/diff-since-last-round.sh mark` snapshots HEAD; between rounds `scripts/diff-since-last-round.sh stat` → JSON `{changed_files, insertions, deletions, doc_only}`. If `doc_only=true` and `changed_files` trivially small, dispatcher MAY short-circuit. Decision + data stay **in the dispatcher only** — never pass delta to the reviewer (leaks round-cycle meta-signal per [`references/blind-dispatch.md`](../../../references/blind-dispatch.md)). Loop closed → `scripts/diff-since-last-round.sh clear`.

**Re-review dispatch is blind** — round 2+ re-dispatch of `autopilot:reviewer` (or chain pick) MUST strip prior-round findings. Pre-flight: [`references/blind-dispatch.md`](../../../references/blind-dispatch.md); `scripts/check-redispatch-prompt.sh <prompt-file>` — exit 1 ⇒ strip and re-check. Prior finding stays in dispatcher memory; fixer is NOT blind (gets full finding). Skipping the linter self-bypasses the gate. Holds at any nesting depth — neither reviewer nor fixer dispatches the next round's review ([`references/blind-dispatch.md`](../../../references/blind-dispatch.md) § Nested dispatch).

## Suggestion / Minor Processing

**Suggestion/Minor ≠ "ignore."** Analyze each before merge:

```
For each Suggestion/Minor finding:
    ↓
Dispatch Explore agent to analyze impact and effort
    ↓
Classify into one of four outcomes:
├── S-size fix (< 5 min) → fix now, treat as Major
├── False positive / by-design → close with written rationale
├── Independent task needing more analysis → create next task with context
└── Has clear trigger condition → add to docs/BACKLOG.md with trigger
```

### Example Processing Table

| # | Issue | Severity | Analysis | Size | Disposition |
|---|-------|----------|----------|------|-------------|
| 1 | Null deref in error path | Critical | Crash when DB returns empty | S | Fix now + re-review |
| 2 | Missing mutex on shared map | Major | Race condition under load | S | Fix now + re-review |
| 3 | Could use string_view instead of string copy | Suggestion | 2% fewer allocations in hot path | S | Fix now (upgrade to Major) |
| 4 | Function name `doIt()` unclear | Minor | Rename to `processMatchResult()` | S | Fix now (upgrade to Major) |
| 5 | Consider caching DB query result | Suggestion | Would help at 10K+ users, not current scale | M | Backlog (trigger: when optimizing for 10K+) |
| 6 | "Magic number 42" | Minor | Actually `MAX_TILES` constant, used consistently | - | Close (by-design) |

### Backlog Entry Format

Every backlog entry **must** include a trigger:

```markdown
- [ ] [Suggestion] Cache rank table query results
  - Trigger: when optimizing for 10K+ concurrent users
  - Context: quality-pipeline (code-review) found repeated DB queries in the target module
```

No trigger → rejected.

## Review Timing

| Size | When | Baseline |
|------|------|----------|
| S | Before commit | Task intent |
| M | Before finishing branch | Original objective |
| L (Phase) | After each phase | Phase plan |
| L (Final) | Before finishing branch | Full project plan |

## Prohibited Excuses

All sizes require review. Major fixed now. Fix requires re-review. No severity without analysis. No backlog without trigger.
> Full list: [_base/prohibited-behaviors.md](../_base/prohibited-behaviors.md)

## Shadow QC panel (task-tree engine)

Condition: `docs/projects/<proj>/tree/` exists AND target is a verdict-bearing node (non-null `verdict`). Auto opt-in when tree present (KR5: zero change for non-opted-in users).

| What runs | How | Authority |
|-----------|-----|-----------|
| Authoritative reviewer | Existing flow (this doc) | Authoritative — findings drive fixes |
| `scripts/qc-panel.js` | In parallel with authoritative reviewer | Shadow only — no fix action; informs calibration |

**Amendment 4 liveness (binding)**: every panel run MUST (a) write verdict artifact JSON under `docs/projects/<proj>/tree/panel/` AND (b) emit a calibration sample via `scripts/calibration.sh add-sample`. Either fails → `qc-panel.js` non-zero; silently-dead shadow fails the gate.

**Baseline separation (M2 binding)**:

- Internal `calibration.sh add-sample` uses `--baseline self-report` (panel vs node-report self-verdict). **Liveness-only** — not in graduation math.
- After both authoritative reviewer and panel verdicts exist, dispatcher adds a **second**, **graduation-bearing** sample with `--baseline reviewer`:

```sh
scripts/calibration.sh add-sample \
  --panel-verdict <panel_verdict> \
  --authoritative-verdict <authoritative_reviewer_verdict> \
  --baseline reviewer \
  [--class <severity_class>] \
  [--tokens <panel_token_estimate>]
```

`scripts/calibration.sh report` uses agreement, false-pass-on-critical, sample_count, graduation **only over `baseline==reviewer`** (missing field = reviewer for backward compat). `self_report_sample_count` printed separately.

Report feeds Board P5→active (Amendment 6). No authority shift before graduation criteria met.

### Finding-survival (refute pass) — SHADOW / non-gating until calibrated

Q1–Q3 interrogate the **implementer**; nothing checks the panel's own `MISSED:` before a fix round. Project memories (`verify-reviewer-claims`, `delegate-selftest-false-green`): findings are claims, not orders. `qc-panel.js` 4th shape = **refute pass**: for each candidate miss, the **other** cross-family judge (not the raiser) tries to refute — wrong / already satisfied / out of scope. **Uncertainty AGAINST the finding** (`default-refuted-if-uncertain`): miss **survives only by explicitly defeating refutation**.

🔴 **SHADOW only — non-gating until graduated.** Authoritative verdict **unchanged**: non-empty `MISSED:` still fails. Refute rides **alongside** as `refute_shadow:{refuted_misses[],survived_misses[]}` in panel JSON + calibration `--source` (`refute=refuted:N,survived:M,gating_misses:K`) — does **not** alter `verdict`. Suppressing a true critical via refute is worse than the bug; **calibration only**. Authoritative **only after** `scripts/calibration.sh` (`run-known-bad`) shows no false-suppress of criticals — same `GRAD_*` bar as the panel (min samples, min agreement, `false_pass_on_critical == 0`).

## See Also

| Skill | Boundary |
|-------|----------|
| `quality-pipeline` (completeness-gate) | Must pass before code review starts |
| `quality-pipeline` (test-policy) | Must pass before completeness gate |
| `quality-pipeline` | Unified entry point that orchestrates all three |
