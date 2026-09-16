## Recommendation

Choose **(a)**: suppress `REVIEW_COMPLETED` specifically when `vertical_failed === true`.

Implement it as a predicate around the append, not by catching and ignoring reducer errors:

```js
if (scope !== 'final' && verticalFailed !== true) {
  // existing resume-digest check or REVIEW_COMPLETED append
}
```

This preserves the reducer’s intended direct path:

```text
VERTICAL_VERIFICATION
  → REPAIR_AUTHORIZED(generation + 1)
  → REPAIRING
```

That edge already exists in [implementation-campaign.js](/home/cookys/projects/autopilot/src/engine/implementation-campaign.js:1001). The advisory review remains durable in the controller Work Order: its digest, findings, verdict, and `vertical_failed`-bound input are recorded by the full-diff gate in [campaign-composition.js](/home/cookys/projects/autopilot/src/engine/campaign-composition.js:1901).

### Why not (b)

It gives a red candidate a misleading `REVIEWING → ADJUDICATING` state.

The concrete failure is false terminalization:

- Without a marker guard, `TERMINAL_READY` accepts the red candidate.
- Guarding only `TERMINAL_READY` still leaves `TERMINAL_FOLLOW_UP` open; both transitions currently accept any `ADJUDICATING` state in [implementation-campaign.js](/home/cookys/projects/autopilot/src/engine/implementation-campaign.js:1028).
- A correct implementation also needs marker initialization, replay compatibility, clearing after repair/green verification, and exact-state/schema changes.

That churn buys campaign-ledger evidence by weakening the meaning of the state machine.

### Why not (c)

As stated, it does not actually reach repair. `mutate('vertical_repair')` independently calls `requireFullDiffBeforeRepair` in [campaign-composition.js](/home/cookys/projects/autopilot/src/engine/campaign-composition.js:1239), which returns `FULL_DIFF_BARRIER_REQUIRED` when generation N has no barrier ([controller-execution.js](/home/cookys/projects/autopilot/src/engine/controller-execution.js:676)).

Removing that second guard would permit blind repair spend. It would also remove the baseline used for same-process remediation comparison, potentially discovering unrelated full-diff defects only after consuming the final repair generation.

## Reader audit under (a)

No reader requires `REVIEW_COMPLETED(N)` before `REPAIR_AUTHORIZED(N+1)`.

| Reader | Actual dependency |
|---|---|
| Reducer replay | Explicitly accepts `REPAIR_AUTHORIZED` from `VERTICAL_VERIFICATION`. |
| Inspect/status | Replays events and reports projected phase; no historical review search. |
| Resume | `VERTICAL_VERIFICATION` requires a bound Git candidate. Only `ADJUDICATING` resume requires the last artifact to be `product_review` ([campaign-intake.js](/home/cookys/projects/autopilot/src/engine/campaign-intake.js:844), [cli.js](/home/cookys/projects/autopilot/src/campaign/cli.js:879)). |
| Terminalization ladder | Uses current state, live lease, and candidate/boundary evidence—not historical review-event presence. |
| Repair authorization/scope | Uses `fullDiffBarriers`, the controller repair ticket, and supplied repair findings. |
| `findReusableGate` | Reads only `controller.gate_journal` and exact input digest ([controller-execution.js](/home/cookys/projects/autopilot/src/engine/controller-execution.js:248)). |

The red review does have consumers, just not through the campaign event:

- Its digest enters the controller repair ticket.
- Its normalized finding IDs enter `repairLineage.prior_review_finding_ids`.
- `latestReview` becomes the same-process baseline for the next generation’s remediation checker.
- Its findings/verdict/digest remain in the full-diff gate journal.

It does **not** enter the composition finding registry or the vertical-repair prompt. `syncRepairFindingState` only updates repair lineage.

One recovery caveat: failed verification gates are not reusable, while the review reuse key includes `verification_receipt_digest`. A crash after red review but before repair authorization can therefore repeat verification and review if the new red receipt has a different timestamp-derived digest.

## Precise regression coverage

### Composition test

Extend the existing R3 case in [implementation-campaign-state.test.sh](/home/cookys/projects/autopilot/hooks/tests/implementation-campaign-state.test.sh:4146).

Assert:

- Ordered trace subsequence:

```text
verify
full_diff_review
scope_before_repair
convergence
repair
```

- Exactly one generation-0 full-diff review.
- That call receives `vertical_failed: true`.
- Generation 1’s review, if reached, receives `vertical_failed: false`.
- Mutation kinds are exactly `initial`, then `vertical_repair`.
- The red generation’s controller gate entry contains the expected review digest and `success:true`.
- The repair ticket binds that review digest.

Use ordered indices rather than comparing the entire trace, since unrelated instrumentation may add entries.

### Engine/reducer integration test

Put the live adapter/journal case in [implementation-campaign-routing.test.sh](/home/cookys/projects/autopilot/hooks/tests/implementation-campaign-routing.test.sh).

Wrap `campaignEventAppender`, recording attempted calls before delegating. Assert:

1. `REVIEW_COMPLETED`, generation 0: **zero attempted appends**.
2. `REPAIR_AUTHORIZED`, generation 1: exactly one append.
3. The returned state immediately after that append has:

```js
state.generation === 1
state.phase === CAMPAIGN_STATES.REPAIRING
```

4. Campaign rows through that event replay to generation 1 / `REPAIRING`.
5. Exactly one reviewer call occurred for the red candidate—identify it by generation/tree or `campaign-review#r1`, excluding the final panel.
6. No generation-0 `vertical_verified` or `review_completed` under option (a).
7. If the repaired candidate reaches green:

```text
repair_completed(1)
vertical_verified(1)
review_completed(1)
```

with exactly one generation-1 `REVIEW_COMPLETED`.

8. Inject a journal failure for the green generation’s `REVIEW_COMPLETED` and assert the result remains blocked at `campaign_event_journal`. This proves the change is conditional and has not broadly weakened fail-closed journaling.

The “zero attempted generation-0 append” assertion is essential: merely checking that no row landed would also pass an implementation that attempted the invalid append and swallowed its error.

### Adjacent blocker the test may expose

A full live-engine test may reveal a second, independent failure: vertical repair currently supplies the generic finding:

```js
{ id: 'vertical-acceptance', claim: 'contract verification did not pass' }
```

from [campaign-composition.js](/home/cookys/projects/autopilot/src/engine/campaign-composition.js:2198), but `findingBoundRepairPaths` rejects findings without an explicit allowed path ([autopilot-engine.js](/home/cookys/projects/autopilot/src/engine/autopilot-engine.js:1514)). This rejection is already tested in [implementation-campaign-state.test.sh](/home/cookys/projects/autopilot/hooks/tests/implementation-campaign-state.test.sh:2621).

Therefore:

- For this narrow deliverable, capture the state immediately after `REPAIR_AUTHORIZED` and prove `REPAIRING`.
- If acceptance requires an actual repaired candidate, also define a path-bound vertical-repair scope—likely from the already captured initial changed paths. Do not weaken the repair-scope seal or implicitly authorize unadjudicated reviewer findings.

## Red-verification durability

Keep campaign-ledger red-verification journaling outside this minimal fix. The controller focused-verification gate already durably records the red receipt digest and its candidate/argv/environment bindings.

Do not reuse `MUTATION_FAILED`: it is lease-bound, accepted only during mutation, releases the lease, and terminalizes the campaign.

If a campaign-ledger marker is added later, the smallest form is:

```text
vertical_verified {
  passed: false,
  evidence_digest: <red receipt digest>
}
```

accepted as a self-loop in `VERTICAL_VERIFICATION`. It should not enter `REVIEWING` or add a persistent `verification_failed` state marker. Persisting the receipt body or stdout/stderr remains the separate evidence-durability work item.

The Architect, QA, and Ops perspectives reached high consensus on (a); their only meaningful divergence was whether a future red marker should reuse the existing event as a self-loop or use a newly named non-transitioning event.
