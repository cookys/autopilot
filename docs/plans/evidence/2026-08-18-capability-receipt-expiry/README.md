# Capability-receipt expiry outage — measurement, root cause, policy change (2026-08-18)

Found while repairing a red test suite; the red tests were a symptom, not the problem.

## What was broken

At **`2026-08-17T22:23:16.577Z`** the capability receipt
(`docs/projects/_archive/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json`)
passed its 14-day TTL. That expiry is a hard precondition on three production paths:

| Path | Effect |
|---|---|
| `scripts/dispatch-hetero.sh` (`validate_d2_agy_claims`) | every agy implementer dispatch → `precondition_failed`, exit 2, runner never spawned |
| `scripts/dispatch-review.sh` | every agy reviewer dispatch → same |
| `platforms/codex/hooks/post-compact.js` | every Codex PostCompact → `d3_claim_validation_failed`, blocked |

Twelve test files failed as a side effect (`bash hooks/tests/run.sh --parallel 8`). Re-run
serially, one of the twelve (`dispatch-author-codex-transport`) was not failing at all — it
exits 0 in 318 s and merely outran the timeout wrapper used to probe it. Real count: **11 red,
8 of them from this single cause.**

## Why re-certification could not fix it

`scripts/probe-harness-capabilities.sh:126` hardcodes
`const codexHostObservedAt = '2026-08-03T22:23:16.577Z'` with `ttl = 14 days` (line 123). A live
Codex compaction cannot be provoked from a script, so the driver **replays** that fixed timestamp
for the four D3 `codex-postcompact-*` claims on every run. Measured directly, twice: 13 of 17
claims received a fresh `observed_at` (`2026-08-18T07:37:04Z`); the four D3 claims did not.

`generate` refuses to write the receipt if any required claim is blocked, so the four permanently
stale D3 claims made the **whole receipt unissuable** — including the parts that would have fixed
D2. The rail was scheduled to die on a date from which it could not recover, and nothing could
clear it.

A second receipt (`docs/plans/evidence/2026-08-14-strict-l5-policy-refresh/…`, consumed by
`src/readiness/provider-bootstrap.js`) replays the same expired claims and carries its own fuse
for `2026-08-28`.

## Second finding: identity drift is vendor-scheduled too

`agy` moved **1.1.10 → 1.1.12 → 1.1.14 within this one session**. The receipt generated at 07:37
was already version-drifted before it could be installed. Sustaining a hard version pin means a
human re-pinning eight content-addressed hashes across six files every time a vendor's
auto-updater runs.

The same effect reaches `binary_unavailable`: `codex`, `grok` and `claude` install to
**version-embedded paths** (`releases/<ver>/bin/codex`, `downloads/grok-<ver>-linux-x86_64`,
`versions/<ver>`), so an update deletes the recorded realpath and the old check reported the tool
as *missing* when it was merely *newer*.

## Policy change (owner decision, 2026-08-18)

> autopilot exists to assist the user, not to obstruct them. Expiry warns, never blocks; if
> something must block, explain it and ask for authorization. Authority downgrade belongs to
> accumulated no-confidence (observed failures), not to the calendar.

Implemented in `scripts/platform-capability-claims.js`:

| Signal | Before | After |
|---|---|---|
| `stale_live_evidence` (recorded observation aged out) | fatal | **advisory**, printed loudly |
| `current_version_drift:<v>` | fatal | **advisory**, observed version named |
| recorded realpath gone, tool resolvable by name | fatal (`binary_unavailable`) | **advisory**, re-probes the moved binary |
| `target_live_version_mismatch` (receipt self-inconsistent) | fatal | **fatal** |
| `contract_live_contradiction` (observed behavior contradicts the claim) | fatal | **fatal** |
| tool not resolvable at all | fatal | **fatal** |
| receipt digest / claim-ID tampering, blocked required claim | fatal | **fatal** |

`platforms/codex/hooks/post-compact.js` now forwards the validator's advisories to stderr — it
was swallowing them, so a warning would have reached nobody.

Rationale, in the repo's own terms: what makes a claim true *now* is re-derived live on every
call (`--version` is spawned each time) and the contract not being contradicted. Wall-clock age
of a record is tamper-evidence about that record, which
[ADR-0001](../../../adr/0001-verification-over-attestation.md) explicitly does not count as
verification.

## Verification

- All six consumer × receipt combinations validate: D2/D3/D4 on both receipts.
- Negative controls still block, checked after the change: absent binary (`version_probe_error`),
  wrong claim id, receipt tamper cases, `version-mismatch` and `contradiction` generation inputs.
- 15/15 affected test files green, including the six that were red from this cause.
- Three test assertions encoded the old policy and were **rewritten to assert the new one, not
  deleted** — each still requires the condition to be detected and surfaced:
  `mission-runtime-v2` (`…-version-drift-warns-not-blocks`), `harness-capabilities`
  (drift warns + a genuinely absent binary still fails closed; stale generation accepted with an
  advisory).

## Not done

- The freshly probed receipt (agy 1.1.12, codex 0.147.0, …) was **not installed**: with drift
  advisory it buys nothing, and installing it would have forced eight hash re-pins that the next
  auto-update invalidates. The recorded observation stands as what it is — a record.
- Replacing calendar-based authority decay with accumulated no-confidence, and the receipt's
  identity being coupled to its observation timestamp, are BACKLOG rows.
