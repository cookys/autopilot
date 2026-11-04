# Heterogeneous Review Loops

> Reference for the dev-flow heterogeneous review loops and gating scripts.
> Origin: `project/plans/_archive/2026/09/2026-09-04-dev-flow-hetero-loops-default.md` D2 deliverable.

This reference indexes the three deterministic scripts supporting dev-flow's plan-review scaffolding, heterogeneous code-review loop execution, and phase review receipt gating.

### scripts/plan-rubric-scaffold.js

- **What**: Generates a structured rubric markdown skeleton from an input plan document.
- **When**: Called during the `plan_review` scaffolding stage before freezing review rubrics.
- **Contract**: Canonical options and flags in `node scripts/plan-rubric-scaffold.js --help`; indexed in `docs/scripts-inventory.md`.

### scripts/hetero-review-loop.js

- **What**: Executes multi-seat review collection, disposition aggregation, verdict synthesis, and opt-out receipt generation. Supports `--exclude <pathspec,...>` on `collect` to omit generated or mirrored files via negative pathspecs, records `excluded` and `diff_bytes` in `range.json`, and warns if diff size exceeds 400,000 bytes prior to dispatching.
- **When**: Called by the `hetero_review` generation-adversarial review loop via `collect`, `finalize`, or `opt-out` subcommands.
- **Large range**: A range too large for one packet is split by path with `--packets <packets.json> --packet <id>` (every changed file in exactly one packet) and gated by `check-phase-review-receipt.js --packets`; `--exclude` is never the way to shrink a review.
- **Frozen review set that cannot take new files**: when a fix adds files the first set cannot absorb, review the rest with a second set and gate with `check-phase-review-receipt.js --chain A,B --ledger <dir> --branch <b> --phase-base <sha>`; every set must be SHIP-AS-IS, set k must start at set k-1's last reviewed head, and every changed path must lie in some set's range. Packets members are not supported yet: validate those separately with `--packets`.
- **Contract**: Canonical options and subcommands in `node scripts/hetero-review-loop.js --help`; indexed in `docs/scripts-inventory.md`.

### scripts/check-phase-review-receipt.js

- **What**: Validates phase review receipts (`receipt-<phase>.json`) against git history and review artifacts, or validates plan artifact blocker dispositions.
- **When**: Called when gating the move past a review node on a finalized `SHIP-AS-IS` review receipt, a valid `off` opt-out receipt, or dispositioned candidate blockers.
- **Merge gate runs on the tip**: the merge gate runs `check-phase-review-receipt.js` against the branch tip that gets merged, never against the last reviewed head. Below the generation cap, any product-code delta after the last reviewed head gets one more single-seat delta review, so the receipt passes on the tip (a process rule, no flag). At the generation cap, the PM ruling plus a post-head ledger: `--post-head-ledger <file>` (Mode A only; `--chain`, `--packets` and Mode B refuse it). The ledger is JSON, `{"schema":"post-head-ledger/1","phase":"<id>","reviewed_head":"<full sha>","ruling":"<PM ruling id or text>","commits":[{"sha":"<full sha>","paths":["..."],"verification":"<how depth-0 verified it: red/green or mutation, with an evidence path>"}]}`, and `--post-head-target <ref>` (required with the ledger; what the branch merges into, normally origin/develop) names the merge target. It is a declaration, not a trust root: the checker re-derives the branch's own commits, `git rev-list --no-merges <head>..<tip> ^<target>`, and each commit's paths (`git diff-tree -r --no-renames --name-only`) and fails on any unlisted commit, any path outside a commit's listed paths, any extra or duplicate sha, an empty verification, a phase or reviewed_head mismatch, or a head that is not an ancestor of the tip. Commits that came in by merging the target into the branch are not listed (another phase reviewed them). The target is not trusted: it is resolved to a sha and must descend from `--phase-base` and must not contain the last reviewed head (so not the tip, the branch, or a line that already took the work); `--post-head-target` without the ledger is refused. A merge commit in that range whose tree differs from git's own re-merge of its two parents (`git diff-tree --remerge-diff`: conflict resolution, evil merge, taking one side whole, `-X`, `-s ours`) must be listed under its own sha with paths covering that difference; a clean merge needs no entry, and a merge with more than two parents fails closed.
- **Contract**: Canonical options and usage in `node scripts/check-phase-review-receipt.js --help`; indexed in `docs/scripts-inventory.md`.

## Consult before design

Canonical call site is the dev-flow `plan` node (the receipted consult step); this section documents the rail, it is not a second statement of the rule. For an L or XL task, before the design decision, write the design question and relevant artifacts to files and call `bash scripts/dispatch-consult.sh --question-file <path> --artifact <path>` to get one bounded outside opinion before committing to the design.

## Plan-review Gate & Frozen Rubrics

The `plan-review` node ensures architectural, design, and boundary assumptions are rigorously challenged before code implementation starts. Invoked via `autopilot:hetero-review` with the target plan file path, the loop scaffolds a structured evaluation matrix using `scripts/plan-rubric-scaffold.js`.

### Why the Gate Requires a Frozen Rubric (ADR-0001 & Depth-0 Re-derivation)
Under ADR-0001, any review verdict remains merely an unverified claim until depth-0 tooling independently re-derives it from the reviewer's structured JSON artifact and the exact base..head range or plan revision it reviewed. A passing review verdict in isolation cannot serve as a deterministic gate because review evaluations are vulnerable to post-hoc rubric drift or subjective goalpost movement. Therefore, the gate requires:
1. A **frozen rubric** generated prior to review evaluation, locking the criteria against retrospective watering-down.
2. Verification via `node scripts/check-phase-review-receipt.js --plan-artifact <file> --dispositions <file>` exiting 0, confirming every candidate blocker has an explicit accepted or rejected disposition.
3. In case the `plan_review` configuration knob resolves to `off`, an explicit opt-out receipt generated by `scripts/hetero-review-loop.js opt-out --knob plan_review` along with a `capability_warnings` record.

### Three-State Configuration Knobs
The review knobs (`plan_review`, `hetero_review`, `consult_dispatch`) follow uniform tri-state semantics:
- `off`: The stage is skipped; an explicit opt-out receipt is stamped and a `capability_warnings` entry is emitted.
- `on`: An explicit seat tuple is strictly required; any missing, incomplete, or malformed tuple immediately exits 3.
- `auto`: If at least one qualified seat exists in the execution topology, the seat tuple expands automatically from topology and stamps `resolved_from: topology`. If the configuration file is absent, JSON is malformed, or zero qualified seats are discovered, it falls back to a claude-native seat, stamps `resolved_from: native-fallback`, emits a `capability_warnings` line, and the review stage still executes.

Receipt verdicts strictly permit only two tokens: `SHIP-AS-IS` and `FIX-THEN-SHIP`. Furthermore, reviews employ the unified severity vocabulary without inventing novel severity terms. Implementer claims of passing status remain claims until mechanically verified.

---

## Code-review Gate & Receipt Chain Validation

The `code-review` node runs once, after all units, on the full diff from the marker's `base_ref`, and gates `qc-gate` on:
`node scripts/check-phase-review-receipt.js --ledger <ledger> --phase full --branch <b> --phase-base "$(cat <ledger>/phase-full.base)"`

### What Receipt Validation Checks
1. **Contiguous Generation Chain**: Verifies that generations start at generation 1, increase contiguously without gaps, and link each iteration's base and head commits.
2. **Matching Head & Base**: Validates that the receipt's reviewed range matches the exact current branch HEAD and the recorded immutable base. A review of stale commits cannot gate current code.
3. **SHIP-AS-IS Verdict or Explicit Opt-Out**: Confirms that the final aggregated verdict across seats is `SHIP-AS-IS` with all identified blockers dispositioned, or that a valid opt-out receipt was produced when `hetero_review` was configured to `off`.

A heterogeneous implementer reporting all-green tests is treated as a claim, never a gate. Only depth-0 re-derivation by `scripts/check-phase-review-receipt.js` over reviewer JSON artifacts and commit ranges unlocks the next node. Per-unit checking is the `verify` node's qualified verifier, not this loop.

---

## Review Nodes & Strength

Which review nodes run is the graph's decision (`node scripts/stage-graph.js nodes --size <size> …`); how strongly each is checked is a separate axis:

| Node | Why it exists | Strength |
|------|---------------|----------|
| `plan-review` | Front-loads a frozen rubric where a plan carries design decisions, catching conceptual flaws before code exists | The plan loop's seat panel (`plan_review` knob) |
| `verify` | Stops errors compounding across units: each unit is checked by a qualified verifier before the next starts | One qualified verifier (`engine-scorecard.js current --role verifier`) |
| `code-review` | One cross-model pass over the whole change, where blind spots of a single family show | The distinct model families `scripts/resolve-review-loop.sh --field required_review_families` resolves from risk and roster; low risk defaults to one family with a fresh-context reviewer; a shortfall goes through `on_engine_unavailable`, never silently lowered; the marker records the families actually used |
| `qc-gate` | Deterministic regression floor (tests, lint, completeness) | Project gate or `autopilot:quality-pipeline` |

Enforcement is `scripts/hetero-review-loop.js` receipts plus `scripts/check-phase-review-receipt.js` re-derivation.

---

## Context Health Check Reference

When sessions are extended or context feels degraded, measure the token budget against the 200K baseline (1 token ≈ 3.5 bytes for mixed-language codebases):
- **Fixed layer** (loaded every session): CLAUDE.md, MEMORY.md, auto-injected context.
- **Loaded this session**: Skills invoked in current conversation.
- **On-demand** (not yet loaded): Remaining skills, knowledge files.

If usage exceeds 70%, flag for attention and consider compression or file splitting.

