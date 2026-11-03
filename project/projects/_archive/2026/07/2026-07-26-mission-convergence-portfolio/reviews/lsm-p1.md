# LSM Phase 1 - Task Status Aggregation

> Implementation trail: `e79d0da` through `70b50f9`
>
> Status: READY

## Frozen Boundary

P1 adds a pure task-status receipt builder over canonical Mission, ICC, WLB,
and Git evidence. Mission state and its terminal receipt establish root and
repository authority. Every ICC campaign is replayed from its sealed contract
and event ledger, bound to one live Mission claim, and checked for exact sibling
coverage. WLB remains the sole lifecycle residue authority.

Integration facts are tri-state. Candidate-to-target proves product merge,
target-to-consumer proves the required consumer update, and target-to-remote
proves the complete local integration result was pushed. Missing or malformed
authority remains `unknown`; it is never collapsed into a factual `false`.
Phase 1 cannot produce `can_merge=true` because the sealed merge preflight and
edge receipts belong to LSM P2.

## Deterministic Evidence

- `status-task.test.sh`: PASS, 75 named semantic cases and 5 shell gates.
- `mission-enforce-failclosed.test.sh`: PASS, 8 assertions.
- `mission-enforce-roundtrip.test.sh`: PASS, 16 assertions.
- `mission-convergence-integration.test.sh`: PASS, 25 assertions.
- `mission-icc-runtime.test.sh`: PASS, 81 assertions.
- `implementation-campaign-state.test.sh`: PASS, 185 assertions.
- `implementation-campaign-receipt.test.sh`: PASS, 11 assertions.
- `implementation-campaign-routing.test.sh`: PASS, 29 assertions.
- `implementation-campaign.test.sh`: PASS, 73 assertions.
- `lifecycle-residue-receipt.test.sh`: PASS, 63 assertions.
- `check-canonical-invariants.sh`: PASS.
- `validate.sh`: PASS, 28/28 skills.
- `sync-version.js --check`: PASS.
- `git diff --check`: PASS.

The oracle uses real Mission reducers and terminal receipts, real ICC contracts,
event replay, verification and terminal receipts, canonical WLB inspector
results, and repository-bound Git adapters. It covers receipt substitution,
ledger truncation, campaign omission, foreign acceptance IDs, noncanonical
findings, contradictory lifecycle evidence, target/consumer/remote ancestry,
and unknown adapter results.

## Review Trail

| Seat | Result | Disposition |
|---|---|---|
| GLM 5.2 | `SHIP-AS-IS` | Final blind review of the aggregate diff; no findings. |
| Qwen 3.8 Max | `SHIP-AS-IS` | Initial response was parser-invalid and excluded; the bounded retry returned a valid clean verdict. |
| gpt-5.6-sol | `FIX-THEN-SHIP` generations | Valid authority and binding findings were repaired. The final stop-receipt claim was refuted because ICC has no canonical stop terminal receipt producer; fabricating one would violate the frozen real-artifact boundary. |
| Owner contract review | `SHIP-AS-IS` | Found target push was incorrectly candidate-based; repaired to target-to-remote and revalidated. |
| Grok 4.5 High | `no_verdict` | Parser-invalid output; excluded from the panel. |

| Severity | Finding | Repair |
|---|---|---|
| 🟠 Major | Campaign state and receipts could be paired without replaying the sealed event ledger. | Replay the canonical contract/events and require exact state and terminal output bindings. |
| 🟠 Major | Verification and writer-fence receipts were not fully bound to the replayed terminal campaign. | Bind the last vertical verification event, writer fence, tree, timestamps, generation, and terminal receipt. |
| 🟠 Major | Unmapped or partial campaign evidence could influence blockers, deferred counts, or candidate identity. | Require exact Mission claim coverage before aggregating any campaign result. |
| 🟠 Major | Must-fix findings could reference acceptance outside the matched Mission claim. | Require canonical dispositions and bind every unresolved finding to a claim acceptance ID. |
| 🟠 Major | Push status checked candidate-to-remote, allowing an unpushed integration commit to appear pushed. | Check target-to-remote and cover false and unknown ancestry results. |
| 🟠 Major | Follow-up ledger digest omitted unresolved must-fix findings. | Validate the exact canonical `{follow_up, unresolved_final_findings}` object emitted by ICC. |

## Owner Decisions

- The canonical Mission reducer currently transitions an abort request to
  `ABORTING`; it does not construct a terminal `ABORTED` artifact. No fabricated
  fixture was added. LSM accepts a canonical terminal `ABORTED` state when the
  upstream producer eventually supplies one.
- ICC exposes a `TERMINAL_STOP` state transition but no canonical stop terminal
  receipt builder. A stop event paired with a noncanonical ready/follow-up receipt
  remains `unknown`; task status must not invent authority the upstream contract
  does not emit.
- Generated Codex plugin mirrors remain deferred to portfolio Phase 33.
- Parser-invalid and transport-empty reviewer runs are recorded but never
  counted as approval.

## Final Decision

`READY`. Task status is derived from replayed, repository-bound authority;
unknown evidence fails closed; every admitted campaign is coverage-bound; and
the final GLM, Qwen, and owner reviews admit no remaining in-scope finding.
LSM P2 may begin.
