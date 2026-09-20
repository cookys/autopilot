# Plan — accumulated no-confidence replaces calendar-based qualification decay

> **Status**: authoring (depth-1 foreman, run `nocon-decay-l4`)
> **Owner**: autopilot Board (depth-0 holds merge authority)
> **Branch**: `worktree-agent-ab979a1176060ca5e` (worktree-isolated; never merged by depth-1)
> **Frame**: dev-flow **L**, scope=Hold, M-size first cut

## 0. Context / thesis

Owner ruling 2026-08-18: *"同一個模型不需要日期授權;降級授權應該用不信任投票累積而不是時間。"*
A model does not get worse because the calendar turned over. What should downgrade a seat is
**observed mechanical failure accumulating during real work**.

v2.34.20 made several TTLs advisory. The constructive half — a counter that actually drives
downgrade — is unbuilt, and three calendar teeth still bite. This plan ships the first cut per
the FROZEN seven-seat hetero design synthesis
(`/tmp/autopilot-dispatch-runs/nocon-design/synthesis-final.md`, 2026-08-22; all seven verdicts
`sound-with-changes`, no seat proposed keeping any calendar tooth).

Key inversion the panel produced, and this plan honours:
- **Transport exclusion is dead.** The engine+runner **pair** is the routed seat; delivery is
  part of its contract. Only a closed host-derived enum of provably-external causes is excluded.
- **Sliding work-volume windows are dead.** Not computable from a strike-only ledger, and
  success-aging lets easy tasks wash out hard-task failures. Reuse the existing fold instead:
  *N ordinary strikes since the last passing administration → `requalify_required`*.

## 1. Problem

`engine-scorecard.js` rows carry `expires`. A projection flips `qualified → expired` on a date,
and three consumers then downgrade or refuse the seat. A rail can therefore die on a date, from
a condition nobody can clear (evidence: `docs/plans/evidence/2026-08-18-capability-receipt-expiry/`).
Meanwhile a seat that is genuinely regressing (grok-4.6 canary, 2026-08) keeps routing at full
authority until its unrelated calendar date arrives.

## 2. OKR / KRs

**O**: qualification authority is decided by mechanical evidence, never by the calendar.

| KR | Measurable | Verified by |
|----|-----------|-------------|
| KR1 | Zero admission paths compare `now` vs `expires` | grep-able negative contract test |
| KR2 | A past-`expires` qualified row still routes, carrying `expiry_warning` | planted negative per pulled tooth |
| KR3 | N ordinary strikes since last passing administration ⇒ projection reports `requalify_required` | fold unit test |
| KR4 | A `critical_reexam_trigger` predicate flips the seat immediately (ENFORCING) | registry test + grok-4.6 canary replay fixture |
| KR5 | At least one REAL production writer appends strikes on the existing mechanical fail-closed path | end-to-end wiring test (delete the wiring ⇒ test fails) |
| KR6 | Ordinary-strike enforcement ships in SHADOW (`would_requalify` projected, not gated) | shadow projection test |

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only. No new runtime dependency.
- ADR-0001 binding: a strike REQUIRES host-rederived mechanical evidence (rerun red, gate exit
  nonzero, contract predicate false). An LLM reviewer's REJECT prose may reject the deliverable
  but NEVER casts a strike. No hash chains, no attestation, no trust roots.
- The on-disk stores are append-only. Never rewrite or delete a prior line. Corrections are new
  `strike_invalidated` events, admissible ONLY with mechanical proof of detector defect.
- Calendar dates NEVER block routing anywhere. `expires` is advisory-only, surfaced as
  `expiry_warning`.
- NO severity weights. NO sliding window. NO success-aging. NO counter wiping (epochs instead).
- Strike counters are **pair-scoped** (engine+runner+role), bound to the canonical
  `identity_hash` and the administration id — never a loose tuple string.
- `cause_class ∈ {engine_output, runner_delivery, ambiguous}` is DIAGNOSTIC metadata only; it
  never suppresses accrual. Exclusion is allowed ONLY via the closed host-derived external enum:
  `quota | user_abort | infra_outage | pre_dispatch_host_abort`.
- Ordinary-strike threshold ships in SHADOW. The `critical_reexam_trigger` registry ENFORCES
  immediately.
- Tests isolate every store they touch by env var AND assert where the row landed
  (`references/evidence-discipline.md` §9).

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`. Existing scorecard rows are untouched and
  remain readable; the `expired` status string stops being *produced* by the projection, and
  consumers gain `admission_status` + `expiry_warning`. Affected consumers:
  `engine-scorecard.js`, `resolve-review-loop.sh`, `dispatch-contract.js` — all migrated in this
  same cut (the synthesis is explicit that a partial cut leaves the calendar biting while the
  fold only shadows).
- **Dependency decision**: `none` — Node built-ins plus the existing `scripts/lib/jsonl-store.js`
  primitives already used by `engine-capability-state.js` and `engine-scorecard.js`.

## 2.7 FROZEN CONTRACT (schema + projection — copied verbatim into every dispatch)

### 2.7.1 Seat identity (pair-scoped accrual)

`normalizeIdentity` in `src/engine/capability-evidence.js` demands twelve fields including
fingerprints a live dispatch does not hold. Strikes therefore bind to a **seat identity**, the
pair+role the synthesis names:

```js
// canonical seat identity — the routed seat
seat_identity = { engine: <token>, runner: <token>, role: <token> }
seat_hash     = sha256(canonicalJson(seat_identity))   // same canonicalJson/sha256 helpers
```
Tokens are trimmed, non-empty, `[A-Za-z0-9._@:-]+`. `effort` / `model_version` / `endpoint` may
ride as metadata but are NOT in the hash (synthesis cut list: "effort in the key → metadata only").

### 2.7.2 `strikes.jsonl` row, schema_version 2

Legacy `schema_version: 1` rows stay valid and readable; they feed `brainSeatStatus` ONLY and are
never rewritten. `event_id` remains monotonic across all rows in the file.

```json
{
  "schema_version": 2,
  "event_id": 7,
  "kind": "strike" | "strike_invalidated",
  "seat_hash": "<64 hex>",
  "engine": "<token>", "runner": "<token>", "role": "<token>",
  "class": "ordinary_strike" | "critical_reexam_trigger",
  "predicate_id": "<registry id>" | null,
  "cause_class": "engine_output" | "runner_delivery" | "ambiguous",
  "writer": "<allowlisted writer id>",
  "dedup_key": "<non-empty: root-incident id + detector id>",
  "detector_id": "<token>", "detector_version": "<token>",
  "artifact_sha256": "<64 hex>",
  "receipt_ref": "<non-empty string>",
  "observed_at": "<ISO-8601>",
  "invalidates_event_id": <int> | null,
  "proof_artifact_sha256": "<64 hex>" | null,
  "proof_detector_id": "<token>" | null
}
```
Field rules (all enforced at write AND re-validated at read):
- `predicate_id` non-null **iff** `class === 'critical_reexam_trigger'`, and must be in the registry.
- `invalidates_event_id`, `proof_artifact_sha256`, `proof_detector_id` non-null **iff**
  `kind === 'strike_invalidated'` (mechanical proof of detector defect; no free-form rescind).
- No extra keys (same closed-key discipline as v1).

### 2.7.3 Closed registries

```js
STRIKE_WRITER_ALLOWLIST = ['fuse', 'conformance_audit', 'dispatch_hetero_failclosed', 'qualification_admin']
CRITICAL_REEXAM_PREDICATES = ['security_canary_disclosure', 'protected_test_tampering', 'evidence_hash_manipulation']
EXTERNAL_CAUSE_EXCLUSIONS = ['quota', 'user_abort', 'infra_outage', 'pre_dispatch_host_abort']  // writer-side, host-derived only
ORDINARY_STRIKE_THRESHOLD = 3
STRIKE_POLICY_VERSION = 2
```
`EXTERNAL_CAUSE_EXCLUSIONS` is the ONLY exclusion. `cause_class` never suppresses accrual.

### 2.7.4 Enforcement flag (shadow-first)

`AUTOPILOT_STRIKE_ENFORCEMENT` — `shadow` (DEFAULT, ships this cut) | `enforce`.
Read in `engine-scorecard.js` at projection time; documented in `references/strike-decay.md`
§Arming. `critical_reexam_trigger` ENFORCES regardless of this flag.

### 2.7.5 Projection (the only admission authority)

Emitted by `engine-scorecard.js` on every `current` row and by a new `seat-status` subcommand:

```json
{
  "admission_status": "qualified" | "no_record" | "requalify_required",
  "expiry_warning": true,
  "strikes_since_pass": 2,
  "critical_trigger": false,
  "would_requalify": false,
  "strike_threshold": 3,
  "strike_policy_version": 2,
  "rejected_strikes": 0
}
```
Fold, in order:
1. **Baseline** = the newest scorecard row for this seat whose derived status is `qualified`
   (calendar plays no part), ordered by `qualified_at` then `event_id`. No baseline ⇒
   `admission_status: 'no_record'`.
2. **Countable strikes** = `schema_version: 2`, `kind: 'strike'`, matching `seat_hash`,
   `observed_at` **strictly greater** than the baseline's `qualified_at` (pass-instant ties are
   pre-pass by construction — the v1 PINNED tiebreak, preserved), `observed_at <= now`,
   `writer` in the allowlist, `receipt_ref` non-empty, `artifact_sha256` well-formed, and not
   invalidated by a valid `strike_invalidated` row. Rows failing any of these are EXCLUDED and
   counted in `rejected_strikes` (an unauthorised writer can never inflate the count).
3. **Dedup**: rows sharing `(seat_hash, dedup_key)` count ONCE — lowest `event_id` wins.
4. `critical_trigger` = any countable strike with `class === 'critical_reexam_trigger'`.
5. `strikes_since_pass` = count of countable `ordinary_strike` rows after dedup.
6. `would_requalify` = `strikes_since_pass >= ORDINARY_STRIKE_THRESHOLD`.
7. `admission_status` = `requalify_required` if `critical_trigger`, OR if
   (`would_requalify` AND enforcement is `enforce`); otherwise `qualified`.
8. `expiry_warning` = `row.expires` parses and is `< now`. **Advisory only** — it never
   participates in step 7.

A passing fresh administration re-baselines (step 1), which logically clears prior strikes without
mutating a single line — the epoch semantics.

## 3. File-structure map

| File | Responsibility in this cut |
|------|----------------------------|
| `scripts/engine-capability-state.js` | Owns the strike STORE. Generalizes `strikes.jsonl` to schema v2 (§2.7.2), the closed registries (§2.7.3), dedup-idempotent append, `strike_invalidated`. New CLI: `strike` gains v2 flags; `list-strikes` emits validated rows for the projection. `brainSeatStatus` behavior on v1 rows unchanged. |
| `scripts/engine-scorecard.js` | Owns the PROJECTION. `deriveStatus` stops emitting `expired` (tooth a); adds `admission_status` / `expiry_warning` / strike fields (§2.7.5) to `current` rows; new `seat-status` subcommand. |
| `scripts/resolve-review-loop.sh` | Tooth b: the density-scaling node one-liner (L682-691) keys on `admission_status`, never on `expired`. |
| `scripts/dispatch-contract.js` | Tooth c: `isAdmissibleScorecardRow` NO-GOes on `admission_status === 'requalify_required'`, never on a date. |
| `scripts/dispatch-hetero.sh` | The REAL production writer: `classify_outcome`'s fail-closed `failure` branch appends an `ordinary_strike` with `cause_class`, honouring `EXTERNAL_CAUSE_EXCLUSIONS`. |
| `references/strike-decay.md` | NEW. The strike contract, the registries, where the arming flag lives. |
| `hooks/tests/strike-decay.test.sh` | NEW. Fold, dedup, allowlist, invalidation, critical trigger, shadow. |
| `hooks/tests/calendar-teeth-negative.test.sh` | NEW. Planted negative per pulled tooth + the grep-able "no admission path compares now vs expires" contract test. |
| `hooks/tests/engine-scorecard.test.sh`, `hooks/tests/resolve-review-loop.test.sh`, `hooks/tests/dispatch-contract.test.sh` | Existing assertions that pin the OLD calendar behavior are UPDATED (never deleted) to pin the new one. |
| `CHANGELOG.md`, `docs/BACKLOG.md`, `docs/projects/INDEX.md`, `docs/projects/2026-08-22-no-confidence-decay/README.md`, `.claude-plugin/plugin.json` (+ mirrors) | Docs + PATCH version bump. |

## 4. Phases

| Phase | Size | Content | Acceptance ("done when…") |
|-------|------|---------|---------------------------|
| **P0** | L | Strike store generalization in `engine-capability-state.js` per §2.7.2/§2.7.3, incl. dedup idempotency, invalidation-with-proof, read-time writer/receipt validation, `list-strikes`. v1 rows keep working. | `hooks/tests/engine-capability-state.test.sh` still green AND new v2 cases green; a v2 row with an un-allowlisted `writer` is rejected at write and excluded at read. |
| **P1** | L | Projection + tooth (a) in `engine-scorecard.js`: `deriveStatus` never returns `expired`; `current` rows and the new `seat-status` carry §2.7.5. | A past-`expires` qualified row projects `status: 'qualified'`, `expiry_warning: true`, `admission_status: 'qualified'`; store still unmutated. |
| **P2** | S | Teeth (b) + (c): `resolve-review-loop.sh` and `dispatch-contract.js` key on `admission_status`. | A past-`expires` row routes at its normal tier and gets a GO; a `requalify_required` seat gets tier `low` and a NO-GO naming the strike reason. |
| **P3** | S | Contract negative test: no admission path compares `now` vs `expires`. | Test greps the three admission files; re-introducing a date comparison turns it red. |
| **P4** | L | The real writer in `dispatch-hetero.sh` `classify_outcome`. | An end-to-end run of the fail-closed path lands a strike row in the isolated store; **deleting the wiring turns the test red** (`evidence-discipline` §1). |
| **P5** | L | Test suite (§5) incl. the two replay fixtures. | `bash hooks/tests/run.sh --parallel 8` green. |
| **P6** | S | Docs: `references/strike-decay.md`, CHANGELOG v2.34.35, BACKLOG rows (resolve the decay row; add the deferred rows from §7), project README + INDEX row, `sync-version.js` bump. | `bash scripts/preflight-release.sh` 8/8. |

Dependency map: P0 → P1 → {P2, P4} → P5 → P6. P3 may land any time after P2.

## 5. Test / validation

Script-gated (all in `hooks/tests/`, auto-discovered by glob, every store isolated by
`ENGINE_SCORECARD_DIR` / `ENGINE_CAPABILITY_DIR` with a landing assertion per `evidence-discipline` §9):

1. **Planted negative per pulled tooth** — a past-`expires` qualified row: (a) projects
   `qualified` + `expiry_warning`, (b) does NOT get tier `low`, (c) gets a GO. Each assertion
   fails if its tooth is re-introduced.
2. **Strike accumulation** — 3 ordinary strikes after baseline ⇒ `would_requalify: true`; with
   `AUTOPILOT_STRIKE_ENFORCEMENT=enforce` ⇒ `admission_status: 'requalify_required'`; with the
   default `shadow` ⇒ still `qualified` (KR6's proof).
3. **Pass-rebaseline epoch** — a fresh qualified administration after 3 strikes ⇒
   `strikes_since_pass: 0`, and the strike rows are still on disk unmodified.
4. **Pass-instant tiebreak** — a strike stamped at exactly `qualified_at` does NOT count.
5. **Critical trigger** — one `critical_reexam_trigger` strike ⇒ `requalify_required`
   immediately, under the DEFAULT shadow flag.
6. **Registry closure** — a `critical_reexam_trigger` naming an unregistered `predicate_id` is
   rejected at write.
7. **Dedup** — two appends with the same `(seat_hash, dedup_key)` ⇒ one countable strike; the
   second append is idempotent (no duplicate row, no error).
8. **Writer allowlist** — a hand-written row with `writer: "operator"` is excluded from the count
   and appears in `rejected_strikes`.
9. **Invalidation** — `strike_invalidated` with full proof removes exactly one strike from the
   count; without the proof fields it is rejected at write.
10. **Contract test (P3)** — the grep-able negative: no admission path compares `now` vs `expires`.
11. **Writer wiring (P4)** — end-to-end fail-closed dispatch lands a strike; delete the wiring ⇒ red.
12. **Exclusion enum** — a `quota_exhausted` classification appends NO strike.
13. **Replay fixtures** (this month's real events, per synthesis §8): the agy envelope corruption
    ⇒ an `ordinary_strike` with `cause_class: 'runner_delivery'` that still accrues to the pair;
    the grok-4.6 canary ⇒ `critical_reexam_trigger` / `security_canary_disclosure`.

Full gate: `bash hooks/tests/run.sh --parallel 8`, then `bash scripts/preflight-release.sh` 8/8.

Human-gated (depth-0, not depth-1): the authoritative QC panel verdict and the merge.

## 6. Risks + inversion

**What would guarantee this fails?**

| Risk | Mitigation |
|------|-----------|
| The fold ships but nothing writes to it — a module with zero callers (`evidence-discipline` §1) | KR5 requires a REAL production writer plus a delete-the-wiring negative test |
| Only some calendar teeth are pulled, so the calendar keeps biting while the fold shadows | Deliverable 2 pulls all three in one cut; KR1's grep contract test makes a fourth tooth un-addable |
| A flaky detector inflates strikes and blocks a good seat | Ordinary strikes ship in SHADOW; dedup by root-incident idempotency key; writer allowlist validated at READ time; `strike_invalidated` with mechanical proof |
| Tests write into the operator's real scorecard store (`evidence-discipline` §9) | Every test sets the store env vars and asserts the landing path |
| A "test" that passes when the gate is deleted (`evidence-discipline` §2) | Each pulled tooth gets a planted negative; the fold gets a mutation check |
| Threshold nobody revisits becomes a calendar tooth in a trench coat (kimi) | Threshold review is a dated BACKLOG row, and shadow data must justify arming |

## 7. Out of scope

- Official qualification defaults packaging (separate L project).
- Re-exam scheduling automation; rate-based windows; liveness probes; detector anomaly
  quarantine automation; fleet circuit breaker. → BACKLOG rows.
- Any trust machinery (hash chains, receipts-as-attestation) — ADR-0001.
- The exam suites themselves (`evals/impl-eval-*`, `engine-qualify`) beyond wiring needs.

## 8. Open questions (Board only)

- Phase-2 arming: which role arms the ordinary-strike threshold first, and at what N?
  (Shipping N=3 in shadow; arming is a later, dated decision.)

## Review log

- R0 author: depth-1 foreman (`nocon-decay-l4`), from the frozen seven-seat synthesis.
- First-pass qc at depth-1; the authoritative panel runs at depth-0 after return.
