# Strike decay — how a qualification is actually withdrawn

> Companion to [`model-routing.md`](model-routing.md) § Static Defaults vs Capability Evidence.
> That section says what may *grant* authority. This one says what may *take it away*.

**The rule, in one line: a seat loses authority by accumulating mechanical strikes during real
work, and by nothing else.**

Owner ruling 2026-08-18: *"同一個模型不需要日期授權;降級授權應該用不信任投票累積而不是時間。"*
A model does not get worse because the calendar turned over. Design frozen 2026-08-22 by a
seven-seat heterogeneous panel (all seven verdicts `sound-with-changes`; no seat proposed keeping
any calendar tooth). Plan: [`../docs/plans/_archive/2026/08/2026-08-22-no-confidence-decay.md`](../docs/plans/_archive/2026/08/2026-08-22-no-confidence-decay.md).

## A qualification has no expiry

A qualification has no date on it: no `expires`, no `expires_at`, no `--expires-days`, no
`expired` status, no warning that a date passed. Owner ruling 2026-10-14, repeated 2026-10-26:
*"資格考沒有期限,考過就算;不要有期限,喪失資格是用犯錯扣分來計算,掉到一定程度就喪失資格需要重考。"*

The only way a seat stops being admitted is strikes (below): N ordinary strikes since the last
passing administration, or one critical trigger, makes it `requalify_required`, and a later
passing fresh administration restores it. Nothing else reads a clock.

`hooks/tests/calendar-teeth-negative.test.sh` pins this: scorecard rows, the shipped official
defaults, the evidence schema and the adopt / scorecard output carry no expiry field, and no
admission or sampling path compares `now` against a qualification date. Its guarantee is exactly as
wide as its scan set; when you add a consumer that reads a scorecard row, add it to the scan set in
the same commit.

Stores written before 2026-10-26 still carry the field. They are migrated once with
`node scripts/engine-scorecard.js strip-expiry` (`--dry-run` first; every store is backed up as
`<file>.bak-strip-expiry-<UTC>`). Evidence ids are content hashes and `expires_at` was inside them,
so the migration re-seals the evidence and rewrites everything that points at it.

## What a strike is

A strike is an **append-only mechanical no-confidence event** against one seat, stored in
`<capability store>/strikes.jsonl`. `scripts/engine-capability-state.js` owns the writes;
`scripts/engine-scorecard.js` owns the projection that reads them.

**ADR-0001 is binding here.** A strike requires host-rederived mechanical evidence: a rerun that
comes back red, a gate that exits nonzero, a contract predicate that evaluates false. An LLM
reviewer's REJECT prose may reject the *deliverable*; it may never cast a strike. Otherwise this
rebuilds attestation — a record of who said what, with no re-derivation behind it.

### The seat is the pair

Accrual is **pair-scoped**: `seat_hash = sha256(canonicalJson({engine, runner, role}))`.

Transport exclusion is deliberately dead (4/4 board seats). The engine+runner pair is the routed
seat and delivery is part of its contract — an engine whose runner corrupts its output envelope
did not deliver. `cause_class ∈ {engine_output, runner_delivery, ambiguous}` rides along as
**diagnostic metadata only**; it never suppresses accrual. At threshold it steers the remedy:
`runner_delivery`-dominant ⇒ runner-repair incident, `engine_output`/`ambiguous`-dominant ⇒
engine re-exam. Because counters are pair-scoped, re-pairing an engine with a different runner
starts clean, which is what kills phantom blame.

The **only** exclusion is a closed, host-derived enum of provably-external causes:

```
quota | user_abort | infra_outage | pre_dispatch_host_abort
```

A runner is never trusted to label its own failure "transport".

### Two classes, no weights

| Class | Effect | Admission |
|-------|--------|-----------|
| `ordinary_strike` | counts toward the threshold | any allowlisted writer, deduplicated one per root incident |
| `critical_reexam_trigger` | immediate `requalify_required` | ONLY via a predeclared registry of deterministic, mechanically replayable predicates |

The critical registry is closed and lives in code (`CRITICAL_REEXAM_PREDICATES`):
`security_canary_disclosure`, `protected_test_tampering`, `evidence_hash_manipulation`.
Heuristic "integrity-ish" findings are ordinary strikes, not critical triggers. Charter member of
the registry is the grok-4.6-class canary disclosure (2026-08).

There are no severity weights, no sliding window, and no success-aging — all three were cut by the
panel. A work-volume window is not computable from a strike-only ledger, and aging by success lets
easy tasks wash out hard-task failures.

## The fold

**N ordinary strikes since the last passing administration ⇒ `requalify_required`.** N = 3.

Generalized from the brain-seat fold shipped in v2.34.14 (`brainSeatStatus`), which keeps running
unchanged over the legacy `schema_version: 1` rows.

1. Baseline = the newest scorecard row for the seat that derives `qualified`. No baseline ⇒
   `no_record`.
2. A strike counts only if its `observed_at` is **strictly greater** than the baseline's
   `qualified_at`. A strike stamped at exactly the pass instant is pre-pass by construction — the
   administration that issued the pass was still concluding.
3. Read-time validation: allowlisted `writer`, non-empty `receipt_ref`, well-formed
   `artifact_sha256`, registered `predicate_id` for critical rows. Anything failing is excluded
   and tallied in `rejected_strikes`. Append-only does not authenticate by itself, so the
   projection re-checks at every read — an un-allowlisted writer can never inflate the count.
4. Valid `strike_invalidated` rows subtract. Then `(seat_hash, dedup_key)` duplicates collapse to
   one, so a single root incident cannot be counted twice by a retrying detector.

**Epoch semantics, not counter wiping.** A passing fresh administration re-baselines, which
logically clears prior strikes without mutating one line on disk. History stays immutable.

A failed re-exam appends and the seat stays blocked. **rerun-until-green is forbidden** — the seat
is unblocked by a later fresh administration that passes, not by retrying the failed one.

### Adopted official defaults are ordinary strike targets

A row copied in from the shipped official defaults
([`qualification-defaults.md`](qualification-defaults.md)) is **not privileged here**. Its
`seat_hash` comes from the same `{engine, runner, role}` derivation, its strikes accrue through the
same allowlisted writers, and the same N=3 fold applies. Nothing in `provenance` is read by the
projection's admission logic.

The one adopted-specific addition is advisory: when a `requalify_required` seat's baseline row
carries `provenance.kind === "official-default"`, `seat-status` and `current` add a `remedy` string.
It exists because the epoch rule above lands differently on an imported baseline — **re-adopting the
same default cannot re-baseline it**, since it is the same administration, not a new one. Only a
passing *fresh local* administration does. `remedy` gates nothing.

### Corrections

The only correction is an append-only `strike_invalidated` event, admissible **only** with
mechanical proof of a detector defect (`proof_artifact_sha256` + `proof_detector_id`). There is no
human free-form rescind.

## Arming (enforced by default)

| Class | Status today |
|-------|-------------|
| `critical_reexam_trigger` | **ENFORCING immediately.** Deterministic, high-specificity predicates do not need calibration. |
| `ordinary_strike` | **ENFORCING by default** (owner, 2026-10-26). The 3rd ordinary strike since the last pass makes the seat `requalify_required`; 2 strikes do not. |

The one knob is the environment variable **`AUTOPILOT_STRIKE_ENFORCEMENT`**, read at projection time
in `scripts/engine-scorecard.js`. Unset (or any value other than `shadow`) enforces. `shadow` is the
explicit opt-out: strikes are only recorded and `would_requalify` is projected, nothing gates. Use it
to debug a detector, not as a standing setting.

The threshold itself needs a dated review, because *a threshold nobody revisits is a
calendar tooth in a trench coat*.

## Writers

Only allowlisted mechanical fail-closed paths may append (`STRIKE_WRITER_ALLOWLIST`):

| Writer id | Path |
|-----------|------|
| `fuse` | `scripts/check-stall-fuse.js` (legacy v1, brain seat) |
| `conformance_audit` | `scripts/check-blueprint-conformance.js` (legacy v1, brain seat) |
| `dispatch_hetero_failclosed` | `scripts/dispatch-hetero.sh` `classify_outcome` — the real production writer for seat strikes |
| `qualification_admin` | a qualification administration recording its own mechanical outcome |

Adding a writer means adding it to that allowlist **and** giving it a delete-the-wiring negative
test. A strike writer that exists but never fires is the exact failure
[`evidence-discipline.md`](evidence-discipline.md) §1 is about: a module with no caller is
indistinguishable from a module never written, and its own unit tests pass in both cases.

## Reading the state

```bash
# projection for one seat — an OPERATOR-FACING CLI. Nothing in the product calls it;
# the consumers read the projection off `current` rows instead (see below). Do not
# read its existence as evidence the fold is wired — the wiring is `currentRowsForRole`.
node scripts/engine-scorecard.js seat-status --engine <model> --runner <runner> --role <role>

# every current row for a role, each carrying admission_status
node scripts/engine-scorecard.js current --role implementer
```

`admission_status ∈ {qualified, no_record, requalify_required}` is the **only** admission
authority. Consumers that read `status` alone still work; `status` is only `qualified` or `failed`.

## Deliberately not built

Recorded as BACKLOG rows rather than shipped on zero data: re-exam scheduling automation;
rate-based windows (needs a dispatch ledger that does not exist); liveness-probe stale tax;
detector-anomaly quarantine automation (emission-rate deviation auto-demoting a detector's strikes
to shadow); fleet circuit breaker (N seats tripping in a short span freezes enforcement — a gate
bug is not an engine bug); per-role threshold tuning.

And, per [ADR-0001](../docs/adr/0001-verification-over-attestation.md): no hash chains, no witness
receipts, no trust roots. `receipt_ref` and `artifact_sha256` exist so a strike can be **replayed**
— re-derived by re-running the detector over the same artifact — not so it can be proven
un-tampered.
