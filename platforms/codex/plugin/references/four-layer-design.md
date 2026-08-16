# Four-layer design — harness governance record

The post-owner-kernel governance architecture, bound by the dual-agent survey
(`docs/plans/2026-08-16-four-layer-redesign-survey.md`) and shipped by
`docs/plans/2026-08-16-four-layer-redesign.md`. Contract-card style: every rule row names its
enforcing mechanism or carries an explicit `documented-only` tag — a rule without a named
enforcer is prose, and prose is not governance (the owner-kernel lesson,
`references/evidence-discipline.md` §8).

## Layer map

| Layer | Owns | Lives in |
|---|---|---|
| **Kernel** | evidence discipline: what "done" must prove, and the checks no narrative can steer | `references/evidence-contract.md`, blind-evidence gate, exec-boundary hook, holdout gate |
| **Plumbing** | dispatch/worktree/endpoint/qualification mechanics | existing rails (`dispatch-*`, `run-ledger.sh`, worktree lifecycle, readiness) — unchanged |
| **Policy** | how much scaffolding a dispatched engine gets, and when verification escalates | `references/scaffold-tiers.md` + `resolve-scaffold-tier.js`; cascade fields in `resolve-review-loop.sh` |
| **Graph** | typed stage contracts + fan-out for INDEPENDENT work only | dispatch-unit contracts, qc-panel fan-out — no orchestration framework, no parallel implementer |

## Rules

| # | Rule | Enforcer | Survey basis |
|---|---|---|---|
| K1 | A review payload carries obligations, diff, and receipts — never the implementer's narrative about them | `scripts/check-blind-evidence.sh`, wired in `dispatch-review.sh` transport assembly | framing bias: 97.2%→3.6% detection under "secure" narrative |
| K2 | Destructive commands are denied at the execution boundary by non-LLM code | `hooks/exec-boundary.js` (opt-in, PreToolUse Bash); protected-ref force-push deliberately covered by BOTH exec-boundary and the default-on `hooks/branch-protection.js` (defense-in-depth) | Replit lesson: "the freeze lived only in the instructions" |
| K3 | High-risk diffs require holdout verification the implementer could not see at authoring time | `scripts/check-holdout-coverage.sh` in the quality-pipeline gate list; instruments: `probe-mutation.js`, `verify-strength.js` | SpecBench: visible-gate gaming grows ~27pp per 10x LOC |
| K4 | Evidence binds to artifacts (commit/diff/receipt), or it is treated as false | `references/evidence-contract.md` clause; `lifecycle-residue-receipt.js` pattern | inaccurate self-reporting = 22.6% of misalignment episodes |
| P1 | Scaffold weight = f(engine qualification tier), fail-closed to T2 | `scripts/resolve-scaffold-tier.js` + prepend in `dispatch-hetero.sh` (definitions: [`scaffold-tiers.md`](scaffold-tiers.md)) | capability-indexed scaffolding — Terminal-Bench 2.0, SWE-bench lineage |
| P2 | Verification is a cascade: one reviewer by default; risk/security triggers already escalate via `review_risk=high` (`required_review_families=2` + `cross_family_required`); prior-round `no_verdict\|ambiguous` now elevates risk the same way | `resolve-review-loop.sh --prior-status` (producer: engine review-args assembly on round N+1) | diminishing returns past ~4-5 models; cascade beats always-on |
| P3 | Verification is single-round: one verdict per seat per generation; depth-0 adjudicates; never rebuttal rounds | canonical clause in [`evidence-contract.md`](evidence-contract.md); `documented-only` for legacy paths | debate AMPLIFIES wrong consensus (+30%, worsens per round) |
| G1 | Implementer stays single-threaded; fan-out only for independent work (review seats, research) | `documented-only` (structural: no parallel-implementer rail exists) | coding is deep-and-narrow (Cognition); no topology benchmark exists |
| G2 | No orchestration framework dependencies | `documented-only` (dependency policy §2.6 of the plan) | framework churn incidents; <50ms orchestration vs 2-15s inference |

## Execution-boundary map

| Executor | Boundary |
|---|---|
| Claude Code session (this repo) | `exec-boundary.js` (opt-in deny gate) + `branch-protection.js` (force-push/protected commits) |
| Hetero dispatched engines (L5/L6) | worktree containment + contained-branch-only deletion (`reap-dispatch-branches.sh`) + qc-gate pre-push (`.githooks/pre-push`) |
| Anything touching protected paths | `QC-Verdict` trailer requirement (qc-gate, mode=block) |

## Anti-cathedral constraints (standing)

- Every mechanism ships with a red-case test and a same-phase caller; a zero-caller module is
  dead on arrival (`references/evidence-discipline.md` §1).
- No trust machinery: no hash chains, ledgers, witnesses, attestation, trust roots (§8).
- Tamper-evidence of a claim is not verification of the claim; only independent re-derivation
  (re-run, re-scan, decorrelated review) verifies.
