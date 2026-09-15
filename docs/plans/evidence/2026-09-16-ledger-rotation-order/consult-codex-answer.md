Recommendation: choose (c), but make the reader recovery provenance-gated and stricter than the proposed “same input = fork” algorithm.

| Option alone | Concrete failure left behind |
|---|---|
| (a) writer only | Every campaign whose original segment is already gone remains unreadable. Future rotations preserve the first surviving—but already scrambled—carry order, so the ledger does not self-heal. |
| (b) reader only | The writer continues destroying append order on every append. Other readers still see corrupt ordering, and the proposed fork rule rejects legitimate `RESUMED` histories. |
| (c) both | Restores the storage invariant and provides compatibility recovery for existing carry-only segments. |

### Reader recovery semantics

Do not unconditionally reorder all events. That would weaken the current fail-closed behavior: a manually appended, non-carry event that was physically written out of order but happens to form a valid chain would become accepted.

Instead:

1. Keep producer-authored event rows fixed in physical order.
2. Allow reordering only for rows carrying valid `_rotation_carry` provenance.
3. In a mixed history, treat original events as fixed anchors and reorder only the carried block before/between them.
4. Require exactly one complete reducer-valid replay:
   - zero complete replays: gap/corruption;
   - more than one: ambiguous fork;
   - exactly one: use it.
5. Replay wrappers—not merely `payload.event`—in recovered order so `candidate_reference`, `last_artifact_reference`, and `lifecycle_receipt_ref` follow the same order.
6. Continue running every event through `reduceCampaignState`; chain walking must not replace generation, timestamp, transition, usage, lease, or idempotency validation.

The starting digest is:

```js
intakePayload.initial_state.last_output_artifact_digest
```

which initial-state validation requires to equal `contract_digest`. It is not `initial_state_digest`; starting there would create an immediate false gap. See [implementation-campaign.js](/home/cookys/projects/autopilot/src/engine/implementation-campaign.js:616).

“Two events share an input digest” is not, by itself, a fork. `RESUMED` is a legitimate self-edge `D → D`; the following event may also start at `D`. The current live ledger contains two such `RESUMED` cases, both paired with `terminal_stop`, so the proposed simple fork rule would reject two real histories.

Define a fork as multiple distinct complete valid replays. Before ordering:

- Collapse exact idempotent duplicates by idempotency key plus canonical event digest, retaining wrapper-consistency checks.
- Reject the same idempotency key bound to different event digests.
- Permit self-edges when only one complete reducer-valid traversal exists.

Repair-generation ordering remains fail-closed because the recovered sequence still passes the reducer’s generation and transition checks at [implementation-campaign.js](/home/cookys/projects/autopilot/src/engine/implementation-campaign.js:833).

The intake and other journals should not be inserted into the walked event chain:

- `campaign_intake` establishes initial state conceptually before all events and is validated separately.
- Stage rows remain in physical order for lease-history validation.
- Non-event journals remain in physical order but are ignored by `reduceCampaignState`.
- A stray `op != campaign_event` row between two events currently has no reducer effect; recovery should preserve that behavior.

### Keep-first is correct

For journal carry dedupe, keep the first occurrence in the oldest-to-live snapshot.

The first occurrence is either:

- the producer-authored original, at its authentic append position; or
- the oldest retained carry when the original has been GC’d.

A later carry is only another materialization of the same immutable logical row. Keeping it last relocates that row after later appends and can itself change chronology.

There is no valid journal case requiring keep-last. If two rows claim the same `_rotation_root` but differ after removing carry metadata, treat that as corruption. “Latest wins” remains appropriate only for the separately handled stage-row selection.

### Red-first test

Replace the one-rotation draft with two subcases in one bash test.

#### 1. Writer invariant across carry generations

Build an intake plus three real events through `openCampaignLedger` and `appendCampaignEvent`, with rotation initially disabled.

Make the fixture deterministic:

- Put a fake `date` earlier in `PATH` that returns one fixed value for the exact `iso_ts` invocation and delegates every other invocation to the real `date`.
- Give all three events the same `observedAt` as well.
- Supply fixed idempotency keys.
- Assert as a fixture precondition that sorting their computed rotation roots lexically produces an order different from append order.

Then set:

```text
RUN_LEDGER_MAX_BYTES=1
RUN_LEDGER_MAX_ROTATIONS=1
```

Trigger two rotations with two real `stage-heartbeat` appends.

After the second rotation, assert:

- No original target journal survives anywhere in the snapshot; every intake/event copy is `_rotation_carry:true`.
- `${ledger}.1` contains the first-generation carry events in original append order.
- The live ledger contains the second-generation carry events in original append order.
- Each logical root occurs exactly once per segment—no loss or multiplication.
- First-occurrence dedupe over the oldest-to-live snapshot yields the original append order.
- All three journal `ts` values are identical.
- All three event timestamps are identical.
- `projectCampaign` returns:
  - the exact expected phase;
  - `event_count === 3`;
  - the expected final output digest;
  - idempotency records in append order.

Checking both `.1` and live is what catches a patch that handles originals correctly on the first rotation but sorts already-carried rows on the second. Equal timestamps make any `ts`-sorting repair ineffective.

#### 2. Existing-corruption compatibility

A corrected writer can no longer naturally generate a legacy-broken segment, so construct one from rows produced by the shipped writers:

- Strip originals.
- Add the exact carry metadata.
- Sort journals using the old `group_by(_rotation_root) | map(.[-1])` behavior.
- Assert its raw event order differs from append order and all timestamps collide.
- Assert `projectCampaign(legacyRows, campaignId)` equals the pre-corruption projection in phase, event count, final digest, idempotency records, and artifact references.

Also assert these negative cases:

- Removing a middle event rejects as a gap.
- Two distinct complete valid continuations reject as ambiguous.
- An out-of-order event without `_rotation_carry:true` remains rejected.
- A valid `RESUMED D → D` followed by `D → E` is recovered rather than misclassified as a fork.
- Inserting a non-event journal between events does not change projected campaign state.

Without this second subcase, a writer-only implementation would satisfy the test and the reader recovery in option (c) would remain untested.

### Existing ledger

Reader recovery is not a migration: it repairs projection at read time but leaves the JSONL bytes scrambled.

With option (c), an immediate one-off rewrite is unnecessary and should not happen automatically during reads. Preserve the existing segments as audit evidence. A later explicit migration is reasonable if the goal is to remove the compatibility reader eventually; it should run under the ledger lock, back up every segment, require a unique valid replay, atomically rewrite, and prove the projected state/digests are identical before and after.

If only option (a) were used, a one-off migration would be mandatory to restore today’s carry-only campaigns.
